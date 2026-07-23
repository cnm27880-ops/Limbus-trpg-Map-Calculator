/**
 * Limbus Command - SideRail（右緣功能側邊條）
 *
 * 貼齊螢幕最右緣、與畫面同高的細長工具列（固定 56px，永遠顯示，深灰藍半透明 +
 * 毛玻璃）。取代舊的快速操作球與頂部導覽列。裡頭是一排 FontAwesome 向量圖標，
 * 平時低飽和灰、hover 或啟用時 Icon 本身亮起專屬主題色；無外框方塊。
 *
 * 互動極簡：點 Icon 直接觸發對應功能（開分頁 / 開面板）。
 * 已「完全移除」舊版的長按拖曳排序、右緣滑出/收合與邊緣監聽（那是顏色卡死與
 * 側邊欄死鎖的來源）。
 *
 * 導覽分頁（地圖/單位/日誌）沿用 .nav-tab[data-page]，switchPage() 不需改動；
 * 連線狀態、代號、ID、側欄鈕、登出等節點搬進側邊條底部（保留原 id 與事件）。
 *
 * 與 PanelDock 整合：被收納的浮動面板圖標放進本側邊條的收納區
 * （window.SideRail 提供容器與提示介面；因側邊條恆顯示，展開/收合為 no-op）。
 */

const SideRail = (function () {
    // 功能定義：key → { fa(FontAwesome 圖標), color(主題色), label, nav(分頁), id(沿用既有 id),
    //                    hidden(預設隱藏，由各模組 gate 顯示), fn(要呼叫的既有全域函式名) }
    const NAV_COLOR = '#fbbf24'; // 導覽分頁 active 用琥珀金
    const ITEMS = [
        { key: 'nav-map',      fa: 'fa-map',               color: NAV_COLOR, label: '地圖',              nav: 'map' },
        { key: 'nav-units',    fa: 'fa-users',             color: NAV_COLOR, label: '單位',              nav: 'units' },
        { key: 'nav-log',      fa: 'fa-scroll',            color: NAV_COLOR, label: '戰鬥日誌 / 構築室', nav: 'log' },
        { key: 'act-media',    fa: 'fa-music',             color: '#38bdf8', label: '媒體中心',          fn: 'toggleMediaPanel' },
        { key: 'act-identity', fa: 'fa-id-card',           color: '#fbbf24', label: '人格卡引擎',        fn: 'toggleIdentityModal' },
        { key: 'act-roulette', fa: 'fa-dharmachakra',      color: '#f472b6', label: '幸運大轉盤',        fn: 'openRouletteModal' },
        { key: 'act-erosion',  fa: 'fa-fire-flame-curved', color: '#f43f5e', label: '侵蝕控制台',        id: 'qab-erosion-item',       hidden: true, fn: 'toggleErosionHud' },
        { key: 'act-fog',      fa: 'fa-smog',              color: '#22d3ee', label: '戰爭迷霧',          id: 'qab-fog-item',           hidden: true, fn: 'toggleFogHud' },
        { key: 'act-mapai',    fa: 'fa-robot',             color: '#c084fc', label: 'AI 地圖助手',       id: 'qab-map-ai-item',        hidden: true, fn: 'maiTogglePanel' },
        { key: 'act-counter',  fa: 'fa-scale-balanced',    color: '#2dd4bf', label: '本回合對抗分配',    id: 'qab-counter-panel-item', hidden: true, fn: 'cpToggleFloatPanel' },
        { key: 'act-hotkey',   fa: 'fa-keyboard',          color: '#9ca3af', label: '快捷鍵說明',        fn: 'toggleHotkeyHelp' }
    ];

    let rail = null;
    let dockItemsEl = null;
    let footerEl = null;

    /** 呼叫既有全域函式（不存在時安靜提示）。 */
    function call(name) {
        if (typeof window[name] === 'function') window[name]();
        else if (typeof showToast === 'function') showToast('此功能尚未載入');
    }

    // ===== 建立圖標按鈕 =====
    function makeItem(def) {
        const btn = document.createElement('button');
        btn.className = 'sr-item' + (def.nav ? ' nav-tab' : '');
        btn.dataset.key = def.key;
        if (def.id) btn.id = def.id;
        if (def.nav) btn.dataset.page = def.nav;
        btn.title = def.label;
        btn.style.setProperty('--rail-color', def.color);
        if (def.hidden) btn.style.display = 'none';
        btn.innerHTML = `<i class="fa-solid ${def.fa}" aria-hidden="true"></i>`;
        btn.addEventListener('click', () => {
            if (def.nav) { call('switchPage'); if (typeof switchPage === 'function') switchPage(def.nav); }
            else if (def.fn) call(def.fn);
        });
        return btn;
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
            <div class="sr-inner">
                <div class="sr-actions" role="toolbar" aria-label="功能側邊條"></div>
                <div class="sr-dock" aria-label="已收納面板"><div class="panel-dock-items"></div></div>
                <div class="sr-footer"></div>
            </div>`;
        document.body.appendChild(rail);

        const actionsEl = rail.querySelector('.sr-actions');
        dockItemsEl = rail.querySelector('.sr-dock .panel-dock-items');
        footerEl = rail.querySelector('.sr-footer');

        ITEMS.forEach(def => actionsEl.appendChild(makeItem(def)));

        // 分頁初始 active（預設地圖）沿用 .nav-tab.active
        const mapBtn = actionsEl.querySelector('.sr-item[data-page="map"]');
        if (mapBtn && !actionsEl.querySelector('.nav-tab.active')) mapBtn.classList.add('active');

        // 搬移導覽列的狀態/帳號節點進底部（保留原 id 與事件）
        relocate('conn-status', footerEl);
        relocate('my-name', footerEl);
        relocate('my-code', footerEl);
        const sidebarBtn = relocate('sidebar-toggle', footerEl);
        relocate('my-id', footerEl);
        const logoutBtn = relocate('logout-btn', footerEl);
        if (sidebarBtn) { sidebarBtn.title = sidebarBtn.title || '單位側欄'; sidebarBtn.innerHTML = '<i class="fa-solid fa-table-columns" aria-hidden="true"></i>'; }
        if (logoutBtn) { logoutBtn.title = logoutBtn.title || '登出 / 切換帳號'; logoutBtn.innerHTML = '<i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i>'; }

        // 移除已清空的頂部導覽列、戰鬥暫開鈕，以及舊快速操作球主鈕與彈出選單
        ['.navbar'].forEach(sel => { const n = document.querySelector(sel); if (n) n.remove(); });
        ['combat-navbar-peek', 'qab-main', 'qab-menu'].forEach(id => { const n = document.getElementById(id); if (n) n.remove(); });

        console.log('功能側邊條（SideRail）已載入');
    }

    // 對外介面（含供 PanelDock 整合使用）。側邊條恆顯示，故展開/收合為 no-op。
    return {
        build,
        expand() {},
        collapse() {},
        scheduleCollapse() {},
        dockItemsEl: () => dockItemsEl,
        setDropHint: (on) => { if (rail) rail.classList.toggle('sr-drop-hint', !!on); },
        refreshDock: () => { if (rail) rail.classList.toggle('sr-has-dock', !!(dockItemsEl && dockItemsEl.children.length)); }
    };
})();

if (typeof window !== 'undefined') {
    window.SideRail = SideRail;
    if (document.body) SideRail.build();
    else document.addEventListener('DOMContentLoaded', SideRail.build);
}
