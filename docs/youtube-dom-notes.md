# YouTube DOM 結構筆記（實機確認）

> 本檔是 `selectors.js` 與模擬頁的**唯一依據**。只收錄在真實 YouTube 頁面上確認過的結構；每筆標註日期與 Chrome 版本。原始診斷輸出存於 `docs/diag/`。
> 規則：模擬頁測試只能證明「程式邏輯沒錯」；依賴 DOM 的功能必須以本檔記錄的實機結構為準，未記錄的結構一律標「待確認」。

最後更新：2026-11-20（1.6 直播徽章已驗證；2.7、2.8 待驗證）　Chrome 157.0.8103.51　淺色主題　台灣繁體中文介面

---

## 1. top frame（`www.youtube.com/watch`）

### 1.1 聊天室框的位置會隨版面移動（2026-11-15）
| 版面 | `ytd-watch-flexy` 關鍵屬性 | `ytd-live-chat-frame` 父鏈 | 框尺寸 |
|---|---|---|---|
| 雙欄（預設） | `default-layout`, `is-two-columns_`, `flexy-small-window_` | `div#chat-container < div#secondary-inner` | 339×596；寬視窗右欄 362×596 |
| 單欄（視窗窄，非劇院） | `is-single-column`, `full-bleed-player` | `div#chat-container < div#below < div#primary-inner < div#primary < div#columns` | 427×596～453×596（全高，在影片下方）；PoC 正常運作（2026-11-15 14:4x） |
| 劇院模式 | `theater`, `squeezeback`, `full-bleed-player`, `fixed-panels`, `watch-while-panels-active`, `flexy-large-window_`；可同時帶 `is-single-column` 或 `is-two-columns_` | `div#chat-container < div#columns` | **402×152**（被壓矮）。**1250px 與 2560px 寬視窗皆同，與視窗大小無關**；最大化時位於影片下方右側 |

- **劇院模式小框內的排版**（2026-11-15）：iframe 高 150，但聊天室內容仍以約 320px 排版（置頂列 top 211、輸入列 top 263、有投票卡時 `#action-panel` top 81），輸入列在可視範圍外 → YouTube 自己就把輸入列擠出畫面，套件一律退讓。
- **iframe 搬移會重新載入**：版面切換時 `ytd-live-chat-frame` 被搬到其他父容器，`iframe#chatframe` 重新載入，chat frame 的 content script 重跑。
- 劇院模式切回雙欄後 PoC 是否自動恢復：v24.1 第一次補測未恢復、第二次（14:38）有恢復，判定為偶發，原因未定；v24.2 起以重新初始化流程與看門狗保底。

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

### 1.6 播放器「直播」徽章（**已驗證**：2026-11-19 23:32，使用者 T5.2 實測，審查十一第 18 節）
- `.html5-video-player .ytp-live-badge`：在直播最新時，面板 ⋯「連線狀態」顯示「徽章 最新」，模式 tail、沒有藍框（3 場直播）；倒轉後為「非最新」。判定依據為 `disabled` 屬性或 `ytp-live-badge-is-livehead` class（`selectors.js` 的 `top.liveBadge`、`top.liveHeadClass`）；實機是哪一個依據尚未區分（連線狀態只顯示結果）。
- 同時記錄：`video.seekable.end − currentTime` 在最新時約 3,556 秒（3 場），`seekable.end` **不是**真正的直播邊緣。
- 播放器的直播延遲（「詳細統計資料」的 Live Latency）只在使用者打開該面板時才有 DOM；頁面 JS 的播放器 API 在 content script 的隔離環境讀不到。

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
      │  ├ ytls-widget-overlay-manager            （**YouTube 原生**透明覆蓋層，top 49／高 436；子元素為 3 個高 0 的 div。2026-11-15 停用 Holodex+ 後仍存在。投票卡**不在**這裡）
      │  └ div#action-panel                       （**投票卡**，2026-11-15 補測確認：`#chat` 的直接子元素，top 355／高 182，緊貼輸入區上方；沒有投票時不可見。內部是否為 action-panel-renderer／poll-renderer 待確認）
      ├ yt-live-chat-banner-manager#live-chat-banner   （**置頂列，在輸入列上方**，top 485／高 52）
      └ tp-yt-iron-pages#panel-pages > div#input-panel  （輸入區，top 537／高 57）
