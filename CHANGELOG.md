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
  - CLAUDE.md 新增「資料保護」「瀏覽器」操作規則（commit `df2a4fd`）。
  - 每輪 `.md` 報告規則與審查修正回報（commit `6384aa7`）。
- T1 實測通過，**F-10 定案方案 A**（`docs/review-2026-11-14.md`）：
  - 規格 v23（commit `56cff01`）。
  - T1 實測結果與方案 A 定案記錄（commit `de3a999`）。
  - PoC 改為錨定聊天室內部、移除浮動控制盒、自動量測輸入區（commit `f1679d6`）。
  - 本輪報告 `docs/reports/2026-11-14-t1-results.md`（commit `4c7ab8c`）。
- v24：F-09 多重錨點與付款視窗定案（`docs/review-2026-11-14-2.md`）：
  - 規格 v24（commit `f3e6399`）。
  - PoC 開關改為多重錨點、找不到時警告、付款視窗選擇器（commit `d0ebc80`）。
  - 影片下方「聊天室」卡片錨點選擇器（commit `5510fe8`）。
  - 文件整理：補回遺失的審查內容、`.gitignore` 排除 `Claude outputs/`（commit `af938a7`）。
- v24 補充：v23 PoC 補測結果（`docs/review-2026-11-14-3.md`）：
  - PoC 底部互動區量測 v2、版面診斷、摺疊保護（commit `6c9714c`）。
  - 規格 v24 補充：`bottomZoneHeight`、聊天室摺疊狀態、劇院模式監看（commit `dcc27fe`）。
  - 文件：v23 補測結果、新補測步驟、付款視窗診斷 JSON（commit `7fa0332`）。
  - 本輪報告 `docs/reports/2026-11-14-v24-f09-anchors.md`（commit `4a371e3`）。
- v25：v24 PoC 實機量測誤判修正（`docs/review-2026-11-15.md`）：
  - `selectors.js` 依實機結構筆記更新（commit `3e55e36`）。
  - PoC 量測 v3（白名單）與合理性退回、頂部列按鈕位置修正（commit `fc5c17b`）。
  - PoC 控制列單列化與鍵盤調整快速鍵（commit `8c44fe9`）。
  - 規格 v25、DOM 筆記與診斷檔、CLAUDE.md 規則（commit `4cf37c3`）。
  - 補測步驟 v24.1、快速鍵清單、附錄 C chat frame 結構腳本、test-checklist（commit `6bd6b3b`）。
  - 本輪報告 `docs/reports/2026-11-15-v25-measure-fix.md`（commit `162bfc6`）。
- **T1 通過（2026-11-15）**，v26（`docs/review-2026-11-15-2.md`）：
  - PoC v24.2：投票卡 `#action-panel` 入白名單、搬移後重新初始化與看門狗（commit `c2d9ca5`）。
  - 規格 v26、DOM 筆記、補測原文、T1 定稿（本段落所在的 commit）。

### 規格 v26（2026-11-15，依 `docs/review-2026-11-15-2.md`）
- **T1 通過並關閉**（v24.1 PoC 實機補測）；`docs/poc-clip-path.md` 新增「T1 定稿」。
- 6.3：投票卡 `#chat > #action-panel` 入底部互動區白名單（實機露出 239px）；合理性檢查改為 60% 規則只套用非白名單來源、量測過期判定。
- 6.2：聊天室摺疊／退讓條件補充（劇院模式一律退讓、面板剩餘 < 80px）；面板最小高度規則（80～160px 時仍完整露出原生互動區）。
- 6.4：劇院模式聊天室固定 402×152（與視窗大小無關）；iframe 搬移會重新載入 → 重新初始化流程與每秒看門狗。
- 6.5 AC 14：劇院模式退讓期間仍持續存檔與修剪。
- 10.4：退讓狀態的按鈕樣式（低調停用，不用紅色）；10.8：D1 需反映實機版面（340／360／450px、三種底部互動區、劇院模式退讓）。
- F-02：重播以 `#timestamp` 取得 `videoOffsetSec`；略過 `placeholder-item`；會員訊息欄位對應；收到贈送會員歸入 `membership`。
- F-12：VOD 重播同樣適用。
- 1.3：劇院模式的替代檢視方式列為 3.0.0 之後待議。
- `docs/youtube-dom-notes.md`：投票卡位置、劇院模式小框排版、三種版面尺寸、VOD 重播結構與新確認的訊息元件；`docs/diag/` 加入補測原文。

