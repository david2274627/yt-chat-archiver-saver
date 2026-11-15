# YT 加強版聊天室套件 — 開發規格書（給 Claude Code）

| 項目 | 內容 |
|---|---|
| 規格版本 | **v27**（前版：v26；原始交接文件 v18 見 `docs/handover-v18.md`） |
| 目標套件版本 | **3.0.0**（全新重寫；前版 2.6.0 不沿用程式碼） |
| 開發方式 | **本機 Claude Code**，於使用者電腦的 Chrome 實測 |
| 目標環境 | Google Chrome 桌面版，Manifest V3 |
| 專案代號 | `yt-chat-archiver-saver` |
| 最後更新 | 2026-11-15 |

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
- **v23 調整**：T1 通過，**F-10 定案方案 A**；面板改為插入 `ytd-live-chat-frame` 內、clip 改套在 `iframe#chatframe`（6.2、6.4，修正劇院模式錯位）；頁面層付款視窗開啟期間 clip 維持解除（6.2、6.4）；`inputHeight` 一律動態量測（6.3）；新增 10.1 原則 6「不遮擋影片與頁面主體」與第 7 節「版面侵入」；F-09 新增待決事項（預設開啟）；F-11 遷移資料時間碼為盡力而為。
- **v24 調整**：F-09 依目前 YouTube 版面（聊天室右上角 `✕`、無「隱藏聊天室」列、影片下方「聊天室／開啟面板」卡片）改為**多重錨點**，並決定**預設開啟、不記住關閉狀態**（5.C、6.5）；新增 frame 訊息 `TOGGLE_PANEL`（4.3）；頁面層付款視窗選擇器定案為 `#buyFlowDivId`，移除萬用規則（6.3、6.4）；第 9 節加入 Holodex+ 相容性測試。v23 依據的審查內容有遺失，本版補回。另依 v23 PoC 補測：`inputHeight` 改為 **`bottomZoneHeight`（底部互動區高度，含置頂列、投票卡）**（4.3、6.2、6.3）；6.2 新增「聊天室摺疊」狀態，劇院模式／窄版面監看要求（6.4）；F-07 與原生置頂列的關係、F-02 置頂來源待確認；6.5 AC 新增第 12、13 條；第 9 節新增置頂列／投票卡必測情境。
- **v25 調整**（依 `docs/youtube-dom-notes.md` 實機結構）：依賴 YouTube DOM 的功能一律以該筆記為準（第 9 節）；底部互動區改為**白名單**量測並加合理性退回（6.3）；F-09 頂部列按鈕位置定案（`#live-chat-header-context-menu` 前）；彈窗選擇器定案（6.3）；F-02 直播訊息改讀 `#timestamp`、身分改讀 `author-type` 屬性、未知訊息元件存為 `system`；F-03 以 `@handle` 為鍵；新增 **F-12 自動切換「即時聊天室」**；1.3 新增「只能保存 YouTube 實際送到分頁的訊息」；6.4 版面狀態判斷屬性。
- **v26 調整**（v24.1 PoC 補測，`docs/review-2026-11-15-2.md`）：**T1 通過並關閉**（第 8 節）；投票卡 `#chat > #action-panel` 入白名單、合理性規則調整、面板最小高度與退讓（6.2、6.3）；iframe 搬移重載後的重新初始化流程與看門狗（6.4）；**劇院模式一律退讓，但擷取與修剪持續運作**（6.2、6.4、6.5 AC 14）；退讓時的按鈕樣式（10.4）；F-02 重播以 `#timestamp` 取得 `videoOffsetSec`、略過佔位元素、新增收到贈送會員；F-12 重播同樣適用。
- **v27 調整**（`docs/review-2026-11-15-3.md`）：**D1 選定方向 B「柔和現代感」**（10.9）；主題系統改為 `themeMode` 自動／淺色／深色，存 `chrome.storage.sync`、所有介面即時同步（10.2，取代舊版）；新增 frame 訊息 `THEME`（4.3）；新增 **F-13 YouTube 禮物（Jewels）訊息**（`gift` 類型，膠囊改為 4 個）；新增 **F-14 重複收錄與合併規則**（一場一份存檔、訊息以 id 合併、後備指紋去重、`capture_sessions` 收錄紀錄、刪除訊息標記、**待機室／結束後聊天 `phase`**）；資料模型與 `DB_VERSION` 2（4.1）；1.3 新增「沒開分頁的時段不會被收錄」；第 8 節 T2／T3 對應調整。

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
- （v26）**劇院模式下不提供優化面板**（聊天室被 YouTube 壓成 152px 小框，見 6.4）；是否另外提供檢視方式（例如獨立視窗的檢視器）列為 **3.0.0 之後的待議事項**，本版不做。劇院模式下訊息擷取與 DOM 修剪仍持續運作。（v27：使用者 2026-11-15 決定**維持待議**；候選方向為 A 劇院模式時拉高聊天室外框、B Chrome 側邊欄、C 獨立小視窗，評估紀錄見 `docs/review-2026-11-15-3.md` 第 7 節。）
- （v27）**沒有開著分頁的時段不會被收錄**：套件只在聊天室 iframe 存在、分頁開著時擷取；YouTube 也不提供事後補抓待機室或直播結束後聊天的方式（F-14）。中途離開的空檔會在後台的覆蓋範圍上看得到。
- （v25）**套件只能保存 YouTube 實際送到此分頁的訊息**：被封鎖、被管理員隱藏、被 YouTube 垃圾訊息過濾的訊息不在存檔內；F-12 會自動切到「即時聊天室」以盡量取得完整訊息流，但仍以 YouTube 實際送出的為限。

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
> - `src/theme.js`（v27）：主題系統共用模組（10.2）；viewer、popup 以 `<script src="theme.js" data-auto>` 放在 `<head>` 載入。
> - `src/styles/components.css`（v27）：元件樣式（10.4），viewer、popup 共用；`design/mockups.html` 直接載入本檔與 `tokens.css`、`theme.js`，設計稿即實作樣式。
> - `tools/check-contrast.js`（v27）：token 對比度檢查腳本，不打包進套件。
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

> **v27：`DB_VERSION` 升為 2**（新增 `capture_sessions` 資料表、messages 新欄位與 `[videoId+fp]` 索引）。`onupgradeneeded` 依 `oldVersion` 逐版遷移；v1 既有紀錄補上預設值（`sources: ['live']`、`phase: 'live'`、`offsetSource: 'estimated'`、`deleted: false`）。一場直播／一部影片 = 一份存檔，規則見 F-14。

**streams**（keyPath `videoId`）
```js
{ videoId, title, channelName, channelUrl, isLive: boolean,
  startedAt: number /*ms，實際開播時間；未開播時為 null*/, lastMessageAt: number, messageCount: number,
  // v27（F-14）
  scheduledStartAt: number|null /* 待機室的預定開播時間 */, endedAt: number|null /* 直播結束時間 */,
  liveCaptureCount: number, replayCaptureCount: number /* 由 capture_sessions 彙總，供場次清單顯示 */ }
```

**messages**（keyPath `id`；索引 `videoId`, `[videoId+videoOffsetSec]`, `[videoId+type]`, `[videoId+fp]`（v27））
```js
{ id /* YouTube 訊息 id，去重用 */, videoId,
  type: 'text'|'superchat'|'supersticker'|'gift'|'membership'|'milestone'|'raid'|'system',  // v27 新增 gift（F-13）
  authorHandle /* '@xxx' 或空 */, authorChannelId /* 'UC...' 或空；v25：直播訊息沒有作者連結，多數情況取不到 */,
  authorUrl /* v25：以 https://www.youtube.com/@handle 組成；有 channelId 時才用 /channel/UC... */,
  authorAvatar, authorBadges: string[] /* 'owner'|'moderator'|'member'|'verified' */,
  runs: Array<{ text } | { emoji: { src, alt, shortcut } }>,  // 富媒體內容
  amount?: string, color?: string,      // SC / 超級貼圖
  stickerSrc?: string,
  giftName?: string, giftImage?: string, giftCount?: number, jewels?: number,  // v27：gift（F-13），聊天室有顯示才存
  rawTag?: string,  // v27：type 為 system 時保存原始元件標籤名稱，供 RECLASSIFY_SYSTEM 重新分類（F-13）
  timestampAbs: number /*ms epoch*/, videoOffsetSec: number|null,
  // v27（F-14）
  phase: 'pre'|'live'|'post',            // 待機室／直播中／結束後；pre 的 videoOffsetSec 為負值（開播時間未定時先存 null，開播後回填）
  offsetSource: 'replay'|'estimated',    // replay = 重播 #timestamp 精確值；estimated = 由 startDate 推算
  sources: Array<'live'|'replay'|'import'|'legacy'>,  // 累加，不重複
  firstSeenAt: number, lastSeenAt: number,
  deleted?: boolean, deletedAt?: number, // 被管理員刪除時保留原內容並標記
  fp: string }                           // 後備去重指紋（F-14）
```

**pinned_messages**（keyPath `id`；索引 `videoId`）— 結構同 messages，另加 `pinnedAt`。

