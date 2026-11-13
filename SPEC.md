# YT 加強版聊天室套件 — 開發規格書（給 Claude Code）

| 項目 | 內容 |
|---|---|
| 規格版本 | **v22**（前版：v21；原始交接文件 v18 見 `docs/handover-v18.md`） |
| 目標套件版本 | **3.0.0**（全新重寫；前版 2.6.0 不沿用程式碼） |
| 開發方式 | **本機 Claude Code**，於使用者電腦的 Chrome 實測 |
| 目標環境 | Google Chrome 桌面版，Manifest V3 |
| 專案代號 | `yt-chat-archiver-saver` |
| 最後更新 | 2026-11-13 |

> **給 Claude Code 的閱讀順序**：第 0 節 → 第 1 節（目標）→ 第 4 節（資料模型與訊息協定）→ 第 6 節（F-10 技術設計）→ **第 10 節（UI 視覺設計）** → 第 8 節（任務清單，依序執行）。共通規則見 `CLAUDE.md`，本機操作流程見 `docs/HANDOFF.md`。

---

## 0. 本版重點（TL;DR）

- **全新重寫**：不沿用 v2.6.0 程式碼，依本規格從零實作。v2.6.0 的 F-01～F-09 行為已驗證可行，作為功能需求照做；**所有 UI 樣式全部重新設計**（第 10 節）。
- **風險最高的 F-10 最先驗證**：開發第一步就是 clip-path PoC（T1），結果決定走方案 A 或 B，再往下蓋其他功能。
- **F-10 採方案 A**：原生 iframe 維持完整高度 + CSS `clip-path` 動態裁切（第 6 節）。v13～v18 的「壓扁 iframe」路線全部禁止。
- 方案 B（自建輸入框、呼叫 `youtubei/v1/live_chat/send_message`）列為**備案**，只在 T1 失敗時啟動，且不處理金流。
- **設計先行**：寫 UI 程式前先產出靜態設計稿（`design/`），經使用者確認再實作。
- **v21 調整**：viewer 可直接唯讀 IndexedDB（3.2）；frame 間 origin 檢查區分 youtube.com 與擴充功能 origin、補訊息 id 與直播 offset 規則（4.3）；圖片白名單加入 gstatic；匯出 HTML 圖片內嵌為 data URL，並新增對應 host_permissions（7）。
- **v22 調整**：收起狀態 clip 改為從 `iframe#chatframe` 底邊往上露出 `inputHeight`（6.2、T1）；新增 top frame 付款視窗偵測（6.3）；新增 **F-11 v2.6.0 舊資料遷移與 JSON 匯入**，v3 資料庫改名 `ytcas-v3`（4.1、5.A）；`web_accessible_resources` 只開放 `src/viewer.html`（7）；T9 加入移除 PoC。

---

## 1. 產品目標與範圍

### 1.1 問題
長時間在 Chrome 觀看 YouTube 直播時，分頁記憶體會飆到 2～4 GB。主因：
1. **直播聊天室 DOM 無限堆積（最大元兇）**：聊天室位於獨立 `<iframe>`（`youtube.com/live_chat`），高流量下 `MutationObserver`、Polymer/Lit 元件狀態、會員貼圖快取、Super Chat 動畫不斷累積。
2. **SPA 狀態累積**：同分頁連續切換影片，舊留言區與事件監聽器未完全釋放。
3. **MSE 緩衝與 GPU 合成層**：頻繁拖拉進度條或開啟環境燈光（Ambient Mode）。

### 1.2 目標
1. 直播觀看期間分頁記憶體維持低水位（聊天室 DOM 上限 45 則）。
2. 完整保存富媒體聊天紀錄到本地（文字、表符、雙時間軸、頭像、SC、置頂、降落）。
3. 提供直播中閱讀/搜尋、直播後 VOD 同步回放、離線匯出。
4. 直播中**不犧牲**原生互動（打字、會員表符、SC、超級貼圖、會員里程碑）。

### 1.3 非目標（Out of scope）
- 不處理 MSE / Ambient Mode 記憶體（可在說明中建議使用者關閉環境燈光）。
- 不做雲端同步、不上傳任何聊天資料到外部伺服器。
- 不自行實作 SC 付款流程（一律交給 YouTube 原生 UI）。
- 不支援 Firefox / Safari / 行動版。

---

## 2. 名詞

| 名詞 | 意義 |
|---|---|
| top frame | `https://www.youtube.com/watch?...` 主頁面 |
| chat frame | `https://www.youtube.com/live_chat?...` 或 `live_chat_replay?...` iframe |
| 原生聊天室 / nativeChat | `ytd-live-chat-frame` 與其內的 `iframe#chatframe` |
| 優化面板 | 本套件注入、內嵌於右側欄的 `viewer.html?embed=1` |
| 後台檢視器 | 點擊擴充功能圖示開啟的獨立分頁 `viewer.html` |
| 場次（stream） | 一支影片 `videoId` 對應一個場次 |
| `videoOffsetSec` | 訊息相對影片開始的秒數 |

---

## 3. 架構

### 3.1 檔案結構

