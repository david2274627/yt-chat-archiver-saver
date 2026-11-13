# CLAUDE.md — 本 repo 給 Claude Code 的工作規則

## 先讀
1. `SPEC.md`（規格，唯一真實來源）
2. `CHANGELOG.md`（目前版本與歷史）
3. `docs/handover-v18.md`（舊交接文件，只作背景參考，與 SPEC 衝突時以 SPEC 為準）

## 語言
- 與使用者溝通、commit 訊息、文件：**台灣繁體中文**。
- 程式碼識別字、註解可用英文；UI 文字一律繁體中文。

## 技術限制
- Chrome MV3，純 JavaScript（不引入打包工具、框架或 npm 相依，除非 SPEC 改版允許）。
- `youtube.com` 頁面內的腳本不得直接存取聊天資料 IndexedDB，必須透過 `background.js`。
- 所有 YouTube DOM 選擇器只能寫在 `selectors.js`。
- **禁止**改變 `iframe#chatframe` 高度，或對 `yt-live-chat-app` / `#contents` / `#chat-messages` 設 `height`、`display`（見 SPEC 6.1）。
- 使用者文字禁止未跳脫寫入 `innerHTML`。

## 設計
- 全新重寫，不沿用 v2.6.0 程式碼與樣式；UI 依 SPEC 第 10 節。
- 顏色、字級、間距、圓角一律使用 `src/styles/tokens.css` 的 CSS 變數，元件內不得寫死色碼。
- 寫 UI 程式前必須先完成 D1 設計稿並取得使用者選定方向。
- 不使用 YouTube 標誌或模仿 YouTube 品牌識別；設計稿使用虛構假資料。

## 資料保護
- **絕不移除**使用者 Chrome 裡的本套件項目（會連同 IndexedDB 永久刪除），也不建議對同一路徑重新「載入未封裝項目」；只能 🔄 重新載入。
- v2.6.0 舊資料庫 `YTLiveChatArchiverDB_V6` 只能唯讀複製（F-11），不得升級、修改、刪除。
- `bak/` 與任何 IndexedDB 備份是私人聊天資料：已列入 `.gitignore`，**禁止 commit**；`git add` 一律指定檔案，不用 `git add -A` / `git add .`。

## 瀏覽器
- 只操作自己開啟的分頁；每次點擊或輸入前，先確認該分頁網址是預期的頁面（本機檔案或 localhost 模擬頁）。
- 能用頁面腳本（指定分頁 ID）完成的驗證，就不要用座標點擊或鍵盤輸入。
- 不得在登入、付款、帳號設定等頁面點擊或輸入。
- 發現操作到錯誤分頁時立即停止，並在回報中說明。

## 工作流程
- 依 SPEC 第 8 節任務順序（T0 → T1 → D1 → D2 → T2 … T9）；每個任務一個（或數個）小 commit。
- 標示 ⏸ 的任務完成後必須停下，給使用者具體測試步驟，等回覆再繼續。
- 每完成一項 F-xx 或 T-xx，更新 `docs/test-checklist.md` 對應項目狀態。
- 無法自動化驗證的項目（需真實直播）列在 PR / 回報中，請使用者手動驗證，不可宣稱已通過。

## 版本規則（Semantic Versioning）
- `manifest.json` 的 `version`、根目錄 `VERSION`、`CHANGELOG.md` 三處必須一致。
- MAJOR：資料庫不相容變更；MINOR：新功能或重大修正（如 F-10）；PATCH：小修正、選擇器更新。
- 規格書版本（`SPEC.md` 表頭 `規格版本 vNN`）在規格內容改動時 +1，並於 CHANGELOG 記錄。
- 開發期間：`manifest.json` 為 `version: X.Y.Z` + `version_name: X.Y.Z-dev`，`VERSION` 為 `X.Y.Z-dev`；發版時拿掉 `-dev`。
- 發版：更新三處版本 → commit `release: vX.Y.Z` → push → `git tag vX.Y.Z && git push origin vX.Y.Z`。
- `CHANGELOG.md` 是版本資訊的主要紀錄，每個版本段落需註明對應 commit 短 SHA。
- Git tag（`vX.Y.Z`）：本機 Claude Code 發版時直接打 tag 並推送（雲端工作階段推 tag 會被擋，才由使用者補上）。

## Commit 訊息格式
```
<類型>(<範圍>): <摘要>

類型：feat / fix / refactor / docs / test / release / chore
範圍：chat-frame / top-frame / viewer / bg / db / popup / spec
例：fix(top-frame): 改用 clip-path 裁切原生聊天室 (F-10)
```
