/**
 * Limbus Command - 人格卡牌資料庫（Identity Library）
 *
 * 設計理念：
 *  1. 每張人格卡（Identity）不採用固定技能欄位，而是以「事件掛鉤（hooks）」分類，
 *     讓未來新增卡片時只要往對應 hook 陣列塞物件即可，毋須改動運算引擎。
 *  2. hooks 分類：
 *       - onTurnStart：回合開始時的資源獲取（呼吸法、人民之盾、充能…）。
 *       - onAttack   ：攻擊宣告／攻擊檢定前，計算 DP・武器傷害・附加成功・威力等加值，
 *                      也可在此獲取自身資源（如宣告攻擊獲得充能）。
 *       - onHit      ：命中後結算，對目標或自身施加狀態點數／加值。
 *       - onKill     ：擊殺或使目標昏迷時觸發。
 *       - onActive   ：主動宣告技（玩家自行宣告才生效），保存描述與邏輯資料。
 *  3. 「重複抽取解鎖」的第三技能：相關 hook 標記 `locked: true`。
 *     引擎預設「未解鎖」不納入計算；玩家於 UI 勾選解鎖後才會被計入（見 identity-engine.js）。
 *  4. 同一張卡的一技能與二技能皆為「疊加」而非「覆蓋」——
 *     因為每條規則都是獨立 hook，引擎會逐條累加，自然達成疊加效果。
 *  5. 需要擲骰、指定友軍、複雜結算等「無法純數值自動化」的效果，
 *     標記 `manual: true` 並附 `desc`；引擎不自動計入，但資料保留供 UI 顯示。
 *
 * 數值欄位（onAttack / onHit 內，數字或函式 (target, attacker) => number 皆可）：
 *   dpBonus（DP）、weaponDamage（武器傷害）、extraSuccess（附加成功）、
 *   spellPower（法術威力值）、finalDamage（最終／額外傷害）。
 *
 * 狀態鍵名約定（自包含的抽象狀態，與 status-config 的中文名解耦）：
 *   depression 沮喪、swiftness 迅捷、bleed 流血、weak 虛弱、burn 燃燒、
 *   charge 充能、rupture 破裂、tremor 震顫、breathing 呼吸法、shield 人民之盾、
 *   loveHate 愛/憎、arcana 魔法阿卡納、commandProtect 指令加護、karma 業、
 *   gale 疾風、sinking 沉淪、knowledge 學識、trueKnowledge 所解真知、
 *   bind 束縛、provoke 挑釁、paralyze 麻痺、stun 暈眩、flaw 破綻、
 *   defenseDown 防禦等級降低、nails 尖釘、echo 山莊的回響、
 *   commandTarget 指令對象、duelOtis 決鬥宣告-奧提斯、duelDon 決鬥宣告-唐吉訶德。
 *
 * 攻擊者欄位約定（依卡片需求，由呼叫端提供）：
 *   initiative（先攻值）、initiativeRank（先攻序位，1 為最快）、severeFull（嚴重生命槽已滿）。
 *
 * 註：早期人格卡敘述中「施加 XX 點數需進行豁免對抗」之設定已透過公告移除，
 *     本資料庫一律視為「直接施加點數」，不記錄任何豁免欄位。
 */

/**
 * 引擎狀態鍵名（英文）對應到狀態庫（status-config.js）的狀態 id。
 * 多數同名，僅少數既有狀態 id 不同（破裂=fragile、呼吸法=poise、指令加護/對象=command_*）。
 * 供 UI 串接時：讀取單位中文狀態 → 引擎英文鍵；引擎輸出英文鍵 → 套用回單位。
 */
const IDENTITY_STATUS_KEYMAP = {
    depression: 'depression', swiftness: 'swiftness', bleed: 'bleed', weak: 'weak',
    burn: 'burn', charge: 'charge', rupture: 'fragile', tremor: 'tremor',
    breathing: 'poise', shield: 'shield', loveHate: 'loveHate', arcana: 'arcana',
    commandProtect: 'command_protect', karma: 'karma', gale: 'gale', sinking: 'sinking',
    knowledge: 'knowledge', trueKnowledge: 'trueKnowledge', bind: 'bind', provoke: 'provoke',
    paralyze: 'paralyze', stun: 'stun', flaw: 'flaw', defenseDown: 'defenseDown',
    nails: 'nails', echo: 'echo', commandTarget: 'command_target',
    duelOtis: 'duelOtis', duelDon: 'duelDon', vulnerable: 'vulnerable'
};

