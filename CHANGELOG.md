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
  - **T2** `db.js`／`background.js`（本段落所在的 commit）：`DB_VERSION` 2 與 v1→v2 遷移、`capture_sessions`、F-14 合併規則（別名、跨來源後備去重、`deleted`、`phase` 事後重算）、F-18 `versions`／`offsets`／`linkedVideos`、F-19 `popout` 與覆蓋範圍合併、F-11 唯讀遷移與 JSON 匯入（v2.6.0／v3）、v3 匯出 `formatVersion` 2、F-15 暫停判斷、F-16 用量與批次刪除、頻道名稱解析佇列（`storage.session`）、新 runtime 訊息與管理操作權限檢查；`selectors.js` 新增 `messageTypeByTag`；測試頁 `tools/tests/test-db.html`（30 項通過）（commit `a1db67c`）。
  - 本輪報告 `docs/reports/2026-11-15-t2-data-layer.md`（commit `f358c4c`；T2 完成，下一步 T3）。
- v29／T3（`docs/review-2026-11-15-5.md`）：
  - 規格 v29、備份位置改為 repo 外、還原步驟、測試頁攔截對外連線、本審查報告（commit `d1bd2bc`）。
  - 寫入壓力測試頁 `tools/tests/test-stress.html`：P95 14～48ms、10 萬則無錯誤、記憶體不增長（commit `c9f1d5b`）。
  - **T3** 擷取引擎 `src/capture.js`（解析、回溯擷取、數量觸發修剪、筆數批次、重試、暫停、刪除通知順序、置頂、降落）、`content.js` 三種環境（top frame `STREAM_INFO`、嵌入式 chat frame、彈出式聊天室）、F-19 `FETCH_STREAM_META` 與自動接手（展開聊天室）、`selectors.js` 擷取欄位、診斷輸出（只有筆數與屬性）；測試頁 `test-capture.html`（20 項）、`test-db.html` 追加 2 項（32 項）（commit `83ced1c`）。
  - 本輪報告 `docs/reports/2026-11-15-t3-capture.md`（commit `4dd0c2c`；T3 ⏸ 等實機測試）。
- v30／T3.1（`docs/review-2026-11-15-6.md` 第 3 節）：
  - F-12 改為開始收錄時自動切換「即時聊天室」，診斷加入 `viewMode`／`f12`；規格 v30（commit `fc693b3`）。
  - 彈出視窗關閉改以 `chrome.tabs.onRemoved` 偵測並觸發主分頁接手，`pagehide` 為輔助（commit `a24b275`）。
  - HANDOFF 還原步驟補 `.indexeddb.blob` 與先後順序（commit `4f6f4ca`）。
  - T3 報告追加「T3.1 追加」一節、站內換頁實測步驟（commit `b77c1a1`）。
- v31／T3.2、T3.3（`docs/review-2026-11-16.md`）：
  - **T3.3** 修剪一律從最舊節點移除（未擷取者先擷取）、`#items` 被換掉時重新掛上並回溯、`pending` 硬上限 200、F-12 後回溯、收錄統計診斷欄位；規格 v31（commit `40ffa6c`）。
  - **T3.2** 診斷輸出分級：`warnOnce` 加 `level`（預設 `info`）、PoC 沒有聊天室的頁面不掛錨點；SPEC 第 7 節與 CLAUDE.md（commit `2a68ea8`）。
  - T3 報告追加「T3.2」「T3.3」兩節；測試清單 F-11 遷移實機 ✅（5 場、1,116 則、4 置頂、149 頻道）（commit `1c14ae5`）。
- v32／T3.4（`docs/review-2026-11-16.md` 追加二）：
  - 只擷取 `#items` 的直接子節點（observer 的 subtree 會回報訊息內部後代）；規格 v32（commit `43ab68d`）。
  - `YTCAS_BG.cleanupJunkSystem({ dryRun })` 清除被誤存的子元件 `system` 紀錄（只動 T3 後收錄的）（commit `2e2c9d6`）。
  - 模擬頁測試：訊息內部後代延遲渲染不產生紀錄；測試清單 T3.2／T3.3 實機 ✅（commit `45c0b2a`）。
  - T3 報告追加「T3.4」（commit `4bdca8c`）。