```
- iframe 高 594 時：底部互動區 = 594 − 485 = **109px**（含邊距約 114px）。PoC v24.1 自動量測實機得到 109px，剛好（2026-11-15）。
- 無置頂列、有投票卡時：594 − 355 = **239px**；只有輸入列時 57px（`#panel-pages` top 537）。
- `div#separator`（top 48／高 1）位於頂部列下方，不屬於底部互動區。

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
- 重播頁另確認：`yt-live-chat-membership-item-renderer`、`ytd-sponsorships-live-chat-gift-redemption-announcement-renderer`、`yt-live-chat-placeholder-item-renderer`、`yt-live-chat-ticker-sponsor-item-renderer`（見第 3 節）。
- `yt-live-chat-paid-message-renderer`（SC 文字版）：**確認存在**（2026-11-16 欄位統計：`superchat` 19 筆，金額 19／19 有值，即 `#purchase-amount`／`#purchase-amount-chip` 解析成功；顏色變數待 `fieldStats` 重跑確認）。
- 禮物 `yt-gift-message-view-model`：確認（見 5.3）。
- **待確認（尚未出現）**：`ytd-sponsorships-live-chat-gift-purchase-announcement-renderer`、`ytd-sponsorships-live-chat-header-renderer`、`yt-live-chat-banner-redirect-renderer`（降落）、`yt-live-chat-poll-renderer`、`yt-live-chat-action-panel-renderer`、里程碑。

### 2.7 超級貼圖的 `img`（**待驗證**，審查十一 17.2）
- `#sticker-container > yt-img-shadow#sticker` 內的 `img`：`src` 屬性的格式（`https://`／協定相對 `//lh3.googleusercontent.com/…`／空的／`data:` 佔位圖）與載入時機尚未實機記錄。
- 實機現象（2026-11-19 02:38）：$45.00 超級貼圖在面板中沒有圖（`stickerSrc` 為空），直播畫面正常。
- T5.3 處理：協定相對網址補 `https:`、先用屬性值再用已解析的 `.src`、只接受 https；`src` 晚於擷取出現時監看 10 秒補送；存 `alt` 當後備。
- 待確認：`img` 的 `alt` 是否為貼圖描述（或在 `aria-label`）。

### 2.8 訊息中的連結（**待驗證**，審查十一 17.1）
- 預期：`#message` 內 `<a class="yt-simple-endpoint style-scope yt-live-chat-text-message-renderer" href="https://www.youtube.com/redirect?event=live_chat&redir_token=…&q=<完整網址>">截斷的文字</a>`；站內連結（頻道、影片、`#hashtag`）為相對或 `https://www.youtube.com/…`。**以上未經實機確認**。
- 實機現象（2026-11-19 02:15）：網址在原生聊天室顯示為截斷文字（`https://madestudio.com.tw/zh/games/br...`），原生可點。
- `selectors.js`：`chat.link = { anchor: 'a[href]', redirectPath: '/redirect', redirectParam: 'q' }`。

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
2026-11-15，Chrome 157，以 `docs/poc-clip-path.md` 附錄 C 腳本取得（原始輸出見 `docs/diag/retest-v24.1-2026-11-15.txt`）。

- `yt-live-chat-renderer` 屬性：`hide-timestamps`, `has-ticker`, `enable-banner-update`（**沒有** `has-input-action-panel`）。
- `#input-panel` 存在但**高度 0**；`yt-live-chat-banner-manager` 高度 0；`#panel-pages` 高 1px → 底部互動區約 0，面板佔滿全高。`ytls-widget-overlay-manager` top 89／高 504（跑馬燈顯示中，所以 top 較直播大），沒有可見子元素。
- `span#timestamp` **有值**（長度 4，如 `1:23`，CSS 隱藏）→ 重播可直接由 `#timestamp` 得到 `videoOffsetSec`。
- 頂部列同直播，也有「重點／全部」切換選單（2 個 `a`，第 1 個 `aria-selected=true`）→ F-12 同樣適用。
- 當時 `#items` 下出現的元件：
  - `yt-live-chat-text-message-renderer`（結構同直播；`author-type=member` 確認）
  - `yt-live-chat-membership-item-renderer`：屬性 `modern`, `whole-message-clickable`, `has-primary-header-text`；`#card > #header（yt-img-shadow#author-photo > img#img；#header-content：#author-name（含 #chip-badges）、#chat-badges、#header-primary-text、#header-subtext、div#timestamp；#menu）+ #content > #message（可含 img#emoji-N）`、`#footer-button`
  - `ytd-sponsorships-live-chat-gift-redemption-announcement-renderer`（收到贈送會員；內部結構未展開）
  - `yt-live-chat-placeholder-item-renderer`（佔位元素，擷取時略過）
- 跑馬燈：`yt-live-chat-ticker-renderer > #container > #ticker-items > yt-live-chat-ticker-sponsor-item-renderer#<id>（#container > #content > yt-img-shadow#author-photo > img#img, span#text）`
- 仍未出現：SC 文字版、超級貼圖（重播）、gift-purchase、降落、里程碑、置頂（重播）。

---

