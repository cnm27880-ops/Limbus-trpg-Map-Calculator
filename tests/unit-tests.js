/**
 * Limbus Command - 純邏輯單元測試（無需瀏覽器/Firebase）
 *
 * 以 Node 的 vm 模組將「實際原始碼檔案」載入沙箱，並 stub 掉 DOM / Firebase / UI 相依，
 * 因此測的是專案中真正執行的函式本體，而非複製品。
 *
 * 執行：node tests/unit-tests.js
 *
 * 涵蓋本次跑團回饋修正中可被純邏輯驗證的項目：
 *   1. isDebuffStatus()         —— 負面狀態判定（欄位 > 分類 > 白名單回退）
 *   1. eroDrainSin()            —— 罪業抽取只移除一半層數、侵蝕增幅換算
 *   2. 防禦附加成功回合資源池    —— 同回合多次攻擊逐步消耗、不每次全額重置
 *   4. 破甲/高速/破魔           —— 黑箱計算直接等效 DP
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');

// ===== 測試計分 =====
let passed = 0;
let failed = 0;
function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (e) {
        failed++;
        console.log(`  ✗ ${name}`);
        console.log(`      ${e.message}`);
    }
}

// ===== 建立沙箱：載入真實原始碼 =====
// stub 的全域：state / DOM / Firebase / UI 回呼。各測試會視需要改寫。
const captured = { addStatus: [], stReview: null, toasts: [] };
let domTable = {}; // id -> 假 DOM 元素

const sandbox = {
    console,
    // 假 DOM：只實作測試會用到的 getElementById
    document: {
        getElementById: (id) => domTable[id] || null
    },
    // 房間/角色：黑箱與侵蝕邏輯要求 ST
    myRole: 'st',
    myPlayerId: 'p1',
    // 狀態：units / 自訂狀態 / 覆寫
    state: { units: [], customStatuses: [], statusOverrides: {} },
    // 單位查詢
    findUnitById: (id) => sandbox.state.units.find(u => u && u.id === id) || null,
    // 黑箱完成後的回呼：擷取 baseDice / baseExtraSuccess / debugStr
    cqEnterSTReview: (baseDice, baseExtraSuccess, debugStr) => {
        captured.stReview = { baseDice, baseExtraSuccess, debugStr };
    },
    // 狀態同步：測試中為 noop（沙箱無 Firebase）
    syncUnitStatus: () => {},
    // 侵蝕抽取會呼叫的 UI/狀態函式
    addStatusToUnit: (unitId, statusId, amount) => { captured.addStatus.push({ unitId, statusId, amount }); },
    showToast: (msg) => { captured.toasts.push(msg); },
    renderErosionConsole: () => {},
    renderClockDisplay: () => {},
    // getStatusByName 真正定義在 status-manager.js（相依 DOM 過重），這裡提供與其行為一致的精簡版：
    // 依名稱在已載入的 STATUS_LIBRARY 與自訂狀態中查找。
    getStatusByName: (name) => {
        const lib = sandbox.STATUS_LIBRARY;
        for (const category of Object.values(lib)) {
            const s = category.find(x => x.name === name);
            if (s) return s;
        }
        return (sandbox.state.customStatuses || []).find(x => x.name === name) || null;
    },
    // 侵蝕系統載入時若偵測到 window 會做綁定；保持 undefined 以走非瀏覽器路徑
    window: undefined
};
vm.createContext(sandbox);

// 瀏覽器中多個 <script> 標籤共享同一個頂層語彙環境，因此各檔案的 top-level `const`
// 彼此可見；但 Node vm 的每次 runInContext 都是獨立語彙環境，跨檔 const 不共享。
// 為忠實模擬瀏覽器載入行為，將相依檔案串接成單一腳本一次執行，並於結尾以 `var` 匯出
// 需要的符號（var 會掛到 context 全域，const/let 不會）。
const files = [
    'src/config/status-config.js',
    'src/core/black-box-engine.js',
    'src/ui/erosion-hud.js'
];
const combined = files.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n')
    + '\n;\nvar __exports = { STATUS_LIBRARY, isDebuffStatus, eroDrainSin, bbRunBlackBoxCalculation };';
vm.runInContext(combined, sandbox, { filename: 'combined-sources.js' });

const { isDebuffStatus, STATUS_LIBRARY, eroDrainSin, bbRunBlackBoxCalculation } = sandbox.__exports;
// getStatusByName stub 需用到 STATUS_LIBRARY（const 不會自動掛到 context）
sandbox.STATUS_LIBRARY = STATUS_LIBRARY;

// 重置每個測試前的擷取狀態
function resetCaptures() {
    captured.addStatus = [];
    captured.stReview = null;
    captured.toasts = [];
    domTable = {};
    sandbox.state.units = [];
    sandbox.state.customStatuses = [];
    sandbox.state.statusOverrides = {};
}

// ====================================================================
console.log('\n[Item 1] isDebuffStatus() 負面狀態判定');
// ====================================================================

test('debuff 分類的狀態 → 視為負面', () => {
    resetCaptures();
    const id = STATUS_LIBRARY.debuff[0].id;
    assert.strictEqual(isDebuffStatus(id), true, `${id} 應為負面`);
});

test('mental 分類的狀態 → 視為負面', () => {
    resetCaptures();
    const id = STATUS_LIBRARY.mental[0].id;
    assert.strictEqual(isDebuffStatus(id), true, `${id} 應為負面`);
});

test('常用·燃燒(burn) → 負面（白名單回退）', () => {
    resetCaptures();
    assert.strictEqual(isDebuffStatus('burn'), true);
});

test('常用·加速(haste) → 非負面（增益不應被抽取）', () => {
    resetCaptures();
    assert.strictEqual(isDebuffStatus('haste'), false);
});

test('侵蝕增幅(erosion_amplify) → 非負面', () => {
    resetCaptures();
    assert.strictEqual(isDebuffStatus('erosion_amplify'), false);
});

test('人格卡·束縛(bind) → 負面（白名單回退涵蓋 identity 減益）', () => {
    resetCaptures();
    assert.strictEqual(isDebuffStatus('bind'), true);
});

test('自訂狀態 isDebuff:true → 負面（欄位優先於分類）', () => {
    resetCaptures();
    sandbox.state.customStatuses = [{ id: 'custom_x', name: '詛咒', category: 'custom', isDebuff: true }];
    assert.strictEqual(isDebuffStatus('custom_x'), true);
});

test('自訂狀態 isDebuff:false → 非負面', () => {
    resetCaptures();
    sandbox.state.customStatuses = [{ id: 'custom_y', name: '祝福', category: 'custom', isDebuff: false }];
    assert.strictEqual(isDebuffStatus('custom_y'), false);
});

// ====================================================================
console.log('\n[Item 1] eroDrainSin() 罪業抽取只移除一半');
// ====================================================================

function setupDrain(sourceStatus) {
    resetCaptures();
    sandbox.state.units = [
        { id: 'boss', type: 'enemy', status: { ...sourceStatus } },
        { id: 'hero', type: 'player', status: {} }
    ];
    domTable['ero-source'] = { value: 'boss' };
    domTable['ero-absorber'] = { selectedOptions: [{ value: 'hero' }] };
}

test('只移除每個負面狀態的一半，保留另一半', () => {
    setupDrain({ 燃燒: '5', 流血: '3' });
    eroDrainSin();
    const boss = sandbox.findUnitById('boss');
    // 燃燒 5 → 移除 floor(5/2)=2 → 剩 3；流血 3 → 移除 1 → 剩 2
    assert.strictEqual(boss.status['燃燒'], '3', '燃燒應剩 3');
    assert.strictEqual(boss.status['流血'], '2', '流血應剩 2');
});

test('增益/侵蝕增幅不被抽取', () => {
    setupDrain({ 燃燒: '4', 加速: '4', 侵蝕增幅: '2' });
    eroDrainSin();
    const boss = sandbox.findUnitById('boss');
    assert.strictEqual(boss.status['加速'], '4', '加速不應被動到');
    assert.strictEqual(boss.status['侵蝕增幅'], '2', '侵蝕增幅不應被動到');
    assert.strictEqual(boss.status['燃燒'], '2', '燃燒 4 → 剩 2');
});

test('吸收者獲得的侵蝕增幅 = 實際抽取量總和', () => {
    setupDrain({ 燃燒: '5', 流血: '3' }); // 抽 2 + 1 = 3
    eroDrainSin();
    const grant = captured.addStatus.find(a => a.statusId === 'erosion_amplify');
    assert.ok(grant, '應有侵蝕增幅授予');
    assert.strictEqual(grant.unitId, 'hero');
    assert.strictEqual(grant.amount, 3, '應 +3 侵蝕增幅');
});

test('僅 1 層的負面狀態 floor(1/2)=0：不被移除', () => {
    setupDrain({ 破裂: '1', 燃燒: '4' });
    eroDrainSin();
    const boss = sandbox.findUnitById('boss');
    assert.strictEqual(boss.status['破裂'], '1', '破裂 1 層不應被抽走');
    assert.strictEqual(boss.status['燃燒'], '2', '燃燒 4 → 剩 2');
    const grant = captured.addStatus.find(a => a.statusId === 'erosion_amplify');
    assert.strictEqual(grant.amount, 2, '只有燃燒貢獻 2');
});

// ====================================================================
console.log('\n[Item 4] 黑箱：破甲/高速/破魔 等效 DP');
// ====================================================================

test('破甲+高速+破魔 併入攻擊 DP 桶', () => {
    resetCaptures();
    sandbox.state.units = [{ id: 'boss', type: 'enemy', status: {}, defDp: 5, defAuto: 0 }];
    bbRunBlackBoxCalculation({
        attacker: { dp: 10, auto: 0, armorPierce: 3, hastePierce: 2, magicPierce: 1 },
        target: { id: 'boss' },
        defense: null
    });
    // atkDpTotal = 10+3+2+1 = 16；finalDefense = 5；baseDice = 11
    assert.strictEqual(captured.stReview.baseDice, 11);
    assert.ok(/破甲\+3/.test(captured.stReview.debugStr), 'debugStr 應列出 破甲+3');
    assert.ok(/高速\+2/.test(captured.stReview.debugStr), 'debugStr 應列出 高速+2');
    assert.ok(/破魔\+1/.test(captured.stReview.debugStr), 'debugStr 應列出 破魔+1');
});

test('未填破甲/高速/破魔時不影響計算', () => {
    resetCaptures();
    sandbox.state.units = [{ id: 'boss', type: 'enemy', status: {}, defDp: 4, defAuto: 0 }];
    bbRunBlackBoxCalculation({ attacker: { dp: 10, auto: 0 }, target: { id: 'boss' }, defense: null });
    assert.strictEqual(captured.stReview.baseDice, 6); // 10 - 4
});

// ====================================================================
console.log('\n[Item 2] 黑箱：BOSS 防禦附加成功為回合刷新資源池');
// ====================================================================

test('同回合多次攻擊逐步消耗 defAutoRemaining，不每次全額重置', () => {
    resetCaptures();
    const boss = { id: 'boss', type: 'enemy', status: {}, defDp: 0, defAuto: 3 };
    sandbox.state.units = [boss];
    const extras = [];
    const attack = () => {
        bbRunBlackBoxCalculation({ attacker: { dp: 0, auto: 2 }, target: { id: 'boss' }, defense: null });
        extras.push(captured.stReview.baseExtraSuccess);
    };
    // 初始池 3。攻擊附加成功 2。
    attack(); // 防 3 → 附加成功 max(0,2-3)=0；消耗 min(3,2)=2 → 剩 1
    attack(); // 防 1 → 附加成功 max(0,2-1)=1；消耗 min(1,2)=1 → 剩 0
    attack(); // 防 0 → 附加成功 max(0,2-0)=2
    assert.deepStrictEqual(extras, [0, 1, 2], '附加成功應隨防禦資源耗盡而遞增');
    assert.strictEqual(boss.defAutoRemaining, 0, '資源池應耗盡為 0');
});

test('防禦方走 QTE（data.defense）時不動用資源池', () => {
    resetCaptures();
    const boss = { id: 'boss', type: 'enemy', status: {}, defDp: 0, defAuto: 3, defAutoRemaining: 3 };
    sandbox.state.units = [boss];
    bbRunBlackBoxCalculation({
        attacker: { dp: 0, auto: 5 },
        target: { id: 'boss' },
        defense: { dp: 0, auto: 1 }
    });
    // 走 QTE：防附加成功取 data.defense.auto=1 → 5-1=4；資源池不變
    assert.strictEqual(captured.stReview.baseExtraSuccess, 4);
    assert.strictEqual(boss.defAutoRemaining, 3, '資源池不應被 QTE 流程改動');
});

// ====================================================================
console.log('\n[Phase 1B] Firebase 寫入粒度優化：syncUnits 欄位級 diff');
// ====================================================================
// 在獨立沙箱載入真實的 firebase-connection.js，stub 掉 DOM/Firebase/設定，
// 並以 roomRef.update 擷取實際寫出的多路徑 payload，驗證只寫變動欄位。
(function () {
    const fbSandbox = {
        console, JSON, Object, Set, Array,
        state: { units: [] },
        window: { addEventListener() {} },
        document: { getElementById: () => null, addEventListener() {} },
        localStorage: { getItem: () => null, setItem() {} },
        CONNECTION_CONFIG: { STORAGE_KEY: 'k' },
    };
    vm.createContext(fbSandbox);
    const fbSrc = fs.readFileSync(path.join(ROOT, 'src/data/firebase-connection.js'), 'utf8')
        + '\n;\nvar __fb = { syncUnits, setRoom: (r) => { roomRef = r; }, setSynced: (m) => { _syncedUnits = m; } };';
    vm.runInContext(fbSrc, fbSandbox, { filename: 'firebase-connection.js' });
    const fb = fbSandbox.__fb;

    let calls = [];
    fb.setRoom({ update: (u) => calls.push(u), child: () => ({ set() {} }) });

    // 基準單位（含 base64 頭像，驗證不變時不重寫）
    const mk = (o) => Object.assign({
        id: 'u1', name: 'A', hp: 10, maxHp: 10, x: 1, y: 1,
        avatar: 'data:image/png;base64,AAAA', status: { burn: '3' }, sortOrder: 0
    }, o);
    const eq = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));

    test('無變動 → 不寫入', () => {
        calls = []; fbSandbox.state.units = [mk()]; fb.setSynced({ u1: mk() });
        fb.syncUnits(); assert.strictEqual(calls.length, 0);
    });
    test('只改 hp → 只寫 units/u1/hp（不動其他欄位/頭像）', () => {
        calls = []; fbSandbox.state.units = [mk({ hp: 5 })]; fb.setSynced({ u1: mk() });
        fb.syncUnits(); eq(calls[0], { 'units/u1/hp': 5 });
    });
    test('改 status 物件 → 整個 status 欄位', () => {
        calls = []; fbSandbox.state.units = [mk({ status: { burn: '5' } })]; fb.setSynced({ u1: mk() });
        fb.syncUnits(); eq(calls[0], { 'units/u1/status': { burn: '5' } });
    });
    test('新單位 → 整筆寫入', () => {
        calls = []; fbSandbox.state.units = [mk(), mk({ id: 'u2', sortOrder: 1 })]; fb.setSynced({ u1: mk() });
        fb.syncUnits(); assert.ok('units/u2' in calls[0] && calls[0]['units/u2'].id === 'u2');
    });
    test('移除單位 → units/u1 = null', () => {
        calls = []; fbSandbox.state.units = []; fb.setSynced({ u1: mk() });
        fb.syncUnits(); eq(calls[0], { 'units/u1': null });
    });
    test('順序改變 → 只寫 sortOrder', () => {
        calls = [];
        fbSandbox.state.units = [mk({ id: 'b', sortOrder: 1 }), mk({ id: 'a', sortOrder: 0 })];
        fb.setSynced({ a: mk({ id: 'a', sortOrder: 0 }), b: mk({ id: 'b', sortOrder: 1 }) });
        fb.syncUnits(); eq(calls[0], { 'units/b/sortOrder': 0, 'units/a/sortOrder': 1 });
    });
})();

// ====================================================================
console.log('\n[Phase 3A] WindowManager：z-index 分層與點擊置頂');
// ====================================================================
(function () {
    const handlers = new Map();
    const mkEl = () => {
        const el = { style: {}, addEventListener: (t, h) => { if (t === 'pointerdown') handlers.set(el, h); } };
        return el;
    };
    const wmSandbox = {
        console, Map, parseInt, String,
        window: {},
        document: { readyState: 'complete', getElementById: () => null, addEventListener() {} },
    };
    vm.createContext(wmSandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/ui/window-manager.js'), 'utf8'), wmSandbox, { filename: 'window-manager.js' });
    const WM = wmSandbox.window.WindowManager;
    const click = (el) => handlers.get(el)();

    test('同 tier 註冊後 z-index 依序遞增', () => {
        const a = mkEl(), b = mkEl();
        WM.register(a, { tier: 'float' }); WM.register(b, { tier: 'float' });
        assert.ok(+b.style.zIndex > +a.style.zIndex);
    });
    test('點擊較低面板 → 在同 tier 內置頂', () => {
        const a = mkEl(), b = mkEl();
        WM.register(a, { tier: 'float' }); WM.register(b, { tier: 'float' });
        click(a);
        assert.ok(+a.style.zIndex > +b.style.zIndex);
    });
    test('各 tier 的 z-index 落在自己的區間（不跨層）', () => {
        const a = mkEl(), c = mkEl();
        WM.register(a, { tier: 'float' }); WM.register(c, { tier: 'panel' });
        assert.ok(+a.style.zIndex >= 150 && +a.style.zIndex <= 199);
        assert.ok(+c.style.zIndex >= 9400 && +c.style.zIndex <= 9690);
    });
    test('區間用盡 → renormalize 壓回 base 且保留相對順序', () => {
        const a = mkEl(), b = mkEl();
        WM.register(a, { tier: 'float' }); WM.register(b, { tier: 'float' });
        WM._tiers.float.counter = 199; click(b);
        assert.ok(+a.style.zIndex <= 199 && +b.style.zIndex <= 199 && +b.style.zIndex > +a.style.zIndex);
    });
    test('WM_Z 層級常數單調遞增（modal < panel < login < warning < broadcast）', () => {
        const Z = wmSandbox.window.WM_Z;
        assert.ok(Z.MODAL < Z.PANEL && Z.PANEL < Z.LOGIN && Z.LOGIN < Z.WARNING && Z.WARNING < Z.BROADCAST);
    });
})();

// ===== 結算 =====
console.log(`\n結果：${passed} 通過，${failed} 失敗\n`);
process.exit(failed ? 1 : 0);
