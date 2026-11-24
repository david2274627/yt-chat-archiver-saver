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

### 2.4b SC 的文字色 CSS 變數（**已驗證**：超級留言 2026-11-22 19:12，`EGeJ…` P7 `sc-color-vars`，審查十一 32.1；超級貼圖的名稱色仍待驗證）
- 用途：檢視器沿用 YouTube 給各 SC 的文字色（SPEC 10.3，v47）。`selectors.js` 的 `paidMessageTextColorVars`／`paidStickerTextColorVars`。
- **實機（超級留言）**：元件 inline style 上的變數只有 5 個：
  - `--yt-live-chat-paid-message-primary-color`（卡片底色，本套件的 `color`）
  - `--yt-live-chat-paid-message-secondary-color`（標題列底色，未用）
  - `--yt-live-chat-paid-message-header-color`（標題列文字：名稱與金額）→ `header`
  - `--yt-live-chat-paid-message-timestamp-color`（時間）→ `timestamp`
  - `--yt-live-chat-paid-message-color`（內文）→ `body`
  - **沒有 `--yt-live-chat-paid-message-author-name-color`**：名稱在標題列內，用 `header-color`。檢視器的名稱色本來就是「`author` 取不到 → `header`」（`CORE.scColors`），結果與原生一致；`selectors.js` 保留 `author` 的變數名稱（取不到時無影響）。
  - 使用者 2026-11-22 22:58 收集 7 色 SC（32.11）：深色底白字、淺色底深字，外觀合理。
- 原推定（v47，供對照）：
  - `yt-live-chat-paid-message-renderer`：`--yt-live-chat-paid-message-header-color`（標題列）、`--yt-live-chat-paid-message-author-name-color`（名稱）、`--yt-live-chat-paid-message-timestamp-color`（時間）、`--yt-live-chat-paid-message-color`（內文）；底色 `--yt-live-chat-paid-message-primary-color`（本套件已用）、`--yt-live-chat-paid-message-secondary-color`（標題列底色，未用）。
  - `yt-live-chat-paid-sticker-renderer`：已確認 `--yt-live-chat-paid-sticker-background-color`、`--yt-live-chat-paid-sticker-chip-background-color`、`--yt-live-chat-paid-sticker-chip-text-color`（2.4）；名稱色 `--yt-live-chat-paid-sticker-author-name-text-color` 待確認。金額膠囊的字色配膠囊自己的底色，不套在卡片上。
- 驗證方式：F-20 記錄 P7 → 摘要的 `sc-color-vars`（元件 inline style 上實際有的 `--yt-live-chat-paid-*` 名稱，不含值；`got`＝本套件讀到的欄位）；P1 `scTotal`／`scTextColors`。取不到的欄位由檢視器以對比度規則補，不影響顯示。

### 2.7 超級貼圖的 `img`（**待驗證**，審查十一 17.2）
- `#sticker-container > yt-img-shadow#sticker` 內的 `img`：`src` 屬性的格式（`https://`／協定相對 `//lh3.googleusercontent.com/…`／空的／`data:` 佔位圖）與載入時機尚未實機記錄。
- 實機現象（2026-11-19 02:38）：$45.00 超級貼圖在面板中沒有圖（`stickerSrc` 為空），直播畫面正常。
- T5.3 處理：協定相對網址補 `https:`、先用屬性值再用已解析的 `.src`、只接受 https；`src` 晚於擷取出現時監看 10 秒補送；存 `alt` 當後備。
- 待確認：`img` 的 `alt` 是否為貼圖描述（或在 `aria-label`）。

### 2.8 訊息中的連結（**已驗證**：2026-11-21 19:05，使用者 T5.4 實測，審查十一 24 節表格；17.1）
- 實機確認：`#message` 內以 `a[href]` 擷取的連結，在面板中可以點開（直播中）。
- 解析方式沿用 T5.3：顯示文字會截斷、完整網址在 `href`；`href` 是 `https://www.youtube.com/redirect?…&q=<完整網址>` 時取 `q`；站內連結（頻道、影片、`#hashtag`）為相對或 `https://www.youtube.com/…`。
- 仍未逐一記錄（不影響功能）：`<a>` 的 class 名稱（套件只用 `a[href]`）、外部網址是否一律經 `/redirect`。
- 實機現象（2026-11-19 02:15）：網址在原生聊天室顯示為截斷文字（`https://madestudio.com.tw/zh/games/br...`），原生可點。
- `selectors.js`：`chat.link = { anchor: 'a[href]', redirectPath: '/redirect', redirectParam: 'q' }`。

