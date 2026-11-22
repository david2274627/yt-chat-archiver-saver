// 所有 YouTube DOM 選擇器集中於此（YouTube 改版時只改這個檔案）
// 依據：docs/youtube-dom-notes.md（實機確認的結構，標註日期與 Chrome 版本）。筆記沒有記錄的結構一律標「待實機確認」。
// 找不到元素時呼叫端須 graceful degrade：透過 YTCAS_SEL.warnOnce() 只警告一次，不拋錯。
(function (root) {
  'use strict';

  const S = {
    // ---------- top frame（www.youtube.com/watch） ----------
    top: {
      liveChatFrame: 'ytd-live-chat-frame',
      chatIframe: 'iframe#chatframe',
      // 舊版面：聊天室下方「隱藏聊天室」列（F-09 錨點 4）。2026-11-15 實機：元素可能以隱藏狀態殘留，掛載前須檢查可見性
      showHideButton: 'ytd-live-chat-frame #show-hide-button',
      watchFlexy: 'ytd-watch-flexy',
      video: 'video.html5-main-video',
      // v43（T5.2，審查十一 16.1 (F)）播放器的「直播」徽章：在直播最新時不可點。只讀。**待實機確認**：
      // 在最新時帶 disabled 屬性或 liveHeadClass；面板 ⋯「連線狀態」顯示判定結果（徽章 最新／非最新／找不到）供實機核對
      liveBadge: '.html5-video-player .ytp-live-badge',
      liveHeadClass: 'ytp-live-badge-is-livehead',
      // 直播開始時間（推算 videoOffsetSec；筆記 1.2 確認存在）。待機室時是預定時間或不存在：待實機確認（T3 診斷）
      startDateMeta: 'meta[itemprop="startDate"]',
      endDateMeta: 'meta[itemprop="endDate"]',             // 待實機確認
      isLiveMeta: 'meta[itemprop="isLiveBroadcast"]',       // 筆記 1.2 確認存在；值的寫法待實機確認
      titleMeta: 'meta[name="title"]',
      channelLink: 'ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a',
      darkThemeAttr: 'html[dark]', // 深色狀態待實機確認（筆記 1.5）

      // 版面狀態（筆記 1.1，2026-11-15）
      layout: {
        theater: 'ytd-watch-flexy[theater]',
        singleColumn: 'ytd-watch-flexy[is-single-column]',
        frameTheater: 'ytd-live-chat-frame[theater-watch-while]',
        // 聊天室展開時 flexy 帶此屬性（筆記 1.1 確認）；用來判斷「此頁確定有聊天室」以決定警告等級
        chatPresent: 'ytd-watch-flexy[live-chat-present-and-expanded]',
      },

      // F-09 錨點 3：影片下方「聊天室／開啟面板」卡片（筆記 1.3）。只用標籤名稱與 id 定位，
      // 不依賴 ytSpecButtonShapeNext*、ytVideoMetadataCarouselViewModel* 等版本化 class。
      chatTeaser: {
        metadata: 'ytd-watch-metadata',
        item: 'ytd-watch-metadata #teaser-carousel yt-text-carousel-item-view-model',
        card: 'yt-carousel-item-view-model',
        buttonHost: 'button-view-model',
        button: 'button-view-model button',
        icon: 'yt-icon, svg',
      },

      // F-10 top frame 彈窗偵測
      // ytd-popup-container 內的一般對話框（備援）
      popupContainer: 'ytd-popup-container',
      popups: [
        'tp-yt-paper-dialog',
        'tp-yt-iron-dropdown',
        'yt-dialog-view-model',
      ],
      // 頁面層「完成購買程序」視窗（筆記 1.4）：body 的直接子元素，不在 ytd-app / ytd-popup-container 內。
      // 內部 iframe 為跨來源 payments.youtube.com：不讀取、不注入。不得使用 #:0.contentEl（動態 id）。
      buyFlow: '#buyFlowDivId',
      pagePopups: [
        '#buyFlowDivId',
        'iframe#buyFlowDivIdIframe',
      ],
      // 付款視窗的全頁遮罩（position:absolute）：輔助判斷，不可單獨依賴；b3-modal-dialog* 等 class 只能作次要比對
      pageMasks: [
        'body > .modal-dialog-bg',
      ],
    },

    // ---------- chat frame（www.youtube.com/live_chat、live_chat_replay） ----------
    // live_chat_replay（VOD）結構尚未診斷（筆記第 3 節）
    chat: {
      app: 'yt-live-chat-app',
      renderer: 'yt-live-chat-renderer',
      header: 'yt-live-chat-header-renderer',
      // F-09 錨點 1：頂部列 ⋮（筆記 2.2）。按鈕插在它之前、同一父層。
      // 後兩個只比對頂部列的直接子元素：v24 用後代選擇器 #menu-button 誤命中 #view-selector 內的選單按鈕
      headerOverflow: [
        'yt-live-chat-header-renderer #live-chat-header-context-menu',
        'yt-live-chat-header-renderer > #overflow',
        'yt-live-chat-header-renderer > #menu-button',
      ],
      ticker: 'yt-live-chat-ticker-renderer',
      itemList: '#item-list',
      items: '#item-list #items',
      anyItems: '#items', // 診斷用：頁面上所有 #items 的數量（2026-11-16 實測：2 個，第 2 個不可見）
      inputPanel: '#input-panel',
      messageInput: 'yt-live-chat-message-input-renderer',

      // F-10 底部互動區（SPEC 6.3；筆記 2.1，2026-11-15）。白名單，依畫面由上而下：
      //   投票卡等動作面板（#chat > #action-panel，2026-11-15 補測確認；內部是否為 action-panel-renderer／poll-renderer 待實機確認）
      //   → 置頂列（banner-manager）→ 輸入區外層（#panel-pages）→ 輸入區（#input-panel）
      // 只計「可見且高度 > 0」者
      bottomZone: [
        '#chat > #action-panel',
        'yt-live-chat-banner-manager',
        '#panel-pages',
        '#input-panel',
      ],
      // 蓋在訊息列表上的透明覆蓋層（YouTube 原生，投票卡推測掛在此）：容器本身不計，只計其「可見」子元素
      bottomZoneOverlay: 'ytls-widget-overlay-manager',
      // 量測時一律排除（含診斷清單標示原因）
      bottomZoneExclude: [
        '#item-list',
        'yt-live-chat-header-renderer',
        'yt-live-chat-ticker-renderer',
        'ytls-widget-overlay-manager',
      ],

      // F-12「重點聊天室訊息／即時聊天室」切換（筆記 2.3）。第 1 個 a = 重點、第 2 個 a = 即時；是否需先展開選單待實測
      viewSelector: {
        root: '#live-chat-view-selector-sub-menu',
        trigger: '#live-chat-view-selector-sub-menu tp-yt-paper-menu-button#menu-button #trigger',
        items: '#live-chat-view-selector-sub-menu tp-yt-paper-listbox#menu > a',
      },

      // 訊息元件（筆記 2.4）
      textMessage: 'yt-live-chat-text-message-renderer',      // 確認
      paidSticker: 'yt-live-chat-paid-sticker-renderer',      // 確認
      viewerEngagement: 'yt-live-chat-viewer-engagement-message-renderer', // 確認
      paidMessage: 'yt-live-chat-paid-message-renderer',      // 確認存在（2026-11-16 欄位統計：金額解析成功；顏色待確認）
      membershipItem: 'yt-live-chat-membership-item-renderer', // 確認（2026-11-15 重播；筆記 3）
      giftRedemption: 'ytd-sponsorships-live-chat-gift-redemption-announcement-renderer', // 確認存在（收到贈送會員）；內部結構待實機確認
      placeholderItem: 'yt-live-chat-placeholder-item-renderer', // 確認：佔位元素，擷取時略過
      tickerSponsorItem: 'yt-live-chat-ticker-sponsor-item-renderer', // 確認：跑馬燈內的會員項目，不擷取
      giftAnnouncement: 'ytd-sponsorships-live-chat-gift-purchase-announcement-renderer', // 待實機確認
      giftMessage: 'yt-gift-message-view-model', // F-13 禮物（Jewels）：2026-11-16 確認為訊息元件；內部結構 2026-11-21 確認（dom-notes 5.3）
      // v46（T5.5，審查十一 24.3）禮物內部結構：確認（2026-11-21 實機禮物結構 2 筆，相同）
      //   div#gift-message-v2 > yt-img-shadow#author-photo > img#img[src]（送禮者頭像）
      //                       > div#content > yt-attributed-string#author-name-v2（@handle）
      //                                     > yt-attributed-string#message-v2（內文，例如「贈送星星」）
      //                                     > yt-image#gift-image > img[alt]（禮物圖片：擷取當下沒有 src，延遲設定；網域 www.youtube.com）
      gift: { author: '#author-name-v2', photo: '#author-photo img', message: '#message-v2', image: '#gift-image img' },
      giftHeader: 'ytd-sponsorships-live-chat-header-renderer', // 待實機確認
      poll: 'yt-live-chat-poll-renderer',                     // 待實機確認
      actionPanel: 'yt-live-chat-action-panel-renderer',      // 待實機確認
      // 置頂 / 降落橫幅
      bannerContainer: 'yt-live-chat-banner-manager',         // 確認（置頂列，位於輸入列上方）
      banner: 'yt-live-chat-banner-renderer',                 // 確認
      bannerRedirect: 'yt-live-chat-banner-redirect-renderer', // 降落：待實機確認

      // 訊息內部欄位（筆記 2.4）
      // 身分以屬性為主（owner／moderator／member…），#chat-badges 內徽章為輔
      authorTypeAttr: 'author-type',
      author: {
        name: '#author-name',
        photo: '#author-photo img, #img',
        badges: '#chat-badges yt-live-chat-author-badge-renderer',
      },
      message: '#message',
      // 直播也有值，只是 yt-live-chat-renderer[hide-timestamps] 以 CSS 隱藏
      timestamp: '#timestamp',
      purchaseAmount: '#purchase-amount, #purchase-amount-chip',
      // v29（T3 擷取）
      badgeTypeAttr: 'type',                  // yt-live-chat-author-badge-renderer[type=verified|moderator|…]：待實機確認
      emojiShortcutAttr: 'shared-tooltip-text', // 表符 img 的快捷碼屬性：待實機確認（取不到時只存 alt）
      stickerImg: '#sticker img',             // #sticker-container > yt-img-shadow#sticker 確認；內部 img 待實機確認
      // v44（T5.3，審查十一 17.1）#message 內的連結：確認可用（2026-11-21 實機，dom-notes 2.8）。href 為
      // https://www.youtube.com/redirect?…&q=<完整網址> 時取 q；顯示文字會截斷，完整網址只在 href（不依賴 <a> 的 class）
      link: { anchor: 'a[href]', redirectPath: '/redirect', redirectParam: 'q' },
      paidStickerColorVars: ['--yt-live-chat-paid-sticker-background-color'], // 確認（筆記 2.4）
      paidMessageColorVars: ['--yt-live-chat-paid-message-primary-color'],    // 待實機確認
      // v47（T5.6，審查十一 26.4）YouTube 給各 SC 的文字色（元件本身的 CSS 變數）。
      // v51（32.1）超級留言已驗證（dom-notes 2.4b）：header／timestamp／body 有；**沒有 author-name-color**，名稱用 header（CORE.scColors 的後備）。
      // 取不到的欄位由檢視器依對比度規則補（CORE.parseColor）
      paidMessageTextColorVars: {
        header: '--yt-live-chat-paid-message-header-color',
        author: '--yt-live-chat-paid-message-author-name-color',
        timestamp: '--yt-live-chat-paid-message-timestamp-color',
        body: '--yt-live-chat-paid-message-color',
      },
      // 超級貼圖：chip-text-color 是金額膠囊（自己的底色）上的字色，不套在卡片上；只取名稱色
      paidStickerTextColorVars: {
        author: '--yt-live-chat-paid-sticker-author-name-text-color',
      },
      paidColorVarPrefix: '--yt-live-chat-paid-', // F-20 P7：列出元件上實際有的變數名稱（不含值）
      membership: { primaryText: '#header-primary-text', subtext: '#header-subtext' }, // 確認（筆記 3）
      // 置頂列內的訊息（筆記 2.4：banner-renderer > #contents > text-message-renderer#<id>）
      bannerPinnedMessage: 'yt-live-chat-banner-renderer #contents yt-live-chat-text-message-renderer',
      // 刪除狀態：span#deleted-state 確認存在（筆記 2.4）；被刪除時的屬性名稱與內容待實機確認
      deleted: { attr: 'is-deleted', stateEl: '#deleted-state' },
      // v50（T6.1，審查十一 30.5）自己送出的訊息：YouTube 先插入「送出中」的暫時節點，伺服器確認後換成正式節點（id 不同）。
      // v51（T6.2，審查十一 31.1、32.2）v50 推測的 `LCC.` 開頭是錯的（實機 tempIds 0）。使用者的 fixOwnDuplicates 預覽：
      //   同作者同內容 90 秒內、形狀不同的一對 `CM_E|28 + ChwK|40`（22 對）、`CITy|27 + ChwK|40`（11 對），與 3 則自己送出的訊息吻合。
      //   正式 id 為 `ChwK` 開頭、40 字（protobuf 的 base64）；暫時 id 為 `C` 開頭、27～28 字、不是 `ChwK`。
      //   規則：`C` 開頭、總長 ≤ 31、base64 字元、不是 `ChwK` 開頭（dom-notes 2.9）。前 4 碼會變動，不比對
      tempIdRe: /^(?!ChwK)C[A-Za-z0-9_\-+/=%]{19,30}$/,

      // F-10 彈窗與按鈕（筆記 2.5）
      emojiPickerButton: '#emoji-picker-button',
      emojiToggle: 'yt-live-chat-icon-toggle-button-renderer#emoji',
      productPickerButton: 'yt-live-chat-icon-toggle-button-renderer#product-picker',
      // $ 選單（tp-yt-iron-pages#pickers 內）。v51（32.1，dom-notes 2.5b 已驗證）點 $ 後 #input-panel 不可見、#panel-pages 只剩 1px，
      // $ 選單本身可見（326px）；之後 #panel-pages 切到 #loading／#buy-flow／#super-sticker-buy-flow／#sponsorships-gift-buy-flow
      productPicker: 'tp-yt-iron-pages#pickers > yt-live-chat-product-picker-panel-view-model#product-picker',
      // v50（T6.1，審查十一 30.3）`$` 相關：任一可見（高度 ≥ PANEL.ZONE_MIN_PX）就視為「有互動區」，不可退回面板全高。
      // 實機：點 `$` 後底部互動區整個消失（面板全高）：YouTube 隱藏 #input-panel、改在 #panel-pages 顯示 `$` 選單或購買流程（已驗證，dom-notes 2.5b）
      panelPages: '#panel-pages',
      buyFlowInChat: 'yt-live-chat-message-buy-flow-renderer',
      emojiPicker: 'yt-emoji-picker-renderer',
      interactiveZone: [
        '#panel-pages',
        'tp-yt-iron-pages#pickers > yt-live-chat-product-picker-panel-view-model#product-picker',
        'yt-live-chat-message-buy-flow-renderer',
      ],
      // F-20 P7 zone-structure：`$`／彈窗狀態改變時記錄這些元素的標籤、可見與否、高度、頂端（不含文字）。輸入列本身＝#top（dom-notes 2.5）
      zoneStructure: {
        inputRow: '#input-panel yt-live-chat-message-input-renderer > #container > #top',
        pickers: 'tp-yt-iron-pages#pickers',
        actionPanel: '#chat > #action-panel',
      },
      popups: [
        'yt-emoji-picker-renderer',
        'tp-yt-iron-pages#pickers > yt-live-chat-product-picker-panel-view-model#product-picker', // 關閉時是否仍「可見」待實機確認
        'yt-live-chat-message-buy-flow-renderer',
        'tp-yt-iron-dropdown',
        'tp-yt-paper-dialog',
      ],
    },
  };

  // F-19 FETCH_STREAM_META：background 讀 watch 頁 HTML（沒有 DOM，以屬性名稱比對 meta／link 標籤）。
  // 待實機確認：未登入抓取時是否有這些標籤；作者資訊推測位於 span[itemprop="author"] 內的 link[itemprop="url"／"name"]
  S.watchHtml = Object.freeze({
    metaItemprop: ['startDate', 'endDate', 'isLiveBroadcast'],
    metaName: ['title'],
    authorBlock: /<span[^>]*itemprop=["']author["'][^>]*>([\s\S]*?)<\/span>/i,
    authorUrl: /<link[^>]*itemprop=["']url["'][^>]*href=["']([^"']+)["']/i,
    authorName: /<link[^>]*itemprop=["']name["'][^>]*content=["']([^"']*)["']/i,
    // v48（T5.7，審查十一 27 第 1 點）watch 頁內嵌的播放器資料 microformat.liveBroadcastDetails.isLiveNow（正在直播＝true）。
    // 用來確認「已開播」（提早開播、待機室 meta 的 startDate 是過去帶秒數的時間，27.1）。
    // 直播中 true：已驗證（2026-11-22，審查十一 30.6，dom-notes 5.1）；待機室的 false 待實機確認
    isLiveNow: /"isLiveNow"\s*:\s*(true|false)/,
  });

  // T3.4 cleanupJunkSystem：yt-live-chat-* 開頭、但屬於「訊息內部或輸入區的子元件」，不會是 #items 的直接子節點。
  // 依據：docs/youtube-dom-notes.md 2.4／2.5 確認的子元件；2026-11-16 實測 Console 出現的 author-badge-renderer。
  // 判定規則（background 使用）：rawTag 不以 yt-live-chat-／ytd-sponsorships- 開頭，或在此清單內 → 垃圾紀錄。
  S.nonMessageTags = Object.freeze([
    'yt-live-chat-author-badge-renderer',
    'yt-live-chat-author-chip',
    'yt-live-chat-text-input-field-renderer',
    'yt-live-chat-icon-toggle-button-renderer',
    'yt-live-chat-button',
    'yt-live-chat-banner-header-renderer',
    'yt-live-chat-message-input-renderer',
    'yt-live-chat-message-input-prompt-header-renderer',
    'yt-live-chat-reply-button-view-model', // 2026-11-16 實測漏網（審查十追加三）
    'yt-live-chat-like-button-view-model',  // 同上
  ]);
  S.messageTagPrefixes = Object.freeze(['yt-live-chat-', 'ytd-sponsorships-']);
  // T3.6 白名單：已知的 #items 直接子節點中、不在 messageTypeByTag 的元件（存為 system 或不擷取）。清除規則一律不碰
  S.knownMessageTags = Object.freeze([
    'yt-live-chat-viewer-engagement-message-renderer',
    'yt-live-chat-placeholder-item-renderer',
    'yt-live-chat-ticker-sponsor-item-renderer',
  ]);
  // T3.5 規則式判斷：#items 的直接子節點（訊息元件）都是 *-renderer；yt-live-chat-* 標籤符合下列任一規則即視為子元件
  S.subComponentPatterns = Object.freeze([/-view-model$/, /-button-/, /-badge-renderer$/, /-chip$/]);

  // 訊息元件標籤 → 訊息類型（F-02 擷取與 F-13 RECLASSIFY_SYSTEM 共用；background 也會載入本檔，不得在載入時存取 DOM）。
  // 不在表內的標籤存為 system（保存 rawTag）。禮物（gift）公告元件標籤尚未實機出現：取得後在此補一列，再執行重新分類。
  S.messageTypeByTag = Object.freeze({
    'yt-live-chat-text-message-renderer': 'text',
    'yt-live-chat-paid-message-renderer': 'superchat',        // 確認（2026-11-16）
    'yt-live-chat-paid-sticker-renderer': 'supersticker',
    'yt-live-chat-membership-item-renderer': 'membership',
    'ytd-sponsorships-live-chat-gift-redemption-announcement-renderer': 'membership',
    'ytd-sponsorships-live-chat-gift-purchase-announcement-renderer': 'membership', // 待實機確認
    'yt-live-chat-banner-redirect-renderer': 'raid',          // 待實機確認
    // F-13 禮物（Jewels）公告：2026-11-16 實機確認為 #items 的直接子節點（審查十追加五 A）；內部結構待實機確認
    'yt-gift-message-view-model': 'gift',
  });

  // 診斷輸出分級（SPEC 第 7 節「相容」v31；docs/review-2026-11-16.md）：
  //   Chrome 會把 content script 的 console.warn／error 收進擴充功能「錯誤」頁，跨頁面累積、不會自動清除。
  //   'warn'：該頁確定有聊天室（或 chat frame 已載入），預期應該存在的元素卻找不到、且會影響功能時才用。
  //   'info'（預設）：沒有聊天室的頁面、可退回的情況、PoC 一般提示。'debug'：診斷細節、舊版相容錨點。
  // 同一頁面內每個 key 只輸出一次。
  // T3.8：S.onWarn(key, level) 由 content／background 設定，供 F-20 P8 記錄「key＋等級」（不取執行期字串）
  const warned = new Set();
  S.onWarn = null;
  S.warnOnce = function (key, detail, level) {
    if (warned.has(key)) return;
    warned.add(key);
    const lv = level === 'warn' || level === 'debug' ? level : 'info';
    console[lv]('[ytcas] 找不到 YouTube 元素：' + key, detail || '');
    if (typeof S.onWarn === 'function') { try { S.onWarn(key, lv); } catch (_) { /* ignore */ } }
  };

  // 找出影片下方輪播中「聊天室」那張卡片（同一輪播可能還有會員福利等其他卡片）。
  // 判斷順序：1. 按鈕文字等於已知在地化字串（labels）；2. 有按鈕且卡片內含圖示的第一張；都找不到回傳 null。
  // 回傳 { item, host, button }；呼叫端負責 warnOnce。
  S.findChatTeaser = function (doc, labels) {
    const T = S.top.chatTeaser;
    const items = Array.from(doc.querySelectorAll(T.item));
    const pick = (item) => {
      const host = item.querySelector(T.buttonHost);
      const button = item.querySelector(T.button);
      return host && button ? { item, host, button } : null;
    };
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    for (const item of items) {
      const p = pick(item);
      if (p && labels.includes(norm(p.button.textContent))) return p;
    }
    for (const item of items) {
      const p = pick(item);
      const card = item.closest(T.card) || item;
      if (p && card.querySelector(T.icon)) return p;
    }
    return null;
  };

  // v50（30.5）暫時 id（自己送出、伺服器尚未確認）。background 的合併規則與 fixOwnDuplicates 也用這條
  S.isTempChatId = function (id) { return typeof id === 'string' && S.chat.tempIdRe.test(id); };

  root.YTCAS_SEL = S;
})(typeof globalThis !== 'undefined' ? globalThis : self);