**capture_sessions**（v27，keyPath `id` 自動遞增；索引 `videoId`）— 每次開始收錄記一筆（F-14）
```js
{ id, videoId, source: 'live'|'replay', startedAt: number, endedAt: number|null,
  firstOffset: number|null, lastOffset: number|null,  // 本次收錄涵蓋的 videoOffsetSec 範圍（pre 可為負）
  phases: Array<'pre'|'live'|'post'>,                 // 本次收錄涵蓋哪幾段
  added: number, merged: number }                     // 新增筆數／合併（已存在）筆數
```

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
| `CAPTURE_START` / `CAPTURE_END` | chat frame → bg | `{ videoId, source }` → 回傳 `captureSessionId`（v27，F-14；`CAPTURE_END` 在 `pagehide`／導航時送出，送不到時由 bg 以最後寫入時間補 `endedAt`） |
| `RESET_STREAM` | viewer → bg | `{ videoId }`（v27：「清空此場次後重新收錄」，需二次確認） |
| `RECLASSIFY_SYSTEM` | viewer → bg | `{ videoId? }`（v27，F-13：依目前 `selectors.js` 重新分類既存的 `system` 紀錄，一次性） |
| `MESSAGE_DELETED` | chat frame → bg | `{ videoId, id, deletedAt }`（v27，F-14） |

### 4.3 frame 間訊息（`window.postMessage`）

所有訊息格式：`{ __ytcas: true, type, ... }`。接收端**必須**檢查 `__ytcas === true`、`event.source` 為預期的 frame，以及 `event.origin`：
- chat frame ↔ top frame：`event.origin === 'https://www.youtube.com'`。
- top frame ↔ viewer iframe：top 端檢查 `event.origin` 等於 `new URL(viewerIframe.src).origin` 或 `'chrome-extension://' + chrome.runtime.id`（v22：`use_dynamic_url: true` 時 `chrome.runtime.getURL()` 可能回傳動態 ID，origin 不一定等於 `runtime.id`）；viewer 端檢查 `event.origin === 'https://www.youtube.com'`。

**訊息 id 補救**（v21）：置頂、降落橫幅等取不到 YouTube 訊息 id 時，以 `type + authorHandle/authorChannelId + 內容文字 + timestampAbs` 計算雜湊作為 `id`（前綴 `ytcas-`）。

**直播中 `videoOffsetSec`**（v21）：由直播開始時間（top frame 的 `meta[itemprop="startDate"]` 或等效來源，選擇器放 `selectors.js`）推算 `(timestampAbs - startedAt) / 1000`；取不到時存 `null`。

| type | 方向 | payload |
|---|---|---|
| `CHAT_INPUT_STATE` | chat frame → top | `{ hasInput: boolean, bottomZoneHeight: number, popupOpen: boolean, popupTop: number }`（px，相對 chat frame 視窗；v24 起 `inputHeight` 改名 `bottomZoneHeight`，定義見 6.3） |
| `TOGGLE_PANEL` | chat frame → top | `{}`（v24：使用者點了聊天室頂部列的 F-09 按鈕；top 端只接受 `event.source === iframe#chatframe.contentWindow` 且 origin 為 youtube.com） |
| `THEME` | top → viewer iframe | `{ theme: 'light'|'dark' }`（v27：top frame 監看 `html[dark]` 的實際外觀，開啟面板時送一次、變更時再送；面板依 `themeMode` 決定是否採用，見 10.2） |
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
- 置頂訊息擷取（v25 確認）：新版面置頂列位於輸入列上方，來源仍是 `yt-live-chat-banner-manager`（`chat.bannerContainer`）＞ `yt-live-chat-banner-renderer` ＞ `#contents` 內的 `yt-live-chat-text-message-renderer#<訊息 id>`（結構同一般訊息），見 `docs/youtube-dom-notes.md` 2.4。
- **時間戳**（v25）：直播訊息的 `span#timestamp` **有值**，`yt-live-chat-renderer[hide-timestamps]` 只是以 CSS 隱藏。擷取時直接讀 `#timestamp` 文字（當地時間字串；實機長度約 7 字元，確切格式待 T3 實作時確認，解析需容許上午／下午與 AM／PM 兩種寫法），配合擷取當下的日期還原 `timestampAbs`；還原結果比擷取時間晚超過 12 小時時視為前一天（跨日校正）；解析失敗時以擷取時間為準。`videoOffsetSec` 仍以 `startDate` 推算（4.3）。
- **身分**（v25）：以 `yt-live-chat-text-message-renderer[author-type]`（`owner`／`moderator`／`member`…）為主，`#chat-badges` 內的徽章為輔（例如 `verified`）。
- **未知訊息元件**（v25）：`#items` 下出現不認識的元件標籤時，`console.info('[ytcas] 未知訊息元件', tagName)`（每種標籤一次），並以 `type: 'system'` 保存，不丟棄。尚未在實機出現的類型（SC 文字版、禮物購買、降落、里程碑、投票內部元件）在 `selectors.js` 標「待實機確認」。
- **VOD 重播（`/live_chat_replay`）**（v26，實機確認）：`span#timestamp` 有值（影片時間，如 `1:23`，CSS 隱藏）→ **直接解析為 `videoOffsetSec`**（`h:mm:ss`／`m:ss`）；`timestampAbs` 以 `startedAt + videoOffsetSec` 推算，取不到 `startedAt` 時存擷取時間。
- **略過佔位元素**（v26）：`yt-live-chat-placeholder-item-renderer` 不擷取、不計入未知元件。
- **會員訊息欄位對應**（v26）：`yt-live-chat-membership-item-renderer`（`type: 'membership'`）：`#header #author-photo img#img` → `authorAvatar`；`#header-content #author-name` → 名稱；`#chat-badges` → 徽章；`#header-primary-text`、`#header-subtext` → `runs` 開頭的系統文字（例如加入會員、會員月數；有 `has-primary-header-text` 屬性時 primary 為主標）；`#content #message` → 使用者留言（里程碑訊息，可能為空）；`#timestamp`（此元件為 `div#timestamp`）→ 時間。
- **收到贈送會員**（v26）：`ytd-sponsorships-live-chat-gift-redemption-announcement-renderer` 歸入 `type: 'membership'`（內部結構待實機確認；先保存作者與可見文字）。跑馬燈內的 `yt-live-chat-ticker-sponsor-item-renderer` 不擷取（同一事件已在訊息列表出現）。
- （v27）禮物訊息見 F-13；重複收錄、合併、刪除標記與 `phase` 見 F-14。
- AC：同一訊息不重複寫入（以 `id` 去重，合併規則見 F-14）；匯出 JSON 與畫面數量一致。

**F-03 全自動頻道名稱解析**（v2.6.0 已驗證可行，重寫照做）
- 無手動改名按鈕。`@Handle` 由 bg 抓頻道頁 `og:title`、`og:image` 解析；併發上限 **3**，失敗指數退避，快取 **7 天**。
- 顯示：主名稱 = 頻道名稱，副標淡色 = `@Handle`。
- （v25）直播訊息沒有作者連結，`authorChannelId` 多數情況取不到：解析與快取（`channels` store 的 `handleOrId`）**以 `@handle` 為鍵**；`authorUrl` 以 `https://www.youtube.com/@handle` 組成。
- AC：解析失敗時退回顯示 `@Handle`，不得顯示空白。

**F-11 v2.6.0 舊資料遷移與 JSON 匯入**（v22 新增）
- **自動遷移**：v3 第一次啟動時（及後台手動「重新遷移」），若偵測到 v2.6.0 的 IndexedDB（`YTLiveChatArchiverDB_V6`，結構與欄位對照見 `docs/legacy-v2.6.0-data.md`），由 background **唯讀開啟並複製轉換**到 `ytcas-v3`。
  - 開啟舊資料庫時**不得**指定版本號或觸發 `onupgradeneeded`；若開啟時意外進入 `onupgradeneeded`（代表舊資料庫不存在），必須 `abort()` 該交易，不得建立空的舊資料庫。
  - **不得**升級、修改或刪除舊資料庫。
  - 以 `id` 去重，可重複執行；完成後在 `chrome.storage.local` 記錄 `legacyMigratedAt`、`legacyCounts`（舊庫各 store 筆數）與 `migratedCounts`（實際寫入／略過筆數）。
  - 舊資料庫保留；後台提供「刪除舊版資料」按鈕，需二次確認，且僅在遷移筆數核對一致後才可按。
- **JSON 匯入**：後台檢視器「匯入 JSON」，支援 (1) v2.6.0 匯出格式、(2) v3 匯出格式；以 `id` 去重；匯入前顯示預覽（場次數、訊息數、重複數），完成後顯示結果。
- **v3 JSON 匯出**含 `formatVersion` 欄位（初版 `1`），確保可匯入回來。
- **時間碼為盡力而為**（v23）：舊資料的 `timestamp` 是擷取時間，`videoOffsetSec` 可能缺漏或有誤差；遷移資料的 VOD 同步（F-08）為盡力而為，不列入 6.5 AC。
- AC：遷移後舊資料庫筆數不變；v3 場次數與訊息數與舊資料一致；同一檔案匯入兩次不產生重複；匯入格式錯誤時顯示錯誤，不寫入任何資料。
- （v27）遷移與匯入同樣套用 F-14 的合併規則（`sources` 分別記 `legacy`、`import`）。