- v33／T3.5（`docs/review-2026-11-16.md` 追加三 D～F）：
  - 子元件標籤規則式判斷（`-view-model`、`-button-`、`-badge-renderer`、`-chip`）；規格 v33（commit `18c7fb0`）。
  - 歡迎／守則提示同一場次以內容去重，清除函式合併既有重複（commit `0d0961f`）。
  - 60 秒內重新載入沿用同一筆收錄紀錄、空的收錄紀錄刪除並扣回次數；F-19 接手改用 `gen`（commit `d5b165b`）。
  - 清除預覽列出保留的 `system` 標籤 `keptByTag`（commit `966b14b`）。
  - 直播結束偵測（`endDate` 每 30 秒重讀）與結束訊號診斷（commit `ca5bfa7`）。
  - T3 報告追加「T3.5」、測試清單更新（實測 C 背景 30 分鐘、站內換頁、T3.4 實機 ✅）（commit `2e2a8fa`）。
- v34／T3.6（`docs/review-2026-11-16.md` 追加四、追加五）：
  - 禮物訊息 `yt-gift-message-view-model` → `gift`、重新分類標 `partial`、清除規則白名單優先且只清 T3～T3.4 之間；規格 v34（commit `f71a696`）。
  - 欄位完整度統計 `YTCAS_BG.fieldStats()`（含 SC 顏色）（commit `c51c775`）。
  - 開播／結束判斷：`startPending`、來源等級覆蓋與重算、background 重新抓取 watch 頁 meta、播放器開播訊號（commit `ab09313`）。
  - `YTCAS_BG.recomputeStream()` 維護函式（commit `eeba921`）。
  - `youtube-dom-notes.md` 第 5 節、附錄 E 禮物元件結構腳本（commit `26f6deb`）。
  - T3 報告追加「T3.6」、測試清單（F-19 AC a／b／g、開播判斷來源 ✅；修正上一輪誤寫入的換行）（commit `c3b350a`）。
- v35／T3.7（`docs/review-2026-11-16.md` 追加六）：
  - 開播／結束 meta 重新抓取加上 `chrome.alarms` 每 1 分鐘排程；`alarms` 權限提前加入；規格 v35（commit `d440320`）。
  - watch 頁抓取先 `credentials: 'omit'`，取不到時間 meta 才 `include` 重試（commit `f196c3b`）。
  - **F-20 診斷記錄模式**：`diag_log`（`DB_VERSION` 3）、控制、時限、REC、消毒、P5／P6／P8；`downloads` 權限提前加入（commit `aa1dcce`）。
  - F-20 頁面端探針 P1～P4、P6～P8（含 P7 結構探針）（commit `79cb73e`）。
  - 控制頁 `tools/diag.html`、分析工具 `tools/diag-report.js`（commit `f61d9e8`）。
  - T3 報告追加「T3.7」、測試清單（T3.5／T3.6 實機 ✅、T3.7 項目）（commit `775a316`）。
- v36／T3.8（`docs/review-2026-11-16.md` 追加七）：
  - `.gitignore` 排除 `docs/diag/raw/`、F-20 第二次試錄摘要（審查端產生）（commit `0148a36`）。
  - Console 不得輸出個資（CLAUDE.md、移除頻道解析失敗時的 handle）；P8 只記 `warnOnce` key 與預先定義說明、其他訊息只保留 ASCII；規格 v36（commit `184fa4d`）。
  - `diag-report.js` 摘要 `videoId` 只留前 4 碼（commit `5d67c8b`）。
  - HANDOFF 加入診斷控制頁網址（commit `affb291`）。
  - **`scripting` 權限**：擴充功能更新後自動重新注入已開著的 YouTube 分頁，舊實例退場（commit `47564c8`）。
  - 斷線分頁偵測與重新接上；收錄結束統計寫入 P1（commit `5b2a640`）。
  - 控制頁：單一切換按鈕、結束方式二選一、進階、尚未匯出提示；`test-diag-page.html`（commit `5f4f3af`）。
  - T3 報告追加「T3.8」、測試清單（commit `3e750fd`）。
- v37／T3.9（`docs/review-2026-11-16.md` 追加八）：
  - 審查十追加八、T3.8 實測診斷摘要（commit `977e1eb`）。
  - 首次安裝與 SW 啟動時也重新接上斷線的 YouTube 分頁（commit `a6c11aa`）。
  - P3 只記有聊天室的分頁（commit `fc34a74`）。
  - 規格 v37：權限說明更正、長期直播備註；T3 報告追加「T3.9」（commit `dd40cb0`）。