### 2.9 自己送出的訊息：暫時節點 → 正式節點（**待驗證**，T6.1，審查十一 30.5）
- 實機現象（2026-11-22，審查十一 30.5 圖 9、10）：使用者從 T6 露出的輸入列送出 3 則，原生聊天室各 1 則，面板各 2 則。
  - 第一份是到達時間（秒數不同）。第二份內容相同，時間碼是「≈」（顯示的分鐘）、phase `pre`。
  - 推測：YouTube 先插入「送出中」的暫時節點（本機 id），伺服器確認後換成正式節點（正式 id）；兩個 id 不同，F-14 依 id 合併失敗。
  - 第二份是 `clock` → 正式節點不是由 observer 以「即時到達」擷取（回溯、補掃，或列表被換掉後重新擷取）。
- （2026-11-22 實測，審查十一 31.1、32.2）`LCC.` 的推測**錯誤**：`fixOwnDuplicates` 預覽 `tempIds 0`；T6.1 實測 P1 `tempSeen 0`、`replaced 3`（靠頁面移除／列表替換配對成功，新資料不重複）。
  - 線索：同作者同內容 90 秒內、**形狀不同**的一對 `CM_E|28 + ChwK|40`（22 對）、`CITy|27 + ChwK|40`（11 對）。正式 id 是 `ChwK…` 40 字（protobuf 的 base64），暫時 id 是 `C` 開頭、27～28 字、前 4 碼會變動。
  - v51 規則：`C` 開頭、總長 ≤ 31、base64 字元、不是 `ChwK`（`selectors.js` `chat.tempIdRe`）。**部分驗證**：格式來自使用者資料的形狀統計；下次實測看 P1 `own.tempSeen` 是否 > 0、`fixOwnDuplicates` 預覽 `pairs` 是否約 33。
  - 同形狀的 `N-Lv|52 + N-Lv|52`：v2.6.0 遷移資料的 id（`${videoId}_${元素 id}` = 11＋1＋40 字），兩筆的 YouTube id 不同 → 不同訊息（洗版），不是重複儲存。`unkn|55` 尚未確認來源；v51 預覽加上來源類別（`@ legacy + legacy` 等）以便判斷。
- **尚未確認**（下次實測以 F-20 P7 `own-replace`、P1 `own` 記錄；只有 id 前 4 碼與長度、屬性名稱，沒有內容）：
  1. ~~暫時節點的 id 格式~~（見上，v51 改為形狀規則）。
  2. 替換方式：移除暫時節點＋插入正式節點（P7 `kind: new-node`／`late`）、同一個節點原地改 id（`in-place`），或整個 `#items` 換掉（`itemsSwaps` 增加）。
  3. 暫時節點有沒有特別的屬性（P7 `oldAttrs`／`newAttrs` 比對），例如「送出中」狀態。
- 擷取端不依賴第 1 點：頁面移除已存節點（不是修剪、不是列表開頭）、id 原地改變、列表被換掉，都當成替換的證據（SPEC F-14 v50）。

### 2.11 投票卡（**待驗證**，審查十一 32.6、33.2、33.8.4）
- 2026-11-22（32.6）：待機室的投票卡（題目一行、4 個選項）在底部完整露出 → 那次的 T6 量測有算到它（`#chat > #action-panel` 或覆蓋層）。
- 2026-11-24（33.2、33.8.4）：另一種投票卡在本套件環境下被裁切。無痕視窗（沒有本套件）完整顯示：訊息區底部、輸入區上方，有題目、作者、2 個選項。
  - 面板開啟：完全看不到。
  - 面板關閉、彈出視窗：只剩第一個選項那一列。
  - P7 沒有 `#action-panel` 的 `zone-structure` 記錄 → **不在 `#chat > #action-panel`**。
- 推測（待 P7 `poll-structure` 確認）：
  1. 在訊息列表（`#item-list`）範圍內的覆蓋層：面板開啟時被 `visibility: hidden` 一起隱藏。
  2. **F-12 的「即時聊天室」模式**：無痕視窗是預設的「重點聊天室」，本套件會切到「即時」。投票卡在「即時」模式下可能本來就以收合狀態顯示。請在無痕視窗手動切到「即時聊天室」比較。
  3. 在 `#items` 內（會被擷取當成訊息、被修剪）：`poll-structure` 的 `inItems` 會顯示。
- 確認方式：開 F-20 P7，投票卡出現時與點開後各等幾秒，匯出。`poll-structure` 記錄祖先鏈（標籤、id、高度、visibility／overflow／max-height／clip-path、是否有本套件屬性）、`underHidden`、`inItems`。