```text
yt-chat-archiver-saver/
├── manifest.json     # MV3：storage, unlimitedStorage, tabs；host_permissions 見第 7 節；web_accessible_resources: 僅 src/viewer.html（v22）
├── src/
│   ├── selectors.js  # ★新增：集中管理所有 YouTube DOM 選擇器（YouTube 改版時只改這裡）
│   ├── constants.js  # ★新增：上限數字、機器人名單、訊息類型常數
│   ├── db.js         # IndexedDB 封裝（streams / messages / pinned_messages / channels）
│   ├── background.js # Service Worker：唯一資料庫存取者、推播、頻道名稱/頭像解析
│   ├── content.js    # 雙環境：chat frame（擷取/修剪/輸入區狀態回報）+ top frame（按鈕、面板、clip-path、時間軸）
│   ├── popup.html / popup.js
│   └── viewer.html / viewer.js
├── docs/
│   ├── handover-v18.md  # 原始交接文件（保留歷史，不再修改）
│   └── test-checklist.md
├── CHANGELOG.md
├── VERSION
└── CLAUDE.md
```

> 全新重寫，直接採用上述 `src/` 結構（`manifest.json` 放 repo 根目錄，路徑指向 `src/`）。另新增：
> - `src/styles/tokens.css`：設計 token（CSS 變數，第 10 節），viewer、popup、匯出 HTML 共用。
> - `src/styles/inject.css`：注入 YouTube 頁面的樣式，所有選擇器加 `ytcas-` 前綴。
> - `src/icons/`：套件圖示 16/32/48/128 px（自行繪製 SVG 轉 PNG，不得使用 YouTube 標誌）。
> - `design/`：靜態設計稿 HTML（第 10.8 節），不打包進套件。

### 3.2 資料流

```text
[chat frame content.js]
   MutationObserver 擷取新訊息 → 解析 → 批次(每 1s 或 50 筆) chrome.runtime.sendMessage
   每 3.5s 修剪超過 45 則的 DOM 節點
   監聽輸入區/彈窗狀態 → window.top.postMessage（給 top frame 控制 clip-path）
            │
            ▼
[background.js  Service Worker]  ← 唯一的 IndexedDB「寫入者」
   寫入 IndexedDB → 推播 NEW_MESSAGES 給所有已開啟的 viewer
   頻道 @Handle → 名稱/頭像解析（併發節流、快取 7 天）
            │
            ▼
[viewer.js（內嵌 embed=1 / 後台獨立分頁）]  ← chrome-extension:// 頁面，可直接「唯讀」開啟 IndexedDB
   查詢、篩選、搜尋、置頂卡片、VOD 時間軸同步、匯出
```

**Origin 隔離原則**：`youtube.com` 頁面內的腳本（content.js）**禁止**直接開 IndexedDB 存聊天資料，一律經由 `background.js`。
**讀寫分工**（v21）：所有寫入（新增、刪除、頻道快取）只由 `background.js` 執行；`viewer.js` 屬擴充功能 origin，為了大量資料效能可直接以 `readonly` 交易查詢 IndexedDB，不經 `sendMessage` 序列化。`QUERY_MESSAGES` 保留給 popup 等輕量查詢。

---

## 4. 資料模型與訊息協定

### 4.1 IndexedDB（DB 名稱 `ytcas-v3`（v22 起；`constants.js` 的 `DB_NAME`），版本號隨 schema 遞增，必須寫 `onupgradeneeded` 遷移）

> v2.6.0 的舊資料庫（`YTLiveChatArchiverDB_V6`，結構見 `docs/legacy-v2.6.0-data.md`）**不得**以 v3 程式升級、修改或刪除，只能唯讀複製（F-11）。

**streams**（keyPath `videoId`）
```js
{ videoId, title, channelName, channelUrl, isLive: boolean,
  startedAt: number /*ms*/, lastMessageAt: number, messageCount: number }
```

**messages**（keyPath `id`；索引 `videoId`, `[videoId+videoOffsetSec]`, `[videoId+type]`）
```js
{ id /* YouTube 訊息 id，去重用 */, videoId,
  type: 'text'|'superchat'|'supersticker'|'membership'|'milestone'|'raid'|'system',
  authorHandle /* '@xxx' 或空 */, authorChannelId /* 'UC...' 或空 */,
  authorUrl /* https://www.youtube.com/@xxx 或 /channel/UC... */,
  authorAvatar, authorBadges: string[] /* 'owner'|'moderator'|'member'|'verified' */,
  runs: Array<{ text } | { emoji: { src, alt, shortcut } }>,  // 富媒體內容
  amount?: string, color?: string,      // SC / 超級貼圖
  stickerSrc?: string,
  timestampAbs: number /*ms epoch*/, videoOffsetSec: number|null }
```

**pinned_messages**（keyPath `id`；索引 `videoId`）— 結構同 messages，另加 `pinnedAt`。

**channels**（keyPath `handleOrId`）
```js
{ handleOrId, displayName, avatar, fetchedAt /* 7 天過期 */ }
```

### 4.2 runtime 訊息（`chrome.runtime.sendMessage`，皆帶 `type` 欄位）

