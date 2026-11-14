// 所有 YouTube DOM 選擇器集中於此（YouTube 改版時只改這個檔案）
// 找不到元素時呼叫端須 graceful degrade：透過 YTCAS_SEL.warnOnce() 只警告一次，不拋錯。
(function (root) {
  'use strict';

  const S = {
    // ---------- top frame（www.youtube.com/watch） ----------
    top: {
      liveChatFrame: 'ytd-live-chat-frame',
      chatIframe: 'iframe#chatframe',
      // 舊版面：聊天室下方「隱藏聊天室」列（v24：目前版面已沒有，僅相容用；F-09 錨點 4）
      showHideButton: 'ytd-live-chat-frame #show-hide-button',
      watchFlexy: 'ytd-watch-flexy',
      video: 'video.html5-main-video',
      // 直播開始時間（推算 videoOffsetSec）
      startDateMeta: 'meta[itemprop="startDate"]',
      titleMeta: 'meta[name="title"]',
      channelLink: 'ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a',
      darkThemeAttr: 'html[dark]',
      // F-10 top frame 彈窗偵測
      // ytd-popup-container 內的一般對話框（備援）
      popupContainer: 'ytd-popup-container',
      popups: [
        'tp-yt-paper-dialog',
        'tp-yt-iron-dropdown',
        'yt-dialog-view-model',
      ],
      // v24 定案：頁面層「完成購買程序」視窗是 body 的直接子元素，不在 ytd-app / ytd-popup-container 內。
      // 內部 iframe 為跨來源 payments.youtube.com：不讀取、不注入。不得使用 #:0.contentEl（動態 id）。
      // v24：影片下方「聊天室／開啟面板」卡片（F-09 錨點 3）。只用標籤名稱與 id 定位，
      // 不依賴 ytSpecButtonShapeNext*、ytVideoMetadataCarouselViewModel* 等版本化 class。
      chatTeaser: {
        metadata: 'ytd-watch-metadata',
        item: 'ytd-watch-metadata #teaser-carousel yt-text-carousel-item-view-model',
        card: 'yt-carousel-item-view-model',
        buttonHost: 'button-view-model',
        button: 'button-view-model button',
        icon: 'yt-icon, svg',
      },
      buyFlow: '#buyFlowDivId',
      pagePopups: [
        '#buyFlowDivId',
        'iframe#buyFlowDivIdIframe',
      ],
      // 付款視窗的全頁遮罩（position:absolute，與 #buyFlowDivId 同為 body 直接子元素）：輔助判斷，不可單獨依賴
      // b3-modal-dialog* 等 class 只能作次要比對
      pageMasks: [
        'body > .modal-dialog-bg',
      ],
    },

    // ---------- chat frame（www.youtube.com/live_chat、live_chat_replay） ----------
    chat: {
      app: 'yt-live-chat-app',
      renderer: 'yt-live-chat-renderer',
      header: 'yt-live-chat-header-renderer',
      // 頂部列 ⋮ 按鈕候選（F-09 開關插在其左側；v24 待真實版面確認，找不到時退為附加在頂部列末端並警告）
      headerOverflow: [
        'yt-live-chat-header-renderer #overflow',
        'yt-live-chat-header-renderer #menu-button',
      ],
      itemList: '#item-list',
      items: '#item-list #items',
      inputPanel: '#input-panel',
      // F-10 底部互動區（SPEC 6.3 v24：置頂訊息列、投票／問答卡、輸入列…）。
      // 待 PoC 底部互動區診斷結果填入實際標籤名稱，不得憑猜測新增。
      bottomZone: [],
      messageInput: 'yt-live-chat-message-input-renderer',

      // 訊息元件
      textMessage: 'yt-live-chat-text-message-renderer',
      paidMessage: 'yt-live-chat-paid-message-renderer',
      paidSticker: 'yt-live-chat-paid-sticker-renderer',
      membershipItem: 'yt-live-chat-membership-item-renderer',
      giftAnnouncement: 'ytd-sponsorships-live-chat-gift-purchase-announcement-renderer',
      viewerEngagement: 'yt-live-chat-viewer-engagement-message-renderer',
      // 置頂 / 降落橫幅
      // v24 待確認：新版面置頂訊息在輸入列正上方，來源不一定是 banner-manager（併入底部互動區診斷）
      bannerContainer: 'yt-live-chat-banner-manager',
      banner: 'yt-live-chat-banner-renderer',
      bannerRedirect: 'yt-live-chat-banner-redirect-renderer',

      // 訊息內部欄位
      author: {
        name: '#author-name',
        photo: '#author-photo img, #img',
        badges: 'yt-live-chat-author-badge-renderer',
      },
      message: '#message',
      timestamp: '#timestamp',
      purchaseAmount: '#purchase-amount, #purchase-amount-chip',

      // F-10 彈窗偵測
      popups: [
        'yt-emoji-picker-renderer',
        'yt-live-chat-product-picker-renderer',
        'yt-live-chat-message-buy-flow-renderer',
        'tp-yt-iron-dropdown',
        'tp-yt-paper-dialog',
      ],
      emojiPickerButton: '#emoji-picker-button',
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