### 2.10 降落（**部分已驗證**，審查十一 32.12、33.1）
- **已驗證**（2026-11-23，32.12 圖 1、2）：降落橫幅是置頂列（`yt-live-chat-banner-manager`）內的 `yt-live-chat-banner-redirect-renderer`，文字如「千萬別錯過！和大家一起收看@…」；本套件收錄為「✨ 降落」卡。降落後主分頁被導向新直播，**彈出視窗不會**跟著導向（至少 `studio` 網域那次）。
- **實機現象**（2026-11-24，33.1、33.6）：降落後新場次 `mb9I…` 被存成原場次 `LjiG…` 的標題，新場次裡混有原直播的訊息與降落橫幅，全部標成直播中。
  - 推測一：導航後 top frame 的 microdata（標題、頻道、`startDate`）還是上一場的，800ms 後送出的 `STREAM_INFO` 帶著新 videoId＋舊標題。
  - 推測二：舊的聊天室 iframe（仍顯示原直播）先收到新 videoId 的 `STREAM_INFO`，v51 的擷取引擎接受不同的 videoId → 把原直播之後的訊息存進新場次。
- **待驗證**（v52 的 F-20 記錄；只有布林、數字）：
  - P7 `video-switch`：`mismatch`（同一個聊天室文件收到不同 videoId）→ `itemsSame`、`itemsNodes`、`seenNodes`（看過的 id 數）、`frameAgeSec`；`rebind`（`#items` 換成沒看過 id 的新列表）／`swap-same-chat`／`back`。看 iframe 是否重新載入（新的文件 → `frameAgeSec` 很小、沒有 `mismatch`）或沿用同一個文件。
  - P4 `meta-stale`／`meta-fresh`（`waitedMs`）：導航後 microdata 的 videoId（`meta[itemprop="identifier"]` 或 `link[rel="canonical"]`，哪一個存在**待驗證**）多久才與網址一致。
  - 降落橫幅與「剛剛加入」（被降落方的進場卡）是否同一個元件：v52 把 `banner-redirect` 當成**原直播結束**（33.1 第 4 點）；若進場卡也是這個元件，目標直播會被誤判結束 → 以 P7 `raid` 結構確認。

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

### 2.5b 點 `$` 之後（**已驗證**：2026-11-22 19:10、19:17，`EGeJ…` P7 `zone-structure` 共 17 筆，審查十一 32.1）
- **實機結構**（iframe 高 594；頂端／高度為 px，相對 iframe）：
  1. 一般：`tp-yt-iron-pages#panel-pages` 57@537 ＞ `div#input-panel` 56@538 ＞ `div#top`（輸入列）36@548。
  2. 點 `$`：**`#input-panel` 不可見、`#panel-pages` 只剩 1px（593）**；`yt-live-chat-product-picker-panel-view-model#product-picker` 可見 326@260（`$` 選單不在 `#input-panel` 內顯示）。
  3. 選擇項目後：`#panel-pages` 切到 `div#loading` 387@207（約 2 秒）。
  4. 購買流程：`#panel-pages` 切到對應的頁：
     - 超級留言：`div#buy-flow` ＞ `yt-live-chat-message-buy-flow-renderer` 394@200 → 298@296（第二步）
     - 超級貼圖：`div#super-sticker-buy-flow` 405@189 ⇄ 228@366
     - 贈送會員：`div#sponsorships-gift-buy-flow` 400@194
  5. 頁面層付款視窗（`#buyFlowDivId`）開著時，chat frame 的狀態不變；關閉後回到 1（`closed`）。
  - `#panel-pages` 的其他頁（都不可見）：`div#donation-flow`、`div#qna-start-panel`、`div#poll-editor-panel`。
- 結論：v49 的「`$` 選單長在 `#input-panel` 內」只在 2026-11-15 成立；目前點 `$` 會隱藏 `#input-panel`，v50 的規則（`#panel-pages`、`$` 選單、購買流程任一可見就算互動區，SPEC 6.8）正確，實測 AC 4 通過（32 節）。
- 以下為 v50 時的推測與確認方式（保留對照）：
- 實機現象（2026-11-22，30.3 圖 4）：點 `$` 後 T6（v49）的面板變全高，底部的輸入列與 `$` 選單都看不到 → chat frame 當時量到「沒有輸入區」（`#input-panel` 不可見）或量測過期。
- 實機現象（2026-11-22，30.3 圖 4）：點 `$` 後 T6（v49）的面板變全高，底部的輸入列與 `$` 選單都看不到 → chat frame 當時量到「沒有輸入區」（`#input-panel` 不可見）或量測過期。
- 推測：`#panel-pages`（`tp-yt-iron-pages`）切換到另一頁顯示 `$` 選單或購買流程，`#input-panel` 那頁被隱藏。2026-11-15 的結構（2.5）是 `$` 選單長在 `#input-panel` 內的 `#pickers`，兩者不一致，需要實機確認。
- v50 的處理不依賴哪一種：`#panel-pages`、`$` 選單、購買流程任一可見就算有互動區（SPEC 6.8）。
- **確認方式**：開 F-20（P4、P7）→ 點 `$` → 選超級留言 → 走到付款確認頁 → 關閉 → 匯出。
  - P7 `zone-structure` 記錄每一步 `#panel-pages` 的直接子元素、`#input-panel`、`#pickers` 子元素、購買流程的標籤、可見與否、高度、頂端（沒有文字）。
  - P4 `panel-clip` 記錄裁切狀態。

