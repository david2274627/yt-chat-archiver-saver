# YouTube DOM 結構筆記（實機確認）

> 本檔是 `selectors.js` 與模擬頁的**唯一依據**。只收錄在真實 YouTube 頁面上確認過的結構；每筆標註日期與 Chrome 版本。原始診斷輸出存於 `docs/diag/`。
> 規則：模擬頁測試只能證明「程式邏輯沒錯」；依賴 DOM 的功能必須以本檔記錄的實機結構為準，未記錄的結構一律標「待確認」。

最後更新：2026-11-15　Chrome 157.0.8103.51　淺色主題　台灣繁體中文介面

---

## 1. top frame（`www.youtube.com/watch`）

### 1.1 聊天室框的位置會隨版面移動（2026-11-15）
| 版面 | `ytd-watch-flexy` 關鍵屬性 | `ytd-live-chat-frame` 父鏈 | 框尺寸 |
|---|---|---|---|
| 雙欄（預設） | `default-layout`, `is-two-columns_`, `flexy-small-window_` | `div#chat-container < div#secondary-inner` | 339×596 |
| 單欄（視窗窄） | `is-single-column`, `full-bleed-player` | `div#chat-container < div#below < div#primary-inner < div#primary < div#columns` | 427×596（全高，在影片下方） |
| 劇院模式 | `theater`, `squeezeback`, `full-bleed-player`, `fixed-panels`, `watch-while-panels-active`, `flexy-large-window_` | `div#chat-container < div#columns` | **402×152**（被壓矮） |

- 聊天室框本身屬性：`id=chat`, `modern-buttons`, `rounded-container`, `round-background`；劇院模式另加 **`theater-watch-while`**。
- 共通存在：`#panels-full-bleed-container`、`ytd-popup-container`、`video.html5-main-video`、`meta[name="title"]`、`ytd-watch-metadata ytd-channel-name a`。
- 聊天室展開時 flexy 帶 `live-chat-present-and-expanded`、`panel-expanded`。
- **結論**：面板必須放在 `ytd-live-chat-frame` 內部才能跟著移動；劇院模式高度 152px 時套件應退讓（摺疊保護）。

### 1.2 直播開始時間
- `meta[itemprop="startDate"]` **存在**（同頁另有 `isLiveBroadcast`, `datePublished`, `uploadDate` 等 microdata）。
- `ytInitialPlayerResponse.microformat…liveBroadcastDetails` 在 Console 可見，但 **content script 讀不到頁面全域變數**，不要依賴。

### 1.3 影片下方「聊天室／開啟面板」卡片（2026-11-14，聊天室關閉狀態）
```
ytd-watch-metadata > #above-the-fold > #bottom-row > #teaser-carousel
> yt-video-metadata-carousel-view-model > … > yt-carousel-item-view-model
> yt-text-carousel-item-view-model > button-view-model > button（文字「開啟面板」）
```
- 同一輪播可能有多張卡（如會員福利）；以按鈕文字（`OPEN_PANEL_LABELS`）挑選，退為含圖示的卡。
- 不要用 `ytSpecButtonShapeNext*`、`ytVideoMetadataCarouselViewModel*` 等版本化 class。

### 1.4 `$` 付款確認視窗（2026-11-14）
- `body > div#buyFlowDivId.modal-dialog`（`position:fixed`, z-index 2000000000, 約 600×642）
- `body > div.modal-dialog-bg`（全頁遮罩，`position:absolute`, z-index 1999999999）
- 內含 `div#:0.contentEl`（**動態 id，不可用**）> `iframe#buyFlowDivIdIframe`（`payments.youtube.com`，跨來源，不讀取不注入）
- 不在 `ytd-app` 也不在 `ytd-popup-container` 內。關閉後元素可能仍留在 DOM，需以可見性判斷。

### 1.5 主題
- 淺色時 `html[dark]` 不存在（深色狀態尚未實測，預期為 `html[dark]`）。

---

## 2. chat frame（`www.youtube.com/live_chat`，直播）

