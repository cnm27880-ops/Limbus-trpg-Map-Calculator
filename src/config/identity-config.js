/**
 * Limbus Command - 人格卡牌資料庫（Identity Library）
 *
 * 設計理念：
 *  1. 每張人格卡（Identity）不採用固定技能欄位，而是以「事件掛鉤（hooks）」分類，
 *     讓未來新增卡片時只要往對應 hook 陣列塞物件即可，毋須改動運算引擎。
 *  2. hooks 分類：
 *       - onAttack ：攻擊宣告／攻擊檢定前，計算 DP 加值。
 *       - onHit    ：命中後結算，對目標或自身施加狀態點數。
 *       - onKill   ：擊殺或使目標昏迷時觸發。
 *       - onActive ：主動宣告技（玩家自行宣告才生效），僅保存描述與邏輯資料。
 *  3. 「重複抽取解鎖」的第三技能：相關 hook 標記 `locked: true`。
 *     引擎預設「未解鎖」不納入計算；玩家於 UI 勾選解鎖後才會被計入（見 identity-engine.js）。
 *  4. 同一張卡的一技能與二技能皆為「疊加」而非「覆蓋」——
 *     因為每條規則都是獨立 hook，引擎會逐條累加，自然達成疊加效果。
 *
 * 狀態鍵名約定（自包含的抽象狀態，與 status-config 的中文名解耦）：
 *  depression=沮喪、swiftness=迅捷、bleed=流血、weak=虛弱、burn=燃燒…
 *  條件函式以 (target, attacker) 形式取得雙方狀態，例如 target.status.depression。
 *
 * 註：早期人格卡敘述中「施加 XX 點數需進行豁免對抗」之設定已透過公告移除，
 *     本資料庫一律視為「直接施加點數」，不記錄任何豁免欄位。
 */

// ===== Hook 物件結構參考 =====
// onAttack: { condition: (target, attacker) => boolean, dpBonus: number, source: string, skill?: string, locked?: boolean }
// onHit   : { condition: (target, attacker) => boolean, targetStatus?: {key:num}, selfStatus?: {key:num}, source: string, skill?: string, locked?: boolean }
// onKill  : { condition: (target, attacker) => boolean, targetStatus?: {key:num}, scope?: 'others'|'target', source: string, locked?: boolean, desc?: string }
// onActive: { name: string, source: string, desc: string, locked?: boolean, effect?: object }

