/**
 * Limbus Command - WindowManager（Phase 3A：Z-index 管理）
 *
 * 動機：專案各處將 z-index 寫死（9000 / 9999 / 99999 ...），散落於多個 CSS/JS 檔，
 * 難以維護，且多個浮動面板重疊時無法「最後點擊者置頂」。
 *
 * 設計：
 *  1) WM_Z —— 全專案 z-index 層級的「單一事實來源」（命名常數，取代魔術數字）。
 *  2) WindowManager —— 以「分層 (tier)」管理浮動面板：
 *       - 每個 tier 是一段 z-index 區間 [base, max]。
 *       - 點擊（pointerdown）已註冊的面板時，在「該 tier 區間內」把它抬到最上層，
 *         不會跨越到別的 tier，因此原本「modal 蓋住低層浮動面板、侵蝕控制台浮在 modal 之上」
 *         等既有層級關係都能保留，不會被打亂。
 *       - 區間用盡時自動重新編號（renormalize），保留相對順序。
 *
 * 用法：
 *   WindowManager.register(el, { tier: 'panel' });   // 註冊後點擊即自動置頂
 *   WindowManager.bringToFront(el);                  // 手動置頂（例如面板開啟時）
 */

// ===== 全專案 z-index 層級表（單一事實來源）=====
// 註：CSS 仍保有對應的數值；新程式碼請改引用這裡的命名常數，避免再寫死魔術數字。
const WM_Z = {
    MAP_BASE: 1,        // 地圖 canvas 底層
    TOKEN: 10,          // 棋子（10~60，依大小/BOSS 微調）
    MAP_LABEL: 500,     // 地圖上的標籤 / 測距尺
    QAB: 150,           // 快速操作球與其附屬面板（150~199）
    MODAL: 2000,        // 一般 modal 遮罩（2000~2499）
    OVERLAY: 2500,      // 結算面板等較上層遮罩
    POPOVER: 3000,      // 右鍵選單 / popover / toast / 廣播橫幅
    ROULETTE: 9000,     // 大轉盤相關（9000~9100）
    PANEL: 9400,        // 高層浮動 HUD（浮在 modal 之上，例如侵蝕控制台）（9400~9690）
    LOGIN: 9999,        // 登入層
    WARNING: 12000,     // 高優先警告 toast（永遠在上）
    BROADCAST: 99999,   // 全畫面廣播覆蓋（最上層）
};

const WindowManager = (function () {
    // 各 tier 的 z-index 區間。counter 為目前該 tier 的最高值。
    // 注意：區間刻意落在既有層級之間，確保不破壞現有相對關係。
    const tiers = {
        // 與 QAB 同層、位於 modal 之下的低層浮動面板（如「本回合對抗分配」）
        float: { base: 150, max: 199, counter: 150 },
        // 浮在 modal 之上的高層 HUD（如侵蝕控制台）
        panel: { base: 9400, max: 9690, counter: 9400 },
    };

    const registry = new Map(); // el -> tierName

    function bringToFront(el) {
        if (!el) return;
        const tierName = registry.get(el) || 'panel';
        const tier = tiers[tierName];
        tier.counter += 1;
        if (tier.counter > tier.max) renormalize(tierName);
        el.style.zIndex = String(tier.counter);
    }

    // 區間用盡：依目前 z-index 重新編號回 base 起點，保留相對堆疊順序
    function renormalize(tierName) {
        const tier = tiers[tierName];
        const els = [...registry.entries()]
            .filter(([, t]) => t === tierName)
            .map(([e]) => e)
            .sort((a, b) => (parseInt(a.style.zIndex) || 0) - (parseInt(b.style.zIndex) || 0));
        tier.counter = tier.base;
        els.forEach(e => { e.style.zIndex = String(tier.counter++); });
    }

    function register(el, opts) {
        if (!el || registry.has(el)) return;
        const tierName = (opts && opts.tier && tiers[opts.tier]) ? opts.tier : 'panel';
        registry.set(el, tierName);
        // 點擊面板任意處 → 在該 tier 內置頂（capture 階段，確保先於內部互動）
        el.addEventListener('pointerdown', () => bringToFront(el), true);
        // 給一個初始層級內 z-index（覆寫 CSS 的靜態值，使所有同 tier 面板可比較）
        bringToFront(el);
    }

    return { register, bringToFront, Z: WM_Z, _tiers: tiers };
})();

// 暴露為全域（沿用專案現有的全域變數風格）
window.WindowManager = WindowManager;
window.WM_Z = WM_Z;

// ===== 初始化：註冊目前 body 層級的浮動面板 =====
// 各面板留在與其原本 z-index 相符的 tier，視覺層級不變；當同 tier 有多個面板重疊時，
// 最後點擊者會自動置頂。
function initWindowManager() {
    const erosion = document.getElementById('erosion-hud');          // .floating-hud（modal 之上）
    if (erosion) WindowManager.register(erosion, { tier: 'panel' });

    const counter = document.getElementById('counter-float-panel');  // 對抗分配（modal 之下）
    if (counter) WindowManager.register(counter, { tier: 'float' });
}

if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWindowManager);
    } else {
        initWindowManager();
    }
}
