// 主題系統（SPEC 10.2，v27）：viewer、popup、匯出 HTML 共用；top frame 用 watchYouTube() 監看 YouTube 外觀。
// - 設定 themeMode：'auto' | 'light' | 'dark'（chrome.storage.sync，預設 auto），變更即時套用到所有介面。
// - auto 的來源：source 'system' → prefers-color-scheme；source 'youtube' → top frame 傳來的 THEME 訊息。
// - 沒有 chrome.storage 時（匯出 HTML、設計稿）視為 auto，或使用 setMode() 的本頁設定。
(function (root) {
  'use strict';

  const KEY = 'themeMode';
  const MODES = Object.freeze(['auto', 'light', 'dark']);
  const YT_ORIGIN = 'https://www.youtube.com';
  const isTheme = (t) => t === 'light' || t === 'dark';
  const storage = () => {
    try { return root.chrome && root.chrome.storage && root.chrome.storage.sync ? root.chrome.storage.sync : null; } catch (_) { return null; }
  };

  /**
   * @param {object} [o]
   * @param {'system'|'youtube'} [o.source] auto 模式下的外觀來源（內嵌面板為 'youtube'）
   * @param {HTMLElement} [o.target] 套用 data-theme 的元素，預設 <html>
   * @param {(info:{mode:string, theme:string})=>void} [o.onChange]
   * @param {boolean} [o.listenFrameMessage] source 為 youtube 時，是否自行監聽 parent 的 THEME 訊息（預設 true）
   */
  function create(o = {}) {
    const source = o.source === 'youtube' ? 'youtube' : 'system';
    const target = o.target || root.document.documentElement;
    const mql = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null;
    let mode = 'auto';
    let ytTheme = null;
    let last = '';

    const systemTheme = () => (mql && mql.matches ? 'dark' : 'light');
    const resolve = () => {
      if (mode !== 'auto') return mode;
      if (source === 'youtube' && ytTheme) return ytTheme;
      return systemTheme(); // youtube 來源尚未收到訊息前先用系統猜測，避免閃白
    };
    function apply() {
      const theme = resolve();
      target.setAttribute('data-theme', theme);
      target.setAttribute('data-theme-mode', mode);
      const key = mode + '/' + theme;
      if (key !== last) {
        last = key;
        if (o.onChange) { try { o.onChange({ mode, theme }); } catch (e) { console.warn('[ytcas] theme onChange', e); } }
      }
    }
    const setLocalMode = (m) => { mode = MODES.includes(m) ? m : 'auto'; apply(); };

    // 系統設定變更（auto + system 時生效；youtube 來源在未收到訊息前也會用到）
    const onSystem = () => apply();
    if (mql) {
      if (mql.addEventListener) mql.addEventListener('change', onSystem);
      else if (mql.addListener) mql.addListener(onSystem);
    }

    // 設定變更：任何介面改了 themeMode，其他開啟中的介面即時套用
    const st = storage();
    const onStorage = (changes, area) => {
      if (area === 'sync' && changes[KEY]) setLocalMode(changes[KEY].newValue);
    };
    if (st) {
      try { root.chrome.storage.onChanged.addListener(onStorage); } catch (_) { /* 無權限時略過 */ }
      try {
        st.get(KEY, (r) => { setLocalMode(r && r[KEY]); });
      } catch (_) { /* 讀取失敗維持 auto */ }
    }

    // 內嵌面板：top frame 以 { __ytcas, type: 'THEME', theme } 傳入 YouTube 外觀（SPEC 4.3）
    const onMessage = (ev) => {
      const d = ev.data;
      if (!d || d.__ytcas !== true || d.type !== 'THEME') return;
      if (ev.origin !== YT_ORIGIN || ev.source !== root.parent) return;
      setYouTubeTheme(d.theme);
    };
    if (source === 'youtube' && o.listenFrameMessage !== false && root.parent && root.parent !== root) {
      root.addEventListener('message', onMessage);
    }

    function setYouTubeTheme(t) {
      if (!isTheme(t)) return;
      ytTheme = t;
      apply();
    }
    /** 使用者在 UI 選擇主題：寫入 storage.sync（其他介面由 onChanged 同步）；沒有 storage 時只套用本頁 */
    function setMode(m) {
      const next = MODES.includes(m) ? m : 'auto';
      setLocalMode(next);
      if (st) { try { st.set({ [KEY]: next }); } catch (e) { console.warn('[ytcas] theme 設定寫入失敗', e); } }
    }
    /** ⋯ 選單「切換主題」：自動 → 淺色 → 深色 → 自動 */
    const cycle = () => setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
    function destroy() {
      if (mql) {
        if (mql.removeEventListener) mql.removeEventListener('change', onSystem);
        else if (mql.removeListener) mql.removeListener(onSystem);
      }
      if (st) { try { root.chrome.storage.onChanged.removeListener(onStorage); } catch (_) { /* 略過 */ } }
      root.removeEventListener('message', onMessage);
    }

    apply(); // 同步套用一次，讓首次繪製就有正確主題
    return {
      get mode() { return mode; },
      get theme() { return resolve(); },
      setMode, cycle, setYouTubeTheme, destroy,
    };
  }

  /**
   * top frame 用：監看 YouTube 實際外觀（html[dark]），變更時呼叫 cb('light'|'dark')。回傳停止函式。
   * content.js 再以 THEME 訊息轉送給面板 iframe。
   */
  function watchYouTube(cb, doc = root.document) {
    const read = () => (doc.documentElement.hasAttribute('dark') ? 'dark' : 'light');
    let cur = read();
    cb(cur);
    const mo = new MutationObserver(() => {
      const t = read();
      if (t !== cur) { cur = t; cb(t); }
    });
    mo.observe(doc.documentElement, { attributes: true, attributeFilter: ['dark'] });
    return () => mo.disconnect();
  }

  const api = { KEY, MODES, create, watchYouTube, current: null };

  // <script src="theme.js" data-auto> 放在 <head>：首次繪製前就套用主題（MV3 不能用 inline script）。
  // viewer.html?embed=1 → 內嵌面板，auto 跟隨 YouTube；其他 → 跟隨系統。
  try {
    const cs = root.document && root.document.currentScript;
    if (cs && cs.hasAttribute('data-auto')) {
      const embed = new URLSearchParams(root.location.search).get('embed') === '1';
      api.current = create({ source: embed ? 'youtube' : 'system' });
    }
  } catch (e) { console.warn('[ytcas] theme 自動初始化失敗', e); }

  root.YTCAS_THEME = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
