/**
 * Limbus Command - 狀態效果資料庫
 * 無限恐怖規則完整狀態系統
 */

// ===== 狀態分類 =====
const STATUS_CATEGORIES = {
    common: { id: 'common', name: '常用狀態', icon: '⭐', color: '#f39c12' },
    debuff: { id: 'debuff', name: '負面與失能', icon: '💀', color: '#e74c3c' },
    mental: { id: 'mental', name: '精神與心智', icon: '🧠', color: '#9b59b6' },
    custom: { id: 'custom', name: '自訂', icon: '✏️', color: '#8e24aa' }
};

// ===== 完整狀態庫 =====
const STATUS_LIBRARY = {
    // ========== 常用狀態 ==========
    common: [
        {
            id: 'burn',
            name: '燃燒',
            icon: '🔥',
            type: 'stack',
            desc: '每回合受火焰傷害',
            fullDesc: '每次結束行動時都會受到燃燒點數的火焰嚴重傷害。可用標準動作反射檢定撲滅（每成功數-1點）。與凍結互相抵銷。',
            keyResist: ['敏捷'],
            canCounter: ['freeze'],
            effects: {
                light: '每回合結束受到等於點數的火焰傷害',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'bleed',
            name: '流血',
            icon: '🩸',
            type: 'stack',
            desc: '每回合受物理傷害',
            fullDesc: '每次結束行動時都會受到流血點數的嚴重物理傷害。每輪開始可用迅捷動作耐力檢定止血（每成功數-1點）。',
            keyResist: ['耐力'],
            effects: {
                light: '每回合結束受到等於點數的物理傷害',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'fragile',
            name: '破裂',
            icon: '💎',
            type: 'stack',
            desc: '受到的傷害增加',
            fullDesc: '受到的所有傷害增加，具體數值由 GM 判定。',
            keyResist: ['耐力','決心'],
            effects: {
                light: '受到傷害增加',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'stun',
            name: '暈眩',
            icon: '💫',
            type: 'stack',
            desc: '頭暈眼花，影響行動',
            fullDesc: '每點暈眩點數使攻擊、運動、感知檢定失去 1DP，基礎速度 -1m。重度：昏迷。',
            keyResist: ['耐力','決心'],
            effects: {
                light: '攻擊/運動/感知 -1DP/點，速度 -1m/點',
                heavy: '昏迷（失去意識）',
                destruction: null
            }
        },
        {
            id: 'paralyze',
            name: '麻痺',
            icon: '⚡',
            type: 'stack',
            desc: '身體失去行動能力',
            fullDesc: '每點麻痺點數使攻擊、運動檢定、速度 -1DP，防禦依序 -1。重度：定身。',
            keyResist: ['耐力','決心'],
            effects: {
                light: '攻擊/運動/速度 -1DP/點，防禦 -1/點',
                heavy: '定身（無法移動，速度 0，失去防禦）',
                destruction: null
            }
        },
        {
            id: 'freeze',
            name: '凍結',
            icon: '❄️',
            type: 'stack',
            desc: '身體機能受低溫影響',
            fullDesc: '每點凍結點數使生理檢定 -1DP，速度 -1m，防禦依序 -1。重度：冰封。與燃燒互相抵銷。',
            keyResist: ['力量','敏捷'],
            canCounter: ['burn'],
            effects: {
                light: '生理檢定 -1DP/點，速度 -1m/點，防禦 -1/點',
                heavy: '冰封（無法移動，失去防禦，無法攻擊）',
                destruction: null
            }
        },
        {
            id: 'entangle',
            name: '糾纏',
            icon: '🕸️',
            type: 'stack',
            desc: '被外力阻礙行動',
            fullDesc: '被繩索、膠水、力場等困住。每點使攻擊、運動檢定 -1DP，速度 -1m，防禦依序 -1。重度：定身。',
            keyResist: ['力量','敏捷'],
            effects: {
                light: '攻擊/運動 -1DP/點，速度 -1m/點，防禦 -1/點',
                heavy: '定身（無法移動）',
                destruction: null
            }
        },
        {
            id: 'invisible',
            name: '隱身',
            icon: '👻',
            type: 'binary',
            desc: '無法被看見',
            fullDesc: '視覺上無法被偵測。攻擊獲得隱身加成，敵人失去對你的閃避防禦。',
            keyResist: null,
            effects: {
                light: '視覺隱形，攻擊優勢',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'haste',
            name: '加速',
            icon: '⚡',
            type: 'binary',
            desc: '行動速度加快',
            fullDesc: '速度翻倍，獲得額外動作。',
            keyResist: null,
            effects: {
                light: '速度 x2，額外動作',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'regenerate',
            name: '再生',
            icon: '💚',
            type: 'stack',
            desc: '持續恢復生命',
            fullDesc: '每回合回復等於再生點數的 HP。',
            keyResist: null,
            effects: {
                light: '每回合回復 HP',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'shield',
            name: '人民之盾',
            icon: '🛡️',
            type: 'stack',
            desc: '額外防護層',
            fullDesc: '吸收等於護盾點數的傷害。',
            keyResist: null,
            effects: {
                light: '吸收傷害',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'marked',
            name: '標記',
            icon: '🎯',
            type: 'binary',
            desc: '被鎖定為目標',
            fullDesc: '被標記的目標更容易被命中，攻擊該目標獲得加成。',
            keyResist: null,
            effects: {
                light: '易被命中',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'strength',
            name: '強壯',
            icon: '💪',
            type: 'stack',
            desc: '物理力量增加',
            fullDesc: '提升物理攻擊傷害。',
            keyResist: null,
            effects: {
                light: '傷害提升',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'endurance',
            name: '不屈',
            icon: '🌟',
            type: 'stack',
            desc: '韌性增強',
            fullDesc: '受到的傷害降低。',
            keyResist: null,
            effects: {
                light: '減免傷害',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'command_target',
            name: '指令對象',
            icon: '🔮',
            type: 'binary',
            desc: '受到指令鎖定',
            fullDesc: '被指令鎖定，特定技能會對其產生額外效果。',
            keyResist: null,
            effects: {
                light: '受到特殊效果影響',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'karma',
            name: '業',
            icon: '⚖️',
            type: 'stack',
            desc: '業力累積',
            fullDesc: '累積業力，達到一定層數引發特殊效果。',
            keyResist: null,
            effects: {
                light: '業力累積',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'command_protect',
            name: '指令加護',
            icon: '✨',
            type: 'stack',
            desc: '受到指令保護',
            fullDesc: '獲得護盾或其他防禦增益。',
            keyResist: null,
            effects: {
                light: '提升防禦力',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'tremor',
            name: '震顫',
            icon: '🔔',
            type: 'stack',
            desc: '震顫累積',
            fullDesc: '受到震顫爆發時增加暈眩點數。',
            keyResist: null,
            effects: {
                light: '被震顫爆發引爆',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'poise',
            name: '呼吸法',
            icon: '💨',
            type: 'stack',
            desc: '調整呼吸',
            fullDesc: '增加暴擊機率。',
            keyResist: null,
            effects: {
                light: '暴擊率提升',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'flaw',
            name: '破綻',
            icon: '🎯',
            type: 'stack',
            desc: '露出破綻',
            fullDesc: '被攻擊時更容易受到暴擊。',
            keyResist: null,
            effects: {
                light: '易受暴擊',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'weakness',
            name: '弱點',
            icon: '👁️',
            type: 'stack',
            desc: '被看穿弱點',
            fullDesc: '受到特定傷害增加。',
            keyResist: null,
            effects: {
                light: '承受特定屬性傷害增加',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'nails',
            name: '尖釘',
            icon: '📍',
            type: 'stack',
            desc: '被釘入尖釘',
            fullDesc: '回合結束時受到流血，並增加麻痺。',
            keyResist: null,
            effects: {
                light: '流血與麻痺累積',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'gale',
            name: '疾風',
            icon: '🌪️',
            type: 'stack',
            desc: '風之加護',
            fullDesc: '提升速度或閃避機率。',
            keyResist: null,
            effects: {
                light: '速度或閃避提升',
                heavy: null,
                destruction: null
            }
        }
    ],

    // ========== 負面與失能 ==========
    debuff: [
        {
            id: 'helpless',
            name: '無助',
            icon: '🆘',
            type: 'binary',
            desc: '完全失去自保能力',
            fullDesc: '失去所有動作，失去基礎/閃避/洞察/格擋防禦，無法反射豁免，無需動作的能力也無法啟動。任人宰割。',
            keyResist: null,
            effects: {
                light: '失去所有防禦和行動能力',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'unconscious',
            name: '昏迷',
            icon: '😴',
            type: 'binary',
            desc: '失去意識',
            fullDesc: '徹底對外界失去關注，同時陷入無助狀態。',
            keyResist: null,
            effects: {
                light: '失去意識 + 無助',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'paralyzed',
            name: '定身',
            icon: '🧊',
            type: 'binary',
            desc: '身體僵直無法移動',
            fullDesc: '無法移動（速度 0），失去基礎/閃避/格擋防禦，需要姿勢/動作的能力失敗，無法攻擊，生理檢定失敗。',
            keyResist: null,
            effects: {
                light: '完全無法行動，大幅降低防禦',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'stunned',
            name: '震懾',
            icon: '😵',
            type: 'binary',
            desc: '大腦一片空白',
            fullDesc: '失去所有動作，手中物品掉落。',
            keyResist: null,
            effects: {
                light: '無法行動，掉落持有物',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'sleep',
            name: '睡眠',
            icon: '💤',
            type: 'binary',
            desc: '進入睡眠狀態',
            fullDesc: '對外界幾乎失去關注，同時陷入無助狀態。',
            keyResist: null,
            effects: {
                light: '睡眠 + 無助',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'exhausted',
            name: '力竭',
            icon: '😩',
            type: 'binary',
            desc: '身體過度勞累',
            fullDesc: '失去移動動作，基礎速度減半，無法衝鋒和全力攻擊。',
            keyResist: null,
            effects: {
                light: '移動和攻擊能力嚴重受限',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'blind',
            name: '目盲',
            icon: '👁️',
            type: 'binary',
            desc: '失去視覺',
            fullDesc: '失去視距和視覺相關行為，失去基礎/閃避防禦，生理檢定成功數減半，調查檢定-50%，速度減半。所有單位視為隱身。',
            keyResist: null,
            effects: {
                light: '無法視物，大幅降低行動能力',
                heavy: null,
                destruction: '永久目盲'
            }
        },
        {
            id: 'deaf',
            name: '耳聾',
            icon: '🦻',
            type: 'binary',
            desc: '失去聽覺',
            fullDesc: '調查檢定-50%，聆聽檢定失敗，先攻權減半，無法使用聽覺能力，複數攻擊減值翻倍。',
            keyResist: null,
            effects: {
                light: '無法聽見，戰術能力降低',
                heavy: null,
                destruction: '永久耳聾'
            }
        },
        {
            id: 'dazzled',
            name: '目眩',
            icon: '✨',
            type: 'stack',
            desc: '眼花看不清',
            fullDesc: '視覺偵察、閱讀、攻擊受減值，精密操作受一半減值。重度：目盲。',
            keyResist: ['耐力','感知'],
            effects: {
                light: '視覺相關檢定受減值',
                heavy: '目盲',
                destruction: '永久目盲'
            }
        },
        {
            id: 'tinnitus',
            name: '耳鳴',
            icon: '🔔',
            type: 'stack',
            desc: '聽覺產生障礙',
            fullDesc: '聆聽檢定受減值。重度：耳聾。',
            keyResist: ['耐力','感知'],
            effects: {
                light: '聆聽檢定受減值',
                heavy: '耳聾',
                destruction: '永久耳聾'
            }
        },
        {
            id: 'airborne',
            name: '浮空',
            icon: '🎈',
            type: 'binary',
            desc: '被打上天',
            fullDesc: '無法移動（速度 0），失去基礎/閃避/格擋防禦。',
            keyResist: null,
            effects: {
                light: '滯空無法行動',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'prone',
            name: '倒地',
            icon: '🤕',
            type: 'binary',
            desc: '倒在地上',
            fullDesc: '爬起需要移動動作。只能爬行（參考攀爬規則）。遠程攻擊/範圍反射 +2DP，近戰防禦 -2。',
            keyResist: null,
            effects: {
                light: '移動受限，近戰易受傷，遠程難命中',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'immobilized',
            name: '禁錮',
            icon: '⛓️',
            type: 'binary',
            desc: '固定在空間某點',
            fullDesc: '基礎速度變為 0，無法移動（但保留移動動作）。',
            keyResist: null,
            effects: {
                light: '無法位移',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'slow',
            name: '失速',
            icon: '🐌',
            type: 'stack',
            desc: '基礎速度減少',
            fullDesc: '每點失速使基礎速度 -1m（影響所有衍生速度）。重度：速度降為 0，飛行則墜落進入浮空。',
            keyResist: ['力量','敏捷'],
            effects: {
                light: '速度 -1m/點',
                heavy: '速度歸零，飛行墜落',
                destruction: null
            }
        },
        {
            id: 'limb_impair',
            name: '肢體妨害',
            icon: '🦵',
            type: 'stack',
            desc: '肢體難以使用',
            fullDesc: '該肢體的力量/敏捷/手藝檢定 -1DP/點。用於移動的肢體陸行速度 -1m/點。重度：肢體殘障（完全無法使用）。',
            keyResist: ['力量','敏捷','耐力'],
            effects: {
                light: '該肢體相關檢定 -1DP/點',
                heavy: '肢體殘障（完全失能）',
                destruction: '永久殘障'
            }
        },
        {
            id: 'fatigue',
            name: '疲乏',
            icon: '😓',
            type: 'stack',
            desc: '身體過度勞累',
            fullDesc: '力量/敏捷檢定 -1DP/點，速度 -1m/點。重度：力竭。',
            keyResist: ['耐力','力量'],
            effects: {
                light: '力敏檢定 -1DP/點，速度 -1m/點',
                heavy: '力竭',
                destruction: '力敏耐屬性永久受損'
            }
        },
        {
            id: 'pain',
            name: '劇痛',
            icon: '💥',
            type: 'stack',
            desc: '巨大痛楚影響判斷',
            fullDesc: '互動/心智/意志檢定 -1DP/點，防禦依序 -1。重度：昏迷。',
            keyResist: ['耐力','決心'],
            effects: {
                light: '互動/心智/意志 -1DP/點，防禦 -1/點',
                heavy: '昏迷',
                destruction: '耐決沉屬性永久受損'
            }
        },
        {
            id: 'weak',
            name: '虛弱',
            icon: '😔',
            type: 'stack',
            desc: '身體虛弱無力',
            fullDesc: '所有物理檢定 -1DP/點。重度：無法進行劇烈活動。',
            keyResist: ['耐力'],
            effects: {
                light: '物理檢定 -1DP/點',
                heavy: '無法進行劇烈活動',
                destruction: null
            }
        },
        {
            id: 'banish',
            name: '放逐',
            icon: '🌀',
            type: 'binary',
            desc: '暫時放逐到空間狹縫',
            fullDesc: '失去所有動作和防禦，不受任何能力影響（包括傷害、增減益），但能被觀測。身上原有能力持續時間照常計算。',
            keyResist: null,
            effects: {
                light: '暫時脫離戰場',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'frozen_solid',
            name: '冰封',
            icon: '🧊',
            type: 'binary',
            desc: '被冰凍住',
            fullDesc: '無法移動（速度 0），失去基礎/閃避/格擋防禦，需要姿勢/動作的能力失敗，無法攻擊，生理檢定失敗。',
            keyResist: null,
            effects: {
                light: '完全被冰封鎖',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'limb_disabled',
            name: '肢體殘障',
            icon: '🦾',
            type: 'binary',
            desc: '肢體完全無法使用',
            fullDesc: '殘障肢體完全失能。只能影響四肢，不能影響頭部等。',
            keyResist: null,
            effects: {
                light: '該肢體完全失能',
                heavy: null,
                destruction: null
            }
        }
    ],

    // ========== 精神與心智 ==========
    mental: [
        {
            id: 'fear',
            name: '恐懼',
            icon: '😱',
            type: 'stack',
            desc: '回避恐懼來源',
            fullDesc: '對恐懼目標的互動/心智檢定 -1DP/點。恐懼目標在場時，攻擊其他目標防禦 -1/點。重度：驚懼（必須逃離）。',
            keyResist: ['決心','沉著'],
            effects: {
                light: '對恐懼目標檢定 -1DP/點，攻擊他人防禦 -1/點',
                heavy: '驚懼（必須全力逃離恐懼對象）',
                destruction: '獲得精神異常'
            }
        },
        {
            id: 'mental_bind',
            name: '精神束縛',
            icon: '🧠',
            type: 'stack',
            desc: '精神影響移動',
            fullDesc: '影響心靈。每點使心智檢定 -1DP，速度 -1m，防禦依序 -1。重度：定身。',
            keyResist: ['決心','沉著'],
            effects: {
                light: '心智檢定 -1DP/點，速度 -1m/點，防禦 -1/點',
                heavy: '定身',
                destruction: null
            }
        },
        {
            id: 'depression',
            name: '沮喪',
            icon: '😔',
            type: 'stack',
            desc: '對世界失去幹勁',
            fullDesc: '影響心靈。攻擊/技能/延長動作檢定 -1DP/點。重度：厭世。與亢奮互相抵銷。',
            keyResist: ['決心','沉著'],
            canCounter: ['excitement'],
            effects: {
                light: '攻擊和技能檢定 -1DP/點',
                heavy: '厭世（質疑存在意義）',
                destruction: null
            }
        },
        {
            id: 'excitement',
            name: '亢奮',
            icon: '😤',
            type: 'stack',
            desc: '毛躁和衝動',
            fullDesc: '影響心靈。先攻/互動/延長動作檢定 -1DP/點，防禦依序 -1。重度：狂躁。與沮喪互相抵銷。',
            keyResist: ['決心','沉著'],
            canCounter: ['depression'],
            effects: {
                light: '先攻/互動/延長動作 -1DP/點，防禦 -1/點',
                heavy: '狂躁（無法靜下心）',
                destruction: '精神異常'
            }
        },
        {
            id: 'charmed',
            name: '魅惑',
            icon: '💖',
            type: 'stack',
            desc: '沉迷於特定目標',
            fullDesc: '影響心靈。對沉迷目標的互動檢定 -1DP/點，對抗其能力的意志豁免 -1DP/點。重度：迷情。',
            keyResist: ['決心','風度'],
            effects: {
                light: '對目標互動/意志 -1DP/點',
                heavy: '迷情（服從命令）',
                destruction: null
            }
        },
        {
            id: 'fascinated',
            name: '迷情',
            icon: '😍',
            type: 'binary',
            desc: '沉迷並服從命令',
            fullDesc: '沉迷於特定目標，服從其命令。',
            keyResist: null,
            effects: {
                light: '服從特定目標',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'silence',
            name: '沉默',
            icon: '🤐',
            type: 'binary',
            desc: '無法發出聲音',
            fullDesc: '無法使用帶有「語言」「聲音」的能力，聲音相關檢定自動失敗。',
            keyResist: null,
            effects: {
                light: '無法說話和施法',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'seal',
            name: '封印',
            icon: '🔒',
            type: 'binary',
            desc: '能力被封印',
            fullDesc: '特定能量池、物品、能力、屬性、技能或生物被封印（而非消滅）。',
            keyResist: null,
            effects: {
                light: '特定能力無法使用',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'addiction',
            name: '上癮',
            icon: '💊',
            type: 'binary',
            desc: '無法離開刺激源',
            fullDesc: '經過滿足期-發作期-禁斷症狀（反復）-戒斷的流程。',
            keyResist: null,
            effects: {
                light: '需要定期接觸成癮源',
                heavy: null,
                destruction: null
            }
        },
        {
            id: 'confusion',
            name: '混亂',
            icon: '🌀',
            type: 'stack',
            desc: '思緒混亂',
            fullDesc: '心智檢定 -1DP/點。重度：隨機行動。',
            keyResist: ['決心','沉著'],
            effects: {
                light: '心智檢定 -1DP/點',
                heavy: '隨機行動',
                destruction: null
            }
        },
        {
            id: 'dominate',
            name: '支配',
            icon: '👑',
            type: 'binary',
            desc: '被他人控制',
            fullDesc: '完全受到支配者的控制，執行其命令。',
            keyResist: null,
            effects: {
                light: '執行支配者命令',
                heavy: null,
                destruction: null
            }
        }
    ]
};

// ===== 輔助函數 =====

/**
 * 根據 ID 獲取狀態定義
 * @param {string} statusId - 狀態 ID
 * @returns {object|null} 狀態定義或 null
 */
function getStatusById(statusId) {
    // 先查詢預設狀態庫
    for (const category of Object.values(STATUS_LIBRARY)) {
        const status = category.find(s => s.id === statusId);
        if (status) return status;
    }
    // 再查詢房間共享的自訂狀態
    if (typeof state !== 'undefined' && state.customStatuses) {
        const custom = state.customStatuses.find(s => s.id === statusId);
        if (custom) return custom;
    }
    return null;
}

/**
 * 獲取狀態所屬分類
 * @param {string} statusId - 狀態 ID
 * @returns {string|null} 分類 ID 或 null
 */
function getStatusCategory(statusId) {
    for (const [categoryId, statuses] of Object.entries(STATUS_LIBRARY)) {
        if (statuses.find(s => s.id === statusId)) {
            return categoryId;
        }
    }
    // 檢查自訂狀態
    if (typeof state !== 'undefined' && state.customStatuses) {
        if (state.customStatuses.find(s => s.id === statusId)) {
            return 'custom';
        }
    }
    return null;
}

/**
 * 搜尋狀態
 * @param {string} query - 搜尋關鍵字
 * @returns {array} 符合的狀態列表
 */
function searchStatuses(query) {
    if (!query || query.trim() === '') {
        return [];
    }

    const lowerQuery = query.toLowerCase();
    const results = [];

    for (const [categoryId, statuses] of Object.entries(STATUS_LIBRARY)) {
        for (const status of statuses) {
            if (
                status.name.toLowerCase().includes(lowerQuery) ||
                status.desc.toLowerCase().includes(lowerQuery) ||
                (status.fullDesc && status.fullDesc.toLowerCase().includes(lowerQuery))
            ) {
                results.push({
                    ...status,
                    category: categoryId
                });
            }
        }
    }

    // 同時搜尋房間共享的自訂狀態
    if (typeof state !== 'undefined' && state.customStatuses) {
        for (const status of state.customStatuses) {
            if (
                status.name.toLowerCase().includes(lowerQuery) ||
                status.desc.toLowerCase().includes(lowerQuery) ||
                (status.fullDesc && status.fullDesc.toLowerCase().includes(lowerQuery))
            ) {
                results.push({
                    ...status,
                    category: 'custom'
                });
            }
        }
    }

    return results;
}

/**
 * 獲取所有狀態的扁平列表
 * @returns {array} 所有狀態
 */
function getAllStatuses() {
    const all = [];
    for (const [categoryId, statuses] of Object.entries(STATUS_LIBRARY)) {
        for (const status of statuses) {
            all.push({
                ...status,
                category: categoryId
            });
        }
    }
    return all;
}

// 常用狀態使用次數追蹤
const STATUS_USAGE_KEY = 'limbus-command-status-usage';
const FAVORITE_STATUS_KEY = 'limbus-command-favorite-statuses';

/**
 * 獲取使用次數
 */
function getStatusUsage() {
    try {
        return JSON.parse(localStorage.getItem(STATUS_USAGE_KEY)) || {};
    } catch {
        return {};
    }
}

/**
 * 記錄狀態使用
 * @param {string} statusId - 狀態 ID
 */
function trackStatusUsage(statusId) {
    const usage = getStatusUsage();
    usage[statusId] = (usage[statusId] || 0) + 1;
    localStorage.setItem(STATUS_USAGE_KEY, JSON.stringify(usage));

    // 自動加入常用（使用超過 3 次）
    if (usage[statusId] >= 3) {
        addToFavorites(statusId);
    }
}

/**
 * 獲取常用狀態列表
 */
function getFavoriteStatuses() {
    try {
        return JSON.parse(localStorage.getItem(FAVORITE_STATUS_KEY)) || [];
    } catch {
        return [];
    }
}

/**
 * 加入常用狀態
 * @param {string} statusId - 狀態 ID
 */
function addToFavorites(statusId) {
    const favorites = getFavoriteStatuses();
    if (!favorites.includes(statusId) && favorites.length < 12) {
        favorites.push(statusId);
        localStorage.setItem(FAVORITE_STATUS_KEY, JSON.stringify(favorites));
    }
}

/**
 * 從常用移除
 * @param {string} statusId - 狀態 ID
 */
function removeFromFavorites(statusId) {
    let favorites = getFavoriteStatuses();
    favorites = favorites.filter(id => id !== statusId);
    localStorage.setItem(FAVORITE_STATUS_KEY, JSON.stringify(favorites));
}

console.log('📋 狀態效果資料庫已載入');