**F-13 YouTube 禮物（Jewels）訊息**（v27 新增）
- **背景**：YouTube「禮物（Gifts）」是觀眾以 Jewels（在手機 App 購買的虛擬貨幣）送出的動畫貼圖，送出後聊天室會顯示公告；已從直式直播擴展到橫式直播。這與「贈送會員資格（gift memberships）」是**不同的功能**。實機已確認輸入區有 `div#jewels-gifts-button`（`docs/youtube-dom-notes.md` 2.5）。
- **類型 `gift`**（`constants.js` 的 `MSG_TYPE.GIFT`）。欄位：作者、頭像、`giftName`（禮物名稱）、`giftImage`（禮物圖片，需在圖片白名單內）、`giftCount`（數量，若有）、`jewels`（Jewels 數值，聊天室有顯示才存）、`timestampAbs`、`videoOffsetSec`。
- **分類**：`superchat`、`supersticker`、`gift` 歸入「💰 SC／禮物」膠囊；贈送會員（`gift-purchase`）、收到會員（`gift-redemption`）、新會員、里程碑歸入新的「👑 會員」膠囊（F-05）。
- **元件標籤未知**：禮物公告元件尚未在實機出現，`selectors.js` 標「待實機確認」。在取得標籤前，依 F-02「未知元件」規則 `console.info` 一次並存為 `system`。使用者遇到禮物時執行 `docs/poc-clip-path.md` 附錄 D「訊息元件清單」腳本，取得標籤後補 `selectors.js`，並以 `RECLASSIFY_SYSTEM`（4.2）把既存的 `system` 紀錄重新分類：只依保存時記下的元件標籤（`system` 紀錄需保存 `rawTag`）判斷，不重新解析文字；可重複執行，結果寫入診斷（只記筆數）。
- 視覺與 SC 卡片可區分（10.4）。
- AC：禮物公告以 `gift` 保存並出現在「💰 SC／禮物」膠囊；與贈送會員不混淆；標籤補上前收錄的 `system` 紀錄在重新分類後改為 `gift`，筆數不變、無重複。

**F-14 重複收錄與合併規則**（v27 新增）
- **原則**：一場直播／一部影片 = 一份存檔（以 `videoId` 為鍵）；同一則訊息只存一次（以 YouTube 訊息 id 為鍵）。重複進入只會**補進缺的**，不會覆蓋，也不會另存一份。

| 情境 | 行為 |
|---|---|
| 同一場直播重新整理／離開再回來 | 同一份存檔；已存在的訊息以 id 略過，新訊息加入 |
| 直播結束後看 VOD 重播 | 同一份存檔（同 `videoId`）。重播訊息與直播收錄的 id 相同 → 合併；不同 → 後備去重 |
| 重複觀看同一部 VOD | 同一份存檔，不產生重複 |
| 兩個分頁同時開同一場 | background 以 `videoId` 為單位序列化寫入，`put` 為冪等，不重複 |
| 訊息被管理員刪除 | 保留原內容，標記 `deleted: true`、`deletedAt`；檢視器顯示「已刪除」標記（可篩選隱藏） |
| v2.6.0 舊資料遷移（F-11）、JSON 匯入 | 同一套合併規則 |

- **欄位合併**（同一 id 再次出現時）：
  - 不覆蓋已有的非空欄位（保留第一次收錄的內容）。
  - 補齊空欄位。例外：`videoOffsetSec` 在既有值為 `estimated`、新值來自重播 `#timestamp` 時，以重播值更新並改記 `offsetSource: 'replay'`。
  - 更新 `lastSeenAt`；`sources` 累加（`live`、`replay`、`import`、`legacy`）。
- **後備去重**（只在 id 不一致時啟用）：
  - 指紋 `fp = hash(type + authorHandle + 正規化後的訊息文字（含表符 alt）+ round(videoOffsetSec / 3))`；同一 `videoId` 內 `fp` 相同且 id 不同時視為同一則，合併到先存在的紀錄，並記錄於診斷（只記筆數）。
  - `videoOffsetSec` 為 `null` 的訊息不做後備去重。
  - **T3 第一步必須先驗證**：同一場直播，直播中收錄的一則訊息與重播中同一則的 id 是否相同（只比對 id，不輸出內容），結果寫入 `docs/youtube-dom-notes.md`。
- **收錄紀錄 `capture_sessions`**（4.1）：每次開始收錄（chat frame 開始擷取）記一筆，結束時補 `endedAt`、`lastOffset`、`added`、`merged`、`phases`。
  - 後台場次清單顯示「直播收錄 2 次・重播 1 次」，以及**時間軸覆蓋範圍**（只會收錄實際有開著的時段，中途離開的空檔一目了然；含 `pre`／`post`）。
  - 不提供「另存新檔」；提供「清空此場次後重新收錄」（`RESET_STREAM`，需二次確認：刪除該 `videoId` 的 messages、pinned_messages、capture_sessions，保留 streams 基本資料）。
- **待機室與直播結束後的聊天（`phase`）**：直播開始前的待機室、直播結束後聊天室仍開放的幾分鐘，聊天室都在運作，但這兩段**不會出現在 VOD 重播裡**，是套件存檔的獨有價值，必須保留。
  1. **照常收錄**：只要 `live_chat` 聊天室 iframe 存在、分頁開著，就擷取與修剪，不論直播是否已開始或已結束。
  2. **`phase`**：`pre`（開播前）／`live`（直播中）／`post`（結束後）。`pre` 的 `videoOffsetSec` 存**負值**（距開播的秒數），開播時間未確定時先存 `null`，開播後回填；`post` 依開播時間照算（會超過 VOD 長度）。
  3. **判斷方式（待 T3 實機確認）**：開播時間來源 `meta[itemprop="startDate"]` 在待機室是「預定時間」還是不存在、開播後如何變化；結束訊號（頁面是否出現「直播已結束」、`isLiveBroadcast`／`endDate` meta、聊天室系統訊息等）。只記錄標籤與屬性，寫入 `docs/youtube-dom-notes.md`。判斷不確定時依 `timestampAbs` 與已知開播／結束時間推算，並允許事後修正（開播或結束時間確定後，由 bg 重算該場次的 `phase` 與 `pre` 的 offset）。
  4. **檢視器**：訊息清單以分隔線區隔「直播開始前（待機室）」「直播中」「直播結束後」；VOD 時間軸同步（F-08）只作用於 `live` 段，`pre`／`post` 不參與跟隨與跳轉，時間碼顯示為「開播前 12:34」「結束後 3:05」，不可點擊。
  5. **合併**：重播不會帶入 `pre`／`post` 訊息，這兩段只來自直播收錄，合併與去重規則不變。
- AC：
  1. 同一場直播重新整理 3 次，訊息總數等於不重複 id 數；場次清單只有一筆。
  2. 直播收錄後看 VOD 重播，同一份存檔；重播補到的訊息 `sources` 含 `replay`，`offsetSource` 更新為 `replay`。
  3. 兩個分頁同時開同一場，無重複。
  4. 被刪除的訊息保留並顯示「已刪除」，可篩選隱藏。
  5. 同一 JSON 匯入兩次、遷移重跑，均無重複。
  6. 場次清單正確顯示收錄次數與覆蓋範圍；「清空此場次後重新收錄」需二次確認。
  7. 在待機室開著聊天室 → 有存檔且標 `pre`；開播後同一份存檔繼續累加；結束後幾分鐘的訊息標 `post`；觀看 VOD 時 `pre`／`post` 訊息完整保留且不干擾時間軸同步。

### B. 檢視器 UI（`viewer.html` / `viewer.js`）

**F-04 前後台介面分離**（v2.6.0 已驗證可行）
- `embed=1`：隱藏場次下拉、匯出/刪除列。
- 後台：場次切換、匯入 JSON（F-11）、匯出離線 HTML（v21：表符、會員貼圖、頭像一律由 background 抓取並內嵌為 data URL，同一網址只抓一次；抓取失敗時退回 alt 文字/色塊；內建離線搜尋框）、匯出 JSON（含 `formatVersion`）、刪除。

**F-05 快速分類膠囊列**（v2.6.0 已驗證可行）
- （v27 改為 4 個）「全部訊息（N）」、「💰 SC／禮物」（Super Chat、超級貼圖、禮物 `gift`）、「👑 會員」（新會員、里程碑、贈送會員、收到會員）、「✨ 實況主降落」。
- 窄面板仍為單列（D2 定稿，以 container query 依工具區寬度判斷）：面板 ≤ 376px（含 340／360px）「全部」只顯示數字並縮短間距；≤ 316px（最窄 300px）再隱藏膠囊前的圖示；仍放不下時膠囊列可水平捲動（不換行）。
- （v27）另有「隱藏已刪除訊息」切換（F-14），放在面板 ⋯ 選單與後台篩選區，不佔膠囊列。
- 降落 = Raid 橫幅 + 帶 `verified` 徽章的其他實況主發言；**排除** `constants.js` 的 `BOT_BLOCKLIST`（至少 `Nightbot`、`StreamElements`、`Streamlabs`、`Moobot`、`Fossabot`，比對不分大小寫，同時比對名稱與 @Handle）以及本台 `owner`/`moderator`。

