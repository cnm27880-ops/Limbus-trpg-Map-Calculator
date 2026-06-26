import { defineConfig } from 'vite';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 過渡期外掛：把 classic <script> 仍在使用的 src/ 原始檔複製進 dist/。
 *
 * 原因：目前 index.html 的 30 個 <script> 仍是 classic script（非 ES module），
 * Vite/Rollup 無法 bundle，因此不會自動複製到 dist。
 * 在 Phase 2 模組化完成前，這個外掛確保 `vite build` 仍能產出「可運作的」dist。
 * 等檔案逐步改為 import/export 後，Vite 會自行 bundle，本外掛即可移除。
 */
function copyLegacyScripts() {
  return {
    name: 'copy-legacy-scripts',
    apply: 'build',
    closeBundle() {
      const root = resolve(import.meta.dirname);
      const srcDir = resolve(root, 'src');
      const outDir = resolve(root, 'dist', 'src');
      if (existsSync(srcDir)) {
        cpSync(srcDir, outDir, { recursive: true });
      }
    },
  };
}

/**
 * Vite 設定（Phase 2 地基）
 *
 * 設計原則：非破壞性引入
 * - 目前專案仍是「全域變數 + <script> 嚴格載入順序」架構。
 * - Vite 在這個階段只負責「本地開發伺服器」與「未來模組化/打包」的地基，
 *   不改變既有的全域變數寫法；index.html 中的 classic <script> 維持原樣即可運作。
 * - 原始靜態檔案（直接以 index.html 開啟或靜態主機部署）仍可正常運行，
 *   Vite 屬於「附加能力」，不取代現有部署方式。
 *
 * 之後 Phase 1 的 canvas 重寫與 Phase 2 的 ES6 模組化，
 * 可直接以 <script type="module"> 漸進加入，與舊的 classic script 共存。
 */
export default defineConfig({
  plugins: [copyLegacyScripts()],

  // 使用相對路徑：相容於 GitHub Pages 子路徑與「直接開啟靜態檔案」的情境
  base: './',

  server: {
    port: 5173,
    open: false,
    host: true,
  },

  preview: {
    port: 4173,
    host: true,
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 對應 Firebase compat 與目前程式碼的瀏覽器相容性需求
    target: 'es2019',
    // 沿用既有資源（避免把大型 base64/資源 inline）
    assetsInlineLimit: 0,
  },
});
