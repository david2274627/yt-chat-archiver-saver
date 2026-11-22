# 交接摘要：審查討論串（2026-11-13 ～ 2026-11-22）

> 給下一個「審查用」對話串（claude.ai）與本機 Claude Code 參考。
> 唯一真實來源仍是 `SPEC.md`（目前 **v50**）。本文件是摘要與索引，與 SPEC 衝突時以 SPEC 為準。
> 詳細審查紀錄：`docs/review-2026-11-17.md`（審查十一，第 1～32 節）。

## 0. 分工與工作流程（已固定）

- **本機 Claude Code**：寫程式、跑測試、commit／push。依 `CLAUDE.md` 工作，交付報告放在 `docs/reports/`。
- **claude.ai 審查串（本串）**：每一輪做這幾件事：
  1. 讀報告，簡述改動。
  2. 依「測試環境標籤」分組，列出使用者要測的步驟與回報格式。
  3. 檢查報告漏了什麼。
  4. 把審查寫進 `docs/review-2026-11-17.md` 的新一節。
  5. 給使用者一段可直接貼給 Claude Code 的指令。
- **使用者**：
  - 在 Chrome 實機測試，回報結果與截圖。
  - 決定需要取捨的事項（置頂 A、「≈」、SC 文字色等）。
- 審查端透過裝置橋接（device_bash）直接讀寫 repo：`~/mnt/yt-chat-archiver-saver`。
  - 審查文件用 python 以 CRLF／LF 保留的方式附加。工作區的 `src/*.js` 為 CRLF、HEAD 為 LF。
  - **審查端不 commit**，由 Claude Code 以 `docs:` commit 提交審查文件。
- 診斷記錄：
  - 原始檔放 `docs/diag/raw/`（已 gitignore）。
  - 審查端以 `node tools/diag-report.js <檔案>` 產生摘要，存成 `docs/diag/diag-summary-YYYY-MM-DD-HHMM.md`（videoId 只留 4 碼、無聊天內容）。

### 回報與測試格式（使用者要求，每輪適用，審查十一 17.4）
測試步驟與回報格式依環境分組，同一組可在同一場測完：
- 【不限】
- 【待機室】
- 【VOD】
- 【任何直播】
- 【可倒轉直播】
- 【大量訊息】
- 【待機室→開播】

### 固定的安全約束
- 不按擴充功能的「移除」，只按 🔄。
- 付款只走到確認頁，不真的付款，也不附付款資訊截圖。
- 測試留言是公開的：用簡單招呼語。
- Console 與診斷不輸出聊天內容、handle、個資。
- Claude Code 只結束自己啟動的 PID；啟動外部瀏覽器或連外部網站前，要先取得使用者同意（CLAUDE.md）。
- commit 訊息不得含 BOM。

## 1. 共識與結論

### 架構
- Chrome MV3，純 JS，不用打包工具。
- background（Service Worker）是唯一的 IndexedDB 寫入者，DB 為 `ytcas-v3`（DB v3）。
- 舊版資料庫 `YTLiveChatArchiverDB_V6` 只讀遷移。
- 擴充功能 ID：`ejdhefdjjjlajfilfijnanippgdcdeoi`。
- 版本：`3.0.0-dev`（manifest `version` 3.0.0、`version_name` 3.0.0-dev）。

### F-10 方案 A
`iframe#chatframe` 套 `clip-path`，只露出底部互動區。T1 PoC 通過；T6、T6.1 實機通過：
- AC 1～8、12～14 通過。
- AC 9 留到 T8。
- AC 10、11 已在 T5 通過。

