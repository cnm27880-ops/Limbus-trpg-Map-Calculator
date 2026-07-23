/**
 * Limbus Command - SideRail（右緣功能側邊條 / 抽屜）
 *
 * 取代原本右下角的「⚡ 快速操作球」與頂部導覽列：改為一條與螢幕同高、
 * 貼齊右緣的深灰色細長側邊條。平時縮成右緣一條細邊，滑鼠移過去自動滑出
 * （行動裝置點細邊展開、點空白處收合）。裡頭是一排純 CSS 繪製的功能圖標，
 * 可用滑鼠上下拖曳自由排序（順序存於 localStorage）。
 *
 * 與 PanelDock（右緣磁鐵收納）整合：被收納的浮動面板圖標也放進本側邊條的
 * 收納區，拖曳面板到畫面右緣即收進來、按住圖標往外拖即取回（邏輯仍在
 * panel-dock.js，本檔只提供容器與展開/收合的整合介面 window.SideRail）。
 *
 * 導覽分頁（地圖/單位/日誌）沿用 .nav-tab[data-page]，故 switchPage() 不需改動；
 * 連線狀態、代號、ID、側欄鈕、登出等節點則「搬移」進側邊條底部（保留原 id 與
 * 事件），讓既有以 id 更新狀態的程式碼照常運作。
 */

