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
    + '\n;\nvar __exports = { STATUS_LIBRARY, isDebuffStatus, eroDrainSin, bbRunBlackBoxCalculation,'
    + ' eroGetAttackThreshold, eroSetAttackThreshold, eroCanAttackAllies };';
vm.runInContext(combined, sandbox, { filename: 'combined-sources.js' });

const { isDebuffStatus, STATUS_LIBRARY, eroDrainSin, bbRunBlackBoxCalculation,
    eroGetAttackThreshold, eroSetAttackThreshold, eroCanAttackAllies } = sandbox.__exports;
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
        + '\n;\nvar __identityExports = { cmResolveIdentityBonus, identityHudState, collectUntriggeredBonusHooks,'
        + ' collectOwnedIdentities, getIdentitiesByOwner };';
    vm.runInContext(combinedIdentity, idSandbox, { filename: 'combined-identity.js' });
    const { cmResolveIdentityBonus, identityHudState, collectUntriggeredBonusHooks,
        collectOwnedIdentities, getIdentitiesByOwner } = idSandbox.__identityExports;

    test('唐吉訶德「延續進攻」命中同時算出 targetStatus 與 selfStatus，兩者皆不遺漏', () => {
        identityHudState.owner = '唐吉訶德';
        identityHudState.cards = { don_cinq: { owned: true, unlocked: false } };
        const attacker = { id: 'atk1', status: {}, init: 10 };
        const target = { id: 'tgt1', status: {}, init: 5 };

        const result = cmResolveIdentityBonus(attacker, target);

        // 命中：延續進攻（selfStatus.swiftness+1／targetStatus.bind+1）+ 雙旋飛刺（targetStatus.bind+1）
        // 只勾選 don_cinq 一張卡，就只應算這張卡的效果。
        // （修正前未列在 cards 中的卡預設視為持有，這裡會混進其他唐吉訶德卡而得到 4 層迅捷。）
        assert.strictEqual(result.onHitSelfStatus.swiftness, 1, '攻擊者自身應算出 +1 迅捷');
        assert.ok(result.onHitSelfStatusNotes.length > 0, 'onHitSelfStatusNotes 不應為空');
        assert.ok(result.onHitSelfStatusNotes.some(n => n.includes('+1')), 'onHitSelfStatusNotes 應包含層數敘述');
        assert.strictEqual(result.onHitTargetStatus.bind, 2, '目標應疊加 2 層束縛（延續進攻+雙旋飛刺）');
    });

    test('持有判定：只勾選的卡才算數，未勾選的同角色卡不得混入實際攻擊', () => {
        identityHudState.owner = '唐吉訶德';
        // 只給一張卡的紀錄，其餘同角色卡「沒有紀錄」——先前這種卡會被預設視為持有
        identityHudState.cards = { don_cinq: { owned: true, unlocked: false } };
        identityHudState.cardInputs = {};
        const withOne = cmResolveIdentityBonus({ id: 'a', status: {}, init: 10 }, { id: 't', status: {}, init: 5 });

        // 明確把該卡設為未持有 → 應完全沒有加值（而不是退回「其他卡的加值」）
        identityHudState.cards = { don_cinq: { owned: false, unlocked: false } };
        const withNone = cmResolveIdentityBonus({ id: 'a', status: {}, init: 10 }, { id: 't', status: {}, init: 5 });

        assert.strictEqual(withOne.onHitSelfStatus.swiftness, 1);
        assert.strictEqual(Object.keys(withNone.onHitSelfStatus).length, 0,
            '未持有任何卡時不應算出任何自身狀態');
        assert.strictEqual(withNone.dpBonus, 0, '未持有任何卡時 DP 加值應為 0');
    });

    test('持有判定：面板預覽與實際攻擊使用同一組卡片（collectOwnedIdentities 單一入口）', () => {
        identityHudState.owner = '唐吉訶德';
        identityHudState.cards = {
            don_cinq: { owned: true, unlocked: false },
            don_ego: { owned: true, unlocked: false }
        };
        identityHudState.cardInputs = {};
        // 面板走 collectOwnedIdentities()；實際攻擊經修正後也走同一函式
        // 注意：vm 沙箱建立的陣列與宿主 realm 的 Array.prototype 不同，
        // deepStrictEqual 會因原型不符而誤判，故以 JSON 字串比對。
        const panelCards = collectOwnedIdentities().map(c => c.id).sort();
        assert.strictEqual(JSON.stringify(panelCards), JSON.stringify(['don_cinq', 'don_ego']),
            '面板應只認得勾選的兩張卡');
        // 其餘唐吉訶德卡沒有紀錄，兩邊都不該把它們算進去
        const all = getIdentitiesByOwner('唐吉訶德');
        assert.ok(all.length > 2, '前置條件：該角色卡片數多於已勾選的兩張');
        identityHudState.cardInputs = {};
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
console.log('\n[主動宣告技] 扣資源、二次確認、加值併入戰鬥計算');
// ====================================================================
(function () {
    const calls = { hp: [], stacks: [], addStatus: [], toasts: [], confirms: [] };
    let confirmAnswer = true;
    const dcSandbox = {
        console, Object, Array, Math, JSON, Set, Number, String, parseInt, isNaN,
        window: undefined,
        document: { getElementById: () => null, querySelector: () => null },
        localStorage: { getItem: () => null, setItem() {} },
        myRole: 'st',                       // 以 ST 身分執行，扣血走 modifyHPInternal（可直接觀察）
        myPlayerId: 'p1',
        state: { units: [], roundNum: 1, teamPools: { bloodFeast: 0, bloodFeastSpent: 0, bleedDamageAcc: 0 } },
        findUnitById: (id) => dcSandbox.state.units.find(u => u && u.id === id) || null,
        modifyHPInternal: (u, type, amount) => { calls.hp.push({ id: u.id, type, amount }); },
        updateStatusStacks: (id, name, n) => {
            calls.stacks.push({ id, name, n });
            const u = dcSandbox.findUnitById(id);
            if (u && u.status) { if (n <= 0) delete u.status[name]; else u.status[name] = String(n); }
        },
        addStatusToUnit: (id, statusId, n) => {
            calls.addStatus.push({ id, statusId, n });
            const u = dcSandbox.findUnitById(id);
            if (!u) return;
            const def = dcSandbox.getStatusById ? dcSandbox.getStatusById(statusId) : null;
            const name = def ? def.name : statusId;
            u.status = u.status || {};
            u.status[name] = String((parseInt(u.status[name]) || 0) + n);
        },
        broadcastState: () => {},
        showToast: (t) => calls.toasts.push(t),
        confirm: (msg) => { calls.confirms.push(msg); return confirmAnswer; },
        escapeHtml: (s) => s,
        isSevereGaugeFull: (u) => !!(u && Array.isArray(u.hpArr) && u.hpArr.length > 0 && u.hpArr.every(v => v >= 3)),
        renderUnitsList: () => {}, renderSidebarUnits: () => {}, syncUnitStatus: () => {},
    };
    vm.createContext(dcSandbox);
    vm.runInContext([
        'src/config/status-config.js',
        'src/config/identity-config.js',
        'src/core/identity-engine.js',
        'src/ui/identity-hud.js',
        'src/ui/combat-modals.js'
    ].map(f => readSource(f)).join('\n;\n')
        + '\n;\nvar __dc = { idtDeclareActiveSkill, idtPlanDeclareCost, idtIsDeclarable, identityHudState,'
        + ' idtPendingActiveBonus, idtNextTurnActiveBonus, idtConsumePendingActiveBonus,'
        + ' idtClearPendingActiveBonus, idtResetDeclaredUses, getIdentityById, cmResolveIdentityBonus,'
        + ' IDENTITY_LIBRARY };',
        dcSandbox, { filename: 'combined-declare.js' });
    // renderIdentityModal 在宣告結束時會被呼叫；沙箱無 DOM，直接覆寫成 no-op
    vm.runInContext('renderIdentityModal = function () {};', dcSandbox);
    const { idtDeclareActiveSkill, idtPlanDeclareCost, idtIsDeclarable, identityHudState,
            idtPendingActiveBonus, idtNextTurnActiveBonus, idtConsumePendingActiveBonus,
            idtClearPendingActiveBonus, idtResetDeclaredUses, getIdentityById,
            cmResolveIdentityBonus, IDENTITY_LIBRARY } = dcSandbox.__dc;

    /** 找出某張卡上指定名稱的 onActive 索引 */
    const activeIndex = (cardId, name) =>
        getIdentityById(cardId).hooks.onActive.findIndex(h => h && h.name === name);

    const setup = (attackerStatus, targetStatus, targetExtra) => {
        calls.hp = []; calls.stacks = []; calls.addStatus = []; calls.toasts = []; calls.confirms = [];
        confirmAnswer = true;
        idtResetDeclaredUses();
        for (const k of Object.keys(idtPendingActiveBonus)) delete idtPendingActiveBonus[k];
        for (const k of Object.keys(idtNextTurnActiveBonus)) delete idtNextTurnActiveBonus[k];
        dcSandbox.state.units = [
            { id: 'me', name: '我', type: 'player', ownerId: 'p1', status: attackerStatus || {}, hpArr: [0, 0, 0], maxHp: 3, init: 10 },
            Object.assign({ id: 'foe', name: '敵人', type: 'enemy', status: targetStatus || {}, hpArr: [0, 0, 0, 0, 0], maxHp: 5, init: 5 }, targetExtra || {})
        ];
        identityHudState.attackerId = 'me';
        identityHudState.targetId = 'foe';
        identityHudState.cardInputs = {};
    };

    test('有成本的宣告會先跳二次確認；取消時完全不扣資源', () => {
        setup({ '充能': '10' });
        identityHudState.owner = '格里高爾';
        identityHudState.cards = { gregor_rosewrench: { owned: true, unlocked: false } };
        confirmAnswer = false;
        idtDeclareActiveSkill('gregor_rosewrench', activeIndex('gregor_rosewrench', '超載 2 - 輕度運轉'));
        assert.strictEqual(calls.confirms.length, 1, '應跳出一次二次確認');
        assert.ok(calls.confirms[0].includes('充能'), `確認文案應列出將扣除的資源：${calls.confirms[0]}`);
        assert.strictEqual(calls.stacks.length, 0, '取消後不得扣除任何層數');
        assert.strictEqual(dcSandbox.state.units[0].status['充能'], '10');
        assert.strictEqual(idtPendingActiveBonus['me'], undefined, '取消後不得留下待併入加值');
    });

    test('確認後扣除資源，加值進入「待併入下次攻擊」的暫存', () => {
        setup({ '充能': '10' });
        identityHudState.owner = '格里高爾';
        identityHudState.cards = { gregor_rosewrench: { owned: true, unlocked: false } };
        idtDeclareActiveSkill('gregor_rosewrench', activeIndex('gregor_rosewrench', '超載 2 - 輕度運轉'));
        assert.strictEqual(dcSandbox.state.units[0].status['充能'], '8', '充能應扣掉 2');
        assert.strictEqual(idtPendingActiveBonus['me'].dp, 2, 'DP +2 應待併入下次攻擊');
    });

    test('宣告的加值真的併入戰鬥計算（cmResolveIdentityBonus → 攻擊 DP／附加成功／傷害）', () => {
        setup({ '充能': '10' });
        identityHudState.owner = '格里高爾';
        identityHudState.cards = { gregor_rosewrench: { owned: true, unlocked: false } };
        idtDeclareActiveSkill('gregor_rosewrench', activeIndex('gregor_rosewrench', '超載 5 - 齒輪加速'));
        // submitAttackModal 會呼叫 idtConsumePendingActiveBonus 併進 identityBonus，這裡直接驗證取出的內容
        const pend = idtConsumePendingActiveBonus('me');
        assert.strictEqual(pend.dp, 7, '超載 5 的 +7 DP 應可被攻擊流程取出');
        assert.strictEqual(idtConsumePendingActiveBonus('me'), null, '取出後應清空，不會重複計入下一次攻擊');
    });

    test('資源不足時不可宣告，也不會跳確認', () => {
        setup({ '充能': '1' });
        identityHudState.owner = '格里高爾';
        identityHudState.cards = { gregor_rosewrench: { owned: true, unlocked: false } };
        idtDeclareActiveSkill('gregor_rosewrench', activeIndex('gregor_rosewrench', '超載 5 - 齒輪加速'));
        assert.strictEqual(calls.confirms.length, 0, '資源不足應直接擋下，不跳確認');
        assert.strictEqual(dcSandbox.state.units[0].status['充能'], '1');
        assert.ok(calls.toasts.some(t => t.includes('不足')), '應提示資源不足');
    });

    test('震顫引爆：依「引爆前」層數削減目標生命上限，但只移除指定層數', () => {
        setup({}, { '震顫': '7' });
        identityHudState.owner = '羅佳';
        identityHudState.cards = { rodion_tcorp: { owned: true, unlocked: true } };
        idtDeclareActiveSkill('rodion_tcorp', activeIndex('rodion_tcorp', '震顫引爆（徵收執行）'));
        const foe = dcSandbox.findUnitById('foe');
        // 生命上限 5 → 削減 7 但下限為 1
        assert.strictEqual(foe.maxHp, 1, '應依引爆前的 7 層削減生命上限（最低 1）');
        assert.strictEqual(foe.status['震顫'], '6', '層數只減 1（7 → 6）');
    });

    test('震顫引爆（N公司）：全清層數，並造成等同消耗層數的傷害', () => {
        setup({}, { '震顫': '4' });
        identityHudState.owner = '唐吉訶德';
        identityHudState.cards = { don_ncompany: { owned: true, unlocked: false } };
        idtDeclareActiveSkill('don_ncompany', activeIndex('don_ncompany', '震顫引爆'));
        const foe = dcSandbox.findUnitById('foe');
        assert.strictEqual(foe.status['震顫'], undefined, '震顫應被清空');
        assert.deepStrictEqual(calls.hp, [{ id: 'foe', type: 'l', amount: 4 }], '應造成 4 點 L 傷');
    });

    test('燃盡知識：消耗所有學識，附加成功等同實際燒掉的點數，並清空所解真知', () => {
        setup({ '學識': '7', '所解真知': '3' });
        identityHudState.owner = '莫爾索';
        identityHudState.cards = { meursault_dieci: { owned: true, unlocked: true } };
        idtDeclareActiveSkill('meursault_dieci', activeIndex('meursault_dieci', '燃盡知識（消耗所有學識）'));
        const me = dcSandbox.findUnitById('me');
        assert.strictEqual(me.status['學識'], undefined, '學識應全數消耗');
        assert.strictEqual(me.status['所解真知'], undefined, '所解真知應歸零');
        assert.strictEqual(idtPendingActiveBonus['me'].extraSuccess, 7, '附加成功應等同燒掉的 7 點學識');
    });

    test('每場戰鬥限一次：第二次宣告被擋下，戰鬥重置後可再用', () => {
        setup({ '學識': '9' });
        identityHudState.owner = '莫爾索';
        identityHudState.cards = { meursault_dieci: { owned: true, unlocked: true } };
        const idx = activeIndex('meursault_dieci', '燃盡知識（消耗所有學識）');
        idtDeclareActiveSkill('meursault_dieci', idx);
        dcSandbox.findUnitById('me').status['學識'] = '9';   // 補回資源，排除「資源不足」這個變因
        calls.toasts = [];
        idtDeclareActiveSkill('meursault_dieci', idx);
        assert.ok(calls.toasts.some(t => t.includes('本場戰鬥已使用過')), `第二次應被次數限制擋下：${calls.toasts}`);
        idtResetDeclaredUses();
        calls.toasts = [];
        idtDeclareActiveSkill('meursault_dieci', idx);
        assert.ok(!calls.toasts.some(t => t.includes('已使用過')), '重置後應可再次宣告');
    });

    test('目標成本不足時擋下（時間延付需目標 10 層震顫）', () => {
        setup({}, { '震顫': '9' });
        identityHudState.owner = '唐吉訶德';
        identityHudState.cards = { don_tcorp: { owned: true, unlocked: true } };
        idtDeclareActiveSkill('don_tcorp', activeIndex('don_tcorp', '時間延付'));
        assert.strictEqual(calls.confirms.length, 0);
        assert.strictEqual(dcSandbox.findUnitById('foe').status['震顫'], '9', '不足時不得動到目標層數');
    });

    test('一點突破：目標燃燒減半、造成等同原燃燒點數的傷害，且每場限一次', () => {
        setup({}, { '燃燒': '15' });
        identityHudState.owner = '羅佳';
        identityHudState.cards = { ryoshu_south4: { owned: true, unlocked: true } };
        idtDeclareActiveSkill('ryoshu_south4', activeIndex('ryoshu_south4', '一點突破'));
        assert.deepStrictEqual(calls.hp, [{ id: 'foe', type: 'l', amount: 15 }], '傷害＝引爆前的 15 點燃燒');
        assert.strictEqual(dcSandbox.findUnitById('foe').status['燃燒'], '7', '15 → floor(15/2) = 7');
    });

    test('nextTurnBonus：宣告當下不進入 pending，回合開始才轉入並生效', () => {
        setup({}, { '沮喪': '12' });
        identityHudState.owner = '格里高爾';
        identityHudState.cards = { gregor_edgar: { owned: true, unlocked: true } };
        idtDeclareActiveSkill('gregor_edgar', activeIndex('gregor_edgar', '噩夢吞噬'));
        assert.strictEqual(idtPendingActiveBonus['me'], undefined, '不該立刻併入本次攻擊');
        assert.strictEqual(idtNextTurnActiveBonus['me'].extraSuccess, 2, '應存進「下一回合」桶');
        // 回合開始：pending 清空，next 轉入
        idtClearPendingActiveBonus('me');
        assert.strictEqual(idtNextTurnActiveBonus['me'], undefined);
        assert.strictEqual(idtPendingActiveBonus['me'].weaponDamage === undefined ? idtPendingActiveBonus['me'].damage : 0, 3,
            '武器傷害 +3 應折算為傷害加值併入本回合');
    });

    test('selfClear：一鍵把自身資源歸零（第七發魔彈重置魔彈）', () => {
        setup({ '魔彈': '7' });
        identityHudState.owner = '奧提斯';
        identityHudState.cards = { otis_ego_bullet: { owned: true, unlocked: true } };
        idtDeclareActiveSkill('otis_ego_bullet', activeIndex('otis_ego_bullet', '第七發魔彈（重置魔彈）'));
        assert.strictEqual(dcSandbox.findUnitById('me').status['魔彈'], undefined, '魔彈應歸零');
        assert.strictEqual(calls.confirms.length, 0, '純重置沒有資源成本，不需二次確認');
    });

    test('全隊共用資源池成本同樣走二次確認並扣款（公主：退下…）', () => {
        setup({});
        dcSandbox.state.teamPools = { bloodFeast: 5, bloodFeastSpent: 0, bleedDamageAcc: 0 };
        identityHudState.owner = '羅佳';
        identityHudState.cards = { rodion_manchaland: { owned: true, unlocked: false } };
        idtDeclareActiveSkill('rodion_manchaland', activeIndex('rodion_manchaland', '退下…（消耗 2 點血宴）'));
        assert.ok(calls.confirms[0].includes('血宴'), `確認文案應提到血宴：${calls.confirms[0]}`);
        assert.strictEqual(dcSandbox.state.teamPools.bloodFeast, 3, '血宴 5 → 3');
        assert.strictEqual(dcSandbox.state.teamPools.bloodFeastSpent, 2, '累計消耗應記錄 2');
    });

    test('嚴重轉惡性／加骰級數會隨人格卡算出，供攻擊視窗預填', () => {
        setup({}, { '流血': '9' });
        dcSandbox.myRole = 'player';   // cmResolveIdentityBonus 只在玩家端運算（ST 走 BOSS 資料）
        identityHudState.owner = '良秀';
        identityHudState.cards = { yoshu_blackcloud: { owned: true, unlocked: true } };
        const bonus = cmResolveIdentityBonus(dcSandbox.findUnitById('me'), dcSandbox.findUnitById('foe'));
        assert.strictEqual(bonus.critVicious, 3, '流血 9 → 1+1+1 = 3 點嚴重轉惡性');

        identityHudState.owner = '羅佳';
        identityHudState.cards = { ryoshu_blackcloud: { owned: true, unlocked: true } };
        const b2 = cmResolveIdentityBonus(dcSandbox.findUnitById('me'), dcSandbox.findUnitById('foe'));
        assert.strictEqual(b2.explodeStep, 1, '流血 6+ → 加骰下推 1 級');
        dcSandbox.myRole = 'st';
    });

    test('所有帶結構化 effect 的宣告技都能被面板辨識為可宣告', () => {
        let declarable = 0;
        for (const card of Object.values(IDENTITY_LIBRARY)) {
            for (const h of ((card.hooks && card.hooks.onActive) || [])) {
                if (h && h.effect) {
                    assert.ok(idtIsDeclarable(h), `${card.name}「${h.name}」帶 effect 卻不可宣告`);
                    declarable++;
                }
            }
        }
        assert.ok(declarable >= 20, `可宣告的技能數應相當可觀，實得 ${declarable}`);
    });
})();

// ====================================================================
console.log('\n[回合結束結算] 尖釘釘刑三段式 + 流血傷害累積血宴');
// ====================================================================
(function () {
    const applied = { hp: [], status: [], stacks: [], pools: null };
    const teSandbox = {
        console, Object, Array, Math, JSON, Set, Number, String, parseInt, isNaN, Date,
        window: undefined,
        localStorage: { getItem: () => null, setItem() {} },
        myRole: 'st',
        state: { units: [], teamPools: { bloodFeast: 0, bloodFeastSpent: 0, bleedDamageAcc: 0 } },
        findUnitById: (id) => teSandbox.state.units.find(u => u && u.id === id) || null,
        modifyHPInternal: (u, type, amount) => { applied.hp.push({ id: u.id, type, amount }); },
        addStatusToUnit: (id, statusId, n) => { applied.status.push({ id, statusId, n }); },
        updateStatusStacks: (id, name, n) => { applied.stacks.push({ id, name, n }); },
        syncTeamPools: (pools) => { applied.pools = pools; teSandbox.state.teamPools = pools; },
        broadcastState: () => {},
        showToast: () => {},
        escapeHtml: (s) => s,
        document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {} } }),
                    body: { appendChild() {} }, addEventListener: () => {}, readyState: 'complete' },
    };
    vm.createContext(teSandbox);
    vm.runInContext([
        'src/config/status-config.js',
        'src/config/identity-config.js',
        'src/ui/units.js'
    ].map(f => readSource(f)).join('\n;\n')
        + '\n;\nvar __te = { buildTurnEndItems, applyTurnEndItem, accumulateBloodFeastFromBleed, _setItems: (it) => { _turnEndItems = it; } };',
        teSandbox, { filename: 'combined-turnend.js' });
    const { buildTurnEndItems, applyTurnEndItem, accumulateBloodFeastFromBleed, _setItems } = teSandbox.__te;

    const reset = () => { applied.hp = []; applied.status = []; applied.stacks = []; applied.pools = null; };

    test('尖釘：回合結束結算不再只是提醒，而是可一鍵套用的三段式效果', () => {
        const items = buildTurnEndItems({ id: 'u1', status: { '尖釘': 5 } });
        const nails = items.find(i => i.statusName === '尖釘');
        assert.ok(nails, '應產出尖釘結算項目');
        assert.strictEqual(nails.kind, 'nails', '不應再是 remind（過去只能手動處理）');
        assert.strictEqual(nails.amount, 5);
        assert.ok(nails.label.includes('2'), `標籤應預告減半後的層數：${nails.label}`);
    });

    test('尖釘：套用後 → 受等量 L 傷、疊加等量流血、層數減半（無條件捨去）', () => {
        reset();
        const u = { id: 'u1', status: { '尖釘': 5 } };
        teSandbox.state.units = [u];
        _setItems(buildTurnEndItems(u).filter(i => i.statusName === '尖釘'));
        applyTurnEndItem('u1', 0);
        assert.deepStrictEqual(applied.hp, [{ id: 'u1', type: 'l', amount: 5 }]);
        assert.deepStrictEqual(applied.status, [{ id: 'u1', statusId: 'bleed', n: 5 }]);
        assert.deepStrictEqual(applied.stacks, [{ id: 'u1', name: '尖釘', n: 2 }], '5 → floor(5/2) = 2');
    });

    test('血宴：流血傷害全場累計，每滿 5 點 +1；不足 5 點的餘數保留到下次', () => {
        teSandbox.state.teamPools = { bloodFeast: 0, bloodFeastSpent: 0, bleedDamageAcc: 0 };
        // 三個單位各受 2 點流血 → 合計 6 點 → 應給 1 點血宴（逐次 floor(2/5) 會全部歸零）
        assert.strictEqual(accumulateBloodFeastFromBleed(2), 0);
        assert.strictEqual(accumulateBloodFeastFromBleed(2), 0);
        assert.strictEqual(accumulateBloodFeastFromBleed(2), 1);
        assert.strictEqual(teSandbox.state.teamPools.bloodFeast, 1);
        assert.strictEqual(teSandbox.state.teamPools.bleedDamageAcc, 1, '餘數 1 點應保留');
    });

    test('血宴：單次大量流血一次補足多點，且不超過 100 上限', () => {
        teSandbox.state.teamPools = { bloodFeast: 0, bloodFeastSpent: 0, bleedDamageAcc: 0 };
        assert.strictEqual(accumulateBloodFeastFromBleed(23), 4, '23 / 5 = 4 點，餘 3');
        assert.strictEqual(teSandbox.state.teamPools.bleedDamageAcc, 3);

        teSandbox.state.teamPools = { bloodFeast: 98, bloodFeastSpent: 0, bleedDamageAcc: 0 };
        accumulateBloodFeastFromBleed(100);
        assert.strictEqual(teSandbox.state.teamPools.bloodFeast, 100, '不得超過上限');
    });

    test('流血結算項目帶 bleedPool 旗標 → 套用扣血時同步累積血宴', () => {
        reset();
        teSandbox.state.teamPools = { bloodFeast: 0, bloodFeastSpent: 0, bleedDamageAcc: 0 };
        const u = { id: 'u1', status: { '流血': 7 } };
        teSandbox.state.units = [u];
        const items = buildTurnEndItems(u).filter(i => i.statusName === '流血');
        assert.strictEqual(items[0].bleedPool, true);
        _setItems(items);
        applyTurnEndItem('u1', 0);
        assert.deepStrictEqual(applied.hp, [{ id: 'u1', type: 'l', amount: 7 }]);
        assert.strictEqual(teSandbox.state.teamPools.bloodFeast, 1, '7 點流血 → 血宴 +1（餘 2）');
    });
})();

