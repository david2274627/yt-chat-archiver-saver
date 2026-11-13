// content script：同一檔案在 top frame 與 chat frame 執行（T3、T5、T6 實作）
(function () {
  'use strict';
  const C = globalThis.YTCAS_CONST;
  const S = globalThis.YTCAS_SEL;
  if (!C || !S) return;

  const path = location.pathname;
  const isTop = window === window.top;
  const isChatFrame = !isTop && (path.startsWith('/live_chat') || path.startsWith('/live_chat_replay'));

  if (isTop) {
    // top frame：按鈕、內嵌面板、clip-path、VOD 時間同步
  } else if (isChatFrame) {
    // chat frame：擷取、修剪、輸入區狀態回報
  }
})();
