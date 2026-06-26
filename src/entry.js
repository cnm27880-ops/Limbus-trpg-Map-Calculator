/**
 * Limbus Command - ES Module 入口（Phase 2 漸進模組化）
 *
 * 策略：自「葉子」工具層開始，逐步把檔案改為 ES module，並用 Vite 打包。
 * 為了與其餘仍是 classic <script> 的檔案共存：
 *   - 被轉換的模組在載入時會把公開符號掛回 window（相容層），
 *     舊檔案的全域呼叫（如 showToast()、validateUnitData()）因此不受影響。
 *   - 模組程式碼在執行期讀取 classic script 的全域（如 state）也沒問題，
 *     因為全域語彙環境對模組可見（已實測驗證）。
 *
 * 注意：本模組為 <script type="module">，會在所有 classic <script> 之後才執行（defer），
 * 因此只能轉換「沒有任何 classic script 在載入時就引用其符號」的檔案。
 * 目前批次：utils/security、utils/utils（皆為純函式、僅在執行期被呼叫）。
 */
import './utils/security.js';
import './utils/utils.js';