const IDENTITY_LIBRARY = {

    // ========================================================================
    // 格里高爾（Gregor）
    // ========================================================================

    // 格里高爾 - 埃德加家族繼承人 ── 沮喪 / 迅捷
    gregor_edgar: {
        id: 'gregor_edgar',
        name: '格里高爾 - 埃德加家族繼承人',
        owner: '格里高爾',
        repeatUnlockSkill: '噩夢狩獵',
        keyStatuses: ['depression', 'swiftness'],
        hooks: {
            onAttack: [
                // 長劍劈砍：沮喪 3+ → +3 DP；6+「改為 +6」→ 以兩條疊加 hook 實現（6+ 時 3+3=6）
                { condition: (t) => (t.status.depression || 0) >= 3, dpBonus: 3, source: '長劍劈砍', skill: '長劍劈砍' },
                { condition: (t) => (t.status.depression || 0) >= 6, dpBonus: 3, source: '長劍劈砍（6 點以上提升）', skill: '長劍劈砍' },
                // 延續進攻：沮喪 6+ 再 +3 DP
                { condition: (t) => (t.status.depression || 0) >= 6, dpBonus: 3, source: '延續進攻', skill: '延續進攻' },
                // 噩夢狩獵【重複抽取解鎖】：沮喪 10+ 再 +3 DP
                { condition: (t) => (t.status.depression || 0) >= 10, dpBonus: 3, source: '噩夢狩獵', skill: '噩夢狩獵', locked: true }
            ],
            onHit: [
                { condition: () => true, targetStatus: { depression: 3 }, source: '長劍劈砍', skill: '長劍劈砍' },
                { condition: () => true, targetStatus: { depression: 3 }, source: '延續進攻', skill: '延續進攻' },
                { condition: (t) => (t.status.depression || 0) >= 7, selfStatus: { swiftness: 1 }, source: '延續進攻', skill: '延續進攻' },
                { condition: () => true, targetStatus: { depression: 3 }, source: '噩夢狩獵', skill: '噩夢狩獵', locked: true }
            ],
            onKill: [
                { condition: () => true, targetStatus: { depression: 3 }, scope: 'others', source: '噩夢狩獵', skill: '噩夢狩獵', locked: true,
                  desc: '擊殺或使目標昏迷時，對戰場上其他敵方單位施加 3 點沮喪。' }
            ],
            onActive: [
                { name: '噩夢吞噬', source: '噩夢狩獵', skill: '噩夢狩獵', locked: true,
                  desc: '命中時可宣告：吸收目標 10 點沮喪。下一回合攻擊檢定 +2 附加成功、武器傷害 +3。擲 1D10，8–10 則本次不扣除目標沮喪但仍獲強化。',
                  effect: { absorbTargetStatus: { depression: 10 }, nextTurnBonus: { extraSuccess: 2, weaponDamage: 3 }, gambit: { dice: '1D10', keepTargetStatusOn: [8, 9, 10] } } }
            ]
        }
    },

    // 格里高爾 - 黑雲會副會長 ── 流血 / 虛弱
    gregor_blackcloud: {
        id: 'gregor_blackcloud',
        name: '格里高爾 - 黑雲會副會長',
        owner: '格里高爾',
        repeatUnlockSkill: '墨雲崩裂',
        keyStatuses: ['bleed', 'weak'],
        hooks: {
            onAttack: [
                { condition: (t) => (t.status.bleed || 0) >= 7, dpBonus: 2, source: '雲渦撕裂', skill: '雲渦撕裂' },
                { condition: (t) => (t.status.bleed || 0) >= 7, dpBonus: 2, source: '墨雲', skill: '墨雲' },
                { condition: (t) => (t.status.bleed || 0) >= 10, dpBonus: 2, weaponDamage: 2, source: '墨雲崩裂', skill: '墨雲崩裂', locked: true }
            ],
            onHit: [
                { condition: () => true, targetStatus: { bleed: 2 }, source: '雲渦撕裂', skill: '雲渦撕裂' },
                { condition: () => true, targetStatus: { bleed: 2 }, source: '墨雲', skill: '墨雲' },
                { condition: (t) => (t.status.bleed || 0) >= 7, targetStatus: { weak: 1 }, source: '墨雲', skill: '墨雲' },
                { condition: (t) => (t.status.bleed || 0) >= 10, targetStatus: { weak: 1 }, source: '墨雲（10 層以上）', skill: '墨雲' },
                { condition: () => true, targetStatus: { bleed: 3, weak: 2 }, source: '墨雲崩裂', skill: '墨雲崩裂', locked: true },
                { condition: (t) => (t.status.bleed || 0) >= 10, manual: true, source: '墨雲崩裂', skill: '墨雲崩裂', locked: true,
                  desc: '流血 10+ 使目標下次攻擊減少 1 點附加成功；13+ 再減 1。' }
            ]
        }
    },

    // 格里高爾 - 六協會南部6科 ── 燃燒
    gregor_south6: {
        id: 'gregor_south6',
        name: '格里高爾 - 六協會南部6科',
        owner: '格里高爾',
        repeatUnlockSkill: '萬鍛連掌',
        keyStatuses: ['burn'],
        hooks: {
            onAttack: [
                { condition: (t) => (t.status.burn || 0) >= 6, dpBonus: 3, source: '封喉一刺', skill: '封喉一刺' },
                { condition: (t) => (t.status.burn || 0) >= 12, dpBonus: 3, source: '破竹之勢', skill: '破竹之勢' },
                { condition: (t) => (t.status.burn || 0) >= 12, weaponDamage: 3, source: '萬鍛連掌', skill: '萬鍛連掌', locked: true }
            ],
            onHit: [
                { condition: () => true, targetStatus: { burn: 3 }, source: '封喉一刺', skill: '封喉一刺' },
                { condition: () => true, targetStatus: { burn: 3 }, source: '破竹之勢', skill: '破竹之勢' },
                { condition: () => true, targetStatus: { burn: 4 }, source: '萬鍛連掌', skill: '萬鍛連掌', locked: true }
            ]
        }
    },

    // 格里高爾 - 玫瑰扳手工坊收尾人 ── 充能 / 破裂 / 震顫
    gregor_rosewrench: {
        id: 'gregor_rosewrench',
        name: '格里高爾 - 玫瑰扳手工坊收尾人',
        owner: '格里高爾',
        repeatUnlockSkill: '都切碎吧',
        keyStatuses: ['charge', 'rupture', 'tremor'],
        hooks: {
            onAttack: [
                // 宣告攻擊獲得充能（自身資源）
                { condition: () => true, selfStatus: { charge: 3 }, source: '發動引擎', skill: '發動引擎' },
                { condition: () => true, selfStatus: { charge: 3 }, source: '潤滑鏈鋸', skill: '潤滑鏈鋸' },
                // 都切碎吧：震顫 5+ → +3 DP，並額外施加 3 層破裂
                { condition: (t) => (t.status.tremor || 0) >= 5, dpBonus: 3, targetStatus: { rupture: 3 }, source: '都切碎吧', skill: '都切碎吧', locked: true }
            ],
            onHit: [
                { condition: () => true, targetStatus: { rupture: 2 }, source: '發動引擎', skill: '發動引擎' },
                { condition: (t) => (t.status.tremor || 0) >= 5, targetStatus: { rupture: 3 }, source: '發動引擎（震顫 5+）', skill: '發動引擎' },
                { condition: () => true, targetStatus: { tremor: 2 }, source: '潤滑鏈鋸', skill: '潤滑鏈鋸' },
                { condition: () => true, targetStatus: { rupture: 2 }, source: '潤滑鏈鋸', skill: '潤滑鏈鋸' },
                { condition: () => true, targetStatus: { rupture: 2 }, source: '都切碎吧', skill: '都切碎吧', locked: true },
                { condition: () => true, manual: true, source: '都切碎吧', skill: '都切碎吧', locked: true,
                  desc: '若目標具有惡性 A 傷，本次攻擊武器傷害 +3。' }
            ],
            onActive: [
                { name: '超載 2 - 輕度運轉', source: '發動引擎', skill: '發動引擎',
                  desc: '攻擊前宣告消耗 2 層充能，本次攻擊 DP +2。', effect: { cost: { charge: 2 }, dpBonus: 2 } },
                { name: '超載 5 - 齒輪加速', source: '潤滑鏈鋸', skill: '潤滑鏈鋸',
                  desc: '攻擊前宣告消耗 5 層充能，本次攻擊 DP +7。', effect: { cost: { charge: 5 }, dpBonus: 7 } },
                { name: '震顫引爆', source: '都切碎吧', skill: '都切碎吧', locked: true,
                  desc: '命中時宣告：立即結算一次震顫削減，隨後目標震顫僅減少 2 層而非全清；每回合限一次。' }
            ]
        }
    },

    // ========================================================================
    // 奧提斯（Otis）
    // ========================================================================

    // 奧提斯 - Cinq 協會南部4科 ── 決鬥宣告 / 迅捷 / 挑釁 / 呼吸法
    otis_cinq: {
        id: 'otis_cinq',
        name: '奧提斯 - Cinq 協會南部4科',
        owner: '奧提斯',
        repeatUnlockSkill: '騰躍長刺',
        keyStatuses: ['duelOtis', 'swiftness', 'provoke', 'breathing'],
        hooks: {
            onAttack: [
                // 決鬥宣告：對標記目標 +3 DP 完美加值
                { condition: (t) => (t.status.duelOtis || 0) > 0, dpBonus: 3, source: '決鬥宣告 - 奧提斯', skill: '（被動）' },
                // 前進：宣告攻擊獲得 2 迅捷（每回合一次）
                { condition: () => true, selfStatus: { swiftness: 2 }, source: '前進（每回合一次）', skill: '前進' },
                // 懲罰：先攻高於目標 → +4 DP
                { condition: (t, a) => (a.initiative || 0) > (t.initiative || 0), dpBonus: 4, source: '懲罰', skill: '懲罰' },
                // 騰躍長刺：呼吸法 9+ → +4 DP、武器傷害 +3
                { condition: (t, a) => (a.status.breathing || 0) >= 9, dpBonus: 4, weaponDamage: 3, source: '騰躍長刺', skill: '騰躍長刺', locked: true }
            ],
            onHit: [
                { condition: () => true, selfStatus: { breathing: 2 }, source: '前進', skill: '前進' },
                { condition: () => true, targetStatus: { provoke: 2 }, source: '前進', skill: '前進' },
                { condition: () => true, selfStatus: { breathing: 2 }, source: '懲罰', skill: '懲罰' },
                { condition: () => true, targetStatus: { provoke: 4 }, source: '懲罰', skill: '懲罰' },
                { condition: () => true, targetStatus: { duelOtis: 1 }, source: '騰躍長刺', skill: '騰躍長刺', locked: true },
                { condition: () => true, manual: true, source: '騰躍長刺', skill: '騰躍長刺', locked: true,
                  desc: '使我方戰場上先攻值最低的兩名友方單位，立即獲得 2 層迅捷。' }
            ]
        }
    },

    // 奧提斯 - 呼嘯山莊首席管家 ── 沮喪 / 山莊的回響
    otis_wuthering: {
        id: 'otis_wuthering',
        name: '奧提斯 - 呼嘯山莊首席管家',
        owner: '奧提斯',
        repeatUnlockSkill: '遵夫人之命',
        keyStatuses: ['depression', 'echo'],
        hooks: {
            onAttack: [
                { condition: (t) => (t.status.depression || 0) >= 3, dpBonus: 2, source: '敲擊', skill: '敲擊' },
                { condition: (t) => (t.status.depression || 0) >= 5, dpBonus: 2, source: '撣塵', skill: '撣塵' },
                { condition: (t) => (t.status.depression || 0) >= 7, dpBonus: 3, source: '遵夫人之命', skill: '遵夫人之命', locked: true }
            ],
            onHit: [
                { condition: () => true, targetStatus: { depression: 2 }, source: '敲擊', skill: '敲擊' },
                { condition: () => true, targetStatus: { depression: 5 }, source: '撣塵', skill: '撣塵' },
                { condition: () => true, targetStatus: { echo: 1 }, source: '遵夫人之命', skill: '遵夫人之命', locked: true }
            ],
            onActive: [
                { name: '回響引爆', source: '遵夫人之命', skill: '遵夫人之命', locked: true,
                  desc: '命中時若目標帶有山莊的回響：目標額外受到等同其沮喪點數的精神傷害（忽略一般物理減免），結算後回響消失、沮喪點數減半。' }
            ]
        }
    },

    // 奧提斯 - G 公司部長 ── 沮喪（並提供友軍增益）
    otis_gcompany: {
        id: 'otis_gcompany',
        name: '奧提斯 - G 公司部長',
        owner: '奧提斯',
        repeatUnlockSkill: '懾敵氣勢',
        keyStatuses: ['depression'],
        hooks: {
            onAttack: [
                { condition: (t) => (t.status.depression || 0) >= 4, dpBonus: 2, source: '戰術指揮', skill: '戰術指揮' },
                { condition: (t) => (t.status.depression || 0) >= 7, dpBonus: 2, source: '攻擊命令', skill: '攻擊命令' },
                { condition: (t) => (t.status.depression || 0) >= 10, dpBonus: 3, source: '懾敵氣勢', skill: '懾敵氣勢', locked: true }
            ],
            onHit: [
                { condition: () => true, manual: true, source: '戰術指揮', skill: '戰術指揮', desc: '使我方先攻值最低的一名友方單位獲得 2 層不屈，可疊加。' },
                { condition: () => true, manual: true, source: '攻擊命令', skill: '攻擊命令', desc: '使我方先攻值最低的一名友方單位獲得 2 層強壯，可疊加。' },
                { condition: () => true, targetStatus: { depression: 5 }, source: '懾敵氣勢', skill: '懾敵氣勢', locked: true },
                { condition: () => true, manual: true, source: '懾敵氣勢', skill: '懾敵氣勢', locked: true, desc: '近戰攻擊若骰中三個以上的 10，額外施加 4 點沮喪。' }
            ]
        }
    },

    // 奧提斯 - 劍契組殺手 ── 呼吸法
    otis_swordpact: {
        id: 'otis_swordpact',
        name: '奧提斯 - 劍契組殺手',
        owner: '奧提斯',
        repeatUnlockSkill: '腰擊劍勢',
        keyStatuses: ['breathing'],
        hooks: {
            onTurnStart: [
                { condition: () => true, selfStatus: { breathing: 2 }, source: '寒芒出鞘', skill: '寒芒出鞘' },
                { condition: () => true, selfStatus: { breathing: 3 }, source: '穿刺劍法', skill: '穿刺劍法' },
                { condition: () => true, selfStatus: { breathing: 5 }, source: '腰擊劍勢', skill: '腰擊劍勢', locked: true }
            ],
            onAttack: [
                { condition: (t, a) => (a.status.breathing || 0) >= 5, dpBonus: 2, source: '寒芒出鞘', skill: '寒芒出鞘' },
                // 腰擊劍勢：目標嚴重傷害槽已滿 → +2 DP、武器傷害 +2
                { condition: (t) => !!t.severeFull, dpBonus: 2, weaponDamage: 2, source: '腰擊劍勢', skill: '腰擊劍勢', locked: true }
            ],
            onHit: [
                { condition: () => true, selfStatus: { breathing: 2 }, source: '穿刺劍法', skill: '穿刺劍法' },
                { condition: () => true, manual: true, source: '穿刺劍法', skill: '穿刺劍法', desc: '命中後，你的下一次攻擊武器傷害 +2。' },
                { condition: () => true, manual: true, source: '腰擊劍勢', skill: '腰擊劍勢', locked: true, desc: '攻擊時若骰中四個以上的 10，可額外對目標造成 4 點 A 傷。' }
            ]
        }
    },

    // 奧提斯 - Seven 協會南部6科科長 ── 麻痺 / 破裂
    otis_seven: {
        id: 'otis_seven',
        name: '奧提斯 - Seven 協會南部6科科長',
        owner: '奧提斯',
        repeatUnlockSkill: '要害勘破',
        keyStatuses: ['paralyze', 'rupture'],
        hooks: {
            onHit: [
                // 造成傷害施加點數（豁免已移除，直接施加）
                { condition: () => true, targetStatus: { paralyze: 1 }, source: '預測分析', skill: '預測分析' },
                { condition: () => true, targetStatus: { rupture: 1 }, source: '預測分析', skill: '預測分析' },
                { condition: () => true, targetStatus: { rupture: 1 }, source: '臨場指揮', skill: '臨場指揮' },
                // 要害勘破：目標 4 層以上破裂 → 附加成功 +1
                { condition: (t) => (t.status.rupture || 0) >= 4, extraSuccess: 1, source: '要害勘破', skill: '要害勘破', locked: true }
            ],
            onActive: [
                { name: '預測分析（對抗減值）', source: '預測分析', skill: '預測分析',
                  desc: '檢定對抗或受攻擊時，使目標該次 DP 減少（主要攻擊技能等級/2，最少 1）。不可疊加。' },
                { name: '臨場指揮（對抗減值）', source: '臨場指揮', skill: '臨場指揮',
                  desc: '檢定對抗或受攻擊時，使目標附加成功減少（技能等級/4，最少 1）；造成傷害時使其防禦減少（技能等級/2，最少 1）。不可疊加。' },
                { name: '要害勘破（防禦削減 / 忽略傷害）', source: '要害勘破', skill: '要害勘破', locked: true,
                  desc: '造成傷害時使其防禦附加成功減少（技能等級/4，最少 1）；可使其 1 點傷害忽略失效，可疊加。' }
            ]
        }
    },

    // 奧提斯 - 環指點彩派學徒 ── 流血 / 迅捷
    otis_pointillist: {
        id: 'otis_pointillist',
        name: '奧提斯 - 環指點彩派學徒',
        owner: '奧提斯',
        repeatUnlockSkill: '檢查作品',
        keyStatuses: ['bleed', 'swiftness'],
        hooks: {
            onAttack: [
                // 點畫：目標流血 6+ → +3 DP
                { condition: (t) => (t.status.bleed || 0) >= 6, dpBonus: 3, source: '點畫', skill: '點畫' },
                // 血描畫：目標流血 12+ → 再 +3 DP
                { condition: (t) => (t.status.bleed || 0) >= 12, dpBonus: 3, source: '血描畫', skill: '血描畫' },
                // 檢查作品：目標流血 18+ → 再 +3 DP
                { condition: (t) => (t.status.bleed || 0) >= 18, dpBonus: 3, source: '檢查作品', skill: '檢查作品', locked: true },
                // 檢查作品：宣告攻擊 → 先攻最低兩名友方 +1 迅捷（需指定友軍，手動）
                { condition: () => true, manual: true, source: '檢查作品', skill: '檢查作品', locked: true,
                  desc: '宣告攻擊動作時，使我方先攻值最低的兩名友方單位獲得 1 層迅捷。' },
                // 檢查作品：目標每 1 種不同類型的負面狀態 → 武器傷害 +1（需盤點狀態種類，手動）
                { condition: () => true, manual: true, source: '檢查作品', skill: '檢查作品', locked: true,
                  desc: '目標身上每帶有 1 種「不同類型的負面狀態」，本次攻擊武器傷害 +1。' }
            ],
            onHit: [
                { condition: () => true, targetStatus: { bleed: 3 }, source: '點畫', skill: '點畫' },
                { condition: () => true, manual: true, source: '血描畫', skill: '血描畫',
                  desc: '命中可進行一次「連擊判定」：擲 1D10，擲到 10 → 額外進行一次攻擊；目標每帶有一種負面狀態，成功閾值下降 1；每回合最多觸發 2 次。' }
            ]
        }
    },

    // ========================================================================
    // 浮士德（Faust）
    // ========================================================================

    // 浮士德 - 食指苦行者：【紙條】 ── 指令加護 / 業 / 呼吸法 / 沉淪
    faust_note: {
        id: 'faust_note',
        name: '浮士德 - 食指苦行者：【紙條】',
        owner: '浮士德',
        repeatUnlockSkill: '我將遵照指令將你處決',
        keyStatuses: ['commandProtect', 'karma', 'breathing', 'sinking', 'commandTarget'],
        // 食指（被動）：回合開始時骰一顆等同場上敵人數量的面骰，骰中者為本回合「指令對象」。
        // 由 identity-hud 於回合開始資源結算時自動抽選並套用狀態（見 idtRollCommandTarget）。
        commandTargetRoll: true,
        hooks: {
            onTurnStart: [
                { condition: () => true, selfStatus: { breathing: 2 }, source: '務必保證，遵從指令', skill: '務必保證，遵從指令' },
                { condition: () => true, selfStatus: { breathing: 2 }, source: '執行指令並修行', skill: '執行指令並修行' },
                // 我將遵照指令將你處決：依指令加護額外獲得 層數/3 呼吸法
                { condition: () => true, selfStatus: { breathing: (t, a) => Math.floor((a.status.commandProtect || 0) / 3) }, source: '我將遵照指令將你處決', skill: '我將遵照指令將你處決', locked: true }
            ],
            onAttack: [
                // 業（食指被動）：場上存在指令對象、卻攻擊其以外的目標 → 獲得 1 層業
                { condition: (t, a) => !!a.commandTargetOnField && !((t.status.commandTarget || 0) > 0),
                  selfStatus: { karma: 1 }, source: '背離指令（獲得業）', skill: '（被動）' },
                // 呼吸法 + 目標沉淪之和每 6 點 +1 DP（兩個技能各觸發一次）
                { condition: () => true, dpBonus: (t, a) => Math.floor(((a.status.breathing || 0) + (t.status.sinking || 0)) / 6), source: '務必保證，遵從指令', skill: '務必保證，遵從指令' },
                { condition: () => true, dpBonus: (t, a) => Math.floor(((a.status.breathing || 0) + (t.status.sinking || 0)) / 6), source: '執行指令並修行', skill: '執行指令並修行' },
                // 對指令對象施法 → 附加成功 +1
                { condition: (t) => (t.status.commandTarget || 0) > 0, extraSuccess: 1, source: '執行指令並修行', skill: '執行指令並修行' },
                // 處決①：指令加護 6+ 且目標為指令對象 → 威力值 +6
                { condition: (t, a) => (a.status.commandProtect || 0) >= 6 && (t.status.commandTarget || 0) > 0, spellPower: 6, source: '我將遵照指令將你處決', skill: '我將遵照指令將你處決', locked: true },
                // 處決②：每 1 層指令加護最終傷害 +1；滿層(9) 改為 +12
                { condition: () => true, finalDamage: (t, a) => ((a.status.commandProtect || 0) >= 9 ? 12 : (a.status.commandProtect || 0)), source: '我將遵照指令將你處決', skill: '我將遵照指令將你處決', locked: true }
            ],
            onHit: [
                { condition: () => true, selfStatus: { breathing: 1 }, targetStatus: { sinking: 1 }, source: '務必保證，遵從指令', skill: '務必保證，遵從指令' },
                { condition: () => true, targetStatus: { sinking: 2 }, source: '執行指令並修行', skill: '執行指令並修行' }
            ]
        }
    },

    // 浮士德 - Zwei 協會南部4科 ── 人民之盾
    faust_zwei: {
        id: 'faust_zwei',
        name: '浮士德 - Zwei 協會南部4科',
        owner: '浮士德',
        repeatUnlockSkill: '治安維和',
        keyStatuses: ['shield'],
        hooks: {
            onTurnStart: [
                { condition: () => true, selfStatus: { shield: 1 }, source: '地區巡查', skill: '地區巡查' }
            ],
            onAttack: [
                // 人民之盾 5+ → +3 完美加值（視為 DP）
                { condition: (t, a) => (a.status.shield || 0) >= 5, dpBonus: 3, source: '客戶保護', skill: '客戶保護' },
                { condition: (t, a) => (a.status.shield || 0) >= 5, dpBonus: 3, source: '治安維和', skill: '治安維和', locked: true }
            ],
            onHit: [
                { condition: () => true, manual: true, source: '地區巡查', skill: '地區巡查', desc: '本回合攻擊命中 → 下回合額外獲得 2 層人民之盾（未造成傷害則改為 3 層）。' },
                { condition: () => true, manual: true, source: '客戶保護', skill: '客戶保護', desc: '本回合攻擊命中 → 下回合額外獲得 2 層人民之盾（未造成傷害則改為 3 層）。' },
                { condition: () => true, manual: true, source: '治安維和', skill: '治安維和', locked: true, desc: '攻擊命中 → 生命值恢復等同人民之盾層數/點嚴重傷害（4 點嚴重可轉 1 點惡性）。' }
            ],
            onActive: [
                { name: '客戶保護（分享護盾）', source: '客戶保護', skill: '客戶保護', desc: '回合開始時可將人民之盾的防禦洞察加值分給現存生命值最低的友方單位，層數維持不變。' },
                { name: '治安維和（友軍先攻）', source: '治安維和', skill: '治安維和', locked: true, desc: '回合開始時，可使現存生命值最低的友方單位先攻值增加（人民之盾層數一半/點）；若其同樣擁有人民之盾，改為層數/點並額外 +2 層；每單位限一次。' }
            ]
        }
    },

    // 浮士德 - 黑獸卯魁首 ── 疾如風 / 破裂（依先攻差距施法）
    faust_blackbeast: {
        id: 'faust_blackbeast',
        name: '浮士德 - 黑獸卯魁首',
        owner: '浮士德',
        repeatUnlockSkill: '目不能追，耳未可及。',
        keyStatuses: ['gale', 'rupture'],
        hooks: {
            onAttack: [
                // 瞬步：先攻高於目標 10/15 → 威力值 +1/+2
                { condition: (t, a) => (a.initiative || 0) >= (t.initiative || 0) + 10, spellPower: 1, source: '瞬步', skill: '瞬步' },
                { condition: (t, a) => (a.initiative || 0) >= (t.initiative || 0) + 15, spellPower: 1, source: '瞬步（15+）', skill: '瞬步' },
                // 我將開拓道路：先攻高於目標 15/20 → 威力值再 +1/+2
                { condition: (t, a) => (a.initiative || 0) >= (t.initiative || 0) + 15, spellPower: 1, source: '我將開拓道路，主公。', skill: '我將開拓道路，主公。' },
                { condition: (t, a) => (a.initiative || 0) >= (t.initiative || 0) + 20, spellPower: 1, source: '我將開拓道路，主公。（20+）', skill: '我將開拓道路，主公。' }
            ],
            onHit: [
                { condition: () => true, targetStatus: { rupture: 2 }, source: '瞬步', skill: '瞬步' },
                { condition: () => true, targetStatus: { rupture: 2 }, source: '我將開拓道路，主公。', skill: '我將開拓道路，主公。' },
                { condition: () => true, manual: true, source: '我將開拓道路，主公。', skill: '我將開拓道路，主公。', desc: '法術命中 → 額外獲得 1 點先攻加值，最多疊加 10 點。' }
            ],
            onActive: [
                { name: '目不能追，耳未可及。（能耗削減）', source: '目不能追，耳未可及。', skill: '目不能追，耳未可及。', locked: true,
                  desc: '先攻高於目標 25/30 → 對其施法能耗 -1/-2；先攻為目標兩倍以上時，可額外施放一次同階且不耗能/動作的法術，每回合一次。' },
                { name: '奧義 - 雲解顯現', source: '奧義-雲解顯現', skill: '奧義-雲解顯現', locked: true,
                  desc: '疾風達 10 點時消耗所有點數施放：整輪動作指定一名目標施法，威力值 +5 且增幅無需額外能耗；先攻每高出目標 3 點 +1；先攻為目標兩倍以上則歸還整輪動作，疾風回合結束變為 5 點。' }
            ]
        }
    },

    // ========================================================================
    // 羅佳（Ryoshu）
    // ========================================================================

    // 羅佳 - LCCB 系長 ── 暈眩 / 破綻 / 防禦等級降低
    ryoshu_lccb: {
        id: 'ryoshu_lccb',
        name: '羅佳 - LCCB 系長',
        owner: '羅佳',
        repeatUnlockSkill: '武力壓制',
        keyStatuses: ['stun', 'flaw', 'defenseDown'],
        hooks: {
            onAttack: [
                { condition: () => true, dpBonus: 2, source: '當頭一棒', skill: '當頭一棒' },
                { condition: () => true, dpBonus: 3, source: '重棍前戳', skill: '重棍前戳' },
                // 武力壓制：目標本回合尚未行動 → +2 附加成功
                { condition: (t) => !!t.notActedThisTurn, extraSuccess: 2, source: '武力壓制', skill: '武力壓制', locked: true }
            ],
            onHit: [
                { condition: () => true, targetStatus: { stun: 3 }, source: '當頭一棒', skill: '當頭一棒' },
                { condition: () => true, targetStatus: { flaw: 2 }, source: '重棍前戳', skill: '重棍前戳' },
                { condition: () => true, manual: true, source: '重棍前戳', skill: '重棍前戳', desc: '單次攻擊造成 5 點以上嚴重傷害 → 額外施加 2 層破綻。' },
                { condition: () => true, targetStatus: { stun: 1 }, source: '武力壓制', skill: '武力壓制', locked: true },
                { condition: () => true, targetStatus: { defenseDown: 2 }, source: '武力壓制', skill: '武力壓制', locked: true }
            ]
        }
    },

    // 羅佳 - 六協會南部4科科長 ── 燃燒
    ryoshu_south4: {
        id: 'ryoshu_south4',
        name: '羅佳 - 六協會南部4科科長',
        owner: '羅佳',
        repeatUnlockSkill: '一點突破',
        keyStatuses: ['burn'],
        hooks: {
            onAttack: [
                { condition: (t) => (t.status.burn || 0) >= 3, dpBonus: 3, source: '熾焰拳擊', skill: '熾焰拳擊' },
                { condition: (t) => (t.status.burn || 0) >= 6, manual: true, source: '熾焰手刀-燃', skill: '熾焰手刀-燃', desc: '目標 6+ 燃燒 → 對距目標 3 米內另外兩名敵方單位（優先無/最低燃燒者）施加 2 點燃燒。' },
                { condition: (t) => (t.status.burn || 0) >= 12, manual: true, source: '熾焰手刀-燃', skill: '熾焰手刀-燃', desc: '目標 12+ 燃燒 → 本次造成的 2 點嚴重傷害轉化為惡性傷害。' }
            ],
            onHit: [
                { condition: () => true, targetStatus: { burn: 2 }, source: '熾焰拳擊', skill: '熾焰拳擊' },
                { condition: () => true, targetStatus: { burn: 2 }, source: '熾焰手刀-燃', skill: '熾焰手刀-燃' },
                { condition: () => true, targetStatus: { burn: 2 }, source: '一點突破', skill: '一點突破', locked: true }
            ],
            onActive: [
                { name: '惡意燃燒', source: '一點突破', skill: '一點突破', locked: true, desc: '所施加燃燒視為「惡意燃燒」：不使用動作撲滅則每輪結束 +1，且一般物理手段無法熄滅。' },
                { name: '一點突破', source: '一點突破', skill: '一點突破', locked: true, desc: '造成傷害時若目標燃燒 15+，可額外造成等同其當前燃燒點數的嚴重傷害，隨後燃燒減半。每場戰鬥限一次。' }
            ]
        }
    },

    // 羅佳 - 黑雲會若眾 ── 呼吸法 / 流血
    ryoshu_blackcloud: {
        id: 'ryoshu_blackcloud',
        name: '羅佳 - 黑雲會若眾',
        owner: '羅佳',
        repeatUnlockSkill: '斬破長空',
        keyStatuses: ['breathing', 'bleed'],
        hooks: {
            onTurnStart: [
                { condition: () => true, selfStatus: { breathing: 4 }, source: '鋒芒畢現', skill: '鋒芒畢現' },
                { condition: () => true, selfStatus: { breathing: 4 }, source: '散亂之舞', skill: '散亂之舞' }
            ],
            onAttack: [
                { condition: (t, a) => (a.status.breathing || 0) >= 15, weaponDamage: 2, source: '鋒芒畢現', skill: '鋒芒畢現' },
                { condition: (t, a) => (a.status.breathing || 0) >= 30, weaponDamage: 2, source: '散亂之舞', skill: '散亂之舞' },
                { condition: (t, a) => (a.status.breathing || 0) >= 45, weaponDamage: 2, source: '斬破長空', skill: '斬破長空', locked: true },
                { condition: (t) => (t.status.bleed || 0) >= 6, manual: true, source: '斬破長空', skill: '斬破長空', locked: true, desc: '目標 6+ 流血狀態 → 該次攻擊加骰上升一級（最多 8 加骰）。' },
                { condition: () => true, manual: true, source: '斬破長空', skill: '斬破長空', locked: true, desc: '攻擊若骰中數字 10 → 命中目標獲得 10 層流血狀態。' }
            ],
            onHit: [
                { condition: () => true, targetStatus: { bleed: 3 }, source: '散亂之舞', skill: '散亂之舞' }
            ]
        }
    },

    // 羅佳 - Zwei 協會南部5科 ── 挑釁 / 呼吸法 / 易損（護盾走單位護盾值，非狀態）
    ryoshu_zwei_south5: {
        id: 'ryoshu_zwei_south5',
        name: '羅佳 - Zwei 協會南部5科',
        owner: '羅佳',
        repeatUnlockSkill: '威脅鎮壓',
        keyStatuses: ['provoke', 'breathing', 'vulnerable'],
        hooks: {
            onTurnStart: [
                // 穩紮穩打（被動）：每 15 層呼吸法 → 1 點「一次性護盾」（單位護盾值，不會自動回復）
                { condition: () => true, selfShield: (t, a) => Math.floor((a.status.breathing || 0) / 15),
                  source: '穩紮穩打（被動）', skill: '（被動）' }
            ],
            onAttack: [
                // 牽制戰術：宣告攻擊 → 目標 +1 挑釁
                { condition: () => true, targetStatus: { provoke: 1 }, source: '牽制戰術', skill: '牽制戰術' },
                // 專注防禦：宣告攻擊 → 目標 +2 挑釁、自身 +2 呼吸法
                { condition: () => true, targetStatus: { provoke: 2 }, selfStatus: { breathing: 2 }, source: '專注防禦', skill: '專注防禦' },
                // 專注防禦：護盾值不為 0 → 再 +2 呼吸法（unitShield＝單位卡上的一次性＋自動護盾）
                { condition: (t, a) => (a.unitShield || 0) > 0, selfStatus: { breathing: 2 }, source: '專注防禦（護盾不為 0）', skill: '專注防禦' },
                // 威脅鎮壓：護盾值不為 0 → +6 DP
                { condition: (t, a) => (a.unitShield || 0) > 0, dpBonus: 6, source: '威脅鎮壓', skill: '威脅鎮壓', locked: true }
            ],
            onHit: [
                { condition: () => true, selfStatus: { breathing: 2 }, source: '牽制戰術', skill: '牽制戰術' },
                { condition: () => true, selfStatus: { breathing: 2 }, source: '專注防禦', skill: '專注防禦' },
                { condition: () => true, manual: true, source: '威脅鎮壓', skill: '威脅鎮壓', locked: true,
                  desc: '命中時若骰子中具有兩個以上的數字 10，對目標施加 1 層易損。' }
            ],
            onActive: [
                { name: '牽制戰術（失手回氣）', source: '牽制戰術', skill: '牽制戰術',
                  desc: '若你在對抗檢定中失敗（或攻擊未命中），使自身獲得 2 層呼吸法。' }
            ]
        }
    },

    // ========================================================================
    // 希斯克利夫（Heathcliff）
    // ========================================================================

    // 希斯克利夫 - し協會南部5科 ── 呼吸法
    heath_south5: {
        id: 'heath_south5',
        name: '希斯克利夫 - し協會南部5科',
        owner: '希斯克利夫',
        repeatUnlockSkill: '閃擊戰術',
        keyStatuses: ['breathing'],
        hooks: {
            onTurnStart: [
                { condition: () => true, selfStatus: { breathing: 3 }, source: '極意之劍', skill: '極意之劍' },
                { condition: () => true, selfStatus: { breathing: 3 }, source: '飛劍刺殺', skill: '飛劍刺殺' },
                { condition: () => true, selfStatus: { breathing: 4 }, source: '閃擊戰術', skill: '閃擊戰術', locked: true }
            ],
            onAttack: [
                { condition: (t, a) => !!a.severeFull, dpBonus: 2, source: '極意之劍', skill: '極意之劍' },
                { condition: (t, a) => !!a.severeFull, dpBonus: 2, source: '飛劍刺殺', skill: '飛劍刺殺' },
                { condition: (t, a) => (a.status.breathing || 0) > 10, weaponDamage: 2, source: '飛劍刺殺', skill: '飛劍刺殺' },
                { condition: (t, a) => (a.status.breathing || 0) > 20, weaponDamage: 2, source: '閃擊戰術', skill: '閃擊戰術', locked: true }
            ],
            onActive: [
                { name: '閃擊戰術（自傷加骰）', source: '閃擊戰術', skill: '閃擊戰術', locked: true,
                  desc: '攻擊前可宣告對自己造成 3 點無法減免的 A 傷，使本次攻擊加骰增加一級（最高 8 加骰）；若已是 8 加骰，改為附加成功 +3。' }
            ]
        }
    },

    // 希斯克利夫 - Öufi 协会南部3科 ── 震顫
    heath_oufi: {
        id: 'heath_oufi',
        name: '希斯克利夫 - Öufi 协会南部3科',
        owner: '希斯克利夫',
        repeatUnlockSkill: '宣告執行',
        keyStatuses: ['tremor'],
        hooks: {
            onAttack: [
                { condition: (t) => (t.status.tremor || 0) >= 3, weaponDamage: 1, source: '規勸履行', skill: '規勸履行' },
                { condition: (t) => (t.status.tremor || 0) >= 6, weaponDamage: 1, source: '規勸履行（6+）', skill: '規勸履行' },
                { condition: (t) => (t.status.tremor || 0) >= 6, weaponDamage: 1, source: '最後通牒', skill: '最後通牒' },
                { condition: (t) => (t.status.tremor || 0) >= 9, weaponDamage: 1, source: '最後通牒（9+）', skill: '最後通牒' },
                { condition: (t) => (t.status.tremor || 0) >= 9, weaponDamage: 1, source: '宣告執行', skill: '宣告執行', locked: true },
                { condition: (t) => (t.status.tremor || 0) >= 12, weaponDamage: 1, source: '宣告執行（12+）', skill: '宣告執行', locked: true }
            ],
            onHit: [
                { condition: () => true, targetStatus: { tremor: 2 }, source: '規勸履行', skill: '規勸履行' },
                { condition: () => true, targetStatus: { tremor: 3 }, source: '最後通牒', skill: '最後通牒' },
                { condition: () => true, targetStatus: { tremor: 3 }, source: '宣告執行', skill: '宣告執行', locked: true },
                { condition: (t) => (t.status.tremor || 0) >= 20, manual: true, source: '宣告執行', skill: '宣告執行', locked: true,
                  desc: '目標 20 層震顫 → 被攻擊後額外獲得 20 層特殊震顫-崩壞；引爆時除閾值前移外，額外造成等同特殊層數的物理嚴重傷害並清零。' }
            ]
        }
    },

    // ========================================================================
    // 莫爾索（Meursault）
    // ========================================================================

    // 莫爾索 - Dieci 協會南部4科科長 ── 學識 / 所解真知 / 沮喪
    meursault_dieci: {
        id: 'meursault_dieci',
        name: '莫爾索 - Dieci 協會南部4科科長',
        owner: '莫爾索',
        repeatUnlockSkill: '燃盡知識',
        keyStatuses: ['knowledge', 'trueKnowledge', 'depression'],
        hooks: {
            onAttack: [
                // 以敵方為目標 → 自身 +2 學識（每回合一次）
                { condition: () => true, selfStatus: { knowledge: 2 }, source: '學業精進（每回合一次）', skill: '學業精進' },
                // 每 1 層所解真知 +1 DP（學習時間與燃盡知識各觸發一次）
                { condition: () => true, dpBonus: (t, a) => (a.status.trueKnowledge || 0), source: '學習時間', skill: '學習時間' },
                { condition: () => true, dpBonus: (t, a) => (a.status.trueKnowledge || 0), source: '燃盡知識', skill: '燃盡知識', locked: true },
                // 目標每 5 點沮喪 → 造成傷害 +1
                { condition: () => true, finalDamage: (t) => Math.floor((t.status.depression || 0) / 5), source: '學習時間', skill: '學習時間' }
            ],
            onHit: [
                { condition: () => true, targetStatus: { depression: 3 }, source: '學業精進', skill: '學業精進' },
                { condition: () => true, targetStatus: { depression: (t, a) => (a.status.trueKnowledge || 0) * 2 }, source: '學習時間', skill: '學習時間' },
                { condition: () => true, targetStatus: { depression: (t, a) => (a.status.trueKnowledge || 0) * 2 }, source: '燃盡知識', skill: '燃盡知識', locked: true }
            ],
            onActive: [
                { name: '學業精進（捨棄技能）', source: '學業精進', skill: '學業精進', desc: '回合開始捨棄 1 個技能 → 獲得（所解真知層數×5）臨時生命。' },
                { name: '燃盡知識（消耗學識）', source: '燃盡知識', skill: '燃盡知識', locked: true, desc: '學識 5+ 時攻擊可消耗所有學識，每點 +1 附加成功；此後學識與所解真知歸零，戰鬥結束前不可再獲得。' }
            ]
        }
    },

    // ========================================================================
    // 良秀（Yoshu）
    // ========================================================================

    // 良秀 - 黑雲會若眾 ── 麻痺 / 流血
    yoshu_blackcloud: {
        id: 'yoshu_blackcloud',
        name: '良秀 - 黑雲會若眾',
        owner: '良秀',
        repeatUnlockSkill: '黑雲亂渦',
        keyStatuses: ['paralyze', 'bleed'],
        hooks: {
            onHit: [
                // 豁免已移除，直接施加
                { condition: () => true, targetStatus: { paralyze: 3 }, source: '斂芒在鞘', skill: '斂芒在鞘' },
                { condition: (t) => (t.status.bleed || 0) >= 2, manual: true, source: '斂芒在鞘', skill: '斂芒在鞘', desc: '命中時目標 2+ 流血 → 本次造成的 1 點嚴重傷害轉化為惡性傷害。' },
                { condition: () => true, targetStatus: { bleed: 2 }, source: '血振納刀', skill: '血振納刀' },
                { condition: (t) => (t.status.bleed || 0) >= 5, manual: true, source: '血振納刀', skill: '血振納刀', desc: '命中時目標 5+ 流血 → 本次造成的 2 點嚴重傷害轉化為惡性傷害。' },
                { condition: () => true, targetStatus: { bleed: 3 }, source: '黑雲亂渦', skill: '黑雲亂渦', locked: true },
                { condition: (t) => (t.status.bleed || 0) >= 9, manual: true, source: '黑雲亂渦', skill: '黑雲亂渦', locked: true, desc: '命中時目標 9+ 流血 → 本次造成的 3 點嚴重傷害轉化為惡性傷害。' }
            ],
            onActive: [
                { name: '黑雲亂渦（流血減骰）', source: '黑雲亂渦', skill: '黑雲亂渦', locked: true, desc: '你所施加的流血層數會使目標所有判定扣除與層數相等的骰子數。' }
            ]
        }
    },

    // ========================================================================
    // 唐吉訶德（Don Quixote）
    // ========================================================================

    // 唐吉訶德 - Cinq 協會南部5科長 ── 迅捷 / 束縛 / 決鬥宣告
    don_cinq: {
        id: 'don_cinq',
        name: '唐吉訶德 - Cinq 協會南部5科長',
        owner: '唐吉訶德',
        repeatUnlockSkill: '向您致敬！',
        keyStatuses: ['swiftness', 'bind', 'duelDon'],
        hooks: {
            onAttack: [
                // 決鬥宣告：對標記目標 +2 DP 完美加值
                { condition: (t) => (t.status.duelDon || 0) > 0, dpBonus: 2, source: '決鬥宣告 - 唐吉訶德', skill: '（被動）' },
                // 延續進攻：先攻序位前七 → +2 DP
                { condition: (t, a) => (a.initiativeRank || 99) <= 7, dpBonus: 2, source: '延續進攻', skill: '延續進攻' },
                // 雙旋飛刺：先攻高於目標 → 武器傷害 +3
                { condition: (t, a) => (a.initiative || 0) > (t.initiative || 0), weaponDamage: 3, source: '雙旋飛刺', skill: '雙旋飛刺' },
                // 向您致敬：先攻序位前五 → +3 DP
                { condition: (t, a) => (a.initiativeRank || 99) <= 5, dpBonus: 3, source: '向您致敬！', skill: '向您致敬！', locked: true }
            ],
            onHit: [
                { condition: () => true, selfStatus: { swiftness: 1 }, targetStatus: { bind: 1 }, source: '延續進攻', skill: '延續進攻' },
                { condition: () => true, targetStatus: { bind: 1 }, source: '雙旋飛刺', skill: '雙旋飛刺' },
                { condition: () => true, targetStatus: { duelDon: 1 }, source: '向您致敬！', skill: '向您致敬！', locked: true }
            ],
            onKill: [
                { condition: (t) => (t.status.duelDon || 0) > 0, manual: true, source: '向您致敬！', skill: '向您致敬！', locked: true,
                  desc: '親手擊殺受決鬥宣告標記的敵人 → 恢復等同你主要攻擊技能一半數值的意志力。' }
            ],
            onActive: [
                { name: '雙旋飛刺（連續攻擊迅捷）', source: '雙旋飛刺', skill: '雙旋飛刺',
                  desc: '連續兩回合以標準動作攻擊，從第二回合起每次標準動作攻擊額外獲得 2 層迅捷（一回合一次），直到標準動作未攻擊為止。' }
            ]
        }
    },

    // 唐吉訶德 - 腦葉公司 E.G.O::以愛與憎之名 ── 愛/憎 / 魔法阿卡納（光暗型態）
    don_ego: {
        id: 'don_ego',
        name: '唐吉訶德 - 腦葉公司 E.G.O::以愛與憎之名',
        owner: '唐吉訶德',
        repeatUnlockSkill: '阿卡納律動 / 逆位律動',
        keyStatuses: ['loveHate', 'arcana'],
        // 本卡為光/暗型態切換的特殊機制，型態判定與意志力結算需玩家填寫資源後計算。
        formNote: '依當前意志力判定光（>0）／暗（<0）型態。每累計消耗 10 點愛/憎獲得 1 層魔法阿卡納；魔法阿卡納使攻擊檢定與武器傷害各 +層數。光型態用技 -4 意志力且不因負值昏迷；暗型態每次攻擊扣最大生命一半的惡性傷害。',
        // 需玩家自行填寫的資源（不在地圖單位上追蹤）：
        manualInputs: [
            { key: 'will', label: '當前意志力', hint: '>0 光型態 / <0 暗型態', default: 0 },
            { key: 'arcana', label: '魔法阿卡納層數', hint: '攻擊檢定與武器傷害各 +層數', default: 0 },
            { key: 'loveHate', label: '當前愛/憎點數', hint: '每累計消耗 10 點 → +1 魔法阿卡納', default: 0 }
        ],
        // 依填寫的意志力正負，提醒對應的血量／意志力增減：
        reminders: [
            { condition: (t, a) => (a.status.will || 0) > 0, text: '☀️ 光型態（意志力 > 0）：使用主動技後 −4 意志力（即使降為負值也不會昏迷）。' },
            { condition: (t, a) => (a.status.will || 0) < 0, text: '🌑 暗型態（意志力 < 0）：本次攻擊需扣除「最大生命一半」的惡性傷害（自傷）。' },
            { condition: (t, a) => (a.status.will || 0) === 0, text: '⚖️ 意志力為 0：請先在上方填寫當前意志力以判定光／暗型態。' },
            { text: '🔁 每累計消耗 10 點愛/憎 → 獲得 1 層魔法阿卡納（魔法阿卡納使攻擊檢定與武器傷害各 +層數）。' }
        ],
        hooks: {
            onAttack: [
                // 魔法阿卡納：攻擊檢定 +層數、武器傷害 +層數
                { condition: () => true, dpBonus: (t, a) => (a.status.arcana || 0), weaponDamage: (t, a) => (a.status.arcana || 0), source: '魔法阿卡納', skill: '（被動）' }
            ],
            onHit: [
                // 型態判定：依玩家填寫的「當前意志力」決定光（>0）／暗（<0）。
                // 意志力為 0（未填）時兩種型態皆不計入，僅保留與型態無關的效果。
                // 【光】奉主管老爺之命登場！
                { condition: (t, a) => (a.status.will || 0) > 0, selfStatus: { loveHate: 2 }, targetStatus: { rupture: 2 }, source: '【光】奉主管老爺之命登場！', skill: '【光】奉主管老爺之命登場！' },
                // 【暗】惡人…在哪…？
                { condition: (t, a) => (a.status.will || 0) < 0, selfStatus: { loveHate: 5 }, targetStatus: { depression: 5 }, source: '【暗】惡人…在哪…？', skill: '【暗】惡人…在哪…？' },
                // 【光】要用愛！喲！
                { condition: (t, a) => (a.status.will || 0) > 0, selfStatus: { loveHate: 3 }, targetStatus: { rupture: 2 }, source: '【光】要用愛！喲！', skill: '【光】要用愛！喲！' },
                // 【暗】從我的腦袋裡出去…
                { condition: (t, a) => (a.status.will || 0) < 0, selfStatus: { loveHate: 5 }, targetStatus: { depression: 5 }, source: '【暗】從我的腦袋裡出去…', skill: '【暗】從我的腦袋裡出去…' },
                // 【光】阿卡納律動【重複抽取解鎖】
                { condition: (t, a) => (a.status.will || 0) > 0, selfStatus: { loveHate: 3, arcana: 1 }, source: '【光】阿卡納律動！', skill: '阿卡納律動', locked: true }
            ],
            onActive: [
                { name: '【光】奉主管老爺之命登場！（消耗愛憎）', source: '【光】奉主管老爺之命登場！', skill: '【光】奉主管老爺之命登場！', desc: '命中時可主動消耗 7 點愛/憎，使本次攻擊 DP +3。', effect: { cost: { loveHate: 7 }, dpBonus: 3 } },
                { name: '【暗】惡人…在哪…？（消耗愛憎）', source: '【暗】惡人…在哪…？', skill: '【暗】惡人…在哪…？', desc: '命中時可主動消耗 7 點愛/憎，使本次攻擊 DP +5。', effect: { cost: { loveHate: 7 }, dpBonus: 5 } },
                { name: '【光】要用愛！喲！（消耗愛憎）', source: '【光】要用愛！喲！', skill: '【光】要用愛！喲！', desc: '命中時可主動消耗 12 點愛/憎，使本次攻擊 DP 額外 +10（與另一消耗獨立，不可疊加）。', effect: { cost: { loveHate: 12 }, dpBonus: 10 } },
                { name: '【暗】從我的腦袋裡出去…（次要目標）', source: '【暗】從我的腦袋裡出去…', skill: '【暗】從我的腦袋裡出去…', desc: '命中時可額外選擇鄰近次要目標，在主要目標結算傷害後對其造成一半傷害。' },
                { name: '【光】阿卡納律動（強制逆位）', source: '【光】阿卡納律動！', skill: '阿卡納律動', locked: true, desc: '魔法阿卡納達 5 層 → 意志力強制變 -1，下回合開始強制進入逆位-暗狀態。' },
                { name: '【暗】逆位律動 / 逆位阿卡納光破斬', source: '【暗】逆位律動', skill: '逆位律動', locked: true, desc: '逆位-暗狀態命中時可消耗所有魔法阿卡納，每 1 層額外指定 1 名敵方目標；若僅指定 1 名目標則傷害 +10；回合結束時意志力回滿、魔法阿卡納清零。' }
            ]
        }
    },

    // 唐吉訶德 - N 公司 中錘 ── 尖釘 / 震顫 / 虛弱
    don_ncompany: {
        id: 'don_ncompany',
        name: '唐吉訶德 - N 公司 中錘',
        owner: '唐吉訶德',
        repeatUnlockSkill: '狂熱審判',
        keyStatuses: ['nails', 'tremor', 'weak'],
        hooks: {
            onAttack: [
                // 執行！：目標尖釘 5+ → 嚴重傷害 +3
                { condition: (t) => (t.status.nails || 0) >= 5, finalDamage: 3, source: '執行！', skill: '執行！' }
            ],
            onHit: [
                { condition: () => true, targetStatus: { nails: 2, tremor: 3 }, source: '正當的淨化', skill: '正當的淨化' },
                { condition: () => true, targetStatus: { nails: 2 }, source: '執行！', skill: '執行！' },
                { condition: () => true, targetStatus: { nails: 2, tremor: 2 }, source: '狂熱審判', skill: '狂熱審判', locked: true },
                { condition: (t) => (t.status.nails || 0) >= 5, targetStatus: { weak: 3 }, source: '狂熱審判（尖釘 5+）', skill: '狂熱審判', locked: true }
            ],
            onActive: [
                { name: '震顫引爆', source: '執行！', skill: '執行！', desc: '命中時若目標具有震顫，宣告引爆：先結算正常震顫效果，隨後額外造成等同被消耗震顫層數的嚴重傷害（無視防禦與減免）。' }
            ]
        }
    },

    // 唐吉訶德 - 劍契組殺手 ── 呼吸法
    don_swordpact: {
        id: 'don_swordpact',
        name: '唐吉訶德 - 劍契組殺手',
        owner: '唐吉訶德',
        repeatUnlockSkill: '永別了！',
        keyStatuses: ['breathing'],
        hooks: {
            onTurnStart: [
                { condition: () => true, selfStatus: { breathing: 2 }, source: '寒芒出鞘', skill: '寒芒出鞘' },
                { condition: () => true, selfStatus: { breathing: 3 }, source: '劍跡', skill: '劍跡' },
                { condition: () => true, selfStatus: { breathing: 5 }, source: '永別了！', skill: '永別了！', locked: true }
            ],
            onAttack: [
                { condition: (t, a) => (a.status.breathing || 0) >= 15, weaponDamage: 1, source: '寒芒出鞘', skill: '寒芒出鞘' },
                { condition: (t, a) => (a.status.breathing || 0) >= 30, weaponDamage: 1, source: '劍跡', skill: '劍跡' },
                { condition: (t, a) => (a.status.breathing || 0) >= 45, weaponDamage: 1, source: '永別了！', skill: '永別了！', locked: true }
            ],
            onHit: [
                { condition: () => true, manual: true, source: '寒芒出鞘', skill: '寒芒出鞘', desc: '若該次攻擊成功數低於你的呼吸法層數，攻擊後再獲得 2 層呼吸法。' },
                { condition: () => true, manual: true, source: '劍跡', skill: '劍跡', desc: '近戰白刃攻擊若骰中數字 10，指定一名友方單位使其下次判定 +4 士氣加值。' },
                { condition: () => true, manual: true, source: '永別了！', skill: '永別了！', locked: true, desc: '近戰白刃攻擊若骰中兩個以上的 10，指定兩名友方單位使其下次判定 +6 士氣加值（與劍跡可同時觸發，單位選擇不可疊加）。' }
            ]
        }
    },

    // 唐吉訶德 - し協會南部5科科長 ── 迅捷 / 呼吸法
    don_shi_south5: {
        id: 'don_shi_south5',
        name: '唐吉訶德 - し協會南部5科科長',
        owner: '唐吉訶德',
        repeatUnlockSkill: '過度呼吸',
        keyStatuses: ['swiftness', 'breathing'],
        hooks: {
            onAttack: [
                // 迅捷（被動）：先攻值增加等同於迅捷層數，引擎不直接運算先攻，故保留為手動提示
                { condition: () => true, manual: true, source: '迅捷', skill: '（被動）',
                  desc: '你的先攻值增加等同於你身上【迅捷】層數。' },
                // 呼吸增幅（被動）：呼吸法 15+ 使能看見你的友方在攻擊檢定獲得士氣加值，每 15 層疊加一次
                { condition: (t, a) => (a.status.breathing || 0) >= 15, manual: true, source: '呼吸增幅', skill: '（被動）',
                  desc: '你的【呼吸法】達到 15 層以上時，所有能看見你的友方單位在攻擊檢定上獲得 2 點士氣加值，每 15 層疊加一次。' },
                // 調整呼吸：宣告攻擊時立即獲得 2 層迅捷
                { condition: () => true, selfStatus: { swiftness: 2 }, source: '調整呼吸', skill: '調整呼吸' },
                // 二連斬擊：嚴重生命槽被填滿時獲得 4 層迅捷（持續到戰鬥結束，一場戰鬥僅觸發一次）
                { condition: (t, a) => !!a.severeFull, manual: true, source: '二連斬擊', skill: '二連斬擊',
                  desc: '本次戰鬥中，若你的嚴重生命槽被填滿，立即獲得 4 層【迅捷】，效果持續到戰鬥結束；一場戰鬥僅觸發一次。' },
                // 過度呼吸【重複抽取解鎖】：迅捷 10+ → 本次攻擊 +15 DP
                { condition: (t, a) => (a.status.swiftness || 0) >= 10, dpBonus: 15, source: '過度呼吸', skill: '過度呼吸', locked: true }
            ],
            onHit: [
                // 調整呼吸：命中時獲得 2 層呼吸法
                { condition: () => true, selfStatus: { breathing: 2 }, source: '調整呼吸', skill: '調整呼吸' },
                // 二連斬擊：命中時再獲得 3 層呼吸法、3 層迅捷
                { condition: () => true, selfStatus: { breathing: 3 }, source: '二連斬擊', skill: '二連斬擊' },
                { condition: () => true, selfStatus: { swiftness: 3 }, source: '二連斬擊', skill: '二連斬擊' }
            ]
        }
    },

    // 唐吉訶德 - 腦葉公司 E.G.O::提燈 ── 破裂 / 挑釁
    don_ego_lantern: {
        id: 'don_ego_lantern',
        name: '唐吉訶德 - 腦葉公司EGO::提燈',
        owner: '唐吉訶德',
        repeatUnlockSkill: '嚼嚼旋風！',
        keyStatuses: ['rupture', 'provoke'],
        hooks: {
            onAttack: [
                // 閃爍誘餌：目標破裂 5+ → +3 DP
                { condition: (t) => (t.status.rupture || 0) >= 5, dpBonus: 3, source: '閃爍誘餌', skill: '閃爍誘餌' },
                // 嚼嚼旋風【重複抽取解鎖】：目標破裂 7+ → 再 +5 DP
                { condition: (t) => (t.status.rupture || 0) >= 7, dpBonus: 5, source: '嚼嚼旋風！', skill: '嚼嚼旋風！', locked: true },
                // 嚼嚼旋風【重複抽取解鎖】：提燈噬咬（可宣告，恢復嚴重傷害，需手動結算）
                { condition: () => true, manual: true, source: '提燈噬咬', skill: '嚼嚼旋風！', locked: true,
                  desc: '可宣告發動「提燈噬咬」：恢復 2 點嚴重傷害 (L)；目標身上每有 2 層【破裂】，再額外恢復 1 點嚴重傷害 (L)。若此時你的嚴重生命槽已被填滿，本次攻擊額外造成 2 點物理嚴重傷害，且上述生命恢復量翻倍。' }
            ],
            onHit: [
                // 吾當嚙之！：命中時附加 3 層挑釁、2 層破裂
                { condition: () => true, targetStatus: { provoke: 3 }, source: '吾當嚙之！', skill: '吾當嚙之！' },
                { condition: () => true, targetStatus: { rupture: 2 }, source: '吾當嚙之！', skill: '吾當嚙之！' },
                // 閃爍誘餌：命中時再附加 2 層破裂
                { condition: () => true, targetStatus: { rupture: 2 }, source: '閃爍誘餌', skill: '閃爍誘餌' },
                // 閃爍誘餌：若命中前目標破裂不超過 3 層，再額外施加 3 層破裂
                { condition: (t) => (t.status.rupture || 0) <= 3, targetStatus: { rupture: 3 }, source: '閃爍誘餌（破裂 ≤3 加成）', skill: '閃爍誘餌' },
                // 嚼嚼旋風【重複抽取解鎖】：命中時再附加 3 層挑釁
                { condition: () => true, targetStatus: { provoke: 3 }, source: '嚼嚼旋風！', skill: '嚼嚼旋風！', locked: true }
            ]
        }
    },

    // 唐吉訶德 - T公司3級徵收人員 ── 震顫 / 束縛 / 挑釁
    don_tcorp: {
        id: 'don_tcorp',
        name: '唐吉訶德 - T公司3級徵收人員',
        owner: '唐吉訶德',
        repeatUnlockSkill: '那位，請止步！',
        keyStatuses: ['tremor', 'bind', 'provoke'],
        hooks: {
            onAttack: [
                // 鎖鏈光環（被動）：敵方攻擊檢定受其震顫層數減值——引擎不運算敵方檢定，保留提示
                { condition: () => true, manual: true, source: '鎖鏈光環', skill: '（被動）',
                  desc: '只要你與目標處於交戰狀態，目標進行攻擊檢定時受到等同其【震顫】層數的 DP 減值。' },
                // 該徵收了：宣告攻擊 → 目標 +2 挑釁
                { condition: () => true, targetStatus: { provoke: 2 }, source: '該徵收了', skill: '該徵收了' },
                // 該徵收了：目標震顫 6+ → +5 DP
                { condition: (t) => (t.status.tremor || 0) >= 6, dpBonus: 5, source: '該徵收了', skill: '該徵收了' },
                // 那位，請止步！：目標帶有束縛 → +3 DP
                { condition: (t) => (t.status.bind || 0) > 0, dpBonus: 3, source: '那位，請止步！', skill: '那位，請止步！', locked: true }
            ],
            onHit: [
                { condition: () => true, targetStatus: { tremor: 2, provoke: 1 }, source: '該徵收了', skill: '該徵收了' },
                { condition: () => true, targetStatus: { tremor: 2 }, source: 'T公司產加速切斷器', skill: 'T公司產加速切斷器' },
                { condition: () => true, targetStatus: { tremor: 2 }, source: '那位，請止步！', skill: '那位，請止步！', locked: true }
            ],
            onActive: [
                { name: '震顫引爆（加速切斷）', source: 'T公司產加速切斷器', skill: 'T公司產加速切斷器',
                  desc: '命中時可宣告引爆目標身上最多 5 層震顫：對目標造成等同引爆層數的嚴重傷害，並施加等同消耗層數的【束縛】（若為 BOSS，可自選其行動條目承受）。' },
                { name: '時間延付', source: '那位，請止步！', skill: '那位，請止步！', locked: true,
                  desc: '命中時若目標震顫達 10 層以上，可宣告消耗其 10 層震顫：目標立即受到 10 點惡性傷害 (A)，且直到下一回合開始，其防禦檢定受到 10 DP 減值。' }
            ]
        }
    }
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
 * 依角色（owner）取得其名下所有人格卡 ID。
 * 同名角色視為同一名玩家所擁有。
 * @param {string} owner - 角色名稱，例如 '格里高爾'
 * @returns {Array<string>}
 */
function getIdentitiesByOwner(owner) {
    return Object.values(IDENTITY_LIBRARY)
        .filter(card => card.owner === owner)
        .map(card => card.id);
}

/**
 * 取得所有角色（owner）清單（去重，保留出現順序）。
 * @returns {Array<string>}
 */
function getIdentityOwners() {
    const seen = [];
    for (const card of Object.values(IDENTITY_LIBRARY)) {
        if (card.owner && !seen.includes(card.owner)) seen.push(card.owner);
    }
    return seen;
}

console.log('🃏 人格卡牌資料庫已載入（' + Object.keys(IDENTITY_LIBRARY).length + ' 張）');

// ===== ES Module 匯出 + 全域相容層（Phase 2 漸進模組化 A1）=====
export {
    IDENTITY_STATUS_KEYMAP, IDENTITY_LIBRARY, getIdentityById,
    getAllIdentities, getIdentitiesByOwner, getIdentityOwners,
};

if (typeof window !== 'undefined') {
    Object.assign(window, {
        IDENTITY_STATUS_KEYMAP, IDENTITY_LIBRARY, getIdentityById,
        getAllIdentities, getIdentitiesByOwner, getIdentityOwners,
    });
}