- v38／T4 檢視器核心（報告 `docs/reports/2026-11-17-t4-viewer.md`）：
  - `viewer-core.js`：分類、篩選、搜尋、高亮、時段分隔、時間碼、SC 顏色、置頂去重；`db.getChannels`（commit `7042bbc`）。
  - 檢視器 UI：虛擬清單、訊息列與各類卡片、膠囊列、雙搜尋列、置頂卡片、分隔線、已刪除與隱藏切換、即時推播（commit `8578127`）。
  - `tools/tests/test-viewer.html`（commit `1e08a22`）。
  - 規格 v38、測試清單、HANDOFF 檢視器入口、T4 報告（本段落所在的 commit）。

### 規格 v38（2026-11-17，T4 實作細節）
- 3.1：`src/viewer-core.js`。
- F-05 膠囊數字反映目前篩選條件；F-06 使用者與關鍵字的比對範圍；F-07 多則置頂；F-08 時間碼規則與捲動起點；10.3 SC 文字色以 WCAG 對比度選擇、只接受色碼與 `rgb()`。
- T4：後台分頁在 T7 之前以場次下拉選單切換；完成條件加上使用者以真實資料確認。

### 規格 v37（2026-11-17，依 `docs/review-2026-11-16.md` 追加八）
- 第 7 節權限：重新注入擴大到首次安裝與 SW 每次啟動的斷線分頁檢查；**`scripting` 權限在 Chrome 不顯示額外警告**，使用者同意紀錄（2026-11-16 22:36）以 SPEC 與本檔為準（更正 T3.8 報告「可能提示新權限」的說法）。
- F-20：P3 只記有聊天室的分頁。
- F-08：長期直播（`startDate` 遠早於 DVR 可回放範圍）的時間碼與同步顯示備註。

### 規格 v36（2026-11-17，依 `docs/review-2026-11-16.md` 追加七）
- 第 7 節權限：新增 `scripting`（使用者 2026-11-16 22:36 同意）——擴充功能更新後重新注入 content script。
- F-20：P8 只記 `warnOnce` key＋預先定義說明、其他訊息只保留 ASCII；原始匯出檔放 `docs/diag/raw/`（不進 git），摘要 `videoId` 只留 4 碼；斷線分頁偵測（`YTCAS_PING`）；結束時統計寫入 P1；控制頁版面（單一切換按鈕、二選一、進階、尚未匯出提示）。
- CLAUDE.md：Console 輸出（任何等級）不得包含訊息文字、使用者名稱、handle、頻道名稱、影片標題。

### 規格 v35（2026-11-16，依 `docs/review-2026-11-16.md` 追加六）
- F-14／3.2：meta 重新抓取加上 `chrome.alarms` 每 1 分鐘（只限有分頁開著的場次），3 小時上限以預定開播時間起算；watch 頁先 `omit`、取不到才 `include`。
- 新增 **F-20 診斷記錄模式**（探針 P1～P8、時段與最長時限、REC 標記、隱私、`diag_log` 容量與 30 天清除、匯出與 `tools/diag-report.js`）；4.1 `diag_log`、`DB_VERSION` 3；4.2 `DIAG_LOG`／`DIAG_CONTROL`。
- 第 7 節：`alarms`、`downloads` 提前於 T3.7 加入。

### 規格 v34（2026-11-16，依 `docs/review-2026-11-16.md` 追加五）
- F-13：禮物元件 `yt-gift-message-view-model`（實機確認），通用解析、`RECLASSIFY_SYSTEM` 標 `partial`。
- F-02 清除：白名單優先（`messageTypeByTag`、`knownMessageTags`）；子元件垃圾只清 T3.4 部署前。
- 4.1 streams：`startedAtSource`、`endedAtSource`、`startPending`。
- F-14 開播判斷（取代「`startDate` 已過即開播」）：`deriveStartTimes`、來源等級 `scheduled < signal < meta-actual < replay` 與重算既有訊息（修正 T2 補充設計 #8）、background 重新抓取 meta（60 秒／3 小時、直播中 5 分鐘）、播放器訊號、`recomputeStream`。

### 規格 v33（2026-11-16，依 `docs/review-2026-11-16.md` 追加三）
- F-02：子元件標籤規則式判斷；`viewer-engagement` 以 `viewerEngagementId(videoId, runs)` 為 id；`cleanupJunkSystem` 合併既有重複、預覽列出 `keptByTag`。
- 4.1 `capture_sessions`：60 秒內重新載入沿用同一筆（`CAPTURE_MERGE_GAP_MS`、`reloads`、`resumed`）；空的收錄紀錄刪除並扣回次數；F-19 接手以 `gen` 判斷重新整理。
- F-14 `phase`：直播結束偵測（`endDate` 每 30 秒重讀）與候選訊號診斷；尚無實機確認的結束訊號。