const IDENTITY_LIBRARY = {
    // ========================================================================
    // 格里高爾 - 埃德加家族繼承人
    //   技能：① 長劍劈砍 ② 延續進攻 ③ 噩夢狩獵【重複抽取解鎖】
    //   主軸狀態：沮喪（depression）/ 迅捷（swiftness）
    // ========================================================================
    gregor_edgar: {
        id: 'gregor_edgar',
        name: '格里高爾 - 埃德加家族繼承人',
        owner: '格里高爾',
        // 第三技能（重複抽取解鎖）的名稱，供 UI 產生勾選按鍵時參考
        repeatUnlockSkill: '噩夢狩獵',
        keyStatuses: ['depression', 'swiftness'],

        hooks: {
            // ---- 攻擊前：依目標【沮喪】層數累加 DP ----
            // 長劍劈砍：3 點以上 +3 DP；6 點以上「改為 +6」→ 以兩條獨立 hook 疊加實現
            //   （沮喪 3~5 → +3；沮喪 6+ → +3 再 +3 = +6，符合原文「改為 +6」）
            onAttack: [
                {
                    condition: (target) => (target.status.depression || 0) >= 3,
                    dpBonus: 3,
                    source: '長劍劈砍',
                    skill: '長劍劈砍'
                },
                {
                    condition: (target) => (target.status.depression || 0) >= 6,
                    dpBonus: 3,
                    source: '長劍劈砍（6 點以上提升）',
                    skill: '長劍劈砍'
                },
                // 延續進攻：6 點以上再 +3 DP
                {
                    condition: (target) => (target.status.depression || 0) >= 6,
                    dpBonus: 3,
                    source: '延續進攻',
                    skill: '延續進攻'
                },
                // 噩夢狩獵【重複抽取解鎖】：10 點以上再 +3 DP
                {
                    condition: (target) => (target.status.depression || 0) >= 10,
                    dpBonus: 3,
                    source: '噩夢狩獵',
                    skill: '噩夢狩獵',
                    locked: true
                }
            ],

            // ---- 命中後：施加狀態點數 ----
            onHit: [
                // 長劍劈砍：命中施加 3 點沮喪
                {
                    condition: () => true,
                    targetStatus: { depression: 3 },
                    source: '長劍劈砍',
                    skill: '長劍劈砍'
                },
                // 延續進攻：命中施加 3 點沮喪
                {
                    condition: () => true,
                    targetStatus: { depression: 3 },
                    source: '延續進攻',
                    skill: '延續進攻'
                },
                // 延續進攻：命中時目標帶有 7 點以上沮喪 → 自身獲得 1 層迅捷
                {
                    condition: (target) => (target.status.depression || 0) >= 7,
                    selfStatus: { swiftness: 1 },
                    source: '延續進攻',
                    skill: '延續進攻'
                },
                // 噩夢狩獵【重複抽取解鎖】：命中施加 3 點沮喪
                {
                    condition: () => true,
                    targetStatus: { depression: 3 },
                    source: '噩夢狩獵',
                    skill: '噩夢狩獵',
                    locked: true
                }
            ],

            // ---- 擊殺／昏迷：對戰場其他敵方單位施加沮喪 ----
            onKill: [
                // 噩夢狩獵【重複抽取解鎖】：擊殺或使目標昏迷時，對其他敵方單位施加 3 點沮喪
                {
                    condition: () => true,
                    targetStatus: { depression: 3 },
                    scope: 'others',
                    source: '噩夢狩獵',
                    skill: '噩夢狩獵',
                    locked: true,
                    desc: '當你的攻擊導致目標陷入昏迷或擊殺目標時，對戰場上其他敵方單位施加 3 點沮喪。'
                }
            ],

            // ---- 主動宣告技：噩夢吞噬 ----
            onActive: [
                {
                    name: '噩夢吞噬',
                    source: '噩夢狩獵',
                    skill: '噩夢狩獵',
                    locked: true,
                    desc: '命中目標時可宣告發動：吸收目標身上的 10 點沮喪點數。你在下一回合的攻擊檢定獲得 +2 附加成功，且武器傷害 +3。' +
                          '（發動吞噬時擲 1D10，若擲出 8–10，則本次吞噬不扣除目標的沮喪點數，但你依然獲得上述強化效果。）',
                    effect: {
                        // 吸收目標沮喪點數
                        absorbTargetStatus: { depression: 10 },
                        // 下一回合的強化
                        nextTurnBonus: { extraSuccess: 2, weaponDamage: 3 },
                        // 擲骰判定是否扣除目標點數
                        gambit: { dice: '1D10', keepTargetStatusOn: [8, 9, 10] }
                    }
                }
            ]
        }
    }

    // ── 新增更多人格卡時，依照上方結構往這裡擴充即可。 ──
    // 例如：gregor_blackcloud（格里高爾-黑雲會副會長）、otis_cinq…
    // 同名角色（owner）視為同一名玩家所擁有的不同人格卡。
};

// ===== 輔助函數 =====

/**
 * 依 ID 取得人格卡定義
 * @param {string} identityId
 * @returns {object|null}
 */
function getIdentityById(identityId) {
    return IDENTITY_LIBRARY[identityId] || null;
}

/**
 * 取得所有人格卡（扁平陣列）
 * @returns {Array<object>}
 */
function getAllIdentities() {
    return Object.values(IDENTITY_LIBRARY);
}

/**
 * 依角色（owner）取得其名下所有人格卡 ID
 * 同名角色視為同一名玩家所擁有
 * @param {string} owner - 角色名稱，例如 '格里高爾'
 * @returns {Array<string>}
 */
function getIdentitiesByOwner(owner) {
    return Object.values(IDENTITY_LIBRARY)
        .filter(card => card.owner === owner)
        .map(card => card.id);
}

console.log('🃏 人格卡牌資料庫已載入');
