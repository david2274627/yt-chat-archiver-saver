// mock-chrome.js 會攔截所有 fetch。測試頁需要讀取「同一來源」的 repo 檔案（例如 tools/diag.html）時，
// 在 mock-chrome.js 之前載入本檔，改用 __sameOriginFetch：只允許相對路徑或同一來源，其他一律拒絕（不連外）
(function () {
  'use strict';
  const real = self.fetch.bind(self);
  self.__sameOriginFetch = (url, opts) => {
    const u = new URL(url, location.href);
    if (u.origin !== location.origin) return Promise.reject(new Error('測試頁禁止對外連線：' + u.origin));
    return real(u.href, opts);
  };
})();
