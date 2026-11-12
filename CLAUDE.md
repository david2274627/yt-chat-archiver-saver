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

## 工作流程
- 依 SPEC 第 8 節任務順序（T0 → T1 → D1 → D2 → T2 … T9）；每個任務一個（或數個）小 commit。
- 標示 ⏸ 的任務完成後必須停下，給使用者具體測試步驟，等回覆再繼續。
- 每完成一項 F-xx 或 T-xx，更新 `docs/test-checklist.md` 對應項目狀態。
- 無法自動化驗證的項目（需真實直播）列在 PR / 回報中，請使用者手動驗證，不可宣稱已通過。

## 版本規則（Semantic Versioning）
- `manifest.json` 的 `version`、根目錄 `VERSION`、`CHANGELOG.md` 三處必須一致。
- MAJOR：資料庫不相容變更；MINOR：新功能或重大修正（如 F-10）；PATCH：小修正、選擇器更新。
- 規格書版本（`SPEC.md` 表頭 `規格版本 vNN`）在規格內容改動時 +1，並於 CHANGELOG 記錄。
- 發版：更新三處版本 → commit `release: vX.Y.Z` → push。
- `CHANGELOG.md` 是版本資訊的主要紀錄，每個版本段落需註明對應 commit 短 SHA。
- Git tag（`vX.Y.Z`）為選用：雲端 Claude 工作階段推送 tag 會被擋，tag 由使用者在本機執行 `git tag vX.Y.Z <sha> && git push origin --tags` 補上。

## Commit 訊息格式
```
<類型>(<範圍>): <摘要>

類型：feat / fix / refactor / docs / test / release / chore
範圍：chat-frame / top-frame / viewer / bg / db / popup / spec
例：fix(top-frame): 改用 clip-path 裁切原生聊天室 (F-10)
```