**F-06 搜尋列順序**（v2.6.0 已驗證可行）
- 左：「過濾使用者 (頻道名稱 / @代碼)...」；點列表中的名稱可一鍵帶入。
- 右：「搜尋訊息關鍵字或表符...」；命中處 `<mark>` 高亮（表符以 `alt`/`shortcut` 比對）。
- 輸入 debounce 200ms。

**F-07 懸浮主播置頂卡片**（v2.6.0 已驗證可行）
- 置頂訊息去重後固定在搜尋列下方，不混入一般流；點擊展開/收合；顯示主播頭像。
- **與原生置頂列的關係**（v24）：目前 YouTube 版面把置頂訊息放在**輸入列正上方**（屬於底部互動區，F-10 必須露出，見 6.3），而不是舊版的聊天室頂部橫幅。面板內仍顯示置頂卡片（訊息列表由套件接管），但**不得與原生那條列功能衝突**，例如點擊展開時不應互相遮蓋；D1 設計稿需考量這一點。

**F-08 VOD 時間軸雙向同步**（v2.6.0 已驗證可行；預設開啟，無開關）
- 依 `VOD_TIME` 對 `videoOffsetSec` 二分搜尋定位、平滑捲動、藍框高亮當前訊息。
- （v27）只作用於 `phase: 'live'` 的訊息；`pre`／`post` 段不參與跟隨與跳轉（F-14）。
- 使用者手動往上捲 → 暫停跟隨，底部出現「↓ 恢復自動捲動」。
- 點藍色時間碼（如 `2:02:10`）→ `SEEK_TO`，播放器跳轉。

### C. YouTube 頁面整合（`content.js`）

**F-09 單一精簡控制按鈕**（v2.6.0 已驗證可行；v24 依目前 YouTube 版面重新設計錨點）
- 文字「開啟優化面板」，開啟後變紅色「關閉優化面板」。不顯示大型說明橫幅。
- **多重錨點、依序嘗試**（v24）：目前 YouTube 版面已沒有聊天室下方的「隱藏聊天室」列，改為聊天室右上角 `✕` 與影片下方「聊天室／開啟面板」卡片。開關位置依狀態決定，所有位置都在聊天室區域或其原生卡片內（10.1 原則 6），選擇器全部寫在 `selectors.js`：

| 狀態 | 位置 | 說明 |
|---|---|---|
| 聊天室展開、優化面板**關閉** | **聊天室頂部列**（`chat.header` = `yt-live-chat-header-renderer`，chat frame 內），`⋮`（v25 實機確認：`yt-live-chat-button#live-chat-header-context-menu`）之前、同一父層；**不得**放進 `#view-selector`（v24 PoC 誤放於此）；小型圖示按鈕＋提示文字「開啟優化面板」 | 由 chat frame content script 注入；點擊後送 `TOGGLE_PANEL`（4.3）給 top frame 執行開啟 |
| 聊天室展開、優化面板**開啟** | **優化面板自己的頂部列**，紅色「關閉優化面板」 | 原生頂部列此時已被 clip 裁掉，看不到也點不到，開關必須在面板內 |
| 聊天室已關閉（`✕`） | 影片下方「聊天室／開啟面板」卡片（`top.chatTeaser`，判定規則見 `selectors.js`），「開啟面板」按鈕右側 | 點擊時先展開原生聊天室，再開啟優化面板（自動喚醒展開）。聊天室展開時原生「開啟面板」為停用但卡片仍在，此時注入按鈕仍可用，點擊直接開啟優化面板 |
| 舊版面（有 `top.showHideButton`） | 該列右側 | 相容用，YouTube A/B 測試仍可能出現 |
| 備援 | 擴充功能 popup 的開關、鍵盤快速鍵（可在 popup 關閉快速鍵） | 以上位置全部找不到時 `warnOnce()`，仍可從 popup 操作 |

- 每個錨點找不到時都要 `warnOnce()`，不得靜默失敗。
- 注入到原生頂部列或卡片的按鈕：樣式只能加在 `ytcas-` 前綴的元素上，**不得**改動原生元素的 class、樣式或版面；不得依賴 YouTube 版本化的樣式類別（如 `ytSpecButtonShapeNext*`、`ytVideoMetadataCarouselViewModel*`）做比對，只用標籤名稱與 id 定位。
- 卡片區（`#teaser-carousel`）會隨導航重建：以 `MutationObserver` 監看 `ytd-watch-metadata`，並在 `yt-navigate-finish` 後重新掛載。
- **預設開啟（v24 已決，使用者 2026-11-15）**：進入有聊天室的影片頁（直播或有聊天重播的 VOD）時，優化面板**預設開啟**；**不記住**上次關閉狀態（使用者在某頁關閉只對該次頁面有效）；沒有聊天室的影片不顯示任何東西。

**F-10 直播中保留底部原生互動輸入區**（v2.6.0 未解決，本版重點，詳見第 6 節）

**F-12 自動切換「即時聊天室」**（v25 新增，使用者 2026-11-15 決定）
- 目的：YouTube 預設的「重點聊天室訊息」會過濾部分訊息；切到「即時聊天室」才能盡量保存完整訊息流（仍受 1.3 的限制）。
- 開啟優化面板時（含預設開啟），在 chat frame 檢查 `chat.viewSelector.items`（`#live-chat-view-selector-sub-menu tp-yt-paper-listbox#menu > a`）：若第 1 個 `a` 為 `aria-selected="true"`（重點），點擊第 2 個 `a` 切到「即時聊天室」。
- 是否需要先展開選單（點 `chat.viewSelector.trigger`）才能點擊：**待實測**；實作時先直接點，切換失敗（第 2 個仍非 `aria-selected="true"`）再改為「展開 → 點擊」，仍失敗則 `warnOnce` 並放棄，不重試迴圈。
- 不依賴選單文字（多語系），只依位置與 `aria-selected`。
- 關閉優化面板時**不**切回。使用者之後自行切回「重點」時，同一頁面不再自動切換。
- （v26）**VOD 重播同樣適用**：實機確認 `/live_chat_replay` 也有同樣的兩項選單（第 1 項預設選取）。劇院模式下面板退讓時，F-12 仍執行（擷取持續運作，見 6.4）。
- AC：開啟面板後 2 秒內頂部列顯示為「即時聊天室」；已是「即時聊天室」時不做任何操作；關閉面板後保持「即時聊天室」；使用者手動切回「重點」後，本頁不再被切換；VOD 重播頁若沒有此選單則不做任何事、不報錯（只 `warnOnce`）。

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
1. `ytd-live-chat-frame` 與 `iframe#chatframe` **維持 YouTube 原生尺寸與 CSS**，套件不改其 `height`、`display`；`position` 只允許設為 `relative`（`ytd-live-chat-frame` 作為面板定位容器、`iframe#chatframe` 為了 `z-index`）。
2. chat frame 內**只做**：以 `visibility: hidden` 隱藏 `#item-list`（訊息列表）與 `yt-live-chat-header-renderer`。不得對 `yt-live-chat-app`、`#contents`、`#chat-messages` 設 `height`/`display`。
   - 若 `visibility:hidden` 在實測中仍導致版面跳動，可退為 `opacity:0`；`display:none` 只能作為最後手段並需實測輸入框仍渲染。
3. **錨定在聊天室元素內部**（v23；取代 v22 以前「同一 `position: relative` 容器 + 座標計算」的寫法，該寫法在劇院模式錯位）：
   - 優化面板插入 **`ytd-live-chat-frame` 內**，作為 `iframe#chatframe` 的前一個兄弟；`position: absolute; inset: 0 0 auto 0; height: <iframe 高度>`，`z-index: 10`（下層）。YouTube 搬移聊天室（劇院模式、窄版面）時面板自然跟著走，**不得**用 `getBoundingClientRect()` 換算座標或 `setInterval` 輪詢重排。
   - `ytd-live-chat-frame` 設 `position: relative`；`iframe#chatframe` 設 `position: relative; z-index: 20`（上層），**`clip-path` 套在 `iframe#chatframe` 本身**（T1 步驟 8 實測與套在外層效果相同）。舊版面 iframe 下方的「隱藏聊天室」列不在 iframe 內，自然維持可見；F-09 開關位置見 5.C（v24 多重錨點）。
   - 面板高度以 `ResizeObserver` 監看 iframe；以 `MutationObserver` 監看 `ytd-live-chat-frame` 的 childList，YouTube 重新渲染移除面板時重新插入。
4. **裁切狀態**（由 top frame 依 `CHAT_INPUT_STATE` 與 top frame 彈窗偵測設定在 `iframe#chatframe` 上；座標皆相對 iframe）：