### 2.5c 表符選單與輸入列的上下關係（**已驗證**：2026-11-22 19:10，`EGeJ…` P7 `zone-structure` 7 筆，審查十一 32.1）
- **實機**：表符選單 `yt-emoji-picker-renderer#emoji` 在 `#input-panel` **內**、輸入列 `div#top` **之下**：
  - `#panel-pages` 253@341 ＞ `#input-panel` 252@342 ＞ `div#top` 36～40@348～352，`#emoji` 180@404。
  - 展開時 `#input-panel` 從 56px 長到 252px，輸入列被往上推（548 → 352）。
  - 第一筆的 `popupTop` 287 是選單展開途中的值，之後穩定在 404。
- 結論：選單在輸入列下方，v49 以 `popupTop − 8` 裁切會切掉輸入列；v50 的規則（彈窗與底部互動區的最上方 − 8，SPEC 6.8）正確，實測通過（32 節）。
- 以下為 v50 時的推測與確認方式（保留對照）：
- 實機現象（2026-11-22，30.1 圖 2）：表符選單展開時，面板下方只看得到選單的搜尋欄，**輸入列（打字的那一列與表符按鈕）不見了**。
- 推測：`yt-emoji-picker-renderer` 在輸入列**下方**展開，輸入列被往上推；v49 以選單頂端 − 8 裁切，輸入列落在裁切範圍外。
- v50 不依賴哪一種：裁切頂端取選單與底部互動區（`#panel-pages`／`#input-panel` 等）的最上方 − 8（SPEC 6.8）。
- **確認方式**：開 F-20 P7 → 點表符按鈕 → 選一個表符 → 再點表符按鈕關閉 → 匯出。`zone-structure`（`reason: popup`）記錄 `emoji`、`input-row`（`#top`）、`input-panel`、`panel-pages` 的頂端與高度：`emoji.top` 大於 `input-row.top` 就是「選單在下方」。

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
- **（已驗證：2026-11-21 23:41，使用者 `streamTimes('0Eji…')`，審查十一 27.1）待機室的 `startDate` 可能是過去、帶秒數的時間**：綾音Ring「25 小時後開始直播」的待機室，頁面曾給 `2026-11-21T12:31:24Z`（帶秒數、已過），之後重新整理才是預定時間 `2026-11-22T15:00:00Z`。推測是待機室建立或公開的時間。**`startDate` 不可單獨作為開播依據**：v47 起最近一次 meta 說預定時間在未來（`scheduledFuture`）一律是待機室；v48 起 background 重新抓取時另看下一條的 `isLiveNow`。
- **（已驗證：2026-11-22，使用者 `streamTimes('E09v…')`，審查十一 30.6）** 直播中重新抓取 watch 頁讀到 `"isLiveNow": true`：`liveConfirmed` 2026-11-22T04:28:10Z、`startedAtSource: 'meta-actual'`、`scheduledFuture: false`、`startedAtSuspect: false`。待機室時為 `false` 尚未實測（「待機室等到開播」的轉換時間也待遇到時實測）。
- （原 T5.7 的說明，審查十一 27 第 1 點）watch 頁內嵌的播放器資料 `"isLiveNow":true|false`（`microformat.playerMicroformatRenderer.liveBroadcastDetails`）：預期待機室為 `false`、直播中為 `true`。background 重新抓取時：`false` 且沒有 `endDate` → `startDate` 已過也不當成開播（等待開播確認）；`true` 且判為實際開播 → `liveConfirmedAt`。`selectors.js` 的 `watchHtml.isLiveNow`。找不到時（結構不同）維持 v47 的判斷。實機確認方式：在待機室與直播中各執行一次 `await YTCAS_BG.streamTimes('影片ID')`，看 `liveConfirmed`（v48 新增）。