### 已結案的重點決定
- 面板在影片頁預設開啟、不記住關閉狀態（v24）。
- F-12 自動切換為「即時聊天室」。
- 劇院模式一律退讓，但收錄與修剪照常進行。
- 置頂採 **A**：直播時不露出原生置頂列，只用面板置頂卡；置頂卡可以展開，連結可點（30.2）。
- SC 文字色直接沿用 YouTube 的 CSS 變數，取不到才用對比度規則（26.4）。
- 只精確到分鐘的直播訊息（`tsSource: 'clock'`），時間碼前加淡色「≈」（28.3）。
- 跨日分隔線「YYYY/MM/DD（週）」，各段皆適用（24.7）。
- 會員里程碑以綠色卡片呈現（24.6，使用者滿意）。
- 點頭像以新分頁開頻道；點名稱＝篩選（26.3）。
- 面板內的提示不得遮蓋清單與選單（SPEC 10.1 原則 7）。唯一例外是「↓ 回到播放位置」浮動按鈕。
- 不自動刪除資料；修正既有資料一律用「預覽 → `{ dryRun: false }`」兩段式。
- live 與 replay 的訊息 id 相同（測試 E 結案），F-14 合併不需修。
- 頁面 world 注入：**不做**，直播延遲以手動「同步微調」處理（審查建議，使用者未反對）。

### 時間軸同步（已實機通過）
- **VOD**：以 replay offset 為準；只有 live 來源的訊息，以中位數校正（校正值可達數十秒，屬正常）。清單依 phase 分段、再依同步時間排序。
- **直播倒轉**：**牆上時間錨點** `A = now − currentTime×1000`，完全不用 `seekEnd`（實測 `seekEnd` 會停住或亂跳）。
  - 錨點要在徽章「最新」、播放中穩定 3 秒、期間沒有 seek 才採用。
  - 採用後 5 秒內被跳走就作廢。
  - 網址帶 `t=` 時，要等使用者點「直播」。
  - 錨點存在 top frame，面板重建時沿用。
- **判讀方法**：比對直播畫面上的聊天疊加層最新一則與藍框。連線狀態的「目標 X → Y」只代表那段時間沒人留言，不是誤差。

### 待機室
- 預定時間在未來＝待機室，不論 `startedAt`；錯誤的 `startedAt` 降級為 `startedAtSuspect`。
- 降落、會員、禮物都不是開播訊號。
- 待機室的 meta `startDate` 可能是過去、帶秒數的時間，不能單獨作為開播依據（27.1）。
- 待機室→開播（不重新整理）：實測約 **10 秒內**轉換（32.8）。

### 記憶體
- P9 實測：面板本身約 8～21 MB（5 個面板共用）；TVBS 9,288 則只繪出約 22 列；chatframe 維持 45 則上限，無增長。
- 最終以 T8 的 Shift+Esc 對照測試為準。

## 2. 關鍵程式碼／規格／參數

### 檔案
| 檔案 | 角色 |
|---|---|
| `src/selectors.js` | **所有** YouTube 選擇器（規則） |
| `src/constants.js` | 常數、`C.domHandle`（DOM handle，1～100 字）、`C.handleOf`（內文推斷，3～30 字）、`C.handleUrl` |
| `src/capture.js` | chat frame 擷取引擎：`parseClock`、`imgUrl`、`linkUrl`、自己送出訊息的配對、禮物專用解析、延遲補送 |
| `src/chat-input.js` | T6：底部互動區量測、彈窗偵測、`CHAT_INPUT_STATE`、隱藏原生列表與置頂列（`visibility: hidden`） |
| `src/content.js` | 各 frame 進入點；`runChat`／`runTop`；`headerButton(post)` |
| `src/panel.js` | top frame 面板控制、clip 狀態機、`VOD_TIME`、錨點保存 |
| `src/viewer.js`／`src/viewer-core.js` | 面板與後台的檢視器（虛擬清單、同步、分段、`channelUrl`、`isWaitingRoom`、`anchorStep`） |
| `src/background.js` | 唯一 DB 寫入者、meta 重抓、頻道名稱解析佇列、維護函式 `YTCAS_BG.*` |
| `src/backend.html`／`src/viewer.html` | 後台獨立分頁（非 WAR）／嵌入面板（WAR、`use_dynamic_url`）。兩者載入清單必須一致（有測試） |
| `tools/diag.html`／`tools/diag-report.js` | F-20 診斷頁與摘要產生器 |
| `tools/check-scope.js`、`tools/check-contrast.js` | 靜態檢查 |
| `docs/youtube-dom-notes.md` | 實機 DOM 結構（已驗證／待驗證） |
| `docs/test-checklist.md` | 測試清單（含環境標籤） |

