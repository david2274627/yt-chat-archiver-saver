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
  - 規格 v26、DOM 筆記、補測原文、T1 定稿（commit `6162700`）。
- D1 設計稿 `design/mockups.html`：方向 A「沉穩工具感」／方向 B「柔和現代感」× 淺色／深色（commit `3a6690b`）。**使用者 2026-11-15 選定方向 B**。
- v27（`docs/review-2026-11-15-3.md`）：
  - 規格 v27、附錄 D 訊息元件清單腳本、test-checklist（commit `70ce55c`）。
  - D2 `tokens.css` 定稿（方向 B 淺色／深色、`prefers-reduced-motion`）、`src/theme.js` 主題系統、`constants.js` 加入 `GIFT`／`THEME`、`tools/check-contrast.js`（48 組對比度全數通過）（commit `be1161f`）。
  - D2 設計稿更新：只保留方向 B，載入套件的 `tokens.css`／`components.css`／`theme.js`；正式「自動／淺色／深色」按鈕（自動即時跟隨系統）；禮物、「👑 會員」膠囊（300～450px 單列）、已刪除訊息、待機室／結束後分隔線、⋯ 選單、場次收錄次數與覆蓋範圍、清空重錄確認、後台與 popup 主題設定；新增 `src/styles/components.css`；對比度檢查增加徽章組合為 58 組，淺色 `owner`／`member` 加深以通過（commit `bc6475d`）。
  - `.gitignore` 加入 `_to_delete/`（commit `d754545`）。
  - 本輪報告 `docs/reports/2026-11-15-d2-tokens.md`（commit `535c8d4`）。**D2 通過（2026-11-15）**。
- v28（`docs/review-2026-11-15-4.md`）：
  - 規格 v28、HANDOFF／README 加註「不要移除擴充功能」、本審查報告（commit `d9e5ff0`）。
  - **T2** `db.js`／`background.js`（本段落所在的 commit）：`DB_VERSION` 2 與 v1→v2 遷移、`capture_sessions`、F-14 合併規則（別名、跨來源後備去重、`deleted`、`phase` 事後重算）、F-18 `versions`／`offsets`／`linkedVideos`、F-19 `popout` 與覆蓋範圍合併、F-11 唯讀遷移與 JSON 匯入（v2.6.0／v3）、v3 匯出 `formatVersion` 2、F-15 暫停判斷、F-16 用量與批次刪除、頻道名稱解析佇列（`storage.session`）、新 runtime 訊息與管理操作權限檢查；`selectors.js` 新增 `messageTypeByTag`；測試頁 `tools/tests/test-db.html`（30 項通過）。