const SideRail = (function () {
    const ORDER_KEY = 'limbus-side-rail-order-v1';

    // 可自由排序的功能鍵預設順序（導覽 + 工具）。
    const DEFAULT_ORDER = [
        'nav-map', 'nav-units', 'nav-log',
        'act-media', 'act-identity', 'act-roulette',
        'act-erosion', 'act-fog', 'act-mapai', 'act-counter', 'act-hotkey'
    ];

    // 功能定義：key → { icon(圖標 class), label(浮出標籤), nav(分頁 id), id(沿用的既有 id),
    //                    hidden(預設隱藏，由各模組 gate 函式顯示), fn(要呼叫的既有全域函式名) }
    const ITEMS = {
        'nav-map':      { icon: 'ci-map',      label: '地圖',              nav: 'map',   fn: () => switchPage('map') },
        'nav-units':    { icon: 'ci-units',    label: '單位',              nav: 'units', fn: () => switchPage('units') },
        'nav-log':      { icon: 'ci-log',      label: '戰鬥日誌 / 構築室', nav: 'log',   fn: () => switchPage('log') },
        'act-media':    { icon: 'ci-media',    label: '媒體中心',          fn: () => call('toggleMediaPanel') },
        'act-identity': { icon: 'ci-identity', label: '人格卡引擎',        fn: () => call('toggleIdentityModal') },
        'act-roulette': { icon: 'ci-roulette', label: '幸運大轉盤',        fn: () => call('openRouletteModal') },
        'act-erosion':  { icon: 'ci-erosion',  label: '侵蝕控制台',        id: 'qab-erosion-item',       hidden: true, fn: () => call('toggleErosionHud') },
        'act-fog':      { icon: 'ci-fog',      label: '戰爭迷霧',          id: 'qab-fog-item',           hidden: true, fn: () => call('toggleFogHud') },
        'act-mapai':    { icon: 'ci-mapai',    label: 'AI 地圖助手',       id: 'qab-map-ai-item',        hidden: true, fn: () => call('maiTogglePanel') },
        'act-counter':  { icon: 'ci-counter',  label: '本回合對抗分配',    id: 'qab-counter-panel-item', hidden: true, fn: () => call('cpToggleFloatPanel') },
        'act-hotkey':   { icon: 'ci-hotkey',   label: '快捷鍵說明',        fn: () => call('toggleHotkeyHelp') }
    };

    let rail = null;
    let actionsEl = null;
    let dockItemsEl = null;
    let footerEl = null;
    let collapseTimer = null;

    /** 呼叫既有全域函式（不存在時安靜略過）。 */
    function call(name) {
        if (typeof window[name] === 'function') window[name]();
        else if (typeof showToast === 'function') showToast('此功能尚未載入');
    }

    // ===== 展開 / 收合 =====
    function expand() {
        clearTimeout(collapseTimer);
        if (rail) rail.classList.add('expanded');
    }
    function collapse() {
        if (rail) rail.classList.remove('expanded');
    }
    function scheduleCollapse() {
        clearTimeout(collapseTimer);
        collapseTimer = setTimeout(collapse, 350);
    }

    // ===== 排序持久化 =====
    function loadOrder() {
        try {
            const raw = localStorage.getItem(ORDER_KEY);
            const arr = raw ? JSON.parse(raw) : null;
            if (Array.isArray(arr)) return arr.filter(k => ITEMS[k]);
        } catch (e) { /* 忽略毀損資料 */ }
        return null;
    }
    function saveOrder() {
        if (!actionsEl) return;
        const order = [...actionsEl.querySelectorAll('.sr-item')].map(el => el.dataset.key);
        try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch (e) { /* 儲存失敗不阻斷 */ }
    }
    /** 依儲存的順序 + 預設順序，去重後回傳最終要渲染的鍵陣列。 */
    function resolveOrder() {
        const saved = loadOrder() || [];
        const seen = new Set();
        const out = [];
        [...saved, ...DEFAULT_ORDER].forEach(k => {
            if (ITEMS[k] && !seen.has(k)) { seen.add(k); out.push(k); }
        });
        return out;
    }

    // ===== 建立圖標按鈕 =====
    function makeItem(key) {
        const def = ITEMS[key];
        const btn = document.createElement('button');
        btn.className = 'sr-item' + (def.nav ? ' nav-tab' : '');
        btn.dataset.key = key;
        if (def.id) btn.id = def.id;
        if (def.nav) btn.dataset.page = def.nav;
        btn.title = def.label; // 窄欄以原生 tooltip 提示中文名（避免被捲動容器裁切）
        if (def.hidden) btn.style.display = 'none';
        btn.innerHTML = `<span class="ci ${def.icon}" aria-hidden="true"></span>`;
        btn.addEventListener('click', () => { if (!btn._suppressClick) def.fn(); });
        return btn;
    }

    // ===== 拖曳排序（指標事件，桌機/觸控通用）=====
    let dragEl = null, dragging = false, startY = 0;
    function itemAfterPointer(y) {
        const items = [...actionsEl.querySelectorAll('.sr-item:not(.sr-dragging)')]
            .filter(el => el.offsetParent !== null); // 略過隱藏項
        for (const el of items) {
            const r = el.getBoundingClientRect();
            if (y < r.top + r.height / 2) return el;
        }
        return null;
    }
    function onPointerDown(e) {
        if (e.button !== undefined && e.button !== 0) return;
        const item = e.target.closest && e.target.closest('.sr-item');
        if (!item || !actionsEl.contains(item)) return;
        dragEl = item; dragging = false; startY = e.clientY;
        item.setPointerCapture && item.setPointerCapture(e.pointerId);
        item.addEventListener('pointermove', onPointerMove);
        item.addEventListener('pointerup', onPointerUp);
        item.addEventListener('pointercancel', onPointerUp);
    }
    function onPointerMove(e) {
        if (!dragEl) return;
        if (!dragging) {
            if (Math.abs(e.clientY - startY) < 6) return;
            dragging = true;
            dragEl.classList.add('sr-dragging');
            expand();
        }
        e.preventDefault();
        const after = itemAfterPointer(e.clientY);
        if (after == null) actionsEl.appendChild(dragEl);
        else if (after !== dragEl) actionsEl.insertBefore(dragEl, after);
    }
    function onPointerUp() {
        if (!dragEl) return;
        dragEl.removeEventListener('pointermove', onPointerMove);
        dragEl.removeEventListener('pointerup', onPointerUp);
        dragEl.removeEventListener('pointercancel', onPointerUp);
        if (dragging) {
            dragEl.classList.remove('sr-dragging');
            saveOrder();
            // 吞掉拖曳後緊接的 click，避免放開時誤觸該功能
            const el = dragEl;
            el._suppressClick = true;
            const clear = () => { el._suppressClick = false; };
            setTimeout(clear, 350);
        }
        dragEl = null; dragging = false;
    }

    // ===== 搬移既有導覽列節點進側邊條底部 =====
    function relocate(id, into) {
        const el = document.getElementById(id);
        if (el && into) into.appendChild(el);
        return el;
    }

    // ===== 建立側邊條 =====
    function build() {
        if (rail) return;

        rail = document.createElement('div');
        rail.id = 'side-rail';
        rail.className = 'side-rail';
        rail.innerHTML = `
            <div class="sr-edge" title="功能側邊條（滑鼠移入展開）"></div>
            <div class="sr-inner">
                <div class="sr-actions" role="toolbar" aria-label="功能側邊條"></div>
                <div class="sr-dock" aria-label="已收納面板"><div class="panel-dock-items"></div></div>
                <div class="sr-footer"></div>
            </div>`;
        document.body.appendChild(rail);

        actionsEl = rail.querySelector('.sr-actions');
        dockItemsEl = rail.querySelector('.sr-dock .panel-dock-items');
        footerEl = rail.querySelector('.sr-footer');

        // 依排序建立功能圖標
        resolveOrder().forEach(key => actionsEl.appendChild(makeItem(key)));

        // 分頁初始 active（預設地圖）沿用 .nav-tab.active
        const activeTab = document.querySelector('.page.active') ? null : null;
        const mapBtn = actionsEl.querySelector('.sr-item[data-page="map"]');
        if (mapBtn && !actionsEl.querySelector('.nav-tab.active')) mapBtn.classList.add('active');

        // 搬移導覽列的狀態/帳號節點進底部（保留原 id 與事件）
        relocate('conn-status', footerEl);
        relocate('my-name', footerEl);
        relocate('my-code', footerEl);
        const sidebarBtn = relocate('sidebar-toggle', footerEl);
        relocate('my-id', footerEl);
        const logoutBtn = relocate('logout-btn', footerEl);
        // 側欄鈕與登出鈕也改用純 CSS 圖標（保留原 title/事件）
        if (sidebarBtn) { sidebarBtn.title = sidebarBtn.title || '單位側欄'; sidebarBtn.innerHTML = '<span class="ci ci-sidebar" aria-hidden="true"></span>'; }
        if (logoutBtn) { logoutBtn.title = logoutBtn.title || '登出 / 切換帳號'; logoutBtn.innerHTML = '<span class="ci ci-logout" aria-hidden="true"></span>'; }

        // 移除已清空的頂部導覽列與戰鬥暫開鈕（若存在）
        const navbar = document.querySelector('.navbar');
        if (navbar) navbar.remove();
        const peek = document.getElementById('combat-navbar-peek');
        if (peek) peek.remove();
        // 隱藏舊的快速操作球主鈕與彈出選單（媒體/快捷鍵面板仍保留於容器內）
        const qabMain = document.getElementById('qab-main');
        if (qabMain) qabMain.remove();
        const qabMenu = document.getElementById('qab-menu');
        if (qabMenu) qabMenu.remove();

        // 互動：滑鼠移入展開、移開延遲收合；點細邊展開（行動裝置）；點外部收合
        rail.addEventListener('pointerenter', expand);
        rail.addEventListener('pointerleave', () => { if (!dragging) scheduleCollapse(); });
        rail.addEventListener('click', (e) => {
            if (!rail.classList.contains('expanded')) { expand(); e.stopPropagation(); }
        });
        document.addEventListener('pointerdown', (e) => {
            if (rail && !rail.contains(e.target) && !dragging) collapse();
        });
        actionsEl.addEventListener('pointerdown', onPointerDown);

        console.log('功能側邊條（SideRail）已載入');
    }

    // 對外介面（含供 PanelDock 整合使用者）
    return {
        build,
        expand,
        collapse,
        scheduleCollapse,
        /** PanelDock 收納圖標的容器 */
        dockItemsEl: () => dockItemsEl,
        /** 拖曳磁鐵提示：外滑並在收納區加高亮 */
        setDropHint: (on) => {
            if (!rail) return;
            rail.classList.toggle('sr-drop-hint', !!on);
            if (on) expand(); else scheduleCollapse();
        },
        /** 收納區有無圖標的樣式刷新 */
        refreshDock: () => {
            if (rail) rail.classList.toggle('sr-has-dock', !!(dockItemsEl && dockItemsEl.children.length));
        }
    };
})();

if (typeof window !== 'undefined') {
    window.SideRail = SideRail;
    // 腳本置於 body 末端，DOM 已就緒即可立即建立，確保 PanelDock 還原時容器已存在
    if (document.body) SideRail.build();
    else document.addEventListener('DOMContentLoaded', SideRail.build);
}