### 2.1 根元素與整體結構（2026-11-15）
- `yt-live-chat-renderer` 屬性：**`hide-timestamps`**, `has-ticker`, `has-input-action-panel`, `enable-banner-update`。
- 版面：
```
yt-live-chat-renderer
└ tp-yt-iron-pages#content-pages
  └ div#chat-messages
    └ div#contents
      ├ yt-live-chat-header-renderer            （頂部列）
      ├ yt-live-chat-ticker-renderer [hidden]    （上方跑馬燈，當時隱藏）
      ├ div#chat
      │  ├ div#item-list > yt-live-chat-item-list-renderer#live-chat-item-list-panel
      │  │   > div#contents > div#item-scroller > div#item-offset > div#items   ← 訊息節點在此
      │  └ ytls-widget-overlay-manager            （**YouTube 原生**透明覆蓋層，top 49／高 436；子元素為 3 個高 0 的 div；投票卡推測掛在此。2026-11-15 停用 Holodex+ 後仍存在）
      ├ yt-live-chat-banner-manager#live-chat-banner   （**置頂列，在輸入列上方**，top 485／高 52）
      └ tp-yt-iron-pages#panel-pages > div#input-panel  （輸入區，top 537／高 57）
```
- iframe 高 594 時：底部互動區 = 594 − 485 = **109px**（含邊距約 114px）。

### 2.2 頂部列 `yt-live-chat-header-renderer`
- 屬性：`role=heading`, `prevent-chat-header-overflow`
- 子元素順序：`#primary-content`（`#title`, `#view-selector`）→ `#notification` → `#action-buttons` → `#viewer-leaderboard-entry-point` / `ytvl-live-viewer-leaderboard-chat-entry-point-view-model` → **`yt-live-chat-button#live-chat-header-context-menu`（⋮）** → `#close-button`（✕）
- **注入按鈕的正確位置**：`#live-chat-header-context-menu` 之前（同一父層）。**不要**放進 `#view-selector`（v24 PoC 誤放於此）。

### 2.3 「重點聊天室訊息／即時聊天室」切換
```
#view-selector > yt-sort-filter-sub-menu-renderer#live-chat-view-selector-sub-menu
> yt-dropdown-menu > tp-yt-paper-menu-button#menu-button
   ├ #trigger > tp-yt-paper-button#label（#label-text, #label-icon）
   └ tp-yt-iron-dropdown#dropdown > #contentWrapper > tp-yt-paper-listbox#menu
        ├ a [aria-selected=true]    ← 第 1 項：重點聊天室訊息（預設）
        ├ a [aria-selected=false]   ← 第 2 項：即時聊天室
        └ dom-repeat#repeat
```
- 切換到「即時聊天室」= 點第 2 個 `a`。是否需先開啟選單才可點擊：**待實測**。

### 2.4 訊息列表與訊息元件
- 容器：`#item-list #items`（確認）。
- `yt-live-chat-text-message-renderer`（確認）：
  - 屬性：`modern`, `enable-improved-visibility-style`, `whole-message-clickable`, **`author-type=<owner|moderator|member|…>`**（身分直接讀此屬性）
  - 元素 `id` = YouTube 訊息 id（例 `#ChwKGk…`）
  - 子元素：`yt-img-shadow#author-photo > img#img`、`span#timestamp`（**有值，長度約 7，CSS 隱藏**）、`span#prepend-chat-badges`、`span#author-name`（內含 `span#chip-badges`）、`span#chat-badges`（`yt-live-chat-author-badge-renderer > div#image`）、`span#message-container > span#message`（表符為 `img#emoji-N`，帶 `alt`/`src`）、`span#deleted-state`、`a#show-original`、`div#menu > yt-icon-button#menu-button`、`#inline-action-buttons`
  - **沒有作者連結**（`authorLink=false`）：頻道 URL 只能由 `@handle` 組成。