### 規格 v28（2026-11-15，依 `docs/review-2026-11-15-4.md`）
- **D2 通過**（含「自動」跟隨 Windows 即時切換實機確認）；v27 的三項補充設計決定（`rawTag`、清空時保留場次基本資料、offset 為 null 不做指紋去重）使用者同意。
- F-01：修剪改為 **MutationObserver 回呼內數量觸發為主、`setInterval` 保底**（背景分頁計時器節流）；新增 AC「背景 30 分鐘仍 ≤ 50」。F-02：批次滿 50 筆立即送；**啟動時回溯擷取 `#items` 既有訊息**（通則）。
- 3.2：Service Worker 休眠對策（立即寫入 IndexedDB、頻道解析佇列存 `chrome.storage.session`、content script 重試 3 次、遷移分批可重跑）。
- 1.3：聊天室關閉（`✕`）時不收錄；VOD 只收錄播放過的部分，「整部下載」列為 3.0.0 之後待議。
- 新增 **F-15 收錄範圍與暫停**（預設全部自動收錄；`captureEnabled` 存 sync、`captureExcludedChannels` 存 local）、**F-16 儲存空間管理**（用量、各場次大小、批次刪除、2 GB 提醒、不自動刪除）、**F-17 每週自動備份**（`.json.gz`、重試 3 次、失敗才通知、保留 4 份、下載子資料夾／自選資料夾 PoC）、**F-18 VOD 版本**（原始時間碼永不改寫、`versions`／`offsets`／`linkedVideos`）、**F-19 彈出式聊天室視窗**（三種環境判斷、`popout` 收錄來源、降落情境、中途開關的連續性與自動接手、彈出視窗面板 T6-c PoC）。
- F-14：重播 offset 更新限 v1；`system` 可被已知類型取代；後備去重**只跨來源**、只在 v1 時間軸、合併時記入 `aliasIds`；v2.6.0 舊 id 以去前綴的 YouTube id 作別名；新增 AC 8。
- 4.1：streams 新增 `channelHandle`、`popoutCaptureCount`、`approxBytes`、`versions`、`linkedVideos`；messages 新增 `offsets`、`aliasIds`（multiEntry 索引）；`capture_sessions` 新增 `popout`、`versionId`、`lastWriteAt`、`firstTs`／`lastTs` 與覆蓋範圍合併。4.2 新增 `GET_CAPTURE_POLICY`、`GET_STORAGE_USAGE`、`DELETE_STREAMS`、`LIST_CAPTURE_SESSIONS`、`MIGRATE_LEGACY`、`IMPORT_DATA`、`SET_VERSION_LABEL`、`LINK_VIDEO`／`UNLINK_VIDEO`、`FETCH_STREAM_META`。F-11 匯出 `formatVersion` 升為 2。
- 第 7 節：F-17 需 `alarms`、`downloads`、`notifications`、`offscreen`（T7 加入 manifest）；`tools/`、`design/`、`docs/` 不打包。
- 第 8 節：D2 ✅；T2／T3／T7 擴充；新增 T6-c（彈出視窗面板 PoC）、T7-b（自選備份資料夾 PoC）、T8.5（`docs/USER-GUIDE.md`）。第 9 節新增 v28 必測情境；10.4 popup 收錄狀態、後台橫幅與儲存備份區。
- 3.1：資料層測試改用 `tools/tests/test-db.html`（瀏覽器真實 IndexedDB），不使用 npm 相依。

### 規格 v27（2026-11-15，依 `docs/review-2026-11-15-3.md`）
- **D1 選定方向 B「柔和現代感」**；10.9 填入已選定方向；10.3 圓角改為 8／14px，新增 `--ytcas-on-accent`、`--ytcas-on-danger`、`--ytcas-gift`、`--ytcas-gift-soft`。
- 10.2 主題系統取代舊版：`themeMode`（自動／淺色／深色，預設自動）存 `chrome.storage.sync`、所有介面即時同步；自動時內嵌面板跟隨 YouTube 外觀、後台／popup／匯出 HTML 跟隨系統；新增 frame 訊息 `THEME`（4.3）與共用模組 `src/theme.js`；不做明暗滑桿。
- 新增 **F-13 YouTube 禮物（Jewels）訊息**：`gift` 類型與欄位；膠囊列改為 4 個（「💰 SC／禮物」「👑 會員」）；元件標籤待實機，先存 `system`（保存 `rawTag`），之後以 `RECLASSIFY_SYSTEM` 重新分類。
- 新增 **F-14 重複收錄與合併規則**：一場一份存檔、訊息以 id 合併（不覆蓋、只補空欄位、`sources` 累加、重播 offset 優先）、後備指紋去重、刪除訊息標記、`capture_sessions` 收錄紀錄與覆蓋範圍、「清空此場次後重新收錄」；**待機室／結束後聊天 `phase`**（`pre` 負 offset、`post`、檢視器分隔線、時間軸同步排除）。
- 4.1：`DB_VERSION` 2、streams／messages 新欄位、`[videoId+fp]` 索引、`capture_sessions`；4.2 新增 `CAPTURE_START/END`、`RESET_STREAM`、`RECLASSIFY_SYSTEM`、`MESSAGE_DELETED`。
- 1.3：沒開分頁的時段不會被收錄；劇院模式支援維持待議（候選 A／B／C）。
- 第 8 節：D1 ✅；D2 改為 ⏸；T2 加入 `capture_sessions` 與合併規則；T3 第一步為直播／重播 id 一致性驗證與 `phase` 判斷來源確認；T4／T5／T7 對應調整。第 9 節新增 v27 必測情境。
- `docs/poc-clip-path.md` 附錄 D：訊息元件清單腳本（只輸出標籤與數量）。

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
