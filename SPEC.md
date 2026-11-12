# YT 加強版聊天室套件 — 開發規格書（給 Claude Code）

| 項目 | 內容 |
|---|---|
| 規格版本 | **v19**（前版：v18 交接文件，見 `docs/handover-v18.md`） |
| 目標套件版本 | **2.7.0**（前版 2.6.0） |
| 目標環境 | Google Chrome 桌面版，Manifest V3 |
| 專案代號 | `yt-chat-archiver-saver` |
| 最後更新 | 2026-11-13 |

> **給 Claude Code 的閱讀順序**：先讀本檔第 0、1 節了解目標，再讀第 4 節（資料模型與訊息協定），第 6 節（F-10 新設計）是本版唯一的主要開發工作，第 8 節是逐步任務清單。共通開發規則見 `CLAUDE.md`。

---

## 0. 本版重點（TL;DR）

- F-01 ～ F-09 在 v2.6.0 **已實測可用**，本版只做「重構時不得退化」的保護。
- **F-10（直播中保留原生輸入區）是本版唯一要解決的問題**。v13～v18 的「壓扁 iframe」路線全部放棄，改採 **方案 A：原生 iframe 維持完整高度 + CSS `clip-path` 動態裁切**（第 6 節）。
- 方案 B（自建輸入框、呼叫 `youtubei/v1/live_chat/send_message`）列為**備案**，只在方案 A 驗收失敗時才啟動，且不處理金流。

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
├── manifest.json     # MV3：storage, unlimitedStorage, tabs；web_accessible_resources: viewer.html/js
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

> 若 repo 已放入 v2.6.0 原始碼（根目錄平鋪），可先維持平鋪結構；`src/` 搬移屬可選重構，必須獨立 commit 且不得改變行為。

### 3.2 資料流

```text
[chat frame content.js]
   MutationObserver 擷取新訊息 → 解析 → 批次(每 1s 或 50 筆) chrome.runtime.sendMessage
   每 3.5s 修剪超過 45 則的 DOM 節點
   監聽輸入區/彈窗狀態 → window.top.postMessage（給 top frame 控制 clip-path）
            │
            ▼
[background.js  Service Worker]  ← 唯一能讀寫 chrome-extension:// IndexedDB 的地方
   寫入 IndexedDB → 推播 NEW_MESSAGES 給所有已開啟的 viewer
   頻道 @Handle → 名稱/頭像解析（併發節流、快取 7 天）
            │
            ▼
[viewer.js（內嵌 embed=1 / 後台獨立分頁）]
   查詢、篩選、搜尋、置頂卡片、VOD 時間軸同步、匯出
```

**Origin 隔離原則**：`youtube.com` 頁面內的腳本**禁止**直接開 IndexedDB 存聊天資料，一律經由 `background.js`。

---

## 4. 資料模型與訊息協定

### 4.1 IndexedDB（DB 名稱 `ytChatArchive`，版本號隨 schema 遞增，必須寫 `onupgradeneeded` 遷移）

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

### 4.3 frame 間訊息（`window.postMessage`，只在 youtube.com 同源 frame 之間）

所有訊息格式：`{ __ytcas: true, type, ... }`。接收端**必須**檢查 `event.origin === 'https://www.youtube.com'` 且 `__ytcas === true`。

| type | 方向 | payload |
|---|---|---|
| `CHAT_INPUT_STATE` | chat frame → top | `{ hasInput: boolean, inputHeight: number, popupOpen: boolean, popupTop: number }`（px，相對 chat frame 視窗） |
| `VOD_TIME` | top → viewer iframe | `{ currentTime }`（每 250ms 或 `timeupdate`） |
| `SEEK_TO` | viewer iframe → top | `{ seconds }` |

---

## 5. 功能規格與驗收條件

> 每項都有 **AC（Acceptance Criteria）**，Claude Code 完成後必須逐條自我檢查，並更新 `docs/test-checklist.md`。

### A. 效能與資料收錄

**F-01 直播低記憶體佔用**（✅ 已完成，維持）
- chat frame 中每 3.5 秒將 `#items` 下超過 **45** 則的舊訊息節點 `remove()`。
- 監聽 `yt-navigate-finish`，切換影片時清除舊 observer、計時器與殘留空白圖片節點。
- AC：連續播放高流量直播 2 小時，聊天室訊息節點數恆 ≤ 50；切換 3 部影片後無重複 observer（以 console 計數確認）。

**F-02 完整富媒體歷史保存**（✅ 已完成，維持）
- 保存文字、官方 Emoji、會員貼圖（`src` + `alt`）、雙時間軸、頭像、頻道直連網址。
- 被修剪前一定先完成擷取（擷取在 MutationObserver 回呼內同步完成，修剪只動已擷取節點：以 `data-ytcas-saved="1"` 標記）。
- AC：同一訊息不重複寫入（以 `id` 去重）；匯出 JSON 與畫面數量一致。

**F-03 全自動頻道名稱解析**（✅ 已完成，維持）
- 無手動改名按鈕。`@Handle` 由 bg 抓頻道頁 `og:title`、`og:image` 解析；併發上限 **3**，失敗指數退避，快取 **7 天**。
- 顯示：主名稱 = 頻道名稱，副標淡色 = `@Handle`。
- AC：解析失敗時退回顯示 `@Handle`，不得顯示空白。

### B. 檢視器 UI（`viewer.html` / `viewer.js`）