| type | 方向 | payload |
|---|---|---|
| `SAVE_MESSAGES` | chat frame → bg | `{ videoId, stream, messages[] }` |
| `SAVE_PINNED` | chat frame → bg | `{ videoId, message }` |
| `NEW_MESSAGES` | bg → viewers | `{ videoId, messages[] }` |
| `QUERY_MESSAGES` | viewer → bg | `{ videoId, filter }` → 回傳 `messages[]` |
| `LIST_STREAMS` / `DELETE_STREAM` / `EXPORT_STREAM` | viewer/popup → bg | 依名稱 |
| `RESOLVE_CHANNELS` | bg 內部 | `handles[]` |
| `CHANNEL_RESOLVED` | bg → viewers | `{ handleOrId, displayName, avatar }` |

### 4.3 frame 間訊息（`window.postMessage`）

所有訊息格式：`{ __ytcas: true, type, ... }`。接收端**必須**檢查 `__ytcas === true`、`event.source` 為預期的 frame，以及 `event.origin`：
- chat frame ↔ top frame：`event.origin === 'https://www.youtube.com'`。
- top frame ↔ viewer iframe：top 端檢查 `event.origin === 'chrome-extension://' + chrome.runtime.id`；viewer 端檢查 `event.origin === 'https://www.youtube.com'`。

**訊息 id 補救**（v21）：置頂、降落橫幅等取不到 YouTube 訊息 id 時，以 `type + authorHandle/authorChannelId + 內容文字 + timestampAbs` 計算雜湊作為 `id`（前綴 `ytcas-`）。

**直播中 `videoOffsetSec`**（v21）：由直播開始時間（top frame 的 `meta[itemprop="startDate"]` 或等效來源，選擇器放 `selectors.js`）推算 `(timestampAbs - startedAt) / 1000`；取不到時存 `null`。

| type | 方向 | payload |
|---|---|---|
| `CHAT_INPUT_STATE` | chat frame → top | `{ hasInput: boolean, inputHeight: number, popupOpen: boolean, popupTop: number }`（px，相對 chat frame 視窗） |
| `VOD_TIME` | top → viewer iframe | `{ currentTime }`（每 250ms 或 `timeupdate`） |
| `SEEK_TO` | viewer iframe → top | `{ seconds }` |

---

## 5. 功能規格與驗收條件

> 每項都有 **AC（Acceptance Criteria）**，Claude Code 完成後必須逐條自我檢查，並更新 `docs/test-checklist.md`。

### A. 效能與資料收錄

**F-01 直播低記憶體佔用**（v2.6.0 已驗證可行，重寫照做）
- chat frame 中每 3.5 秒將 `#items` 下超過 **45** 則的舊訊息節點 `remove()`。
- 監聽 `yt-navigate-finish`，切換影片時清除舊 observer、計時器與殘留空白圖片節點。
- AC：連續播放高流量直播 2 小時，聊天室訊息節點數恆 ≤ 50；切換 3 部影片後無重複 observer（以 console 計數確認）。

**F-02 完整富媒體歷史保存**（v2.6.0 已驗證可行，重寫照做）
- 保存文字、官方 Emoji、會員貼圖（`src` + `alt`）、雙時間軸、頭像、頻道直連網址。
- 被修剪前一定先完成擷取（擷取在 MutationObserver 回呼內同步完成，修剪只動已擷取節點：以 `data-ytcas-saved="1"` 標記）。
- AC：同一訊息不重複寫入（以 `id` 去重）；匯出 JSON 與畫面數量一致。

**F-03 全自動頻道名稱解析**（v2.6.0 已驗證可行，重寫照做）
- 無手動改名按鈕。`@Handle` 由 bg 抓頻道頁 `og:title`、`og:image` 解析；併發上限 **3**，失敗指數退避，快取 **7 天**。
- 顯示：主名稱 = 頻道名稱，副標淡色 = `@Handle`。
- AC：解析失敗時退回顯示 `@Handle`，不得顯示空白。

**F-11 v2.6.0 舊資料遷移與 JSON 匯入**（v22 新增）
- **自動遷移**：v3 第一次啟動時（及後台手動「重新遷移」），若偵測到 v2.6.0 的 IndexedDB（`YTLiveChatArchiverDB_V6`，結構與欄位對照見 `docs/legacy-v2.6.0-data.md`），由 background **唯讀開啟並複製轉換**到 `ytcas-v3`。
  - 開啟舊資料庫時**不得**指定版本號或觸發 `onupgradeneeded`；若開啟時意外進入 `onupgradeneeded`（代表舊資料庫不存在），必須 `abort()` 該交易，不得建立空的舊資料庫。
  - **不得**升級、修改或刪除舊資料庫。
  - 以 `id` 去重，可重複執行；完成後在 `chrome.storage.local` 記錄 `legacyMigratedAt`、`legacyCounts`（舊庫各 store 筆數）與 `migratedCounts`（實際寫入／略過筆數）。
  - 舊資料庫保留；後台提供「刪除舊版資料」按鈕，需二次確認，且僅在遷移筆數核對一致後才可按。
- **JSON 匯入**：後台檢視器「匯入 JSON」，支援 (1) v2.6.0 匯出格式、(2) v3 匯出格式；以 `id` 去重；匯入前顯示預覽（場次數、訊息數、重複數），完成後顯示結果。
- **v3 JSON 匯出**含 `formatVersion` 欄位（初版 `1`），確保可匯入回來。
- AC：遷移後舊資料庫筆數不變；v3 場次數與訊息數與舊資料一致；同一檔案匯入兩次不產生重複；匯入格式錯誤時顯示錯誤，不寫入任何資料。