## 5. T3 收錄實測（2026-11-16，使用者以套件診斷輸出取得；只有標籤、屬性名稱、時間與筆數）
來源：`docs/review-2026-11-16.md` 追加二～追加五。

### 5.1 開播時間 `meta[itemprop="startDate"]`（直播 `3LKGU…`，預定 19:15 +08:00、實際 19:24:38 開播）
| 時機 | `startDate` | `isLiveBroadcast` | 播放器長度 |
|---|---|---|---|
| 待機室（17:30） | `2026-11-16T11:15:00.000Z` = **預定時間**（整分） | `true` | `null` |
| 開播後、**未重新整理** | **不會更新**（仍為預定時間） | — | 待確認（T3.6 起有「播放器長度出現（診斷）」） |
| 開播後**重新整理** | `2026-11-16T11:24:38.000Z` = **實際開播時間**（有秒數） | `true` | 4537（DVR 可回放範圍，不是影片長度） |

- `isLiveBroadcast` 在待機室也是 `true` → **不能**用來區分待機與直播中。
- `ytd-watch-flexy` 屬性在實際開播前後**沒有任何變化**；觀察到的變化只有 `is-two-columns_`／`is-single-column`／`flexy-small-window_`／`full-bleed-player` 互換（視窗縮放造成的版面切換）→ 不能當作開播訊號。
- 直播中的播放器長度（例如 3600、4537）是 DVR 可回放範圍；F-18 只在重播時使用長度。
- **結論（T3.6 採用）**：實際開播時間只能靠「重新取得 watch 頁」的 `startDate`（background 重新抓取，見 SPEC F-14）。
- 站內換頁（點推薦中的另一個直播）後，top frame 的 `startDate`、`videoId` 會換成新直播的值（01:47 確認）。

### 5.2 直播結束（`M3na…`，02:54）
- 結束當下，聊天室 iframe **反覆重新載入**（多組「observer 已掛上 → 聊天室環境 → 收錄統計（結束）」）；`yt-live-chat-renderer` 的 `loading` 屬性出現／移除。
- 未重新整理時 `endDate` meta 是否出現：待確認。結束提示元件：尚未取得（附錄 C 腳本待執行）。

### 5.3 訊息元件
- **禮物（F-13）**：`yt-gift-message-view-model` 是 `#items` 的**直接子節點**（2026-11-16，同一場 4 則）。內部結構待確認（`docs/poc-clip-path.md` 附錄 E 腳本）。
- `yt-live-chat-viewer-engagement-message-renderer`（歡迎／守則提示）：每次重新載入聊天室都會出現一則，**元素 id 每次不同**（同一場 6 次重新整理存成 28 筆）→ T3.5 起以內容去重。
- 訊息元件**內部**的後代（徽章 `yt-live-chat-author-badge-renderer`、`yt-icon`、`yt-img-shadow`、`yt-image`、`span`、`div`、`button-view-model`、`yt-button-view-model`、`dom-if`、`yt-live-chat-reply-button-view-model`、`yt-live-chat-like-button-view-model` 等）會在訊息插入後才陸續渲染，而且很多帶有固定的 `id`（如 `message`、`author-name`、`image`）。以 `subtree` 監看時會被回報為新增節點 → 只能處理 `#items` 的直接子節點（T3.4）。
- 頁面上有 2 個 `#items`：第 1 個是可見的訊息列表（`#item-list` 內），第 2 個不可見、3 個子節點（用途未查）。
- 切到「即時聊天室」（F-12）時，YouTube 會以同 id 整批重新渲染列表（一次性的 `dupCaptured` 約 72～95）。

### 5.4 彈出式聊天室（F-19，`3LKGU…` 待機室，17:53～18:01）
- 網址：`https://www.youtube.com/live_chat?is_popout=1&v=<videoId>`；頂層頁面，結構與嵌入式相同，F-12 選單同樣存在（`f12: switched`）。
- **開啟彈出視窗時，YouTube 會先收起主分頁的聊天室**；主分頁的「聊天室 iframe 狀態（診斷）」同時段有 5 筆變化（最新一筆 `present: true`、`visible: true`、`height: 594`、`path: /live_chat`）。
- 關閉彈出視窗（✕）後，套件自動展開主分頁聊天室並恢復收錄；彈出視窗內 F5 重新整理時主分頁不會誤展開。
- 主分頁與彈出視窗同時收錄時，id 完全一致（`idMerged 25`、`added 0`）。

## 4. 診斷腳本
- `docs/poc-clip-path.md` 附錄：PoC 內建 `Alt+Shift+D`；chat frame 結構腳本；top frame 版面腳本；輸入區腳本。
- 注意：chat frame 內 DevTools 的 `copy()` 被覆蓋，腳本須 `console.log` 後 `try { copy(s) } catch {}`；輸出只含標籤、id、屬性名、尺寸，不含訊息文字。