### SW Console 維護函式（`chrome://extensions` → 本套件「Service Worker」）
| 函式 | 用途 |
|---|---|
| `streamTimes('videoId')` | 開播與結束時間及來源 |
| `sourceStats()` | live／replay 來源 |
| `channelStats()` | 頻道名稱解析統計 |
| `fillAvatars()` | 補頭像 |
| `fixPhases()` | 重算 phase |
| `fixGiftAuthors()` | 補禮物送禮者 |
| `fixOwnDuplicates()` | 自己送出訊息的重複（目前 `pairs` 為 0，待 T6.2 修格式） |
| `systemTags()` | 系統訊息元件標籤統計 |
| `diagExport()` | 匯出診斷 |

修正類的函式預設都是預覽，加 `{ dryRun: false }` 才執行。

### 主要參數
- 面板：
  - `LIVE_EDGE_SEC` 15
  - `PANEL_MIN_REMAIN_PX` 80
  - `OVERLAY_MAX_RATIO` 0.6
  - `INPUT_POLL_MS` 500
  - 錨點穩定 3 秒、作廢窗 5 秒、讀不到徽章時 10 秒
- 直播到達時間：與顯示分鐘相差 ≤ 90 秒才用到達時間；背景分頁一次回呼超過 2 則（`ARRIVAL_HIDDEN_BATCH_MAX`）就改用顯示時間。
- 頭像：background 每場 5,000 位、最多 5 場；面板 LRU 2,000 位；延遲補送監看 10 秒。
- 頻道名稱解析：
  - `CHANNEL_RESOLVE_CONCURRENCY` 3
  - `CHANNEL_CACHE_TTL_MS` 7 天
  - `CHANNEL_MAX_ATTEMPTS` 6
  - `CHANNEL_FAIL_TTL_MS` 24 小時
- meta 重抓：預定前 30 分鐘內每 2 分鐘，更早每 15 分鐘；已開播 60 秒一次；`isLiveNow` 已驗證。
- 補讀後備：整場讀取最短間隔 2 分鐘；退讓或分頁隱藏時暫停。
- F-20 探針 P1～P10：
  - P9：記憶體，間隔預設 1 分鐘。
  - P10：直播時鐘。
  - P7：結構，包括 `zone-structure`、`sc-color-vars`、`own-replace`、禮物結構，最近 5 筆非記錄期間也保留。

## 3. 尚未解決／下一步

### 目前關卡：T6.2（指令已給，等 Claude Code 報告）
依 `docs/review-2026-11-17.md` 32.5 的順序：
1. **32.7（最優先，資料正確性）**：待機室 backlog 的前幾天訊息被 `parseClock` 判成「今天、未來的時間」，例如 23:13 出現在 20:22。
   - 規則：解析在未來就往前推一天；backlog 依順序重建跨日日期；相隔超過 24 小時標 `clock-ambiguous`。
   - 另外要做 `clockFuture` 統計、P7 `ts-format`、`fixFutureTimes()` 兩段式。
2. **32.9（最優先）**：「等待開播」期間 phase 一律暫定 `pre`；直播與待機室清單也依 phase 分段，標題不重複。
3. **32.2**：
   - 暫時 id 格式：`LCC.` 猜錯了。線索是 `CM_E|28`、`CITy|27` 配 `ChwK|40`，共 33 對。
   - P1 `own` 的 `inPlace`／`pageRemoved` 語意要說明清楚，並證明「777」洗版不會誤合。
   - 修正後請使用者重跑 `fixOwnDuplicates()` 預覽，預期約 33 對。