| 狀態 | 條件 | clip-path（套在 `iframe#chatframe`） |
|---|---|---|
| 收起（平常） | `hasInput && !popupOpen && !topPopupOpen && !collapsed` | `inset(calc(100% - ${bottomZoneHeight}px) 0 0 0)`；`bottomZoneHeight` 一律動態量測（6.3），**不得**使用常數；套用前 clamp 在 `[0, iframe 高度]` |
| 聊天室摺疊／退讓（v24；v26 補充） | `collapsed`：`iframe#chatframe` 高度 < 閾值（PoC 暫定 200px，T6 定案，寫入 `constants.js`），或 `bottomZoneHeight` ≥ iframe 高度，或**面板剩餘高度 < 80px**（v26）。**劇院模式（`ytd-watch-flexy[theater]`）一律符合**：聊天室固定為 402×152 小框，與視窗大小無關 | **移除 `clip-path`、隱藏優化面板**，完全不干擾原生聊天室；條件解除後自動回到對應狀態。開關按鈕顯示低調的停用狀態（10.4）。**訊息擷取（F-02）、DOM 修剪（F-01）、F-12 不受影響，持續運作** |

   - **面板最小高度**（v26）：面板剩餘高度（iframe 高度 − `bottomZoneHeight`）≥ 160px 為正常；介於 80～160px（例如矮視窗＋投票卡）時**仍完整露出原生互動區**，面板縮到剩餘空間（頂部工具區可收合以保留訊息列表）；< 80px 視同摺疊退讓。
| 彈窗展開 | `popupOpen`（chat frame 內） | `inset(${max(0, popupTop - 8)}px 0 0 0)`（只露出彈窗以下，彈窗自然向上長出覆蓋面板，不露出上方空白） |
| top frame 付款視窗（v23 定案） | `topPopupOpen`（top frame 偵測到頁面層付款視窗，6.3） | 頁面層付款視窗本身不受 clip-path 影響。付款流程中 chat frame 內的 `yt-live-chat-message-buy-flow-renderer` 仍為開啟，clip 本已維持「解除」；**頁面層視窗開啟期間 clip 維持解除（沿用前一個彈窗狀態），chat frame 與頁面層兩邊都關閉後才回到「收起」**，避免流程中途閃回 |
| 無輸入區 | `!hasInput`（VOD 重播、未登入、聊天室關閉、僅會員可留言而非會員…） | `inset(100% 0 0 0)`，面板佔滿全高 |
| 優化面板關閉 | 使用者關閉面板 | 移除 `clip-path` 與所有套件樣式，完全還原 |

   - `clip-path` 裁掉的區域在 Chrome 的 hit-testing 中不接收滑鼠事件，點擊/滾輪會落到下層面板；這是本設計成立的關鍵，**第一個任務必須先做 PoC 驗證**（第 8 節 T1）。
   - 切換加 `transition: clip-path 120ms ease-out`（可在 `prefers-reduced-motion` 時關閉）。
5. 優化面板底部需預留 `padding-bottom = bottomZoneHeight`，避免最後幾則訊息被原生底部互動區蓋住；「↓ 恢復自動捲動」按鈕也要在此高度之上。

### 6.3 chat frame 端：輸入區與彈窗偵測
- **底部互動區高度 `bottomZoneHeight`**（v24，取代 v23 的 `inputHeight`）：
  - 目前 YouTube 版面在訊息列表與輸入列之間，還會出現**置頂訊息列**、**投票／問答卡**、（可能）會員里程碑橫幅等「底部錨定」元素。它們都屬於原生互動區，**都必須露出**，否則被裁掉後使用者看不到也點不到。
  - 定義：`bottomZoneHeight` = iframe 底邊 − 所有**可見**底部錨定元素中**最高者的頂端**（即 `innerHeight − min(rect.top)`）。
  - 實測依據（v23 PoC 補測，2026-11-14）：`#input-panel` 只有 56px，但上方另有置頂訊息列，合計約 114px 才剛好（前次 58px／84px 差異也來自此）；有投票卡時超過 240px。只量 `#input-panel` 不夠。
  - **v25 定案：白名單量測**（實機結構見 `docs/youtube-dom-notes.md` 2.1；v24 的「底部 400px 內任何元素」近似法在實機把全高透明覆蓋層 `ytls-widget-overlay-manager` 算進去，得到 545px 的錯誤值）：
    - `chat.bottomZone`（白名單，依畫面由上而下）：`yt-live-chat-banner-manager`（置頂列）、`#panel-pages`、`#input-panel`。
    - `chat.bottomZoneOverlay` = `ytls-widget-overlay-manager`（YouTube 原生，蓋在訊息列表上；投票卡推測掛在此）：**容器本身不計**，只計其可見子元素。
    - `chat.bottomZoneExclude`：`#item-list`、`yt-live-chat-header-renderer`、`yt-live-chat-ticker-renderer`、`ytls-widget-overlay-manager` 本身。
    - `bottomZoneHeight` = iframe 高度 − min(白名單可見元素 `top`, 覆蓋層可見子元素 `top`)。實機 iframe 594px 時為 594 − 485 = 109px（與使用者手動調整的 114px 相符）。
    - **v26：投票卡在 `div#action-panel`**（`#chat` 的直接子元素，不在覆蓋層內；實機 top 355／高 182）→ 白名單加入 **`#chat > #action-panel`**（可見且高度 > 0 才計），排在最前。實機無置頂列＋投票卡時 `bottomZoneHeight` = 594 − 355 = 239px。其內部是否為 `yt-live-chat-action-panel-renderer`／`yt-live-chat-poll-renderer` 待實機確認。
    - **合理性檢查**（v26 調整）：
      - 覆蓋層子元素等**非白名單來源**：結果 > iframe 高度 × 0.6 → 不採計，並在 console 記錄一次。
      - **白名單元素不套用 60% 規則**（投票卡本來就可能很高），一律完整露出；面板剩餘高度依 6.2「面板最小高度」處理。
      - 量測值對應的 iframe 高度與目前不同（搬移、重載、縮放途中）→ 視為過期，等待重新量測，期間不套用舊值。
      - 全部量不到時，退回「`#input-panel` 頂端到 iframe 底邊」的後備算法。
    - VOD 重播（v26 實機）：`#input-panel` 與置頂列存在但高度 0 → `bottomZoneHeight = 0`，面板佔滿全高（等同 6.2「無輸入區」）。
  - 以 `ResizeObserver` 監看各候選元素與其父容器，另以 `MutationObserver` 監看候選元素的出現／消失。
  - **一律動態量測，不得使用常數**；`constants.js` 不得出現 84 之類的預設裁切值（PoC 除外）。量測不到時視同 `!hasInput`。
- 彈窗偵測（選擇器放 `selectors.js`，以 `MutationObserver` 監聽屬性/子樹 + 每 500ms 保底輪詢；v25 依實機結構定案，見 `docs/youtube-dom-notes.md` 2.5）：
  - 表符按鈕：`#emoji-picker-button` ＞ `yt-live-chat-icon-toggle-button-renderer#emoji`；表符選單：`yt-emoji-picker-renderer`
  - `$` 按鈕：`yt-live-chat-icon-toggle-button-renderer#product-picker`；`$` 選單：`tp-yt-iron-pages#pickers > yt-live-chat-product-picker-panel-view-model#product-picker`。**`$` 選單長在 `#input-panel` 內**，展開時 `#input-panel` 高度本身會變，`bottomZoneHeight` 會自然涵蓋；關閉時該元素是否仍「可見」待實機確認（若仍可見，不得列為 `popupOpen` 條件）
  - 購買流程：`yt-live-chat-message-buy-flow-renderer`
  - 其他：任何「可見」的 `tp-yt-iron-dropdown`、`tp-yt-paper-dialog`
  - 「可見」定義：`getBoundingClientRect().height > 0` 且計算樣式非 `display:none`/`visibility:hidden`。
  - `popupTop` = 所有可見彈窗 `rect.top` 最小值。