- `yt-live-chat-paid-sticker-renderer`（確認）：屬性 `is-v2-style`；`#card`, `#author-info`, `#author-photo img#img`, `#timestamp`, `#author-name`, `#purchase-description`, `#price-column > yt-formatted-string#purchase-amount-chip`, `#sticker-container > yt-img-shadow#sticker`, `#creator-heart-button`, `#buy-flow-button`；CSS 變數：`--yt-live-chat-paid-sticker-background-color`, `--yt-live-chat-paid-sticker-chip-background-color`, `--yt-live-chat-paid-sticker-chip-text-color`
- `yt-live-chat-viewer-engagement-message-renderer`（確認）：`#card`, `yt-icon#icon`, `#message-container > yt-formatted-string#message`, `#action-button`
- `yt-live-chat-banner-renderer`（置頂，確認）：屬性含 `collapsed`；`#banner-container > #header（yt-live-chat-banner-header-renderer，#menu > yt-button-renderer#menu-button）+ #contents（yt-live-chat-text-message-renderer#<訊息id>，結構同一般訊息）`、`#indeterminate-bar`
- `yt-live-chat-ticker-renderer`：`#container > #ticker-bar, #goal-ticker, #fanzone-ticker, #ticker-items, #left/right-arrow-container`
- **待確認（當時未出現）**：`yt-live-chat-paid-message-renderer`（SC 文字版）、`yt-live-chat-membership-item-renderer`、`ytd-sponsorships-live-chat-gift-purchase-announcement-renderer`、`ytd-sponsorships-live-chat-header-renderer`、`yt-live-chat-banner-redirect-renderer`（降落）、`yt-live-chat-poll-renderer`、`yt-live-chat-action-panel-renderer`、里程碑。

### 2.5 輸入區 `#input-panel`（2026-11-15）
```
#input-panel > yt-live-chat-message-input-renderer#live-chat-message-input
├ yt-live-chat-message-input-prompt-header-renderer   （提示列，如「以訂閱者身分聊天」；#primary-content > #close-button, #label-text, #help-button；#underline）
└ div#container
  ├ div#top
  │  ├ yt-img-shadow#avatar > img#img
  │  ├ div#input-container
  │  │   ├ yt-live-chat-author-chip（#author-name, #chat-badges…）
  │  │   ├ yt-live-chat-text-input-field-renderer#input（label#label, div#input, #underline, tp-yt-iron-dropdown#dropdown, #mention-suggestions）
  │  │   └ div#emoji-picker-button > yt-live-chat-icon-toggle-button-renderer#emoji > yt-icon-button#button > button#button [加入表情符號]
  │  └ div#right
  │     ├ #count-container > #count
  │     ├ #message-buttons > #send-button, svg#countdown（慢速模式倒數）
  │     └ #picker-buttons-container
  │        ├ div#jewels-gifts-button
  │        └ div#picker-buttons
  │           ├ yt-live-chat-icon-toggle-button-renderer#product-picker > … > button#button   ← **`$` 按鈕**
  │           └ yt-reaction-control-panel-overlay-view-model（❤ 反應：#reaction-control-panel > … > #collapsed-button / #expanded-buttons；#emoji-fountain）
  └ tp-yt-iron-pages#pickers
     └ yt-live-chat-product-picker-panel-view-model#product-picker   ← **`$` 選單本體，長在輸入區內**
```
- 表符選單 `yt-emoji-picker-renderer`（確認）：`#search-panel > tp-yt-paper-input#search`, `#clear-search`, `#skin-tone`, `tp-yt-iron-dropdown#dropdown`, `#category-buttons`, `#categories`, `#emoji-variant-selector`
- 購買流程 `yt-live-chat-message-buy-flow-renderer`（2026-11-14 確認存在於 chat frame；top 約 296px）
- 高度：`#input-panel` 56px（單行、無提示列時）；有提示列、多行、`$` 選單展開時會變。

### 2.6 Holodex+ 干擾
- 使用者裝有 Holodex+（Console 有 `[Holodex+] live chat overrides injected`）。
- `ytls-widget-overlay-manager` **不是**它注入的（停用後仍存在，2026-11-15 確認）。Holodex+ 對本套件的實際影響目前未發現，回歸測試仍需有／無各測一次。

---

## 3. chat frame（`live_chat_replay`，VOD 重播）
- **尚未診斷**。待確認：`#timestamp` 是否顯示、`#input-panel` 是否存在、頂部列與置頂列結構。

---

## 4. 診斷腳本
- `docs/poc-clip-path.md` 附錄：PoC 內建 `Alt+Shift+D`；chat frame 結構腳本；top frame 版面腳本；輸入區腳本。
- 注意：chat frame 內 DevTools 的 `copy()` 被覆蓋，腳本須 `console.log` 後 `try { copy(s) } catch {}`；輸出只含標籤、id、屬性名、尺寸，不含訊息文字。
