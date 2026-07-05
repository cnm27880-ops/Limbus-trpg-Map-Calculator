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
    // ero-absorber 現在是「複選 chip」容器（見 erosion-hud.js eroGetSelectedValues），
    // 以 querySelectorAll('input:checked') 讀取，故 stub 也改為同一介面。
    domTable['ero-absorber'] = { querySelectorAll: () => [{ value: 'hero' }] };
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
        state: { isCombatActive: true },
    };
    vm.createContext(mvSandbox);
    const mvCombined = ['src/utils/utils.js', 'src/ui/map.js'].map(f => readSource(f)).join('\n;\n')
        + '\n;\nvar __mv = { calcTacticalCost, getUnitMaxMoveGrids, getUnitMoveRemaining, calcRulerDistance, applyMoveCost };';
    vm.runInContext(mvCombined, mvSandbox, { filename: 'combined-move-sources.js' });
    const { calcTacticalCost, getUnitMaxMoveGrids, getUnitMoveRemaining, calcRulerDistance, applyMoveCost } = mvSandbox.__mv;

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

// ===== 結算 =====
console.log(`\n結果：${passed} 通過，${failed} 失敗\n`);
process.exit(failed ? 1 : 0);