### B. 檢視器 UI（`viewer.html` / `viewer.js`）

**F-04 前後台介面分離**（v2.6.0 已驗證可行）
- `embed=1`：隱藏場次下拉、匯出/刪除列。
- 後台：場次切換、匯入 JSON（F-11）、匯出離線 HTML（v21：表符、會員貼圖、頭像一律由 background 抓取並內嵌為 data URL，同一網址只抓一次；抓取失敗時退回 alt 文字/色塊；內建離線搜尋框）、匯出 JSON（含 `formatVersion`）、刪除。

**F-05 快速分類膠囊列**（v2.6.0 已驗證可行）
- 「全部訊息（N）」、「💰 Super Chat」（含超級貼圖）、「✨ 實況主降落」。
- 降落 = Raid 橫幅 + 帶 `verified` 徽章的其他實況主發言；**排除** `constants.js` 的 `BOT_BLOCKLIST`（至少 `Nightbot`、`StreamElements`、`Streamlabs`、`Moobot`、`Fossabot`，比對不分大小寫，同時比對名稱與 @Handle）以及本台 `owner`/`moderator`。

**F-06 搜尋列順序**（v2.6.0 已驗證可行）
- 左：「過濾使用者 (頻道名稱 / @代碼)...」；點列表中的名稱可一鍵帶入。
- 右：「搜尋訊息關鍵字或表符...」；命中處 `<mark>` 高亮（表符以 `alt`/`shortcut` 比對）。
- 輸入 debounce 200ms。

**F-07 懸浮主播置頂卡片**（v2.6.0 已驗證可行）
- 置頂訊息去重後固定在搜尋列下方，不混入一般流；點擊展開/收合；顯示主播頭像。

**F-08 VOD 時間軸雙向同步**（v2.6.0 已驗證可行；預設開啟，無開關）
- 依 `VOD_TIME` 對 `videoOffsetSec` 二分搜尋定位、平滑捲動、藍框高亮當前訊息。
- 使用者手動往上捲 → 暫停跟隨，底部出現「↓ 恢復自動捲動」。
- 點藍色時間碼（如 `2:02:10`）→ `SEEK_TO`，播放器跳轉。

### C. YouTube 頁面整合（`content.js`）

**F-09 單一精簡控制按鈕**（v2.6.0 已驗證可行）
- 按鈕置於原生聊天室收合橫幅「開啟面板」右側水平並排；文字「開啟優化面板」，開啟後變紅色「關閉優化面板」。
- 開啟時若原生聊天室收合，自動展開以開始擷取。
- 不顯示大型說明橫幅。

**F-10 直播中保留底部原生互動輸入區**（v2.6.0 未解決，本版重點，詳見第 6 節）

---

## 6. F-10 設計：clip-path 動態裁切（方案 A）

### 6.1 已知失敗路線（**禁止再嘗試**）

| 版本 | 做法 | 失敗原因 |
|---|---|---|
| v13～v16 | 把 `iframe#chatframe` 壓成 88px，再用 postMessage 撐高 | 原生 dropdown / product picker / buy flow 依賴約 560px 視窗定位；撐高有時間差留下空白；購買流程兩層文字重疊 |
| v16 | 對 `yt-live-chat-app` 加 `display:flex; justify-content:flex-end; height:100%` | 破壞 Polymer 渲染週期，矮高度時輸入框空白 |
| v17 | nativeChat 完整高度 + `pointer-events:none` 疊在面板上 | iframe 本身 `pointer-events:none` 後內部任何元素都無法點擊；`position:fixed` 讓購買視窗跑到頂部 |
| v18 | 568px 上下堆疊，chatframe 88px | `height:100% !important` 覆寫 + 容器過小觸發 `yt-live-chat-renderer` 響應式隱藏，輸入框不渲染 |

**共同教訓**：任何改變 chat frame 高度或 `yt-live-chat-app` 佈局的做法都會壞。

### 6.2 新設計原則
1. `ytd-live-chat-frame` 與 `iframe#chatframe` **維持 YouTube 原生尺寸與 CSS**，套件不改其 `height`、`display`、`position`（`position: relative` 容器除外）。
2. chat frame 內**只做**：以 `visibility: hidden` 隱藏 `#item-list`（訊息列表）與 `yt-live-chat-header-renderer`。不得對 `yt-live-chat-app`、`#contents`、`#chat-messages` 設 `height`/`display`。
   - 若 `visibility:hidden` 在實測中仍導致版面跳動，可退為 `opacity:0`；`display:none` 只能作為最後手段並需實測輸入框仍渲染。
3. 優化面板與原生聊天室放在同一 `position: relative` 容器內**完全重疊**（同寬同高）：
   - 優化面板 `z-index: 10`（下層）
   - nativeChat `z-index: 20`（上層），對其套 `clip-path`
4. **裁切狀態**（由 top frame 依 `CHAT_INPUT_STATE` 設定在 `ytd-live-chat-frame` 上）：