- **top frame 彈窗偵測**（v22）：部分 `$` 付款確認視窗開在整頁中央（top frame），不在 chat frame 內。top frame 偵測可見的頁面層付款視窗（選擇器放 `selectors.js` 的 `top.popups`），結果為 `topPopupOpen`，與 chat frame 回報的 `popupOpen` 一起參與 6.2 狀態表。v23：實測「完成購買程序」視窗**不在** `ytd-popup-container` 內。
  - **v24 定案**（使用者於付款視窗開啟中、top frame 執行診斷取得）：路徑 `body > div#buyFlowDivId > div#:0.contentEl > iframe#buyFlowDivIdIframe`，iframe 網域 `payments.youtube.com`（跨來源，**不讀取、不注入**），直接掛在 `body` 下，不在 `ytd-app`、也不在 `ytd-popup-container` 內。
  - `top.popups` 為明確清單：`#buyFlowDivId`（主，`position:fixed` 對話框，實測 600×642）、`iframe#buyFlowDivIdIframe`；另有全頁遮罩 `body > .modal-dialog-bg`（`position:absolute`，輔助判斷）；`ytd-popup-container` 內的 `tp-yt-paper-dialog`、`yt-dialog-view-model` 保留作其他對話框備援。`b3-modal-dialog*` 等 class 只能作次要比對，不可單獨依賴。**不得**使用 `#:0.contentEl`（動態 id），**不得**使用 `ytd-popup-container > *` 這類萬用規則。v23 PoC 補測已能偵測到「頁面浮層：div#buyFlowDivId」。
  - 偵測以明確選擇器為主；`position: fixed` 大型浮層掃描只作輔助（`#buyFlowDivId` 不保證是 fixed）。
  - 可見判定同上（rect 寬高 > 0、非 `display:none`／`visibility:hidden`；關閉後元素可能仍留在 DOM）。
  - 監看：`MutationObserver` 監看 `body` 的 childList，以及 `#buyFlowDivId` 的 `style`／`class`／`hidden`／`aria-hidden`；另加 500ms 保底輪詢。
  - 診斷指令（只輸出 iframe 網域、id、class、大小、父元素路徑，不讀文字）保存在 `docs/poc-clip-path.md` 附錄，YouTube 改版時重跑。
- 狀態有變化才送 `CHAT_INPUT_STATE`（相同狀態 debounce 50ms 合併），避免洗訊息。
- 購買流程進入第二步時，原生會自行處理層級；套件**不得**再對 dropdown 加任何 `display`/`z-index` 覆寫（v18 重疊問題來自混合覆寫）。

### 6.4 top frame 端
- 只信任來自 `iframe#chatframe.contentWindow` 的訊息（比對 `event.source`）。
- 收到狀態 → 更新 `iframe#chatframe` 的 CSS 變數 `--ytcas-clip`（v23：clip 套在 iframe 本身）；樣式寫在一個注入的 `<style id="ytcas-style">`，關閉面板時整個移除。
- 面板錨定在 `ytd-live-chat-frame` 內部（6.2 第 3 點），劇院模式、全螢幕、視窗縮放時不需重算座標；`yt-navigate-finish` 時確認面板仍在、狀態重新同步。
- **劇院模式與窄版面**（v24）：v23 PoC 補測顯示，劇院模式與窄版面下原生聊天室本身被 YouTube 縮成約 150px，面板只剩頂部列、原生訊息蓋住面板（`inset(calc(100% - 114px) …)` 在矮 iframe 上等同無效）。要求：
  - 露出值 clamp 在 `[0, iframe 高度]`；符合 6.2「聊天室摺疊」條件時解除 clip、隱藏面板，不干擾原生聊天室。
  - 以 `MutationObserver` 監看 `ytd-live-chat-frame` 的屬性（`collapsed`、`theater`、`class` 等）與子元素，以及 `ytd-watch-flexy` 的屬性與聊天室被搬到其他容器（如 `#panels-full-bleed-container`）；變化時重新計算面板高度、clip 與摺疊狀態。`ytd-watch-flexy` 的子樹只看 childList，不看子樹屬性（避免播放進度等頻繁變化）。
  - **v25 實機確認的版面狀態**（`docs/youtube-dom-notes.md` 1.1，Chrome 157）：

| 版面 | 判斷依據（`selectors.js` 的 `top.layout`） | `ytd-live-chat-frame` 父鏈 | 聊天室框尺寸 | 套件行為 |
|---|---|---|---|---|
| 雙欄（預設） | `ytd-watch-flexy[is-two-columns_]`（無 `theater`） | `div#chat-container < div#secondary-inner` | 339×596；寬視窗 362×596 | 正常 |
| 單欄（視窗窄，非劇院） | `ytd-watch-flexy[is-single-column]`（無 `theater`） | `div#chat-container < div#below < div#primary-inner < div#primary < div#columns` | 427×596～453×596（全高，在影片下方） | 正常（v26 實機確認） |
| 劇院模式 | `ytd-watch-flexy[theater]`、`ytd-live-chat-frame[theater-watch-while]` | `div#chat-container < div#columns` | **402×152**（1250px 與 2560px 寬視窗皆同；劇院模式可同時帶 `is-single-column` 或 `is-two-columns_`） | **一律退讓**（6.2） |

  - 屬性只作輔助與診斷；是否摺疊仍以 iframe 實際高度判斷（6.2），不依賴屬性名稱。
  - **劇院模式的說明**（v26）：152px 小框內，聊天室內容仍以約 320px 排版（置頂列 top 211、輸入列 top 263，都在可視範圍外）。也就是 **YouTube 自己就把輸入列擠出畫面**，套件退讓是正確行為，不嘗試在小框內顯示面板。
  - **iframe 搬移會重新載入**（v26）：版面切換時 `ytd-live-chat-frame` 被搬到其他容器，`iframe#chatframe` 會重新載入，chat frame 的 content script 重跑，舊的量測與狀態全部失效。必須有**重新初始化流程**：
    - 觸發條件：iframe 的 `load` 事件、`ytd-live-chat-frame` 的父元素改變、iframe 元素被替換、面板不在聊天室內。
    - 動作：重置量測狀態 → 重綁 `ResizeObserver`／`MutationObserver` → 重新向 chat frame 握手取得狀態 → 重新套用 clip；每次都記錄原因（console）。chat frame 端重載後也要主動回報一次狀態，並重新開始擷取（以 `id` 去重，不重複寫入）。
    - **看門狗**：面板開啟期間每 1 秒檢查上述條件與摺疊條件，條件解除即恢復（v24.1 補測曾出現一次「劇院模式切回後未恢復」，再測又正常，原因未定，以看門狗保底）。暫停與恢復都記錄版面資訊，方便追查。
- **頁面層付款視窗**（v24 定案）：「完成購買程序」視窗為 `body` 直接子元素 `div#buyFlowDivId`（內含跨來源 `iframe#buyFlowDivIdIframe`），選擇器與監看方式見 6.3。偵測結果以 `topPopupOpen` 參與 6.2 狀態表。

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
10. （v24）在目前版面（聊天室右上角 `✕`、無「隱藏聊天室」列）與舊版面下，F-09 開關都看得到並可操作；聊天室關閉時從影片下方卡片開啟，會先展開聊天室再開啟優化面板。
11. （v24）進入有聊天室的影片頁時優化面板預設開啟；在該頁關閉後，換頁或重新整理會再次預設開啟（不記住關閉狀態）；沒有聊天室的影片頁不出現任何套件元素。
12. （v24）有置頂訊息列、有投票卡時，底部互動區完整露出（不切到置頂列、投票卡或輸入列，也不多露訊息列表）。
13. （v24）劇院模式與窄版面下，面板可用或自動退讓（聊天室摺疊時解除 clip、隱藏面板），且原生聊天室不受影響。
14. （v26）劇院模式下面板退讓期間，**仍持續存檔（F-02）與修剪（F-01）**；切回一般版面後面板自動恢復，退讓期間的訊息都在存檔內、沒有重複。

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
| 版面侵入 | 同 10.1 原則 6：所有套件 UI 只在聊天室區域內或 popup／後台分頁，影片與頁面主體上不得有任何套件元素；**每個 ⏸ 關卡都要檢查此項**（v23） |
| 網頁可存取資源 | `web_accessible_resources` 只開放 `src/viewer.html`（PoC 期間另加 `src/poc/poc-panel.html`），並設 `use_dynamic_url: true`，降低網頁偵測擴充功能的可能；viewer 的 js/css 由擴充功能頁面自行載入，不需開放（v22） |
| 權限 | 僅 `storage`、`unlimitedStorage`、`tabs`；host_permissions：`https://www.youtube.com/*`，以及匯出內嵌圖片用的 `https://*.ggpht.com/*`、`https://*.ytimg.com/*`、`https://*.googleusercontent.com/*`、`https://fonts.gstatic.com/*`、`https://www.gstatic.com/*`（v21 經使用者同意）。再新增權限需先徵得使用者同意 |
| 相容 | YouTube 改版時只需修改 `selectors.js`；所有選擇器找不到時須 graceful degrade（console.warn 一次，不拋錯） |

---

## 8. 開發任務清單（本機 Claude Code 依序執行）

標示 **⏸** 的任務完成後必須**停下來**，告訴使用者如何在 Chrome 測試或檢視，等使用者回覆再繼續。