**F-04 前後台介面分離**（✅）
- `embed=1`：隱藏場次下拉、匯出/刪除列。
- 後台：場次切換、匯出離線 HTML（內嵌表符圖片為 data URL 或保留原網址，內建離線搜尋框）、匯出 JSON、刪除。

**F-05 快速分類膠囊列**（✅）
- 「全部訊息（N）」、「💰 Super Chat」（含超級貼圖）、「✨ 實況主降落」。
- 降落 = Raid 橫幅 + 帶 `verified` 徽章的其他實況主發言；**排除** `constants.js` 的 `BOT_BLOCKLIST`（至少 `Nightbot`、`StreamElements`、`Streamlabs`、`Moobot`、`Fossabot`，比對不分大小寫，同時比對名稱與 @Handle）以及本台 `owner`/`moderator`。

**F-06 搜尋列順序**（✅）
- 左：「過濾使用者 (頻道名稱 / @代碼)...」；點列表中的名稱可一鍵帶入。
- 右：「搜尋訊息關鍵字或表符...」；命中處 `<mark>` 高亮（表符以 `alt`/`shortcut` 比對）。
- 輸入 debounce 200ms。

**F-07 懸浮主播置頂卡片**（✅）
- 置頂訊息去重後固定在搜尋列下方，不混入一般流；點擊展開/收合；顯示主播頭像。

**F-08 VOD 時間軸雙向同步**（✅，預設開啟，無開關）
- 依 `VOD_TIME` 對 `videoOffsetSec` 二分搜尋定位、平滑捲動、藍框高亮當前訊息。
- 使用者手動往上捲 → 暫停跟隨，底部出現「↓ 恢復自動捲動」。
- 點藍色時間碼（如 `2:02:10`）→ `SEEK_TO`，播放器跳轉。

### C. YouTube 頁面整合（`content.js`）

**F-09 單一精簡控制按鈕**（✅）
- 按鈕置於原生聊天室收合橫幅「開啟面板」右側水平並排；文字「開啟優化面板」，開啟後變紅色「關閉優化面板」。
- 開啟時若原生聊天室收合，自動展開以開始擷取。
- 不顯示大型說明橫幅。

**F-10 直播中保留底部原生互動輸入區**（❌ 本版主要工作，詳見第 6 節）

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
| 收起（平常） | `hasInput && !popupOpen` | `inset(calc(100% - ${inputHeight}px) 0 0 0)` |
| 彈窗展開 | `popupOpen` | `inset(${max(0, popupTop - 8)}px 0 0 0)`（只露出彈窗以下，彈窗自然向上長出覆蓋面板，不露出上方空白） |
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
| 安全 | 匯出 HTML 與 viewer 渲染時，所有使用者文字一律 `textContent` / 跳脫，禁止 `innerHTML` 拼接未跳脫文字；圖片只接受 `https://` 且網域為 `*.ggpht.com`、`*.ytimg.com`、`*.googleusercontent.com`、`yt3.ggpht.com` |
| 隱私 | 資料只存本機；不新增任何外部網路請求（頻道頁抓取除外，僅限 `www.youtube.com`） |
| 權限 | 不新增 manifest 權限；若必須新增需在 PR 說明理由 |
| 相容 | YouTube 改版時只需修改 `selectors.js`；所有選擇器找不到時須 graceful degrade（console.warn 一次，不拋錯） |

---

## 8. 開發任務清單（Claude Code 依序執行）

| # | 任務 | 產出 | 完成條件 |
|---|---|---|---|
| T0 | 讀取現有程式碼（若有 v2.6.0），建立 `selectors.js`、`constants.js`，把散落的選擇器與常數集中 | refactor commit | 行為不變 |
| T1 | **PoC**：在 top frame 對 `ytd-live-chat-frame` 手動套 `clip-path: inset(calc(100% - 84px) 0 0 0)`，驗證上半部點擊會穿透到下層面板、下半部輸入框可用 | `docs/poc-clip-path.md`（結論 + Chrome 版本） | 成功 → T2；失敗 → 改走 6.6 方案 B |
| T2 | chat frame：移除 v13～v18 所有高度/佈局覆寫；改為只隱藏 `#item-list`、header | commit | 對照 6.1 清單，舊覆寫全數刪除 |
| T3 | chat frame：輸入區高度 + 彈窗偵測 → `CHAT_INPUT_STATE` | commit | console 可看到狀態轉換正確 |
| T4 | top frame：重疊容器、z-index、`--ytcas-clip` 狀態機、關閉時完整還原 | commit | 6.5 AC 1～3、7 |
| T5 | 面板底部 padding 與「恢復自動捲動」位置調整 | commit | 6.5 AC 5 |
| T6 | `$` 三種購買流程、VOD、劇院模式、縮放實測與修正 | commit | 6.5 AC 4、6、8 |
| T7 | 回歸測試 F-01～F-09，更新 `docs/test-checklist.md` | commit | 6.5 AC 9 |
| T8 | 版本號 → 2.7.0（manifest.json、VERSION、CHANGELOG），打 tag `v2.7.0` | release commit | 見 `CLAUDE.md` 版本規則 |

---

## 9. 手動測試環境
- 測試直播：任一高流量直播（每分鐘 > 300 則）+ 一個自己能留言的低流量直播（測輸入/表符）。
- 測試帳號：需為某頻道會員以測會員表符；`$` 流程測到確認頁即可取消。
- Chrome：最新穩定版；記錄版本號於測試清單。
- 記憶體量測：Chrome 工作管理員（Shift+Esc）記錄 0 / 30 / 60 / 120 分鐘。
