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
    },
    {
        name: "地獄雞廚房",
        tiles: [
            { id: 90, color: '#e53935', name: '特製辣醬灘', effect: '【激辣興奮】進入時受3點火焰傷害(L傷)，但下一次近戰攻擊+2 DP。' },
            { id: 91, color: '#ffc107', name: '滾燙油鍋', effect: '【深炸】極度危險！進入或被推入受6點嚴重傷害(L傷)並獲得3點燃燒。' },
            { id: 92, color: '#ff9800', name: '全家桶堆', effect: '【雞肉補給】花費移動動作食用，回復3點L傷並獲得1層強壯。每堆限吃一次。' },
            { id: 93, color: '#78909c', name: '傳菜輸送帶', effect: '【強制位移】回合結束時強制向箭頭方向移動5格。撞牆則暈眩(下回合無法移動)。' }
        ]
    },
    {
        name: "廢品蟹海灘",
        tiles: [
            { id: 100, color: '#d4a574', name: '鬆軟沙地', effect: '【足下深陷】移動消耗x2(困難地形)。在此格閃避時，防禦-6。' },
            { id: 101, color: '#26c6da', name: '蘇打水窪', effect: '【黏稠充能】進入時選擇一個能量池恢復2點，但下回合移動速度歸零(腳被黏住)。' },
            { id: 102, color: '#a1453c', name: '銳利廢鐵堆', effect: '【破傷風】掩體+6防禦。但在此近戰攻擊或被擊退撞牆，受3點無屬性傷害。' },
            { id: 103, color: '#f9a825', name: '廢品壓縮機', effect: '【壓扁】致死機關格。每回合落下重錘，對格內單位造成12點L傷並暈眩。' }
        ]
    },
    {
        name: "20區的奇蹟",
        tiles: [
            { id: 110, color: '#e0e0e0', name: '積雪地面', effect: '【寒冷遲緩】先攻-5。若停留超過1回合，獲得1層束縛。' },
            { id: 111, color: '#546e7a', name: '煙囪煤灰雲', effect: '【致盲黑霧】無法被遠程攻擊鎖定(視線遮蔽)。但自身攻擊DP-6(看不清外面)。' },
            { id: 112, color: '#c62828', name: '紅色禮物袋', effect: '【血肉驚喜】進入時隨機：回復1~3點生命，或被肉塊怪咬一口(受3點L傷)。' },
            { id: 113, color: '#2e7d32', name: '綠色禮物袋', effect: '【酸蝕驚喜】進入時隨機：護甲防禦歸零至戰鬥結束，或武器獲得腐蝕附魔(傷害+3)。' }
        ]
    },
    {
        name: "肉斬骨斷",
        tiles: [
            { id: 120, color: '#9e9e9e', name: '劍道場中央', effect: '【決鬥儀式】若此格及相鄰格只有你與一名敵人，雙方攻擊DP+10，無法格擋或全力防禦。' },
            { id: 121, color: '#f48fb1', name: '落花堆積處', effect: '【呼吸吐納】回合開始時，若未移動，獲得4層呼吸法。' },
            { id: 122, color: '#4caf50', name: '鐵竹林', effect: '【斬斷掩體】掩體+6防禦。若受斬擊傷害，竹子被切斷，對掩體後方單位造成3點L傷。' },
            { id: 123, color: '#455a64', name: '墨痕裂隙', effect: '【骨斷】在此格被擊中時，受到的傷害+3，且必然獲得1層流血。' }
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