| 狀態 | 條件 | clip-path |
|---|---|---|
| 收起（平常） | `hasInput && !popupOpen` | `inset(${iframeBottom - frameTop - inputHeight}px 0 0 0)`（v22：從 `iframe#chatframe` 底邊往上露出 `inputHeight`；`iframeBottom`/`frameTop` 為兩者 `getBoundingClientRect()`。iframe 下方的原生「隱藏聊天室」列一併露出，F-09 按鈕即放在該列） |
| 彈窗展開 | `popupOpen` | `inset(${max(0, popupTop - 8)}px 0 0 0)`（只露出彈窗以下，彈窗自然向上長出覆蓋面板，不露出上方空白） |
| top frame 付款視窗（v22） | top frame 偵測到 `top.popups` 可見（見 6.3） | 待 T1 實測決定：維持目前 clip，或解除為 `none`。視窗本身在 top frame，不受 clip-path 影響，但狀態機須視同 `popupOpen`，不得在此期間切回「收起」造成閃動 |
| 無輸入區 | `!hasInput`（VOD 重播、未登入、聊天室關閉、僅會員可留言而非會員…） | `inset(100% 0 0 0)`，面板佔滿全高 |
| 優化面板關閉 | 使用者關閉面板 | 移除 `clip-path` 與所有套件樣式，完全還原 |

   - `clip-path` 裁掉的區域在 Chrome 的 hit-testing 中不接收滑鼠事件，點擊/滾輪會落到下層面板；這是本設計成立的關鍵，**第一個任務必須先做 PoC 驗證**（第 8 節 T1）。
   - 切換加 `transition: clip-path 120ms ease-out`（可在 `prefers-reduced-motion` 時關閉）。
5. 優化面板底部需預留 `padding-bottom = inputHeight`，避免最後幾則訊息被原生輸入區蓋住；「↓ 恢復自動捲動」按鈕也要在此高度之上。

### 6.3 chat frame 端：輸入區與彈窗偵測
- 用 `ResizeObserver` 量測 `#input-panel`（`yt-live-chat-message-input-renderer` 外層）實際高度 → `inputHeight`（多行輸入、回覆模式、會員限定提示時高度會變）。
- 彈窗偵測（選擇器放 `selectors.js`，以 `MutationObserver` 監聽屬性/子樹 + 每 500ms 保底輪詢）：
  - 表符選單：`yt-emoji-picker-renderer`、`#emoji-picker-button` 展開後的 `tp-yt-iron-dropdown`
  - `$` 選單：`yt-live-chat-product-picker-renderer`
  - 購買流程：`yt-live-chat-message-buy-flow-renderer`
  - 其他：任何「可見」的 `tp-yt-iron-dropdown`、`tp-yt-paper-dialog`
  - 「可見」定義：`getBoundingClientRect().height > 0` 且計算樣式非 `display:none`/`visibility:hidden`。
  - `popupTop` = 所有可見彈窗 `rect.top` 最小值。
- **top frame 彈窗偵測**（v22）：部分 `$` 付款確認視窗開在整頁中央（top frame），不在 chat frame 內。top frame 以 `MutationObserver` 監看 `ytd-popup-container`，其中可見的 `tp-yt-paper-dialog` 與 `ytd-*` 付款相關元件（選擇器放 `selectors.js` 的 `top.popups`）視同 `popupOpen`，與 chat frame 回報的狀態取聯集。
- 狀態有變化才送 `CHAT_INPUT_STATE`（相同狀態 debounce 50ms 合併），避免洗訊息。
- 購買流程進入第二步時，原生會自行處理層級；套件**不得**再對 dropdown 加任何 `display`/`z-index` 覆寫（v18 重疊問題來自混合覆寫）。

### 6.4 top frame 端
- 只信任來自 `iframe#chatframe.contentWindow` 的訊息（比對 `event.source`）。
- 收到狀態 → 更新 `ytd-live-chat-frame` 的 CSS 變數 `--ytcas-clip`；樣式寫在一個注入的 `<style id="ytcas-style">`，關閉面板時整個移除。
- 劇院模式、全螢幕、視窗縮放、`yt-navigate-finish` 時重新計算一次。

### 6.5 F-10 驗收條件
1. 直播中開啟優化面板：上方顯示面板、底部只露出原生單行輸入框，無空白白框。
2. 可正常輸入並送出文字；Enter 送出後輸入框高度回復。
3. 點表符按鈕：選單從底部向上展開覆蓋面板，可選取會員表符並送出；關閉後回到單行。
4. 點 `$`：超級留言、超級貼圖、會員里程碑三種流程皆可走到付款確認頁（不需實際付款），**無文字重疊、無裁切、無跑到頂部**。
5. 面板區域（被裁切的上半部）可正常捲動、點擊時間碼、點使用者名稱篩選。
6. VOD 重播：無輸入區，面板全高。
7. 關閉優化面板：原生聊天室 100% 還原（含訊息列表重新顯示）。
8. 劇院模式切換、視窗寬度縮放後行為一致。
9. F-01～F-09 全數回歸測試通過。