### 規格 v25（2026-11-15，依 `docs/review-2026-11-15.md`、`docs/youtube-dom-notes.md`）
- 新增 `docs/youtube-dom-notes.md`（實機 DOM 結構筆記，`selectors.js` 與模擬頁的唯一依據）與 `docs/diag/`（原始診斷輸出）。
- 第 9 節／CLAUDE.md：依賴 YouTube DOM 的功能以筆記為準；模擬頁結果只能標「邏輯檢查通過」，實機確認後才可標 ✅。
- 6.3 底部互動區改為**白名單**量測（`yt-live-chat-banner-manager`、`#panel-pages`、`#input-panel`；覆蓋層 `ytls-widget-overlay-manager` 只計可見子元素），加合理性退回（> iframe 高 60% 或面板可見 < 160px）。v24 近似法在實機得到 545px。
- 6.3 彈窗選擇器定案：`#emoji`、`#product-picker`、`#pickers` 內的 `$` 選單（長在 `#input-panel` 內）。
- 6.4 版面狀態判斷屬性與三種版面的父容器、尺寸（劇院模式聊天室 402×152）。
- F-09：頂部列按鈕插在 `#live-chat-header-context-menu`（⋮）之前；不得放進 `#view-selector`。
- F-02：置頂來源確認為 `yt-live-chat-banner-manager`；直播 `#timestamp` 有值（CSS 隱藏），讀文字還原 `timestampAbs` 並做跨日校正；身分改讀 `author-type` 屬性；未知訊息元件 `console.info` 一次並存為 `system`。
- F-03／4.1：直播訊息沒有作者連結，以 `@handle` 為鍵，`authorUrl` 由 handle 組成。
- 新增 **F-12 自動切換「即時聊天室」**（使用者 2026-11-15 決定）與 AC；T5 納入。
- 1.3 非目標：套件只能保存 YouTube 實際送到此分頁的訊息。

### 規格 v24（2026-11-15，依 `docs/review-2026-11-14-2.md`）
- **v23 依據的審查內容有遺失，本版補回**：repo 內的 `docs/review-2026-11-14.md` 是修訂前的舊版，缺少付款視窗診斷結果與 Holodex+ 說明。
- F-09 依目前 YouTube 版面（聊天室右上角 `✕`、無「隱藏聊天室」列、影片下方「聊天室／開啟面板」卡片）改為多重錨點：聊天室頂部列 → 優化面板頂部列 → 影片下方卡片 → 舊版「隱藏聊天室」列 → popup／快速鍵備援；每個錨點找不到都要 `warnOnce()`。
- F-09 預設開啟已決：有聊天室的影片頁預設開啟，不記住關閉狀態。
- 4.3 新增 frame 訊息 `TOGGLE_PANEL`（chat frame → top）。
- 6.3／6.4：頁面層付款視窗定案為 `body > div#buyFlowDivId`（內含跨來源 `iframe#buyFlowDivIdIframe`），移除 `ytd-popup-container > *` 萬用規則；明確選擇器為主、fixed 掃描為輔。
- 6.5 AC 新增第 10、11 條（兩種版面都有開關、預設開啟）。
- 第 9 節：回歸測試需在有／無 Holodex+ 各測一次，並測目前版面與舊版面。
- 10.4 注入按鈕改為三種形態。
- 依 `docs/review-2026-11-14-3.md`（v23 PoC 補測結果，併入 v24、不另開 v25）：
  - `inputHeight` 改名 **`bottomZoneHeight`**（底部互動區高度）＝ iframe 底邊 − 最高的可見底部錨定元素頂端；實測輸入列 56px 上方還有置頂訊息列（合計約 114px），有投票卡時超過 240px。候選清單 `chat.bottomZone` 待診斷後填入。
  - 6.2 新增「聊天室摺疊」狀態：iframe 太矮或露出值 ≥ iframe 高度 → 解除 clip、隱藏面板；露出值 clamp 在 `[0, iframe 高度]`。
  - 6.4 劇院模式／窄版面：監看 `ytd-live-chat-frame` 屬性與子元素、`ytd-watch-flexy` 屬性與聊天室搬移。
  - 6.3 付款視窗：`#buyFlowDivId`（主）＋`body > .modal-dialog-bg`（遮罩，輔助）。
  - F-07 與新版面原生置頂列不得衝突；F-02 `chat.bannerContainer` 待確認。
  - 6.5 AC 新增第 12（置頂列、投票卡完整露出）、13 條（劇院模式／窄版面可用或自動退讓）；第 9 節新增必測情境。

### 規格 v23（commit `56cff01`，2026-11-14）
- T1 實測通過，**F-10 定案方案 A**（Chrome 157.0.8103.51）。
- 6.2／6.4：面板改為插入 `ytd-live-chat-frame` 內（`iframe#chatframe` 前一個兄弟），`clip-path` 改套在 `iframe#chatframe`，不再換算座標或輪詢重排（修正劇院模式錯位）。
- 6.2 狀態表：頁面層付款視窗（`topPopupOpen`）開啟期間 clip 維持解除，兩邊都關閉才回到收起。
- 6.3：`inputHeight` 一律以 `#input-panel` 實際高度動態量測，禁止常數（實測出現 84px 與 58px）。
- 6.4：頁面層「完成購買程序」視窗不在 `ytd-popup-container` 內，選擇器待補測診斷後定案。
- 10.1 新增原則 6「不遮擋影片與頁面主體」；第 7 節新增「版面侵入」列，列為每個 ⏸ 關卡檢查項。
- F-09 新增待決事項：預設開啟與記住狀態。
- F-11：遷移資料的時間碼與 VOD 同步為盡力而為。
- 第 8 節 T1 標註通過。

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