### 5.2 直播結束（`M3na…`，02:54）
- 結束當下，聊天室 iframe **反覆重新載入**（多組「observer 已掛上 → 聊天室環境 → 收錄統計（結束）」）；`yt-live-chat-renderer` 的 `loading` 屬性出現／移除。
- 未重新整理時 `endDate` meta 是否出現：待確認。結束提示元件：尚未取得（附錄 C 腳本待執行）。

### 5.3 訊息元件
- **禮物（F-13）**：`yt-gift-message-view-model` 是 `#items` 的**直接子節點**（2026-11-16，同一場 4 則）。
  - **（v46，T5.5，審查十一 24.3）內部結構已驗證**（2026-11-21 10:36，直播 `_k5N…`，套件保留的禮物結構 2 筆，兩筆相同；`docs/diag/diag-summary-2026-11-21-1848.md`「禮物結構」）：
    ```
    yt-gift-message-view-model
      div#gift-message-v2 [tabindex role]                      310x24
        yt-img-shadow#author-photo [height width]              24x24
          img#img [draggable alt height width src]             ← 送禮者頭像（有 src）
        div#content
          yt-attributed-string#author-name-v2 > span[role] > span（有文字，以 @ 開頭）   ← 送禮者 @handle
          yt-attributed-string#message-v2 > span[role] > span（有文字）                  ← 內文（例如「贈送星星」）
          yt-image#gift-image > img [alt]（img 網域 www.youtube.com，擷取當下沒有 src 屬性） ← 禮物圖片（延遲設定）
          dom-if
    ```
    - 作者名稱元件是 `#author-name-v2`（不是一般訊息的 `#author-name`），所以 v45 以前取不到作者。內文沒有 `#message`。
    - 專用解析（`selectors.js` 的 `chat.gift`）：handle＝`#author-name-v2`（`authorSource: 'dom'`；內容不是 `@handle` 時存為 `authorName`）、頭像＝`#author-photo img`、內文＝`#message-v2`、禮物圖片＝`#gift-image img`（沒有 src → 與貼圖相同的延遲補送，`giftLate`／`giftMissing`）、`alt`＝禮物名稱（`giftName`）。`www.youtube.com` 加入圖片網域白名單（`host_permissions` 本來就有）。
    - **仍待確認**：`img[alt]` 是否一律是禮物名稱（可能是空字串或通用文字）、禮物圖片 `src` 的實際路徑；數量（×N）與 Jewels 數值沒有對應元件（目前不解析）。
  - （v45，T5.4，審查十一 20.4，**v46 由上面取代**）：2026-11-20 實機 3 則禮物的作者都取不到（`#author-name` 不存在或不在預期位置），送禮者以 `@handle` 出現在內文開頭（例「@xxxx 贈送…」），該 `@handle` 以連結樣式呈現（推測內文中有 `<a href>`，指向不明）。
  - 取得結構的方式：套件在**非記錄期間**也把每則禮物的結構（標籤、屬性名稱、img 網域、尺寸、有無文字、文字是否以 `@` 開頭、連結種類 handle／channel／redirect／external…；**不含文字與網址**）存在 `chrome.storage.session` 的最近 5 筆，診斷匯出（`giftStructures`）與 diag-report「禮物結構」一節會列出。遇到禮物後到診斷頁按「匯出」即可，不必剛好在記錄中。
  - 結構確認前（v45；v46 起只在 `#author-name-v2` 取不到時當後備）：作者取不到時以內文開頭的 `@handle` 當送禮者（`authorSource: 'text'`，只看 `@` 與 handle 字元格式，不比對任何語言的文字）；內文中文字就是 `@handle` 的連結一律指向 `https://www.youtube.com/@handle`。禮物名稱、數量、禮物圖片（目前取第一張非頭像的 `img`）待結構確認後改為專用解析。
- `yt-live-chat-viewer-engagement-message-renderer`（歡迎／守則提示）：每次重新載入聊天室都會出現一則，**元素 id 每次不同**（同一場 6 次重新整理存成 28 筆）→ T3.5 起以內容去重。
  - （v45，T5.4，審查十一 21.3）此元件擷取時標 `notice: true`（依標籤，不比對文字），檢視器放在最上方「聊天室提示」一段、不參與 pre／live／post 與同步。**待驗證**：VOD 的「已啟用聊天室訊息重播功能」與「訂閱者專屬模式」提示是否也是這個元件——是的話既有紀錄的 id 以 `ytcas-ve-` 開頭，自動歸到提示；不是的話它的 `rawTag` 會列在 `YTCAS_BG.systemTags()` 的 `byTag`（只有標籤與筆數），請回報標籤名稱再補進規則。
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