### 6.6 備案：方案 B（僅在方案 A 的 T1 PoC 失敗時啟動）
- 原生 chat frame 完全隱藏（仍保留在 DOM 以持續擷取）。
- 面板底部自建輸入框 + 會員表符選擇器（表符清單由 chat frame 解析原生 emoji picker 資料取得）。
- 送出：在 chat frame 環境攔截/重放 `youtubei/v1/live_chat/send_message` 所需參數（`params`、`clientMessageId`、`richMessage`）。
- `$` 按鈕：暫時解除隱藏並顯示原生 chat frame 完成金流，結束後再隱藏。
- 啟動前需先在 PR 說明中記錄方案 A 失敗證據（截圖、Chrome 版本）。

---

## 7. 非功能需求

| 類別 | 要求 |
|---|---|
| 記憶體 | 直播 2 小時、每分鐘 500+ 則訊息，分頁記憶體較未安裝套件時下降，chat frame DOM 訊息節點 ≤ 50 |
| 效能 | viewer 開啟 10 萬則訊息場次 ≤ 2 秒顯示首屏（使用虛擬清單或分批渲染）；搜尋 ≤ 300ms |
| 安全 | 匯出 HTML 與 viewer 渲染時，所有使用者文字一律 `textContent` / 跳脫，禁止 `innerHTML` 拼接未跳脫文字；圖片只接受 `https://` 且網域為 `*.ggpht.com`、`*.ytimg.com`、`*.googleusercontent.com`、`yt3.ggpht.com`、`fonts.gstatic.com`、`www.gstatic.com`（v21 加入 gstatic：YouTube 標準 Unicode 表符圖片來源）；不在白名單的圖片以 `alt` 文字顯示 |
| 隱私 | 資料只存本機；外部網路請求僅限：頻道頁抓取（`www.youtube.com`）、匯出 HTML 時抓取上列白名單網域的圖片轉 data URL（v21） |
| 網頁可存取資源 | `web_accessible_resources` 只開放 `src/viewer.html`（PoC 期間另加 `src/poc/poc-panel.html`），並設 `use_dynamic_url: true`，降低網頁偵測擴充功能的可能；viewer 的 js/css 由擴充功能頁面自行載入，不需開放（v22） |
| 權限 | 僅 `storage`、`unlimitedStorage`、`tabs`；host_permissions：`https://www.youtube.com/*`，以及匯出內嵌圖片用的 `https://*.ggpht.com/*`、`https://*.ytimg.com/*`、`https://*.googleusercontent.com/*`、`https://fonts.gstatic.com/*`、`https://www.gstatic.com/*`（v21 經使用者同意）。再新增權限需先徵得使用者同意 |
| 相容 | YouTube 改版時只需修改 `selectors.js`；所有選擇器找不到時須 graceful degrade（console.warn 一次，不拋錯） |

---

## 8. 開發任務清單（本機 Claude Code 依序執行）

標示 **⏸** 的任務完成後必須**停下來**，告訴使用者如何在 Chrome 測試或檢視，等使用者回覆再繼續。

| # | 任務 | 產出 | 完成條件 |
|---|---|---|---|
| T0 | 專案骨架：`manifest.json`、`src/` 結構、`selectors.js`、`constants.js`、空白 `tokens.css`、套件圖示 | commit | Chrome「載入未封裝項目」無錯誤 |
| T1 ⏸ | **clip-path PoC**：最小 content script，在 top frame 建立重疊容器，下層放一個可捲動/可點擊的測試面板，上層原生 `ytd-live-chat-frame` 套 `clip-path`，從 `iframe#chatframe` 底邊往上露出 84px（可調），即 `inset(${iframeBottom - frameTop - 84}px 0 0 0)`；下層可切換 div / 擴充功能 iframe，另可「完全不裁切」並觀察 top frame 付款視窗（v22） | `docs/poc-clip-path.md`（測試步驟、結論、Chrome 版本） | 使用者回報：上半部點擊/滾輪落到測試面板、下方輸入框可打字。成功 → 方案 A；失敗 → 方案 B（6.6），並更新本 SPEC |
| D1 ⏸ | **設計稿**：依第 10 節做 `design/mockups.html`，提出 **2 種視覺方向**，每種含淺色/深色 | 設計稿 HTML | 使用者選定方向（可要求修改） |
| D2 | 將選定方向落實為 `tokens.css` 與元件 CSS；更新第 10 節「已選定方向」 | commit | 設計稿與 token 一致 |
| T2 | `db.js` + `background.js`：資料表、遷移、`SAVE_*`/`QUERY_*`、推播、頻道名稱解析器（F-02、F-03）；F-11 自動遷移（唯讀複製，不動舊資料庫） | commit | 以 DevTools 呼叫訊息 API 可寫入/查詢；遷移後舊庫筆數不變、新舊筆數一致 |
| T3 | chat frame：訊息擷取、置頂擷取、DOM 修剪、`yt-navigate-finish` 清理（F-01、F-02） | commit | 直播中 IndexedDB 持續增加、DOM 節點 ≤ 50 |
| T4 | viewer 核心：虛擬清單、訊息列、膠囊列、雙搜尋列、置頂卡片（F-04～F-07） | commit | 對既有場次資料可篩選、搜尋、高亮 |
| T5 ⏸ | top frame：「開啟/關閉優化面板」按鈕、內嵌面板、VOD 時間軸同步與 Click-to-Seek（F-08、F-09） | commit | 使用者在 VOD 與直播實測 |
| T6 ⏸ | F-10 完整實作：輸入區/彈窗偵測、`CHAT_INPUT_STATE`、clip 狀態機、面板底部 padding、關閉還原（第 6 節） | commit | 使用者依 6.5 AC 1～7 實測 |
| T7 | popup、後台獨立檢視器、匯出離線 HTML / JSON（含 `formatVersion`）、刪除；F-11 JSON 匯入 UI（v2.6.0 / v3 格式、預覽、去重）與「刪除舊版資料」按鈕 | commit | 匯出 HTML 離線開啟可搜尋；同一 JSON 匯入兩次無重複 |
| T8 ⏸ | 邊界情況與回歸：`$` 三種流程、劇院模式、縮放、深淺色切換、F-01～F-10 全部，更新 `docs/test-checklist.md` | commit | 使用者確認測試清單全數通過 |
| T9 | 發版 3.0.0：移除 `src/poc/` 與 manifest 中 PoC 的 content script、`web_accessible_resources` 的 `poc-panel.html`；更新 `manifest.json`、`VERSION`、`CHANGELOG.md` | `release: v3.0.0` | 見 `CLAUDE.md` 版本規則 |