### 規格 v32（2026-11-16，依 `docs/review-2026-11-16.md` 追加二）
- F-02：只有 `#items` 的直接子節點是訊息；擷取函式防呆；「未知訊息元件」只對直接子節點輸出。
- F-02：一次性資料庫維護 `cleanupJunkSystem`（預設預覽；只動 `system`＋非訊息元件標籤＋收錄來源＋T3 部署後的紀錄）。

### 規格 v31（2026-11-16，依 `docs/review-2026-11-16.md`）
- F-01：修剪一律從最舊節點移除，不得跳過未擷取節點；`pending` 硬上限 200；回溯擷取時機（開始收錄、`#items` 被換掉、F-12 切換後）與 3.5 秒補掃；收錄統計診斷欄位；新增 AC（5 分鐘後 ≤ 50、未擷取 ≤ 5、新訊息不可一出現就被移除）。
- 第 7 節「相容」：診斷輸出分級（`warn` 只用於確定有聊天室且影響功能；其他 `info`／`debug`），`warnOnce(key, detail, level)`。

### 規格 v30（2026-11-15，依 `docs/review-2026-11-15-6.md` 第 3 節）
- F-12：執行時機由「開啟優化面板時」改為「**開始收錄時**」（嵌入式、彈出式、重播；暫停中不執行；同一頁一次），T3 擁有，T5 只做面板說明；診斷 `viewMode`／`f12`；AC 改為「開始收錄後 2 秒內」。
- F-19：彈出視窗關閉以 `chrome.tabs.onRemoved` 為主（`popoutTabs` 存 `storage.session`），`pagehide` 為輔助（等 3 秒，重新整理不接手，同一 session 只通知一次）。
- 審查端推定舊資料遺失原因：2026-11-13 第一版測試步驟曾寫「關掉或移除都可以」，若當時按了「移除」，Chrome 會連同 IndexedDB 一起刪除。

### 規格 v29（2026-11-15，依 `docs/review-2026-11-15-5.md` 第 3 節）
- T2 實機確認：Service Worker 無錯誤；自動遷移回報**未偵測到舊資料庫**（`legacyCounts: null`）。調查結果：Chrome 裡本擴充功能的 IndexedDB 是 v3 第一次啟動時（2026-11-15 20:45:52）才建立的，舊資料只剩 `indexeddb_bak\bak_v1` 備份；HANDOFF 新增還原步驟。4.1 補充設計 9 點使用者與審查端同意。
- 第 7 節新增**寫入效能**：`SAVE_MESSAGES` 一批 50 則 ≤ 100ms（P95）、連續 10 萬則不出錯且記憶體不持續增長；壓力測試頁 `tools/tests/test-stress.html`。
- F-11：後台「設定 → 進階」新增「重新執行 v2.6.0 舊資料遷移」（T7，二次確認、顯示上次時間與筆數）；T7 前可在 SW Console 執行 `YTCAS_BG.autoMigrateLegacy(true)`。
- 3.2：`ok: false` 不重試；擴充功能重新載入後舊 content script 停止送出但照常修剪；**刪除通知先後順序**（先送出所在批次並等寫入完成，`found: false` 時下一批後重送一次）。
- 3.1：新增擷取引擎 `src/capture.js`、測試頁 `test-capture.html`／`test-stress.html`；`tools/tests/README.md`：測試頁一律攔截 `fetch` 與 `XMLHttpRequest`。
- 4.3：新增 frame 訊息 `STREAM_INFO_REQUEST`、`STREAM_INFO`、`CAPTURE_STATUS`；嵌入式 chat frame 的 `videoId` 以 top frame 提供者為準（網址通常只有 `continuation`）。
- F-02：直播時間戳以擷取時間補足秒數（夾在 `#timestamp` 該分鐘範圍內）。
- F-19：自動接手分工（T3 展開聊天室並恢復收錄；T5 預設開啟面板）；關閉視窗時 `CAPTURE_END` 可能送不到。
- 文件：備份一律放在 repo 以外（`E:\Tool\ChromeExtensions\indexeddb_bak`），HANDOFF 第 0 步與 `poc-clip-path.md` 更新。

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
