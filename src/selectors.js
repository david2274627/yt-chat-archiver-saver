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
      // 直播開始時間（推算 videoOffsetSec；筆記 1.2 確認存在）
      startDateMeta: 'meta[itemprop="startDate"]',
      titleMeta: 'meta[name="title"]',
      channelLink: 'ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a',
      darkThemeAttr: 'html[dark]', // 深色狀態待實機確認（筆記 1.5）

      // 版面狀態（筆記 1.1，2026-11-15）
      layout: {
        theater: 'ytd-watch-flexy[theater]',
        singleColumn: 'ytd-watch-flexy[is-single-column]',
        frameTheater: 'ytd-live-chat-frame[theater-watch-while]',
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
      paidMessage: 'yt-live-chat-paid-message-renderer',      // 待實機確認
      membershipItem: 'yt-live-chat-membership-item-renderer', // 待實機確認
      giftAnnouncement: 'ytd-sponsorships-live-chat-gift-purchase-announcement-renderer', // 待實機確認
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

      // F-10 彈窗與按鈕（筆記 2.5）
      emojiPickerButton: '#emoji-picker-button',
      emojiToggle: 'yt-live-chat-icon-toggle-button-renderer#emoji',
      productPickerButton: 'yt-live-chat-icon-toggle-button-renderer#product-picker',
      // $ 選單長在 #input-panel 內（tp-yt-iron-pages#pickers）：展開時 #input-panel 高度本身會變，底部互動區量測會涵蓋
      productPicker: 'tp-yt-iron-pages#pickers > yt-live-chat-product-picker-panel-view-model#product-picker',
      popups: [
        'yt-emoji-picker-renderer',
        'tp-yt-iron-pages#pickers > yt-live-chat-product-picker-panel-view-model#product-picker', // 關閉時是否仍「可見」待實機確認
        'yt-live-chat-message-buy-flow-renderer',
        'tp-yt-iron-dropdown',
        'tp-yt-paper-dialog',
      ],
    },
  };

  const warned = new Set();
  S.warnOnce = function (key, detail) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn('[ytcas] 找不到 YouTube 元素：' + key, detail || '');
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

  root.YTCAS_SEL = S;
})(typeof globalThis !== 'undefined' ? globalThis : self);
