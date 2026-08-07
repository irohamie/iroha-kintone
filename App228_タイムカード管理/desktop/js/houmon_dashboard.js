(function() {
    'use strict';

    // ==========================================================
    //  設定
    // ==========================================================
    var CONFIG = {
        APP_154_ID: 154,
        APP_154_TOKEN: 'c3XB9emmdUxIsUH7m1WPgu2qMZRnHTI3mEBXUFP2',
        APP_10_ID: 10,
        APP_10_TOKEN: 'xOtC5UkOEjiw5BFGsYzuj8frWzBx798CXVjHKNZs',
        APP_50_ID: 50,
        APP_50_TOKEN: 'o8uBaxW6GGQpEWPYSPBfGyLHUA7MRjz2fpcKp1LO',
        PLAN_HOUMON_ARI:  '訪問支援(会議あり)【関',
        PLAN_HOUMON_NASHI: '訪問支援(会議なし/別時間)',
        PLAN_KAIGI:       '訪問会議・相談・連携【関'
    };

    // 括弧内に出現するが職員名ではない語
    var NON_STAFF_WORDS = { '初回': true, 'センター': true };

    // 特定の担当者名を強制的にフルネームに変換するマッピング
    var STAFF_ALIASES = {
        '太田': '太田裕美子',
        '小林': '小林美千子'
    };

    var currentYear  = new Date().getFullYear();
    var currentMonth = new Date().getMonth() + 1;

    // ==========================================================
    //  ユーティリティ
    // ==========================================================
    function formatDate(isoStr) {
        if (!isoStr) return '';
        var d = new Date(isoStr);
        return (d.getMonth() + 1) + '/' + d.getDate();
    }

    function sortByDate(a, b) {
        if (a.sortKey < b.sortKey) return -1;
        if (a.sortKey > b.sortKey) return 1;
        return 0;
    }

    function esc(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // 名寄せ用: 全角半角スペース除去
    function normalizeName(name) {
        if (!name) return '';
        return name.replace(/[\s\u3000]/g, '');
    }

    // 全角スラッシュ→半角に正規化
    function normalizeSlash(str) {
        if (!str) return '';
        return str.replace(/／/g, '/');
    }

    // 文字列が全て漢字かどうか
    function isAllKanji(str) {
        if (!str) return false;
        return /^[\u4E00-\u9FFF]+$/.test(str);
    }

    // カタカナを1文字以上含むか（注釈行のフィルタ用）
    function hasKatakana(str) {
        return /[\u30A1-\u30F6\u30FC]/.test(str);
    }

    /**
     * スペースなしで連結された文字列から末尾の職員名を分離
     */
    function findEmbeddedStaff(text, knownStaff) {
        if (!text || !knownStaff) return { child: text, staff: '' };

        var bestMatch = '';
        for (var name in knownStaff) {
            if (knownStaff.hasOwnProperty(name)) {
                var nLen = name.length;
                if (text.length > nLen &&
                    text.substring(text.length - nLen) === name &&
                    nLen > bestMatch.length) {
                    bestMatch = name;
                }
            }
        }
        if (bestMatch) {
            return {
                child: text.substring(0, text.length - bestMatch.length),
                staff: bestMatch
            };
        }

        var kanjiStart = text.length;
        for (var j = text.length - 1; j >= 0; j--) {
            var code = text.charCodeAt(j);
            if (code >= 0x4E00 && code <= 0x9FFF) {
                kanjiStart = j;
            } else {
                break;
            }
        }
        if (kanjiStart > 0 && kanjiStart < text.length) {
            var kanjiPart = text.substring(kanjiStart);
            if (kanjiPart.length >= 1 && kanjiPart.length <= 4 && !NON_STAFF_WORDS[kanjiPart]) {
                return {
                    child: text.substring(0, kanjiStart),
                    staff: kanjiPart
                };
            }
        }

        return { child: text, staff: '' };
    }

    /**
     * アプリ50のリストや個別マッピングをもとに、担当者名を漢字フルネームに変換
     */
    function convertToFullName(staffStr, staffList) {
        if (!staffStr) return staffStr;
        var parts = staffStr.split('/');
        
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i].trim();
            if (!p) continue;

            if (STAFF_ALIASES[p]) {
                parts[i] = STAFF_ALIASES[p];
                continue;
            }
            
            if (staffList && staffList.length > 0) {
                for (var j = 0; j < staffList.length; j++) {
                    var fullName = staffList[j];
                    var normalizedFull = fullName.replace(/[\s\u3000]/g, '');
                    if (normalizedFull.indexOf(p) !== -1) {
                        parts[i] = fullName;
                        break;
                    }
                }
            }
        }
        return parts.join('/');
    }

    // ==========================================================
    //  API: レコード取得
    // ==========================================================
    function fetchApp154Records(year, month) {
        return new Promise(function(resolve, reject) {
            var mm = ('0' + month).slice(-2);
            var startDate = year + '-' + mm + '-01T00:00:00+09:00';

            var ny = year;
            var nm = month + 1;
            if (nm > 12) { nm = 1; ny++; }
            var nmm = ('0' + nm).slice(-2);
            var endDate = ny + '-' + nmm + '-01T00:00:00+09:00';

            var query = 'plan in ('
                + '"' + CONFIG.PLAN_HOUMON_ARI  + '", '
                + '"' + CONFIG.PLAN_HOUMON_NASHI + '", '
                + '"' + CONFIG.PLAN_KAIGI        + '"'
                + ') and start >= "' + startDate + '"'
                + ' and start < "'  + endDate   + '"'
                + ' order by start asc limit 500';

            var url = location.protocol + '//' + location.host
                + '/k/v1/records.json'
                + '?app='   + CONFIG.APP_154_ID
                + '&query=' + encodeURIComponent(query)
                + '&fields[0]=plan'
                + '&fields[1]=memo'
                + '&fields[2]=title'
                + '&fields[3]=start'
                + '&fields[4]=$id';

            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.setRequestHeader('X-Cybozu-API-Token', CONFIG.APP_154_TOKEN);
            xhr.onload = function() {
                if (xhr.status === 200) {
                    try {
                        var data = JSON.parse(xhr.responseText);
                        resolve(data.records || []);
                    } catch (e) {
                        reject(new Error('JSON parse error: ' + e.message));
                    }
                } else {
                    reject(new Error('App154 HTTP ' + xhr.status + ': ' + xhr.responseText));
                }
            };
            xhr.onerror = function() {
                reject(new Error('App154 network error'));
            };
            xhr.send();
        });
    }

    function fetchApp50StaffRecords() {
        return new Promise(function(resolve, reject) {
            var url = location.protocol + '//' + location.host
                + '/k/v1/records.json'
                + '?app=' + CONFIG.APP_50_ID
                + '&fields[0]=氏名'
                + '&limit=500';

            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.setRequestHeader('X-Cybozu-API-Token', CONFIG.APP_50_TOKEN);
            xhr.onload = function() {
                if (xhr.status === 200) {
                    try {
                        var data = JSON.parse(xhr.responseText);
                        var staffList = [];
                        for (var i = 0; i < data.records.length; i++) {
                            var shimeiField = data.records[i].氏名;
                            if (shimeiField && shimeiField.value && shimeiField.value.length > 0) {
                                staffList.push(shimeiField.value[0].name);
                            }
                        }
                        resolve(staffList);
                    } catch (e) {
                        reject(new Error('JSON parse error (App50): ' + e.message));
                    }
                } else {
                    reject(new Error('App50 HTTP ' + xhr.status + ': ' + xhr.responseText));
                }
            };
            xhr.onerror = function() {
                reject(new Error('App50 network error'));
            };
            xhr.send();
        });
    }

    // ==========================================================
    //  Phase 0: 全レコードの括弧内から既知職員名を動的収集
    // ==========================================================
    function collectStaffNames(records) {
        var staffSet = {};
        for (var i = 0; i < records.length; i++) {
            var memo  = (records[i].memo  && records[i].memo.value)  || '';
            var title = (records[i].title && records[i].title.value) || '';
            extractStaffFromText(memo,  staffSet);
            extractStaffFromText(title, staffSet);
        }
        return staffSet;
    }

    function extractStaffFromText(text, staffSet) {
        if (!text) return;
        var regex = /[（(]([^）)]+)[）)]/g;
        var match;
        while ((match = regex.exec(text)) !== null) {
            var content = match[1];
            var parts = content.split(/[/／・]/);
            for (var i = 0; i < parts.length; i++) {
                var name = parts[i].trim();
                if (name && !NON_STAFF_WORDS[name]) {
                    staffSet[name] = true;
                }
            }
        }
    }

    // ==========================================================
    //  パーサー
    // ==========================================================
    function parseParenContent(content) {
        if (!content) return { isFirst: false, staff: '' };

        var isFirst = false;
        var text = content.trim();

        if (text.indexOf('初回') === 0) {
            isFirst = true;
            text = text.replace(/^初回[・/／\s]*/, '').trim();
        }

        var remaining = text.split(/[/／・]/).filter(function(s) {
            return s.trim() && !NON_STAFF_WORDS[s.trim()];
        });

        var staff = normalizeSlash(remaining.join('/'));
        return { isFirst: isFirst, staff: staff };
    }

    function parseNameLine(line, knownStaff) {
        var cleaned = line.trim();
        if (!cleaned) return [];

        cleaned = cleaned.replace(/^追加[：:]/, '');
        cleaned = cleaned.replace(/^[０-９0-9]+年/, '');
        cleaned = cleaned.replace(/[（(][０-９0-9]+年[）)]/g, '');
        cleaned = cleaned.replace(/※.*$/, '').trim();
        if (!cleaned) return [];

        var staff = '';
        var isFirst = false;
        var childPart = cleaned;

        var staffMatch = cleaned.match(/[（(]([^）)]+)[）)]\s*$/);
        if (staffMatch) {
            var parsed = parseParenContent(staffMatch[1]);
            staff   = parsed.staff;
            isFirst = parsed.isFirst;
            childPart = cleaned.substring(0, staffMatch.index).trim();
        }

        childPart = childPart.replace(/[（(][^）)]*[）)]/g, '').trim();
        childPart = childPart.replace(/\u3000/g, ' ').trim();
        childPart = normalizeSlash(childPart);

        if (knownStaff) {
            var extraStaff = '';
            if (childPart.indexOf('/') !== -1) {
                var slashIdx = childPart.indexOf('/');
                var beforeSlash = childPart.substring(0, slashIdx).trim();
                var afterSlash  = childPart.substring(slashIdx + 1).trim();

                var embedded = findEmbeddedStaff(beforeSlash, knownStaff);
                if (embedded.staff) {
                    childPart = embedded.child;
                    extraStaff = embedded.staff + '/' + afterSlash;
                } else {
                    childPart = beforeSlash;
                    extraStaff = afterSlash;
                }
            } else {
                var segments = childPart.split(/\s+/);
                if (segments.length >= 2) {
                    var lastSeg = segments[segments.length - 1];

                    if (knownStaff[lastSeg] || isAllKanji(lastSeg)) {
                        extraStaff = lastSeg;
                        segments.pop();
                        if (segments.length >= 2 && segments[segments.length - 1] === '初回') {
                            isFirst = true;
                            segments.pop();
                        }
                        childPart = segments.join(' ');
                    } else if (lastSeg === '初回') {
                        isFirst = true;
                        segments.pop();
                        childPart = segments.join(' ');
                    } else {
                        var emb = findEmbeddedStaff(lastSeg, knownStaff);
                        if (emb.staff) {
                            extraStaff = emb.staff;
                            segments[segments.length - 1] = emb.child;
                            childPart = segments.join(' ');
                        }
                    }
                } else {
                    var emb2 = findEmbeddedStaff(childPart, knownStaff);
                    if (emb2.staff) {
                        childPart = emb2.child;
                        extraStaff = emb2.staff;
                    }
                }
            }

            if (extraStaff) {
                if (staff) {
                    staff = extraStaff + '/' + staff;
                } else {
                    staff = extraStaff;
                }
            }
        }

        if (childPart.length > 2 && childPart.substring(childPart.length - 2) === '初回') {
            isFirst = true;
            childPart = childPart.substring(0, childPart.length - 2).trim();
        }

        var results = [];
        if (childPart.indexOf('・') !== -1) {
            var parts = childPart.split('・');
            for (var i = 0; i < parts.length; i++) {
                var name = parts[i].trim();
                if (name) {
                    results.push({ child: name, staff: staff, isFirst: isFirst });
                }
            }
        } else {
            if (childPart) {
                results.push({ child: childPart, staff: staff, isFirst: isFirst });
            }
        }

        return results;
    }

    function parseMemoField(memo, knownStaff) {
        if (!memo) return [];
        var lines = memo.split(/\r?\n/);
        var results = [];
        for (var i = 0; i < lines.length; i++) {
            var trimmed = lines[i].trim();
            if (!trimmed || trimmed.charAt(0) === '※') continue;
            if (/^\d+[:：時]/.test(trimmed)) continue;
            if (!hasKatakana(trimmed)) continue;
            var entries = parseNameLine(trimmed, knownStaff);
            for (var j = 0; j < entries.length; j++) {
                results.push(entries[j]);
            }
        }
        return results;
    }

    function parseLocationFromTitle(title) {
        if (!title) return '';
        var cleaned = title.replace(/※.*$/, '').trim();
        var idx1 = cleaned.indexOf('（');
        var idx2 = cleaned.indexOf('(');
        var idx = -1;
        if (idx1 >= 0 && idx2 >= 0) {
            idx = Math.min(idx1, idx2);
        } else if (idx1 >= 0) {
            idx = idx1;
        } else if (idx2 >= 0) {
            idx = idx2;
        }
        if (idx > 0) {
            return cleaned.substring(0, idx).trim();
        }
        return cleaned;
    }

    function parseTitleForChildren(title, knownStaff) {
        if (!title) return [];
        var cleaned = title.replace(/※.*$/, '').trim();
        if (!cleaned) return [];
        return parseNameLine(cleaned, knownStaff);
    }


    // ==========================================================
    //  レコード処理
    // ==========================================================
    function processRecords(records, staffList) {
        var knownStaff = collectStaffNames(records);

        var houmonShien   = [];
        var kaigiRaw      = [];
        var houmonKaigi   = [];

        // ──────────────────────────────────────
        // Phase 1: レコード分類
        // ──────────────────────────────────────
        for (var i = 0; i < records.length; i++) {
            var rec   = records[i];
            var plan  = (rec.plan  && rec.plan.value)  || '';
            var memo  = (rec.memo  && rec.memo.value)  || '';
            var title = (rec.title && rec.title.value)  || '';
            var start = (rec.start && rec.start.value)  || '';
            var date  = formatDate(start);
            var recordId = (rec.$id && rec.$id.value) || '';

            // ★ 追加: titleから職員名を確保（Memoに職員名がない場合のフォールバック用）
            var fallbackStaff = '';
            var titleParsed = parseTitleForChildren(title, knownStaff);
            if (titleParsed && titleParsed.length > 0) {
                for (var t = 0; t < titleParsed.length; t++) {
                    if (titleParsed[t].staff) {
                        fallbackStaff = titleParsed[t].staff;
                        break;
                    }
                }
            }

            if (plan === CONFIG.PLAN_HOUMON_ARI || plan === CONFIG.PLAN_HOUMON_NASHI) {
                var loc = parseLocationFromTitle(title);
                var children = parseMemoField(memo, knownStaff);
                var isAri = (plan === CONFIG.PLAN_HOUMON_ARI);

                for (var j = 0; j < children.length; j++) {
                    // Memoの行に職員名がない場合はtitleから補完する
                    var st = children[j].staff || fallbackStaff;

                    houmonShien.push({
                        date:      date,
                        sortKey:   start,
                        location:  loc,
                        locNorm:   normalizeName(loc),
                        child:     children[j].child,
                        childNorm: normalizeName(children[j].child),
                        staff:     convertToFullName(st, staffList),
                        isFirst:   children[j].isFirst,
                        kaigi:     isAri ? date : '',
                        recordId:  recordId
                    });
                }
                
                // Memoが空だった場合の処理（児童名は「記載なし」とし、担当者はtitleから補完）
                if (children.length === 0 && loc) {
                    houmonShien.push({
                        date:      date,
                        sortKey:   start,
                        location:  loc,
                        locNorm:   normalizeName(loc),
                        child:     '（記載なし）',
                        childNorm: '',
                        staff:     convertToFullName(fallbackStaff, staffList),
                        isFirst:   false,
                        kaigi:     isAri ? date : '',
                        recordId:  recordId
                    });
                }

            } else if (plan === CONFIG.PLAN_KAIGI) {
                var loc2 = parseLocationFromTitle(title);
                var loc2ForMatch = loc2;
                var children2 = parseMemoField(memo, knownStaff);
                
                if (children2.length === 0) {
                    children2 = titleParsed; // parseTitleForChildrenの結果をそのまま活用
                    loc2 = '';
                }

                for (var k = 0; k < children2.length; k++) {
                    // Memoの行に職員名がない場合はtitleから補完
                    var st2 = children2[k].staff || fallbackStaff;

                    kaigiRaw.push({
                        date:      date,
                        sortKey:   start,
                        location:  loc2,
                        locNorm:   normalizeName(loc2ForMatch),
                        child:     children2[k].child,
                        childNorm: normalizeName(children2[k].child),
                        staff:     convertToFullName(st2, staffList),
                        isFirst:   children2[k].isFirst,
                        recordId:  recordId
                    });
                }

                if (children2.length === 0) {
                    var fallbackName = title ? title.replace(/※.*$/, '').trim() : '（記載なし）';
                    kaigiRaw.push({
                        date:      date,
                        sortKey:   start,
                        location:  loc2,
                        locNorm:   normalizeName(loc2ForMatch),
                        child:     fallbackName,
                        childNorm: '',
                        staff:     convertToFullName(fallbackStaff, staffList),
                        isFirst:   false,
                        recordId:  recordId
                    });
                }
            }
        }

        // ──────────────────────────────────────
        // Phase 2 & 2.5: マッチング
        // ──────────────────────────────────────
        var unmatchedKaigi = [];

        for (var p = 0; p < kaigiRaw.length; p++) {
            var kg = kaigiRaw[p];
            var matchedByChild = false;

            if (kg.childNorm) {
                for (var q = 0; q < houmonShien.length; q++) {
                    if (houmonShien[q].childNorm === kg.childNorm) {
                        if (!houmonShien[q].kaigi) {
                            houmonShien[q].kaigi = kg.date;
                        } else if (houmonShien[q].kaigi.indexOf(kg.date) === -1) {
                            houmonShien[q].kaigi += ', ' + kg.date;
                        }
                        matchedByChild = true;
                    }
                }
            }

            if (!matchedByChild) {
                unmatchedKaigi.push(kg);
            }
        }

        for (var r = 0; r < unmatchedKaigi.length; r++) {
            var kg2 = unmatchedKaigi[r];
            var matchedByLoc = false;

            if (kg2.locNorm) {
                for (var s = 0; s < houmonShien.length; s++) {
                    var shienLoc = houmonShien[s].locNorm;
                    if (shienLoc && !houmonShien[s].kaigi &&
                        (shienLoc.indexOf(kg2.locNorm) !== -1 || kg2.locNorm.indexOf(shienLoc) !== -1)) {
                        houmonShien[s].kaigi = kg2.date;
                        matchedByLoc = true;
                    }
                }
            }

            if (!matchedByLoc) {
                houmonKaigi.push(kg2);
            }
        }

        // ──────────────────────────────────────
        // 同日・同名の児童の重複排除（片方を削除）
        // ──────────────────────────────────────
        var uniqueHoumonShien = [];
        var seenShien = {};
        for (var u1 = 0; u1 < houmonShien.length; u1++) {
            var sItem = houmonShien[u1];
            if (sItem.childNorm) {
                var sKey = sItem.date + '_' + sItem.childNorm;
                if (seenShien[sKey]) continue;
                seenShien[sKey] = true;
            }
            uniqueHoumonShien.push(sItem);
        }
        houmonShien = uniqueHoumonShien;

        var uniqueHoumonKaigi = [];
        var seenKaigi = {};
        for (var u2 = 0; u2 < houmonKaigi.length; u2++) {
            var kItem = houmonKaigi[u2];
            if (kItem.childNorm) {
                var kKey = kItem.date + '_' + kItem.childNorm;
                if (seenKaigi[kKey]) continue;
                seenKaigi[kKey] = true;
            }
            uniqueHoumonKaigi.push(kItem);
        }
        houmonKaigi = uniqueHoumonKaigi;

        houmonShien.sort(sortByDate);
        houmonKaigi.sort(sortByDate);

        return {
            houmonShien:   houmonShien,
            houmonKaigi:   houmonKaigi,
            totalRecords:  records.length
        };
    }


    // ==========================================================
    //  レンダリング
    // ==========================================================
    function buildRecordLink(recordId) {
        if (!recordId) return '';
        var url = location.protocol + '//' + location.host
            + '/k/' + CONFIG.APP_154_ID + '/show#record=' + recordId;
        return '<a class="hd-rec-link" href="' + url + '" target="_blank" rel="noopener" title="レコードを開く">開く</a>';
    }

    function renderDashboard(container, data) {
        var html = '';

        html += '<div class="hd-month-nav">';
        html += '  <button id="hd-prev-btn">◀</button>';
        html += '  <span class="hd-month-label">' + currentYear + '年' + currentMonth + '月</span>';
        html += '  <button id="hd-next-btn">▶</button>';
        html += '</div>';

        if (data.totalRecords === 0) {
            html += '<div class="hd-empty">この月のデータはありません</div>';
            container.innerHTML = html;
            attachNavEvents(container);
            return;
        }

        html += '<div class="hd-section-title">';
        html += '  訪問支援';
        html += '  <span class="hd-badge">' + data.houmonShien.length + '件</span>';
        html += '</div>';
        if (data.houmonShien.length > 0) {
            html += '<div class="hd-table-wrap">';
            html += '<table class="hd-table">';
            html += '<thead><tr>';
            html += '  <th style="width:60px;">日付</th>';
            html += '  <th style="width:140px;">場所</th>';
            html += '  <th>利用児童</th>';
            html += '  <th style="width:55px;">初回</th>';
            html += '  <th style="width:140px;">担当者</th>';
            html += '  <th style="width:90px;">会議</th>';
            html += '  <th style="width:55px;">操作</th>';
            html += '</tr></thead>';
            html += '<tbody>';
            for (var i = 0; i < data.houmonShien.length; i++) {
                var r = data.houmonShien[i];
                html += '<tr>';
                html += '  <td>' + esc(r.date) + '</td>';
                html += '  <td>' + esc(r.location) + '</td>';
                html += '  <td>' + esc(r.child) + '</td>';
                html += '  <td class="hd-first-cell">' + (r.isFirst ? '初回' : '') + '</td>';
                html += '  <td>' + esc(r.staff) + '</td>';
                if (r.kaigi) {
                    html += '  <td class="hd-kaigi-date">' + esc(r.kaigi) + '</td>';
                } else {
                    html += '  <td></td>';
                }
                html += '  <td class="hd-link-cell">' + buildRecordLink(r.recordId) + '</td>';
                html += '</tr>';
            }
            html += '</tbody></table>';
            html += '</div>';
        } else {
            html += '<div class="hd-empty">データなし</div>';
        }

        html += '<div class="hd-section-title kaigi">';
        html += '  訪問会議・相談・連携';
        if (data.houmonKaigi.length > 0) {
            html += '  <span class="hd-badge">' + data.houmonKaigi.length + '件</span>';
        } else {
            html += '  <span class="hd-badge">すべて訪問支援に統合済み</span>';
        }
        html += '</div>';
        if (data.houmonKaigi.length > 0) {
            html += '<div class="hd-table-wrap">';
            html += '<table class="hd-table">';
            html += '<thead><tr>';
            html += '  <th style="width:60px;">日付</th>';
            html += '  <th style="width:140px;">場所</th>';
            html += '  <th>利用児童</th>';
            html += '  <th style="width:140px;">担当者</th>';
            html += '  <th style="width:55px;">操作</th>';
            html += '</tr></thead>';
            html += '<tbody>';
            for (var j = 0; j < data.houmonKaigi.length; j++) {
                var r2 = data.houmonKaigi[j];
                html += '<tr>';
                html += '  <td>' + esc(r2.date) + '</td>';
                html += '  <td>' + esc(r2.location) + '</td>';
                html += '  <td>' + esc(r2.child) + '</td>';
                html += '  <td>' + esc(r2.staff) + '</td>';
                html += '  <td class="hd-link-cell">' + buildRecordLink(r2.recordId) + '</td>';
                html += '</tr>';
            }
            html += '</tbody></table>';
            html += '</div>';
        }

        container.innerHTML = html;
        attachNavEvents(container);
    }

    function attachNavEvents(container) {
        var prevBtn = document.getElementById('hd-prev-btn');
        var nextBtn = document.getElementById('hd-next-btn');
        if (prevBtn) {
            prevBtn.addEventListener('click', function() {
                currentMonth--;
                if (currentMonth < 1) { currentMonth = 12; currentYear--; }
                loadAndRender(container);
            });
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', function() {
                currentMonth++;
                if (currentMonth > 12) { currentMonth = 1; currentYear++; }
                loadAndRender(container);
            });
        }
    }

    function loadAndRender(container) {
        container.innerHTML = '<div class="hd-loading">読み込み中...</div>';

        Promise.all([
            fetchApp154Records(currentYear, currentMonth),
            fetchApp50StaffRecords()
        ])
        .then(function(results) {
            var records154 = results[0];
            var staffList = results[1];
            var data = processRecords(records154, staffList);
            renderDashboard(container, data);
        })
        .catch(function(err) {
            var html = '<div class="hd-month-nav">';
            html += '  <button id="hd-prev-btn">◀</button>';
            html += '  <span class="hd-month-label">' + currentYear + '年' + currentMonth + '月</span>';
            html += '  <button id="hd-next-btn">▶</button>';
            html += '</div>';
            html += '<div class="hd-error">';
            html += '  <b>データ取得エラー</b><br>';
            html += '  ' + esc(err.message);
            html += '  <br><br>考えられる原因:<br>';
            html += '  ・APIトークンの閲覧権限が不足<br>';
            html += '  ・planフィールドの選択肢名が異なる<br>';
            html += '  ・ネットワークエラー';
            html += '</div>';
            container.innerHTML = html;
            attachNavEvents(container);
            console.error('[訪問支援ダッシュボード]', err);
        });
    }

    // ==========================================================
    //  メインイベント
    // ==========================================================
    kintone.events.on('app.record.index.show', function(event) {
        var el = document.getElementById('houmon-dashboard');
        if (!el) return event;
        loadAndRender(el);
        return event;
    });

})();
