/**
 * Limbus Command - 配置檔案
 * 包含地圖預設、防禦類型等常數定義
 */

// ===== 地圖主題預設 =====
const MAP_PRESETS = [
    { 
        name: "一般訓練室", 
        tiles: [
            { id: 10, color: '#2a2a30', name: '牆壁', effect: '不可通行' },
            { id: 11, color: 'rgba(67,160,71,0.15)', name: '掩體', effect: '提供掩蔽 (+4 DP)' },
            { id: 12, color: 'rgba(229,57,53,0.15)', name: '險地', effect: '每回合 1 點傷害' },
            { id: 13, color: '#111114', name: '地板', effect: '無特殊效果' }
        ]
    },
    { 
        name: "後巷深處", 
        tiles: [
            { id: 20, color: '#4e342e', name: '生鏽掩體', effect: '硬掩體：不可通行。貼牆站立時，遠程防禦+4。' },
            { id: 21, color: '#0d47a1', name: '油污積水', effect: '濕滑：防禦-4。受火焰傷害時額外+3灼燒。' },
            { id: 22, color: '#fdd835', name: '路燈/霓虹', effect: '暴露：無法隱身。無視黑暗減值。' },
            { id: 23, color: '#1b5e20', name: '垃圾堆', effect: '骯髒：移動困難。回合結束時受3點毒素(L)。' }
        ]
    },
    { 
        name: "L公司廢墟", 
        tiles: [
            { id: 30, color: '#00e676', name: 'Cogito洩漏', effect: '精神腐蝕：回合結束扣3意志，若空則3A傷。' },
            { id: 31, color: '#616161', name: '收容門', effect: '堅固掩體：防禦+6。受傷>10時粉碎。' },
            { id: 32, color: '#b71c1c', name: '活性屍塊', effect: '抓撓：只能標準移動。進入受1L傷。' },
            { id: 33, color: '#ffb300', name: '抑制力場', effect: '理智維護：精神傷害減半。' }
        ]
    },
    { 
        name: "W公司列車", 
        tiles: [
            { id: 40, color: '#00bcd4', name: '空間裂隙', effect: '相位傳送：強制傳送到隨機裂隙，結束移動。' },
            { id: 41, color: '#f06292', name: '血肉座椅', effect: '黏著：移動困難。近戰攻擊DP-6。' },
            { id: 42, color: '#ffd700', name: '頭等艙屏障', effect: '隔離：阻擋視線。需車票或20+傷害破壞。' },
            { id: 43, color: '#eeeeee', name: '時間停滯', effect: '凍結：狀態持續時間不減少。' }
        ]
    },
    { 
        name: "K公司工廠", 
        tiles: [
            { id: 50, color: '#69f0ae', name: 'HP安瓿', effect: '過度再生：回合開始回4HP，溢出轉傷害。' },
            { id: 51, color: '#81d4fa', name: '玻璃棧道', effect: '易碎：受爆炸/鈍擊時防禦-6。' },
            { id: 52, color: '#fff176', name: '監控區域', effect: '鎖定：受到的所有傷害+3。' },
            { id: 53, color: '#ffffff', name: '消毒噴嘴', effect: '淨化：進入時移除所有狀態(Buff/Debuff)。' }
        ]
    },
    { 
        name: "U公司甲板", 
        tiles: [
            { id: 60, color: '#5d4037', name: '濕滑甲板', effect: '重心不穩：攻擊DP-6。擊退距離+5。' },
            { id: 61, color: '#1a237e', name: '巨浪拍打', effect: '衝擊：回合結束受3L傷並後退1格。' },
            { id: 62, color: '#455a64', name: '魚叉發射器', effect: '掩體+6防禦。相鄰可發射魚叉(直線8格, 15DP)。' },
            { id: 63, color: '#7b1fa2', name: '共鳴音叉', effect: '共振：此格及相鄰友方近戰DP+6。' }
        ]
    },
    { 
        name: "冰雪城堡", 
        tiles: [
            { id: 70, color: '#80deea', name: '萬年玄冰', effect: '脆化：受物理傷害時傷害+3。' },
            { id: 71, color: '#ffffff', name: '巨大冰刺', effect: '刺穿：進入/經過受3L傷。' },
            { id: 72, color: '#006064', name: '凍結供品', effect: '掩體+6。破壞時周圍1格麻痺3層。' },
            { id: 73, color: '#0d47a1', name: '深淵邊緣', effect: '死亡邊界：擊退入此格視為墜落/死亡。' }
        ]
    },
    { 
        name: "血肉山丘", 
        tiles: [
            { id: 80, color: '#b71c1c', name: '蠕動屍骸', effect: '泥沼：移動困難。回合結束流血4層。' },
            { id: 81, color: '#bf360c', name: '獻祭之火', effect: '燃燒：進入獲4燃燒。N社成員攻擊DP+6。' },
            { id: 82, color: '#3e2723', name: '穿刺樁', effect: '刑具：在此被擊中額外受4意志傷。' },
            { id: 83, color: '#ffd600', name: '金枝光輝', effect: '扭曲：回合開始回2意志，全技能加骰+1。' }
        ]
    }
];

// ===== 防禦類型定義 =====
const DEF_TYPES = [
    // 物理類
    { id: 'armor', name: '盔甲', type: 'physical' },
    { id: 'shield', name: '盾牌', type: 'physical' },
    { id: 'natural', name: '天生', type: 'physical' },
    // 敏捷類
    { id: 'base', name: '基礎', type: 'agility' },
    { id: 'dodge', name: '閃避', type: 'agility' },
    { id: 'block', name: '格擋', type: 'agility' },
    { id: 'shieldBlock', name: '盾擋', type: 'agility' },
    // 超自然類
    { id: 'force', name: '力場', type: 'supernatural' },
    { id: 'deflect', name: '偏斜', type: 'supernatural' },
    { id: 'magicArmor', name: '法甲', type: 'supernatural' },
    // 其他類
    { id: 'cover', name: '掩蔽', type: 'other' },
    { id: 'insight', name: '洞察', type: 'other' },
    { id: 'other', name: '其他', type: 'other' }
];

// ===== 連線配置 =====
const CONNECTION_CONFIG = {
    STORAGE_KEY: 'limbus_session',
    MAX_RECONNECT_ATTEMPTS: 10,
    HEARTBEAT_INTERVAL: 5000,  // 5 秒
    RECONNECT_DELAY: 2000      // 2 秒基礎延遲
};

// ===== 地圖預設尺寸 =====
const MAP_DEFAULTS = {
    WIDTH: 15,
    HEIGHT: 15,
    MIN_SIZE: 5,
    MAX_SIZE: 50,
    GRID_SIZE: 50  // 像素
};