// ====================================================================
console.log('\n[新人格卡] 浮士德倖存者／魔彈奧提斯／羅佳三卡與全隊共用資源池');
// ====================================================================
(function () {
    const newSandbox = {
        console, Object, Array, Math, JSON, Set, Number, parseInt, isNaN,
        window: undefined,
        document: { getElementById: () => null, querySelector: () => null },
        localStorage: { getItem: () => null, setItem() {} },
        myRole: 'player',
        myPlayerId: 'p1',
        state: { units: [], teamPools: { bloodFeast: 0, bloodFeastSpent: 0, bleedDamageAcc: 0 } },
        findUnitById: (id) => newSandbox.state.units.find(u => u && u.id === id) || null,
        showToast: () => {},
        escapeHtml: (s) => s,
    };
    vm.createContext(newSandbox);
    vm.runInContext([
        'src/config/status-config.js',
        'src/config/identity-config.js',
        'src/core/identity-engine.js',
        'src/ui/identity-hud.js',
        'src/ui/combat-modals.js'
    ].map(f => readSource(f)).join('\n;\n')
        + '\n;\nvar __nx = { evaluatePlayerAttack, evaluatePlayerDefend, evaluatePlayerResolve,'
        + ' evaluatePlayerTurnStart, getIdentityById, cmResolveIdentityBonus, identityHudState,'
        + ' cmBuildResolveTable, cmLookupResolveEntry, IDENTITY_TEAM_POOLS, IDENTITY_STATUS_KEYMAP,'
        + ' idtGetTeamPools };',
        newSandbox, { filename: 'combined-new-identities.js' });
    const { evaluatePlayerAttack, evaluatePlayerDefend, evaluatePlayerResolve, evaluatePlayerTurnStart,
            getIdentityById, cmResolveIdentityBonus, identityHudState, cmLookupResolveEntry,
            IDENTITY_TEAM_POOLS, IDENTITY_STATUS_KEYMAP } = newSandbox.__nx;

    // ── 浮士德 - 腦葉公司倖存者 ──────────────────────────────────────
    test('浮士德倖存者：單擊宣告 +2 呼吸法、命中破裂與深度撕裂的呼吸法／迅捷全部疊加', () => {
        const r = evaluatePlayerAttack([{ id: 'faust_lcb', unlocked: false }], { status: {} }, { status: {} });
        assert.strictEqual(r.onAttackSelfStatus.breathing, 2, '宣告攻擊 → 呼吸法 +2');
        assert.strictEqual(r.onHitSelfStatus.breathing, 3, '命中 → 深度撕裂呼吸法 +3');
        assert.strictEqual(r.onHitSelfStatus.swiftness, 2, '命中 → 迅捷 +2');
        assert.strictEqual(r.onHitTargetStatus.rupture, 4, '單擊 2 + 深度撕裂 2 = 破裂 4');
    });

    test('浮士德倖存者：伺機而動需解鎖，且只在「上一回合未受傷」時給 +6 DP／+2 附加成功', () => {
        const locked = evaluatePlayerAttack([{ id: 'faust_lcb', unlocked: false }],
            { status: {}, noDamageLastTurn: true }, { status: {} });
        assert.strictEqual(locked.totalDpBonus, 0, '未解鎖三技 → 不得計入');

        const damaged = evaluatePlayerAttack([{ id: 'faust_lcb', unlocked: true }],
            { status: {}, noDamageLastTurn: false }, { status: {} });
        assert.strictEqual(damaged.totalDpBonus, 0, '上回合受過傷 → 條件未達');

        const clean = evaluatePlayerAttack([{ id: 'faust_lcb', unlocked: true }],
            { status: {}, noDamageLastTurn: true }, { status: {} });
        assert.strictEqual(clean.totalDpBonus, 6);
        assert.strictEqual(clean.totalExtraSuccess, 2);
        assert.strictEqual(clean.onHitTargetStatus.rupture, 7, '單擊 2 + 深度撕裂 2 + 伺機而動 3');
    });

    test('浮士德倖存者：「至少造成 3 點傷害」的破裂走 onResolve，2 點不給、3 點才給', () => {
        const owned = [{ id: 'faust_lcb', unlocked: true }];
        const at2 = evaluatePlayerResolve(owned, { status: {} }, { status: {} }, { hit: true, damage: 2 });
        const at3 = evaluatePlayerResolve(owned, { status: {} }, { status: {} }, { hit: true, damage: 3 });
        assert.strictEqual(Object.keys(at2.targetStatus).length, 0, '2 點傷害不觸發');
        assert.strictEqual(at3.targetStatus.rupture, 3, '3 點傷害 → 再施加 3 層破裂');
    });

    test('傷害門檻階梯表：ST 端依實際傷害查表，2 點與 3 點取到不同格', () => {
        identityHudState.owner = '浮士德';
        identityHudState.cards = { faust_lcb: { owned: true, unlocked: true } };
        identityHudState.cardInputs = {};
        const bonus = cmResolveIdentityBonus({ id: 'a', status: {}, init: 10 }, { id: 't', status: {} });
        assert.ok(bonus.onResolveTable.length >= 2, '應產出至少兩格階梯');
        assert.strictEqual(cmLookupResolveEntry(bonus, 2, true).targetStatus.rupture, undefined);
        assert.strictEqual(cmLookupResolveEntry(bonus, 3, true).targetStatus.rupture, 3);
        assert.strictEqual(cmLookupResolveEntry(bonus, 99, true).targetStatus.rupture, 3, '超出取樣範圍沿用最後一格');
        identityHudState.cards = {};
    });

    // ── 奧提斯 - E.G.O::魔彈（效果修改）────────────────────────────
    test('魔彈奧提斯：燃燒 9 點 → 點火 +9 DP（每 3 點 +3，三次封頂）、魔彈起爆 +3 DP', () => {
        const r = evaluatePlayerAttack([{ id: 'otis_ego_bullet', unlocked: false }],
            { status: { magicBullet: 0 } }, { status: { burn: 9 } });
        // 點火 min(floor(9/3),3)*3 = 9；魔彈起爆 min(floor(9/6),3)*3 = 3
        assert.strictEqual(r.totalDpBonus, 12);
    });

    test('魔彈奧提斯：魔彈滿 7 層 → 武器傷害 +5，且不再自動疊加第 8 層', () => {
        const r = evaluatePlayerAttack([{ id: 'otis_ego_bullet', unlocked: true }],
            { status: { magicBullet: 7 } }, { status: {} });
        assert.strictEqual(r.totalWeaponDamage, 5, '第七發魔彈：武器傷害 +5');
        assert.strictEqual(r.onAttackSelfStatus.magicBullet, undefined, '已滿 7 層 → 魔彈射擊不再 +1');
        assert.strictEqual(r.onHitSelfStatus.magicBullet, undefined, '已滿 7 層 → 魔彈起爆不再 +1');
    });

    test('魔彈奧提斯：魔彈 6 層時起爆仍可 +1（門檻由 <6 修正為 <7）', () => {
        const r = evaluatePlayerAttack([{ id: 'otis_ego_bullet', unlocked: false }],
            { status: { magicBullet: 6 } }, { status: {} });
        assert.strictEqual(r.onHitSelfStatus.magicBullet, 1);
    });

    // ── 羅佳 - T公司2級徵收人員 ──────────────────────────────────
    test('T公司羅佳：目標震顫 12 層 → 兩技能各 +4 DP（各自封頂），解鎖後再 +4', () => {
        const base = evaluatePlayerAttack([{ id: 'rodion_tcorp', unlocked: false }],
            { status: {} }, { status: { tremor: 12 } });
        assert.strictEqual(base.totalDpBonus, 8, '徵收準備 +4、鎮壓格鬥 +4');

        const unlocked = evaluatePlayerAttack([{ id: 'rodion_tcorp', unlocked: true }],
            { status: {} }, { status: { tremor: 12 } });
        assert.strictEqual(unlocked.totalDpBonus, 12, '再加徵收執行（震顫 8+）的 +4');
    });

    test('T公司羅佳：命中對目標施加束縛（震顫 6+ 時 2 層），自身震顫只作資源累積', () => {
        const r = evaluatePlayerAttack([{ id: 'rodion_tcorp', unlocked: false }],
            { status: { tremor: 0 } }, { status: { tremor: 6 } });
        assert.strictEqual(r.onHitTargetStatus.bind, 2, '震顫 6 層以上 → 束縛共 2 層');
        assert.strictEqual(r.onAttackSelfStatus.tremor, 4, '兩技能宣告攻擊各 +2 震顫');
        assert.strictEqual(r.onHitSelfStatus.tremor, 1, '徵收準備命中再 +1');
    });

    test('T公司羅佳：束縛換武器傷害封頂 +4（解鎖後）', () => {
        const r = evaluatePlayerAttack([{ id: 'rodion_tcorp', unlocked: true }],
            { status: {} }, { status: { bind: 9 } });
        assert.strictEqual(r.totalWeaponDamage, 4);
    });

    // ── 羅佳 - N公司中錘 ────────────────────────────────────────
    test('N公司羅佳：虔信釘擊的額外尖釘只在目標「原本就帶尖釘」時觸發', () => {
        const noNails = evaluatePlayerAttack([{ id: 'rodion_ncorp', unlocked: false }],
            { status: {} }, { status: {} });
        assert.strictEqual(noNails.onHitTargetStatus.nails, 2, '狂熱淨化 1 + 鋼鐵裁決 1');

        const withNails = evaluatePlayerAttack([{ id: 'rodion_ncorp', unlocked: false }],
            { status: {} }, { status: { nails: 1 } });
        assert.strictEqual(withNails.onHitTargetStatus.nails, 4, '再加虔信釘擊的 2 層');
    });

    test('N公司羅佳：命中獲得狂信；下一次回合開始時自動以負層數清除', () => {
        const hit = evaluatePlayerAttack([{ id: 'rodion_ncorp', unlocked: false }],
            { status: {} }, { status: {} });
        assert.strictEqual(hit.onHitSelfStatus.fanaticism, 1);

        const turn = evaluatePlayerTurnStart([{ id: 'rodion_ncorp', unlocked: false }],
            { status: { fanaticism: 1 } });
        assert.strictEqual(turn.expectedSelfStatus.fanaticism, -1, '回合開始應扣掉 1 層（歸零）');
    });

    test('N公司羅佳：狂信時被攻擊 → 對攻擊者施加 3 點流血（onDefend）', () => {
        const owned = [{ id: 'rodion_ncorp', unlocked: false }];
        const noFaith = evaluatePlayerDefend(owned, { status: {} }, { status: {} }, { melee: true });
        assert.strictEqual(Object.keys(noFaith.attackerStatus).length, 0, '沒有狂信 → 不反擊');

        const faith = evaluatePlayerDefend(owned, { status: { fanaticism: 1 } }, { status: {} }, { melee: false });
        assert.strictEqual(faith.attackerStatus.bleed, 3, '遠程被攻擊同樣可反擊流血');
    });

    // ── 羅佳 - 拉·曼卻領 公主 ──────────────────────────────────
    test('公主：綻放荊棘 10 層以上 → 退下…的流血／破裂各 +1；20 層以上四散再各 +2', () => {
        const low = evaluatePlayerAttack([{ id: 'rodion_manchaland', unlocked: false }],
            { status: { bloomingThorns: 0 } }, { status: {} });
        assert.strictEqual(low.onHitTargetStatus.bleed, 5, '退下 2 + 四散 3');
        assert.strictEqual(low.onHitTargetStatus.rupture, 5);

        const high = evaluatePlayerAttack([{ id: 'rodion_manchaland', unlocked: false }],
            { status: { bloomingThorns: 20 } }, { status: {} });
        assert.strictEqual(high.onHitTargetStatus.bleed, 8, '退下 3 + 四散 5');
        assert.strictEqual(high.onHitTargetStatus.rupture, 8);
    });

    test('公主：綻放荊棘未滿 20 → 觸發慶典熱潮；達 20 層後不再觸發', () => {
        const hot = evaluatePlayerAttack([{ id: 'rodion_manchaland', unlocked: true }],
            { status: { bloomingThorns: 18 } }, { status: {} });
        assert.strictEqual(hot.onAttackSelfStatus.strength, 3);
        assert.strictEqual(hot.onAttackSelfStatus.bloomingThorns, 4);

        // 20～29 層是「兩段都不觸發」的區間：慶典熱潮要求未滿 20、落幕要求滿 30
        const idle = evaluatePlayerAttack([{ id: 'rodion_manchaland', unlocked: true }],
            { status: { bloomingThorns: 20 } }, { status: {} });
        assert.strictEqual(idle.onAttackSelfStatus.strength, undefined);
        assert.strictEqual(idle.totalDpBonus, 0);
    });

    test('公主：綻放荊棘 30 層 →【落幕】+6 DP／+2 附加成功，並依累計消耗血宴加最終傷害', () => {
        const r = evaluatePlayerAttack([{ id: 'rodion_manchaland', unlocked: true }],
            { status: { bloomingThorns: 30 }, pools: { bloodFeast: 10, bloodFeastSpent: 35 } },
            { status: {} });
        assert.strictEqual(r.totalDpBonus, 6, '荊棘滿 30 → 走落幕，不再觸發慶典熱潮的 DP');
        assert.strictEqual(r.totalExtraSuccess, 2);
        assert.strictEqual(r.totalFinalDamage, 3, '累計消耗 35 → floor(35/10) = 3');
        assert.strictEqual(r.onHitTargetStatus.bleed, 3 + 5 + 6, '退下 3 + 四散 5 + 落幕 6');
        assert.strictEqual(r.onHitTargetStatus.rupture, 3 + 5 + 6);
    });

    test('公主：綻放荊棘的近戰反傷只對近戰生效，且會自扣 1 層', () => {
        const owned = [{ id: 'rodion_manchaland', unlocked: false }];
        const ranged = evaluatePlayerDefend(owned, { status: { bloomingThorns: 5 } }, { status: {} }, { melee: false });
        assert.strictEqual(Object.keys(ranged.attackerStatus).length, 0, '遠程攻擊不觸發反傷');

        const melee = evaluatePlayerDefend(owned, { status: { bloomingThorns: 5 } }, { status: {} }, { melee: true });
        assert.strictEqual(melee.attackerStatus.bleed, 1);
        assert.strictEqual(melee.selfStatus.bloomingThorns, -1, '反傷後自身層數 -1');

        const empty = evaluatePlayerDefend(owned, { status: { bloomingThorns: 0 } }, { status: {} }, { melee: true });
        assert.strictEqual(Object.keys(empty.attackerStatus).length, 0, '沒有荊棘就沒有反傷');
    });

    test('全隊共用資源池：血宴定義齊備，且不會被當成單位狀態塞進 unit.status', () => {
        assert.ok(IDENTITY_TEAM_POOLS.bloodFeast, '應有血宴資源池定義');
        assert.strictEqual(IDENTITY_TEAM_POOLS.bloodFeast.max, 100);
        assert.strictEqual(IDENTITY_TEAM_POOLS.bloodFeast.gainPer.amount, 5);
        const card = getIdentityById('rodion_manchaland');
        assert.ok(card.teamPools.includes('bloodFeast'), '公主應標記使用血宴資源池');
        // 血宴不在 IDENTITY_STATUS_KEYMAP 中 → buildEngineUnitState 不會把它當單位狀態讀取
        assert.strictEqual(IDENTITY_STATUS_KEYMAP.bloodFeast, undefined);
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
console.log('\n[傷害減免自動化] 強壯改為 DP 加值、目標不屈／狂信減傷（防禦扣除模式 + 豁免抵擋模式）');
// ====================================================================
(function () {
    let hpMods;
    const dmgSandbox = {
        console, Object, Array, Math, JSON, Set, parseInt,
        window: undefined,
        localStorage: { getItem: () => null, setItem() {} },
        myRole: 'st',
        state: { units: [], roundNum: 1 },
        combatQueueLast: null,
        findUnitById: (id) => dmgSandbox.state.units.find(u => u && u.id === id) || null,
        // 每顆骰都算成功（成功數 = 骰數），排除隨機性，只驗證傷害加減項的疊加
        bbRollAttackDice: (dice) => ({ rolls: Array(Math.max(0, dice)).fill(8), successes: Math.max(0, dice), explodedCount: 0, totalRolled: dice }),
        modifyHPInternal: (unit, type, amount) => { hpMods.push({ id: unit.id, type, amount }); },
        broadcastState: () => {},
        showToast: () => {},
        escapeHtml: (s) => s,
        parseDicePlus: (v) => ({ dice: parseInt(v, 10) || 0, auto: 0 }),
        closeModal: () => {},
        document: {
            getElementById: (id) => dmgSandbox.__cells[id] || null,
        },
        __cells: {},
    };
    vm.createContext(dmgSandbox);
    vm.runInContext(readSource('src/config/status-config.js') + '\n;\n' + readSource('src/ui/combat-modals.js')
        + '\n;\nvar __dmgExports = { cmAutoRollAndApply, confirmSTReviewSaveMode, cmGetStatusLayers };',
        dmgSandbox, { filename: 'combined-dmg.js' });
    const { cmAutoRollAndApply, confirmSTReviewSaveMode, cmGetStatusLayers } = dmgSandbox.__dmgExports;

    test('cmGetStatusLayers：依狀態庫 id 讀取中文狀態層數', () => {
        assert.strictEqual(cmGetStatusLayers({ status: { '強壯': '3' } }, 'strength'), 3);
        assert.strictEqual(cmGetStatusLayers({ status: {} }, 'strength'), 0);
        assert.strictEqual(cmGetStatusLayers(null, 'strength'), 0);
    });

    // 強壯依規則書定義為「所有攻擊檢定獲得等同層數的 DP 加值」，已改由黑箱引擎的 calcMod
    // 併入攻擊 DP 桶；若這裡仍加傷，同一層強壯會被算兩次（DP 一次、傷害一次）。
    test('防禦扣除模式：攻擊者強壯不再重複加傷（已改為攻擊檢定 DP 加值）', () => {
        hpMods = [];
        const attacker = { id: 'atk1', status: { '強壯': '3' } };
        const target = { id: 'tgt1', status: {}, hpArr: [1, 1, 1] };
        dmgSandbox.state.units = [attacker, target];
        dmgSandbox.combatQueueLast = { attacker: { unitId: 'atk1', attackerRole: 'player', damageCap: 0 } };
        const roll = cmAutoRollAndApply(5, 0, 'tgt1');
        assert.strictEqual(roll.damage, 5, '傷害應只有成功數 5，強壯不再加傷');
        assert.strictEqual(hpMods[0].amount, 5, '應對目標套用 5 點傷害');
    });

    test('防禦扣除模式：目標狂信 → 傷害自動 -2（damageReduction，與不屈相加）', () => {
        hpMods = [];
        const attacker = { id: 'atk1', status: {} };
        const target = { id: 'tgt1', status: { '狂信': 1, '不屈': '1' }, hpArr: [1, 1, 1] };
        dmgSandbox.state.units = [attacker, target];
        dmgSandbox.combatQueueLast = { attacker: { unitId: 'atk1', attackerRole: 'player', damageCap: 0 } };
        const roll = cmAutoRollAndApply(5, 0, 'tgt1');
        assert.strictEqual(roll.enduranceReduction, 3, '狂信 2 + 不屈 1 = 3');
        assert.strictEqual(roll.damage, 5 - 3);
    });

    test('防禦扣除模式：目標不屈 2 層 → 傷害自動 -2（套用在攻擊上限封頂之後）', () => {
        hpMods = [];
        const attacker = { id: 'atk1', status: {} };
        const target = { id: 'tgt1', status: { '不屈': '2' }, hpArr: [1, 1, 1] };
        dmgSandbox.state.units = [attacker, target];
        dmgSandbox.combatQueueLast = { attacker: { unitId: 'atk1', attackerRole: 'player', damageCap: 0 } };
        const roll = cmAutoRollAndApply(5, 0, 'tgt1');
        assert.strictEqual(roll.enduranceReduction, 2, '應讀出不屈 2 層');
        assert.strictEqual(roll.damage, 5 - 2, '成功數 5 - 不屈 2');
        assert.strictEqual(hpMods[0].amount, 3);
    });

    test('防禦扣除模式：不屈層數大於傷害時 → 傷害最低為 0，不會變成負傷害', () => {
        hpMods = [];
        const attacker = { id: 'atk1', status: {} };
        const target = { id: 'tgt1', status: { '不屈': '99' }, hpArr: [1, 1, 1] };
        dmgSandbox.state.units = [attacker, target];
        dmgSandbox.combatQueueLast = { attacker: { unitId: 'atk1', attackerRole: 'player', damageCap: 0 } };
        const roll = cmAutoRollAndApply(5, 0, 'tgt1');
        assert.strictEqual(roll.damage, 0);
        assert.strictEqual(hpMods.length, 0, '傷害為 0 不應呼叫扣血');
    });

    test('豁免抵擋模式：目標不屈與狂信減傷都會自動疊加進每目標傷害（強壯不加傷）', () => {
        hpMods = [];
        dmgSandbox.__cells = {
            'st-review-modal': { dataset: { baseExtraSuccess: '0' } },
            'st-review-save-dice': { value: '0' },
            'st-review-modifier': { value: '0' },
            'modals-container': { insertAdjacentHTML: () => {} },
        };
        const attacker = { id: 'atk1', status: { '強壯': '2' } };
        const target = { id: 'tgt1', status: { '不屈': '1', '狂信': 1 }, hpArr: [1, 1, 1] };
        dmgSandbox.state.units = [attacker, target];
        dmgSandbox.combatQueueLast = {
            attacker: { unitId: 'atk1', attackerRole: 'player', name: '玩家' },
            target: { id: 'tgt1' }
        };
        const saveInfo = { atkRoll: { successes: 5 }, saveName: '反射', targets: [{ id: 'tgt1', name: '目標', saveDice: 0, saveAuto: 0 }] };
        confirmSTReviewSaveMode(saveInfo);
        // 傷害 = 攻擊成功 5 - 豁免 0 - 不屈 1 - 狂信 2 = 2（強壯已改為 DP 加值，不加傷）
        assert.strictEqual(hpMods[0].amount, 2);
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

// ====================================================================
console.log('\n[侵蝕攻擊] 每層侵蝕增幅 = 1 附加成功（黑箱附加成功桶）');
// ====================================================================
(function () {
    test('erosionExtraSuccess 併入附加成功桶（宣告 2 + 侵蝕 4 = 6）', () => {
        resetCaptures();
        sandbox.state.units = [{ id: 'ally', name: '隊友', type: 'player', status: {} }];
        bbRunBlackBoxCalculation({
            attacker: { dp: 5, auto: 2, erosionExtraSuccess: 4 },
            target: { id: 'ally', name: '隊友' },
            defense: { dp: 0, auto: 0 }
        });
        assert.ok(captured.stReview, '應進入 ST 審核');
        assert.strictEqual(captured.stReview.baseExtraSuccess, 6, '附加成功應為 2+4=6');
        assert.ok(/侵蝕\+4/.test(captured.stReview.debugStr || ''), 'debug 應標示侵蝕貢獻');
    });

    test('無侵蝕欄位時附加成功不受影響（向後相容）', () => {
        resetCaptures();
        sandbox.state.units = [{ id: 'ally', name: '隊友', type: 'player', status: {} }];
        bbRunBlackBoxCalculation({
            attacker: { dp: 5, auto: 3 },
            target: { id: 'ally', name: '隊友' },
            defense: { dp: 0, auto: 0 }
        });
        assert.strictEqual(captured.stReview.baseExtraSuccess, 3, '無侵蝕欄位 → 維持宣告 3');
    });

    test('侵蝕攻擊門檻可調整：eroCanAttackAllies 依當前門檻判定', () => {
        resetCaptures();
        const unit = { type: 'player', status: { 侵蝕增幅: '15' } };
        eroSetAttackThreshold(20);
        assert.strictEqual(eroGetAttackThreshold(), 20, '門檻應更新為 20');
        assert.strictEqual(eroCanAttackAllies(unit), false, '15 < 20 → 不可攻擊隊友');
        eroSetAttackThreshold(10);
        assert.strictEqual(eroCanAttackAllies(unit), true, '15 ≥ 10 → 可攻擊隊友');
        assert.strictEqual(eroCanAttackAllies({ type: 'enemy', status: { 侵蝕增幅: '99' } }), false, '非玩家單位不適用');
    });
})();

// ====================================================================
// 人格引擎 onKill / onTurnEnd 路徑：另載入 identity-config + identity-engine
// （getIdentityById 需與 IDENTITY_LIBRARY 同一 script 才能經閉包互通）
// ====================================================================
// identity-hud（主動宣告技）需要的額外 stub：狀態層數調整與依 id 查狀態定義
sandbox.updateStatusStacks = (uid, name, val) => {
    const u = sandbox.findUnitById(uid);
    if (!u) return;
    if (!u.status) u.status = {};
    if (val <= 0) delete u.status[name];
    else u.status[name] = String(val);
};
sandbox.getStatusById = (id) => {
    const map = { charge: '充能', loveHate: '愛/憎', bind: '束縛', paralyze: '麻痺', swiftness: '迅捷', poise: '呼吸法' };
    return { id, name: map[id] || id };
};
sandbox.renderIdentityModal = () => {};
sandbox.escapeHtml = (s) => s;

const identityCombined = [
    readSource('src/config/identity-config.js'),
    readSource('src/core/identity-engine.js'),
    readSource('src/ui/identity-hud.js')
].join('\n;\n')
    + '\n;\nvar __identityExports = { getIdentityById, IDENTITY_LIBRARY, evaluatePlayerKill, evaluatePlayerTurnEnd,'
    + ' evaluatePlayerAttack, idtDeclareActiveSkill, idtConsumePendingActiveBonus, identityHudState };';
vm.runInContext(identityCombined, sandbox, { filename: 'identity-combined.js' });
const { IDENTITY_LIBRARY: ID_LIB, evaluatePlayerKill, evaluatePlayerTurnEnd,
    idtDeclareActiveSkill, idtConsumePendingActiveBonus, identityHudState } = sandbox.__identityExports;

console.log('\n[人格引擎] evaluatePlayerKill（onKill：擊殺／昏迷觸發）');

test('gregor_edgar 的 onKill 為 locked：未解鎖 → 不觸發', () => {
    const res = evaluatePlayerKill([{ id: 'gregor_edgar', unlocked: false }], { status: {} }, { status: {} });
    assert.strictEqual(Object.keys(res.othersTargetStatus).length, 0, '未解鎖不應施加');
});

test('gregor_edgar 的 onKill 解鎖後 → 對「其他敵方」施加 3 沮喪（scope:others）', () => {
    const res = evaluatePlayerKill([{ id: 'gregor_edgar', unlocked: true }], { status: {} }, { status: {} });
    assert.strictEqual(res.othersTargetStatus.depression, 3, 'othersTargetStatus 應含沮喪 3');
    assert.strictEqual(Object.keys(res.killedTargetStatus).length, 0, '不落在被擊殺目標本身');
});

test('多張持有卡 onKill 疊加（同一張兩解鎖來源）不炸、缺 onKill 的卡略過', () => {
    const res = evaluatePlayerKill(
        [{ id: 'gregor_edgar', unlocked: true }, 'gregor_blackcloud'],
        { status: {} }, { status: {} }
    );
    assert.strictEqual(res.othersTargetStatus.depression, 3, '只有 gregor_edgar 貢獻沮喪 3');
});

console.log('\n[人格引擎] evaluatePlayerTurnEnd（onTurnEnd：回合結束觸發）');

test('onTurnEnd selfStatus 負值（資源衰減）正確落入 expectedSelfStatus', () => {
    ID_LIB['__test_turnend'] = {
        id: '__test_turnend', name: '測試回合結束卡',
        hooks: { onTurnEnd: [{ condition: () => true, selfStatus: { charge: -1 }, source: 't', skill: 't' }] }
    };
    const res = evaluatePlayerTurnEnd(['__test_turnend'], { status: { charge: 5 } });
    assert.strictEqual(res.expectedSelfStatus.charge, -1, '回合結束 charge 應 -1');
    delete ID_LIB['__test_turnend'];
});

test('無 onTurnEnd hook 的卡 → 回傳空結算（不炸）', () => {
    const res = evaluatePlayerTurnEnd(['gregor_edgar'], { status: {} });
    assert.strictEqual(Object.keys(res.expectedSelfStatus).length, 0, '無 onTurnEnd → 空');
});

console.log('\n[狀態設定] turnEndDecay 資料驅動衰減欄位');

console.log('\n[人格引擎] 主動宣告技（onActive：宣告扣成本、加值併入下次攻擊）');

// 依 effect 結構在資料庫中找一張範例卡（不寫死 id，避免資料調整後測試失聯）
function findActiveCard(pred) {
    for (const [id, c] of Object.entries(ID_LIB)) {
        if (!c.hooks || !Array.isArray(c.hooks.onActive)) continue;
        const i = c.hooks.onActive.findIndex(h => h && h.effect && pred(h.effect));
        if (i >= 0) return { id, index: i, effect: c.hooks.onActive[i].effect };
    }
    return null;
}

test('宣告消耗充能→DP 加值暫存到下次攻擊，成本從自身扣除', () => {
    resetCaptures();
    const found = findActiveCard(e => e.cost && e.cost.charge && e.dpBonus);
    assert.ok(found, '應能在資料庫找到「消耗充能 +DP」的主動技');
    sandbox.state.units = [{ id: 'me', name: '角色', status: { 充能: '5' } }, { id: 'foe', name: '敵', status: {} }];
    identityHudState.attackerId = 'me';
    identityHudState.targetId = 'foe';
    idtConsumePendingActiveBonus('me'); // 清掉前一測試殘留
    idtDeclareActiveSkill(found.id, found.index);
    const need = found.effect.cost.charge;
    assert.strictEqual(sandbox.findUnitById('me').status['充能'], String(5 - need), `充能應扣 ${need}`);
    const pend = idtConsumePendingActiveBonus('me');
    assert.ok(pend && pend.dp === found.effect.dpBonus, 'DP 加值應暫存待下次攻擊');
    assert.strictEqual(idtConsumePendingActiveBonus('me'), null, '取用後清除，不重複套用');
});

test('宣告消耗充能→對目標施加狀態；資源不足時不扣也不套用', () => {
    resetCaptures();
    const found = findActiveCard(e => e.cost && e.cost.charge && e.targetStatus);
    assert.ok(found, '應能找到「消耗充能→施加狀態」的主動技');
    // 足夠：施加狀態、扣成本
    sandbox.state.units = [{ id: 'me', status: { 充能: '10' } }, { id: 'foe', status: {} }];
    identityHudState.attackerId = 'me';
    identityHudState.targetId = 'foe';
    idtDeclareActiveSkill(found.id, found.index);
    assert.strictEqual(sandbox.findUnitById('me').status['充能'], String(10 - found.effect.cost.charge), '成本已扣');
    assert.ok(captured.addStatus.some(a => a.unitId === 'foe'), '對目標施加了狀態');
    // 不足：不扣、不套用、給提示
    resetCaptures();
    sandbox.state.units = [{ id: 'me', status: { 充能: '1' } }, { id: 'foe', status: {} }];
    identityHudState.attackerId = 'me';
    identityHudState.targetId = 'foe';
    idtDeclareActiveSkill(found.id, found.index);
    assert.strictEqual(sandbox.findUnitById('me').status['充能'], '1', '資源不足 → 充能不變');
    assert.strictEqual(captured.addStatus.length, 0, '資源不足 → 不施加狀態');
    assert.strictEqual(idtConsumePendingActiveBonus('me'), null, '資源不足 → 無暫存加值');
});

test('充能與混亂皆標記 turnEndDecay:1（供回合結束自動 −1）', () => {
    const findDef = (id) => {
        for (const cat of Object.values(STATUS_LIBRARY)) {
            const d = cat.find(x => x.id === id);
            if (d) return d;
        }
        return null;
    };
    assert.strictEqual(findDef('charge')?.turnEndDecay, 1, '充能應有 turnEndDecay:1');
    assert.strictEqual(findDef('confusion')?.turnEndDecay, 1, '混亂應有 turnEndDecay:1');
});

// ====================================================================
console.log('\n[浮士德回報修正] 疾風疊加／指令加護（消耗動作）／人民之盾（未造成傷害）');
// ====================================================================
(function () {
    const faustSandbox = {
        console, Object, Array, Math, JSON, Set, parseInt,
        window: undefined,
        document: { getElementById: () => null },
        localStorage: { getItem: () => null, setItem() {} },
        myRole: 'player',
        state: { units: [] },
        findUnitById: (id) => faustSandbox.state.units.find(u => u && u.id === id) || null,
        showToast: () => {},
        escapeHtml: (s) => s,
    };
    vm.createContext(faustSandbox);
    const files = [
        'src/config/status-config.js',
        'src/config/identity-config.js',
        'src/core/identity-engine.js',
        'src/ui/identity-hud.js',
        'src/ui/combat-modals.js'
    ];
    vm.runInContext(files.map(f => readSource(f)).join('\n;\n')
        + '\n;\nvar __fExports = { cmResolveIdentityBonus, identityHudState, evaluatePlayerActionUsed,'
        + ' evaluatePlayerResolve, buildEngineUnitState, IDENTITY_LIBRARY };',
        faustSandbox, { filename: 'combined-faust-fixes.js' });
    const {
        cmResolveIdentityBonus, identityHudState, evaluatePlayerActionUsed,
        evaluatePlayerResolve, buildEngineUnitState, IDENTITY_LIBRARY
    } = faustSandbox.__fExports;

    // cmResolveIdentityBonus 對「未列在 cards 中的卡」預設視為持有，
    // 故測單一張卡時必須把同角色其餘卡明確設為未持有，否則會混入其他卡的效果。
    const FAUST_CARDS = ['faust_note', 'faust_zwei', 'faust_blackbeast', 'faust_wcorp'];
    const faustOnly = (keepId) => {
        const cards = {};
        FAUST_CARDS.forEach(id => { cards[id] = { owned: id === keepId, unlocked: false }; });
        return cards;
    };

    // ---- 疾風（黑獸卯魁首）：法術命中 +1，上限 10 ----
    test('疾風：法術命中 → onHit 自身 +1 層疾風', () => {
        identityHudState.owner = '浮士德';
        identityHudState.cards = faustOnly('faust_blackbeast');
        identityHudState.cardInputs = {};
        const r = cmResolveIdentityBonus({ id: 'atk', status: {}, init: 20 }, { id: 'tgt', status: {}, init: 5 });
        assert.strictEqual(r.onHitSelfStatus.gale, 1, `法術命中應疊 1 層疾風，實得 ${r.onHitSelfStatus.gale}`);
    });

    test('疾風：已達 10 點上限 → 不再疊加', () => {
        identityHudState.owner = '浮士德';
        identityHudState.cards = faustOnly('faust_blackbeast');
        identityHudState.cardInputs = {};
        const r = cmResolveIdentityBonus({ id: 'atk', status: { '疾風': 10 }, init: 20 }, { id: 'tgt', status: {}, init: 5 });
        assert.ok(!r.onHitSelfStatus.gale, `疾風滿 10 點不應再疊，實得 ${r.onHitSelfStatus.gale}`);
    });

    test('疾風：9 點時只補到上限（+1 而非溢出）', () => {
        identityHudState.owner = '浮士德';
        identityHudState.cards = faustOnly('faust_blackbeast');
        identityHudState.cardInputs = {};
        const r = cmResolveIdentityBonus({ id: 'atk', status: { '疾風': 9 }, init: 20 }, { id: 'tgt', status: {}, init: 5 });
        assert.strictEqual(r.onHitSelfStatus.gale, 1, '9 點時應剛好補滿到 10');
    });

    // ---- 指令加護（紙條）：每消耗一種動作 +5，上限 9 ----
    test('指令加護：消耗一個動作 → +5 層', () => {
        const owned = [{ id: 'faust_note', unlocked: false }];
        const res = evaluatePlayerActionUsed(owned, { status: {} }, 'swift');
        assert.strictEqual(res.expectedSelfStatus.commandProtect, 5, '消耗迅捷動作應 +5 指令加護');
    });

    test('指令加護：三種動作各觸發一次（迅捷／移動／標準皆有效）', () => {
        const owned = [{ id: 'faust_note', unlocked: false }];
        ['swift', 'move', 'standard'].forEach(type => {
            const res = evaluatePlayerActionUsed(owned, { status: {} }, type);
            assert.strictEqual(res.expectedSelfStatus.commandProtect, 5, `${type} 應 +5 指令加護`);
        });
    });

    test('指令加護：上限 9 層（已 6 層 → 只 +3；已 9 層 → 不再加）', () => {
        const owned = [{ id: 'faust_note', unlocked: false }];
        const at6 = evaluatePlayerActionUsed(owned, { status: { commandProtect: 6 } }, 'move');
        assert.strictEqual(at6.expectedSelfStatus.commandProtect, 3, '6 層時只應補到 9（+3）');
        const at9 = evaluatePlayerActionUsed(owned, { status: { commandProtect: 9 } }, 'move');
        assert.ok(!at9.expectedSelfStatus.commandProtect, '已滿 9 層不應再加');
    });

    test('指令加護：紙條卡標記 actionUsedTracker（面板才會出現動作消耗按鈕）', () => {
        assert.strictEqual(IDENTITY_LIBRARY.faust_note.actionUsedTracker, true);
    });

    // ---- 人民之盾（Zwei）：造成傷害 +4、未造成傷害／未命中 +6 ----
    test('人民之盾：造成傷害 → 合計 +4 層（地區巡查 2 ＋ 客戶保護 2）', () => {
        const owned = [{ id: 'faust_zwei', unlocked: false }];
        const res = evaluatePlayerResolve(owned, { status: {} }, { status: {} }, { hit: true, damage: 5 });
        assert.strictEqual(res.selfStatus.shield, 4, `造成傷害應 +4 層，實得 ${res.selfStatus.shield}`);
    });

    test('人民之盾：未命中 → 合計 +6 層（地區巡查 3 ＋ 客戶保護 3）', () => {
        const owned = [{ id: 'faust_zwei', unlocked: false }];
        const res = evaluatePlayerResolve(owned, { status: {} }, { status: {} }, { hit: false, damage: 0 });
        assert.strictEqual(res.selfStatus.shield, 6, `未命中應 +6 層，實得 ${res.selfStatus.shield}`);
    });

    test('人民之盾：命中但 0 傷害 → 同樣走 +6 層分支', () => {
        const owned = [{ id: 'faust_zwei', unlocked: false }];
        const res = evaluatePlayerResolve(owned, { status: {} }, { status: {} }, { hit: true, damage: 0 });
        assert.strictEqual(res.selfStatus.shield, 6, '命中但未造成傷害應視為「未造成傷害」');
    });

    test('人民之盾：兩種結果都隨攻擊資料送出，由 ST 端擇一套用', () => {
        identityHudState.owner = '浮士德';
        identityHudState.cards = faustOnly('faust_zwei');
        identityHudState.cardInputs = {};
        const r = cmResolveIdentityBonus({ id: 'atk', status: {}, init: 10 }, { id: 'tgt', status: {}, init: 10 });
        assert.strictEqual(r.onResolveDamagedSelfStatus.shield, 4, '造成傷害分支應為 +4');
        assert.strictEqual(r.onResolveNoDamageSelfStatus.shield, 6, '未造成傷害分支應為 +6');
    });

    test('無 onResolve hook 的卡 → 兩個分支皆為空（不影響其他角色）', () => {
        identityHudState.owner = '浮士德';
        // 未列出的卡在 cmResolveIdentityBonus 中預設視為持有，故其餘浮士德卡需明確設為未持有
        identityHudState.cards = faustOnly('faust_wcorp');
        identityHudState.cardInputs = {};
        const r = cmResolveIdentityBonus({ id: 'atk', status: {}, init: 10 }, { id: 'tgt', status: {}, init: 10 });
        assert.strictEqual(Object.keys(r.onResolveDamagedSelfStatus).length, 0);
        assert.strictEqual(Object.keys(r.onResolveNoDamageSelfStatus).length, 0);
    });
})();

// ====================================================================
console.log('\n[戰鬥隊列] 等候區排隊、ST 強制中止、代填防禦、刪除單位自動解卡');
// ====================================================================
// 以假的 Firebase ref 載入真實的 combat-queue.js：驗證「作用中槽位忙碌時排入等候區」
// 「閒置時自動推進」「ST 接管」三條路徑，這些是先前整場戰鬥卡死的成因所在。
(function () {
    // ---- 假 Firebase ref：以物件樹模擬 child/set/update/transaction/push/once ----
    function makeFakeDb() {
        const db = { combatQueue: { status: 'idle' }, combatQueuePending: {} };
        let pushSeq = 0;
        const makeRef = (path) => ({
            path,
            set(v) { db[path] = v; },
            update(v) { db[path] = Object.assign({}, db[path], v); },
            remove() { db[path] = (path === 'combatQueuePending') ? {} : null; },
            push(v) { const k = 'k' + (++pushSeq); db[path][k] = v; return { key: k }; },
            once() { return Promise.resolve({ val: () => db[path] }); },
            on() { return () => {}; },
            off() {},
            child(key) {
                return {
                    remove() { delete db[path][key]; },
                    set(v) { db[path][key] = v; },
                    once() { return Promise.resolve({ val: () => db[path][key] }); }
                };
            },
            transaction(fn, cb) {
                const next = fn(db[path]);
                const committed = next !== undefined;
                if (committed) db[path] = next;
                if (cb) cb(null, committed);
            }
        });
        return {
            db,
            roomRef: { child: (name) => makeRef(name) }
        };
    }

    function loadQueue(role) {
        const fake = makeFakeDb();
        const sandbox = {
            console, Object, Array, JSON, Math, Promise, parseInt, Number, Date,
            myRole: role,
            roomRef: fake.roomRef,
            unsubscribeListeners: [],
            firebase: { database: { ServerValue: { TIMESTAMP: 999 } } },
            toasts: [],
            findUnitById: (id) => sandbox.units.find(u => u.id === id) || null,
            units: [],
        };
        sandbox.showToast = (m) => sandbox.toasts.push(m);
        vm.createContext(sandbox);
        vm.runInContext(readSource('src/core/combat-queue.js')
            + '\n;\nvar __q = { cqInitiateAttack, cqTryAdvancePending, cqForceReset, cqCancelPending,'
            + ' cqSTSubmitDefenseFor, cqAbortIfDefenderRemoved, cqHandleUpdate,'
            + ' setPending: (l) => { cqPendingList = l; }, getPending: () => cqPendingList,'
            + ' setLast: (v) => { combatQueueLast = v; } };',
            sandbox, { filename: 'combat-queue.js' });
        return { q: sandbox.__q, db: fake.db, sandbox };
    }

    const atk = (name) => ({ attacker: { name, unitId: 'u_' + name }, target: { id: 't1', name: '敵人' } });

    test('槽位閒置 → 攻擊直接進入作用中槽位，不進等候區', () => {
        const { q, db } = loadQueue('player');
        q.cqInitiateAttack(atk('甲'));
        assert.strictEqual(db.combatQueue.status, 'calculating');
        assert.strictEqual(Object.keys(db.combatQueuePending).length, 0);
    });

    test('槽位忙碌 → 第二筆攻擊排入等候區（不再被拒絕）', () => {
        const { q, db, sandbox } = loadQueue('player');
        q.cqInitiateAttack(atk('甲'));
        q.cqInitiateAttack(atk('乙'));
        assert.strictEqual(db.combatQueue.attacker.name, '甲', '作用中槽位仍是第一筆');
        const pending = Object.values(db.combatQueuePending);
        assert.strictEqual(pending.length, 1, '第二筆應排入等候區');
        assert.strictEqual(pending[0].attacker.name, '乙');
        assert.ok(sandbox.toasts.some(t => t.includes('等候區')), '應提示玩家已排入等候區');
    });

    test('多筆同時發起 → 全部保留（一筆作用中、其餘依序排隊）', () => {
        const { q, db } = loadQueue('player');
        ['甲', '乙', '丙', '丁'].forEach(n => q.cqInitiateAttack(atk(n)));
        assert.strictEqual(db.combatQueue.attacker.name, '甲');
        assert.strictEqual(Object.keys(db.combatQueuePending).length, 3, '其餘三筆都應保留在等候區');
    });

    test('ST 強制中止 → 槽位回到 idle 並標記 abortedAt（等候區完整保留）', () => {
        const { q, db } = loadQueue('st');
        q.cqInitiateAttack(atk('甲'));
        q.cqInitiateAttack(atk('乙'));   // 忙碌 → 實際排進等候區
        assert.strictEqual(Object.keys(db.combatQueuePending).length, 1, '前置條件：等候區有一筆');

        q.cqForceReset();
        assert.strictEqual(db.combatQueue.status, 'idle');
        assert.ok(db.combatQueue.abortedAt, '應標記中止時間戳供玩家端提示');
        assert.strictEqual(Object.keys(db.combatQueuePending).length, 1,
            '中止只針對作用中那筆，等候區的攻擊不可被牽連清掉');
    });

    test('ST 強制中止並清空等候區 → 等候區歸零', () => {
        const { q, db } = loadQueue('st');
        q.cqInitiateAttack(atk('甲'));
        q.cqInitiateAttack(atk('乙'));
        q.cqForceReset(true);
        assert.strictEqual(db.combatQueue.status, 'idle');
        assert.strictEqual(Object.keys(db.combatQueuePending).length, 0);
    });

    test('玩家無法強制中止（權限）', () => {
        const { q, db, sandbox } = loadQueue('player');
        q.cqInitiateAttack(atk('甲'));
        q.cqForceReset();
        assert.strictEqual(db.combatQueue.status, 'calculating', '玩家不應能中止結算');
        assert.ok(sandbox.toasts.some(t => t.includes('只有 ST')));
    });

    test('槽位閒置時推進等候區 → 最舊的一筆進入作用中並從等候區移除', async () => {
        const { q, db } = loadQueue('st');
        db.combatQueuePending = { k1: { attacker: { name: '乙' }, target: { id: 't1' }, queuedAt: 1 } };
        q.setPending([{ key: 'k1', attacker: { name: '乙' }, target: { id: 't1' }, queuedAt: 1 }]);
        q.cqTryAdvancePending();
        await Promise.resolve(); await Promise.resolve();
        assert.strictEqual(db.combatQueue.attacker.name, '乙', '等候區最舊的一筆應被推進');
        assert.ok(!db.combatQueuePending.k1, '推進成功後應從等候區移除');
    });

    test('槽位忙碌時不推進等候區（不會覆蓋審核中的結算）', async () => {
        const { q, db } = loadQueue('st');
        q.cqInitiateAttack(atk('甲'));
        db.combatQueuePending = { k1: { attacker: { name: '乙' }, target: { id: 't1' } } };
        q.setPending([{ key: 'k1', attacker: { name: '乙' }, target: { id: 't1' } }]);
        q.cqTryAdvancePending();
        await Promise.resolve(); await Promise.resolve();
        assert.strictEqual(db.combatQueue.attacker.name, '甲', '作用中的結算不應被蓋掉');
        assert.ok(db.combatQueuePending.k1, '等候區項目應保留');
    });

    test('玩家端不推進等候區（單一推進者，避免同一筆結算兩次）', async () => {
        const { q, db } = loadQueue('player');
        db.combatQueuePending = { k1: { attacker: { name: '乙' }, target: { id: 't1' } } };
        q.setPending([{ key: 'k1', attacker: { name: '乙' }, target: { id: 't1' } }]);
        q.cqTryAdvancePending();
        await Promise.resolve(); await Promise.resolve();
        assert.strictEqual(db.combatQueue.status, 'idle', '玩家端不應推進');
        assert.ok(db.combatQueuePending.k1);
    });

    test('ST 代填防禦 → 狀態轉入 calculating 並標記 defenseByST', async () => {
        const { q, db } = loadQueue('st');
        db.combatQueue = { status: 'pending_defense', target: { id: 't1', name: '玩家A' } };
        q.cqSTSubmitDefenseFor(7, 2);
        await Promise.resolve(); await Promise.resolve();
        assert.strictEqual(db.combatQueue.status, 'calculating');
        assert.deepStrictEqual(db.combatQueue.defense, { dp: 7, auto: 2 });
        assert.strictEqual(db.combatQueue.defenseByST, true, '應標記為 ST 代填');
    });

    test('ST 代填防禦：狀態不是 pending_defense 時不寫入（不蓋掉已往下跑的結算）', async () => {
        const { q, db, sandbox } = loadQueue('st');
        db.combatQueue = { status: 'st_review', baseDice: 5 };
        q.cqSTSubmitDefenseFor(7, 2);
        await Promise.resolve(); await Promise.resolve();
        assert.strictEqual(db.combatQueue.status, 'st_review', '審核中的結算不應被覆寫');
        assert.ok(sandbox.toasts.some(t => t.includes('沒有等待防禦')));
    });

    test('刪除防禦方單位 → 自動中止該筆結算（實際踩過的卡死情境）', () => {
        const { q, db } = loadQueue('st');
        db.combatQueue = { status: 'pending_defense', target: { id: 't1', name: '玩家A' }, attacker: { name: 'BOSS' } };
        q.setLast(db.combatQueue);
        q.cqAbortIfDefenderRemoved('t1');
        assert.strictEqual(db.combatQueue.status, 'idle', '刪除防禦方後應自動中止，不再卡死');
    });

    test('刪除無關單位 → 不影響進行中的結算', () => {
        const { q, db } = loadQueue('st');
        db.combatQueue = { status: 'pending_defense', target: { id: 't1' }, attacker: { name: 'BOSS' } };
        q.setLast(db.combatQueue);
        q.cqAbortIfDefenderRemoved('someone-else');
        assert.strictEqual(db.combatQueue.status, 'pending_defense');
    });

    test('刪除單位 → 等候區中與該單位相關的攻擊一併清掉', () => {
        const { q, db } = loadQueue('st');
        db.combatQueue = { status: 'idle' };
        q.setLast(db.combatQueue);
        db.combatQueuePending = {
            k1: { attacker: { name: '甲', unitId: 'u1' }, target: { id: 't1' } },
            k2: { attacker: { name: '乙', unitId: 'u2' }, target: { id: 't9' } }
        };
        q.setPending([
            { key: 'k1', attacker: { name: '甲', unitId: 'u1' }, target: { id: 't1' } },
            { key: 'k2', attacker: { name: '乙', unitId: 'u2' }, target: { id: 't9' } }
        ]);
        q.cqAbortIfDefenderRemoved('t1');
        assert.ok(!db.combatQueuePending.k1, '目標為被刪單位的攻擊應清掉');
        assert.ok(db.combatQueuePending.k2, '無關的攻擊應保留');
    });

    test('ST 取消等候區單筆 → 只移除該筆', () => {
        const { q, db } = loadQueue('st');
        db.combatQueuePending = { k1: { attacker: { name: '甲' } }, k2: { attacker: { name: '乙' } } };
        q.cqCancelPending('k1');
        assert.ok(!db.combatQueuePending.k1);
        assert.ok(db.combatQueuePending.k2);
    });

    test('pending_defense 且防禦方已不存在 → ST 端收到更新時自動中止', () => {
        const { q, db, sandbox } = loadQueue('st');
        sandbox.units = [];  // 防禦方單位已被刪
        db.combatQueue = { status: 'pending_defense', target: { id: 'gone', name: '玩家A' } };
        q.cqHandleUpdate(db.combatQueue);
        assert.strictEqual(db.combatQueue.status, 'idle');
        assert.ok(sandbox.toasts.some(t => t.includes('已不在場上')));
    });
})();

// ====================================================================
console.log('\n[音樂同步] 進度校正夾限（中途加入的玩家聽不到音樂）與解鎖不打斷播放');
// ====================================================================
(function () {
    const audioSandbox = {
        console, Object, Array, JSON, Math, Number, isFinite, parseFloat, parseInt, Date, Promise,
        window: { AudioContext: null, webkitAudioContext: null, escapeHtml: (s) => s },
        document: { getElementById: () => null, addEventListener() {}, readyState: 'complete', body: null, head: null },
        localStorage: { getItem: () => null, setItem() {} },
        showToast: () => {},
        myRole: 'player',
    };
    audioSandbox.Audio = function () {
        return { addEventListener() {}, removeAttribute() {}, play: () => Promise.resolve(), pause() {} };
    };
    vm.createContext(audioSandbox);
    vm.runInContext(readSource('src/utils/audio.js')
        + '\n;\nvar __a = { musicManager };', audioSandbox, { filename: 'audio.js' });
    const mm = audioSandbox.__a.musicManager;

    /** 假 audio 元素：紀錄 seek 結果與 loadedmetadata 監聽 */
    function fakeAudio(duration, readyState) {
        const listeners = {};
        return {
            currentTime: 0,
            duration,
            readyState,
            paused: false,
            addEventListener(ev, fn) { listeners[ev] = fn; },
            fireLoadedMetadata(newDuration) {
                if (newDuration !== undefined) this.duration = newDuration;
                if (listeners.loadedmetadata) listeners.loadedmetadata();
            }
        };
    }

    test('進度校正：目標時間超過曲長 → 取模回到曲內（不會跳到範圍外）', () => {
        mm.currentAudio = fakeAudio(180, 4);
        mm._seekSynced(1800);   // 開播 30 分鐘後才加入
        assert.ok(mm.currentAudio.currentTime < 180,
            `校正後應落在曲內，實得 ${mm.currentAudio.currentTime}`);
        assert.strictEqual(mm.currentAudio.currentTime, 1800 % 180);
    });

    test('進度校正：曲長未知（metadata 未載入）→ 等到 loadedmetadata 才校正', () => {
        mm.currentAudio = fakeAudio(NaN, 0);
        mm._seekSynced(1800);
        assert.strictEqual(mm.currentAudio.currentTime, 0, 'metadata 未就緒時不應先亂 seek');
        mm.currentAudio.fireLoadedMetadata(180);
        assert.strictEqual(mm.currentAudio.currentTime, 1800 % 180, 'metadata 就緒後才校正到曲內位置');
    });

    test('進度校正：曲長為 Infinity（串流）→ 不 seek，從頭播', () => {
        mm.currentAudio = fakeAudio(Infinity, 4);
        mm._seekSynced(1800);
        assert.strictEqual(mm.currentAudio.currentTime, 0);
    });

    test('進度校正：剛好等於曲長 → 夾在結尾之前（不會立刻播完）', () => {
        mm.currentAudio = fakeAudio(180, 4);
        mm._seekSynced(180);
        assert.ok(mm.currentAudio.currentTime < 180 && mm.currentAudio.currentTime >= 0);
    });

    test('進度校正：目標時間為 0／負值 → 不動（維持從頭播）', () => {
        mm.currentAudio = fakeAudio(180, 4);
        mm.currentAudio.currentTime = 5;
        mm._seekSynced(0);
        mm._seekSynced(-3);
        assert.strictEqual(mm.currentAudio.currentTime, 5);
    });

    test('音訊解鎖：正在播放時不動 src（先前會把播到一半的音樂弄停）', () => {
        mm._audioUnlocked = false;
        const playing = fakeAudio(180, 4);
        playing.paused = false;
        playing.src = 'https://example.com/song.mp3';
        mm.currentAudio = playing;
        mm._unlockAudio();
        assert.strictEqual(playing.src, 'https://example.com/song.mp3', '播放中的音源不可被靜音 WAV 覆蓋');
        assert.strictEqual(mm._audioUnlocked, true, '能播放即代表已解鎖');
    });
})();

// ====================================================================
console.log('\n[結算明細] calcDetail：分項相加等於採用值、先前遺漏的項目都列進去');
// ====================================================================
// 明細與結算結果對不起來的根因是「明細只列了幾項、實際計算用了更多項」。
// 這裡驗證每個桶的分項總和等於該桶的小計，並確認先前完全沒出現在明細裡的項目都在。
(function () {
    const sumParts = (parts) => (parts || []).reduce((s, p) => s + (Number(p.value) || 0), 0);
    const labels = (parts) => (parts || []).map(p => p.label).join(' | ');
    const detail = () => captured.stReview.extras.calcDetail;

    test('攻擊 DP：分項相加 = 攻擊 DP 合計（含破甲／高速／破魔／人格卡）', () => {
        resetCaptures();
        sandbox.state.units = [{ id: 'boss', type: 'enemy', status: {}, defDp: 5, defAuto: 0 }];
        bbRunBlackBoxCalculation({
            attacker: { dp: 10, auto: 0, armorPierce: 3, hastePierce: 2, magicPierce: 1,
                        identityDpBonus: 4, counterPhaseDpBonus: 2 },
            target: { id: 'boss' },
            defense: null
        });
        const d = detail();
        assert.strictEqual(sumParts(d.atk.parts), d.atk.total,
            `分項(${sumParts(d.atk.parts)}) 應等於合計(${d.atk.total})：${labels(d.atk.parts)}`);
        assert.strictEqual(d.atk.total, 22, '10+3+2+1+4+2 = 22');
    });

    test('攻擊 DP 明細列出先前遺漏的破甲／高速／破魔與未對抗加成', () => {
        resetCaptures();
        sandbox.state.units = [{ id: 'boss', type: 'enemy', status: {}, defDp: 0, defAuto: 0 }];
        bbRunBlackBoxCalculation({
            attacker: { dp: 5, auto: 0, armorPierce: 3, hastePierce: 2, magicPierce: 1, counterPhaseDpBonus: 7 },
            target: { id: 'boss' },
            defense: null
        });
        const txt = labels(detail().atk.parts);
        ['破甲', '高速', '破魔', '未對抗加成'].forEach(k =>
            assert.ok(txt.includes(k), `明細應列出「${k}」，實際：${txt}`));
    });

    test('防禦 DP：分項相加 = 防禦合計（含無視防禦）', () => {
        resetCaptures();
        sandbox.state.units = [{ id: 'boss', type: 'enemy', status: {}, defDp: 12, defAuto: 0 }];
        bbRunBlackBoxCalculation({
            attacker: { dp: 20, auto: 0, ignoreDef: 5 },
            target: { id: 'boss' },
            defense: null
        });
        const d = detail();
        assert.strictEqual(sumParts(d.def.parts), d.def.total,
            `分項(${sumParts(d.def.parts)}) 應等於合計(${d.def.total})：${labels(d.def.parts)}`);
        assert.strictEqual(d.def.total, 7, '12 − 5 = 7');
        assert.ok(labels(d.def.parts).includes('無視防禦'));
    });

    test('附加成功：分項相加 = 附加成功合計（含人格卡／侵蝕／防禦方抵銷）', () => {
        resetCaptures();
        sandbox.state.units = [{ id: 'boss', type: 'enemy', status: {}, defDp: 0, defAuto: 2 }];
        bbRunBlackBoxCalculation({
            attacker: { dp: 5, auto: 3, identityExtraSuccess: 2, erosionExtraSuccess: 1 },
            target: { id: 'boss' },
            defense: null
        });
        const d = detail();
        assert.strictEqual(sumParts(d.extra.parts), d.extra.total,
            `分項(${sumParts(d.extra.parts)}) 應等於合計(${d.extra.total})：${labels(d.extra.parts)}`);
        assert.strictEqual(d.extra.total, 4, '3+2+1 − 2 = 4');
    });

    test('明細帶出擲骰設定（加骰門檻／攻擊上限／嚴重轉惡性）', () => {
        resetCaptures();
        sandbox.state.units = [{ id: 'boss', type: 'enemy', status: {}, defDp: 0, defAuto: 0 }];
        bbRunBlackBoxCalculation({
            attacker: { dp: 8, auto: 0, explodeAt: 9, damageCap: 15, critVicious: 2 },
            target: { id: 'boss' },
            defense: null
        });
        const d = detail();
        assert.strictEqual(d.explodeAt, 9, '加骰門檻先前完全不在明細裡');
        assert.strictEqual(d.damageCap, 15, '攻擊上限先前完全不在明細裡');
        assert.strictEqual(d.critVicious, 2);
    });

    test('明細預告擲骰後併入傷害的加減項（破裂／易損／不屈／狂信）', () => {
        resetCaptures();
        sandbox.state.units = [
            { id: 'me', type: 'player', status: { '強壯': 4 } },
            { id: 'boss', type: 'enemy', defDp: 0, defAuto: 0, status: { '破裂': 3, '易損': 2, '不屈': 5, '狂信': 1 } }
        ];
        bbRunBlackBoxCalculation({
            attacker: { dp: 8, auto: 0, unitId: 'me' },
            target: { id: 'boss' },
            defense: null
        });
        const mods = detail().damageMods;
        const bonusTxt = mods.bonuses.map(b => `${b.label}=${b.value}`).join(' | ');
        assert.ok(bonusTxt.includes('破裂'), `應預告破裂加傷：${bonusTxt}`);
        assert.ok(bonusTxt.includes('易損'), `應預告易損加傷：${bonusTxt}`);
        // 強壯已改為攻擊檢定 DP 加值，不再出現在傷害加減項裡（否則會被算兩次）
        assert.ok(!bonusTxt.includes('強壯'), `強壯不應再列為傷害加值：${bonusTxt}`);
        const redTxt = mods.reductions.map(r => `${r.label}=${r.value}`).join(' | ');
        assert.ok(redTxt.includes('不屈'), `應預告不屈減傷：${redTxt}`);
        assert.ok(redTxt.includes('狂信'), `應預告狂信減傷：${redTxt}`);
    });

    test('強壯：以攻擊檢定 DP 加值計入 DP 桶（每層 +1）', () => {
        resetCaptures();
        sandbox.state.units = [
            { id: 'me', type: 'player', status: { '強壯': 4 } },
            { id: 'boss', type: 'enemy', defDp: 0, defAuto: 0, status: {} }
        ];
        bbRunBlackBoxCalculation({
            attacker: { dp: 8, auto: 0, unitId: 'me' },
            target: { id: 'boss' },
            defense: null
        });
        assert.strictEqual(captured.stReview.baseDice, 12, '攻擊 8 + 強壯 4 層 → 骰數 12');
        assert.ok(/強壯\(\+4\)/.test(captured.stReview.debugStr), `debugStr 應列出 強壯(+4)：${captured.stReview.debugStr}`);
    });

    test('狂信：基礎防禦固定 +4（binary 狀態不隨層數放大）', () => {
        resetCaptures();
        sandbox.state.units = [
            { id: 'boss', type: 'enemy', defDp: 3, defAuto: 0, status: { '狂信': 1 } }
        ];
        bbRunBlackBoxCalculation({ attacker: { dp: 10, auto: 0 }, target: { id: 'boss' }, defense: null });
        assert.strictEqual(captured.stReview.baseDice, 10 - (3 + 4), '防禦 3 + 狂信 4 → 骰數 3');
    });

    test('綻放荊棘：每 2 層基礎防禦 +1（奇數層無條件捨去，不產生小數）', () => {
        resetCaptures();
        sandbox.state.units = [
            { id: 'boss', type: 'enemy', defDp: 0, defAuto: 0, status: { '綻放荊棘': 7 } }
        ];
        bbRunBlackBoxCalculation({ attacker: { dp: 10, auto: 0 }, target: { id: 'boss' }, defense: null });
        assert.strictEqual(captured.stReview.baseDice, 10 - 3, '7 層 → floor(7/2)=3 點防禦');
        assert.ok(Number.isInteger(captured.stReview.baseDice), '骰數必須是整數');
    });

    test('無任何加減項時 damageMods 為空（明細不塞無關項目）', () => {
        resetCaptures();
        sandbox.state.units = [{ id: 'boss', type: 'enemy', status: {}, defDp: 0, defAuto: 0 }];
        bbRunBlackBoxCalculation({ attacker: { dp: 8, auto: 0 }, target: { id: 'boss' }, defense: null });
        const mods = detail().damageMods;
        assert.strictEqual(mods.bonuses.length, 0);
        assert.strictEqual(mods.reductions.length, 0);
    });

    test('豁免抵擋模式：防禦桶標記 skipped，明細不會誤導成有扣防禦', () => {
        resetCaptures();
        sandbox.state.units = [{ id: 'p1', type: 'player', status: {}, saveReflex: 4, saveReflexAuto: 1 }];
        bbRunBlackBoxCalculation({
            attacker: { dp: 9, auto: 0, resolveMode: 'save', saveType: 'saveReflex' },
            target: { id: 'p1', name: '玩家A' },
            defense: null
        });
        const d = detail();
        assert.strictEqual(d.mode, 'save');
        assert.strictEqual(d.def.skipped, true);
    });

    test('ST 代填防禦：明細標示來源為 ST 而非玩家填報', () => {
        resetCaptures();
        sandbox.state.units = [{ id: 'p1', type: 'player', status: {} }];
        bbRunBlackBoxCalculation({
            attacker: { dp: 10, auto: 0 },
            target: { id: 'p1' },
            defense: { dp: 4, auto: 1 },
            defenseByST: true
        });
        const d = detail();
        assert.strictEqual(d.defenseByST, true);
        assert.ok(labels(d.def.parts).includes('ST 代填'), `防禦來源應標示 ST 代填：${labels(d.def.parts)}`);
    });

    test('玩家自填防禦：明細標示為玩家填報', () => {
        resetCaptures();
        sandbox.state.units = [{ id: 'p1', type: 'player', status: {} }];
        bbRunBlackBoxCalculation({
            attacker: { dp: 10, auto: 0 },
            target: { id: 'p1' },
            defense: { dp: 4, auto: 1 }
        });
        assert.ok(labels(detail().def.parts).includes('玩家填報'));
    });

    test('狀態修正計入明細，且分項相加仍等於合計', () => {
        resetCaptures();
        // 麻痺對攻防都有 calcMod，用它驗證狀態修正確實被列出且不破壞加總
        sandbox.state.units = [
            { id: 'me', type: 'player', status: {} },
            { id: 'boss', type: 'enemy', defDp: 10, defAuto: 0, status: { '麻痺': 2 } }
        ];
        bbRunBlackBoxCalculation({
            attacker: { dp: 12, auto: 0, unitId: 'me' },
            target: { id: 'boss' },
            defense: null
        });
        const d = detail();
        assert.strictEqual(sumParts(d.def.parts), d.def.total,
            `分項(${sumParts(d.def.parts)}) 應等於合計(${d.def.total})：${labels(d.def.parts)}`);
    });
})();

// ====================================================================
console.log('\n[轉義] escapeJsAttr：含單引號的曲名／玩家代號不會弄壞 onclick');
// ====================================================================
(function () {
    const uSandbox = { console, String, Object };
    vm.createContext(uSandbox);
    vm.runInContext(readSource('src/utils/utils.js') + '\n;\nvar __u = { escapeHtml, escapeJsAttr };',
        uSandbox, { filename: 'utils.js' });
    const { escapeHtml, escapeJsAttr } = uSandbox.__u;

    // 模擬瀏覽器解析 onclick 屬性：先做 HTML 實體解碼，再交給 JS 解析
    const decodeAttr = (s) => s
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

    test('escapeHtml 用於 JS 字串會被屬性解碼破壞（記錄舊行為，說明為何需要新函式）', () => {
        const attr = `f('${escapeHtml("Don't Stop")}')`;
        const decoded = decodeAttr(attr);
        assert.strictEqual(decoded, "f('Don't Stop')", '解碼後單引號提前結束字串');
        assert.throws(() => new Function(decoded), '這段 JS 是語法錯誤，按鈕會整個失效');
    });

    test('escapeJsAttr：單引號經屬性解碼後仍是合法的 JS 字串', () => {
        const attr = `f('${escapeJsAttr("Don't Stop")}')`;
        const decoded = decodeAttr(attr);
        assert.doesNotThrow(() => new Function('f', decoded), '應為合法 JS');
        let got = null;
        new Function('f', decoded)((v) => { got = v; });
        assert.strictEqual(got, "Don't Stop", '傳進函式的值應與原文完全一致');
    });

    test('escapeJsAttr：反斜線、雙引號、換行與 HTML 特殊字元都還原成原文', () => {
        const raw = `a\\b "q" <img> & 'x'\nnext`;
        const decoded = decodeAttr(`f('${escapeJsAttr(raw)}')`);
        let got = null;
        new Function('f', decoded)((v) => { got = v; });
        assert.strictEqual(got, raw);
    });

    test('escapeJsAttr：無法藉由收尾引號注入額外程式碼', () => {
        const raw = "'); alert(1); ('";
        const decoded = decodeAttr(`f('${escapeJsAttr(raw)}')`);
        let calls = 0, got = null;
        new Function('f', decoded)((v) => { calls++; got = v; });
        assert.strictEqual(calls, 1, '只應呼叫一次，注入的敘述不得執行');
        assert.strictEqual(got, raw, '整段應被當成單純的字串內容');
    });

    test('escapeJsAttr：null／undefined／數字都安全處理', () => {
        assert.strictEqual(escapeJsAttr(null), '');
        assert.strictEqual(escapeJsAttr(undefined), '');
        assert.strictEqual(escapeJsAttr(42), '42');
    });
})();

// ====================================================================
console.log('\n[頭像] safeAvatarSrc：只放行本站產生的 base64 圖片');
// ====================================================================
(function () {
    const uSandbox = { console, String, Object };
    vm.createContext(uSandbox);
    vm.runInContext(readSource('src/utils/utils.js') + '\n;\nvar __u = { safeAvatarSrc };',
        uSandbox, { filename: 'utils.js' });
    const { safeAvatarSrc } = uSandbox.__u;

    test('放行 processAvatarImage() 實際產出的 JPEG data URL', () => {
        const real = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ==';
        assert.strictEqual(safeAvatarSrc(real), real);
    });

    test('放行 PNG／WebP 等其他 base64 圖片子型別', () => {
        const png = 'data:image/png;base64,iVBORw0KGgo=';
        const webp = 'data:image/webp;base64,UklGRg==';
        assert.strictEqual(safeAvatarSrc(png), png);
        assert.strictEqual(safeAvatarSrc(webp), webp);
    });

    test('擋下可脫出 style 屬性、注入標籤的頭像字串（儲存型 XSS）', () => {
        const payload = "x'></span><img src=x onerror=alert(1)><span class='";
        assert.strictEqual(safeAvatarSrc(payload), '', '不合法時應回傳空字串，讓呼叫端退回文字頭像');
        // 即使前綴偽裝成合法 data URL，尾端帶引號仍應被擋下
        assert.strictEqual(safeAvatarSrc("data:image/png;base64,AAA'></span><img src=x onerror=alert(1)>"), '');
    });

    test('擋下可在 inline style 追加 CSS 宣告的頭像字串', () => {
        assert.strictEqual(safeAvatarSrc('a); background: url(//evil.example/x'), '');
        assert.strictEqual(safeAvatarSrc('data:image/png;base64,AAA); color:red;('), '');
    });

    test('擋下外部網址與非字串輸入（頭像一律是本站自產的 base64）', () => {
        assert.strictEqual(safeAvatarSrc('https://evil.example/a.png'), '');
        assert.strictEqual(safeAvatarSrc('javascript:alert(1)'), '');
        assert.strictEqual(safeAvatarSrc(null), '');
        assert.strictEqual(safeAvatarSrc(undefined), '');
        assert.strictEqual(safeAvatarSrc({}), '');
    });
})();

// ====================================================================
console.log('\n[行動軸] taUnitFaceHtml：惡意頭像字串不能脫出 style 屬性注入標籤');
// ====================================================================
(function () {
    const taSandbox = {
        console, String, Object, Array, Math, JSON, Number, parseInt, parseFloat,
        setTimeout, clearTimeout,
        document: {
            getElementById: () => null,
            querySelector: () => null,
            createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }),
            addEventListener() {}
        },
        window: undefined,
        state: { units: [] }
    };
    vm.createContext(taSandbox);
    // taUnitFaceHtml 需要 utils.js 的 escapeHtml / safeAvatarSrc，與瀏覽器一樣串接載入
    const combinedTa = [readSource('src/utils/utils.js'), readSource('src/ui/turn-axis.js')].join('\n;\n')
        + '\n;\nvar __t = { taUnitFaceHtml };';
    vm.runInContext(combinedTa, taSandbox, { filename: 'utils+turn-axis.js' });
    const { taUnitFaceHtml } = taSandbox.__t;

    test('合法 base64 頭像照常輸出背景圖', () => {
        const png = 'data:image/png;base64,iVBORw0KGgo=';
        const html = taUnitFaceHtml({ name: '阿爾法', avatar: png }, 'tc-face');
        assert.ok(html.includes(`url('${png}')`), '應輸出背景圖：' + html);
    });

    test('帶雙引號的頭像會脫出 style="..."（記錄舊行為，說明為何要過濾）', () => {
        // 這段字串沒有經過過濾時，產出的 HTML 會是：
        //   <span class="tc-face" style="background-image:url('x"><img ...>')"></span>
        // 雙引號提前關掉 style 屬性、`>` 關掉 span，之後的 <img onerror=...> 就成了真正的標籤。
        const payload = 'x"><img src=q onerror=alert(1)>';
        const unfiltered = `<span class="tc-face" style="background-image:url('${payload}')"></span>`;
        assert.ok(unfiltered.includes('"><img'), '未過濾時確實會脫出屬性');
    });

    test('惡意頭像被擋下，退回文字頭像且不含任何標籤片段', () => {
        const html = taUnitFaceHtml({ name: 'evil', avatar: 'x"><img src=q onerror=alert(1)>' }, 'tc-face');
        assert.ok(!html.includes('<img'), '不得含有注入的 <img>：' + html);
        assert.ok(!html.includes('onerror'), '不得含有事件處理器：' + html);
        assert.ok(html.includes('tc-face-text'), '應退回文字頭像：' + html);
    });

    test('單引號、括號、外部網址等頭像同樣退回文字頭像', () => {
        for (const bad of ["x'></span><b>", 'a); background:url(//evil.example/x', 'https://evil.example/a.png']) {
            const html = taUnitFaceHtml({ name: 'evil', avatar: bad }, 'tc-face');
            assert.ok(html.includes('tc-face-text'), `應退回文字頭像（${bad}）：` + html);
            assert.ok(!html.includes('background-image'), `不得輸出背景圖（${bad}）：` + html);
        }
    });
})();

// ====================================================================
console.log('\n[人格卡] idtDeclareHasCost：沒有我方單位時也不能整個面板開不起來');
// ====================================================================
(function () {
    const idtSandbox = {
        console, String, Object, Array, Math, JSON, Number, parseInt, parseFloat, isNaN,
        setTimeout, clearTimeout,
        document: {
            getElementById: () => null,
            querySelector: () => null,
            createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }),
            addEventListener() {},
            head: { appendChild() {} },
            body: { appendChild() {} }
        },
        window: undefined,
        state: { units: [] }
    };
    vm.createContext(idtSandbox);
    vm.runInContext(readSource('src/ui/identity-hud.js') + '\n;\nvar __i = { idtDeclareHasCost };',
        idtSandbox, { filename: 'identity-hud.js' });
    const { idtDeclareHasCost } = idtSandbox.__i;

    // renderIdentityActiveSkills() 在「尚未指定我方單位」時不會呼叫 idtPlanDeclareCost()，
    // 而是自行組一份簡化的 plan；先前它少了 selfCost／poolCost／targetCost，
    // 於是 Object.keys(undefined) 丟出 TypeError，整個人格卡引擎面板都打不開。
    test('簡化 plan（沒有 selfCost／poolCost／targetCost 欄位）不丟例外', () => {
        const plan = { affordable: false, blockers: ['尚未指定我方單位'], costParts: [] };
        assert.doesNotThrow(() => idtDeclareHasCost(plan));
        assert.strictEqual(idtDeclareHasCost(plan), false, '沒有任何成本欄位 → 不需要二次確認');
    });

    test('null／undefined plan 也安全處理', () => {
        assert.strictEqual(idtDeclareHasCost(null), false);
        assert.strictEqual(idtDeclareHasCost(undefined), false);
    });

    test('完整 plan：任一成本桶有內容就需要二次確認', () => {
        const base = { selfCost: {}, poolCost: {}, targetCost: {}, selfHp: null };
        assert.strictEqual(idtDeclareHasCost(base), false, '完全沒有成本 → 不確認');
        assert.strictEqual(idtDeclareHasCost({ ...base, selfCost: { tremor: 3 } }), true);
        assert.strictEqual(idtDeclareHasCost({ ...base, poolCost: { charge: 2 } }), true);
        assert.strictEqual(idtDeclareHasCost({ ...base, targetCost: { rupture: 1 } }), true);
    });

    test('自傷成本：amount 大於 0 才需要二次確認', () => {
        const base = { selfCost: {}, poolCost: {}, targetCost: {} };
        assert.strictEqual(idtDeclareHasCost({ ...base, selfHp: { type: 'a', amount: 0 } }), false);
        assert.strictEqual(idtDeclareHasCost({ ...base, selfHp: { type: 'a', amount: 4 } }), true);
    });
})();

// ===== 結算 =====
console.log(`\n結果：${passed} 通過，${failed} 失敗\n`);
process.exit(failed ? 1 : 0);
