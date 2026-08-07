(function() {
    'use strict';

    const MASTER_APP_ID = 10;

    // ========================================
    // 重複レコード防止
    // ========================================
    kintone.events.on(['app.record.create.submit', 'app.record.edit.submit'], async function(event) {
        const record = event.record;
        const year = record['年度'] ? parseInt(record['年度'].value, 10) : null;
        const month = record['月'] ? parseInt(record['月'].value, 10) : null;

        if (!year || !month) return event;

        const currentId = kintone.app.record.getId();
        const query = `年度 = ${year} and 月 = ${month} limit 2`;

        try {
            const resp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
                app: kintone.app.getId(),
                query: query,
                fields: ['$id']
            });

            const conflict = resp.records.find(r => {
                const foundId = parseInt(r['$id'].value, 10);
                return currentId === null || foundId !== currentId;
            });

            if (conflict) {
                event.error = `${year}年度 ${month}月のレコードは既に存在します。重複して作成することはできません。`;
            }
        } catch (e) {
            console.error('重複チェックエラー:', e);
        }

        return event;
    });

    // ========================================
    // 管理者以外は自動入力フィールドを編集不可にする
    // ========================================
    kintone.events.on(['app.record.create.show', 'app.record.edit.show'], function(event) {
        const record = event.record;
        const user = kintone.getLoginUser();

        // 指定されたログインIDと、デフォルトのシステム管理者を設定
        const adminUsers = ['Administrator', 'npo@iroha-mie.com'];

        // ログインユーザーが上記の管理者リストに含まれていなければ、ロックをかける
        if (!adminUsers.includes(user.code)) {
            for (let key in record) {
                // 自動計算フィールドの命名規則に当てはまるものを一括で入力不可にする
                if (
                    key.endsWith('_実人数') ||
                    key.endsWith('_延件数') ||
                    key.startsWith('累計_') ||
                    key.endsWith('テーブル') ||
                    ['専門相談', 'ペアトレ', 'ペアプロ', 'アウトリーチ'].includes(key)
                ) {
                    record[key].disabled = true; 
                }
            }
        }
        return event;
    });

    // ========================================
    // 詳細画面: ボタンの設置
    // ========================================
    kintone.events.on(['app.record.detail.show'], function(event) {
        const headerSpace = kintone.app.record.getHeaderMenuSpaceElement();
        if (document.getElementById('calc-btn')) return event;

        const calcBtn = document.createElement('button');
        calcBtn.id = 'calc-btn';
        calcBtn.type = 'button';
        calcBtn.innerText = '📊 CSVから実績を集計する';
        calcBtn.style.cssText = 'margin: 10px 4px; padding: 8px 16px; background-color: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;';

        calcBtn.onclick = async function() {
            console.log("=== 🚀 集計プロセス開始 ===");
            calcBtn.innerText = '集計中...（そのままお待ちください）';
            calcBtn.disabled = true;

            try {
                const record = kintone.app.record.get().record;
                const year = record['年度'] ? parseInt(record['年度'].value, 10) : null;
                const month = record['月'] ? parseInt(record['月'].value, 10) : null;

                if (!year || !month) {
                    throw new Error('「年度」と「月」を入力してから実行してください。');
                }

                let data = initializeData();

                console.log("▶︎ マスタ(App10)のデータ取得中...");
                const areaMap = await fetchAllMasterData();
                console.log(`✅ マスタデータ取得完了: ${Object.keys(areaMap).length}件`);

                let processedCount = 0;
                const tables = {
                    '明和児発テーブル': [], '多気児発テーブル': [], '大台児発テーブル': [], '松阪児発テーブル': [],
                    '明和訪問テーブル': [], '多気訪問テーブル': [], '大台訪問テーブル': []
                };

                // ----------------------------------------
                // CSVファイルの読み取りと処理
                // ----------------------------------------
                const csvFiles = record['添付ファイル'] ? record['添付ファイル'].value : [];
                let jihatsuRecords = [];
                let houmonRecords = [];

                if (csvFiles && csvFiles.length > 0) {
                    console.log(`▶︎ CSVの解析中... (添付ファイル数: ${csvFiles.length}個)`);
                    let allCsvRecords = [];
                    
                    // 添付されているすべてのファイルをループで読み込む
                    for (let i = 0; i < csvFiles.length; i++) {
                        console.log(`  📄 ${csvFiles[i].name} を読み込み中...`);
                        const records = await processCsv(csvFiles[i].fileKey);
                        allCsvRecords = allCsvRecords.concat(records);
                    }
                    
                    // 重複データの除外処理 (氏名 + サービス + 日付)
                    const uniqueKeys = new Set();
                    const deduplicatedRecords = [];
                    allCsvRecords.forEach(r => {
                        const key = `${r.name}_${r.serviceType}_${r.date}`;
                        if (!uniqueKeys.has(key)) {
                            uniqueKeys.add(key);
                            deduplicatedRecords.push(r);
                        }
                    });
                    
                    console.log(`✅ 重複除外完了: 結合前 ${allCsvRecords.length}件 → 除外後 ${deduplicatedRecords.length}件`);
                    allCsvRecords = deduplicatedRecords; 

                    jihatsuRecords = allCsvRecords.filter(r => r.serviceType === 'jihatsu');
                    houmonRecords  = allCsvRecords.filter(r => r.serviceType === 'houmon');
                    console.log(`✅ CSV種別振分け完了: 児発=${jihatsuRecords.length}件（行数）, 保訪=${houmonRecords.length}件（行数）`);
                } else {
                    console.warn("⚠️ 添付ファイルが存在しません。");
                }

                // ----------------------------------------
                // 児発の集計
                // ----------------------------------------
                const jihatsuByName = {};
                jihatsuRecords.forEach(r => {
                    if (!jihatsuByName[r.name]) jihatsuByName[r.name] = { count: 0 };
                    jihatsuByName[r.name].count += 1;
                });

                Object.entries(jihatsuByName).forEach(([name, info]) => {
                    const master = getMatchedMaster(name, areaMap);
                    const area = master ? master.area : '不明';
                    const gradeKey = mapGrade(master ? master.grade : '', 'jihatsu');
                    
                    if (area !== '不明' && gradeKey !== '不明' && data[`${area}児発_${gradeKey}_実人数`] !== undefined) {
                        processedCount++;
                        data[`${area}児発_${gradeKey}_実人数`] += 1;
                        data[`${area}児発_${gradeKey}_延件数`] += info.count;
                        data[`${area}児発_合計_実人数`] += 1;
                        data[`${area}児発_合計_延件数`] += info.count;
                        if (area === '明和' || area === '多気' || area === '大台') {
                            data[`多気郡児発_${gradeKey}_実人数`] += 1;
                            data[`多気郡児発_${gradeKey}_延件数`] += info.count;
                            data[`多気郡児発_合計_実人数`] += 1;
                            data[`多気郡児発_合計_延件数`] += info.count;
                        }
                        if (tables[`${area}児発テーブル`]) {
                            tables[`${area}児発テーブル`].push(createTableRow(master.originalName, gradeKey, info.count, '児発', area));
                        }
                    } else {
                        console.warn(`⚠️ スキップ(児発): ${name} → エリア:${area}, 学年:${gradeKey}`);
                    }
                });

                // ----------------------------------------
                // 保訪の集計
                // ----------------------------------------
                const houmonByName = {};
                houmonRecords.forEach(r => {
                    if (!houmonByName[r.name]) houmonByName[r.name] = { count: 0 };
                    houmonByName[r.name].count += 1;
                });

                Object.entries(houmonByName).forEach(([name, info]) => {
                    const master = getMatchedMaster(name, areaMap);
                    const area = master ? master.area : '不明';
                    const gradeKey = mapGrade(master ? master.grade : '', 'houmon');
                    
                    if (area !== '不明' && area !== '松阪' && gradeKey !== '不明' && data[`${area}訪問_${gradeKey}_実人数`] !== undefined) {
                        processedCount++;
                        data[`${area}訪問_${gradeKey}_実人数`] += 1;
                        data[`${area}訪問_${gradeKey}_延件数`] += info.count;
                        data[`${area}訪問_合計_実人数`] += 1;
                        data[`${area}訪問_合計_延件数`] += info.count;
                        if (area === '明和' || area === '多気' || area === '大台') {
                            data[`多気郡訪問_${gradeKey}_実人数`] += 1;
                            data[`多気郡訪問_${gradeKey}_延件数`] += info.count;
                            data[`多気郡訪問_合計_実人数`] += 1;
                            data[`多気郡訪問_合計_延件数`] += info.count;
                        }
                        if (tables[`${area}訪問テーブル`]) {
                            tables[`${area}訪問テーブル`].push(createTableRow(master.originalName, gradeKey, info.count, '訪問', area));
                        }
                    } else {
                        console.warn(`⚠️ スキップ(保訪): ${name} → エリア:${area}, 学年:${gradeKey}`);
                    }
                });

                // ----------------------------------------
                // 累計計算
                // ----------------------------------------
                console.log("▶︎ 年度内レコード取得中...");
                const appId = kintone.app.getId();
                const recordId = kintone.app.record.getId();
                const yearRecords = await fetchYearRecords(year, month, appId);
                console.log(`✅ 年度内レコード取得完了: ${yearRecords.length}件（当月除く）`);

                console.log("▶︎ 児発・訪問 累計計算中...");
                const prevMonthRec = yearRecords.length > 0 ? yearRecords[yearRecords.length - 1] : null;
                for (let key in data) {
                    if (key.endsWith('_延件数') && !key.startsWith('累計_')) {
                        const cumKey = `累計_${key}`;
                        const prevCum = prevMonthRec && prevMonthRec[cumKey] ? parseInt(prevMonthRec[cumKey].value || 0, 10) : 0;
                        data[cumKey] = (month === 4) ? data[key] : data[key] + prevCum;
                    }
                }

                const tableDefs = {
                    '明和児発テーブル':  { area: '明和',  type: '児発',  grades: ['1歳未満','2歳児','年少','年中','年長','合計'] },
                    '多気児発テーブル':  { area: '多気',  type: '児発',  grades: ['1歳未満','2歳児','年少','年中','年長','合計'] },
                    '大台児発テーブル':  { area: '大台',  type: '児発',  grades: ['1歳未満','2歳児','年少','年中','年長','合計'] },
                    '松阪児発テーブル':  { area: '松阪',  type: '児発',  grades: ['1歳未満','2歳児','年少','年中','年長','合計'] },
                    '明和訪問テーブル':  { area: '明和',  type: '訪問',  grades: ['2歳未満','年少','年中','年長','小学生以上','合計'] },
                    '多気訪問テーブル':  { area: '多気',  type: '訪問',  grades: ['2歳未満','年少','年中','年長','小学生以上','合計'] },
                    '大台訪問テーブル':  { area: '大台',  type: '訪問',  grades: ['2歳未満','年少','年中','年長','小学生以上','合計'] }
                };

                for (let tKey in tableDefs) {
                    const def = tableDefs[tKey];
                    const nameKey = `${def.area}${def.type}_氏名`;
                    const gradeFieldKey = `${def.area}${def.type}_学年`;
                    const gradeSets = {};
                    def.grades.forEach(g => { gradeSets[g] = new Set(); });

                    yearRecords.forEach(rec => {
                        if (rec[tKey] && rec[tKey].value) {
                            rec[tKey].value.forEach(row => {
                                const name = row.value[nameKey] ? row.value[nameKey].value : '';
                                const grade = row.value[gradeFieldKey] ? row.value[gradeFieldKey].value : '';
                                if (name) {
                                    if (grade && gradeSets[grade]) gradeSets[grade].add(name);
                                    gradeSets['合計'].add(name);
                                }
                            });
                        }
                    });

                    if (tables[tKey]) {
                        tables[tKey].forEach(row => {
                            const name = row.value[nameKey] ? row.value[nameKey].value : '';
                            const grade = row.value[gradeFieldKey] ? row.value[gradeFieldKey].value : '';
                            if (name) {
                                if (grade && gradeSets[grade]) gradeSets[grade].add(name);
                                gradeSets['合計'].add(name);
                            }
                        });
                    }

                    def.grades.forEach(g => {
                        data[`累計_${def.area}${def.type}_${g}_実人数`] = gradeSets[g].size;
                    });
                    if (def.area === '明和' || def.area === '多気' || def.area === '大台') {
                        def.grades.forEach(g => {
                            const k = `累計_多気郡${def.type}_${g}_実人数`;
                            if (data[k] !== undefined) data[k] += gradeSets[g].size;
                        });
                    }
                }
                console.log("✅ 児発・訪問 累計計算完了");

                // 専門相談
                console.log("▶︎ 専門相談 累計計算中...");
                const soudan_areas = ['明和', '多気', '大台', '多気郡'];
                const soudan_types = ['電話', 'メール', '面談', '訪問', 'その他'];
                const townToArea = { '明和町': '明和', '多気町': '多気', '大台町': '大台' };
                soudan_areas.forEach(a => { soudan_types.forEach(t => { data[`累計_${a}専門相談_${t}`] = 0; }); });
                const collectSoudan = function(tv) {
                    if (!tv) return;
                    tv.forEach(row => {
                        const area = townToArea[row.value['町名外来'] ? row.value['町名外来'].value : ''];
                        if (!area) return;
                        soudan_types.forEach(t => { data[`累計_${area}専門相談_${t}`] += parseInt(row.value[t] ? row.value[t].value || 0 : 0, 10); });
                    });
                };
                yearRecords.forEach(rec => { if (rec['専門相談'] && rec['専門相談'].value) collectSoudan(rec['専門相談'].value); });
                collectSoudan(record['専門相談'] ? record['専門相談'].value : []);
                soudan_types.forEach(t => {
                    data[`累計_多気郡専門相談_${t}`] = (data[`累計_明和専門相談_${t}`]||0) + (data[`累計_多気専門相談_${t}`]||0) + (data[`累計_大台専門相談_${t}`]||0);
                });
                soudan_areas.forEach(a => {
                    data[`累計_${a}専門相談_合計`] = soudan_types.reduce((s, t) => s + (data[`累計_${a}専門相談_${t}`]||0), 0);
                });
                console.log("✅ 専門相談 累計計算完了");

                // ペアトレ
                const pairTraRows = [];
                const cPT = function(tv) { if (!tv) return; tv.forEach(row => { const d = row.value['ペアトレ日付'] ? row.value['ペアトレ日付'].value : ''; const c = parseInt(row.value['ペアトレ利用人数'] ? row.value['ペアトレ利用人数'].value || 0 : 0, 10); if (d || c > 0) pairTraRows.push({date:d||'',count:c}); }); };
                yearRecords.forEach(rec => { if (rec['ペアトレ'] && rec['ペアトレ'].value) cPT(rec['ペアトレ'].value); });
                cPT(record['ペアトレ'] ? record['ペアトレ'].value : []);
                pairTraRows.sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
                const cumPT = pairTraRows.map(r => ({ value: { '累計_ペアトレ日付': { value: formatDate(r.date) }, '累計_ペアトレ利用人数': { value: r.count } } }));

                // ペアプロ
                const pairProRows = [];
                const cPP = function(tv) { if (!tv) return; tv.forEach(row => { const d = row.value['ペアプロ日付'] ? row.value['ペアプロ日付'].value : ''; const c = parseInt(row.value['ペアプロ利用人数'] ? row.value['ペアプロ利用人数'].value || 0 : 0, 10); if (d || c > 0) pairProRows.push({date:d||'',count:c}); }); };
                yearRecords.forEach(rec => { if (rec['ペアプロ'] && rec['ペアプロ'].value) cPP(rec['ペアプロ'].value); });
                cPP(record['ペアプロ'] ? record['ペアプロ'].value : []);
                pairProRows.sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
                const cumPP = pairProRows.map(r => ({ value: { '累計_ペアプロ日付': { value: formatDate(r.date) }, '累計_ペアプロ利用人数': { value: r.count } } }));

                // アウトリーチ
                const outRows = [];
                const townOrd = { '明和町': 1, '多気町': 2, '大台町': 3 };
                const cOR = function(tv) { if (!tv) return; tv.forEach(row => { const tw = row.value['町名アウトリーチ'] ? row.value['町名アウトリーチ'].value : ''; const d = row.value['日付アウトリーチ'] ? row.value['日付アウトリーチ'].value : ''; const j = row.value['事業名アウトリーチ'] ? row.value['事業名アウトリーチ'].value : ''; if (tw||d||j) outRows.push({town:tw||'',date:d||'',jigyou:j||''}); }); };
                yearRecords.forEach(rec => { if (rec['アウトリーチ'] && rec['アウトリーチ'].value) cOR(rec['アウトリーチ'].value); });
                cOR(record['アウトリーチ'] ? record['アウトリーチ'].value : []);
                outRows.sort((a,b) => { const ta = townOrd[a.town]||99, tb = townOrd[b.town]||99; return ta !== tb ? ta - tb : a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
                const cumOR = outRows.map(r => ({ value: { '累計_町名アウトリーチ': { value: r.town }, '累計_日付アウトリーチ': { value: formatDate(r.date) }, '累計_事業名アウトリーチ': { value: r.jigyou } } }));

                // 確認ダイアログ
                const jihatsuNames = Object.keys(jihatsuByName);
                const houmonNames = Object.keys(houmonByName);
                let confirmMsg = `【集計結果の確認】\n・児発: ${jihatsuNames.length}名（延${jihatsuRecords.length}件）\n・保訪: ${houmonNames.length}名（延${houmonRecords.length}件）\n・マスタと一致した ${processedCount}名 分を反映予定\n\nこの内容でkintoneに保存しますか？`;
                if (!confirm(confirmMsg)) { console.log("キャンセル"); return; }

                // 保存
                const rawRecord = {};
                for (let key in data) { rawRecord[key] = { value: data[key] }; }
                for (let tKey in tables) { rawRecord[tKey] = { value: tables[tKey] }; }
                rawRecord['累計_ペアトレ'] = { value: cumPT };
                rawRecord['累計_ペアプロ'] = { value: cumPP };
                rawRecord['累計_アウトリーチ'] = { value: cumOR };

                const props = await fetchFormFields(appId);
                const { filtered } = filterRecordToValidFields(rawRecord, props);

                await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', { app: appId, id: recordId, record: filtered });
                alert('✅ 保存しました！\nページを再読み込みして確認してください。');
                location.reload();

            } catch (error) {
                console.error("🚨 処理エラー:", error);
                alert('エラーが発生しました:\n' + error.message);
            } finally {
                calcBtn.innerText = '📊 CSVから実績を集計する';
                calcBtn.disabled = false;
            }
        };

        headerSpace.appendChild(calcBtn);
        return event;
    });

    // ========================================
    // CSV読取処理
    // ========================================
    async function processCsv(fileKey) {
        const url = '/k/v1/file.json?fileKey=' + fileKey;
        const resp = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!resp.ok) throw new Error('CSVファイルの読み込みに失敗しました。');

        const text = await resp.text();
        const lines = text.split(/\r?\n/);

        const header = lines[0].split(',').map(h => h.trim().replace(/^"(.*)"$/, '$1'));
        const colName    = header.indexOf('利用者名');
        const colService = header.indexOf('サービス');
        const colDate    = header.indexOf('日付');

        if (colName === -1 || colService === -1 || colDate === -1) {
            throw new Error('CSVのフォーマットが正しくありません。「利用者名」「サービス」「日付」列が見つかりません。');
        }

        const results = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const cols = line.split(',').map(c => c.trim().replace(/^"(.*)"$/, '$1'));
            const rawName   = cols[colName]    || '';
            const service   = cols[colService] || '';
            const rawDate   = cols[colDate]    || '';

            const name = rawName.replace(/[\s　]/g, '');
            if (!name) continue;

            let serviceType = '';
            if (service === '児発') {
                serviceType = 'jihatsu';
            } else if (service === '保訪') {
                serviceType = 'houmon';
            } else {
                continue;
            }

            results.push({ originalName: rawName.trim(), name: name, date: rawDate.trim(), serviceType: serviceType });
        }

        return results;
    }

    // ========================================
    // 氏名のマスタ突合（漢字のゆらぎ吸収）
    // ========================================
    function getMatchedMaster(csvName, areaMap) {
        // 1. 完全一致チェック
        if (areaMap[csvName]) return areaMap[csvName];

        // 2. 漢字のゆらぎを吸収（正規化）して比較
        const normalizedCsv = normalizeKanji(csvName);
        for (let masterKey in areaMap) {
            if (normalizeKanji(masterKey) === normalizedCsv) {
                console.log(`💡 ゆらぎ一致: CSV「${csvName}」→ マスタ「${masterKey}」`);
                return areaMap[masterKey];
            }
        }
        return null; // 見つからない場合
    }

    // 漢字の異体字を統一する関数
    function normalizeKanji(str) {
        return str
            .replace(/[邊邉]/g, '辺')
            .replace(/[澤]/g, '沢')
            .replace(/[齋齊斎]/g, '斉')
            .replace(/[櫻]/g, '桜')
            .replace(/[廣]/g, '広')
            .replace(/[濱濵]/g, '浜')
            .replace(/[髙]/g, '高')
            .replace(/[﨑嵜]/g, '崎')
            .replace(/[嶋]/g, '島');
    }

    // ========================================
    // 学年マッピング
    // ========================================
    function mapGrade(gradeStr, type) {
        const g = gradeStr.replace(/[\s　]/g, '').replace(/[０-９]/g, function(s) {
            return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
        });
        if (type === 'jihatsu') {
            if (g.includes('0歳') || g === '0歳児' || g.includes('1歳') || g === '1歳児') return '1歳未満';
            if (g.includes('2歳') || g === '2歳児') return '2歳児';
            if (g.includes('3歳') || g === '3歳児' || g.includes('年少')) return '年少';
            if (g.includes('4歳') || g === '4歳児' || g.includes('年中')) return '年中';
            if (g.includes('5歳') || g === '5歳児' || g.includes('6歳') || g === '6歳児' || g.includes('年長')) return '年長';
        }
        if (type === 'houmon') {
            if (g.includes('0歳') || g === '0歳児' || g.includes('1歳') || g === '1歳児' || g.includes('2歳') || g === '2歳児') return '2歳未満';
            if (g.includes('3歳') || g === '3歳児' || g.includes('年少')) return '年少';
            if (g.includes('4歳') || g === '4歳児' || g.includes('年中')) return '年中';
            if (g.includes('5歳') || g === '5歳児' || g.includes('6歳') || g === '6歳児' || g.includes('年長')) return '年長';
            if (/^小[1-6]$/.test(g) || /^中[1-3]$/.test(g) || g.includes('小学') || g.includes('中学') || g.includes('高校')) return '小学生以上';
        }
        return '不明';
    }

    // ========================================
    // ユーティリティ関数
    // ========================================
    async function fetchFormFields(appId) {
        const resp = await kintone.api(kintone.api.url('/k/v1/app/form/fields', true), 'GET', { app: appId });
        return resp.properties || {};
    }

    function filterRecordToValidFields(recordObj, properties) {
        const filtered = {};
        for (const key in recordObj) {
            const prop = properties[key];
            if (!prop || ['CALC','RECORD_NUMBER','CREATED_TIME','UPDATED_TIME','CREATOR','MODIFIER','STATUS','CATEGORY','STATUS_ASSIGNEE'].includes(prop.type)) continue;
            
            if (prop.type === 'SUBTABLE') {
                const rows = (recordObj[key].value || []).map(row => {
                    const cell = {};
                    for (const innerKey in row.value) {
                        const innerProp = (prop.fields || {})[innerKey];
                        if (innerProp && innerProp.type !== 'CALC') {
                            cell[innerKey] = { value: row.value[innerKey].value };
                        }
                    }
                    return { value: cell };
                });
                filtered[key] = { value: rows };
            } else {
                filtered[key] = { value: recordObj[key].value };
            }
        }
        return { filtered: filtered };
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        const parts = String(dateStr).split('-');
        if (parts.length === 3) return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
        return dateStr;
    }

    async function fetchAllMasterData() {
        const body = { app: MASTER_APP_ID, query: 'limit 500', fields: ['児童氏名', 'エリア', '学年'] };
        const resp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', body);
        let map = {};
        resp.records.forEach(r => {
            let nameVal = (r['児童氏名'] && r['児童氏名'].value) ? String(r['児童氏名'].value) : '';
            let masterName = nameVal.replace(/[\s　]/g, '');
            let areaVal = (r['エリア'] && r['エリア'].value) ? String(r['エリア'].value) : '';
            let area = areaVal ? areaVal.replace('町', '').replace('市', '') : '不明';
            let gradeVal = (r['学年'] && r['学年'].value) ? String(r['学年'].value) : '';
            if (masterName) {
                map[masterName] = { area: area, grade: gradeVal, originalName: masterName };
            }
        });
        return map;
    }

    async function fetchYearRecords(year, month, appId) {
        if (month === 4) return [];
        const tableFields = ['明和児発テーブル', '多気児発テーブル', '大台児発テーブル', '松阪児発テーブル', '明和訪問テーブル', '多気訪問テーブル', '大台訪問テーブル', '専門相談', 'ペアトレ', 'ペアプロ', 'アウトリーチ'];
        const cumFields = [];
        const areas = ['明和', '多気', '大台', '多気郡', '松阪'];
        const gJ = ['1歳未満', '2歳児', '年少', '年中', '年長', '合計'];
        const gH = ['2歳未満', '年少', '年中', '年長', '小学生以上', '合計'];
        areas.forEach(a => {
            gJ.forEach(g => cumFields.push(`累計_${a}児発_${g}_延件数`));
            if (a !== '松阪') gH.forEach(g => cumFields.push(`累計_${a}訪問_${g}_延件数`));
        });
        const query = `年度 = ${year} and 月 >= 4 and 月 < ${month} order by 月 asc limit 50`;
        try {
            const resp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', { app: appId, query: query, fields: ['月', ...tableFields, ...cumFields] });
            return resp.records;
        } catch (e) { return []; }
    }

    function createTableRow(name, grade, count, type, area) {
        return { value: { [`${area}${type}_氏名`]: { value: name }, [`${area}${type}_学年`]: { value: grade }, [`${area}${type}_利用回数`]: { value: count } } };
    }

    function initializeData() {
        const areas = ['明和', '多気', '大台', '多気郡', '松阪'];
        const types = ['児発', '訪問'];
        const gJ = ['1歳未満', '2歳児', '年少', '年中', '年長', '合計'];
        const gH = ['2歳未満', '年少', '年中', '年長', '小学生以上', '合計'];
        const sA = ['明和', '多気', '大台', '多気郡'];
        const sT = ['電話', 'メール', '面談', '訪問', 'その他'];
        let data = {};
        areas.forEach(a => {
            types.forEach(t => {
                if (a === '松阪' && t === '訪問') return;
                (t === '児発' ? gJ : gH).forEach(g => {
                    data[`${a}${t}_${g}_実人数`] = 0;
                    data[`${a}${t}_${g}_延件数`] = 0;
                    data[`累計_${a}${t}_${g}_実人数`] = 0;
                    data[`累計_${a}${t}_${g}_延件数`] = 0;
                });
            });
        });
        sA.forEach(a => { sT.forEach(t => { data[`累計_${a}専門相談_${t}`] = 0; }); data[`累計_${a}専門相談_合計`] = 0; });
        return data;
    }

})();