| # | 任務 | 產出 | 完成條件 |
|---|---|---|---|
| T0 | 專案骨架：`manifest.json`、`src/` 結構、`selectors.js`、`constants.js`、空白 `tokens.css`、套件圖示 | commit | Chrome「載入未封裝項目」無錯誤 |
| T1 ✅ 通過（2026-11-15） | **clip-path PoC**：最小 content script，在 top frame 建立重疊容器，下層放一個可捲動/可點擊的測試面板，上層原生 `ytd-live-chat-frame` 套 `clip-path`，從 `iframe#chatframe` 底邊往上露出 84px（可調），即 `inset(${iframeBottom - frameTop - 84}px 0 0 0)`；下層可切換 div / 擴充功能 iframe，另可「完全不裁切」並觀察 top frame 付款視窗（v22） | `docs/poc-clip-path.md`（測試步驟、結論、Chrome 版本） | 使用者回報：上半部點擊/滾輪落到測試面板、下方輸入框可打字。成功 → 方案 A；失敗 → 方案 B（6.6），並更新本 SPEC。**v23：通過，F-10 定案方案 A**（Chrome 157.0.8103.51）；劇院模式錯位與頁面層付款視窗偵測於 T1 補測確認（PoC 改為錨定聊天室內部、clip 套在 iframe）。**v26：T1 關閉**。v24.1 補測在實機確認錨點、量測、付款視窗、摺疊退讓、不遮擋影片全部成立（`docs/review-2026-11-15-2.md` 3.4）；PoC 程式保留到 T9 移除 |
| D1 ✅ 選定方向 B（2026-11-15） | **設計稿**：依第 10 節做 `design/mockups.html`，提出 **2 種視覺方向**，每種含淺色/深色 | 設計稿 HTML | 使用者選定方向（可要求修改）。**v27：選定方向 B「柔和現代感」**，修改意見為主題自動跟隨系統並可手動選擇（10.2） |
| D2 ⏸ | 將選定方向落實為 `tokens.css`、`theme.js` 與元件 CSS；更新第 10 節「已選定方向」；設計稿只保留方向 B，頂部改為正式的「自動／淺色／深色」分段按鈕（自動實際跟隨系統），並加入禮物訊息、「👑 會員」膠囊、已刪除訊息、場次收錄來源與覆蓋範圍、待機室／結束後分隔線、主題設定 UI（v27） | commit | 設計稿與 token 一致；對比度符合 10.3；使用者視覺確認 |
| T2 | `db.js` + `background.js`：資料表、遷移、`SAVE_*`/`QUERY_*`、推播、頻道名稱解析器（F-02、F-03）；F-11 自動遷移（唯讀複製，不動舊資料庫）；（v27）`DB_VERSION` 2：`capture_sessions` 資料表、messages 新欄位與 `[videoId+fp]` 索引、v1→v2 遷移；F-14 合併規則（欄位合併、`sources` 累加、後備指紋去重、以 `videoId` 序列化寫入）、`CAPTURE_START/END`、`RESET_STREAM`、`RECLASSIFY_SYSTEM`、`MESSAGE_DELETED`；`phase` 事後重算 | commit | 以 DevTools 呼叫訊息 API 可寫入/查詢；遷移後舊庫筆數不變、新舊筆數一致；同一批訊息寫兩次無重複（F-14 AC 1、3、5） |
| T3 | chat frame：訊息擷取、置頂擷取、DOM 修剪、`yt-navigate-finish` 清理（F-01、F-02）；（v27）**第一步：直播／重播訊息 id 一致性驗證**（只比對 id，結果寫入 `docs/youtube-dom-notes.md`，決定後備去重的啟用條件）；`phase` 判斷來源的實機確認（`startDate`／結束訊號，只記標籤與屬性）；`gift` 擷取（標籤待實機）、`system` 保存 `rawTag`；刪除訊息偵測 | commit | 直播中 IndexedDB 持續增加、DOM 節點 ≤ 50；id 一致性驗證結果已寫入筆記 |
| T4 | viewer 核心：虛擬清單、訊息列、膠囊列（v27：4 個）、雙搜尋列、置頂卡片（F-04～F-07）；（v27）`pre`／`live`／`post` 分隔線、已刪除標記與隱藏切換、禮物卡片 | commit | 對既有場次資料可篩選、搜尋、高亮 |
| T5 ⏸ | top frame：「開啟/關閉優化面板」按鈕、內嵌面板、VOD 時間軸同步與 Click-to-Seek（F-08、F-09）；自動切換「即時聊天室」（F-12，v25）；（v27）`THEME` 傳遞、時間軸同步排除 `pre`／`post` | commit | 使用者在 VOD 與直播實測 |
| T6 ⏸ | F-10 完整實作：輸入區/彈窗偵測、`CHAT_INPUT_STATE`、clip 狀態機、面板底部 padding、關閉還原（第 6 節） | commit | 使用者依 6.5 AC 1～7 實測 |
| T7 | popup、後台獨立檢視器、匯出離線 HTML / JSON（含 `formatVersion`）、刪除；F-11 JSON 匯入 UI（v2.6.0 / v3 格式、預覽、去重）與「刪除舊版資料」按鈕；（v27）主題設定 UI（後台設定區、popup 底部）、場次清單收錄次數與覆蓋範圍、「清空此場次後重新收錄」、「重新分類系統訊息」 | commit | 匯出 HTML 離線開啟可搜尋；同一 JSON 匯入兩次無重複 |
| T8 ⏸ | 邊界情況與回歸：`$` 三種流程、劇院模式、縮放、深淺色切換、F-01～F-10 全部，更新 `docs/test-checklist.md` | commit | 使用者確認測試清單全數通過 |
| T9 | 發版 3.0.0：移除 `src/poc/` 與 manifest 中 PoC 的 content script、`web_accessible_resources` 的 `poc-panel.html`；更新 `manifest.json`、`VERSION`、`CHANGELOG.md` | `release: v3.0.0` | 見 `CLAUDE.md` 版本規則 |

---

## 9. 手動測試環境
- 測試直播：任一高流量直播（每分鐘 > 300 則）+ 一個自己能留言的低流量直播（測輸入/表符）。
- 測試帳號：需為某頻道會員以測會員表符；`$` 流程測到確認頁即可取消。
- Chrome：最新穩定版；記錄版本號於測試清單。
- 記憶體量測：Chrome 工作管理員（Shift+Esc）記錄 0 / 30 / 60 / 120 分鐘。
- **YouTube DOM 依據**（v25）：所有依賴 YouTube DOM 結構的功能（量測、錨點、彈窗偵測、擷取）以 `docs/youtube-dom-notes.md` 記錄的實機結構為準。模擬頁測試只能證明「程式邏輯沒錯」，報告中標為「模擬頁：邏輯檢查通過；真實結構待實機」，實機確認後才可標 ✅。新取得的診斷資料寫入該筆記（標註日期與 Chrome 版本），原始輸出存於 `docs/diag/`。
- **相容性**（v24）：使用者裝有 Holodex+（Console 會出現 `[Holodex+] live chat overrides injected`，它也會修改直播聊天室）。回歸測試需在**有／無 Holodex+** 兩種情況下各測一次；實測遇到錯位或樣式異常時，先停用 Holodex+ 重測以排除干擾。
- **必測情境**（v24）：有**置頂訊息列**的直播、有**投票卡**的直播（底部互動區高度會變）；劇院模式與窄版面。
- **必測情境**（v27）：待機室（開播前）開著聊天室直到開播、直播結束後留在頁面幾分鐘；同一場重新整理與直播後看重播（F-14）；有人送禮的直播（F-13）；主題 `auto` 下切換 Windows 淺色／深色與 YouTube 外觀（10.2）。
- **版面**（v24）：需同時測目前版面（聊天室右上角 `✕`、影片下方「聊天室／開啟面板」卡片）與舊版面（有「隱藏聊天室」列，若仍能遇到）。

---

## 10. UI 視覺設計規格（全部重新設計）

### 10.1 設計原則
1. **與 YouTube 共存、不冒充 YouTube**：內嵌在 YouTube 頁面時版面與密度要協調，但有自己的識別；不使用 YouTube 標誌、不照抄 YouTube 紅作為主色（「關閉優化面板」按鈕的紅色是功能狀態色，例外）。
2. **閱讀優先**：聊天訊息是主角，工具列與篩選要精簡；內嵌模式（`embed=1`）垂直空間最大化。
3. **一眼分辨訊息類型**：一般 / Super Chat / 超級貼圖 / 會員 / 里程碑 / 降落 / 置頂，各有一致的視覺語言。
4. **深淺色雙主題**：所有顏色只能用 token，不得在元件中寫死色碼。
5. **安靜的動態**：動畫只用在狀態轉換（展開、跟隨捲動、clip 切換），120～200ms；`prefers-reduced-motion` 時關閉。
6. **不遮擋影片與頁面主體**（v23，使用者硬性要求）：套件在 YouTube 頁面上的所有 UI（按鈕、面板、提示、設定）只能出現在**聊天室區域內**，或擴充功能 popup／後台分頁；**不得**有 `position: fixed` 或任何浮在影片、標題、說明、留言區上的元素；暫時提示（toast）也只能出現在面板內部。此原則適用於所有開發階段（含 PoC 與設計稿）。

### 10.2 主題系統（v27，取代舊版「主題切換」）
**設定**：存 `chrome.storage.sync`，所有介面共用；後台與 popup 都能修改，變更透過 `chrome.storage.onChanged` **即時套用到所有開啟中的介面**。

| 設定 | 選項 | 預設 |
|---|---|---|
| 主題模式 `themeMode` | `auto`（自動）／`light`（淺色）／`dark`（深色） | `auto` |

> 使用者 2026-11-15 確認：「手動調整深淺」指的是手動選擇淺色或深色兩種配色，**不需要**明暗程度滑桿。