4. **32.1**：
   - diag-report 呈現 `zone-structure`；`role` 被誤過濾成 `[removed]`。
   - dom-notes 2.4b（SC 變數，名稱欄位要用哪個）、2.5b、2.5c 改為已驗證；投票卡元件標籤。
5. **32.3**：VOD 校正後 < 0 的訊息顯示「影片開頭之前」，不顯示 0:00。
6. **32.8**：說明待機室→開播約 10 秒轉換是哪條路徑觸發的；SPEC 延遲表補實測。
7. **32.10**：頻道名稱只有 @handle。
   - 實測 14,142 個中成功 14,140、最終失敗 2，**佇列積壓 574**。
   - 要做：`channelInfo('@handle')`、可見優先、網路錯誤退避、統計處理速度。

### 之後的任務（SPEC 第 8 節）
- **T6-c ⏸**：F-19 彈出視窗的面板 PoC。
- **T7**：popup、後台、匯出與匯入、刪除、F-15～F-18。另外要包含：
  - **26.5** 後台下拉選單：最近常用 5 筆、每項可刪除／匯出、可搜尋。
  - **32.4** 斷線重接產生的同名場次分組顯示，可選「合併檢視」（不合併資料）。
  - 下拉選單每項顯示開播時間、狀態、videoId 前 4 碼。
- **T7-b**：備份位置自選資料夾 PoC。
- **T8 ⏸**：邊界與回歸（含 AC 9）；記憶體對照（Shift+Esc，停用／啟用各 60 分鐘，確認 T6 之後 chatframe 沒有增長）。
- **T8.5**：使用說明 `docs/USER-GUIDE.md`。
- **T9**：發版 3.0.0，移除 PoC。

### 待使用者決定
- 是否收錄投票內容（題目、選項、結果、時間）。若要，T7 之後新增 `poll` 類型（32.6）。

### 待實機遇到時再測
- 新 SC 的文字色是否與原生相同。
- 置頂卡以外的投票、矮視窗＋投票卡（80～160px 規則）。
- 禮物圖片延遲補送的成功率（P1 `giftLate`／`giftMissing`）。

## 4. 交接方法

### 給下一個 claude.ai 審查串
1. 在同一個 Project「YT 加強版聊天室套件」開新對話，本摘要已存入 Project 文件。
2. 第一則訊息貼上「開場指令」（見下方），讓新串：
   - 讀 Project 內的本摘要；
   - 透過裝置橋接讀 repo 的 `CLAUDE.md`、`SPEC.md` 表頭、`docs/review-2026-11-17.md` 第 29～32 節、最新報告 `docs/reports/2026-11-22-t6-f10.md`。
3. 新串沿用同樣的每輪流程與環境標籤格式。審查文件可以續寫 `docs/review-2026-11-17.md`（第 33 節起），或開新檔 `docs/review-2026-11-23.md`（審查十二）。

### 給本機 Claude Code
不需要特別交接：它讀 `CLAUDE.md`、`SPEC.md` 與審查文件就能接續。目前已收到 T6.2 指令。

### 開場指令（貼到新對話）
```
這是「YT 加強版聊天室套件」審查串的延續。請先讀 Project 文件中的交接摘要（handover-chat-2026-11-22），
再用裝置橋接讀 repo（~/mnt/yt-chat-archiver-saver）的 CLAUDE.md、SPEC.md 表頭、
docs/review-2026-11-17.md 第 29～32 節與 docs/reports/ 最新報告。
之後每輪照舊：分析報告、簡述改動、依環境標籤分組列出測試步驟與回報格式、檢查遺漏、
把審查寫進審查文件新的一節、給我可直接貼給 Claude Code 的指令。用台灣繁體中文。
目前關卡：T6.2（等 Claude Code 報告）。
```
