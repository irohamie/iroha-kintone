(function() {
    'use strict';

    // ============================================================
    // 3町月次報告書 出力・保存・印刷（Excel + PDF）
    // 事前準備: アプリのJSカスタマイズに以下のCDNを順に追加すること
    //   https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js
    //   https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
    //   https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
    // 事前準備: 添付フィールド「報告書添付」を作成すること
    // ============================================================

    const JIHATSU_GRADES = ['1歳未満', '2歳児', '年少', '年中', '年長'];
    const HOUMON_GRADES = ['2歳未満', '年少', '年中', '年長', '小学生以上'];
    const SOUDAN_TYPES = ['電話', 'メール', '面談', '訪問', 'その他'];
    const JIHATSU_BLOCKS = [
        { area: '明和', startRow: 5 }, { area: '多気', startRow: 12 },
        { area: '大台', startRow: 19 }, { area: '松阪', startRow: 33 }
    ];
    const HOUMON_BLOCKS = [
        { area: '明和', startRow: 5 }, { area: '多気', startRow: 12 }, { area: '大台', startRow: 19 }
    ];
    const SOUDAN_BLOCKS = [
        { area: '明和', startRow: 5 }, { area: '多気', startRow: 12 }, { area: '大台', startRow: 19 }
    ];
    const OUT_BLOCKS = { '明和町': 48, '多気町': 51, '大台町': 54 };
    const townToArea = { '明和町': '明和', '多気町': '多気', '大台町': '大台' };

    // 累計報告書「最終報告」シートのアウトリーチ枠（町名→各枠の開始行）
    // 事業名の文言はkintone実データの表記に揺れがあるため固定文言でマッチングせず、
    // 町ごとに実際に登場した事業名を出現順に枠へ割り当てる方式にする。
    // 1つの枠につきQ-AA列(11列)×2行=最大22件の日付を格納可能
    const FINAL_OUTREACH_SLOTS = {
        '明和町': [24],
        '多気町': [27, 29],
        '大台町': [32, 34]
    };
    const FIELD_CODE = '報告書添付';
    const TEMPLATE_RECORD_ID = 1; // 原本テンプレートを保持するレコードの$id
    const TEMPLATE_FIELD_CODE = '原本'; // 原本テンプレートの添付フィールドコード

    // ============================================================
    // 詳細画面: ボタン設置
    // ============================================================
    kintone.events.on(['app.record.detail.show'], function(event) {
        const headerSpace = kintone.app.record.getHeaderMenuSpaceElement();
        if (document.getElementById('rpt-month-btn')) return event;

        const record = event.record;
        const year = record['年度'] ? parseInt(record['年度'].value, 10) : null;
        const month = record['月'] ? parseInt(record['月'].value, 10) : null;

        // --- 月次保存ボタン（Excel+PDF、同名上書き）---
        const monthBtn = document.createElement('button');
        monthBtn.id = 'rpt-month-btn';
        monthBtn.type = 'button';
        monthBtn.innerText = '📄 この月を報告書保存(Excel+PDF)';
        monthBtn.style.cssText = 'margin: 10px 4px; padding: 8px 16px; background-color: #27ae60; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;';
        monthBtn.onclick = function() {
            runWithButtonState(function() {
                return saveMonthReport(year, month);
            }, monthBtn, '📄 この月を報告書保存(Excel+PDF)');
        };
        headerSpace.appendChild(monthBtn);

        // --- 累計保存ボタン（月選択モーダル）---
        const finalBtn = document.createElement('button');
        finalBtn.id = 'rpt-final-btn';
        finalBtn.type = 'button';
        finalBtn.innerText = '🏁 累計報告を保存(月選択)';
        finalBtn.style.cssText = 'margin: 10px 4px; padding: 8px 16px; background-color: #8e44ad; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;';
        finalBtn.onclick = function() {
            if (!checkLibraries()) return;
            openMonthSelectModal(year, month);
        };
        headerSpace.appendChild(finalBtn);

        return event;
    });

    // エラーオブジェクトから可能な限り詳細な文字列を組み立てる（messageが空のケースにも対応）
    function describeError(e) {
        if (!e) return '(不明なエラー: エラー情報がありません)';
        let parts = [];
        if (e.name) parts.push(e.name);
        if (e.message) parts.push(e.message);
        if (parts.length === 0) {
            try { parts.push(JSON.stringify(e)); } catch (jsonErr) { parts.push(String(e)); }
        }
        let detail = parts.join(': ');
        if (e.stack) detail += '\n\n' + String(e.stack).split('\n').slice(0, 3).join('\n');
        return detail;
    }

    // ボタンの処理中表示切り替えつきで非同期処理を実行する共通処理
    function runWithButtonState(callback, btn, originalLabel) {
        if (!checkLibraries()) return;
        (async function() {
            btn.innerText = '処理中...';
            btn.disabled = true;
            try {
                await callback();
            } catch (e) {
                console.error('🚨 エラー:', e);
                alert('エラーが発生しました:\n' + describeError(e));
            } finally {
                btn.innerText = originalLabel;
                btn.disabled = false;
            }
        })();
    }

    // 必要ライブラリの読み込みチェック
    function checkLibraries() {
        if (typeof ExcelJS === 'undefined') {
            alert('ExcelJSライブラリが読み込まれていません。\nアプリ設定のJSカスタマイズに以下を追加してください:\nhttps://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js');
            return false;
        }
        if (typeof html2canvas === 'undefined') {
            alert('html2canvasライブラリが読み込まれていません。\nアプリ設定のJSカスタマイズに以下を追加してください:\nhttps://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
            return false;
        }
        if (typeof window.jspdf === 'undefined' && typeof jsPDF === 'undefined') {
            alert('jsPDFライブラリが読み込まれていません。\nアプリ設定のJSカスタマイズに以下を追加してください:\nhttps://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
            return false;
        }
        return true;
    }

    // ============================================================
    // 月選択モーダル（累計対象月をチェックボックスで選ぶ）
    // ============================================================
    function openMonthSelectModal(year, month) {
        if (!checkLibraries()) return;
        if (!year) { alert('「年度」が入力されていません。'); return; }

        // 既存モーダルがあれば削除
        const existing = document.getElementById('rpt-modal-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'rpt-modal-overlay';
        overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:10000; display:flex; align-items:center; justify-content:center;';

        const modal = document.createElement('div');
        modal.style.cssText = 'background:white; padding:24px; border-radius:8px; max-width:420px; width:90%; max-height:80vh; overflow-y:auto;';

        const title = document.createElement('div');
        title.innerText = '累計報告に含める月を選択';
        title.style.cssText = 'font-size:18px; font-weight:bold; margin-bottom:16px;';
        modal.appendChild(title);

        const desc = document.createElement('div');
        desc.innerText = '選択した月を含むファイル名で保存されます（例：3町報告2026 07 08 09）。累計の数値は最新月の累計フィールドを使用します。';
        desc.style.cssText = 'font-size:13px; color:#666; margin-bottom:16px; line-height:1.5;';
        modal.appendChild(desc);

        // 月チェックボックス（年度は4月〜翌3月）
        const monthOrder = [4,5,6,7,8,9,10,11,12,1,2,3];
        const checkboxWrap = document.createElement('div');
        checkboxWrap.style.cssText = 'display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:20px;';
        monthOrder.forEach(m => {
            const label = document.createElement('label');
            label.style.cssText = 'display:flex; align-items:center; gap:6px; padding:8px; border:1px solid #ddd; border-radius:4px; cursor:pointer; font-size:14px;';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = m;
            cb.className = 'rpt-month-cb';
            label.appendChild(cb);
            label.appendChild(document.createTextNode(m + '月'));
            checkboxWrap.appendChild(label);
        });
        modal.appendChild(checkboxWrap);

        // ボタン群
        const btnWrap = document.createElement('div');
        btnWrap.style.cssText = 'display:flex; gap:8px; justify-content:flex-end;';

        const cancelBtn = document.createElement('button');
        cancelBtn.innerText = 'キャンセル';
        cancelBtn.style.cssText = 'padding:8px 16px; background:#ccc; border:none; border-radius:4px; cursor:pointer;';
        cancelBtn.onclick = function() { overlay.remove(); };
        btnWrap.appendChild(cancelBtn);

        const okBtn = document.createElement('button');
        okBtn.innerText = '保存';
        okBtn.style.cssText = 'padding:8px 16px; background:#8e44ad; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold;';
        okBtn.onclick = function() {
            const checked = Array.from(document.querySelectorAll('.rpt-month-cb:checked')).map(cb => parseInt(cb.value, 10));
            if (checked.length === 0) {
                alert('少なくとも1つの月を選択してください。');
                return;
            }
            overlay.remove();
            (async function() {
                try {
                    await saveFinalReport(year, month, checked);
                } catch (e) {
                    console.error('🚨 累計保存エラー:', e);
                    alert('エラーが発生しました:\n' + describeError(e));
                }
            })();
        };
        btnWrap.appendChild(okBtn);

        modal.appendChild(btnWrap);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    }

    // ============================================================
    // 月次保存：現在レコードの単月Excel + PDF を保存（同名は上書き）
    // ============================================================
    async function saveMonthReport(year, month) {
        if (!year || !month) throw new Error('「年度」と「月」を入力してから実行してください。');

        const appId = kintone.app.getId();
        const recordId = kintone.app.record.getId();
        const rec = await fetchSingleRecordFull(appId, recordId);

        // 原本テンプレート（月次用）をレコード1の「原本」フィールドから取得
        const templateBuffer = await fetchTemplateArrayBuffer('月次');

        // Excel生成
        const { buffer, sheetData } = await buildSingleMonthWorkbook(templateBuffer, rec, year, month);
        const excelName = `3町報告${year}${pad2(month)}.xlsx`;

        // PDF生成
        const pdfBlob = await buildPdfFromSheetData(sheetData, year, month);
        const pdfName = `3町報告${year}${pad2(month)}.pdf`;

        // 同名上書きで保存（Excel/PDF両方）
        await saveFilesToRecord(appId, recordId, [
            { buffer: buffer, name: excelName, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
            { buffer: pdfBlob, name: pdfName, mime: 'application/pdf' }
        ], true);

        alert(`✅ ${month}月分の報告書(Excel+PDF)を保存しました！\nページを再読み込みして確認してください。`);
        location.reload();
    }

    // ============================================================
    // 累計保存：選択月を含むファイル名で、累計Excelを保存（上書きしない）
    // ============================================================
    async function saveFinalReport(year, month, selectedMonths) {
        const appId = kintone.app.getId();
        const recordId = kintone.app.record.getId();

        // 累計値はボタンを押した現在のレコードの累計フィールドを使う
        const rec = await fetchSingleRecordFull(appId, recordId);

        // 講演会・ペアトレ/ペアプロ・アウトリーチは年度内の全レコードから集約する
        const kouenRowsAll = await fetchAllYearKouenkai(appId, year);
        const pairEvents = await fetchAllYearPairEvents(appId, year);
        const outreachAll = await fetchAllYearOutreachAll(appId, year);

        // 選択月の表記（連続なら範囲、離れていれば列挙）
        const monthLabel = formatMonthRangeLabel(selectedMonths);

        // 原本テンプレート（累計用）をレコード1の「原本」フィールドから取得
        const templateBuffer = await fetchTemplateArrayBuffer('年間', '累計');

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(templateBuffer);

        const ws = workbook.getWorksheet('最終報告');
        if (!ws) throw new Error('テンプレートに「最終報告」シートが見つかりません。');

        const sheetData = writeFinalReportSheet(ws, rec, year, kouenRowsAll, monthLabel, pairEvents, outreachAll);

        const outBuffer = await workbook.xlsx.writeBuffer();

        // ファイル名「累計3町報告2026 07 08 09」形式（選択月をスペース区切りで2桁、先頭に「累計」）
        const sortedMonths = sortMonthsByFiscal(selectedMonths);
        const monthStr = sortedMonths.map(m => pad2(m)).join(' ');
        const excelName = `累計3町報告${year} ${monthStr}.xlsx`;

        // PDF生成
        const pdfBlob = await buildFinalPdfFromSheetData(sheetData, year, monthLabel);
        const pdfName = `累計3町報告${year} ${monthStr}.pdf`;

        // 累計は上書きしない（常に追加）、保存先はボタンを押したレコード自身
        await saveFilesToRecord(appId, recordId, [
            { buffer: outBuffer, name: excelName, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
            { buffer: pdfBlob, name: pdfName, mime: 'application/pdf' }
        ], false);

        alert(`✅ 累計報告(Excel+PDF)を保存しました！\nファイル名: ${excelName}`);
        location.reload();
    }

    // 年度順（4月始まり）に月をソート
    function sortMonthsByFiscal(months) {
        const order = { 4:0,5:1,6:2,7:3,8:4,9:5,10:6,11:7,12:8,1:9,2:10,3:11 };
        return months.slice().sort((a, b) => order[a] - order[b]);
    }

    // ============================================================
    // レコード1の「原本」フィールドから、ファイル名にキーワードを含む
    // テンプレートファイルを探し、そのArrayBufferを返す
    // ============================================================
    async function fetchTemplateArrayBuffer() {
        const keywords = Array.prototype.slice.call(arguments);
        const appId = kintone.app.getId();

        const resp = await kintone.api(kintone.api.url('/k/v1/record', true), 'GET', {
            app: appId, id: TEMPLATE_RECORD_ID
        });
        const files = (resp.record[TEMPLATE_FIELD_CODE] && resp.record[TEMPLATE_FIELD_CODE].value) ? resp.record[TEMPLATE_FIELD_CODE].value : [];
        if (files.length === 0) {
            throw new Error(`レコード${TEMPLATE_RECORD_ID}の「${TEMPLATE_FIELD_CODE}」フィールドに原本ファイルが見つかりません。`);
        }

        const found = files.find(f => keywords.some(k => f.name.indexOf(k) !== -1));
        if (!found) {
            throw new Error(`レコード${TEMPLATE_RECORD_ID}の「${TEMPLATE_FIELD_CODE}」フィールドに、ファイル名に「${keywords.join('」または「')}」を含む原本が見つかりません。`);
        }

        const url = kintone.api.url('/k/v1/file.json', true) + '?fileKey=' + encodeURIComponent(found.fileKey);
        const fileResp = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!fileResp.ok) throw new Error(`原本ファイル「${found.name}」の取得に失敗しました。`);
        return await fileResp.arrayBuffer();
    }

    // ============================================================
    // 単月シートのワークブック構築 + PDF用データ抽出
    // ============================================================
    async function buildSingleMonthWorkbook(templateBuffer, rec, year, month) {
        const srcWorkbook = new ExcelJS.Workbook();
        await srcWorkbook.xlsx.load(templateBuffer);

        // 新テンプレートは月次シートを1つだけ持つ構成のため、常に先頭シートを使う
        let srcSheet = srcWorkbook.getWorksheet(String(month));
        if (!srcSheet) {
            srcSheet = srcWorkbook.worksheets[0];
            if (!srcSheet) throw new Error('テンプレートにシートが見つかりません。');
        }

        const newWorkbook = new ExcelJS.Workbook();
        const dstSheet = copySheet(newWorkbook, srcSheet, `${month}月分`);
        dstSheet.getCell('A1').value = `${month}`;

        const sheetData = writeMonthSheet(dstSheet, rec, year, month);

        const buffer = await newWorkbook.xlsx.writeBuffer();
        return { buffer: buffer, sheetData: sheetData };
    }

    // シートを別ワークブックへ複製
    function copySheet(destWorkbook, srcSheet, newName) {
        const dst = destWorkbook.addWorksheet(newName, {
            properties: srcSheet.properties,
            pageSetup: srcSheet.pageSetup,
            views: srcSheet.views
        });
        srcSheet.columns.forEach((col, i) => {
            if (col && col.width) dst.getColumn(i + 1).width = col.width;
        });
        srcSheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
            const newRow = dst.getRow(rowNumber);
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                const newCell = newRow.getCell(colNumber);
                newCell.value = cell.value;
                if (cell.style) newCell.style = JSON.parse(JSON.stringify(cell.style));
            });
            if (row.height) newRow.height = row.height;
        });
        (srcSheet.model.merges || []).forEach(m => {
            try { dst.mergeCells(m); } catch (e) { /* 重複は無視 */ }
        });
        return dst;
    }

    // ============================================================
    // 1ヶ月分のシートへデータを書き込む（戻り値: PDF生成用データ）
    // ============================================================
    function writeMonthSheet(ws, rec, year, month) {
        ws.getCell('B1').value = `${year}年度　${month}月　多気郡地域児童発達支援センター　実績`;

        const sheetData = { month: month, jihatsu: {}, houmon: {}, soudan: {}, pairPro: [], pairTra: [], outreach: {}, kouenkai: [] };

        // 児童発達支援（各ブロック合計行・多気郡合計行も直接計算して書き込む）
        const jVals = {};
        JIHATSU_BLOCKS.forEach(b => {
            sheetData.jihatsu[b.area] = [];
            jVals[b.area] = {};
            let sumJ = 0, sumE = 0;
            JIHATSU_GRADES.forEach((g, i) => {
                const row = b.startRow + i;
                const jitsu = getNum(rec, `${b.area}児発_${g}_実人数`);
                const enken = getNum(rec, `${b.area}児発_${g}_延件数`);
                jVals[b.area][g] = { jitsu, enken };
                ws.getCell('C' + row).value = jitsu;
                ws.getCell('D' + row).value = enken;
                sheetData.jihatsu[b.area].push({ grade: g, jitsu, enken });
                sumJ += jitsu; sumE += enken;
            });
            ws.getCell('C' + (b.startRow + 5)).value = sumJ;
            ws.getCell('D' + (b.startRow + 5)).value = sumE;
        });
        // 多気郡合計（明和+多気+大台）行26-31
        JIHATSU_GRADES.forEach((g, i) => {
            const row = 26 + i;
            ws.getCell('C' + row).value = (jVals['明和'][g].jitsu||0)+(jVals['多気'][g].jitsu||0)+(jVals['大台'][g].jitsu||0);
            ws.getCell('D' + row).value = (jVals['明和'][g].enken||0)+(jVals['多気'][g].enken||0)+(jVals['大台'][g].enken||0);
        });
        let gsj = 0, gse = 0;
        JIHATSU_GRADES.forEach(g => {
            gsj += (jVals['明和'][g].jitsu||0)+(jVals['多気'][g].jitsu||0)+(jVals['大台'][g].jitsu||0);
            gse += (jVals['明和'][g].enken||0)+(jVals['多気'][g].enken||0)+(jVals['大台'][g].enken||0);
        });
        ws.getCell('C31').value = gsj;
        ws.getCell('D31').value = gse;
        // PDF用データにも多気郡合計を追加
        sheetData.jihatsu['多気郡'] = JIHATSU_GRADES.map(g => ({
            grade: g,
            jitsu: (jVals['明和'][g].jitsu||0)+(jVals['多気'][g].jitsu||0)+(jVals['大台'][g].jitsu||0),
            enken: (jVals['明和'][g].enken||0)+(jVals['多気'][g].enken||0)+(jVals['大台'][g].enken||0)
        }));

        // 保育所等訪問支援（各ブロック合計行・多気郡合計行も直接計算して書き込む）
        const hVals = {};
        HOUMON_BLOCKS.forEach(b => {
            sheetData.houmon[b.area] = [];
            hVals[b.area] = {};
            let sumJ = 0, sumE = 0;
            HOUMON_GRADES.forEach((g, i) => {
                const row = b.startRow + i;
                const jitsu = getNum(rec, `${b.area}訪問_${g}_実人数`);
                const enken = getNum(rec, `${b.area}訪問_${g}_延件数`);
                hVals[b.area][g] = { jitsu, enken };
                ws.getCell('G' + row).value = jitsu;
                ws.getCell('H' + row).value = enken;
                sheetData.houmon[b.area].push({ grade: g, jitsu, enken });
                sumJ += jitsu; sumE += enken;
            });
            ws.getCell('G' + (b.startRow + 5)).value = sumJ;
            ws.getCell('H' + (b.startRow + 5)).value = sumE;
        });
        HOUMON_GRADES.forEach((g, i) => {
            const row = 26 + i;
            ws.getCell('G' + row).value = (hVals['明和'][g].jitsu||0)+(hVals['多気'][g].jitsu||0)+(hVals['大台'][g].jitsu||0);
            ws.getCell('H' + row).value = (hVals['明和'][g].enken||0)+(hVals['多気'][g].enken||0)+(hVals['大台'][g].enken||0);
        });
        let ghj = 0, ghe = 0;
        HOUMON_GRADES.forEach(g => {
            ghj += (hVals['明和'][g].jitsu||0)+(hVals['多気'][g].jitsu||0)+(hVals['大台'][g].jitsu||0);
            ghe += (hVals['明和'][g].enken||0)+(hVals['多気'][g].enken||0)+(hVals['大台'][g].enken||0);
        });
        ws.getCell('G31').value = ghj;
        ws.getCell('H31').value = ghe;
        // PDF用データにも多気郡合計を追加
        sheetData.houmon['多気郡'] = HOUMON_GRADES.map(g => ({
            grade: g,
            jitsu: (hVals['明和'][g].jitsu||0)+(hVals['多気'][g].jitsu||0)+(hVals['大台'][g].jitsu||0),
            enken: (hVals['明和'][g].enken||0)+(hVals['多気'][g].enken||0)+(hVals['大台'][g].enken||0)
        }));

        // 専門相談（外来）：当月テーブルから町別集計（各ブロック合計行・多気郡合計行も直接計算）
        const soudanSum = { '明和': [0,0,0,0,0], '多気': [0,0,0,0,0], '大台': [0,0,0,0,0] };
        const soudanTable = rec['専門相談'] && rec['専門相談'].value ? rec['専門相談'].value : [];
        soudanTable.forEach(row => {
            const area = townToArea[row.value['町名外来'] ? row.value['町名外来'].value : ''];
            if (!area) return;
            SOUDAN_TYPES.forEach((t, i) => {
                soudanSum[area][i] += parseInt(row.value[t] ? row.value[t].value || 0 : 0, 10);
            });
        });
        SOUDAN_BLOCKS.forEach(b => {
            sheetData.soudan[b.area] = [];
            let sumV = 0;
            SOUDAN_TYPES.forEach((t, i) => {
                ws.getCell('K' + (b.startRow + i)).value = soudanSum[b.area][i];
                sheetData.soudan[b.area].push({ type: t, val: soudanSum[b.area][i] });
                sumV += soudanSum[b.area][i];
            });
            ws.getCell('K' + (b.startRow + 5)).value = sumV;
        });
        SOUDAN_TYPES.forEach((t, i) => {
            const row = 26 + i;
            ws.getCell('K' + row).value = (soudanSum['明和'][i]||0)+(soudanSum['多気'][i]||0)+(soudanSum['大台'][i]||0);
        });
        let gsv = 0;
        SOUDAN_TYPES.forEach((t, i) => { gsv += (soudanSum['明和'][i]||0)+(soudanSum['多気'][i]||0)+(soudanSum['大台'][i]||0); });
        ws.getCell('K31').value = gsv;
        // PDF用データにも多気郡合計を追加
        sheetData.soudan['多気郡'] = SOUDAN_TYPES.map((t, i) => ({
            type: t,
            val: (soudanSum['明和'][i]||0)+(soudanSum['多気'][i]||0)+(soudanSum['大台'][i]||0)
        }));

        // ふれあいペアプロ A42-43日付, B42-43人数（合計行B44も直接計算）
        const pairProRows = collectDateCountRows(rec, 'ペアプロ', 'ペアプロ日付', 'ペアプロ利用人数');
        pairProRows.forEach((r, i) => {
            if (i >= 2) return;
            if (r.date) { const c = ws.getCell('A' + (42+i)); c.value = toDate(r.date); c.numFmt = 'm"月"d"日"'; }
            ws.getCell('B' + (42+i)).value = r.count;
        });
        ws.getCell('B44').value = pairProRows.reduce((s, r) => s + r.count, 0);
        sheetData.pairPro = pairProRows.slice(0, 2);

        // ペアトレ G42-43日付, H42-43人数（合計行H44も直接計算）
        const pairTraRows = collectDateCountRows(rec, 'ペアトレ', 'ペアトレ日付', 'ペアトレ利用人数');
        pairTraRows.forEach((r, i) => {
            if (i >= 2) return;
            if (r.date) { const c = ws.getCell('G' + (42+i)); c.value = toDate(r.date); c.numFmt = 'm"月"d"日"'; }
            ws.getCell('H' + (42+i)).value = r.count;
        });
        ws.getCell('H44').value = pairTraRows.reduce((s, r) => s + r.count, 0);
        sheetData.pairTra = pairTraRows.slice(0, 2);

        // アウトリーチ B列日付, C列内容（各町3行まで）
        const outByTown = { '明和町': [], '多気町': [], '大台町': [] };
        const outTable = rec['アウトリーチ'] && rec['アウトリーチ'].value ? rec['アウトリーチ'].value : [];
        outTable.forEach(row => {
            const town = row.value['町名アウトリーチ'] ? row.value['町名アウトリーチ'].value : '';
            const dateVal = row.value['日付アウトリーチ'] ? row.value['日付アウトリーチ'].value : '';
            const jigyou = row.value['事業名アウトリーチ'] ? row.value['事業名アウトリーチ'].value : '';
            if (outByTown[town]) outByTown[town].push({ date: dateVal || '', jigyou: jigyou || '' });
        });
        Object.keys(OUT_BLOCKS).forEach(town => {
            const rows = outByTown[town];
            rows.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
            for (let i = 0; i < 3; i++) {
                const rowNum = OUT_BLOCKS[town] + i;
                if (i < rows.length) {
                    const r = rows[i];
                    if (r.date) { const c = ws.getCell('B' + rowNum); c.value = toDate(r.date); c.numFmt = 'm"月"d"日"'; }
                    ws.getCell('C' + rowNum).value = r.jigyou;
                } else {
                    ws.getCell('C' + rowNum).value = null;
                }
            }
            sheetData.outreach[town] = rows.slice(0, 3);
        });

        // 講演会（主催）A60-61日付, B60-61内容, K60-61人数
        const kouenkaiRows = [];
        const kouenTable = rec['講演会'] && rec['講演会'].value ? rec['講演会'].value : [];
        kouenTable.forEach(row => {
            const dateVal = row.value['日付講演会'] ? row.value['日付講演会'].value : '';
            const titleVal = row.value['タイトル'] ? row.value['タイトル'].value : '';
            const count = row.value['参加人数'] ? parseInt(row.value['参加人数'].value || 0, 10) : 0;
            if (dateVal || titleVal || count > 0) kouenkaiRows.push({ date: dateVal || '', title: titleVal || '', count: count });
        });
        kouenkaiRows.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
        for (let i = 0; i < 2; i++) {
            const rowNum = 60 + i;
            if (i < kouenkaiRows.length) {
                const r = kouenkaiRows[i];
                if (r.date) { const c = ws.getCell('A' + rowNum); c.value = toDate(r.date); c.numFmt = 'm"月"d"日"'; }
                ws.getCell('B' + rowNum).value = r.title;
                ws.getCell('K' + rowNum).value = r.count;
            } else {
                ws.getCell('B' + rowNum).value = null;
            }
        }
        // 合計行K62（テンプレはSUM(K61:K61)だが実データ2行なので直接計算で上書き）
        ws.getCell('K62').value = kouenkaiRows.slice(0, 2).reduce((s, r) => s + r.count, 0);
        sheetData.kouenkai = kouenkaiRows.slice(0, 2);

        return sheetData;
    }

    // ============================================================
    // 最終報告シートへの書き込み（数式非依存・全て確定値を直接上書き）
    // ============================================================
    function writeFinalReportSheet(ws, rec, year, kouenRowsAll, monthLabel, pairEvents, outreachAll) {
        ws.getCell('B1').value = `令和${toReiwa(year)}年度　多気郡地域児童発達支援センター　実績（${monthLabel}）`;

        // 児発
        const jVals = {};
        JIHATSU_BLOCKS.forEach(b => {
            jVals[b.area] = {};
            let sj = 0, se = 0;
            JIHATSU_GRADES.forEach((g, i) => {
                const row = b.startRow + i;
                const jitsu = getNum(rec, `累計_${b.area}児発_${g}_実人数`);
                const enken = getNum(rec, `累計_${b.area}児発_${g}_延件数`);
                jVals[b.area][g] = { jitsu, enken };
                ws.getCell('C' + row).value = jitsu;
                ws.getCell('D' + row).value = enken;
                sj += jitsu; se += enken;
            });
            ws.getCell('C' + (b.startRow + 5)).value = sj;
            ws.getCell('D' + (b.startRow + 5)).value = se;
        });
        JIHATSU_GRADES.forEach((g, i) => {
            const row = 26 + i;
            ws.getCell('C' + row).value = (jVals['明和'][g].jitsu||0)+(jVals['多気'][g].jitsu||0)+(jVals['大台'][g].jitsu||0);
            ws.getCell('D' + row).value = (jVals['明和'][g].enken||0)+(jVals['多気'][g].enken||0)+(jVals['大台'][g].enken||0);
        });
        let gsj = 0, gse = 0;
        JIHATSU_GRADES.forEach(g => {
            gsj += (jVals['明和'][g].jitsu||0)+(jVals['多気'][g].jitsu||0)+(jVals['大台'][g].jitsu||0);
            gse += (jVals['明和'][g].enken||0)+(jVals['多気'][g].enken||0)+(jVals['大台'][g].enken||0);
        });
        ws.getCell('C31').value = gsj;
        ws.getCell('D31').value = gse;
        let mj = 0, me = 0;
        JIHATSU_GRADES.forEach(g => { mj += jVals['松阪'][g].jitsu||0; me += jVals['松阪'][g].enken||0; });
        ws.getCell('C38').value = mj;
        ws.getCell('D38').value = me;

        // 訪問
        const hVals = {};
        HOUMON_BLOCKS.forEach(b => {
            hVals[b.area] = {};
            let sj = 0, se = 0;
            HOUMON_GRADES.forEach((g, i) => {
                const row = b.startRow + i;
                const jitsu = getNum(rec, `累計_${b.area}訪問_${g}_実人数`);
                const enken = getNum(rec, `累計_${b.area}訪問_${g}_延件数`);
                hVals[b.area][g] = { jitsu, enken };
                ws.getCell('G' + row).value = jitsu;
                ws.getCell('H' + row).value = enken;
                sj += jitsu; se += enken;
            });
            ws.getCell('G' + (b.startRow + 5)).value = sj;
            ws.getCell('H' + (b.startRow + 5)).value = se;
        });
        HOUMON_GRADES.forEach((g, i) => {
            const row = 26 + i;
            ws.getCell('G' + row).value = (hVals['明和'][g].jitsu||0)+(hVals['多気'][g].jitsu||0)+(hVals['大台'][g].jitsu||0);
            ws.getCell('H' + row).value = (hVals['明和'][g].enken||0)+(hVals['多気'][g].enken||0)+(hVals['大台'][g].enken||0);
        });
        let ghj = 0, ghe = 0;
        HOUMON_GRADES.forEach(g => {
            ghj += (hVals['明和'][g].jitsu||0)+(hVals['多気'][g].jitsu||0)+(hVals['大台'][g].jitsu||0);
            ghe += (hVals['明和'][g].enken||0)+(hVals['多気'][g].enken||0)+(hVals['大台'][g].enken||0);
        });
        ws.getCell('G31').value = ghj;
        ws.getCell('H31').value = ghe;

        // 専門相談
        const sVals = {};
        SOUDAN_BLOCKS.forEach(b => {
            sVals[b.area] = {};
            let sv = 0;
            SOUDAN_TYPES.forEach((t, i) => {
                const row = b.startRow + i;
                const val = getNum(rec, `累計_${b.area}専門相談_${t}`);
                sVals[b.area][t] = val;
                ws.getCell('K' + row).value = val;
                ws.getCell('L' + row).value = val;
                sv += val;
            });
            ws.getCell('K' + (b.startRow + 5)).value = sv;
            ws.getCell('L' + (b.startRow + 5)).value = sv;
        });
        SOUDAN_TYPES.forEach((t, i) => {
            const row = 26 + i;
            const val = (sVals['明和'][t]||0)+(sVals['多気'][t]||0)+(sVals['大台'][t]||0);
            ws.getCell('K' + row).value = val;
            ws.getCell('L' + row).value = val;
        });
        let gsv = 0;
        SOUDAN_TYPES.forEach(t => { gsv += (sVals['明和'][t]||0)+(sVals['多気'][t]||0)+(sVals['大台'][t]||0); });
        ws.getCell('K31').value = gsv;
        ws.getCell('L31').value = gsv;

        // 地域講演会（累計）O19-20日付, P19-20内容, AA19-20人数
        // 年度内の全レコードから集約した講演会一覧をそのまま使う（3月単体ではない）
        const kouenRows = (kouenRowsAll || []).slice();
        kouenRows.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
        for (let i = 0; i < 2; i++) {
            const rowNum = 19 + i;
            if (i < kouenRows.length) {
                const r = kouenRows[i];
                if (r.date) { const c = ws.getCell('O' + rowNum); c.value = toDate(r.date); c.numFmt = 'm/d;@'; }
                ws.getCell('P' + rowNum).value = r.title;
                ws.getCell('AA' + rowNum).value = r.count;
            } else {
                ws.getCell('P' + rowNum).value = null;
            }
        }
        ws.getCell('AA21').value = kouenRows.reduce((s, r) => s + r.count, 0);
        if (kouenRows.length > 2) {
            console.warn(`⚠️ 講演会が年度内で${kouenRows.length}件あり、最終報告シートの枠(2行)を超えています。3件目以降は表として表示されませんが、合計人数(AA21)には全件分を反映しています。`);
        }

        // ペアレント・トレーニング（累計）O列=日付(行6-11、6行)、P=明和、Q=多気、R=大台、S=その他、T=合計
        const pairTraRows = (pairEvents && pairEvents.pairTra) ? pairEvents.pairTra : [];
        let traGrandTotal = 0;
        for (let i = 0; i < 6; i++) {
            const row = 6 + i;
            if (i < pairTraRows.length) {
                const r = pairTraRows[i];
                const total = (r.mei||0) + (r.taki||0) + (r.oodai||0);
                if (r.date) { const c = ws.getCell('O' + row); c.value = toDate(r.date); c.numFmt = 'm/d;@'; }
                ws.getCell('P' + row).value = r.mei || 0;
                ws.getCell('Q' + row).value = r.taki || 0;
                ws.getCell('R' + row).value = r.oodai || 0;
                ws.getCell('S' + row).value = 0;
                ws.getCell('T' + row).value = total;
                traGrandTotal += total;
            } else {
                ws.getCell('P' + row).value = null;
            }
        }
        ws.getCell('T12').value = traGrandTotal;
        if (pairTraRows.length > 6) {
            console.warn(`⚠️ ペアレント・トレーニングが年度内で${pairTraRows.length}件あり、最終報告シートの枠(6行)を超えています。`);
        }

        // ふれあいペアレントプログラム（累計）V列=日付(行6-14、9行)、W=明和、X=多気、Y=大台、Z=その他、AA=合計
        const pairProRows = (pairEvents && pairEvents.pairPro) ? pairEvents.pairPro : [];
        let proGrandTotal = 0;
        for (let i = 0; i < 9; i++) {
            const row = 6 + i;
            if (i < pairProRows.length) {
                const r = pairProRows[i];
                const total = (r.mei||0) + (r.taki||0) + (r.oodai||0);
                if (r.date) { const c = ws.getCell('V' + row); c.value = toDate(r.date); c.numFmt = 'm/d;@'; }
                ws.getCell('W' + row).value = r.mei || 0;
                ws.getCell('X' + row).value = r.taki || 0;
                ws.getCell('Y' + row).value = r.oodai || 0;
                ws.getCell('Z' + row).value = 0;
                ws.getCell('AA' + row).value = total;
                proGrandTotal += total;
            } else {
                ws.getCell('W' + row).value = null;
            }
        }
        ws.getCell('AA15').value = proGrandTotal;
        if (pairProRows.length > 9) {
            console.warn(`⚠️ ふれあいペアレントプログラムが年度内で${pairProRows.length}件あり、最終報告シートの枠(9行)を超えています。`);
        }

        // 専門相談（アウトリーチ、累計）：町ごとに実際の事業名を出現順に枠へ割り当て、
        // Q-AA列(11列)×2行に日付を横並びで格納する（文言の完全一致に依存しない）
        const outAll = outreachAll || [];
        const outreachSheetData = {}; // PDF用: 町名 -> 事業名 -> [date, ...]（動的に決定した事業名で構築）
        const dateCols = ['Q','R','S','T','U','V','W','X','Y','Z','AA']; // 11列

        Object.keys(FINAL_OUTREACH_SLOTS).forEach(town => {
            const slots = FINAL_OUTREACH_SLOTS[town];
            outreachSheetData[town] = {};

            // その町で実際に登場した事業名を、初出順に一覧化
            const jigyouList = [];
            outAll.forEach(r => {
                if (r.town === town && jigyouList.indexOf(r.jigyou) === -1) jigyouList.push(r.jigyou);
            });

            slots.forEach((startRow, slotIdx) => {
                const jigyou = jigyouList[slotIdx];
                if (!jigyou) {
                    // 使わない枠は内容・日付ともに空にする
                    ws.getCell('P' + startRow).value = null;
                    for (let i = 0; i < 11; i++) {
                        ws.getCell(dateCols[i] + startRow).value = null;
                        ws.getCell(dateCols[i] + (startRow + 1)).value = null;
                    }
                    return;
                }
                ws.getCell('P' + startRow).value = jigyou;
                const dates = outAll.filter(r => r.town === town && r.jigyou === jigyou).map(r => r.date).sort();
                outreachSheetData[town][jigyou] = dates;

                for (let i = 0; i < 11; i++) {
                    const cell = ws.getCell(dateCols[i] + startRow);
                    if (i < dates.length) { cell.value = toDate(dates[i]); cell.numFmt = 'm/d;@'; } else { cell.value = null; }
                }
                for (let i = 0; i < 11; i++) {
                    const cell = ws.getCell(dateCols[i] + (startRow + 1));
                    const idx = 11 + i;
                    if (idx < dates.length) { cell.value = toDate(dates[idx]); cell.numFmt = 'm/d;@'; } else { cell.value = null; }
                }
                if (dates.length > 22) {
                    console.warn(`⚠️ アウトリーチ「${town} / ${jigyou}」が年度内で${dates.length}件あり、枠(22件)を超えています。`);
                }
            });

            if (jigyouList.length > slots.length) {
                const overflow = jigyouList.slice(slots.length);
                console.warn(`⚠️ アウトリーチ「${town}」の事業種類数が${jigyouList.length}件あり、枠(${slots.length}件)を超えています。反映されなかった事業: ${overflow.join('、')}`);
            }
        });

        // PDF生成用データを構築して返す
        const sheetData = { jihatsu: {}, houmon: {}, soudan: {}, pairTra: {}, pairPro: {}, kouenkai: kouenRows };
        ['明和', '多気', '大台', '松阪'].forEach(area => {
            sheetData.jihatsu[area] = JIHATSU_GRADES.map(g => ({ grade: g, jitsu: jVals[area][g].jitsu||0, enken: jVals[area][g].enken||0 }));
        });
        sheetData.jihatsu['多気郡'] = JIHATSU_GRADES.map(g => ({
            grade: g,
            jitsu: (jVals['明和'][g].jitsu||0)+(jVals['多気'][g].jitsu||0)+(jVals['大台'][g].jitsu||0),
            enken: (jVals['明和'][g].enken||0)+(jVals['多気'][g].enken||0)+(jVals['大台'][g].enken||0)
        }));
        ['明和', '多気', '大台'].forEach(area => {
            sheetData.houmon[area] = HOUMON_GRADES.map(g => ({ grade: g, jitsu: hVals[area][g].jitsu||0, enken: hVals[area][g].enken||0 }));
            sheetData.soudan[area] = SOUDAN_TYPES.map(t => ({ type: t, val: sVals[area][t]||0 }));
        });
        sheetData.houmon['多気郡'] = HOUMON_GRADES.map(g => ({
            grade: g,
            jitsu: (hVals['明和'][g].jitsu||0)+(hVals['多気'][g].jitsu||0)+(hVals['大台'][g].jitsu||0),
            enken: (hVals['明和'][g].enken||0)+(hVals['多気'][g].enken||0)+(hVals['大台'][g].enken||0)
        }));
        sheetData.soudan['多気郡'] = SOUDAN_TYPES.map(t => ({
            type: t,
            val: (sVals['明和'][t]||0)+(sVals['多気'][t]||0)+(sVals['大台'][t]||0)
        }));
        sheetData.pairTra = pairTraRows;
        sheetData.pairPro = pairProRows;

        // アウトリーチ（累計）のPDF表示用データ（既に動的割当で計算済み）
        sheetData.outreach = outreachSheetData;

        return sheetData;
    }

    function toReiwa(year) { return year - 2018; }

    // ============================================================
    // PDF生成：月次データからA4縦の印刷用HTMLを組み、画像化してPDF Blobを返す
    // ============================================================
    async function buildPdfFromSheetData(sd, year, month) {
        // A4縦を想定した幅（96dpi基準で約794px）のoff-screen要素を作る
        const container = document.createElement('div');
        container.style.cssText = 'position:fixed; left:-9999px; top:0; width:794px; background:white; padding:24px; font-family:"Yu Gothic","Hiragino Kaku Gothic ProN",sans-serif; color:#000; box-sizing:border-box;';
        container.innerHTML = buildReportHtml(sd, year, month);
        document.body.appendChild(container);

        try {
            // 高解像度（scale:2 ≒ 150dpi超）で画像化
            const canvas = await html2canvas(container, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
            const imgData = canvas.toDataURL('image/png');

            const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : window.jsPDF;
            const pdf = new jsPDFCtor({ orientation: 'portrait', unit: 'mm', format: 'a4' });

            const pageW = 210, pageH = 297;
            const imgW = pageW;
            const imgH = (canvas.height * imgW) / canvas.width;

            if (imgH <= pageH) {
                pdf.addImage(imgData, 'PNG', 0, 0, imgW, imgH);
            } else {
                // 高さがA4を超える場合は複数ページに分割
                let remaining = imgH;
                let position = 0;
                while (remaining > 0) {
                    pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH);
                    remaining -= pageH;
                    if (remaining > 0) { pdf.addPage(); position -= pageH; }
                }
            }

            return pdf.output('arraybuffer');
        } finally {
            document.body.removeChild(container);
        }
    }

    // ============================================================
    // 累計報告PDF生成：最終報告データからA4縦の印刷用HTMLを組み、画像化してPDF Blobを返す
    // ============================================================
    async function buildFinalPdfFromSheetData(sd, year, monthLabel) {
        const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : window.jsPDF;
        const pdf = new jsPDFCtor({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageW = 210, pageH = 297;

        async function renderPage(htmlContent, isFirstPage) {
            const container = document.createElement('div');
            container.style.cssText = 'position:fixed; left:-9999px; top:0; width:794px; background:white; padding:24px; font-family:"Yu Gothic","Hiragino Kaku Gothic ProN",sans-serif; color:#000; box-sizing:border-box;';
            container.innerHTML = htmlContent;
            document.body.appendChild(container);
            try {
                const canvas = await html2canvas(container, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
                const imgData = canvas.toDataURL('image/png');
                const imgW = pageW;
                const imgH = (canvas.height * imgW) / canvas.width;
                if (!isFirstPage) pdf.addPage();
                if (imgH <= pageH) {
                    pdf.addImage(imgData, 'PNG', 0, 0, imgW, imgH);
                } else {
                    let remaining = imgH;
                    let position = 0;
                    let first = true;
                    while (remaining > 0) {
                        if (!first) pdf.addPage();
                        pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH);
                        remaining -= pageH;
                        position -= pageH;
                        first = false;
                    }
                }
            } finally {
                document.body.removeChild(container);
            }
        }

        await renderPage(buildFinalReportHtmlPage1(sd, year, monthLabel), true);
        await renderPage(buildFinalReportHtmlPage2(sd), false);

        return pdf.output('arraybuffer');
    }

    // 累計報告PDF 1ページ目：児童発達支援・保育所等訪問支援・専門相談（外来）
    function buildFinalReportHtmlPage1(sd, year, monthLabel) {
        const cellStyle = 'border:1px solid #333; padding:3px 6px; font-size:12px; text-align:center; white-space:nowrap;';
        const headStyle = 'border:1px solid #333; padding:3px 6px; font-size:12px; text-align:center; background:#f0f0f0; font-weight:bold; white-space:nowrap;';
        const labelStyle = 'border:1px solid #333; padding:3px 6px; font-size:12px; text-align:center; background:#fafafa; white-space:nowrap;';
        const areaOrderJihatsu = ['明和', '多気', '大台', '多気郡', '松阪'];
        const areaOrderHoumon = ['明和', '多気', '大台', '多気郡'];

        let html = `<div style="font-size:14.67px; font-weight:bold; text-align:center; margin-bottom:10px;">令和${toReiwa(year)}年度　多気郡地域児童発達支援センター　実績（${monthLabel}）</div>`;

        html += `<div style="display:flex; gap:8px; align-items:flex-start; margin-bottom:8px;">`;

        // 児童発達支援
        html += `<div style="flex:1.3;"><div style="font-size:14px; font-weight:bold; margin-bottom:4px;">児童発達支援</div>`;
        html += `<table style="border-collapse:collapse; width:100%;"><tr><th style="${headStyle}">市町</th><th style="${headStyle}">年齢</th><th style="${headStyle}">実人数</th><th style="${headStyle}">延件数</th></tr>`;
        areaOrderJihatsu.forEach(area => {
            const rows = sd.jihatsu[area] || [];
            let sumJ = 0, sumE = 0;
            rows.forEach((r, i) => {
                sumJ += r.jitsu; sumE += r.enken;
                html += `<tr>${i === 0 ? `<td style="${labelStyle}" rowspan="${rows.length + 1}">${area}${area === '多気郡' ? '' : '町'}</td>` : ''}<td style="${labelStyle}">${r.grade}</td><td style="${cellStyle}">${r.jitsu}</td><td style="${cellStyle}">${r.enken}</td></tr>`;
            });
            html += `<tr><td style="${labelStyle}">合計</td><td style="${cellStyle}">${sumJ}</td><td style="${cellStyle}">${sumE}</td></tr>`;
        });
        html += `</table></div>`;

        // 保育所等訪問支援
        html += `<div style="flex:1.1;"><div style="font-size:14px; font-weight:bold; margin-bottom:4px;">保育所等訪問支援</div>`;
        html += `<table style="border-collapse:collapse; width:100%;"><tr><th style="${headStyle}">市町</th><th style="${headStyle}">年齢</th><th style="${headStyle}">実人数</th><th style="${headStyle}">延件数</th></tr>`;
        areaOrderHoumon.forEach(area => {
            const rows = sd.houmon[area] || [];
            let sumJ = 0, sumE = 0;
            rows.forEach((r, i) => {
                sumJ += r.jitsu; sumE += r.enken;
                html += `<tr>${i === 0 ? `<td style="${labelStyle}" rowspan="${rows.length + 1}">${area}${area === '多気郡' ? '' : '町'}</td>` : ''}<td style="${labelStyle}">${r.grade}</td><td style="${cellStyle}">${r.jitsu}</td><td style="${cellStyle}">${r.enken}</td></tr>`;
            });
            html += `<tr><td style="${labelStyle}">合計</td><td style="${cellStyle}">${sumJ}</td><td style="${cellStyle}">${sumE}</td></tr>`;
        });
        html += `</table></div>`;

        // 専門相談（外来）
        html += `<div style="flex:0.9;"><div style="font-size:14px; font-weight:bold; margin-bottom:4px;">専門相談（外来）</div>`;
        html += `<table style="border-collapse:collapse; width:100%;"><tr><th style="${headStyle}">市町</th><th style="${headStyle}">手段</th><th style="${headStyle}">延件数</th></tr>`;
        areaOrderHoumon.forEach(area => {
            const rows = sd.soudan[area] || [];
            let sum = 0;
            rows.forEach((r, i) => {
                sum += r.val;
                html += `<tr>${i === 0 ? `<td style="${labelStyle}" rowspan="${rows.length + 1}">${area}${area === '多気郡' ? '' : '町'}</td>` : ''}<td style="${labelStyle}">${r.type}</td><td style="${cellStyle}">${r.val}</td></tr>`;
            });
            html += `<tr><td style="${labelStyle}">合計</td><td style="${cellStyle}">${sum}</td></tr>`;
        });
        html += `</table></div>`;

        html += `</div>`; // 上段3列横並び終了

        return html;
    }

    // 累計報告PDF 2ページ目：ペアレント・トレーニング／ふれあいペアレントプログラム（日付リスト）
    // ／講演会（主催）／専門相談（アウトリーチ、内容別に実施日を横並び表示）
    function buildFinalReportHtmlPage2(sd) {
        const cellStyle = 'border:1px solid #333; padding:3px 6px; font-size:12px; text-align:center; white-space:nowrap;';
        const headStyle = 'border:1px solid #333; padding:3px 6px; font-size:12px; text-align:center; background:#f0f0f0; font-weight:bold; white-space:nowrap;';
        const labelStyle = 'border:1px solid #333; padding:3px 6px; font-size:12px; text-align:center; background:#fafafa; white-space:nowrap;';

        let html = `<div style="display:flex; gap:8px; align-items:flex-start; margin-bottom:10px;">`;

        // ペアレント・トレーニング（日付＋町別人数のリスト）
        html += `<div style="flex:1;"><div style="font-size:14px; font-weight:bold; margin-bottom:4px;">ペアレント・トレーニング（全年齢）</div>`;
        html += `<table style="border-collapse:collapse; width:100%;"><tr><th style="${headStyle}">日付</th><th style="${headStyle}">明和</th><th style="${headStyle}">多気</th><th style="${headStyle}">大台</th><th style="${headStyle}">合計</th></tr>`;
        let traTotal = 0;
        const traRows = sd.pairTra || [];
        (traRows.length > 0 ? traRows : [{}]).forEach(r => {
            const total = (r.mei||0) + (r.taki||0) + (r.oodai||0);
            traTotal += total;
            html += `<tr><td style="${cellStyle}">${r.date ? formatDateSlash(r.date) : ''}</td><td style="${cellStyle}">${r.mei||0}</td><td style="${cellStyle}">${r.taki||0}</td><td style="${cellStyle}">${r.oodai||0}</td><td style="${cellStyle}">${total}</td></tr>`;
        });
        html += `<tr><td style="${labelStyle}" colspan="4">合計</td><td style="${cellStyle}">${traTotal}</td></tr>`;
        html += `</table></div>`;

        // ふれあいペアレントプログラム（日付＋町別人数のリスト）
        html += `<div style="flex:1;"><div style="font-size:14px; font-weight:bold; margin-bottom:4px;">ふれあいペアレントプログラム（0～4歳）</div>`;
        html += `<table style="border-collapse:collapse; width:100%;"><tr><th style="${headStyle}">日付</th><th style="${headStyle}">明和</th><th style="${headStyle}">多気</th><th style="${headStyle}">大台</th><th style="${headStyle}">合計</th></tr>`;
        let proTotal = 0;
        const proRows = sd.pairPro || [];
        (proRows.length > 0 ? proRows : [{}]).forEach(r => {
            const total = (r.mei||0) + (r.taki||0) + (r.oodai||0);
            proTotal += total;
            html += `<tr><td style="${cellStyle}">${r.date ? formatDateSlash(r.date) : ''}</td><td style="${cellStyle}">${r.mei||0}</td><td style="${cellStyle}">${r.taki||0}</td><td style="${cellStyle}">${r.oodai||0}</td><td style="${cellStyle}">${total}</td></tr>`;
        });
        html += `<tr><td style="${labelStyle}" colspan="4">合計</td><td style="${cellStyle}">${proTotal}</td></tr>`;
        html += `</table></div>`;

        html += `</div>`;

        // 講演会（主催）：年度内の全件を表示
        html += `<div style="font-size:14px; font-weight:bold; margin-bottom:4px;">地域講演会</div>`;
        html += `<table style="border-collapse:collapse; width:100%; margin-bottom:10px;"><tr><th style="${headStyle}">日付</th><th style="${headStyle}">内容</th><th style="${headStyle}">参加人数</th></tr>`;
        const kRows = (sd.kouenkai && sd.kouenkai.length > 0) ? sd.kouenkai : [{ date: '', title: '', count: '' }];
        let kTotal = 0;
        kRows.forEach(r => {
            kTotal += (typeof r.count === 'number' ? r.count : 0);
            html += `<tr><td style="${cellStyle}">${r.date ? formatDateSlash(r.date) : ''}</td><td style="${cellStyle} text-align:left; white-space:normal;">${escapeHtml(r.title)}</td><td style="${cellStyle}">${r.count}</td></tr>`;
        });
        html += `<tr><td style="${labelStyle}" colspan="2">合計</td><td style="${cellStyle}">${kTotal}</td></tr>`;
        html += `</table>`;

        // 専門相談（アウトリーチ）：町ごとに内容別の実施日を列挙
        html += `<div style="font-size:14px; font-weight:bold; margin-bottom:4px;">障害児相談支援事業（専門相談）　アウトリーチ</div>`;
        Object.keys(FINAL_OUTREACH_SLOTS).forEach(town => {
            html += `<div style="font-size:12.5px; font-weight:bold; margin:4px 0 2px;">${town}</div>`;
            html += `<table style="border-collapse:collapse; width:100%; margin-bottom:4px;"><tr><th style="${headStyle}" style="width:22%;">内容</th><th style="${headStyle}">実施日</th></tr>`;
            const contents = (sd.outreach && sd.outreach[town]) ? sd.outreach[town] : {};
            Object.keys(contents).forEach(jigyou => {
                const dates = contents[jigyou] || [];
                const dateStr = dates.length > 0 ? dates.map(d => formatDateSlash(d)).join('　') : '';
                html += `<tr><td style="${labelStyle} text-align:left;">${escapeHtml(jigyou)}</td><td style="${cellStyle} text-align:left; white-space:normal;">${escapeHtml(dateStr)}</td></tr>`;
            });
            html += `</table>`;
        });

        return html;
    }

    // 報告書のHTMLを組み立てる

    // 報告書のHTMLを組み立てる
    function buildReportHtml(sd, year, month) {
        // コンパクト表示用のスタイル（Excelの3列横並び構成をPDFでも再現し、A4 2枚以内に収める）
        const cellStyle = 'border:1px solid #333; padding:3px 6px; font-size:12px; text-align:center; white-space:nowrap;';
        const headStyle = 'border:1px solid #333; padding:3px 6px; font-size:12px; text-align:center; background:#f0f0f0; font-weight:bold; white-space:nowrap;';
        const labelStyle = 'border:1px solid #333; padding:3px 6px; font-size:12px; text-align:center; background:#fafafa; white-space:nowrap;';
        const areaOrderJihatsu = ['明和', '多気', '大台', '多気郡', '松阪'];
        const areaOrderHoumon = ['明和', '多気', '大台', '多気郡'];

        let html = `<div style="font-size:14.67px; font-weight:bold; text-align:center; margin-bottom:10px;">${year}年度　${month}月　多気郡地域児童発達支援センター　実績</div>`;

        // 児発・訪問・専門相談を横並び3列で表示（Excelのレイアウトを再現してコンパクト化）
        html += `<div style="display:flex; gap:8px; align-items:flex-start; margin-bottom:8px;">`;

        // 児童発達支援
        html += `<div style="flex:1.3;"><div style="font-size:14px; font-weight:bold; margin-bottom:4px;">児童発達支援</div>`;
        html += `<table style="border-collapse:collapse; width:100%;"><tr><th style="${headStyle}">市町</th><th style="${headStyle}">年齢</th><th style="${headStyle}">実人数</th><th style="${headStyle}">延件数</th></tr>`;
        areaOrderJihatsu.forEach(area => {
            const rows = sd.jihatsu[area] || [];
            let sumJ = 0, sumE = 0;
            rows.forEach((r, i) => {
                sumJ += r.jitsu; sumE += r.enken;
                html += `<tr>${i === 0 ? `<td style="${labelStyle}" rowspan="${rows.length + 1}">${area}${area === '多気郡' ? '' : '町'}</td>` : ''}<td style="${labelStyle}">${r.grade}</td><td style="${cellStyle}">${r.jitsu}</td><td style="${cellStyle}">${r.enken}</td></tr>`;
            });
            html += `<tr><td style="${labelStyle}">合計</td><td style="${cellStyle}">${sumJ}</td><td style="${cellStyle}">${sumE}</td></tr>`;
        });
        html += `</table></div>`;

        // 保育所等訪問支援
        html += `<div style="flex:1.1;"><div style="font-size:14px; font-weight:bold; margin-bottom:4px;">保育所等訪問支援</div>`;
        html += `<table style="border-collapse:collapse; width:100%;"><tr><th style="${headStyle}">市町</th><th style="${headStyle}">年齢</th><th style="${headStyle}">実人数</th><th style="${headStyle}">延件数</th></tr>`;
        areaOrderHoumon.forEach(area => {
            const rows = sd.houmon[area] || [];
            let sumJ = 0, sumE = 0;
            rows.forEach((r, i) => {
                sumJ += r.jitsu; sumE += r.enken;
                html += `<tr>${i === 0 ? `<td style="${labelStyle}" rowspan="${rows.length + 1}">${area}${area === '多気郡' ? '' : '町'}</td>` : ''}<td style="${labelStyle}">${r.grade}</td><td style="${cellStyle}">${r.jitsu}</td><td style="${cellStyle}">${r.enken}</td></tr>`;
            });
            html += `<tr><td style="${labelStyle}">合計</td><td style="${cellStyle}">${sumJ}</td><td style="${cellStyle}">${sumE}</td></tr>`;
        });
        html += `</table>`;

        // アウトリーチ（訪問支援の下、児発列(松阪町まで)より短いため右側の余白に収まる）
        html += `<div style="margin-top:4px;"><div style="font-size:13.33px; font-weight:bold; margin-bottom:3px;">専門相談（アウトリーチ）</div>`;
        html += `<table style="border-collapse:collapse; width:100%;"><tr><th style="${headStyle}">市町</th><th style="${headStyle}">日付</th><th style="${headStyle}">内容</th></tr>`;
        ['明和町', '多気町', '大台町'].forEach(town => {
            const rows = sd.outreach[town] || [];
            const displayRows = rows.length > 0 ? rows : [{ date: '', jigyou: '' }];
            displayRows.forEach((r, i) => {
                html += `<tr>${i === 0 ? `<td style="${labelStyle}" rowspan="${displayRows.length}">${town}</td>` : ''}<td style="${cellStyle}">${r.date ? formatDateJp(r.date) : ''}</td><td style="${cellStyle} text-align:left;">${escapeHtml(r.jigyou)}</td></tr>`;
            });
        });
        html += `</table></div>`;
        html += `</div>`;

        // 専門相談（外来）
        html += `<div style="flex:0.9;"><div style="font-size:14px; font-weight:bold; margin-bottom:4px;">専門相談（外来）</div>`;
        html += `<table style="border-collapse:collapse; width:100%;"><tr><th style="${headStyle}">市町</th><th style="${headStyle}">手段</th><th style="${headStyle}">延件数</th></tr>`;
        areaOrderHoumon.forEach(area => {
            const rows = sd.soudan[area] || [];
            let sum = 0;
            rows.forEach((r, i) => {
                sum += r.val;
                html += `<tr>${i === 0 ? `<td style="${labelStyle}" rowspan="${rows.length + 1}">${area}${area === '多気郡' ? '' : '町'}</td>` : ''}<td style="${labelStyle}">${r.type}</td><td style="${cellStyle}">${r.val}</td></tr>`;
            });
            html += `<tr><td style="${labelStyle}">合計</td><td style="${cellStyle}">${sum}</td></tr>`;
        });
        html += `</table>`;

        // ペアプロ・ペアトレ（専門相談の下、アウトリーチの右に位置する）
        html += `<div style="margin-top:4px;">`;
        html += `<div style="font-size:13.33px; font-weight:bold; margin-bottom:3px;">ペアレントプログラム</div><table style="border-collapse:collapse; width:100%; margin-bottom:6px;"><tr><th style="${headStyle}">日付</th><th style="${headStyle}">参加人数</th></tr>`;
        for (let i = 0; i < 2; i++) {
            const r = sd.pairPro[i];
            html += `<tr><td style="${cellStyle}">${r && r.date ? formatDateJp(r.date) : ''}</td><td style="${cellStyle}">${r ? r.count : ''}</td></tr>`;
        }
        html += `</table>`;
        html += `<div style="font-size:13.33px; font-weight:bold; margin-bottom:3px;">ペアレントトレーニング</div><table style="border-collapse:collapse; width:100%;"><tr><th style="${headStyle}">日付</th><th style="${headStyle}">参加人数</th></tr>`;
        for (let i = 0; i < 2; i++) {
            const r = sd.pairTra[i];
            html += `<tr><td style="${cellStyle}">${r && r.date ? formatDateJp(r.date) : ''}</td><td style="${cellStyle}">${r ? r.count : ''}</td></tr>`;
        }
        html += `</table></div>`;
        html += `</div>`;

        html += `</div>`; // 上段3列横並び終了

        // 講演会（主催）：内容の文字数が多いため幅を広く配分
        html += `<div style="font-size:13.33px; font-weight:bold; margin-bottom:3px;">講演会（主催）</div>`;
        html += `<table style="border-collapse:collapse; width:100%;"><tr><th style="${headStyle}">日付</th><th style="${headStyle}">内容</th><th style="${headStyle}">人数</th></tr>`;
        const kRows = sd.kouenkai.length > 0 ? sd.kouenkai : [{ date: '', title: '', count: '' }];
        kRows.forEach(r => {
            html += `<tr><td style="${cellStyle}">${r.date ? formatDateJp(r.date) : ''}</td><td style="${cellStyle} text-align:left; white-space:normal;">${escapeHtml(r.title)}</td><td style="${cellStyle}">${r.count}</td></tr>`;
        });
        html += `</table>`;

        return html;
    }

    function escapeHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function formatDateJp(dateStr) {
        const p = String(dateStr).split('-');
        if (p.length === 3) return `${parseInt(p[1], 10)}月${parseInt(p[2], 10)}日`;
        return dateStr;
    }

    // 日付を「M/D」形式（スラッシュ表記、例:5/8）に変換する（累計PDFのペアトレ/ペアプロ/講演会/アウトリーチ表示用）
    function formatDateSlash(dateStr) {
        const p = String(dateStr).split('-');
        if (p.length === 3) return `${parseInt(p[1], 10)}/${parseInt(p[2], 10)}`;
        return dateStr;
    }

    // ============================================================
    // kintone API ユーティリティ
    // ============================================================

    // ファイルをkintoneにアップロードしてfileKeyを取得
    async function uploadFile(buffer, fileName, mime) {
        const blob = new Blob([buffer], { type: mime });
        console.log(`▶︎ アップロード準備: ${fileName} (${blob.size} bytes, type=${mime})`);
        if (blob.size === 0) {
            throw new Error(`「${fileName}」の生成結果が空でした。ファイル生成処理に問題があります。`);
        }
        const formData = new FormData();
        formData.append('file', blob, fileName);
        const headers = { 'X-Requested-With': 'XMLHttpRequest' };
        // kintoneのCSRF対策トークンを明示的に付与する（fetchはkintone.apiのような自動付与を行わないため）
        if (typeof kintone.getRequestToken === 'function') {
            try {
                const token = await kintone.getRequestToken();
                if (token) headers['X-Cybozu-RequestToken'] = token;
            } catch (e) {
                console.warn('CSRFトークン取得に失敗しました。トークンなしで続行します。', e);
            }
        }
        const resp = await fetch(kintone.api.url('/k/v1/file.json', true), {
            method: 'POST',
            headers: headers,
            body: formData
        });
        if (!resp.ok) {
            let detail = '';
            try {
                const errJson = await resp.json();
                detail = errJson.message || JSON.stringify(errJson);
            } catch (e) {
                try { detail = await resp.text(); } catch (e2) { detail = ''; }
            }
            console.error(`🚨 アップロード失敗詳細（${fileName}）: status=${resp.status}`, detail);
            throw new Error(`「${fileName}」のアップロードに失敗しました（status:${resp.status}）。\n${detail}`);
        }
        const json = await resp.json();
        return json.fileKey;
    }

    // 複数ファイルをレコードの添付フィールドに保存
    // overwriteSameName=true: 同名ファイルは置き換え / false: 常に追加
    async function saveFilesToRecord(appId, recordId, files, overwriteSameName) {
        // 新規ファイルをアップロード
        const uploaded = [];
        for (const f of files) {
            const fileKey = await uploadFile(f.buffer, f.name, f.mime);
            uploaded.push({ fileKey: fileKey, name: f.name });
        }

        // 既存の添付ファイルを取得
        const getResp = await kintone.api(kintone.api.url('/k/v1/record', true), 'GET', { app: appId, id: recordId });
        let existing = (getResp.record[FIELD_CODE] && getResp.record[FIELD_CODE].value) ? getResp.record[FIELD_CODE].value : [];

        let newValue;
        if (overwriteSameName) {
            // 今回保存するファイルと同名の既存ファイルを除外してから追加
            const newNames = uploaded.map(u => u.name);
            existing = existing.filter(e => newNames.indexOf(e.name) === -1);
            newValue = existing.concat(uploaded.map(u => ({ fileKey: u.fileKey })));
        } else {
            // 常に追加
            newValue = existing.concat(uploaded.map(u => ({ fileKey: u.fileKey })));
        }

        await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', {
            app: appId, id: recordId,
            record: { [FIELD_CODE]: { value: newValue } }
        });
    }

    // 1レコードの全フィールドを取得
    async function fetchSingleRecordFull(appId, recordId) {
        const resp = await kintone.api(kintone.api.url('/k/v1/record', true), 'GET', { app: appId, id: recordId });
        const rec = resp.record;
        rec['$id'] = { value: recordId };
        return rec;
    }

    // 年度内の全レコードから「講演会」テーブルの内容を集約して1つの配列にする
    async function fetchAllYearKouenkai(appId, year) {
        const resp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
            app: appId,
            query: `年度 = ${year} order by 月 asc limit 12`,
            fields: ['月', '講演会']
        });
        const rows = [];
        resp.records.forEach(rec => {
            const table = rec['講演会'] && rec['講演会'].value ? rec['講演会'].value : [];
            table.forEach(row => {
                const dateVal = row.value['日付講演会'] ? row.value['日付講演会'].value : '';
                const titleVal = row.value['タイトル'] ? row.value['タイトル'].value : '';
                const count = row.value['参加人数'] ? parseInt(row.value['参加人数'].value || 0, 10) : 0;
                if (dateVal || titleVal || count > 0) rows.push({ date: dateVal || '', title: titleVal || '', count: count });
            });
        });
        return rows;
    }

    // 年度内の全レコードから、ペアトレ・ペアプロの実施日+当月の町別人数を収集する
    // （1ヶ月に基本1回実施という想定。各月の「ペアトレ日付」等の実施日に、その月の
    //   「ペアトレ明和」「ペアトレ多気」「ペアトレ大台」を当てはめる）
    async function fetchAllYearPairEvents(appId, year) {
        const resp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
            app: appId,
            query: `年度 = ${year} order by 月 asc limit 12`,
            fields: ['月', 'ペアトレ', 'ペアプロ', 'ペアトレ明和', 'ペアトレ多気', 'ペアトレ大台', 'ペアプロ明和', 'ペアプロ多気', 'ペアプロ大台']
        });
        const pairTra = [];
        const pairPro = [];
        resp.records.forEach(rec => {
            const traTable = rec['ペアトレ'] && rec['ペアトレ'].value ? rec['ペアトレ'].value : [];
            const traMei = getNum(rec, 'ペアトレ明和'), traTaki = getNum(rec, 'ペアトレ多気'), traOodai = getNum(rec, 'ペアトレ大台');
            traTable.forEach(row => {
                const d = row.value['ペアトレ日付'] ? row.value['ペアトレ日付'].value : '';
                if (d) pairTra.push({ date: d, mei: traMei, taki: traTaki, oodai: traOodai });
            });

            const proTable = rec['ペアプロ'] && rec['ペアプロ'].value ? rec['ペアプロ'].value : [];
            const proMei = getNum(rec, 'ペアプロ明和'), proTaki = getNum(rec, 'ペアプロ多気'), proOodai = getNum(rec, 'ペアプロ大台');
            proTable.forEach(row => {
                const d = row.value['ペアプロ日付'] ? row.value['ペアプロ日付'].value : '';
                if (d) pairPro.push({ date: d, mei: proMei, taki: proTaki, oodai: proOodai });
            });
        });
        pairTra.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
        pairPro.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
        return { pairTra: pairTra, pairPro: pairPro };
    }

    // 年度内の全レコードから、アウトリーチの（町名・事業名・実施日）を全件収集する
    async function fetchAllYearOutreachAll(appId, year) {
        const resp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
            app: appId,
            query: `年度 = ${year} order by 月 asc limit 12`,
            fields: ['月', 'アウトリーチ']
        });
        const rows = [];
        resp.records.forEach(rec => {
            const table = rec['アウトリーチ'] && rec['アウトリーチ'].value ? rec['アウトリーチ'].value : [];
            table.forEach(row => {
                const town = row.value['町名アウトリーチ'] ? row.value['町名アウトリーチ'].value : '';
                const dateVal = row.value['日付アウトリーチ'] ? row.value['日付アウトリーチ'].value : '';
                const jigyou = row.value['事業名アウトリーチ'] ? row.value['事業名アウトリーチ'].value : '';
                if (town && dateVal && jigyou) rows.push({ town: town, jigyou: jigyou, date: dateVal });
            });
        });
        return rows;
    }

    // 選択月の配列から、PDF/Excelタイトル用の表記を作る（連続なら範囲、離れていれば列挙）
    function formatMonthRangeLabel(selectedMonths) {
        const order = { 4:0,5:1,6:2,7:3,8:4,9:5,10:6,11:7,12:8,1:9,2:10,3:11 };
        const sorted = selectedMonths.slice().sort((a, b) => order[a] - order[b]);
        if (sorted.length === 1) return `${sorted[0]}月`;
        let isContinuous = true;
        for (let i = 1; i < sorted.length; i++) {
            if (order[sorted[i]] !== order[sorted[i - 1]] + 1) { isContinuous = false; break; }
        }
        if (isContinuous) return `${sorted[0]}月～${sorted[sorted.length - 1]}月`;
        return sorted.map(m => `${m}月`).join('、');
    }

    // ============================================================
    // 汎用ユーティリティ
    // ============================================================
    function getNum(rec, code) {
        if (!rec[code]) return 0;
        const n = parseInt(rec[code].value || 0, 10);
        return isNaN(n) ? 0 : n;
    }

    function pad2(n) {
        return (n < 10 ? '0' : '') + n;
    }

    function toDate(dateStr) {
        const p = String(dateStr).split('-');
        return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    }

    function collectDateCountRows(rec, tableCode, dateCode, countCode) {
        const rows = [];
        const table = rec[tableCode] && rec[tableCode].value ? rec[tableCode].value : [];
        table.forEach(row => {
            const dateVal = row.value[dateCode] ? row.value[dateCode].value : '';
            const count = row.value[countCode] ? parseInt(row.value[countCode].value || 0, 10) : 0;
            if (dateVal || count > 0) rows.push({ date: dateVal || '', count: count });
        });
        rows.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
        return rows;
    }

})();
