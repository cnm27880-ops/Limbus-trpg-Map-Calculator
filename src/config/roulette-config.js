/**
 * Limbus Command - 幸運大轉盤獎品資料庫
 *
 * ROULETTE_PRIZES：共 20 個獎項，每個獎項包含：
 *   - id     : 唯一識別碼（1 ~ 20）
 *   - name   : 顯示名稱
 *   - type   : 'junk' | 'point' | 'fragment' | 'gacha'
 *   - color  : 轉盤切片背景色（柔和色系，相鄰不重複，首尾亦不同）
 *   - weight : 抽中權重（預設 1，方便日後 ST 調整機率）
 *
 * 顏色採用 20 等分（每等分 18 度）。陣列順序即為轉盤由頂端順時針排列的順序，
 * 因此相鄰元素（含第 1 與第 20）顏色皆不相同。
 */
const ROULETTE_PRIZES = [
    { id: 1,  name: '銘謝惠顧',                          shortName: '💨 銘謝惠顧',   type: 'junk',     color: '#F4A9A8', weight: 1 },
    { id: 2,  name: '寫著你最好朋友名字的石頭',          shortName: '🪨 摯友之石',   type: 'junk',     color: '#A8D8EA', weight: 1 },
    { id: 3,  name: '畫著尖笑小丑笑臉的簽名照',          shortName: '🤡 小丑簽名照', type: 'junk',     color: '#F9D5A7', weight: 1 },
    { id: 4,  name: '一條穿過的內褲',                    shortName: '🩲 穿過的內褲', type: 'junk',     color: '#C5E1A5', weight: 1 },
    { id: 5,  name: '一隻寫著"唐吉訶德超級厲害！！！"的襪子', shortName: '🧦 唐吉訶德襪', type: 'junk', color: '#E1BEE7', weight: 1 },
    { id: 6,  name: '說一句話就會失效的全圖超級大聲公',  shortName: '📣 拋棄大聲公', type: 'junk',     color: '#FFE0AC', weight: 1 },
    { id: 7,  name: '5點',                               shortName: '🪙 5點',        type: 'point',    color: '#B3E5D1', weight: 1 },
    { id: 8,  name: '10點',                              shortName: '🪙 10點',       type: 'point',    color: '#F8BBD0', weight: 1 },
    { id: 9,  name: '20點',                              shortName: '🪙 20點',       type: 'point',    color: '#B0C4DE', weight: 1 },
    { id: 10, name: '100點',                             shortName: '🪙 100點',      type: 'point',    color: '#FFCCBC', weight: 1 },
    { id: 11, name: '200點',                             shortName: '🪙 200點',      type: 'point',    color: '#D1C4E9', weight: 1 },
    { id: 12, name: '400點',                             shortName: '🪙 400點',      type: 'point',    color: '#DCEDC8', weight: 1 },
    { id: 13, name: '800點',                             shortName: '🪙 800點',      type: 'point',    color: '#FFE082', weight: 1 },
    { id: 14, name: '1000點',                            shortName: '🪙 1000點',     type: 'point',    color: '#A7D8DE', weight: 1 },
    { id: 15, name: 'D級支線碎片(5片可合成)',            shortName: '🧩 D級碎片',    type: 'fragment', color: '#F5B7B1', weight: 1 },
    { id: 16, name: 'C級支線碎片(10片可合成)',           shortName: '🧩 C級碎片',    type: 'fragment', color: '#C8E6C9', weight: 1 },
    { id: 17, name: 'B級支線碎片(15片可合成)',           shortName: '🧩 B級碎片',    type: 'fragment', color: '#F3C6E2', weight: 1 },
    { id: 18, name: 'A級支線碎片(20片可合成)',           shortName: '🧩 A級碎片',    type: 'fragment', color: '#AED9E0', weight: 1 },
    { id: 19, name: 'S級支線碎片(25片可合成)',           shortName: '🧩 S級碎片',    type: 'fragment', color: '#FAD7A0', weight: 1 },
    { id: 20, name: '一次人格卡池次數',                  shortName: '🎫 抽取憑證',   type: 'gacha',    color: '#D7BDE2', weight: 1 }
];

// 碎片合成規則：依碎片名稱前綴統計數量，達門檻即可合成為對應的「支線」成品
const FRAGMENT_SYNTHESIS_RULES = [
    { grade: 'D', prefix: 'D級支線碎片', required: 5,  result: 'D級支線' },
    { grade: 'C', prefix: 'C級支線碎片', required: 10, result: 'C級支線' },
    { grade: 'B', prefix: 'B級支線碎片', required: 15, result: 'B級支線' },
    { grade: 'A', prefix: 'A級支線碎片', required: 20, result: 'A級支線' },
    { grade: 'S', prefix: 'S級支線碎片', required: 25, result: 'S級支線' }
];