---

## 9. 手動測試環境
- 測試直播：任一高流量直播（每分鐘 > 300 則）+ 一個自己能留言的低流量直播（測輸入/表符）。
- 測試帳號：需為某頻道會員以測會員表符；`$` 流程測到確認頁即可取消。
- Chrome：最新穩定版；記錄版本號於測試清單。
- 記憶體量測：Chrome 工作管理員（Shift+Esc）記錄 0 / 30 / 60 / 120 分鐘。

---

## 10. UI 視覺設計規格（全部重新設計）

### 10.1 設計原則
1. **與 YouTube 共存、不冒充 YouTube**：內嵌在 YouTube 頁面時版面與密度要協調，但有自己的識別；不使用 YouTube 標誌、不照抄 YouTube 紅作為主色（「關閉優化面板」按鈕的紅色是功能狀態色，例外）。
2. **閱讀優先**：聊天訊息是主角，工具列與篩選要精簡；內嵌模式（`embed=1`）垂直空間最大化。
3. **一眼分辨訊息類型**：一般 / Super Chat / 超級貼圖 / 會員 / 里程碑 / 降落 / 置頂，各有一致的視覺語言。
4. **深淺色雙主題**：所有顏色只能用 token，不得在元件中寫死色碼。
5. **安靜的動態**：動畫只用在狀態轉換（展開、跟隨捲動、clip 切換），120～200ms；`prefers-reduced-motion` 時關閉。

### 10.2 主題切換
| 介面 | 依據 |
|---|---|
| 內嵌面板、注入按鈕 | 跟隨 YouTube：top frame 偵測 `html[dark]`，以 `postMessage` 或 URL 參數 `theme=dark|light` 傳給 viewer iframe，YouTube 切換主題時即時同步 |
| 後台檢視器、popup | 預設跟隨 `prefers-color-scheme`，後台提供「系統 / 淺色 / 深色」切換（存 `chrome.storage.local`） |
| 匯出 HTML | 內建兩套 token，跟隨閱讀者系統設定 |

### 10.3 設計 Token（`src/styles/tokens.css`，D1/D2 定稿）
必須至少定義下列變數（值由設計稿決定，以下為命名與用途）：

```css
:root {
  /* 表面 */  --ytcas-bg; --ytcas-surface; --ytcas-surface-2; --ytcas-border; --ytcas-overlay;
  /* 文字 */  --ytcas-text; --ytcas-text-2; --ytcas-text-3;
  /* 品牌與互動 */ --ytcas-accent; --ytcas-accent-hover; --ytcas-accent-soft; --ytcas-focus-ring;
  /* 語意 */  --ytcas-timecode;      /* 藍色系，時間碼 */
              --ytcas-current-ring;  /* 藍框，VOD 當前訊息 */
              --ytcas-highlight;     /* 搜尋 <mark> 底色 */
              --ytcas-raid; --ytcas-raid-soft;   /* 實況主降落 */
              --ytcas-member; --ytcas-owner; --ytcas-moderator;
              --ytcas-danger;        /* 關閉優化面板按鈕 */
  /* 字體 */  --ytcas-font: "Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif;
              --ytcas-font-mono: ui-monospace,"SF Mono",Consolas,monospace;  /* 時間碼 */
  /* 字級 */  --ytcas-fs-xs:11px; --ytcas-fs-sm:12px; --ytcas-fs-md:13px; --ytcas-fs-lg:15px; --ytcas-fs-xl:18px;
  /* 間距 4px 基準 */ --ytcas-space-1:4px … --ytcas-space-6:24px;
  /* 圓角 */  --ytcas-radius-sm:6px; --ytcas-radius-md:10px; --ytcas-radius-pill:999px;
  /* 陰影 */  --ytcas-shadow-1; --ytcas-shadow-2;
  /* 動態 */  --ytcas-ease: cubic-bezier(.2,.8,.2,1); --ytcas-dur:160ms;
}
[data-theme="dark"] { /* 同名變數的深色值 */ }
```
- Super Chat 底色**使用訊息本身的 SC 等級顏色**（`message.color`），文字色依底色自動選黑/白以符合對比。
- 對比度：本文文字 ≥ 4.5:1，次要文字 ≥ 3:1（WCAG AA）。

