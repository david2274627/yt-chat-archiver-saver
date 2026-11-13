# 版本紀錄

格式依循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，版本號採 [語意化版本](https://semver.org/lang/zh-TW/)。

## [未發布] — 目標 3.0.0（全新重寫）
### 開發進度
- T0 專案骨架（commit `8439208`）：`manifest.json`（3.0.0-dev）、`src/` 結構、`selectors.js`、`constants.js`、空白 `tokens.css`、套件圖示（自繪 SVG → PNG）。
- T1 clip-path PoC（commit `1ea108e`）：`src/poc/clip-path-poc.js`、`docs/poc-clip-path.md`（待使用者在真實直播實測）。
- 審查修正（`docs/review-2026-11-13.md`）：
  - v2.6.0 舊資料保護與結構記錄（commit `e960c82`）：備份第 0 步、禁止移除擴充功能項目、`docs/legacy-v2.6.0-data.md`、`DB_NAME` 改為 `ytcas-v3`、`.gitignore` 排除 `bak/`。
  - PoC 補強（commit `2bd8f92`）：下層可切換 div / 擴充功能 iframe、完全不裁切、付款視窗位置觀察。
  - 縮小 `web_accessible_resources`（commit `a3c66e8`）。
  - 進度報告與 CHANGELOG commit 對照（commit `34aa959`）。
  - CLAUDE.md 新增「資料保護」「瀏覽器」操作規則（本段落所在的 commit）。

### 規格 v22（commit `88dc272`、`a3c66e8`，2026-11-13）
- 6.2／T1：收起狀態 clip 改為從 `iframe#chatframe` 底邊往上露出 `inputHeight`，「隱藏聊天室」列一併露出。
- 6.3：新增 top frame 付款視窗偵測（`ytd-popup-container`），6.2 狀態表新增對應列。
- 新增 F-11「v2.6.0 舊資料遷移與 JSON 匯入」；v3 資料庫改名 `ytcas-v3`，不得升級/修改/刪除舊資料庫；v3 JSON 匯出加 `formatVersion`。
- 第 7 節：`web_accessible_resources` 只開放 `src/viewer.html`，`use_dynamic_url: true`；4.3 的 top 端 origin 檢查同時接受 iframe `src` 的 origin（動態 ID）。
- 第 8 節：T2 加入 F-11 自動遷移、T7 加入 JSON 匯入 UI、T9 加入移除 PoC。

### 規格 v21（commit `5a7b435`，2026-11-13）
- viewer（擴充功能頁面）可直接唯讀 IndexedDB，寫入仍只由 background 執行。
- frame 間訊息 origin 檢查改為區分 youtube.com 與擴充功能 origin；補上訊息 id 雜湊與直播 `videoOffsetSec` 推算規則。
- 圖片白名單加入 `fonts.gstatic.com`、`www.gstatic.com`。
- 匯出離線 HTML 的圖片改為內嵌 data URL，新增圖片網域 host_permissions（經使用者同意）。
- CLAUDE.md：本機發版直接打 tag；開發期間版本號加 `-dev`。

### 規格 v20（commit `704b91f`，2026-11-13）
- 改為**全新重寫**、交由本機 Claude Code 開發，不沿用 v2.6.0 程式碼；目標版本改為 3.0.0。
- 新增第 10 節「UI 視覺設計規格」：設計原則、深淺色主題、token 命名、元件規格、無障礙、設計稿交付方式。
- 任務清單重排：T1 clip-path PoC 最先驗證，D1/D2 設計稿先行，⏸ 標示需使用者實測的關卡。
- 新增 `docs/HANDOFF.md`：本機 Claude Code 交接與測試流程。

### 規格 v19（commit `5b48eb6`，2026-11-13）
- 規格書 v19：重寫為可交給 Claude Code 的開發規格（`SPEC.md`），新增資料模型、訊息協定、驗收條件與任務清單。
- F-10 改採「原生 iframe 完整高度 + `clip-path` 動態裁切」（方案 A），方案 B 列為備案。
- 新增 `selectors.js` / `constants.js` 集中管理選擇器與常數的要求。
- 機器人排除名單擴充：Nightbot、StreamElements、Streamlabs、Moobot、Fossabot。

### 待開發
- F-10 直播中保留原生輸入區、表符、SC、超級貼圖、會員里程碑。

## [2.6.0] — 規格 v18
### 已完成（實測正常）
- F-01 聊天室 DOM 修剪（上限 45 則，每 3.5 秒）
- F-02 富媒體歷史保存（IndexedDB）
- F-03 自動解析頻道名稱與頭像（快取 7 天）
- F-04 前後台介面分離
- F-05 分類膠囊列（全部 / Super Chat / 實況主降落，排除機器人）
- F-06 搜尋列（使用者過濾 + 關鍵字高亮）
- F-07 懸浮主播置頂卡片
- F-08 VOD 時間軸雙向同步
- F-09 單一「開啟/關閉優化面板」按鈕

### 已知問題
- F-10 直播中開啟優化面板時原生輸入區空白、彈窗重疊或錯位（v13～v18 嘗試皆失敗，詳見 `docs/handover-v18.md`）。
