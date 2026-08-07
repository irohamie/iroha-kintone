(function() {
    'use strict';
    var CONFIG = {
        APP_ID: 228,
        MONTHS: [
            {m:4,label:'4月'},{m:5,label:'5月'},{m:6,label:'6月'},{m:7,label:'7月'},
            {m:8,label:'8月'},{m:9,label:'9月'},{m:10,label:'10月'},{m:11,label:'11月'},{m:12,label:'12月'},
            {m:1,label:'1月'},{m:2,label:'2月'},{m:3,label:'3月'}
        ]
    };

    var state = {currentYear: new Date().getFullYear(), loading: false, rows: null, refBase: null, mgmt: null, overrides: {}};
    if (new Date().getMonth() + 1 < 4) state.currentYear = new Date().getFullYear() - 1;

    function esc(s){if(!s)return '';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
    function gv(r,c){if(r[c]&&r[c].value!==undefined)return r[c].value;return '';}
    function round1(n){return Math.round(n*10)/10;}

    function fetchYearStaff(fy){
        return kintone.api('/k/v1/records.json','GET',{
            app: CONFIG.APP_ID,
            query: 'record_type in ("スタッフ明細") and target_year='+fy+' order by staff_id asc, target_month asc limit 500'
        });
    }
    function fetchMgmt(fy){
        return kintone.api('/k/v1/records.json','GET',{
            app: CONFIG.APP_ID,
            query: 'record_type in ("月次管理") and target_year='+fy+' order by $id asc limit 1'
        }).then(function(d){return (d.records&&d.records[0])||null;});
    }
    function updateSelf(id,fields){
        return kintone.api('/k/v1/record.json','PUT',{app:CONFIG.APP_ID,id:id,record:fields});
    }

    // ★実労働時間(有給含む) = 勤務h ＋ 有給h(時間休) ＋ 有給日数×基準内時間 ＋ 特別休暇日数×基準内時間 ＋ 夏季休暇日数×基準内時間
    //   内訳をそのまま返す（ポップアップでの計算式表示・基準時間比較に使うため）
    function calcActualHours(rec){
        var bwd=parseFloat(gv(rec,'base_work_days'))||0, bwh=parseFloat(gv(rec,'base_work_hours'))||0;
        var perDayHr=bwd>0?(bwh/bwd):0;
        var wh=parseFloat(gv(rec,'work_hours'))||0;
        var yd=parseFloat(gv(rec,'yukyu_days'))||0, yh=parseFloat(gv(rec,'yukyu_hours'))||0;
        var toku=parseFloat(gv(rec,'tokubetsu_kyuka'))||0, kaki=parseFloat(gv(rec,'kaki_kyuka'))||0;
        var ydHr=yd*perDayHr, tokuHr=toku*perDayHr, kakiHr=kaki*perDayHr;
        var total=wh+yh+ydHr+tokuHr+kakiHr;
        return {wh:wh,yh:yh,yd:yd,ydHr:ydHr,toku:toku,tokuHr:tokuHr,kaki:kaki,kakiHr:kakiHr,total:total,baseHours:bwh,baseDays:bwd,perDayHr:perDayHr};
    }

    // ★手入力（上書き）の保存・取得。月次管理レコードの「保存」JSONに、月をまたいだ形で保持する。
    //   既存の他の手入力項目（月ごとにネストされた構造）とは別に、トップレベルの"bonus_override"キーに
    //   {氏名: {月: 数値}} という構造で保持する。
    function getSavedAll(mgmt){
        var raw=mgmt?gv(mgmt,'保存'):'';if(!raw)return{};
        try{return JSON.parse(raw)||{};}catch(e){return{};}
    }
    function getBonusOverrides(mgmt){
        var all=getSavedAll(mgmt);
        return (all.bonus_override&&typeof all.bonus_override==='object')?all.bonus_override:{};
    }
    function saveBonusOverride(staffName,month,value){
        if(!state.mgmt)return Promise.reject(new Error('この年度の「月次管理」レコードがありません。タイムカードアプリで「＋新年度」を実行してから、再度お試しください。'));
        var all=getSavedAll(state.mgmt);
        if(!all.bonus_override)all.bonus_override={};
        if(!all.bonus_override[staffName])all.bonus_override[staffName]={};
        if(value===null)delete all.bonus_override[staffName][month];
        else all.bonus_override[staffName][month]=value;
        var js=JSON.stringify(all);
        if(state.mgmt['保存'])state.mgmt['保存'].value=js;else state.mgmt['保存']={type:'MULTI_LINE_TEXT',value:js};
        return updateSelf(state.mgmt.$id.value,{'保存':{value:js}});
    }

    function groupOf(et){return et==='嘱託'?'嘱託':et==='正規'?'正規':'非常勤';}

    // ★取得した年間の全レコードを、スタッフごと・月ごとの構造に整理する。
    //   同時に、月ごとの「正規職員の基準h」（出勤率の分母となる常勤基準）を集計する。
    function processRecords(records){
        var byStaff={}, order=[];
        var refBase={}; // {month: base_work_hours}
        for(var i=0;i<records.length;i++){
            var rec=records[i], name=gv(rec,'staff_name'); if(!name)continue;
            var month=parseInt(gv(rec,'target_month'),10), et=gv(rec,'employment_type');
            if(!byStaff[name]){byStaff[name]={employmentType:et,months:{}};order.push(name);}
            if(et)byStaff[name].employmentType=et; // 最新の雇用形態で上書き
            byStaff[name].months[month]=rec;
            if(et==='正規'&&refBase[month]===undefined){
                var bwh=parseFloat(gv(rec,'base_work_hours'))||0;
                if(bwh>0)refBase[month]=bwh;
            }
        }
        for(var m=1;m<=12;m++)if(refBase[m]===undefined)refBase[m]=0;

        function ord(name){var et=byStaff[name].employmentType;var g=groupOf(et);return g==='正規'?0:g==='非常勤'?1:2;}
        order.sort(function(a,b){return ord(a)-ord(b);});

        var rows=[];
        for(var j=0;j<order.length;j++){
            var nm=order[j], info=byStaff[nm], monthly={};
            for(var mm=1;mm<=12;mm++){
                var r=info.months[mm];
                monthly[mm]=r?calcActualHours(r):null; // null=データなし（表示は"-"、集計は0扱い）。detailオブジェクトそのものを保持
            }
            rows.push({name:nm,employmentType:info.employmentType,group:groupOf(info.employmentType),monthly:monthly});
        }
        return {rows:rows,refBase:refBase};
    }

    // ★そのセルの「実際に使う値」を返す。手入力（上書き）があればそれを、無ければ計算値(detail.total)を返す。
    //   どちらも無い（データなし月）場合は null。
    function effectiveValue(staffName,month,detail){
        var ov=state.overrides[staffName]&&state.overrides[staffName][month];
        if(ov!==undefined&&ov!==null)return parseFloat(ov);
        return detail?detail.total:null;
    }
    function sumRange(row,months){
        var s=0;
        for(var i=0;i<months.length;i++){
            var m=months[i],v=effectiveValue(row.name,m,row.monthly[m]);
            s+=(v===null||v===undefined)?0:v;
        }
        return s;
    }
    function sumRangeMap(map,months){var s=0;for(var i=0;i<months.length;i++)s+=(map[months[i]]||0);return s;}

    var RANGE1=[4,5,6,7];         // 4〜7月（8月賞与対象期間）
    var RANGE2=[4,5,6,7,8,9,10,11,12,1,2]; // 4〜2月（3月賞与対象期間）
    var RANGE_ALL=[4,5,6,7,8,9,10,11,12,1,2,3]; // 年間通期

    function rateStr(actual,base){if(!base)return '0.0%';return round1((actual/base)*100)+'%';}

    function buildHeaderRow(){
        var html='<tr><th class="bn-name-cell">氏名</th>';
        for(var i=0;i<4;i++)html+='<th>'+CONFIG.MONTHS[i].label+'</th>';
        html+='<th class="bn-subtotal-col">小計①<br><span class="bn-subtotal-sub">(4〜7月)</span></th>';
        for(var i2=4;i2<11;i2++)html+='<th>'+CONFIG.MONTHS[i2].label+'</th>';
        html+='<th class="bn-subtotal-col">小計②<br><span class="bn-subtotal-sub">(4〜2月)</span></th>';
        html+='<th>'+CONFIG.MONTHS[11].label+'</th>';
        html+='<th class="bn-total-col">総計<br><span class="bn-subtotal-sub">(年間)</span></th>';
        html+='</tr>';
        return html;
    }

    // ★基準勤務時間（正規基準）の固定行。出勤率の分母そのものなので、この行自体には出勤率は表示しない。
    function buildRefBaseRow(refBase){
        var html='<tr class="bn-ref-row"><td class="bn-name-cell">基準勤務時間<br><span class="bn-ref-sub">(正規職員基準)</span></td>';
        for(var i=0;i<4;i++)html+='<td>'+round1(refBase[CONFIG.MONTHS[i].m])+'h</td>';
        var sub1=sumRangeMap(refBase,RANGE1);
        html+='<td class="bn-subtotal-col">'+round1(sub1)+'h</td>';
        for(var i2=4;i2<11;i2++)html+='<td>'+round1(refBase[CONFIG.MONTHS[i2].m])+'h</td>';
        var sub2=sumRangeMap(refBase,RANGE2);
        html+='<td class="bn-subtotal-col">'+round1(sub2)+'h</td>';
        html+='<td>'+round1(refBase[3])+'h</td>';
        var total=sumRangeMap(refBase,RANGE_ALL);
        html+='<td class="bn-total-col">'+round1(total)+'h</td>';
        html+='</tr>';
        return html;
    }

    function cellClass(effVal,baseHours,isOverridden){
        var cls='bn-cell';
        if(isOverridden)cls+=' bn-cell-override';
        if(effVal!==null&&baseHours>0){
            var diff=effVal-baseHours;
            if(Math.abs(diff)>0.05){cls+=(diff>0?' bn-cell-over':' bn-cell-under');}
        }
        return cls;
    }
    function buildMonthCell(row,month){
        var detail=row.monthly[month];
        var ov=state.overrides[row.name]&&state.overrides[row.name][month];
        var isOv=(ov!==undefined&&ov!==null);
        var eff=effectiveValue(row.name,month,detail);
        var baseHours=detail?detail.baseHours:0;
        var cls=cellClass(eff,baseHours,isOv);
        var disp=eff===null?'-':(round1(eff)+'h'+(isOv?' \u270f':''));
        return '<td class="'+cls+'" data-bn-cell="1" data-staff="'+esc(row.name)+'" data-month="'+month+'" style="cursor:pointer;">'+disp+'</td>';
    }

    function buildEmployeeRow(row,refBase,isGroupStart){
        var badgeClass=row.group==='正規'?'seiki':row.group==='嘱託'?'shokutaku':'hijo';
        var badge=isGroupStart?('<span class="bn-group-badge bn-group-badge-'+badgeClass+'">'+esc(row.group)+'</span>'):'';
        var html='<tr><td class="bn-name-cell">'+badge+esc(row.name)+'</td>';
        for(var i=0;i<4;i++)html+=buildMonthCell(row,CONFIG.MONTHS[i].m);
        var sub1=sumRange(row,RANGE1), sub1Base=sumRangeMap(refBase,RANGE1);
        html+='<td class="bn-subtotal-col">'+round1(sub1)+'h<br><span class="bn-rate">'+rateStr(sub1,sub1Base)+'</span></td>';
        for(var i2=4;i2<11;i2++)html+=buildMonthCell(row,CONFIG.MONTHS[i2].m);
        var sub2=sumRange(row,RANGE2), sub2Base=sumRangeMap(refBase,RANGE2);
        html+='<td class="bn-subtotal-col">'+round1(sub2)+'h<br><span class="bn-rate">'+rateStr(sub2,sub2Base)+'</span></td>';
        html+=buildMonthCell(row,3);
        var total=sumRange(row,RANGE_ALL), totalBase=sumRangeMap(refBase,RANGE_ALL);
        html+='<td class="bn-total-col">'+round1(total)+'h<br><span class="bn-rate">'+rateStr(total,totalBase)+'</span></td>';
        html+='</tr>';
        return html;
    }

    function findRow(staffName){
        for(var i=0;i<state.rows.length;i++)if(state.rows[i].name===staffName)return state.rows[i];
        return null;
    }

    function showCellPopup(staffName,month){
        var row=findRow(staffName); if(!row)return;
        var detail=row.monthly[month];
        var ov=state.overrides[staffName]&&state.overrides[staffName][month];
        var isOv=(ov!==undefined&&ov!==null);
        var eff=effectiveValue(staffName,month,detail);
        var monthLabel=month+'月';

        var breakdownHtml;
        if(detail){
            breakdownHtml='<div style="font-size:13px;color:#555;line-height:1.8;background:#f7f9fc;border-radius:6px;padding:10px 12px;">'
                +'勤務h '+round1(detail.wh)+' ＋ 有給h '+round1(detail.yh)
                +' ＋ 有給'+round1(detail.yd)+'日×'+round1(detail.perDayHr)+'h('+round1(detail.ydHr)+'h)'
                +' ＋ 特別休暇'+round1(detail.toku)+'日×'+round1(detail.perDayHr)+'h('+round1(detail.tokuHr)+'h)'
                +' ＋ 夏季休暇'+round1(detail.kaki)+'日×'+round1(detail.perDayHr)+'h('+round1(detail.kakiHr)+'h)'
                +'<br>＝ <b>計算値 '+round1(detail.total)+'h</b>'
                +'<br>基準時間：<b>'+round1(detail.baseHours)+'h</b>'
                +'</div>';
        }else{
            breakdownHtml='<div style="font-size:13px;color:#999;background:#f7f9fc;border-radius:6px;padding:10px 12px;">この月のデータはありません（未取込・入社前など）</div>';
        }

        var diffHtml='';
        if(detail&&detail.baseHours>0&&eff!==null){
            var diff=eff-detail.baseHours;
            var diffLabel=Math.abs(diff)<=0.05?'基準時間と同じ':(diff>0?round1(Math.abs(diff))+'h 多い':round1(Math.abs(diff))+'h 少ない');
            var diffColor=Math.abs(diff)<=0.05?'#5cb85c':(diff>0?'#e0973c':'#d9534f');
            diffHtml='<div style="font-size:18px;font-weight:bold;color:'+diffColor+';text-align:center;margin:10px 0;">'+esc(diffLabel)+'</div>';
        }

        var overrideNote=isOv?('<div style="font-size:12px;color:#7b3fa0;background:#f3e9fb;border-radius:6px;padding:6px 10px;margin-top:8px;">手入力中：<b>'+round1(parseFloat(ov))+'h</b>（元の計算値：'+(detail?round1(detail.total)+'h':'データなし')+'）</div>'):'';

        var baseBtnHtml=(detail&&detail.baseHours>0)?'<button class="bn-btn" id="bn-ov-tobase">基準時間にする</button>':'';

        var dlg=document.createElement('div');dlg.className='bn-dialog-overlay';
        dlg.innerHTML='<div class="bn-dialog" style="min-width:280px;max-width:360px;">'
            +'<h3 style="font-size:16px;margin:0 0 4px 0;">'+monthLabel+' の実労働時間</h3>'
            +'<div style="font-size:13px;color:#666;margin-bottom:10px;">'+esc(staffName)+'</div>'
            +breakdownHtml
            +diffHtml
            +overrideNote
            +'<div style="margin-top:14px;">'
            +'<label style="font-size:13px;color:#555;">手入力で変更（空欄で保存すると解除されます）</label>'
            +'<div style="display:flex;gap:8px;margin-top:6px;">'
            +'<input type="number" step="0.1" id="bn-override-input" value="'+(isOv?round1(parseFloat(ov)):'')+'" placeholder="時間(h)" style="flex:1;font-size:16px;padding:8px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;">'
            +'</div>'
            +(baseBtnHtml?'<div style="margin-top:8px;">'+baseBtnHtml+'</div>':'')
            +'</div>'
            +'<div class="bn-dialog-buttons">'
            +'<button class="bn-btn" id="bn-ov-close">閉じる</button>'
            +'<button class="bn-btn bn-btn-primary" id="bn-ov-save">保存</button>'
            +'</div></div>';
        document.body.appendChild(dlg);
        function closeOv(){if(dlg.parentNode)dlg.parentNode.removeChild(dlg);}
        dlg.querySelector('#bn-ov-close').addEventListener('click',closeOv);
        dlg.addEventListener('click',function(e){if(e.target===dlg)closeOv();});
        function doSave(val,btn){
            btn.disabled=true;var origText=btn.textContent;btn.textContent='保存中...';
            saveBonusOverride(staffName,month,val).then(function(){
                if(!state.overrides[staffName])state.overrides[staffName]={};
                if(val===null)delete state.overrides[staffName][month];
                else state.overrides[staffName][month]=val;
                closeOv();
                var el=document.getElementById('bn-dashboard');if(el)renderDashboard(el);
            }).catch(function(err){alert('保存エラー:\n'+(err.message||JSON.stringify(err)));btn.disabled=false;btn.textContent=origText;});
        }
        dlg.querySelector('#bn-ov-save').addEventListener('click',function(){
            var input=dlg.querySelector('#bn-override-input');
            var raw=input.value.trim();
            var val=raw===''?null:parseFloat(raw);
            if(raw!==''&&isNaN(val)){alert('数値を入力してください');return;}
            doSave(val,this);
        });
        var toBaseBtn=dlg.querySelector('#bn-ov-tobase');
        if(toBaseBtn)toBaseBtn.addEventListener('click',function(){
            doSave(round1(detail.baseHours),this);
        });
    }

    function renderTable(container){
        var data=state.rows;
        var html='<div class="bn-table-wrap"><table class="bn-table"><thead>'+buildHeaderRow()+'</thead><tbody>';
        html+=buildRefBaseRow(state.refBase);
        var prevGroup=null;
        for(var i=0;i<data.length;i++){
            var row=data[i];
            var isStart=(row.group!==prevGroup);
            prevGroup=row.group;
            html+=buildEmployeeRow(row,state.refBase,isStart);
        }
        html+='</tbody></table></div>';
        return html;
    }

    function renderDashboard(container){
        var html='<div class="bn-year-nav"><button id="bn-prev-year">\u25c0</button>'
            +'<span class="bn-year-label">'+state.currentYear+'年度</span>'
            +'<button id="bn-next-year">\u25b6</button></div>';
        html+='<div class="bn-hint">実労働時間(有給含む) ＝ 勤務h＋有給h＋有給日数×基準内時間＋特別休暇×基準内時間＋夏季休暇×基準内時間　／　出勤率 ＝ 実労働時間 ÷ 基準勤務時間(正規基準)</div>';
        html+='<div class="bn-legend">'
            +'<div class="bn-legend-item"><div class="bn-legend-box" style="background:#ffe6c2;"></div>自分の基準時間より多い</div>'
            +'<div class="bn-legend-item"><div class="bn-legend-box" style="background:#ffd9d9;"></div>自分の基準時間より少ない</div>'
            +'<div class="bn-legend-item"><div class="bn-legend-box" style="background:#fff;box-shadow:inset 0 0 0 2px #9b59b6;"></div>手入力で変更中（タップで元の値を確認）</div>'
            +'</div>';
        if(!state.rows||state.rows.length===0){
            html+='<div class="bn-empty">この年度のスタッフ明細データがありません。タイムカードアプリで「データ取得」を実行してください。</div>';
        }else{
            html+=renderTable(container);
        }
        container.innerHTML=html;
        attachEvents(container);
    }

    var delegatedBound=false;
    function attachEvents(c){
        var pb=document.getElementById('bn-prev-year'), nb=document.getElementById('bn-next-year');
        if(pb)pb.addEventListener('click',function(){state.currentYear--;loadRender(c);});
        if(nb)nb.addEventListener('click',function(){state.currentYear++;loadRender(c);});
        if(!delegatedBound){
            delegatedBound=true;
            c.addEventListener('click',function(e){
                var el=e.target.closest?e.target.closest('[data-bn-cell]'):null;
                if(!el)return;
                showCellPopup(el.getAttribute('data-staff'),parseInt(el.getAttribute('data-month'),10));
            });
        }
    }

    function loadRender(c){
        state.loading=true;
        c.innerHTML='<div class="bn-loading">読み込み中...</div>';
        Promise.all([fetchYearStaff(state.currentYear),fetchMgmt(state.currentYear)]).then(function(results){
            var d=results[0], mgmt=results[1];
            var processed=processRecords(d.records||[]);
            state.rows=processed.rows;
            state.refBase=processed.refBase;
            state.mgmt=mgmt;
            state.overrides=getBonusOverrides(mgmt);
            state.loading=false;
            renderDashboard(c);
        }).catch(function(e){
            state.loading=false;
            var msg=(e&&e.message)?e.message:JSON.stringify(e);
            c.innerHTML='<div class="bn-year-nav"><button id="bn-prev-year">\u25c0</button>'
                +'<span class="bn-year-label">'+state.currentYear+'年度</span>'
                +'<button id="bn-next-year">\u25b6</button></div>'
                +'<div class="bn-error"><b>エラー</b><br>'+esc(msg)+'</div>';
            attachEvents(c);
        });
    }

    kintone.events.on('app.record.index.show', function(event){
        var el=document.getElementById('bn-dashboard');
        if(!el)return event;
        loadRender(el);
        return event;
    });
})();
