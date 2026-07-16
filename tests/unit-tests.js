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

// 部分原始碼已改為 ES module（Phase 2）。本測試以 vm 在 script 模式載入原始檔，
// 故先移除 ESM 專屬語法（import / export），只保留可在 script 模式執行的函式本體。
// 被轉換檔案的 `if (typeof window !== 'undefined')` 相容層在沙箱中因無 window 而自動略過。
function stripModuleSyntax(src) {
    return src
        .replace(/^\s*import\s.*?;?\s*$/gm, '')        // 移除 import 陳述式
        .replace(/export\s*\{[\s\S]*?\}\s*;?/g, '')     // 移除 export { ... };
        .replace(/^\s*export\s+(default\s+)?/gm, '');   // 移除 export default / export const 前綴
}
function readSource(relPath) {
    return stripModuleSyntax(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
}

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
    // 黑箱完成後的回呼：擷取 baseDice / baseExtraSuccess / debugStr / extras（豁免抵擋 saveInfo）
    cqEnterSTReview: (baseDice, baseExtraSuccess, debugStr, extras) => {
        captured.stReview = { baseDice, baseExtraSuccess, debugStr, extras: extras || null };
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
const combined = files.map(f => readSource(f)).join('\n;\n')
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
    // ero-revive-target 是「復活目標」與「吸收者」共用的複選 chip 容器
    // （見 erosion-hud.js eroGetSelectedValues），以 querySelectorAll('input:checked') 讀取。
    domTable['ero-revive-target'] = { querySelectorAll: () => [{ value: 'hero' }] };
}

test('抽取「總和」的一半（先加總、只取一次整），不是逐項各自取一半再加總', () => {
    setupDrain({ 燃燒: '5', 流血: '3' });
    eroDrainSin();
    const boss = sandbox.findUnitById('boss');
    // 總和 8 → floor(8/2)=4；先各自 floor(5/2)=2、floor(3/2)=1（共 3），
    // 尾數 1 依序補回第一項 → 燃燒多扣 1 層：燃燒剩 2、流血剩 2
    assert.strictEqual(boss.status['燃燒'], '2', '燃燒應剩 2');
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

test('吸收者獲得的侵蝕增幅 = floor(負面層數總和 / 2)', () => {
    setupDrain({ 燃燒: '5', 流血: '3' }); // 總和 8 → floor(8/2)=4
    eroDrainSin();
    const grant = captured.addStatus.find(a => a.statusId === 'erosion_amplify');
    assert.ok(grant, '應有侵蝕增幅授予');
    assert.strictEqual(grant.unitId, 'hero');
    assert.strictEqual(grant.amount, 4, '應 +4 侵蝕增幅');
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
console.log('\n[Bug1] 黑箱：無視防禦扣減防禦、增加骰數（不得反向）');
// ====================================================================

test('無視防禦扣減目標防禦 → 骰數增加（攻20/防10/無視5 → 15）', () => {
    resetCaptures();
    sandbox.state.units = [{ id: 'boss', type: 'enemy', status: {}, defDp: 10, defAuto: 0 }];
    bbRunBlackBoxCalculation({
        attacker: { dp: 20, auto: 0, ignoreDef: 5 },
        target: { id: 'boss' },
        defense: null
    });
    // finalDefense = 10 - 5 = 5；baseDice = 20 - 5 = 15
    assert.strictEqual(captured.stReview.baseDice, 15, '無視防禦應扣防禦、增加骰數');
    assert.ok(/無視防禦\(-5\)/.test(captured.stReview.debugStr), 'debugStr 應標示 無視防禦(-5)');
});

test('無視防禦骰數必 ≥ 不加無視時（永不使傷害變低）', () => {
    resetCaptures();
    sandbox.state.units = [{ id: 'boss', type: 'enemy', status: {}, defDp: 10, defAuto: 0 }];
    bbRunBlackBoxCalculation({ attacker: { dp: 20, auto: 0, ignoreDef: 0 }, target: { id: 'boss' }, defense: null });
    const without = captured.stReview.baseDice; // 20 - 10 = 10
    resetCaptures();
    sandbox.state.units = [{ id: 'boss', type: 'enemy', status: {}, defDp: 10, defAuto: 0 }];
    bbRunBlackBoxCalculation({ attacker: { dp: 20, auto: 0, ignoreDef: 5 }, target: { id: 'boss' }, defense: null });
    const withIgnore = captured.stReview.baseDice; // 20 - 5 = 15
    assert.strictEqual(without, 10);
    assert.ok(withIgnore >= without, `加無視防禦(${withIgnore})不得比不加(${without})低`);
});

test('無視防禦不影響附加成功（只扣防禦 DP）', () => {
    resetCaptures();
    sandbox.state.units = [{ id: 'boss', type: 'enemy', status: {}, defDp: 10, defAuto: 3 }];
    bbRunBlackBoxCalculation({ attacker: { dp: 20, auto: 2, ignoreDef: 5 }, target: { id: 'boss' }, defense: null });
    // 附加成功桶：攻 2 − 防 3 → max(0,-1)=0，與無視防禦無關
    assert.strictEqual(captured.stReview.baseExtraSuccess, 0, '無視防禦不改變附加成功計算');
});

test('無視防禦超過防禦時，防禦扣到 0 為止（不使攻擊 DP 反被扣）', () => {
    resetCaptures();
    sandbox.state.units = [{ id: 'boss', type: 'enemy', status: {}, defDp: 3, defAuto: 0 }];
    bbRunBlackBoxCalculation({ attacker: { dp: 20, auto: 0, ignoreDef: 10 }, target: { id: 'boss' }, defense: null });
    // finalDefense = max(0, 3 - 10) = 0；baseDice = 20 - 0 = 20（不會變 20-(-7)=27，也不會反扣攻擊）
    assert.strictEqual(captured.stReview.baseDice, 20);
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
console.log('\n[豁免抵擋] 黑箱：resolveMode=save 不扣防禦、附上目標豁免骰數');
// ====================================================================

test('豁免模式：骰數 = 全額攻擊 DP（不扣防禦），saveInfo 帶目標清單與攻擊擲骰', () => {
    resetCaptures();
    const boss = { id: 'boss', type: 'enemy', status: {}, defDp: 50, defAuto: 5, saveReflex: 12 };
    sandbox.state.units = [boss];
    bbRunBlackBoxCalculation({
        attacker: { dp: 30, auto: 2, resolveMode: 'save', saveType: 'saveReflex' },
        target: { id: 'boss' },
        defense: null
    });
    // 不扣防禦：骰數 = 30（防 50 不參與）；附加成功不被防禦附加抵銷 = 2
    assert.strictEqual(captured.stReview.baseDice, 30, '豁免模式骰數應為全額攻擊 DP');
    assert.strictEqual(captured.stReview.baseExtraSuccess, 2, '豁免模式附加成功不被防禦附加抵銷');
    const si = captured.stReview.extras && captured.stReview.extras.saveInfo;
    assert.ok(si, '應附上 saveInfo');
    assert.strictEqual(si.saveName, '反射');
    assert.ok(Array.isArray(si.targets) && si.targets.length === 1, 'saveInfo 應含目標清單');
    assert.strictEqual(si.targets[0].saveDice, 12, '目標反射豁免骰數 12');
    assert.ok(si.atkRoll && typeof si.atkRoll.successes === 'number', 'saveInfo 應含攻擊擲骰結果 atkRoll');
    assert.ok(/豁免抵擋/.test(captured.stReview.debugStr), 'debugStr 應標示豁免抵擋模式');
});

test('豁免模式多目標：targets 帶各自的豁免骰數', () => {
    resetCaptures();
    const b = { id: 'b', type: 'enemy', status: {}, saveReflex: 8 };
    const c = { id: 'c', type: 'enemy', status: {}, saveReflex: 3 };
    sandbox.state.units = [b, c];
    bbRunBlackBoxCalculation({
        attacker: { dp: 20, auto: 0, resolveMode: 'save', saveType: 'saveReflex' },
        target: { id: 'b' },
        targets: [{ id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
        defense: null
    });
    const si = captured.stReview.extras.saveInfo;
    assert.strictEqual(si.targets.length, 2);
    assert.strictEqual(si.targets[0].saveDice, 8);
    assert.strictEqual(si.targets[1].saveDice, 3);
});

test('豁免模式：不消耗 BOSS 防禦附加成功資源池', () => {
    resetCaptures();
    const boss = { id: 'boss', type: 'enemy', status: {}, defDp: 0, defAuto: 3, defAutoRemaining: 3, saveWill: 6 };
    sandbox.state.units = [boss];
    bbRunBlackBoxCalculation({
        attacker: { dp: 10, auto: 4, resolveMode: 'save', saveType: 'saveWill' },
        target: { id: 'boss' },
        defense: null
    });
    assert.strictEqual(captured.stReview.baseExtraSuccess, 4);
    assert.strictEqual(boss.defAutoRemaining, 3, '豁免模式不應動用防禦附加資源池');
});

test('防禦扣除模式（未帶 resolveMode）行為不變，saveInfo 為空', () => {
    resetCaptures();
    sandbox.state.units = [{ id: 'boss', type: 'enemy', status: {}, defDp: 4, defAuto: 0, saveReflex: 99 }];
    bbRunBlackBoxCalculation({ attacker: { dp: 10, auto: 0 }, target: { id: 'boss' }, defense: null });
    assert.strictEqual(captured.stReview.baseDice, 6); // 10 - 4
    const extras = captured.stReview.extras;
    assert.ok(!extras || !extras.saveInfo, '防禦扣除模式不應附 saveInfo');
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
    const fbSrc = readSource('src/data/firebase-connection.js')
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
console.log('\n[人格卡狀態套用] cmResolveIdentityBonus() 不再遺漏 selfStatus');
// ====================================================================
// 在獨立沙箱載入真實的 status-config / identity-config / identity-engine / identity-hud /
// combat-modals，驗證修正前遺漏的 result.expectedSelfStatus 現在會被 cmResolveIdentityBonus()
// 一併整理成 selfStatus / selfStatusNotes 回傳（供 submitAttackModal 套用到攻擊者自己身上）。
(function () {
    const idSandbox = {
        console, Object, Array, Math, JSON, Set, parseInt,
        window: undefined,
        document: { getElementById: () => null },
        localStorage: { getItem: () => null, setItem() {} },
        myRole: 'player',
        state: { units: [] },
        findUnitById: (id) => idSandbox.state.units.find(u => u && u.id === id) || null,
        showToast: () => {},
        escapeHtml: (s) => s,
    };
    vm.createContext(idSandbox);
    const identityFiles = [
        'src/config/status-config.js',
        'src/config/identity-config.js',
        'src/core/identity-engine.js',
        'src/ui/identity-hud.js',
        'src/ui/combat-modals.js'
    ];
    const combinedIdentity = identityFiles.map(f => readSource(f)).join('\n;\n')
        + '\n;\nvar __identityExports = { cmResolveIdentityBonus, identityHudState, collectUntriggeredBonusHooks };';
    vm.runInContext(combinedIdentity, idSandbox, { filename: 'combined-identity.js' });
    const { cmResolveIdentityBonus, identityHudState, collectUntriggeredBonusHooks } = idSandbox.__identityExports;

    test('唐吉訶德「延續進攻」命中同時算出 targetStatus 與 selfStatus，兩者皆不遺漏', () => {
        identityHudState.owner = '唐吉訶德';
        identityHudState.cards = { don_cinq: { owned: true, unlocked: false } };
        const attacker = { id: 'atk1', status: {}, init: 10 };
        const target = { id: 'tgt1', status: {}, init: 5 };

        const result = cmResolveIdentityBonus(attacker, target);

        // 命中：延續進攻（selfStatus.swiftness+1／targetStatus.bind+1）+ 雙旋飛刺（targetStatus.bind+1）
        assert.strictEqual(result.onHitSelfStatus.swiftness, 4, '攻擊者自身應算出 +1 迅捷（修正前這裡會是空物件）');
        assert.ok(result.onHitSelfStatusNotes.length > 0, 'onHitSelfStatusNotes 不應為空');
        assert.ok(result.onHitSelfStatusNotes.some(n => n.includes('+4')), 'onHitSelfStatusNotes 應包含層數敘述');
        assert.strictEqual(result.onHitTargetStatus.bind, 2, '目標應疊加 2 層束縛（延續進攻+雙旋飛刺）');
    });

    test('格里高爾：目標無沮喪 → 條件式 DP 加值列入「未觸發」清單而非直接消失', () => {
        const owned = [{ id: 'gregor_edgar', unlocked: false }];
        const list = collectUntriggeredBonusHooks(owned, { status: {} }, { status: {} });
        // 長劍劈砍 x2 / 延續進攻（條件未達）＋ 噩夢狩獵（未解鎖）
        assert.ok(list.length >= 4, `應列出 4 筆未觸發的 DP 加值，實得 ${list.length}`);
        assert.ok(list.every(u => u.reason && u.bonusTxt), '每筆未觸發項目都應附原因與加值內容');
        assert.ok(list.some(u => u.reason.includes('解鎖')), '未解鎖的三技應標示原因為未解鎖');
        assert.ok(list.some(u => u.reason.includes('條件未達')), '狀態門檻未達者應標示條件未達');
    });

    test('格里高爾：目標沮喪 10＋已解鎖 → 全部觸發，未觸發清單為空', () => {
        const owned = [{ id: 'gregor_edgar', unlocked: true }];
        const list = collectUntriggeredBonusHooks(owned, { status: {} }, { status: { depression: 10 } });
        assert.strictEqual(list.length, 0, `不應有未觸發項目，實得 ${list.length}`);
    });

    test('人格卡面板的手動資源（魔法阿卡納）在實際攻擊路徑同樣生效', () => {
        identityHudState.owner = '唐吉訶德';
        identityHudState.cards = { don_ego: { owned: true, unlocked: false } };
        identityHudState.cardInputs = { don_ego: { arcana: 3, will: 0, loveHate: 0 } };
        const result = cmResolveIdentityBonus({ id: 'atk1', status: {}, init: 10 }, { id: 'tgt1', status: {} });
        // 魔法阿卡納：攻擊檢定 +層數（修正前實際攻擊不讀面板手動資源，這裡會是 0）
        assert.strictEqual(result.dpBonus, 3, `阿卡納 3 層應轉為 DP +3，實得 ${result.dpBonus}`);
        identityHudState.cardInputs = {};
    });
})();

// ====================================================================
console.log('\n[模板整併] 單位模板：完整數值保存與同名覆蓋更新');
// ====================================================================
(function () {
    const store = {};
    const stSandbox = {
        console, JSON, Object, Array, Math, Date, parseInt, String, Number,
        localStorage: {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; }
        },
        state: { units: [] },
        location: { reload() {} }
    };
    vm.createContext(stSandbox);
    vm.runInContext(readSource('src/data/storage.js')
        + '\n;\nvar __stExports = { saveUnitTemplate, updateUnitTemplate, findUnitTemplateByName, upsertUnitTemplateByName, getUnitTemplates };',
        stSandbox, { filename: 'storage.js' });
    const { saveUnitTemplate, findUnitTemplateByName, upsertUnitTemplateByName, getUnitTemplates } = stSandbox.__stExports;

    test('模板保存完整戰鬥數值（含先攻 init 與行動說明 actionNote）', () => {
        const saved = saveUnitTemplate({
            name: '腐化清掃工', hp: 18, type: 'enemy', size: 1, avatar: null,
            combat: { defDp: 9, defAuto: 1, init: 6, actionDp: 11, passive: '腐化滲出', actionNote: '近戰' }
        });
        assert.ok(saved && saved.id, '應成功保存並回傳含 id 的模板');
        assert.strictEqual(saved.combat.init, 6, 'init 應存入 combat');
        assert.strictEqual(saved.combat.actionNote, '近戰', 'actionNote 應存入 combat');
        assert.strictEqual(saved.combat.defAuto, 1, 'defAuto 應存入 combat');
    });

    test('同名 upsert 覆蓋更新原模板（保留 id、不產生重複模板）', () => {
        const before = findUnitTemplateByName('腐化清掃工');
        const result = upsertUnitTemplateByName({
            name: '腐化清掃工', hp: 24, type: 'enemy', size: 1, avatar: null,
            combat: { defDp: 12, defAuto: 2, init: 8, actionDp: 13 }
        });
        assert.ok(result && result.updated, '同名模板應走更新路徑');
        assert.strictEqual(result.template.id, before.id, '更新後 id 不變');
        assert.strictEqual(result.template.hp, 24, 'hp 應更新');
        assert.strictEqual(result.template.combat.defAuto, 2, 'combat 數值應更新');
        const all = getUnitTemplates().filter(t => t.name === '腐化清掃工');
        assert.strictEqual(all.length, 1, '不應出現同名重複模板');
    });

    test('不同名 upsert 走新增路徑', () => {
        const result = upsertUnitTemplateByName({ name: '另一隻怪', hp: 10, type: 'enemy' });
        assert.ok(result && !result.updated, '不同名應新增');
        assert.strictEqual(getUnitTemplates().length, 2, '模板總數應為 2');
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
    vm.runInContext(readSource('src/ui/window-manager.js'), wmSandbox, { filename: 'window-manager.js' });
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

// ====================================================================
console.log('\n[Item 6] 戰術移動系統（5 米 1 格，斜走加倍）');
// ====================================================================
// utils.js（calcTacticalCost / getUnitMaxMoveGrids / getUnitMoveRemaining）與
// map.js（calcRulerDistance / applyMoveCost）使用獨立沙箱，
// 避免 utils.js 的 showToast 等函式覆蓋主沙箱的 stub。
(() => {
    const mvSandbox = {
        console,
        document: { getElementById: () => null },
        window: undefined,
        myRole: 'player',
        state: { isCombatActive: true, mapData: [], mapPalette: [] },
        // 困難地形查詢：簡化版，直接查 state.mapPalette（與 state.js 的 getTileFromPalette 行為一致）
        getTileFromPalette: (id) => (mvSandbox.state.mapPalette || []).find(t => t.id === id) || null,
    };
    vm.createContext(mvSandbox);
    const mvCombined = ['src/utils/utils.js', 'src/ui/map.js'].map(f => readSource(f)).join('\n;\n')
        + '\n;\nvar __mv = { calcTacticalCost, getUnitMaxMoveGrids, getUnitMoveRemaining, calcRulerDistance, applyMoveCost, calcTacticalPathCost, getTileMoveMultiplier };';
    vm.runInContext(mvCombined, mvSandbox, { filename: 'combined-move-sources.js' });
    const { calcTacticalCost, getUnitMaxMoveGrids, getUnitMoveRemaining, calcRulerDistance, applyMoveCost, calcTacticalPathCost, getTileMoveMultiplier } = mvSandbox.__mv;

    test('calcTacticalCost：純直走 → 每格消耗 1', () => {
        assert.strictEqual(calcTacticalCost(3, 0), 3);
        assert.strictEqual(calcTacticalCost(0, 4), 4);
    });
    test('calcTacticalCost：純斜走 → 每格消耗 2', () => {
        assert.strictEqual(calcTacticalCost(2, 2), 4);
        assert.strictEqual(calcTacticalCost(-3, 3), 6);
    });
    test('calcTacticalCost：混合路徑 → 直走 + 斜走×2 加總', () => {
        // (3,2)：斜走 2 步（消耗 4）+ 直走 1 步（消耗 1）= 5
        assert.strictEqual(calcTacticalCost(3, 2), 5);
        assert.strictEqual(calcTacticalCost(-3, 2), 5);
        // (1,-5)：斜走 1 步（消耗 2）+ 直走 4 步（消耗 4）= 6
        assert.strictEqual(calcTacticalCost(1, -5), 6);
    });
    test('calcRulerDistance：折線各段消耗加總（含游標段）', () => {
        // (0,0)→(3,2) 消耗 5；(3,2)→(3,5) 消耗 3；合計 8
        const total = calcRulerDistance([{ x: 0, y: 0 }, { x: 3, y: 2 }], { x: 3, y: 5 });
        assert.strictEqual(total, 8);
    });
    test('getUnitMaxMoveGrids：floor(移動速度/5)，未設定預設 20 米 = 4 格', () => {
        assert.strictEqual(getUnitMaxMoveGrids({ moveSpeed: 20 }), 4);
        assert.strictEqual(getUnitMaxMoveGrids({ moveSpeed: 23 }), 4);  // 向下取整
        assert.strictEqual(getUnitMaxMoveGrids({ moveSpeed: 7 }), 1);
        assert.strictEqual(getUnitMaxMoveGrids({}), 4);                 // 預設 20
    });
    test('getUnitMoveRemaining：上限 - 已消耗，不為負', () => {
        assert.strictEqual(getUnitMoveRemaining({ moveSpeed: 20, moveUsed: 3 }), 1);
        assert.strictEqual(getUnitMoveRemaining({ moveSpeed: 20, moveUsed: 9 }), 0);
    });
    test('applyMoveCost：能量足夠 → 放行並累加 moveUsed', () => {
        mvSandbox.myRole = 'player';
        mvSandbox.state.isCombatActive = true;
        const u = { x: 0, y: 0, moveSpeed: 20, moveUsed: 0 };
        assert.strictEqual(applyMoveCost(u, 2, 2), true);   // 斜走 2 步 = 4 格
        assert.strictEqual(u.moveUsed, 4);
    });
    test('applyMoveCost：能量耗盡 → 攔截且不累加', () => {
        mvSandbox.myRole = 'player';
        mvSandbox.state.isCombatActive = true;
        const u = { x: 0, y: 0, moveSpeed: 20, moveUsed: 4 };
        assert.strictEqual(applyMoveCost(u, 1, 0), false);  // 剩 0 格，直走 1 也不行
        assert.strictEqual(u.moveUsed, 4);
    });
    test('applyMoveCost：ST 自由移動，不消耗能量', () => {
        mvSandbox.myRole = 'st';
        const u = { x: 0, y: 0, moveSpeed: 20, moveUsed: 4 };
        assert.strictEqual(applyMoveCost(u, 10, 10), true);
        assert.strictEqual(u.moveUsed, 4);
    });
    test('applyMoveCost：部署（場外進場）與非戰鬥中不設限', () => {
        mvSandbox.myRole = 'player';
        mvSandbox.state.isCombatActive = true;
        const deploying = { x: -1, y: -1, moveSpeed: 20, moveUsed: 0 };
        assert.strictEqual(applyMoveCost(deploying, 5, 5), true);
        assert.strictEqual(deploying.moveUsed, 0);

        mvSandbox.state.isCombatActive = false;
        const explorer = { x: 0, y: 0, moveSpeed: 20, moveUsed: 0 };
        assert.strictEqual(applyMoveCost(explorer, 10, 10), true);
        assert.strictEqual(explorer.moveUsed, 0);
    });

    // ----- 困難地形（移動消耗倍率）-----
    test('getTileMoveMultiplier：地板／未設定倍率一律回傳 1', () => {
        mvSandbox.state.mapData = [[0, 5]];
        mvSandbox.state.mapPalette = [{ id: 5, name: '普通地形', effect: '' }]; // 無 moveCostMultiplier 欄位
        assert.strictEqual(getTileMoveMultiplier(0, 0), 1); // 地板
        assert.strictEqual(getTileMoveMultiplier(1, 0), 1); // 未設定倍率
    });
    test('getTileMoveMultiplier：讀取地形設定的倍率', () => {
        mvSandbox.state.mapData = [[7]];
        mvSandbox.state.mapPalette = [{ id: 7, name: '鬆軟沙地', effect: '', moveCostMultiplier: 2 }];
        assert.strictEqual(getTileMoveMultiplier(0, 0), 2);
    });
    test('calcTacticalPathCost：全程困難地形（×2）→ 直走與斜走消耗皆加倍', () => {
        // 3x3 全鋪困難地形（倍率2）
        mvSandbox.state.mapPalette = [{ id: 9, name: '困難地形', effect: '', moveCostMultiplier: 2 }];
        mvSandbox.state.mapData = Array.from({ length: 3 }, () => Array(3).fill(9));
        // 純直走 2 格：一般消耗 2，困難地形應為 4
        assert.strictEqual(calcTacticalPathCost(0, 0, 2, 0), 4);
        // 純斜走 2 格：一般消耗 4，困難地形應為 8
        assert.strictEqual(calcTacticalPathCost(0, 0, 2, 2), 8);
    });
    test('calcTacticalPathCost：僅終點是困難地形，其餘為地板 → 只有進入那格加倍', () => {
        mvSandbox.state.mapPalette = [{ id: 9, name: '困難地形', effect: '', moveCostMultiplier: 2 }];
        // (0,0)→(2,0)：中間(1,0)為地板，終點(2,0)為困難地形
        mvSandbox.state.mapData = [[0, 0, 9]];
        // 第一步（進入 1,0）消耗 1×1=1；第二步（進入 2,0 困難地形）消耗 1×2=2；合計 3
        assert.strictEqual(calcTacticalPathCost(0, 0, 2, 0), 3);
    });
    test('calcTacticalPathCost：一般地板（無困難地形）與 calcTacticalCost 結果一致', () => {
        mvSandbox.state.mapPalette = [];
        mvSandbox.state.mapData = Array.from({ length: 5 }, () => Array(5).fill(0));
        assert.strictEqual(calcTacticalPathCost(0, 0, 3, 2), calcTacticalCost(3, 2));
    });
    test('applyMoveCost：困難地形實際消耗更多移動能量', () => {
        mvSandbox.myRole = 'player';
        mvSandbox.state.isCombatActive = true;
        mvSandbox.state.mapPalette = [{ id: 9, name: '困難地形', effect: '', moveCostMultiplier: 2 }];
        mvSandbox.state.mapData = [[9, 9]]; // (0,0) 與 (1,0) 皆為困難地形
        const u = { x: 0, y: 0, moveSpeed: 20, moveUsed: 0 };
        // 直走 1 格，一般應消耗 1，困難地形應消耗 2
        assert.strictEqual(applyMoveCost(u, 1, 0), true);
        assert.strictEqual(u.moveUsed, 2);
    });
})();

// ====================================================================
console.log('\n[骰先攻面板] irSetAll 快速勾選（全選／僅敵方/BOSS／僅我方／清除）');
// ====================================================================
(() => {
    // 模擬勾選框：只實作 irSetAll 會用到的 checked / dataset.type
    function makeCheck(type, checked) {
        return { checked, dataset: { type } };
    }
    let checks;
    const irSandbox = {
        console,
        document: {
            getElementById: () => null,
            addEventListener() {},
            querySelectorAll: (sel) => sel === '#init-roll-modal .ir-check' ? checks : [],
        },
        window: undefined,
    };
    vm.createContext(irSandbox);
    const irSrc = readSource('src/ui/units.js') + '\n;\nvar __ir = { irSetAll };';
    vm.runInContext(irSrc, irSandbox, { filename: 'units.js' });
    const { irSetAll } = irSandbox.__ir;

    test('irSetAll("all")：不論原本狀態或陣營，全部勾選', () => {
        checks = [makeCheck('player', false), makeCheck('enemy', false), makeCheck('boss', true)];
        irSetAll('all');
        assert.ok(checks.every(c => c.checked === true));
    });
    test('irSetAll("none")：全部取消勾選', () => {
        checks = [makeCheck('player', true), makeCheck('enemy', true), makeCheck('boss', true)];
        irSetAll('none');
        assert.ok(checks.every(c => c.checked === false));
    });
    test('irSetAll("enemy")：只勾選 enemy 與 boss，player 取消', () => {
        checks = [makeCheck('player', true), makeCheck('enemy', false), makeCheck('boss', false)];
        irSetAll('enemy');
        assert.deepStrictEqual(checks.map(c => c.checked), [false, true, true]);
    });
    test('irSetAll("player")：只勾選 player，enemy/boss 取消', () => {
        checks = [makeCheck('player', false), makeCheck('enemy', true), makeCheck('boss', true)];
        irSetAll('player');
        assert.deepStrictEqual(checks.map(c => c.checked), [true, false, false]);
    });
})();

// ====================================================================
console.log('\n[先攻] rollInitiative 為無狀態基準；sortByInit 依「有效先攻」即時排序');
// ====================================================================
(() => {
    let cells;
    const rollSandbox = {
        console,
        myRole: 'st',
        state: { units: [], turnIdx: 0 },
        findUnitById: (id) => rollSandbox.state.units.find(u => u && u.id === id) || null,
        showToast: () => {},
        broadcastState: () => {},
        document: {
            querySelectorAll: (sel) => sel === '#init-roll-modal .ir-check:checked' ? rollSandbox.__checked : [],
            getElementById: (id) => cells[id] || null,
            addEventListener: () => {},
            readyState: 'complete',
        },
        // 讓 1D10 固定擲出 1（0.05*10 取整 +1 = 1），排除隨機性
        Math: { random: () => 0.05, floor: Math.floor, max: Math.max, min: Math.min },
        window: undefined,
    };
    vm.createContext(rollSandbox);
    const rollSrc = readSource('src/config/status-config.js') + '\n;\n' + readSource('src/ui/units.js')
        + '\n;\nvar __roll = { rollInitiative, sortByInit, getEffectiveInit };';
    vm.runInContext(rollSrc, rollSandbox, { filename: 'roll-init.js' });
    const { rollInitiative, sortByInit, getEffectiveInit } = rollSandbox.__roll;

    test('rollInitiative：擲骰結果不讀取迅捷／束縛，只有 D10 + 先攻加值（無狀態基準）', () => {
        cells = { 'ir-result-u1': { textContent: '' } };
        rollSandbox.state.units = [{ id: 'u1', initBonus: 2, status: { '迅捷': '3', '束縛': '9' } }];
        rollSandbox.__checked = [{ value: 'u1' }];
        rollInitiative();
        assert.strictEqual(rollSandbox.state.units[0].init, 1 + 2, '先攻基準不應被狀態污染');
    });

    test('getEffectiveInit：先攻基準 + 迅捷層數 - 束縛層數', () => {
        const u = { init: 10, status: { '迅捷': '3', '束縛': '1' } };
        assert.strictEqual(getEffectiveInit(u), 10 + 3 - 1);
    });

    test('getEffectiveInit：無狀態時等於先攻基準本身', () => {
        assert.strictEqual(getEffectiveInit({ init: 7, status: {} }), 7);
    });

    test('sortByInit：依「有效先攻」排序，不需手動把迅捷/束縛換算進先攻數值', () => {
        // a 基準較低但迅捷 5 層，實質應排在基準較高、束縛 3 層的 b 之前
        const a = { id: 'a', init: 5, status: { '迅捷': '5' } };   // 有效 10
        const b = { id: 'b', init: 11, status: { '束縛': '3' } };  // 有效 8
        const c = { id: 'c', init: 9, status: {} };                // 有效 9
        rollSandbox.state.units = [b, a, c];
        rollSandbox.state.turnIdx = 0;
        sortByInit();
        assert.deepStrictEqual(rollSandbox.state.units.map(u => u.id), ['a', 'c', 'b']);
        // 排序不應改動先攻基準本身（狀態隨時會變化，基準要保持乾淨可重算）
        assert.strictEqual(a.init, 5);
        assert.strictEqual(b.init, 11);
    });
})();

// ===== AOE 多重行動支援 =====
// 驗證 BOSS 第 7 個行動也能被 AOE 模式辨識
(function () {
    // 載入 aoe-select.js 沙箱以測試 aoeGetBossAoeActions 對超過 5 個行動的支援
    const aoeSandbox = {
        console, JSON, Object, Set, Array, Map, Number, String, Boolean, parseInt, parseFloat, isNaN, Math, Date, RegExp,
        myRole: 'st',
        state: {
            activeBossId: 1,
            units: [
                {
                    id: 1, name: 'BOSS', isBoss: true, actionDp: 10,
                    // 第 7 個行動（AOE 旗標 + 豁免類型）
                    actionSubUnits: [
                        { id: 101, actionDp: 5, actionAoe: false },
                        { id: 102, actionDp: 5, actionAoe: false },
                        { id: 103, actionDp: 5, actionAoe: false },
                        { id: 104, actionDp: 5, actionAoe: false },
                        { id: 105, actionDp: 5, actionAoe: false },
                        { id: 106, actionDp: 5, actionAoe: false },
                        { id: 107, actionDp: 12, actionAoe: true, actionSaveType: 'saveReflex', actionStatuses: [{ id: 'burn', value: 3 }] },
                    ]
                },
            ],
        },
        // stub findUnitById / getActionSlots
        findUnitById: function (id) { return this.state.units.find(u => u.id === id); },
        getActionSlots: function (id) {
            const u = this.state.units.find(x => x.id === id);
            return Array.isArray(u && u.actionSubUnits) ? u.actionSubUnits : [];
        },
        window: { addEventListener() {} },
        document: { getElementById: () => null, addEventListener() {}, querySelectorAll: () => [], createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, addEventListener() {} }), body: { appendChild() {} } },
    };
    // bind `this`
    aoeSandbox.findUnitById = aoeSandbox.findUnitById.bind(aoeSandbox);
    aoeSandbox.getActionSlots = aoeSandbox.getActionSlots.bind(aoeSandbox);
    vm.createContext(aoeSandbox);
    const src = readSource('src/ui/aoe-select.js') +
        '\n;\nvar __aoe = { getActions: aoeGetBossAoeActions, resolveName: aoeResolveAttackerName };';
    vm.runInContext(src, aoeSandbox, { filename: 'aoe-select.js' });
    const { getActions, resolveName } = aoeSandbox.__aoe;

    test('BOSS 多重行動第 7 個行動：AOE 旗標與豁免類型正確讀出（修正「行動7抓不到」BUG）', () => {
        const actions = getActions();
        assert.strictEqual(actions.length, 1, 'AOE 旗標只有第 7 個行動 → 應回傳 1 筆');
        const action7 = actions[0];
        assert.strictEqual(action7.aoe, true, '第 7 個行動的 AOE 旗標應為 true');
        assert.strictEqual(action7.saveType, 'saveReflex', '第 7 個行動的豁免類型應為 saveReflex');
        assert.strictEqual(action7.dp, 12, '第 7 個行動的 DP 應為 12');
        assert.strictEqual(action7.statuses.length, 1, '第 7 個行動應帶 1 個狀態');
        assert.strictEqual(action7.statuses[0].id, 'burn');
        assert.strictEqual(action7.statuses[0].value, 3);
    });
    test('BOSS 多重行動第 7 個行動：非法 saveType 回退到預設 saveReflex', () => {
        aoeSandbox.state.units[0].actionSubUnits[6].actionSaveType = 'invalid_type';
        const actions = getActions();
        assert.strictEqual(actions[0].saveType, 'saveReflex', '非法 saveType 應回退到 saveReflex');
    });
    test('AOE 模式：未設定 activeBossId 時自動找到本體BOSS（有行動但未點👑的情況）', () => {
        aoeSandbox.state.activeBossId = null;  // 未點 👑
        const actions = getActions();
        assert.strictEqual(actions.length, 1, '即使未設定 activeBossId，仍應找到行動 7');
        assert.strictEqual(actions[0].aoe, true);
    });
    test('AOE 模式：攻擊者名稱在未設定 activeBossId 時也能正確回退', () => {
        aoeSandbox.state.activeBossId = null;
        const name = resolveName();
        assert.strictEqual(name, 'BOSS', '未設定 activeBossId 時應回退到「BOSS」');
    });
})();

// ====================================================================
console.log('\n[新人格卡] 浮士德 - W公司 2 級清掃人員（充能 / 束縛）');
// ====================================================================
(function () {
    const idSandbox = {
        console, Object, Array, Math, JSON, Set, parseInt,
        window: undefined,
        document: { getElementById: () => null },
        localStorage: { getItem: () => null, setItem() {} },
        myRole: 'player',
        state: { units: [] },
        findUnitById: (id) => idSandbox.state.units.find(u => u && u.id === id) || null,
        showToast: () => {},
        escapeHtml: (s) => s,
    };
    vm.createContext(idSandbox);
    const identityFiles = [
        'src/config/status-config.js',
        'src/config/identity-config.js',
        'src/core/identity-engine.js',
        'src/ui/identity-hud.js',
        'src/ui/combat-modals.js'
    ];
    vm.runInContext(identityFiles.map(f => readSource(f)).join('\n;\n')
        + '\n;\nvar __wExports = { cmResolveIdentityBonus, identityHudState, IDENTITY_LIBRARY };',
        idSandbox, { filename: 'combined-faust-wcorp.js' });
    const { cmResolveIdentityBonus, identityHudState, IDENTITY_LIBRARY } = idSandbox.__wExports;

    test('人格庫已收錄 faust_wcorp（過度充能為重複抽取解鎖技）', () => {
        const card = IDENTITY_LIBRARY.faust_wcorp;
        assert.ok(card, '人格庫應包含 faust_wcorp');
        assert.strictEqual(card.owner, '浮士德');
        assert.strictEqual(card.repeatUnlockSkill, '過度充能');
        assert.ok(Array.isArray(card.hooks.onActive) && card.hooks.onActive.length >= 6, '各段超載／消耗宣告技應收錄於 onActive');
    });

    test('能源循環＋騰躍速攻：施法獲得 4 層充能、命中再獲得 5 層', () => {
        identityHudState.owner = '浮士德';
        identityHudState.cards = { faust_wcorp: { owned: true, unlocked: false } };
        identityHudState.cardInputs = {};
        const result = cmResolveIdentityBonus({ id: 'atk1', status: {}, init: 10 }, { id: 'tgt1', status: {} });
        assert.strictEqual(result.onAttackSelfStatus.charge, 4, '宣告施法應獲得 4 層充能');
        assert.strictEqual(result.onHitSelfStatus.charge, 5, '法術命中應再獲得 5 層充能');
    });

    test('過度充能：充能 5+ 且解鎖 → 額外 +6 DP；未解鎖不計入', () => {
        identityHudState.owner = '浮士德';
        identityHudState.cardInputs = {};
        // 充能以中文狀態名掛在單位上（buildEngineUnitState 會轉回引擎英文鍵）
        const attacker = { id: 'atk1', status: { '充能': 6 }, init: 10 };
        identityHudState.cards = { faust_wcorp: { owned: true, unlocked: true } };
        let result = cmResolveIdentityBonus(attacker, { id: 'tgt1', status: {} });
        assert.strictEqual(result.dpBonus, 6, `充能 6 層＋解鎖應 +6 DP，實得 ${result.dpBonus}`);

        identityHudState.cards = { faust_wcorp: { owned: true, unlocked: false } };
        result = cmResolveIdentityBonus(attacker, { id: 'tgt1', status: {} });
        assert.strictEqual(result.dpBonus, 0, '未解鎖時不應計入 +6 DP');
    });

    test('過度充能：充能不足 5 層 → 解鎖也不觸發', () => {
        identityHudState.owner = '浮士德';
        identityHudState.cards = { faust_wcorp: { owned: true, unlocked: true } };
        const result = cmResolveIdentityBonus({ id: 'atk1', status: { '充能': 4 }, init: 10 }, { id: 'tgt1', status: {} });
        assert.strictEqual(result.dpBonus, 0, '充能 4 層不應觸發 +6 DP');
    });
})();

// ====================================================================
console.log('\n[命中全自動化] cmApplyOnHitIdentityStatuses：命中才套用、含攻擊者自身增益');
// ====================================================================
(function () {
    const appliedCalls = [];
    const hitSandbox = {
        console, Object, Array, Math, JSON, Set, parseInt,
        window: undefined,
        document: { getElementById: () => null },
        localStorage: { getItem: () => null, setItem() {} },
        myRole: 'st',
        state: { units: [] },
        findUnitById: (id) => hitSandbox.state.units.find(u => u && u.id === id) || null,
        addStatusToUnit: (unitId, statusId, amount) => appliedCalls.push({ unitId, statusId, amount }),
        showToast: () => {},
        escapeHtml: (s) => s,
    };
    vm.createContext(hitSandbox);
    const hitFiles = [
        'src/config/status-config.js',
        'src/config/identity-config.js',
        'src/core/identity-engine.js',
        'src/ui/identity-hud.js',
        'src/ui/combat-modals.js'
    ];
    vm.runInContext(hitFiles.map(f => readSource(f)).join('\n;\n')
        + '\n;\nvar __hitExports = { cmApplyOnHitIdentityStatuses, cmHasOnHitIdentityStatuses };',
        hitSandbox, { filename: 'combined-onhit.js' });
    const { cmApplyOnHitIdentityStatuses, cmHasOnHitIdentityStatuses } = hitSandbox.__hitExports;

    const mkAtk = () => ({
        unitId: 'atk1',
        onHitTargetStatus: { bind: 4 }, onHitTargetStatusNotes: ['束縛+4'],
        onHitSelfStatus: { charge: 5 }, onHitSelfStatusNotes: ['充能+5']
    });

    test('命中 → 目標減益與攻擊者自身增益都自動套用', () => {
        appliedCalls.length = 0;
        const ok = cmApplyOnHitIdentityStatuses(mkAtk(), ['tgt1']);
        assert.strictEqual(ok, true, '應回報有狀態被套用');
        assert.deepStrictEqual(
            appliedCalls.find(c => c.unitId === 'tgt1'),
            { unitId: 'tgt1', statusId: 'bind', amount: 4 }, '目標應獲得 4 層束縛');
        assert.deepStrictEqual(
            appliedCalls.find(c => c.unitId === 'atk1'),
            { unitId: 'atk1', statusId: 'charge', amount: 5 }, '攻擊者應獲得 5 層充能（命中增益）');
    });

    test('豁免抵擋多目標：只套用到實際受創的目標，自身增益只套一次', () => {
        appliedCalls.length = 0;
        cmApplyOnHitIdentityStatuses(mkAtk(), ['tgt1', 'tgt2']);
        assert.strictEqual(appliedCalls.filter(c => c.statusId === 'bind').length, 2, '兩個受創目標各套一次');
        assert.strictEqual(appliedCalls.filter(c => c.unitId === 'atk1').length, 1, '自身增益只套用一次');
    });

    test('未命中（無命中目標）→ 完全不套用', () => {
        appliedCalls.length = 0;
        const ok = cmApplyOnHitIdentityStatuses(mkAtk(), []);
        assert.strictEqual(ok, false);
        assert.strictEqual(appliedCalls.length, 0, '未命中不應套用任何狀態');
    });

    test('cmHasOnHitIdentityStatuses：無 onHit 欄位（如 BOSS 威脅）→ false', () => {
        assert.strictEqual(cmHasOnHitIdentityStatuses(mkAtk()), true);
        assert.strictEqual(cmHasOnHitIdentityStatuses({ unitId: 'x', onHitTargetStatus: {}, onHitSelfStatus: {} }), false);
        assert.strictEqual(cmHasOnHitIdentityStatuses(null), false);
    });
})();

// ====================================================================
console.log('\n[單方面攻擊] 無人對抗的 BOSS 行動 → 鎖定血量最低玩家、DP 直接加值');
// ====================================================================
(function () {
    const cpSandbox = {
        console, Object, Array, Math, JSON, Number, parseInt, Date,
        window: undefined,
        localStorage: { getItem: () => null, setItem() {} },
        myRole: 'st',
        myPlayerId: 'st_1',
        state: { units: [] },
        findUnitById: (id) => cpSandbox.state.units.find(u => u && u.id === id) || null,
        // 與 utils.js 相同的加權剩餘血量百分比（B=1/L=2/A=3）
        calculateWeightedHpPercent: (u) => {
            const hpArr = (u && u.hpArr) || [];
            const maxHp = (u && u.maxHp) || hpArr.length || 1;
            const dmg = hpArr.reduce((s, x) => s + (Number(x) || 0), 0);
            return (Math.max(0, maxHp * 3 - dmg) / (maxHp * 3)) * 100;
        },
        showToast: () => {},
        confirm: () => true,
    };
    vm.createContext(cpSandbox);
    vm.runInContext(readSource('src/core/counter-phase.js')
        + '\n;\nvar __cpExports = { cpResolveActionMod, cpUnopposedLevel, cpUnopposedMod, cpFindLowestHpPlayer,'
        + ' setCounterPhaseState: (s) => { counterPhaseState = s; } };',
        cpSandbox, { filename: 'counter-phase.js' });
    const { cpResolveActionMod, cpUnopposedLevel, cpUnopposedMod, cpFindLowestHpPlayer, setCounterPhaseState } = cpSandbox.__cpExports;

    const setup = (finalized) => {
        cpSandbox.state.units = [
            { id: 'boss1', name: '尖笑', type: 'boss', sideLevel: 2, hpArr: [0, 0], maxHp: 2 },
            { id: 'p_a', name: '滿血者', type: 'player', hpArr: [0, 0, 0], maxHp: 3 },
            { id: 'p_b', name: '殘血者', type: 'player', hpArr: [3, 2, 0], maxHp: 3 },
        ];
        setCounterPhaseState({
            started: true, roundId: 1, bossId: 'boss1',
            actions: [{ id: 'boss1', init: 10, dp: 30, label: '行動1·本體' }],
            assignments: {}, finalized: !!finalized
        });
    };

    test('措手不及等級＝支線等級+1；DP 加值＝支線等級×10（無視先攻，措手不及另計於防禦端）', () => {
        const boss = { sideLevel: 2 };
        assert.strictEqual(cpUnopposedLevel(boss), 3);
        assert.strictEqual(cpUnopposedMod(boss), 20, 'DP 基數用支線×10，不含措手不及的 +1 級');
        assert.strictEqual(cpUnopposedLevel(null), 2, '無支線等級時以 1 級計，措手不及為 2 級');
        assert.strictEqual(cpUnopposedMod(null), 10);
    });

    test('強制鎖定：血量最低（加權）的玩家單位', () => {
        setup(true);
        const victim = cpFindLowestHpPlayer();
        assert.ok(victim && victim.id === 'p_b', `應鎖定殘血者，實得 ${victim && victim.id}`);
    });

    test('公佈後無人對抗 → 單方面攻擊：unopposed、DP +20、附鎖定目標與措手不及等級', () => {
        setup(true);
        const r = cpResolveActionMod('boss1');
        assert.strictEqual(r.unopposed, true, '應標記為單方面攻擊');
        assert.strictEqual(r.mod, 20, '支線 2 級 → DP +20（措手不及另計於防禦端）');
        assert.strictEqual(r.surpriseLevel, 3, '措手不及等級＝支線+1＝3 級');
        assert.strictEqual(r.victimName, '殘血者');
    });

    test('公佈前無人對抗 → 不視為單方面攻擊（玩家可能還沒送出）', () => {
        setup(false);
        const r = cpResolveActionMod('boss1');
        assert.ok(!r.unopposed, '公佈前不應標記單方面攻擊');
        assert.strictEqual(r.mod, 0);
    });
})();

// ====================================================================
console.log('\n[部位破壞/混亂] 嚴重槽填滿判定');
// ====================================================================
(function () {
    const utilSandbox = {
        console, Object, Array, Math, JSON, Number, parseInt, Date, String,
        window: undefined,
        document: { getElementById: () => null, addEventListener() {} },
        localStorage: { getItem: () => null, setItem() {} },
        navigator: {},
    };
    vm.createContext(utilSandbox);
    vm.runInContext(readSource('src/utils/utils.js')
        + '\n;\nvar __utilExports = { countSevereSlots, isSevereGaugeFull, parseDicePlus, formatDicePlus };',
        utilSandbox, { filename: 'utils.js' });
    const { countSevereSlots, isSevereGaugeFull, parseDicePlus, formatDicePlus } = utilSandbox.__utilExports;

    test('嚴重槽計數：L(2)/A(3) 佔格、B(1) 不計', () => {
        assert.strictEqual(countSevereSlots({ hpArr: [3, 2, 1, 0] }), 2);
        assert.strictEqual(countSevereSlots({ hpArr: [] }), 0);
        assert.strictEqual(countSevereSlots(null), 0);
    });

    test('嚴重槽填滿：全部血格皆為 L 以上 → 觸發一回合混亂提示', () => {
        assert.strictEqual(isSevereGaugeFull({ maxHp: 3, hpArr: [2, 2, 3] }), true);
        assert.strictEqual(isSevereGaugeFull({ maxHp: 3, hpArr: [2, 2, 1] }), false, 'B 傷不佔嚴重槽');
        assert.strictEqual(isSevereGaugeFull({ maxHp: 0, hpArr: [] }), false, '無血格不觸發');
    });

    // ===== A+B 記法（全站攻擊／豁免／防禦欄位共用） =====
    // vm 沙箱產生的物件與主程序不同 realm（原型不同），deepStrictEqual 會誤判，故逐欄比較
    const eqDicePlus = (input, dice, auto, msg) => {
        const p = parseDicePlus(input);
        assert.strictEqual(p.dice, dice, `${msg || input}：dice 應為 ${dice}`);
        assert.strictEqual(p.auto, auto, `${msg || input}：auto 應為 ${auto}`);
    };
    test('parseDicePlus：A+B、純數字、負值、空值與亂填', () => {
        eqDicePlus('12+3', 12, 3);
        eqDicePlus(' 12 + 3 ', 12, 3, '容許空白');
        eqDicePlus('12', 12, 0);
        eqDicePlus('-4+2', -4, 2, '減值也可帶附加');
        eqDicePlus(7, 7, 0, '數字型別直接視為 A');
        eqDicePlus('', 0, 0, '空字串');
        eqDicePlus(null, 0, 0, 'null');
        eqDicePlus('abc', 0, 0, '亂填回 0');
    });

    test('formatDicePlus：附加 0 只顯示 A，與 parseDicePlus 互為往返', () => {
        assert.strictEqual(formatDicePlus(12, 3), '12+3');
        assert.strictEqual(formatDicePlus(12, 0), '12');
        assert.strictEqual(formatDicePlus(undefined, undefined), '0', '未填欄位顯示 0');
        eqDicePlus(formatDicePlus(6, 1), 6, 1, '往返');
    });
})();

// ====================================================================
console.log('\n[A+B 記法] 黑箱豁免模式：目標豁免附帶附加成功（saveAuto）');
// ====================================================================
(function () {
    test('豁免抵擋：saveInfo 逐目標帶出 saveDice 與 saveAuto（A+B 分存欄位）', () => {
        resetCaptures();
        sandbox.state.units = [
            { id: 'pu1', name: '玩家一', type: 'player', saveReflex: 5, saveReflexAuto: 2, status: {} }
        ];
        bbRunBlackBoxCalculation({
            attacker: { dp: 8, auto: 0, resolveMode: 'save', saveType: 'saveReflex', explodeAt: 10 },
            target: { id: 'pu1', name: '玩家一' }
        });
        const saveInfo = captured.stReview && captured.stReview.extras && captured.stReview.extras.saveInfo;
        assert.ok(saveInfo, '豁免模式應回傳 saveInfo');
        assert.strictEqual(saveInfo.targets[0].saveDice, 5, '豁免骰數（A）');
        assert.strictEqual(saveInfo.targets[0].saveAuto, 2, '豁免附加成功（B）');
        assert.strictEqual(saveInfo.saveAuto, 2, '審核面板預填的附加成功取第一個目標');
    });
})();

// ===== 結算 =====
console.log(`\n結果：${passed} 通過，${failed} 失敗\n`);
process.exit(failed ? 1 : 0);