### 10.4 元件清單與規格
| 元件 | 規格重點 |
|---|---|
| **注入按鈕**（F-09） | 與 YouTube「開啟面板」按鈕同高、水平並排；膠囊形；關閉狀態為次要按鈕樣式，開啟後變 `--ytcas-danger` 實心「關閉優化面板」；有 hover / focus-visible / active 狀態 |
| **頂部工具區** | 由上而下：膠囊列 → 雙搜尋列 → 置頂卡片。embed 模式整體高度 ≤ 96px（置頂卡片收合時） |
| **膠囊列**（F-05） | 「全部 N」「💰 Super Chat N」「✨ 降落 N」；選中為 `--ytcas-accent-soft` 底 + accent 文字；數字用 tabular-nums |
| **雙搜尋列**（F-06） | 左「過濾使用者 (頻道名稱 / @代碼)...」、右「搜尋訊息關鍵字或表符...」；各帶圖示與清除鈕；過濾中的使用者以 chip 顯示，可點 × 移除 |
| **置頂卡片**（F-07） | 浮在工具區下方；左側主播頭像 + 「置頂」標籤；收合時單行省略，點擊展開全文；`--ytcas-shadow-1` |
| **訊息列** | 頭像 24px → 時間碼（mono、`--ytcas-timecode`、可點）→ 名稱（主名稱粗體 + 淡色 @Handle）→ 徽章 → 內容；表符與文字基線對齊，表符高 20px（會員貼圖 24px）；行高 1.45；hover 顯示淡底 |
| **Super Chat / 超級貼圖卡** | 圓角卡片，上半金額列（頭像、名稱、金額），下半訊息；超級貼圖顯示貼圖 72px |
| **會員 / 里程碑** | 左側 `--ytcas-member` 色條 + 標籤 |
| **降落高光**（F-05） | Raid 橫幅：整列 `--ytcas-raid-soft` 底 + `--ytcas-raid` 左邊框 + 「✨ 降落」標籤；認證實況主發言：名稱旁加 raid 色徽章 |
| **VOD 當前訊息**（F-08） | `--ytcas-current-ring` 2px 內框，平滑移動 |
| **「↓ 恢復自動捲動」** | 底部置中浮動膠囊按鈕，位於原生輸入區（`inputHeight`）之上 8px |
| **空狀態 / 載入中** | 尚無訊息、搜尋無結果、資料庫載入中，各有簡短文字與圖示 |
| **後台檢視器** | 左側欄：場次清單（標題、頻道、日期、訊息數、直播/重播標籤、搜尋）；主區：同內嵌面板元件；頂部動作列：匯出 HTML、匯出 JSON、刪除（刪除需確認對話框） |
| **popup**（寬 360px） | 目前分頁狀態（是否在擷取、本場訊息數）→「開啟檢視器」主按鈕 → 最近 5 個場次 |
| **匯出 HTML** | 單一檔案、離線可用；頂部標題列（場次資訊）+ 搜尋框 + 訊息清單，沿用同一套 token |

### 10.5 版面
- 內嵌面板寬度跟隨 YouTube 右側欄（約 400px），最窄 300px 時仍不破版（名稱省略、搜尋列可改上下排列）。
- 後台檢視器：≥ 1024px 雙欄（側欄 280px）；< 1024px 側欄收成抽屜。

### 10.6 無障礙
- 所有可點元素可用鍵盤操作，`:focus-visible` 顯示 `--ytcas-focus-ring`。
- 圖示按鈕有 `aria-label`（繁體中文）；膠囊列用 `role="tablist"`。
- 時間碼按鈕 `aria-label="跳轉至 2:02:10"`。

### 10.7 注入 YouTube 頁面的樣式隔離
- 優化面板以 iframe（`viewer.html?embed=1`）呈現，樣式天然隔離。
- 注入在 YouTube DOM 的元素（按鈕、容器）全部加 `ytcas-` class 前綴，或放入 Shadow DOM；不得修改 YouTube 原生元件外觀（第 6 節允許的 `clip-path`、隱藏 `#item-list`/header 除外）。

### 10.8 設計稿交付（任務 D1）
- `design/mockups.html`：單一靜態頁、無外部相依，可直接用 Chrome 開啟。
- 提出 **方向 A、方向 B** 兩種風格（例如：A「沉穩工具感」——中性灰階、細邊框、高資訊密度；B「柔和現代感」——較大圓角、柔和陰影、彩度較高的強調色），每種皆含淺色與深色。
- 每個方向需展示：內嵌面板（直播中含底部輸入區示意、VOD 含當前訊息藍框）、各訊息類型、置頂卡片展開/收合、後台檢視器、popup、注入按鈕兩種狀態。
- 頁面頂部提供切換「方向 A / B」「淺色 / 深色」的按鈕。
- 使用假資料（虛構頻道名稱與頭像色塊），不使用真實使用者頭像。

### 10.9 已選定方向
（D2 完成後由 Claude Code 填寫：方向、主色、調整紀錄）

