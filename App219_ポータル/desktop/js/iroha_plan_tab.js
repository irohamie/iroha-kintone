/* =========================================================================
   【追加機能②】「担当更新」タブ（アプリ219 ポータル用 追加JS その2）
   =========================================================================
   ・v2: アイコン変更（☐/✅/NEW）、児童名クリックでアプリ10へ遷移
   -------------------------------------------------------------------------
   【今回のバグ修正】
   ・契約初年度など、初回の期間が短縮された変則的なケースで、
     次の前期の完了判定（前期案＋直前の後期評価案の両方が必要）が
     「6か月前ちょうど」の日付でしか後期レコードを探していなかった
     ため、直前の後期評価案が見つからず✅が付かない不具合を修正。
     → tabFindNewUserRecs にフォールバック（前期/後期どちらかの開始日
       しか入っていない同一レコードも対象にする）を追加。
     → 新規利用者の簡易判定でも、開始日フィールドの検索窓に
       引っかからない場合は日付完全一致マップにもフォールバックする。
     → 前期の完了判定に、
       ①同一レコード自身に後期評価案が入っていないか
       ②それでも無ければ、対象月より前で直近の後期計画開始日を持つ
         レコード
       の2段階フォールバックを追加した。
   ========================================================================= */
(function () {
  'use strict';

  const TF = {
    APP_JIDOU:   10,
    APP_KEIKAKU: 207,
    J_NAME:     '児童氏名',
    J_KANA:     '児童フリガナ',
    J_PLAN:     '支援計画',
    J_TANTOU:   '担当',
    J_STATUS:   '利用状況',
    J_BIRTH:    '誕生日',
    J_CONTRACT: '契約日',
    STATUS_ACTIVE: '利用中',
    K_NAME:              '氏名',
    K_BIRTH:             '生年月日',
    K_ZENKI_START:       '前期計画開始',
    K_KOUKI_START:       '後期計画開始',
    K_ZENKI_PLAN:        '前期案',
    K_ZENKI_EVAL:        '前期評価案',
    K_KOUKI_PLAN:        '後期案',
    K_KOUKI_EVAL:        '後期評価案',
    K_ZENKI_SIGNED:      '前期サイン済',
    K_ZENKI_EVAL_SIGNED: '前期評価サイン済',
    K_KOUKI_SIGNED:      '後期サイン済',
    K_KOUKI_EVAL_SIGNED: '後期評価サイン済',
  };

  const TAB_KEIKAKU_REQUIRE_EVAL = true;
  const UPDATE_INTERVAL = 6;
  const TAB_NAME = '担当更新';
  const TAB_MONTHS_HALF = 5;
  const KINTONE_BASE = 'https://' + location.hostname;
  const IROHA_TAB_LABEL = 'いろ葉';
  const TAB_WAIT_TIMEOUT_MS = 8000;

  let tabRendered = false;
  let tabAllowed = false;

  function shiftMonths(y, m, d) { var i = y*12+(m-1)+d; return{year:Math.floor(i/12),month:(i%12)+1}; }
  function firstDateStr(y, m) { return y+'-'+String(m).padStart(2,'0')+'-01'; }
  function parsePlanMonths(s) { if(!s)return null;var mm=String(s).match(/(\d{1,2})\s*月/g);if(!mm||mm.length<2)return null;var nums=mm.map(function(x){return parseInt(x,10);}).filter(function(n){return n>=1&&n<=12;});return nums.length>=2?[nums[0],nums[1]]:null; }
  function hasFile(r,fc) { if(!r)return false;var f=r[fc];return!!(f&&f.value&&Array.isArray(f.value)&&f.value.length>0); }
  function escapeQ(s) { return String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"'); }
  function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function isFirstUpdate(cd,tY,tM) { if(!cd)return false;var p=String(cd).split('-');var cy=parseInt(p[0],10),cm=parseInt(p[1],10);if(isNaN(cy)||isNaN(cm))return false;return(cy*12+(cm-1))>=(tY*12+(tM-1)-(UPDATE_INTERVAL-1))&&(cy*12+(cm-1))<=(tY*12+(tM-1)); }
  function buildMessage(col,keikaku,kondan,today) {
    var day=today.getDate(),msgs=[];
    if(col==='prev'){if(!keikaku)msgs.push({level:'danger',text:'支援計画が保存されていません。確認してください。'});if(kondan===false)msgs.push({level:'warn',text:'保護者側の都合で懇談日程が決まらない・キャンセルがあった場合は、記録に残してください。'});}
    if(col==='curr'){if(!keikaku)msgs.push({level:'danger',text:'支援計画が保存されていません。確認してください。'});if(kondan===false&&day>=21)msgs.push({level:'warn',text:'懇談後のPDF保存し忘れがないか確認してください。'});}
    if(col==='next'){if(!keikaku&&day>=21)msgs.push({level:'warn',text:'提出期限を過ぎています。計画のPDF保存を確認してください。'});}
    return msgs;
  }
  function sortScore(it,sk) { if(!it.keikaku)return 0;if(sk&&!it.kondan)return 1;return 2; }

  /* ===== ポップアップへの案内文 ===== */
  function injectNoteIntoPopup(overlay) {
    if(!tabAllowed||!overlay)return;var noteEl=overlay.querySelector('.ipp-note');
    if(!noteEl||noteEl.dataset.tabNoteAdded)return;noteEl.dataset.tabNoteAdded='1';
    noteEl.innerHTML+=('<span class="ipp-tab-note">　📌「'+escapeHtml(TAB_NAME)+'」タブからいつでも確認できます。</span>');
  }
  function watchPopupAndInjectNote() {
    injectNoteIntoPopup(document.getElementById('iroha-plan-popup-overlay'));
    new MutationObserver(function(muts){muts.forEach(function(m){m.addedNodes.forEach(function(n){if(n&&n.id==='iroha-plan-popup-overlay')injectNoteIntoPopup(n);});});}).observe(document.body,{childList:true,subtree:false});
  }

  async function tabFetchAll(app,bq) { var all=[],o=0;while(true){var r=await kintone.api(kintone.api.url('/k/v1/records',true),'GET',{app:app,query:bq+' limit 500 offset '+o});all=all.concat(r.records);if(r.records.length<500)break;o+=500;if(o>9500)break;}return all; }

  /* ===== 拡張タブ登録 ===== */
  window.IROHA_EXTRA_TABS = window.IROHA_EXTRA_TABS || [];
  window.IROHA_EXTRA_TABS.push({ id: 'iroha_tantou_koshin', label: TAB_NAME,
    canView: function(ctx) { return tkCanView(ctx); },
    render: function(container) { renderTantouKoshin(container); }
  });
  let tkCache = null;

  function tkCanView(ctx) {
    try {
      if(ctx&&Array.isArray(ctx.configData)){
        var target=IROHA_TAB_LABEL.replace(/\s+/g,'');var iroha=null;
        for(var i=0;i<ctx.configData.length;i++){var t=ctx.configData[i];if(!t)continue;var lbl=(t.label||'').replace(/\s+/g,'');if(t.id==='tab1'||lbl===target){iroha=t;break;}}
        if(!iroha)return false;if(!iroha.users||iroha.users.length===0)return true;return iroha.users.indexOf(ctx.myCode)!==-1;
      }
    }catch(e){console.error('[担当更新タブ]',e);}
    return tabUserHasIrohaTab();
  }

  kintone.events.on('app.record.index.show', async (event) => {
    if(!document.getElementById('iroha-portal'))return event;if(tabRendered)return event;tabRendered=true;
    injectTabStyle();watchPopupAndInjectNote();
    try{await waitForPortalTabs(TAB_WAIT_TIMEOUT_MS);if(tabUserHasIrohaTab()){tabAllowed=true;injectNoteIntoPopup(document.getElementById('iroha-plan-popup-overlay'));}}catch(e){}
    return event;
  });

  function waitForPortalTabs(ms){return new Promise(function(resolve){var p=document.getElementById('iroha-portal');if(!p){resolve(false);return;}var ir=function(){var c=findTabContainer();return!!(c&&c.querySelectorAll('.tab-item,.tab-name,li,a,button,[role="tab"]').length>0);};if(ir()){resolve(true);return;}var done=false,obs=null;var fin=function(v){if(done)return;done=true;try{if(obs)obs.disconnect();}catch(e){}resolve(v);};obs=new MutationObserver(function(){if(ir())fin(true);});obs.observe(p,{childList:true,subtree:true});setTimeout(function(){fin(ir());},ms||8000);});}

  function tabUserHasIrohaTab(){var scope=document.getElementById('iroha-tabs')||findTabContainer()||document.getElementById('iroha-portal');if(!scope)return false;var target=IROHA_TAB_LABEL.replace(/\s+/g,'');var tns=scope.querySelectorAll('.tab-name');for(var i=0;i<tns.length;i++){var txt=(tns[i].textContent||'').replace(/\s+/g,'');if(!txt||txt===TAB_NAME)continue;if(txt===target||txt.indexOf(target)!==-1)return true;}return false;}
  function findTabContainer(){var b=document.getElementById('iroha-tabs');if(b)return b;var p=document.getElementById('iroha-portal');if(!p)return null;var ss=['.tabs-navi','.tab-list','.tab-navi','ul[role="tablist"]','.tabs','ul.tab'];for(var i=0;i<ss.length;i++){var el=p.querySelector(ss[i]);if(el)return el;}return p.querySelector('ul');}

  function renderTantouKoshin(container){injectTabStyle();container.innerHTML='<div class="itab-wrap"><div class="itab-loading">読み込み中…</div></div>';loadTantouKoshinData(container);}

  async function loadTantouKoshinData(container){
    try{
      var data=tkCache;if(!data){data=await fetchTantouKoshinData();tkCache=data;}
      if(!data.hasChildren){container.innerHTML='<div class="itab-wrap">'+buildLinksHtml()+'<div class="itab-empty">担当中の利用児童はいません。</div></div>';return;}
      renderTabContent(container,data.monthData,data.months,data.baseYear,data.baseMonth);
    }catch(e){container.innerHTML='<div class="itab-wrap"><div class="itab-error">エラー: '+escapeHtml(String(e))+'</div></div>';console.error('[担当更新タブ]',e);}
  }

  async function fetchTantouKoshinData(){
    var q10=TF.J_STATUS+' in ("'+escapeQ(TF.STATUS_ACTIVE)+'") and '+TF.J_TANTOU+' in (LOGINUSER()) order by $id asc';
    var jidouRecords=await tabFetchAll(TF.APP_JIDOU,q10);
    var now=new Date(),bY=now.getFullYear(),bM=now.getMonth()+1;
    if(!jidouRecords.length)return{hasChildren:false,baseYear:bY,baseMonth:bM};
    var months=[];for(var d=-TAB_MONTHS_HALF;d<=TAB_MONTHS_HALF;d++)months.push(shiftMonths(bY,bM,d));
    var names=Array.from(new Set(jidouRecords.map(function(r){return r[TF.J_NAME]?(r[TF.J_NAME].value||''):'';}).filter(Boolean)));
    var records207=[];
    for(var i=0;i<names.length;i+=100){var chunk=names.slice(i,i+100);var inL=chunk.map(function(n){return '"'+escapeQ(n)+'"';}).join(',');records207=records207.concat(await tabFetchAll(TF.APP_KEIKAKU,TF.K_NAME+' in ('+inL+') order by $id asc'));}
    var maps=tabBuildMaps(records207);
    var monthData=buildMonthData(jidouRecords,months,maps,bY,bM,now);
    return{hasChildren:true,monthData:monthData,months:months,baseYear:bY,baseMonth:bM};
  }

  function tabBuildMaps(records207){
    var zM={},kM={},aP={};
    records207.forEach(function(r){var nm=r[TF.K_NAME]?r[TF.K_NAME].value||'':'',bd=r[TF.K_BIRTH]?r[TF.K_BIRTH].value||'':'';var zs=r[TF.K_ZENKI_START]?r[TF.K_ZENKI_START].value||'':'',ks=r[TF.K_KOUKI_START]?r[TF.K_KOUKI_START].value||'':'';
      if(zs){var k=nm+'|'+bd+'|'+zs;if(!zM[k])zM[k]=[];zM[k].push(r);}if(ks){var k2=nm+'|'+bd+'|'+ks;if(!kM[k2])kM[k2]=[];kM[k2].push(r);}var pk=nm+'|'+bd;if(!aP[pk])aP[pk]=[];aP[pk].push(r);});
    return{zenkiMultiMap:zM,koukiMultiMap:kM,allByPerson:aP};
  }
  function tabFindNewUserRecs(nm,bd,tY,tM,type,maps){
    var rs=maps.allByPerson[nm+'|'+bd];if(!rs||!rs.length)return[];
    var ti=tY*12+(tM-1),sf=(type==='zenki')?TF.K_ZENKI_START:TF.K_KOUKI_START,found=[];
    rs.forEach(function(r){var sv=r[sf]?r[sf].value||'':'';if(!sv)return;var p=sv.split('-');var ri=parseInt(p[0],10)*12+(parseInt(p[1],10)-1);if(Math.abs(ti-ri)<=UPDATE_INTERVAL)found.push(r);});
    /* フォールバック：変則的な初回レコードで、前期/後期どちらか一方の
       開始日しか入力されていない場合にも対象レコードを拾う */
    if(found.length===0){
      var altSf=(type==='zenki')?TF.K_KOUKI_START:TF.K_ZENKI_START;
      rs.forEach(function(r){
        if(r[sf]&&r[sf].value)return;
        var av=r[altSf]?r[altSf].value||'':'';
        if(!av)return;
        var p=av.split('-');
        var ai=parseInt(p[0],10)*12+(parseInt(p[1],10)-1);
        if(Math.abs(ti-ai)<=UPDATE_INTERVAL)found.push(r);
      });
    }
    return found;
  }
  function tabFindClosestPriorKouki(nm,bd,tY,tM,maps){
    var rs=maps.allByPerson[nm+'|'+bd];if(!rs||!rs.length)return null;
    var tIdx=tY*12+(tM-1),best=null,bestIdx=-Infinity;
    rs.forEach(function(r){
      var ks=r[TF.K_KOUKI_START]?r[TF.K_KOUKI_START].value||'':'';
      if(!ks)return;
      var p=ks.split('-');
      var kIdx=parseInt(p[0],10)*12+(parseInt(p[1],10)-1);
      if(kIdx<tIdx&&kIdx>bestIdx){bestIdx=kIdx;best=r;}
    });
    return best;
  }
  function tabHasFileAny(recs,fc){return recs&&recs.some(function(r){return hasFile(r,fc);});}

  function buildMonthData(jidouRecords,months,maps,baseYear,baseMonth,today){
    var monthData=months.map(function(){return{items:[],errorNames:[]};});
    jidouRecords.forEach(function(r){
      var name=r[TF.J_NAME]?r[TF.J_NAME].value||'':'',kana=r[TF.J_KANA]?r[TF.J_KANA].value||'':'';
      var planStr=r[TF.J_PLAN]?r[TF.J_PLAN].value||'':'',birth=r[TF.J_BIRTH]?r[TF.J_BIRTH].value||'':'';
      var contractDate=r[TF.J_CONTRACT]?r[TF.J_CONTRACT].value||'':'';
      var recId=r.$id?r.$id.value:'';
      if(!name||!birth)return;var pm=parsePlanMonths(planStr);if(!pm)return;
      var bm=parseInt(String(birth).split('-')[1],10),zMo=null,kMo=null;
      if(bm===pm[0]){zMo=pm[0];kMo=pm[1];}else if(bm===pm[1]){zMo=pm[1];kMo=pm[0];}
      else{var ci=months.findIndex(function(t){return t.year===baseYear&&t.month===baseMonth;});if(ci>=0)monthData[ci].errorNames.push(name);return;}

      months.forEach(function(t,idx){
        var type=null;if(t.month===zMo)type='zenki';else if(t.month===kMo)type='kouki';if(!type)return;
        var rel=(t.year*12+t.month-1)-(baseYear*12+baseMonth-1);
        var isPrev=rel===-1,isCurr=rel===0,isNext=rel===1,isPCN=isPrev||isCurr||isNext;
        var keikaku=null,kondan=null,evalNew=false,errorMsg=null,msgs=[];

        if(isPCN){
          var ts=firstDateStr(t.year,t.month),colL=isPrev?'prev':isCurr?'curr':'next';
          var isNew=isFirstUpdate(contractDate,t.year,t.month);
          if(isNew){
            evalNew=true;
            var nrs=tabFindNewUserRecs(name,birth,t.year,t.month,type,maps),rec=nrs.length?nrs[0]:null;
            /* フォールバック：新規判定の検索窓で見つからない場合、日付完全一致の
               マップにも該当レコードがあれば拾う */
            if(!rec){
              var mapNewFallback=(type==='zenki')?maps.zenkiMultiMap:maps.koukiMultiMap;
              var recsNewFallback=mapNewFallback[name+'|'+birth+'|'+ts]||[];
              rec=recsNewFallback[0]||null;
            }
            if(type==='zenki'){keikaku=hasFile(rec,TF.K_ZENKI_PLAN);kondan=hasFile(rec,TF.K_ZENKI_SIGNED);}
            else{keikaku=hasFile(rec,TF.K_KOUKI_PLAN);kondan=hasFile(rec,TF.K_KOUKI_SIGNED);}
          }else if(type==='zenki'){
            var crs=maps.zenkiMultiMap[name+'|'+birth+'|'+ts]||[];
            if(colL!=='next'){if(crs.length===0)errorMsg='計画レコードが見つかりません';else if(crs.length>1)errorMsg='計画レコードが重複しています';}
            if(!errorMsg){
              var cur=crs[0]||null;
              var ps=shiftMonths(t.year,t.month,-6);
              var prs=maps.koukiMultiMap[name+'|'+birth+'|'+firstDateStr(ps.year,ps.month)]||[];
              /* フォールバック①：前期と後期が同一レコードに同居する変則的な
                 最初のレコードに対応。6か月前ちょうどの後期レコードが
                 見つからない場合、まずレコード自身の後期評価案を確認する。 */
              if(prs.length===0&&cur&&hasFile(cur,TF.K_KOUKI_EVAL)){prs=[cur];}
              /* フォールバック②：それでも見つからなければ、対象月より前で
                 直近の後期計画開始日を持つレコードを採用する。 */
              if(prs.length===0){
                var fallbackPrev=tabFindClosestPriorKouki(name,birth,t.year,t.month,maps);
                if(fallbackPrev)prs=[fallbackPrev];
              }
              keikaku=TAB_KEIKAKU_REQUIRE_EVAL?(hasFile(cur,TF.K_ZENKI_PLAN)&&tabHasFileAny(prs,TF.K_KOUKI_EVAL)):hasFile(cur,TF.K_ZENKI_PLAN);
              kondan=hasFile(cur,TF.K_ZENKI_SIGNED)&&tabHasFileAny(prs,TF.K_KOUKI_EVAL_SIGNED);
            }
          }else{
            var crs2=maps.koukiMultiMap[name+'|'+birth+'|'+firstDateStr(t.year,t.month)]||[];
            if(colL!=='next'){if(crs2.length===0)errorMsg='計画レコードが見つかりません';else if(crs2.length>1)errorMsg='計画レコードが重複しています';}
            if(!errorMsg){var cur2=crs2[0]||null;
              keikaku=TAB_KEIKAKU_REQUIRE_EVAL?(hasFile(cur2,TF.K_KOUKI_PLAN)&&tabHasFileAny(crs2,TF.K_ZENKI_EVAL)):hasFile(cur2,TF.K_KOUKI_PLAN);
              kondan=hasFile(cur2,TF.K_KOUKI_SIGNED)&&tabHasFileAny(crs2,TF.K_ZENKI_EVAL_SIGNED);}
          }
          if(!errorMsg){var kfm=isNext?null:kondan;msgs=buildMessage(colL,keikaku,kfm,today);if(isNext)kondan=null;}
        }
        monthData[idx].items.push({name:name,kana:kana,recId:recId,isPrevCurrNext:isPCN,keikaku:keikaku,kondan:kondan,evalNew:evalNew,errorMsg:errorMsg,msgs:msgs,type:type});
      });
    });
    monthData.forEach(function(md,idx){var rel=(months[idx].year*12+months[idx].month-1)-(baseYear*12+baseMonth-1);var sk=rel!==1;
      md.items.sort(function(a,b){if(a.isPrevCurrNext&&b.isPrevCurrNext){var sa=a.errorMsg?0:sortScore(a,sk);var sb=b.errorMsg?0:sortScore(b,sk);if(sa!==sb)return sa-sb;}return(a.kana||a.name).localeCompare(b.kana||b.name,'ja');});});
    return monthData;
  }

  function buildLinksHtml(){return '<div class="itab-links"><a class="itab-link-btn" href="'+KINTONE_BASE+'/k/'+TF.APP_JIDOU+'/" target="_blank">👦 利用者リスト</a><a class="itab-link-btn" href="'+KINTONE_BASE+'/k/'+TF.APP_KEIKAKU+'/" target="_blank">📄 個別支援計画</a></div>';}

  function renderTabContent(contentArea,monthData,months,baseYear,baseMonth){
    var linksHtml=buildLinksHtml();
    var cardsHtml=months.map(function(t,idx){
      var rel=(t.year*12+t.month-1)-(baseYear*12+baseMonth-1);
      var isCurr=rel===0,isPrev=rel===-1,isNext=rel===1;var showKondan=!isNext;var md=monthData[idx];
      var label=t.year+'年'+t.month+'月';
      if(isCurr)label+='<span class="itab-badge itab-badge-curr">今月</span>';
      else if(isPrev)label+='<span class="itab-badge itab-badge-prev">前月</span>';
      else if(isNext)label+='<span class="itab-badge itab-badge-next">来月</span>';

      var itemsHtml='';
      if(!md.items.length&&!md.errorNames.length){itemsHtml='<div class="itab-noitem">対象なし</div>';}
      else{
        itemsHtml=md.items.map(function(it){
          var nameHtml=it.recId
            ?'<a class="itab-rname itab-rname-link" href="'+KINTONE_BASE+'/k/'+TF.APP_JIDOU+'/show#record='+it.recId+'" target="_blank">'+escapeHtml(it.name)+'</a>'
            :'<span class="itab-rname">'+escapeHtml(it.name)+'</span>';
          if(!it.isPrevCurrNext)return '<div class="itab-row itab-row-simple">'+nameHtml+'</div>';
          if(it.errorMsg)return '<div class="itab-row itab-row-ng">'+nameHtml+'<span class="itab-rmarks"><span class="itab-ng">⚠️</span> '+escapeHtml(it.errorMsg)+'</span></div>';
          var allDone=sortScore(it,showKondan)===2;
          var kMk=it.keikaku?'<span class="itab-ok">✅</span>':'<span class="itab-pending"></span>';
          var keikakuHtml='計画'+kMk;
          var kondanHtml=showKondan?' ｜ 懇談'+(it.kondan?'<span class="itab-ok">✅</span>':'<span class="itab-pending"></span>'):'';
          var newHtml=it.evalNew?'<span class="itab-new-label">NEW</span>':'';
          var msgsHtml='';if(it.msgs&&it.msgs.length)msgsHtml=it.msgs.map(function(m){return '<div class="itab-msg itab-msg-'+m.level+'">'+escapeHtml(m.text)+'</div>';}).join('');
          return '<div class="itab-row'+(allDone?'':' itab-row-ng')+'">'+nameHtml+'<span class="itab-rmarks">'+keikakuHtml+kondanHtml+newHtml+'</span>'+msgsHtml+'</div>';
        }).join('');
        if(md.errorNames.length)itemsHtml+=md.errorNames.map(function(n){return '<div class="itab-row itab-row-err">⚠️ '+escapeHtml(n)+'：要確認</div>';}).join('');
      }

      return '<div class="itab-card'+(isCurr?' itab-card-curr':'')+(isPrev?' itab-card-prev':'')+(isNext?' itab-card-next':'')+'"><div class="itab-card-head">'+label+'</div><div class="itab-card-body">'+itemsHtml+'</div></div>';
    }).join('');

    contentArea.innerHTML='<div class="itab-wrap">'+linksHtml+'<div class="itab-scroll-wrap"><div class="itab-cards">'+cardsHtml+'</div></div></div>';
    requestAnimationFrame(function(){var cc=contentArea.querySelector('.itab-card-curr');if(cc){var w=contentArea.querySelector('.itab-scroll-wrap');w.scrollLeft=cc.offsetLeft-(w.offsetWidth/2)+(cc.offsetWidth/2);}});
  }

  function injectTabStyle(){
    if(document.getElementById('iroha-plan-tab-style'))return;
    var css=
      '.itab-wrap{padding:12px 4px 4px;}'+
      '.itab-loading{padding:20px;color:#888;font-size:14px;}'+
      '.itab-empty,.itab-error{padding:16px;color:#aaa;font-size:14px;}'+
      '.itab-error{color:#c0392b;}'+
      '.itab-links{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;padding:0 4px;}'+
      '.itab-link-btn{display:inline-flex;align-items:center;gap:6px;background:#5a8f5a;color:#fff;text-decoration:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;}'+
      '.itab-link-btn:hover{background:#4d7d4d;}'+
      '.itab-scroll-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:8px;}'+
      '.itab-cards{display:flex;gap:10px;align-items:flex-start;min-width:max-content;padding:4px;}'+
      '.itab-card{width:180px;border:1px solid #dde8dd;border-radius:10px;background:#fafcfa;flex-shrink:0;overflow:hidden;}'+
      '.itab-card-head{background:#e8f2e8;padding:8px 10px;font-size:13px;font-weight:700;color:#3a5a3a;display:flex;align-items:center;gap:6px;flex-wrap:wrap;}'+
      '.itab-card-body{padding:8px;min-height:40px;}'+
      '.itab-card-curr{border-color:#5a8f5a;border-width:2px;}'+
      '.itab-card-curr .itab-card-head{background:#5a8f5a;color:#fff;}'+
      '.itab-card-prev{border-color:#b0c8b0;}.itab-card-prev .itab-card-head{background:#d4e8d4;}'+
      '.itab-card-next{border-color:#c8d8c8;}.itab-card-next .itab-card-head{background:#dceadc;}'+
      '.itab-badge{font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;display:inline-block;line-height:1.4;}'+
      '.itab-badge-curr{background:#fff;color:#3a6a3a;}'+
      '.itab-badge-prev{background:#3a6a3a;color:#fff;}'+
      '.itab-badge-next{background:#6a9a6a;color:#fff;}'+
      '.itab-noitem{font-size:12px;color:#bbb;padding:4px 2px;}'+
      '.itab-row{font-size:12px;padding:5px 4px;border-radius:6px;margin-bottom:4px;line-height:1.4;color:#333;}'+
      '.itab-row-simple{color:#555;}'+
      '.itab-row-ng{background:#fff5f5;border:1px solid #ffd6d6;}'+
      '.itab-row-err{color:#c0392b;font-size:11px;}'+
      '.itab-rname{display:block;font-weight:600;word-break:break-all;}'+
      '.itab-rname-link{color:#2b6cb0;text-decoration:none;}.itab-rname-link:hover{text-decoration:underline;}'+
      '.itab-rmarks{display:block;color:#555;margin-top:2px;}'+
      '.itab-ok{color:#2e9e3f;}'+
      '.itab-pending{display:inline-block;width:13px;height:13px;border:2px solid #bbb;border-radius:3px;box-sizing:border-box;vertical-align:middle;}'+
      '.itab-ng{color:#e03131;font-weight:700;}'+
      '.itab-new-label{display:inline-block;background:#ff6b6b;color:#fff;font-size:10px;font-weight:800;padding:1px 5px;border-radius:3px;margin-left:3px;vertical-align:middle;letter-spacing:.5px;}'+
      '.itab-msg{font-size:11px;margin-top:3px;padding:3px 6px;border-radius:4px;line-height:1.5;}'+
      '.itab-msg-encourage{background:#e8f5e9;color:#2e7d32;border-left:3px solid #66bb6a;}'+
      '.itab-msg-info{background:#e3f2fd;color:#1565c0;border-left:3px solid #64b5f6;}'+
      '.itab-msg-warn{background:#fff8e1;color:#f57f17;border-left:3px solid #ffd54f;}'+
      '.itab-msg-danger{background:#fce4ec;color:#b71c1c;border-left:3px solid #ef9a9a;}'+
      '.ipp-tab-note{color:#5a8f5a;font-weight:600;}'+
      '@media(max-width:600px){.itab-card{width:155px;}.itab-links{gap:8px;}.itab-link-btn{font-size:12px;padding:7px 10px;}}';
    var st=document.createElement('style');st.id='iroha-plan-tab-style';st.textContent=css;document.head.appendChild(st);
  }
})();
