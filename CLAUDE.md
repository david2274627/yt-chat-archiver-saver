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
- **依賴 YouTube DOM 的功能以 `docs/youtube-dom-notes.md` 為準**（實機確認的結構，標註日期與 Chrome 版本）。筆記沒有記錄的結構一律標「待實機確認」，不得憑猜測寫選擇器；模擬頁的 YouTube 內部結構也只能依筆記建構。
- **禁止**改變 `iframe#chatframe` 高度，或對 `yt-live-chat-app` / `#contents` / `#chat-messages` 設 `height`、`display`（見 SPEC 6.1）。
- 使用者文字禁止未跳脫寫入 `innerHTML`。
- **Console 輸出（任何等級）不得包含**訊息文字、使用者名稱、handle、頻道名稱、影片標題（T3.8）。只輸出筆數、元件標籤、屬性名稱、時間、`videoId`、錯誤原因。F-20 P8 會收集本套件的 `warn`／`error`；新增 `console.*` 前先確認參數。
- **診斷輸出分級**（SPEC 第 7 節「相容」）：content script 的 `console.warn`／`error` 會累積在擴充功能「錯誤」頁。`warn` 只用於「該頁確定有聊天室、預期應存在卻找不到且影響功能」；沒有聊天室、可退回、PoC 提示用 `info`；診斷細節與舊版相容用 `debug`。`S.warnOnce(key, detail, level)` 預設 `info`。

## 設計
- 全新重寫，不沿用 v2.6.0 程式碼與樣式；UI 依 SPEC 第 10 節。
- 顏色、字級、間距、圓角一律使用 `src/styles/tokens.css` 的 CSS 變數，元件內不得寫死色碼。
- 寫 UI 程式前必須先完成 D1 設計稿並取得使用者選定方向。
- 不使用 YouTube 標誌或模仿 YouTube 品牌識別；設計稿使用虛構假資料。
- **不遮擋影片與頁面主體**（SPEC 10.1 原則 6）：YouTube 頁面上的套件 UI 只能在聊天室區域內，禁止 `position: fixed` 或任何浮在影片／標題／留言區上的元素；PoC、測試工具、設計稿同樣適用。

## 資料保護
- **絕不移除**使用者 Chrome 裡的本套件項目（會連同 IndexedDB 永久刪除），也不建議對同一路徑重新「載入未封裝項目」；只能 🔄 重新載入。
- v2.6.0 舊資料庫 `YTLiveChatArchiverDB_V6` 只能唯讀複製（F-11），不得升級、修改、刪除。
- `bak/` 與任何 IndexedDB 備份是私人聊天資料：已列入 `.gitignore`，**禁止 commit**；`git add` 一律指定檔案，不用 `git add -A` / `git add .`。

## 瀏覽器
- 只操作自己開啟的分頁；每次點擊或輸入前，先確認該分頁網址是預期的頁面（本機檔案或 localhost 模擬頁）。
- 能用頁面腳本（指定分頁 ID）完成的驗證，就不要用座標點擊或鍵盤輸入。
- 不得在登入、付款、帳號設定等頁面點擊或輸入。
- 發現操作到錯誤分頁時立即停止，並在回報中說明。

## 程序與外部測試（審查十一 6.2，2026-11-17）
- **不得結束或修改不是自己啟動的程序**。結束程序一律以自己啟動時記錄的 PID 為準，**不得以程式名稱批次結束**（例如 `taskkill /IM msedge.exe`、`Stop-Process -Name chrome`）。
- 啟動其他瀏覽器、自動化瀏覽器（DevTools 協定、Playwright 等），或對外部網站連線的測試，**先在報告或對話中徵得使用者同意**；同意後只用暫存設定檔、不登入、不碰使用者既有的設定檔。
- 發生上述情況（含意外）時，寫入當輪報告的「事件」節。

## 工作流程
- 依 SPEC 第 8 節任務順序（T0 → T1 → D1 → D2 → T2 … T9）；每個任務一個（或數個）小 commit。
- 標示 ⏸ 的任務完成後必須停下，給使用者具體測試步驟，等回覆再繼續。
- 每完成一項 F-xx 或 T-xx，更新 `docs/test-checklist.md` 對應項目狀態。
- 無法自動化驗證的項目（需真實直播）列在 PR / 回報中，請使用者手動驗證，不可宣稱已通過。
- 依賴 YouTube DOM 的功能（量測、錨點、彈窗偵測、擷取）：模擬頁結果只能標「**模擬頁：邏輯檢查通過；真實結構待實機**」，實機確認後才可標 ✅。使用者貼回的新結構資料寫入 `docs/youtube-dom-notes.md`（標註日期與 Chrome 版本），原始診斷輸出存於 `docs/diag/`（只含標籤、id、屬性名、尺寸，不含訊息文字）。
- **每輪作業完成後必須寫成 `.md` 報告**，放在 `docs/reports/YYYY-MM-DD-<主題>.md`，與成果一起 commit、push，並傳給使用者；對話中只附簡短摘要。報告至少包含：
  1. 摘要與目前關卡
  2. 完成項目與對應 commit 短 SHA
  3. 驗證結果（自動檢查 / 待使用者實測，分開列）
  4. 問題、事件與偏離規格之處
  5. 需要使用者做的事（含回報格式）
  6. 下一步

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