**`auto` 的判斷來源**：
| 介面 | 來源 | 即時切換方式 |
|---|---|---|
| 內嵌面板、注入按鈕 | YouTube 目前實際套用的外觀（top frame `html[dark]`）。YouTube 外觀設為「使用裝置主題」時即等同系統設定 | top frame 以 `MutationObserver` 監看 `html` 的 `dark` 屬性 → `postMessage`（`THEME`，4.3）通知面板 iframe；chat frame 內的注入按鈕直接跟隨 chat frame 本身的外觀 |
| 後台檢視器、popup、匯出 HTML | 系統設定 `prefers-color-scheme` | `matchMedia('(prefers-color-scheme: dark)').addEventListener('change', …)` |

> 內嵌面板跟隨 YouTube 而非直接跟隨系統，是為了避免「YouTube 是淺色、面板是深色」的突兀。若使用者把 YouTube 外觀設為「使用裝置主題」，兩者一致。

- `light`／`dark` 時所有介面固定該配色，不受 YouTube 或系統影響（內嵌面板也是）。
- **實作**：`src/theme.js` 共用模組（viewer、popup、匯出 HTML），負責讀取設定、決定實際主題、監聽變更、在 `<html>` 套用 `data-theme="light|dark"`；內嵌面板的 YouTube 外觀由 `THEME` 訊息傳入。匯出 HTML 內嵌兩套 token 與同一段判斷（無 `chrome.*` 時視為 `auto`）。
- **UI 位置**：後台「設定」區與 popup 底部各一組分段按鈕「自動／淺色／深色」。內嵌面板不放設定 UI，但面板頂部列的 ⋯ 選單提供「切換主題」快捷（依序 自動 → 淺色 → 深色）。
- 首次繪製前就要套用主題（讀取 `storage.sync` 前先依來源猜測，避免閃白）。

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
              --ytcas-on-accent; --ytcas-on-danger;  /* v27：accent／danger 實心底上的文字色 */
              --ytcas-gift; --ytcas-gift-soft;       /* v27：禮物卡（F-13） */
  /* 字體 */  --ytcas-font: "Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif;
              --ytcas-font-mono: ui-monospace,"SF Mono",Consolas,monospace;  /* 時間碼 */
  /* 字級 */  --ytcas-fs-xs:11px; --ytcas-fs-sm:12px; --ytcas-fs-md:13px; --ytcas-fs-lg:15px; --ytcas-fs-xl:18px;
  /* 間距 4px 基準 */ --ytcas-space-1:4px … --ytcas-space-6:24px;
  /* 圓角 */  --ytcas-radius-sm:8px; --ytcas-radius-md:14px; --ytcas-radius-pill:999px;  /* v27：方向 B 定稿 */
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
| **注入按鈕**（F-09） | 三種形態（v24）：(1) 聊天室頂部列：與 `⋮` 同高的小型圖示按鈕＋提示文字「開啟優化面板」；(2) 影片下方卡片：與「開啟面板」同高、水平並排的膠囊按鈕；(3) 優化面板頂部列：`--ytcas-danger` 實心「關閉優化面板」。關閉狀態為次要按鈕樣式；皆有 hover / focus-visible / active 狀態。**退讓狀態**（v26，劇院模式或聊天室摺疊）：頂部列按鈕顯示停用樣式，提示文字「劇院模式下無法使用優化面板」；影片下方卡片的按鈕用**低調的停用樣式**（降低對比、無底色），**不得**使用紅色或警示色 |
| **頂部工具區** | 由上而下：膠囊列 → 雙搜尋列 → 置頂卡片。embed 模式整體高度 ≤ 96px（置頂卡片收合時） |
| **膠囊列**（F-05） | （v27）「全部 N」「💰 SC／禮物 N」「👑 會員 N」「✨ 降落 N」；選中為 `--ytcas-accent-soft` 底 + accent 文字；數字用 tabular-nums；340px 寬仍單列（「全部」只顯示數字，見 F-05） |
| **禮物卡**（F-13，v27） | 與 SC 卡區分：不用等級色實心底，改為 `--ytcas-gift-soft` 淡底 + `--ytcas-gift` 左側色條；左側禮物圖片 40px，右側「送出 禮物名稱 ×數量」與 Jewels 數值（有才顯示） |
| **已刪除訊息**（F-14，v27） | 內容降為 `--ytcas-text-3`、加刪除線，名稱旁「已刪除」細框徽章；可由「隱藏已刪除訊息」切換隱藏 |
| **時段分隔線**（F-14，v27） | 細線＋置中標籤「直播開始前（待機室）」「直播中」「直播結束後」；`pre`／`post` 段的時間碼改為「開播前 12:34」「結束後 3:05」純文字，不可點擊 |
| **雙搜尋列**（F-06） | 左「過濾使用者 (頻道名稱 / @代碼)...」、右「搜尋訊息關鍵字或表符...」；各帶圖示與清除鈕；過濾中的使用者以 chip 顯示，可點 × 移除 |
| **置頂卡片**（F-07） | 浮在工具區下方；左側主播頭像 + 「置頂」標籤；收合時單行省略，點擊展開全文；`--ytcas-shadow-1` |
| **訊息列** | 頭像 24px → 時間碼（mono、`--ytcas-timecode`、可點）→ 名稱（主名稱粗體 + 淡色 @Handle）→ 徽章 → 內容；表符與文字基線對齊，表符高 20px（會員貼圖 24px）；行高 1.45；hover 顯示淡底 |
| **Super Chat / 超級貼圖卡** | 圓角卡片，上半金額列（頭像、名稱、金額），下半訊息；超級貼圖顯示貼圖 72px |
| **會員 / 里程碑** | 左側 `--ytcas-member` 色條 + 標籤 |
| **降落高光**（F-05） | Raid 橫幅：整列 `--ytcas-raid-soft` 底 + `--ytcas-raid` 左邊框 + 「✨ 降落」標籤；認證實況主發言：名稱旁加 raid 色徽章 |
| **VOD 當前訊息**（F-08） | `--ytcas-current-ring` 2px 內框，平滑移動 |
| **「↓ 恢復自動捲動」** | 底部置中浮動膠囊按鈕，位於原生底部互動區（`bottomZoneHeight`）之上 8px |
| **空狀態 / 載入中** | 尚無訊息、搜尋無結果、資料庫載入中，各有簡短文字與圖示 |
| **後台檢視器** | 左側欄：場次清單（標題、頻道、日期、訊息數、直播/重播標籤、搜尋；v27：收錄次數「直播收錄 2 次・重播 1 次」與覆蓋範圍條，含 `pre`／`post`）；主區：同內嵌面板元件；頂部動作列：匯出 HTML、匯出 JSON、刪除（刪除需確認對話框）；（v27）「清空此場次後重新收錄」（二次確認）；設定區含主題分段按鈕 |
| **popup**（寬 360px） | 目前分頁狀態（是否在擷取、本場訊息數）→「開啟檢視器」主按鈕 → 最近 5 個場次 →（v27）底部主題分段按鈕「自動／淺色／深色」 |
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
- （v26）需反映實機版面：內嵌面板寬度以 **340／360／450px** 三種呈現；面板底部以灰色佔位畫出原生底部互動區的三種情況（只有輸入列 57px、置頂列＋輸入列 109px、投票卡 239px），確認可用空間與「↓ 恢復自動捲動」位置；面板頂部列含紅色「關閉優化面板」；F-07 面板內置頂卡片與原生置頂列並存時的呈現（預設收合為一行，避免重複感）；開關按鈕三種形態與**劇院模式退讓**狀態；訊息類型含 `author-type` 身分、會員加入、贈送／收到會員、系統訊息；VOD 模式（無底部互動區、當前訊息藍框）。
- 使用假資料（虛構頻道名稱與頭像色塊），不使用真實使用者頭像。
- （v27，D2）設計稿只保留方向 B，改為載入 `../src/styles/tokens.css`、`../src/styles/components.css`、`../src/theme.js`（仍不需網路，直接開啟即可）；頂部為正式的「自動／淺色／深色」分段按鈕，「自動」實際讀取系統設定並即時切換。

### 10.9 已選定方向
- **方向 B「柔和現代感」**（使用者 2026-11-15 選定）：帶紫的柔和底色、大圓角（`--ytcas-radius-sm` 8px／`--ytcas-radius-md` 14px）、以柔和陰影取代邊框、彩度較高的紫色強調、膠囊為實心底、訊息列留白較多。
- **主色**：紫色 `--ytcas-accent`（淺色、深色各一值，定稿數值與對比度見 `src/styles/tokens.css` 與 D2 報告）。時間碼、VOD 當前訊息維持藍色系；關閉優化面板維持紅色功能狀態色。
- **調整紀錄**：
  - v27：主題改為「自動／淺色／深色」三選一，自動跟隨 YouTube（內嵌面板）或系統（後台、popup、匯出 HTML），變更即時套用（10.2）；不做明暗程度滑桿。
  - v27：新增禮物卡、「👑 會員」膠囊、已刪除訊息、時段分隔線、場次覆蓋範圍（10.4）。

