(function() {
  'use strict';

  const CONFIG_APP_ID = 219;
  const DEFAULT_PASS = "016838";

  let configData = [];
  let favorites = [];          
  
  let allApps = [];
  let allUsers = [];
  let currentTabId = localStorage.getItem('iroha_last_tab') || null;
  let isEditMode = false;
  let isFavEditMode = false; 
  let isFavTwoRowMode = localStorage.getItem('iroha_fav_2row_mode') === 'true'; 

  let globalRecordId = null;   
  let personalRecordId = null; 
  let sortableInstances = [];
  
  let editingTabIdForUsers = null;
  let editingIconCard = null;

  /* =====================================================================
     外部スクリプトが追加できる「拡張タブ」レジストリ
     ---------------------------------------------------------------------
     他のJSファイルが window.IROHA_EXTRA_TABS に
       { id, label, canView(ctx), render(container) }
     を push すると、このポータルが正式なタブとして描画・管理します。
       ctx = { configData, myCode }
     ===================================================================== */
  window.IROHA_EXTRA_TABS = window.IROHA_EXTRA_TABS || [];
  function getExtraTabs() { return window.IROHA_EXTRA_TABS || []; }
  function findExtraTab(id) { return getExtraTabs().find(function(t){ return t && t.id === id; }); }
  function extraTabCtx() {
    var code = '';
    try { code = kintone.getLoginUser().code; } catch(e) {}
    return { configData: configData, myCode: code };
  }
  function isExtraTabViewable(t, ctx) {
    if (!t || !t.id) return false;
    if (typeof t.canView === 'function') {
      try { return !!t.canView(ctx); } catch(e) { return false; }
    }
    return true;
  }

  const loadSortable = async () => {
    if (typeof Sortable === 'undefined') {
      await new Promise(r => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js'; s.onload = r; document.head.appendChild(s); });
    }
  };

  const resizeGridRows = () => {
    const container = document.querySelector('.apps-container');
    if (!container) return;
    const width = container.getBoundingClientRect().width;
    const cellWidth = (width - (12 * 6)) / 7; 
    const rowHeight = (cellWidth - 12) / 2;
    document.querySelectorAll('.apps-container').forEach(el => {
      el.style.setProperty('--row-height', rowHeight + 'px');
    });
  };

  window.addEventListener('resize', resizeGridRows);

  const clearInlineGridStyles = (container) => {
    container.querySelectorAll('.app-card:not(.sortable-drag)').forEach(card => {
      card.style.gridRow = '';
      card.style.gridColumn = '';
    });
  };

  const applyTetrisLayoutToContainer = (container) => {
    let cards = Array.from(container.querySelectorAll('.app-card:not(.sortable-drag)'));
    let grid = {}; 
    const isOcc = (r, c) => grid[`${r},${c}`];
    const setOcc = (r, c) => grid[`${r},${c}`] = true;
    let pendingHalfSlots = []; 
    
    cards.forEach(card => {
      if (card.style.display === 'none' && !card.classList.contains('sortable-fallback')) return;
      const isTetris = card.classList.contains('is-tetris');
      
      if (isTetris) {
        if (pendingHalfSlots.length > 0) {
          pendingHalfSlots.sort((a, b) => (a.r - b.r) || (a.c - b.c));
          let slot = pendingHalfSlots.shift();
          card.style.gridRow = `${slot.r} / span 1`;
          card.style.gridColumn = `${slot.c} / span 1`;
          setOcc(slot.r, slot.c);
        } else {
          let placed = false;
          for(let r = 1; r <= 100; r+=2) {
            if(placed) break;
            for(let c = 1; c <= 7; c++) {
              if(placed) break;
              if(!isOcc(r, c) && !isOcc(r+1, c)) {
                card.style.gridRow = `${r} / span 1`;
                card.style.gridColumn = `${c} / span 1`;
                setOcc(r, c);
                pendingHalfSlots.push({r: r+1, c: c});
                placed = true;
              }
            }
          }
        }
      } else {
        let placed = false;
        for(let r = 1; r <= 100; r+=2) {
          if(placed) break;
          for(let c = 1; c <= 7; c++) {
            if(placed) break;
            if(!isOcc(r, c) && !isOcc(r+1, c)) {
              card.style.gridRow = `${r} / span 2`;
              card.style.gridColumn = `${c} / span 1`;
              setOcc(r, c);
              setOcc(r+1, c);
              placed = true;
            }
          }
        }
      }
    });
  };

  const updateLayouts = () => {
    document.querySelectorAll('.category-section:not(.fav-section) .apps-container').forEach(container => {
      applyTetrisLayoutToContainer(container);
    });

    const favContainer = document.querySelector('.fav-section .apps-container');
    if (favContainer) {
      if (isFavTwoRowMode) {
        applyTetrisLayoutToContainer(favContainer); 
      } else {
        clearInlineGridStyles(favContainer); 
      }
    }
  };

  kintone.events.on('app.record.create.show', function(event) {
    alert('⚠️ この画面での手動レコード追加は禁止されています。ポータルへ戻ります。');
    window.location.href = '/k/219/'; 
    return event;
  });

  kintone.events.on('app.record.index.show', async (event) => {
    if (!document.getElementById('iroha-portal')) return event;

    try {
      await loadSortable();

      const globalResp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', { app: CONFIG_APP_ID, query: 'order by $id asc limit 1' });
      if (globalResp.records.length === 0) return alert('アプリ219にマスターレコードを追加してください。');
      globalRecordId = globalResp.records[0].$id.value;

      const rawJsonStr = globalResp.records[0]['レイアウト情報'].value;
      if (rawJsonStr) {
        try {
          let parsed = JSON.parse(rawJsonStr);
          if (Array.isArray(parsed)) configData = parsed;
          else if (parsed && parsed.config) configData = parsed.config;
        } catch(e){ console.error("データ解析エラー", e); }
      }
      
      if (!Array.isArray(configData) || configData.length === 0) {
        configData = [{ id: 'tab_'+Date.now(), label: 'メイン', users: [], cats: [], password: DEFAULT_PASS }];
      }

      configData.forEach(t => {
        if (!t.users) t.users = [];
        if (!t.cats) t.cats = [];
        t.cats.forEach(c => { if (!c.apps) c.apps = []; });
      });

      const currentUserCode = kintone.getLoginUser().code;
      const personalQuery = `作成者 in ("${currentUserCode}") and $id != "${globalRecordId}" order by $id desc limit 1`;
      const personalResp = await kintone.api(kintone.api.url('/k/v1/records', true), 'GET', { 
        app: CONFIG_APP_ID, query: personalQuery
      });

      if (personalResp.records.length > 0) {
        personalRecordId = personalResp.records[0].$id.value;
        const rawFavStr = personalResp.records[0]['レイアウト情報'].value;
        try { 
          const parsedFav = JSON.parse(rawFavStr || "[]"); 
          favorites = Array.isArray(parsedFav) ? parsedFav : [];
        } catch(e) { favorites = []; }
      } else {
        const postResp = await kintone.api(kintone.api.url('/k/v1/record', true), 'POST', { app: CONFIG_APP_ID, record: { 'レイアウト情報': { value: "[]" } } });
        personalRecordId = postResp.id;
        favorites = [];
      }

      let needSavePatch = false;
      configData.forEach(t => t.cats.forEach(c => c.apps.forEach(a => {
        if (a.isCustom && !a.appId) {
          a.appId = 'link_auto_' + encodeURIComponent(a.url || '').replace(/%/g, '').substring(0, 15) + '_' + Math.random().toString(36).substr(2, 5);
          needSavePatch = true;
        }
      })));
      if (needSavePatch) {
        await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', { app: CONFIG_APP_ID, id: globalRecordId, record: { 'レイアウト情報': { value: JSON.stringify(configData) } } });
      }

      let offset = 0; let getMoreApps = true;
      while (getMoreApps) {
        const appsResp = await kintone.api(kintone.api.url('/k/v1/apps', true), 'GET', { offset: offset, limit: 100 });
        if (appsResp && appsResp.apps && appsResp.apps.length > 0) { allApps = allApps.concat(appsResp.apps); offset += 100; }
        else getMoreApps = false;
      }
      try {
        let uOffset = 0; let getMoreUsers = true;
        while(getMoreUsers){
          const usersResp = await kintone.api(kintone.api.url('/v1/users', true), 'GET', { offset: uOffset, size: 100 });
          if(usersResp && usersResp.users && usersResp.users.length > 0){ 
            allUsers = allUsers.concat(usersResp.users.filter(u => u.valid === true)); uOffset += 100; 
          } else { getMoreUsers = false; }
        }
      } catch(e) { console.error("ユーザー取得エラー", e); }

      checkViewableTabs();
      renderTabs();
      setupEvents();
      setTimeout(resizeGridRows, 200);

    } catch (err) { alert('エラー: ' + err.message); }
    return event;
  });

  async function saveFavoritesToKintone() {
    if (!personalRecordId) return;
    try {
      await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', {
        app: CONFIG_APP_ID, id: personalRecordId,
        record: { 'レイアウト情報': { value: JSON.stringify(favorites) } }
      });
    } catch(e) { console.error("お気に入り同期失敗", e); }
  }

  function checkViewableTabs() {
    if (isEditMode) return; 
    const myCode = kintone.getLoginUser().code;
    const viewableTabs = configData.filter(t => t.users.length === 0 || t.users.includes(myCode));
    const ctx = extraTabCtx();
    const isCurrentExtra = getExtraTabs().some(t => t.id === currentTabId && isExtraTabViewable(t, ctx));
    if (!isCurrentExtra && !viewableTabs.find(t => t.id === currentTabId)) {
      currentTabId = viewableTabs.length > 0 ? viewableTabs[0].id : (configData[0] ? configData[0].id : null);
    }
  }

  function clearSortables() {
    sortableInstances.forEach(inst => inst.destroy());
    sortableInstances = [];
  }

  function renderTabs() {
    clearSortables();
    const tabContainer = document.getElementById('iroha-tabs');
    tabContainer.innerHTML = '';
    
    checkViewableTabs();
    if (!configData.find(t => t.id === currentTabId) && !findExtraTab(currentTabId)) currentTabId = configData[0].id;
    const myCode = kintone.getLoginUser().code;

    configData.forEach(tab => {
      if (!isEditMode && tab.users.length > 0 && !tab.users.includes(myCode)) return;

      const div = document.createElement('div');
      div.className = `tab-item ${currentTabId === tab.id ? 'active' : ''}`;
      div.dataset.tabId = tab.id;
      
      div.innerHTML = `
        <div class="tab-name" ${isEditMode ? 'contenteditable="true"' : ''}>${tab.label}</div>
        <div class="tab-controls edit-only">
          <button class="btn-user" title="スタッフ登録">👤 ${tab.users.length}</button>
          <button class="btn-copy" title="タブをコピー">📋</button>
          <button class="btn-delete" title="タブ削除">🗑️</button>
        </div>
      `;

      if (isEditMode) {
        div.querySelector('.tab-name').onclick = (e) => e.stopPropagation();
        div.querySelector('.tab-name').addEventListener('blur', (e) => { tab.label = e.target.innerText; });
        div.querySelector('.btn-delete').onclick = (e) => {
          e.stopPropagation(); if(confirm('削除しますか？')) { configData = configData.filter(t => t.id !== tab.id); currentTabId = configData[0] ? configData[0].id : null; renderTabs(); }
        };
        div.querySelector('.btn-copy').onclick = (e) => {
          e.stopPropagation(); const cloned = JSON.parse(JSON.stringify(tab)); cloned.id = 'tab_' + Date.now(); cloned.label += ' (コピー)'; configData.push(cloned); currentTabId = cloned.id; renderTabs();
        };
        div.querySelector('.btn-user').onclick = (e) => { e.stopPropagation(); openUserModal(tab.id); };
      }

      div.onclick = (e) => {
        if(isEditMode && e.target.className !== 'tab-item' && e.target.className !== 'tab-name') return;
        if(isEditMode) { updateDataFromDOM(); } 
        isFavEditMode = false;
        currentTabId = tab.id; localStorage.setItem('iroha_last_tab', tab.id); renderTabs();
      };
      tabContainer.appendChild(div);
    });

    // === 拡張タブ（外部スクリプトが登録）を末尾に追加 ===
    if (!isEditMode) {
      const exCtx = extraTabCtx();
      getExtraTabs().forEach(function(extraTab) {
        if (!isExtraTabViewable(extraTab, exCtx)) return;
        const exDiv = document.createElement('div');
        exDiv.className = 'tab-item' + (currentTabId === extraTab.id ? ' active' : '');
        exDiv.dataset.tabId = extraTab.id;
        exDiv.dataset.extraTab = 'true';
        exDiv.innerHTML = '<div class="tab-name">' + (extraTab.label || '') + '</div>';
        exDiv.onclick = function() {
          isFavEditMode = false;
          currentTabId = extraTab.id;
          localStorage.setItem('iroha_last_tab', extraTab.id);
          renderTabs();
        };
        tabContainer.appendChild(exDiv);
      });
    }

    renderContents();

    if(isEditMode) {
      sortableInstances.push(new Sortable(tabContainer, {
        animation: 150, delay: 200, delayOnTouchOnly: true, onEnd: () => {
          const newConfig = [];
          tabContainer.querySelectorAll('.tab-item').forEach(el => {
            const t = configData.find(x => x.id === el.dataset.tabId); if(t) newConfig.push(t);
          });
          configData = newConfig;
        }
      }));
    }
  }

  function renderContents() {
    const content = document.getElementById('portal-content');
    content.innerHTML = '';

    // === 拡張タブのコンテンツ描画（外部スクリプトに委譲）===
    if (!isEditMode) {
      const extraTab = findExtraTab(currentTabId);
      if (extraTab && typeof extraTab.render === 'function') {
        try { extraTab.render(content); }
        catch (e) {
          console.error('拡張タブ描画エラー', e);
          content.innerHTML = '<div style="padding:20px;color:#c0392b;">表示中にエラーが発生しました。</div>';
        }
        return;
      }
    }

    const currentTab = configData.find(t => t.id === currentTabId);
    if (!currentTab) return;

    if (favorites.length > 0 || isEditMode) {
      const favSec = document.createElement('section');
      favSec.className = 'category-section fav-section';
      favSec.style.borderLeftColor = '#FFB800'; 
      
      favSec.innerHTML = `
        <div class="category-header" style="justify-content: flex-start; align-items: center; border-bottom: 1px solid #F0F4F0; padding-bottom: 6px; margin-bottom: 10px;">
          <div class="cat-header-left" style="display: flex; align-items: center; flex-wrap: wrap; width: 100%;">
            <h2 class="cat-title" style="margin: 0; margin-right: 12px; white-space: nowrap;">⭐ お気に入りアプリ</h2>
            ${!isEditMode ? `
              <button id="fav-edit-trigger-btn" class="btn-sort" style="font-size:12px; padding:4px 10px; margin:0; margin-right: 8px; flex-shrink: 0; cursor: pointer;">
                ${isFavEditMode ? '完了' : '編集'}
              </button>
              ${isFavEditMode ? `
                <label style="font-size:12px; margin-right:8px; display:flex; align-items:center; gap:4px; cursor:pointer; background:#f0f4f0; padding:4px 8px; border-radius:4px; font-weight:bold; color:#444;">
                  <input type="checkbox" id="fav-2row-toggle" ${isFavTwoRowMode ? 'checked' : ''} style="cursor:pointer; margin:0;">
                  2列モード
                </label>
                <span style="font-size:11px; color:#666; display:inline-block;">💡ガイド: ドラッグ移動 / ×で削除 / ↕️でサイズ変更</span>
              ` : ''}
            ` : ''}
          </div>
        </div>
        <div class="apps-container" id="favs-container"></div>
      `;
      const favContainer = favSec.querySelector('.apps-container');
      
      favorites.forEach(fav => {
        let appInfo = null;
        configData.forEach(t => t.cats.forEach(c => c.apps.forEach(a => { if(String(a.appId) === String(fav.appId)) appInfo = a; })));
        if (!appInfo) appInfo = allApps.find(a => String(a.appId) === String(fav.appId));
        if (appInfo) {
          const favAppObj = {
            appId: fav.appId, displayName: appInfo.displayName || appInfo.name,
            fontScale: appInfo.fontScale || 1, heightMode: fav.heightMode || 'full',
            isCustom: appInfo.isCustom || false, url: appInfo.url || '', customIcon: appInfo.customIcon || '' 
          };
          const card = createAppCard(favAppObj, appInfo, 'favorites');
          favContainer.appendChild(card);
        }
      });
      content.appendChild(favSec);

      const triggerBtn = document.getElementById('fav-edit-trigger-btn');
      if(triggerBtn) {
        triggerBtn.onclick = () => {
          isFavEditMode = !isFavEditMode;
          renderContents();
        };
      }
      
      const toggleBtn = document.getElementById('fav-2row-toggle');
      if(toggleBtn) {
        toggleBtn.onchange = (e) => {
          isFavTwoRowMode = e.target.checked;
          localStorage.setItem('iroha_fav_2row_mode', isFavTwoRowMode);
          updateLayouts();
        };
      }
    }

    currentTab.cats.forEach((cat, catIdx) => {
      const visibleApps = cat.apps.filter(app => app.isCustom || allApps.find(a => a.appId == app.appId));
      if (!isEditMode && visibleApps.length === 0) return;

      const sec = document.createElement('section');
      sec.className = 'category-section';
      sec.dataset.catId = cat.id;
      sec.innerHTML = `<div class="category-header"><div class="cat-header-left"><i class="fa-solid fa-grip-lines cat-drag-handle" title="掴んで並び替え"></i><h2 class="cat-title" ${isEditMode ? 'contenteditable="true"' : ''}>${cat.title}</h2></div><button class="btn-delete edit-only cat-delete-btn">🗑️ カテゴリー削除</button></div><div class="apps-container" data-cat-id="${cat.id}"></div>`;

      if (isEditMode) {
        sec.querySelector('.cat-title').onclick = (e) => e.stopPropagation();
        sec.querySelector('.cat-title').addEventListener('blur', (e) => { cat.title = e.target.innerText; });
        sec.querySelector('.cat-delete-btn').onclick = () => { if(confirm('カテゴリーを削除しますか？')) { currentTab.cats.splice(catIdx, 1); renderContents(); renderPalette(); } };
      }

      const container = sec.querySelector('.apps-container');
      visibleApps.forEach(app => {
        let appInfo = app.isCustom ? { name: app.displayName } : allApps.find(a => a.appId == app.appId);
        if (appInfo || app.isCustom) { container.appendChild(createAppCard(app, appInfo, cat.id)); }
      });

      content.appendChild(sec);
    });

    if(isEditMode) {
      sortableInstances.push(new Sortable(content, { handle: '.cat-drag-handle', animation: 150, delay: 200, delayOnTouchOnly: true, onEnd: () => { updateDataFromDOM(); updateLayouts(); } }));
      document.querySelectorAll('.apps-container:not(#favs-container)').forEach(container => {
        sortableInstances.push(new Sortable(container, { 
          group: 'apps_group', animation: 150, delay: 200, delayOnTouchOnly: true, 
          onChange: () => updateLayouts(), 
          onEnd: () => { updateDataFromDOM(); updateLayouts(); renderPalette(); } 
        }));
      });
      renderPalette();
    }
    
    const favGridEl = document.getElementById('favs-container');
    if (favGridEl && (isEditMode || isFavEditMode)) {
      sortableInstances.push(new Sortable(favGridEl, {
        animation: 150, delay: 200, delayOnTouchOnly: true, 
        onChange: () => updateLayouts(),
        onEnd: () => {
          updateLayouts();
          const newFavs = [];
          favGridEl.querySelectorAll('.app-card').forEach(card => {
            newFavs.push({ appId: card.dataset.appId, heightMode: card.classList.contains('is-tetris') ? 'tetris' : 'full' });
          });
          favorites = newFavs; saveFavoritesToKintone();
        }
      }));
    }
    
    updateLayouts(); 
    resizeGridRows();
  }

  function createAppCard(appObj, appInfo, catId) {
    const card = document.createElement('div');
    card.className = 'app-card' + (appObj.isCustom ? ' custom-link' : '');
    
    if (appObj.heightMode && appObj.heightMode !== 'full') {
      appObj.heightMode = 'tetris';
      card.classList.add('is-tetris');
    }

    card.dataset.appId = appObj.appId || ''; card.dataset.isCustom = appObj.isCustom ? 'true' : 'false'; card.dataset.url = appObj.url || '';
    const fontScale = appObj.fontScale || 1; card.style.setProperty('--font-scale', fontScale);
    const dName = appObj.displayName || (appInfo ? appInfo.name : '');
    const linkUrl = appObj.isCustom ? appObj.url : '/k/'+appObj.appId;
    const isAlreadyFaved = favorites.some(f => String(f.appId) === String(appObj.appId));

    const showControls = isEditMode || (catId === 'favorites' && isFavEditMode);

    let iconData = appObj.customIcon || (appInfo ? appInfo.customIcon : '');
    if (!iconData && appObj.isCustom) {
      iconData = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🌐</text></svg>';
    }
    card.setAttribute('data-custom-icon', iconData || '');

    card.innerHTML = `
      ${catId !== 'favorites' ? `<div class="fav-btn-trigger ${isAlreadyFaved ? 'is-active' : ''}" title="お気に入り登録">★</div>` : ''}
      ${showControls ? `
        <div class="remove-app-btn"><i class="fa-solid fa-xmark"></i></div>
        <div class="size-ctrl"><button class="btn-size" title="サイズ切替">↕️</button></div>
        <div class="font-ctrl edit-only"><button class="btn-font btn-font-down" title="文字縮小">－</button><button class="btn-font btn-font-up" title="文字拡大">＋</button></div>
      ` : ''}
      ${isEditMode && catId !== 'favorites' ? `
        <div class="icon-ctrl edit-only"><button class="btn-icon" title="アイコン画像を設定">🖼️</button></div>
      ` : ''}
      <div class="app-card-inner">
        ${iconData ? `<img src="${iconData}" class="app-icon" alt="icon">` : ''}
        <a href="${isEditMode || isFavEditMode ? 'javascript:void(0)' : linkUrl}" ${appObj.isCustom && !isEditMode ? 'target="_blank"' : ''} style="text-decoration:none; color:inherit; width:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%;">
          <div class="app-name-display" ${isEditMode && catId !== 'palette' ? 'contenteditable="true"' : ''}>${dName}</div>
        </a>
      </div>
    `;

    const favStar = card.querySelector('.fav-btn-trigger');
    if (favStar) {
      favStar.onclick = (e) => {
        e.stopPropagation(); e.preventDefault();
        if (isAlreadyFaved) {
          favorites = favorites.filter(f => String(f.appId) !== String(appObj.appId)); favStar.classList.remove('is-active');
        } else {
          favorites.push({ appId: appObj.appId, heightMode: 'tetris' }); favStar.classList.add('is-active');
        }
        saveFavoritesToKintone(); renderContents();
      };
    }

    if (showControls) {
      const nameEl = card.querySelector('.app-name-display');
      if(nameEl && isEditMode) {
        nameEl.onclick = (e) => e.stopPropagation();
        nameEl.addEventListener('blur', (e) => { appObj.displayName = e.target.innerText.trim(); updateDataFromDOM(); });
      }
      
      if(card.querySelector('.btn-font-up')) {
        card.querySelector('.btn-font-up').onclick = (e) => { e.stopPropagation(); appObj.fontScale = (appObj.fontScale || 1) + 0.1; card.style.setProperty('--font-scale', appObj.fontScale); updateDataFromDOM(); };
        card.querySelector('.btn-font-down').onclick = (e) => { e.stopPropagation(); appObj.fontScale = Math.max(0.5, (appObj.fontScale || 1) - 0.1); card.style.setProperty('--font-scale', appObj.fontScale); updateDataFromDOM(); };
      }

      if(card.querySelector('.btn-icon')) {
        card.querySelector('.btn-icon').onclick = (e) => { 
          e.stopPropagation(); 
          editingIconCard = card; 
          document.getElementById('icon-upload-input').click(); 
        };
      }

      card.querySelector('.btn-size').onclick = (e) => { 
        e.stopPropagation(); 
        let isTetris = card.classList.contains('is-tetris');
        let nextMode = isTetris ? 'full' : 'tetris';
        
        appObj.heightMode = nextMode;
        if (nextMode === 'tetris') card.classList.add('is-tetris');
        else card.classList.remove('is-tetris');
        
        if (catId === 'favorites') {
          const target = favorites.find(f => String(f.appId) === String(appObj.appId));
          if(target) target.heightMode = nextMode;
          saveFavoritesToKintone(); 
        } else { updateDataFromDOM(); }
        
        updateLayouts(); 
      };

      card.querySelector('.remove-app-btn').onclick = (e) => { 
        e.stopPropagation(); 
        if (catId === 'favorites') {
          favorites = favorites.filter(f => String(f.appId) !== String(appObj.appId)); saveFavoritesToKintone(); renderContents();
        } else { card.remove(); updateDataFromDOM(); renderPalette(); }
      };
    }
    return card;
  }

  function updateDataFromDOM() {
    const currentTab = configData.find(t => t.id === currentTabId);
    if (!currentTab) return;
    const newCats = [];
    document.querySelectorAll('.category-section:not(.fav-section)').forEach(sec => {
      const catId = sec.dataset.catId; const catObj = currentTab.cats.find(c => c.id === catId);
      if(catObj) {
        const newApps = [];
        sec.querySelectorAll('.apps-container .app-card:not(.sortable-drag)').forEach(card => {
          let mode = card.classList.contains('is-tetris') ? 'tetris' : 'full';
          newApps.push({ 
            appId: card.dataset.appId, 
            displayName: card.querySelector('.app-name-display').innerText.trim(),
            fontScale: parseFloat(card.style.getPropertyValue('--font-scale')) || 1,
            heightMode: mode, 
            isCustom: card.dataset.isCustom === 'true', 
            url: card.dataset.url,
            customIcon: card.getAttribute('data-custom-icon') || '' 
          });
        });
        catObj.apps = newApps; newCats.push(catObj);
      }
    });
    currentTab.cats = newCats;
  }

  function renderPalette() {
    const palette = document.getElementById('app-palette'); const selectTarget = document.getElementById('multi-add-target'); if (!isEditMode) return;
    const currentTab = configData.find(t => t.id === currentTabId); const usedIdsInTab = new Set();
    
    selectTarget.innerHTML = '';
    currentTab.cats.forEach(c => { c.apps.forEach(a => { if(!a.isCustom) usedIdsInTab.add(String(a.appId)); }); const opt = document.createElement('option'); opt.value = c.id; opt.innerText = c.title; selectTarget.appendChild(opt); });

    let availableApps = allApps.filter(app => { if (!app || !app.name) return false; if (usedIdsInTab.has(String(app.appId))) return false; return true; });
    availableApps.sort((a, b) => { const getW = (str) => { const c = (str||'').charAt(0); if(/[0-9]/.test(c)) return 1; if(/[a-zA-Zぁ-んァ-ヶ一-龠]/.test(c)) return 2; return 3; }; const wa = getW(a.name); const wb = getW(b.name); if (wa !== wb) return wa - wb; return (a.name||'').localeCompare((b.name||''), 'ja'); });

    palette.innerHTML = '';
    availableApps.forEach(app => {
      const wrap = document.createElement('div'); wrap.className = 'palette-item'; wrap.dataset.appId = app.appId;
      wrap.innerHTML = `<input type="checkbox" value="${app.appId}" class="palette-check"><div class="palette-text">${app.name}</div>`;
      wrap.onclick = (e) => { if(e.target.tagName !== 'INPUT') { const chk = wrap.querySelector('input'); chk.checked = !chk.checked; } }; palette.appendChild(wrap);
    });

    sortableInstances.push(new Sortable(palette, { 
      group: { name: 'apps_group', pull: 'clone', put: false }, 
      sort: false, animation: 150, delay: 200, delayOnTouchOnly: true, 
      onEnd: (evt) => { 
        if (evt.to !== evt.from) { 
          evt.item.remove(); 
          updateDataFromDOM(); renderContents(); renderPalette(); 
        } 
      } 
    }));
  }

  function openUserModal(tabId) { 
    editingTabIdForUsers = tabId; 
    const tab = configData.find(t => t.id === tabId); 
    if (!tab) return;

    const titleEl = document.querySelector('#user-modal h3');
    if (titleEl) {
      titleEl.innerText = `「${tab.label}」の対象スタッフ選択`;
    }

    // ★追加：検索ボックスの自動入力を強制的にクリアして無効化する
    const searchInput = document.getElementById('user-search');
    if (searchInput) {
      searchInput.value = ''; 
      searchInput.setAttribute('autocomplete', 'new-password'); // Chromeの強力な自動入力をブロック
    }

    renderUserList(); 
    
    const modalEl = document.getElementById('user-modal');
    if (modalEl) modalEl.style.display = 'flex'; 
  }

  function renderUserList() { 
    const list = document.getElementById('user-list'); 
    if (!list) return;

    list.style.maxHeight = '50vh'; 
    list.style.overflowY = 'auto';

    // ★追加：kintoneからユーザー情報がうまく取得できていない場合のエラー表示
    if (allUsers.length === 0) {
      list.innerHTML = '<p style="color:#d32f2f; padding:10px;">スタッフ情報を取得できませんでした。権限等を確認してください。</p>';
      return;
    }

    list.innerHTML = ''; 
    const tab = configData.find(t => t.id === editingTabIdForUsers); 
    const searchInput = document.getElementById('user-search');
    const keyword = searchInput ? searchInput.value.toLowerCase() : ''; 

    allUsers.forEach(u => { 
      if (keyword && !u.name.toLowerCase().includes(keyword)) return; 
      const isChecked = tab.users && tab.users.includes(u.code) ? 'checked' : ''; 
      list.innerHTML += `<label class="user-item" style="display:flex; align-items:center; padding:8px 4px; border-bottom:1px solid #eee; cursor:pointer;"><input type="checkbox" value="${u.code}" class="user-modal-checkbox" style="margin-right:8px;" ${isChecked}><span>${u.name}</span></label>`; 
    }); 
  }

  function setupEvents() {
    const editBtn = document.getElementById('edit-mode-btn'); const panel = document.getElementById('edit-panel');
    
    editBtn.onclick = () => {
      const pass = prompt("ポータル設定パスワードを入力してください：");
      const currentSavedPass = configData[0].password || DEFAULT_PASS;
      if (pass === currentSavedPass) { isEditMode = true; isFavEditMode = false; if (findExtraTab(currentTabId)) { currentTabId = configData[0] ? configData[0].id : null; } document.body.classList.add('edit-mode'); panel.classList.add('open'); renderTabs(); renderPalette(); } 
      else { alert("パスワードが正しくありません。"); }
    };

    document.getElementById('close-edit-btn').onclick = () => { isEditMode = false; document.body.classList.remove('edit-mode'); panel.classList.remove('open'); updateDataFromDOM(); renderTabs(); };
    document.getElementById('add-tab-btn').onclick = () => { const newId = 'tab_' + Date.now(); configData.push({ id: newId, label: '新規タブ', users: [], cats: [] }); currentTabId = newId; renderTabs(); };
    document.getElementById('add-cat-btn').onclick = () => { const tab = configData.find(t => t.id === currentTabId); tab.cats.push({ id: 'cat_' + Date.now(), title: '新規カテゴリー', apps: [] }); renderContents(); renderPalette(); };

    document.getElementById('btn-change-pass').onclick = () => {
      const newPass = document.getElementById('new-password').value.trim(); if (!newPass) return alert('新しいパスワードを入力してください。');
      configData.forEach(t => t.password = newPass); alert('変更しました！「保存」でkintoneへ完全に反映されます。');
    };

    document.getElementById('multi-add-btn').onclick = () => {
      const targetCatId = document.getElementById('multi-add-target').value; if(!targetCatId) return alert('追加先のカテゴリーを選択してください。');
      const tab = configData.find(t => t.id === currentTabId); const cat = tab.cats.find(c => c.id === targetCatId);
      document.querySelectorAll('.palette-check:checked').forEach(chk => { cat.apps.push({ appId: chk.value, displayName: '' }); }); renderContents(); renderPalette();
    };

    document.getElementById('btn-custom-link').onclick = () => { document.getElementById('link-title').value = ''; document.getElementById('link-url').value = ''; document.getElementById('link-modal').style.display = 'flex'; };
    document.getElementById('link-close-btn').onclick = () => document.getElementById('link-modal').style.display = 'none';
    
    document.getElementById('link-save-btn').onclick = () => {
      const title = document.getElementById('link-title').value.trim(); const url = document.getElementById('link-url').value.trim(); if(!title || !url) return alert('入力してください');
      const tab = configData.find(t => t.id === currentTabId); if(tab.cats.length === 0) tab.cats.push({ id: 'cat_' + Date.now(), title: 'リンク集', apps: [] });
      tab.cats[0].apps.push({ appId: 'link_' + Date.now() + Math.random().toString(36).substr(2, 5), isCustom: true, url: url, displayName: title }); document.getElementById('link-modal').style.display = 'none'; renderContents();
    };

    document.getElementById('save-config-btn').onclick = async () => {
      const btn = document.getElementById('save-config-btn'); btn.innerText = '中...'; btn.disabled = true;
      try {
        updateDataFromDOM();
        await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', { 
          app: CONFIG_APP_ID, 
          id: globalRecordId, 
          record: { 'レイアウト情報': { value: JSON.stringify(configData) } } 
        });
        alert('ポータルの設定を保存しました！');
      } catch (e) { alert('保存失敗: ' + e.message); } 
      finally { btn.innerText = '保存'; btn.disabled = false; }
    };

    const modalCloseBtn = document.getElementById('modal-close-btn');
    if (modalCloseBtn) {
      modalCloseBtn.onclick = () => {
        document.getElementById('user-modal').style.display = 'none';
      };
    }

    const modalSaveBtn = document.getElementById('modal-save-btn');
    if (modalSaveBtn) {
      modalSaveBtn.onclick = () => {
        const currentTab = configData.find(t => t.id === editingTabIdForUsers);
        if (currentTab) {
          const checkedBoxes = document.querySelectorAll('#user-list .user-modal-checkbox:checked');
          currentTab.users = Array.from(checkedBoxes).map(chk => chk.value);
          renderTabs();
        }
        document.getElementById('user-modal').style.display = 'none';
      };
    }

    const searchInput = document.getElementById('user-search');
    if (searchInput) {
      // oninputを使うことでコピペや文字を消した時にも即座に反応するように改良
      searchInput.oninput = () => renderUserList();
    }

    document.getElementById('icon-upload-input').addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (!file || !editingIconCard) return;

      const reader = new FileReader();
      reader.onload = function(event) {
        const img = new Image();
        img.onload = function() {
          const canvas = document.createElement('canvas');
          const size = Math.min(img.width, img.height);
          const startX = (img.width - size) / 2;
          const startY = (img.height - size) / 2;
          
          canvas.width = 64; 
          canvas.height = 64;
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, 64, 64);
          ctx.drawImage(img, startX, startY, size, size, 0, 0, 64, 64);
          
          const base64 = canvas.toDataURL('image/png');
          
          editingIconCard.setAttribute('data-custom-icon', base64);

          const inner = editingIconCard.querySelector('.app-card-inner');
          let imgEl = inner.querySelector('.app-icon');
          if (!imgEl) {
              imgEl = document.createElement('img');
              imgEl.className = 'app-icon';
              inner.insertBefore(imgEl, inner.firstChild);
          }
          imgEl.src = base64;

          updateDataFromDOM();
          e.target.value = ''; 
          editingIconCard = null;
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

})();