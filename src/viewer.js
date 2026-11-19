// 檢視器（T4：SPEC F-04～F-07、F-13、F-14、10.4）。內嵌面板（viewer.html?embed=1&v=…）與後台獨立分頁共用。
// - 資料：直接以唯讀交易讀 IndexedDB（SPEC 3.2 v21）；新訊息由 background 的 NEW_MESSAGES 推播。
// - 安全（第 7 節）：所有使用者文字一律 textContent；圖片只顯示白名單網域，其他以 alt 文字代替。
//   innerHTML 只用於本檔內的固定 SVG 圖示字串。
// - T5 以後：VOD 時間軸同步（VOD_TIME）、關閉優化面板按鈕、F-18 版本切換；T7：後台側欄、匯出、刪除。
(function (root) {
  'use strict';

  const C = root.YTCAS_CONST;
  const CORE = root.YTCAS_VIEWER_CORE;
  const T = C.MSG_TYPE;
  const RT = C.RT;

  const GLYPH = {
    search: '<svg class="glyph" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.2 10.2L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    user: '<svg class="glyph" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="5.5" r="2.7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2.8 13.5c.8-2.6 2.8-3.7 5.2-3.7s4.4 1.1 5.2 3.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    more: '<svg class="glyph" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><circle cx="12.5" cy="8" r="1.4" fill="currentColor"/></svg>',
  };
  const BADGE = { owner: ['owner', '主播'], moderator: ['mod', '管理員'], member: ['member', '會員'] };
  const PILL_LABEL = { all: ['', '全部 '], sc: ['💰 ', 'SC／禮物 '], mem: ['👑 ', '會員 '], raid: ['✨ ', '降落 '] };
  const fmtN = (n) => n.toLocaleString('en-US');

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function glyph(name) { const s = el('span'); s.innerHTML = GLYPH[name]; return s.firstChild; } // 固定字串

  // ================================================================ 虛擬清單（高度不一，量測後快取）
  function VList(scroller, renderEntry, estimate) {
    const space = el('div', 'vspace');
    scroller.appendChild(space);
    const OVER = 600; // 上下預先繪製的像素
    let entries = [];
    let off = new Float64Array(1);
    const hcache = new Map();
    let rendered = new Map(); // key → node
    let follow = false;
    let progTop = -1;
    let raf = 0;
    let onFollow = null;
    let onUserScroll = null;
    let width = 0;
    let smoothUntil = 0; // T5：時間軸同步的平滑捲動中（到達目標、使用者操作或 2 秒逾時前），捲動事件不視為使用者捲動

    const keyOf = (e) => e.key;
    const hOf = (i) => { const h = hcache.get(keyOf(entries[i])); return h != null ? h : estimate(entries[i]); };
    function rebuild() {
      const n = entries.length;
      off = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) off[i + 1] = off[i] + hOf(i);
      space.style.height = off[n] + 'px';
    }
    function find(y) { // 最後一個 off[i] <= y 的 i
      let lo = 0, hi = entries.length - 1;
      if (hi < 0) return 0;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (off[mid] <= y) lo = mid; else hi = mid - 1; }
      return lo;
    }
    const maxTop = () => Math.max(0, off[entries.length] - scroller.clientHeight);
    function setTop(y) { progTop = Math.round(Math.min(maxTop(), Math.max(0, y))); scroller.scrollTop = progTop; }

    function draw() {
      raf = 0;
      const n = entries.length;
      if (follow) setTop(maxTop());
      const top = scroller.scrollTop, vh = scroller.clientHeight;
      const want = new Map();
      if (n) {
        const a = find(Math.max(0, top - OVER)), b = find(top + vh + OVER);
        for (let i = a; i <= b && i < n; i++) {
          const k = keyOf(entries[i]);
          let node = rendered.get(k);
          if (!node) { // 外層 flow-root：子元素的 margin 計入量測高度
            node = el('div', 'vrow');
            node.appendChild(renderEntry(entries[i]));
            space.appendChild(node);
          }
          node.style.top = off[i] + 'px';
          node.__i = i;
          want.set(k, node);
        }
      }
      for (const [k, node] of rendered) if (!want.has(k)) node.remove();
      rendered = want;
      // 量測：高度與估計不同 → 更新快取並重新排位；目前位置以上的高度變化以捲動補償（畫面不跳動）
      let changed = false, above = 0;
      for (const node of rendered.values()) {
        const i = node.__i, h = node.offsetHeight;
        if (h && Math.abs(h - hOf(i)) > 0.5) {
          if (off[i] + hOf(i) <= top) above += h - hOf(i);
          hcache.set(keyOf(entries[i]), h);
          changed = true;
        }
      }
      if (changed) {
        rebuild();
        for (const node of rendered.values()) node.style.top = off[node.__i] + 'px';
        if (follow) setTop(maxTop());
        else if (above) setTop(top + above);
      }
    }
    // 背景分頁不會觸發 requestAnimationFrame：隱藏時改用 setTimeout（新訊息推播時清單仍保持正確）
    // T5：requestAnimationFrame 有時不觸發（例如 iframe 在畫面外、視窗被遮住）→ 100ms 後仍未繪製就以 setTimeout 補上
    const schedule = () => {
      if (raf) return;
      if (document.hidden) { raf = setTimeout(draw, 50); return; }
      raf = requestAnimationFrame(draw);
      setTimeout(() => { if (raf) draw(); }, 100);
    };

    scroller.addEventListener('scroll', () => {
      const t = scroller.scrollTop;
      if (smoothUntil) {
        if (Math.abs(t - progTop) <= 1 || Date.now() > smoothUntil) smoothUntil = 0; // 到達目標或逾時
        schedule();
        return;
      }
      // T5.1：只有最近 1.2 秒內有使用者操作（滾輪、觸控、指標、按鍵）才算使用者捲動。內容高度改變時瀏覽器自己夾住
      // scrollTop 也會觸發 scroll 事件，v41 把它當成使用者捲動而關掉「跟隨到底」（載入、篩選、重繪時偶發）
      if (Math.abs(t - progTop) > 1 && Date.now() - lastInput > 1200) {
        if (follow) setTop(maxTop());
        schedule();
        return;
      }
      if (Math.abs(t - progTop) > 1) { // 使用者捲動
        const atBottom = t >= maxTop() - 24;
        if (atBottom !== follow) { follow = atBottom; if (onFollow) onFollow(follow); }
        progTop = -1;
        if (onUserScroll) onUserScroll(atBottom);
      }
      schedule();
    }, { passive: true });
    // 使用者主動操作時立即結束平滑捲動的忽略期（之後的捲動視為使用者捲動）
    let lastInput = 0;
    for (const ev of ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown']) scroller.addEventListener(ev, () => { smoothUntil = 0; lastInput = Date.now(); }, { passive: true });
    if (root.ResizeObserver) {
      new ResizeObserver(() => {
        const w = scroller.clientWidth;
        if (w !== width) { width = w; hcache.clear(); rebuild(); } // 寬度改變：換行不同，重新量測
        schedule();
      }).observe(scroller);
    }

    return {
      // opts.reset：清除既有節點（篩選條件或顯示內容改變）；opts.toBottom／toTop：捲動位置
      set(list, opts) {
        opts = opts || {};
        entries = list;
        if (opts.reset) { for (const node of rendered.values()) node.remove(); rendered = new Map(); }
        rebuild();
        if (opts.toBottom) { follow = true; if (onFollow) onFollow(true); }
        else if (opts.toTop) { follow = false; setTop(0); if (onFollow) onFollow(false); }
        draw();
      },
      refresh() { for (const node of rendered.values()) node.remove(); rendered = new Map(); draw(); },
      toBottom() { follow = true; if (onFollow) onFollow(true); draw(); },
      // T5 時間軸同步：把第 i 列捲到可視範圍底部（像原生聊天室：目前的訊息在最下方）；不改變 follow 以外的狀態
      reveal(i, smooth) {
        if (i < 0 || i >= entries.length) return;
        if (follow) { follow = false; if (onFollow) onFollow(false); }
        const y = Math.round(Math.min(maxTop(), Math.max(0, off[i + 1] - scroller.clientHeight + 8)));
        if (Math.abs(y - scroller.scrollTop) < 2) { draw(); return; }
        if (smooth && Math.abs(y - scroller.scrollTop) <= (C.PANEL ? C.PANEL.SYNC_SMOOTH_MAX_PX : 1500) && scroller.scrollTo) {
          smoothUntil = Date.now() + 2000;
          progTop = y;
          scroller.scrollTo({ top: y, behavior: 'smooth' });
          schedule();
        } else { setTop(y); draw(); }
      },
      setFollow(v) { if (follow !== !!v) { follow = !!v; if (onFollow) onFollow(follow); } },
      get follow() { return follow; },
      set onFollow(f) { onFollow = f; },
      set onUserScroll(f) { onUserScroll = f; },
      get count() { return entries.length; },
      get renderedCount() { return rendered.size; },
      _nodes: () => Array.from(rendered.values()),
    };
  }

  // ================================================================ 檢視器
  function mount(host, opts) {
    opts = opts || {};
    const DB = root.YTCAS_DB;
    const embed = !!opts.embed;
    const S = {
      videoId: opts.videoId || '', stream: null, items: [], byId: new Map(), channels: new Map(), pinned: [],
      f: { pill: 'all', hideDeleted: false, userQuery: '', userChip: '', userChipLabel: '', keyword: '' },
      counts: { all: 0, sc: 0, mem: 0, raid: 0 }, long: false, loading: true, streams: [], pinOpen: false, menuOpen: false,
      timings: {},
      // T5（F-08、F-18）：clock＝top 的 VOD_TIME；mode：tail（跟隨到底）／sync（依播放位置）；ver：同步用的版本；link：連結影片
      clock: null, mode: 'tail', syncPaused: false, currentId: null, entries: [], points: null,
      ver: 'v1', verManual: false, link: null, capture: null, noteKey: '', noteDismissed: null, avatars: new Map(),
      // T5.1（審查十一 13.1 (A)(B)、13.3）：連線診斷計數（只有數字）、載入期間暫存的推播、最後一次推播時間
      diag: { vodTime: 0, theme: 0, capture: 0, pushRecv: 0, pushApplied: 0, pushBuffered: 0, pushOther: 0, polls: 0, pollAdded: 0, loads: 0, dbCount: null,
        // v43（T5.2）：seeked 收到次數、播放位置跳轉（後備判定）次數、直播目標時間與對應訊息的時間、實際資料庫筆數、清單重複數
        seeks: 0, jumps: 0, target: null, targetMsg: null, dbReal: null, dups: null },
      pendingPush: [], lastPushAt: 0,
      // v43：直播在最新時的延遲基準（秒）、上一次的 seeked 累計次數、面板是否退讓中（top 的 PANEL_STATE）
      baseline: null, lastSeeks: null, hostPaused: false,
      // v44（T5.3 (K)）VOD 校正值（CORE.vodCalibration）、計算時的筆數、點時間碼後的藍框固定、目前清單是否依 VOD 時間排序
      cal: null, calN: 0, pin: null, sortedVod: false,
      // v44（T5.3 (L)）直播：倒轉時的錨點、同步微調（直播延遲，秒；依頻道記住）、記住的基準（進入頁面時已不在最新用）、seekEnd 前進速度
      anchor: null, latency: 0, latencyFrom: 'default', liveSync: null, seekEndRate: null,
    };

    // ---------------- 版面
    host.textContent = '';
    const panel = el('div', 'panel app' + (embed ? ' embed' : ''));
    host.appendChild(panel);

    const top = el('div', 'p-top');
    const mark = el('span', 'mark'); mark.setAttribute('aria-hidden', 'true');
    const ttl = el('span', 'ttl', '聊天紀錄');
    const meta = el('span', 'meta');
    const moreBtn = el('button', 'btn icon sm'); moreBtn.type = 'button';
    moreBtn.setAttribute('aria-label', '更多選項'); moreBtn.title = '更多選項'; moreBtn.setAttribute('aria-haspopup', 'menu');
    moreBtn.appendChild(glyph('more'));
    top.append(mark, ttl, meta);
    // T5（F-09、10.4）：內嵌面板頂部列的紅色「關閉優化面板」
    let closeBtn = null;
    if (embed) {
      closeBtn = el('button', 'btn danger close-panel', '關閉優化面板'); closeBtn.type = 'button';
      closeBtn.addEventListener('click', () => toTop({ type: C.FM.PANEL_CLOSE }));
      top.appendChild(closeBtn);
    }
    top.appendChild(moreBtn);
    panel.appendChild(top);

    // T5：版本切換（F-18）與連結影片的時間差（F-18 第 6 點）；有需要時才顯示
    const sub = el('div', 'p-sub'); sub.hidden = true;
    const verPick = el('select', 'ver-pick'); verPick.setAttribute('aria-label', '影片版本'); verPick.hidden = true;
    verPick.addEventListener('change', () => { S.ver = verPick.value; S.verManual = true; S.points = null; apply({ reset: true }); });
    const linkBox = el('div', 'link-box'); linkBox.hidden = true;
    const linkText = el('span', 'link-txt');
    linkBox.appendChild(linkText);
    for (const d of [-10, -1, 1, 10]) {
      const b = el('button', 'btn sm shift', (d > 0 ? '+' : '−') + Math.abs(d)); b.type = 'button';
      b.setAttribute('aria-label', '時間差' + (d > 0 ? '加 ' : '減 ') + Math.abs(d) + ' 秒');
      b.addEventListener('click', () => shiftLink(d));
      linkBox.appendChild(b);
    }
    // v44（T5.3 (L)）直播倒轉時的「同步微調」：畫面落後真實時間的秒數（直播延遲），依頻道記住
    const latBox = el('div', 'link-box lat-box'); latBox.hidden = true;
    const latText = el('span', 'link-txt');
    latBox.appendChild(latText);
    for (const d of [-10, -1, 1, 10]) {
      const b = el('button', 'btn sm shift', (d > 0 ? '+' : '−') + Math.abs(d)); b.type = 'button';
      b.setAttribute('aria-label', '同步微調' + (d > 0 ? '加 ' : '減 ') + Math.abs(d) + ' 秒');
      b.addEventListener('click', () => shiftLatency(d));
      latBox.appendChild(b);
    }
    sub.append(verPick, linkBox, latBox);
    panel.appendChild(sub);
    // T5：F-12 說明與收錄狀態（一行，不是大型橫幅；非持續性的 10 秒後自動隱藏）
    const note = el('div', 'p-note'); note.hidden = true; note.setAttribute('role', 'status');
    const noteText = el('span');
    const noteX = el('button', 'note-x', '×'); noteX.type = 'button'; noteX.setAttribute('aria-label', '關閉說明');
    noteX.addEventListener('click', () => { note.hidden = true; S.noteDismissed = S.noteKey; });
    note.append(noteText, noteX);
    panel.appendChild(note);

    // 後台獨立分頁：場次選擇（T7 改為側欄場次清單）
    let pick = null;
    if (!embed) {
      const bar = el('div', 'actions');
      pick = el('select', 'sess-pick');
      pick.setAttribute('aria-label', '選擇場次');
      bar.appendChild(pick);
      panel.appendChild(bar);
      pick.addEventListener('change', () => load(pick.value));
    }

    const menu = el('div', 'menu'); menu.setAttribute('role', 'menu'); menu.hidden = true;
    const miTheme = el('button'); miTheme.type = 'button'; miTheme.setAttribute('role', 'menuitem');
    const miThemeVal = el('span', 'val');
    miTheme.append('切換主題', miThemeVal);
    const miDel = el('button'); miDel.type = 'button'; miDel.setAttribute('role', 'menuitemcheckbox');
    const miDelChk = el('span', 'chk');
    miDel.append('隱藏已刪除訊息', miDelChk);
    // T5.1：連線狀態（實機排查用，只有計數）
    const miDiag = el('div', 'diag-line'); miDiag.setAttribute('role', 'note');
    menu.append(miTheme, miDel, miDiag);
    if (embed) {
      menu.appendChild(el('hr'));
      const miOpen = el('button'); miOpen.type = 'button'; miOpen.setAttribute('role', 'menuitem');
      miOpen.append('在後台開啟此場次', el('span', 'val', '↗'));
      miOpen.addEventListener('click', () => { closeMenu(); openBackend(); });
      menu.appendChild(miOpen);
    }
    panel.appendChild(menu);

    const tools = el('div', 'p-tools');
    const pills = el('div', 'pills'); pills.setAttribute('role', 'tablist'); pills.setAttribute('aria-label', '訊息分類');
    const pillBtn = {};
    for (const p of CORE.PILLS) {
      const b = el('button', 'pill'); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.pill = p;
      const [ico, lbl] = PILL_LABEL[p];
      if (ico) b.appendChild(el('span', 'pi', ico));
      b.appendChild(el('span', p === 'all' ? 'lbl-all' : 'lbl', lbl));
      b.appendChild(el('span', 'num', '0'));
      b.addEventListener('click', () => { S.f.pill = p; apply({ toBottom: S.vl && S.vl.follow, reset: true }); });
      pills.appendChild(b); pillBtn[p] = b;
    }
    const search = el('div', 'search');
    const uField = searchField('user', '過濾使用者 (頻道名稱 / @代碼)...', '過濾使用者');
    const kField = searchField('search', '搜尋訊息關鍵字或表符...', '搜尋訊息');
    search.append(uField.root, kField.root);
    tools.append(pills, search);
    panel.appendChild(tools);

    const pin = el('div', 'pin'); pin.setAttribute('role', 'button'); pin.tabIndex = 0; pin.hidden = true;
    panel.appendChild(pin);

    const list = el('div', 'list vlist');
    list.setAttribute('role', 'log'); list.setAttribute('aria-label', '聊天訊息'); list.tabIndex = 0;
    const empty = el('div', 'empty'); empty.hidden = true;
    const resume = el('button', 'resume', '↓ 恢復自動捲動'); resume.type = 'button'; resume.hidden = true;
    const syncHint = el('div', 'sync-hint'); syncHint.hidden = true; syncHint.setAttribute('role', 'status');
    const listWrap = el('div', 'list-wrap');
    listWrap.append(list, empty, syncHint, resume);
    panel.appendChild(listWrap);

    S.vl = VList(list, renderEntry, estimate);
    S.vl.onFollow = (f) => { resume.hidden = S.mode === 'sync' ? !S.syncPaused : (f || !S.items.length); };
    // T5：時間軸同步中使用者自己捲動 → 暫停同步（F-08）
    S.vl.onUserScroll = () => {
      if (S.mode !== 'sync') return;
      S.syncPaused = true; S.vl.setFollow(false); resume.hidden = false;
    };
    resume.addEventListener('click', () => {
      if (S.mode === 'sync') { S.syncPaused = false; resume.hidden = true; doSync(false); } else S.vl.toBottom();
    });

    function searchField(icon, placeholder, label) {
      const r = el('div', 'field');
      r.appendChild(glyph(icon));
      const chip = el('span', 'chip'); chip.hidden = true;
      const chipText = el('span');
      const chipX = el('button', 'chip-x', '×'); chipX.type = 'button'; chipX.setAttribute('aria-label', '移除使用者篩選');
      chip.append(chipText, chipX);
      const input = el('input'); input.type = 'search'; input.placeholder = placeholder; input.setAttribute('aria-label', label);
      input.spellcheck = false; input.autocomplete = 'off';
      const clear = el('button', 'clr', '×'); clear.type = 'button'; clear.setAttribute('aria-label', '清除'); clear.hidden = true;
      r.append(chip, input, clear);
      return { root: r, input, clear, chip, chipText, chipX };
    }

    // ---------------- 篩選與搜尋（debounce 200ms，F-06）
    let deb = 0;
    const debounced = () => { clearTimeout(deb); deb = setTimeout(() => apply({ reset: true, toBottom: S.vl.follow }), C.SEARCH_DEBOUNCE_MS); };
    uField.input.addEventListener('input', () => { S.f.userQuery = uField.input.value; syncFields(); debounced(); });
    kField.input.addEventListener('input', () => { S.f.keyword = kField.input.value; syncFields(); debounced(); });
    uField.clear.addEventListener('click', () => { uField.input.value = ''; S.f.userQuery = ''; syncFields(); apply({ reset: true }); uField.input.focus(); });
    kField.clear.addEventListener('click', () => { kField.input.value = ''; S.f.keyword = ''; syncFields(); apply({ reset: true }); kField.input.focus(); });
    uField.chipX.addEventListener('click', () => { S.f.userChip = ''; S.f.userChipLabel = ''; syncFields(); apply({ reset: true }); uField.input.focus(); });
    function syncFields() {
      const chipOn = !!S.f.userChip;
      uField.chip.hidden = !chipOn; uField.chipText.textContent = S.f.userChipLabel;
      uField.input.hidden = chipOn;
      uField.clear.hidden = chipOn || !S.f.userQuery;
      kField.clear.hidden = !S.f.keyword;
      uField.root.classList.toggle('has', chipOn || !!S.f.userQuery);
      kField.root.classList.toggle('has', !!S.f.keyword);
    }
    function setUserChip(it) {
      if (!it.key) return;
      S.f.userChip = it.key; S.f.userChipLabel = it.name || it.m.authorHandle || '';
      S.f.userQuery = ''; uField.input.value = '';
      syncFields();
      apply({ reset: true, toTop: true });
    }

    // ---------------- ⋯ 選單（只在面板內，10.1 原則 6）
    const THEME_NAME = { auto: '自動', light: '淺色', dark: '深色' };
    const BADGE_NAME = { class: '最新', disabled: '最新', behind: '非最新', missing: '找不到', hidden: '未顯示', 'n/a': '—' };
    function diagText() {
      const d = S.diag;
      // v43（16.1 (G)）資料庫＝實際筆數（選單開著時每秒以 count 查詢）；重複＝清單中 id／別名對應到其他位置的筆數
      const db = d.dbReal != null ? d.dbReal : d.dbCount;
      const parts = ['訊息 ' + fmtN(S.items.length) + (db != null ? '／資料庫 ' + fmtN(db) : '') + (d.dups ? '（重複 ' + d.dups + '）' : ''),
        '推播 ' + d.pushRecv + '（套用 ' + d.pushApplied + '、載入中暫存 ' + d.pushBuffered + '、其他場次 ' + d.pushOther + '）', '補讀 ' + d.polls + ' 次 +' + d.pollAdded, '載入 ' + d.loads + ' 次'];
      if (embed) {
        parts.splice(1, 0, '播放時間 ' + d.vodTime + '、主題 ' + d.theme + '、收錄狀態 ' + d.capture);
        // v43（16.1 (F)、16.3）：模式、延遲（seekEnd − currentTime）與基準、徽章、seeked／跳轉次數、目標時間 → 對應訊息的時間
        const c = S.clock;
        const sync = ['模式 ' + S.mode + (S.syncPaused ? '（暫停）' : '')];
        if (c && c.live) {
          const lag = CORE.liveLag(c);
          const eb = effBaseline();
          sync.push('延遲 ' + (lag == null ? '—' : lag.toFixed(1) + ' 秒') + '（基準 ' + (eb == null ? '—' : eb.toFixed(1) + (S.baseline == null ? '，沿用上次' : '')) + '）');
          sync.push('徽章 ' + (BADGE_NAME[c.badge] || '—'));
          // v44（T5.3 (L)）同步微調與 seekEnd 前進速度（每秒，正常約 1.00）
          sync.push('同步微調 ' + S.latency + ' 秒（' + ({ channel: '本頻道', last: '沿用上次', default: '預設' }[S.latencyFrom] || '') + '）');
          if (S.seekEndRate != null) sync.push('seekEnd 速度 ' + S.seekEndRate.toFixed(2));
        }
        if (c && !c.live && S.cal) {
          const k = S.cal;
          sync.push('VOD 校正 ' + (k.delta == null ? '無' : (k.delta >= 0 ? '+' : '−') + Math.abs(k.delta).toFixed(1) + ' 秒') + '（已合併 ' + k.pairs + '、疑似重複 ' + (k.dupPairs || 0) + '、只有 live ' + k.liveOnly + '）');
        }
        sync.push('seeked ' + d.seeks + '、跳轉 ' + d.jumps);
        if (d.target != null) sync.push('目標 ' + CORE.fmtClock(d.target) + ' → ' + (d.targetMsg != null ? CORE.fmtClock(d.targetMsg) : '無'));
        parts.splice(2, 0, sync.join('、'));
        if (d.openErr) parts.push('開啟後台失敗 ' + C.asciiOnly(d.openErr));
      }
      return parts.join(' · ');
    }
    // 清單中重複的筆數：id 或別名在 byId 對應到別的位置（同一則以不同 id 各佔一筆）
    function countDups() {
      let n = 0;
      S.items.forEach((it, i) => {
        for (const k of [it.m.id, ...(it.m.aliasIds || [])]) { const j = S.byId.get(k); if (j != null && j !== i) { n++; break; } }
      });
      return n;
    }
    // ⋯ 選單開著時每秒刷新（16.1 (H)），並查詢實際資料庫筆數
    let menuTimer = 0;
    async function refreshDiag() {
      if (!S.menuOpen) return;
      S.diag.dups = countDups();
      try {
        const vid = S.link ? S.link.orig : S.videoId;
        if (vid && DB.countMessages) S.diag.dbReal = await DB.countMessages(vid);
      } catch (_) { /* 下次再試 */ }
      if (S.menuOpen) miDiag.textContent = '連線狀態：' + diagText();
    }
    function syncMenu() {
      miDiag.textContent = '連線狀態：' + diagText();
      const th = root.YTCAS_THEME && root.YTCAS_THEME.current;
      miThemeVal.textContent = th ? THEME_NAME[th.mode] || '' : '';
      miDelChk.textContent = S.f.hideDeleted ? '✓' : '';
      miDel.setAttribute('aria-checked', String(S.f.hideDeleted));
    }
    function closeMenu() {
      S.menuOpen = false; menu.hidden = true; moreBtn.setAttribute('aria-expanded', 'false');
      if (menuTimer) { clearInterval(menuTimer); menuTimer = 0; }
    }
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      S.menuOpen = !S.menuOpen; menu.hidden = !S.menuOpen; moreBtn.setAttribute('aria-expanded', String(S.menuOpen));
      if (S.menuOpen) {
        syncMenu(); refreshDiag();
        if (!menuTimer) menuTimer = setInterval(refreshDiag, C.PANEL.MENU_REFRESH_MS);
        const f = menu.querySelector('button'); if (f) f.focus();
      } else closeMenu();
    });
    document.addEventListener('click', (e) => { if (S.menuOpen && !menu.contains(e.target)) closeMenu(); });
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); moreBtn.focus(); } });
    miTheme.addEventListener('click', () => { const th = root.YTCAS_THEME && root.YTCAS_THEME.current; if (th) th.cycle(); syncMenu(); });
    miDel.addEventListener('click', () => { S.f.hideDeleted = !S.f.hideDeleted; syncMenu(); apply({ reset: true, toBottom: S.vl.follow }); });

    // v43（T5.2 (I)）內嵌面板由 background 以 chrome.tabs.create 開啟：嵌在 youtube.com 裡的面板自己開，
    // 新分頁的導覽被視為網頁發起、存取 use_dynamic_url 的資源 → ERR_BLOCKED_BY_CLIENT（16.1 (I)）
    // v44（T5.3 (J)）：嵌入模式**不再退回 window.open**（嵌入環境開出的分頁一定被擋）；失敗時在面板顯示原因代碼。
    // 開的是不在 web_accessible_resources 的 backend.html（background 端）
    async function openBackend() {
      const vid = S.link ? S.link.orig : S.videoId;
      let code = 'no-runtime';
      if (root.chrome && chrome.runtime && chrome.runtime.sendMessage) {
        try {
          const r = await chrome.runtime.sendMessage({ type: RT.OPEN_VIEWER, videoId: vid });
          if (r && r.ok) return;
          code = r ? String(r.error || 'failed') : 'no-response';
        } catch (e) { code = 'send:' + C.asciiOnly(String((e && e.message) || e)).slice(0, 60); }
      }
      S.diag.openErr = code;
      if (embed) {
        console.warn('[ytcas] 無法開啟後台分頁', 'openViewer:' + C.asciiOnly(code));
        showNotice('無法開啟後台分頁（' + C.asciiOnly(code) + '）。可從擴充功能圖示的選單開啟後台。', 'warn');
        return;
      }
      // 後台分頁本身（測試頁等沒有 background 時）：同一個擴充功能頁面內開新分頁不受限制
      const url = (root.chrome && chrome.runtime && chrome.runtime.getURL ? chrome.runtime.getURL('src/backend.html') : 'backend.html') + '?v=' + encodeURIComponent(vid);
      try { if (chrome.tabs && chrome.tabs.create) { chrome.tabs.create({ url }); return; } } catch (_) { /* 退回 window.open */ }
      root.open(url, '_blank', 'noopener');
    }

    // ---------------- 置頂卡片（F-07）
    pin.addEventListener('click', () => { S.pinOpen = !S.pinOpen; renderPin(); });
    pin.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); S.pinOpen = !S.pinOpen; renderPin(); } });
    function renderPin() {
      const p = S.pinned[0];
      pin.hidden = !p;
      if (!p) return;
      pin.textContent = '';
      pin.classList.toggle('open', S.pinOpen);
      pin.setAttribute('aria-expanded', String(S.pinOpen));
      pin.appendChild(avatar(p, CORE.displayName(p, S.channels)));
      pin.appendChild(el('span', 'tag', '置頂'));
      const txt = el('span', 'txt');
      renderRuns(txt, p.runs, '');
      if (S.pinOpen && S.pinned.length > 1) {
        const more = el('span', 'pin-more', `較早的置頂 ${S.pinned.length - 1} 則`);
        txt.appendChild(more);
        for (const q of S.pinned.slice(1)) { const d = el('span', 'pin-old'); renderRuns(d, q.runs, ''); txt.appendChild(d); }
      }
      pin.appendChild(txt);
      pin.appendChild(el('span', 'hint', S.pinOpen ? '收合 ▲' : '▼'));
    }

    // ---------------- 列渲染
    function estimate(e) {
      if (e.kind === 'phase') return 34;
      const t = e.it.m.type;
      if (t === T.SUPERCHAT) return 84;
      if (t === T.SUPERSTICKER) return 128;
      if (t === T.GIFT) return 64;
      if (t === T.MEMBERSHIP || t === T.MILESTONE || t === T.RAID) return 56;
      return 40;
    }
    // T5.1（審查十一第 10 節 3）頭像後備：訊息本身 → 同場次同作者 → 頻道資料（F-03）→ 首字圓點
    function rememberAvatar(m) {
      const k = C.avatarAuthorKey(m);
      if (k && m.authorAvatar && !S.avatars.has(k)) S.avatars.set(k, m.authorAvatar);
    }
    function avatarUrl(m) {
      if (m.authorAvatar) return m.authorAvatar;
      const k = C.avatarAuthorKey(m);
      if (k && S.avatars.has(k)) return S.avatars.get(k);
      const ch = m.authorHandle && S.channels ? S.channels.get(m.authorHandle) : null;
      return (ch && ch.avatar) || '';
    }
    function avatar(m, name) {
      const src = CORE.safeImg(avatarUrl(m));
      if (src) {
        const img = el('img', 'av'); img.src = src; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.decoding = 'async';
        img.addEventListener('error', () => { img.replaceWith(initial(name)); }, { once: true });
        return img;
      }
      return initial(name);
    }
    function initial(name) {
      const s = el('span', 'av', Array.from(String(name || '').replace(/^@/, ''))[0] || '?');
      s.setAttribute('aria-hidden', 'true');
      return s;
    }
    // 內容：文字 runs（關鍵字以 <mark> 標示）＋ 表符（白名單圖片或 alt 文字）
    function renderRuns(box, runs, kw) {
      for (const r of runs || []) {
        if (r && r.emoji) {
          const src = CORE.safeImg(r.emoji.src);
          const hit = kw && CORE.emojiMatches(r.emoji, kw);
          let node;
          if (src) {
            node = el('img', 'emo-img'); node.src = src; node.alt = r.emoji.alt || r.emoji.shortcut || '';
            node.title = r.emoji.shortcut || r.emoji.alt || ''; node.loading = 'lazy'; node.referrerPolicy = 'no-referrer';
          } else node = el('span', 'emo-alt', r.emoji.alt || r.emoji.shortcut || '');
          if (hit) { const mk = el('mark'); mk.appendChild(node); box.appendChild(mk); } else box.appendChild(node);
        } else if (r && r.text) {
          // v44（17.1）連結：<a target="_blank" rel="noopener noreferrer">，文字照原樣（可能是截斷的），title 顯示完整網址
          const url = r.link ? CORE.safeLink(r.link.url) : '';
          let target = box;
          if (url) {
            const a = el('a', 'lnk'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = url;
            a.addEventListener('click', (e) => e.stopPropagation());
            box.appendChild(a); target = a;
          }
          const ranges = kw ? CORE.matchRanges(r.text, kw) : [];
          if (!ranges.length) { target.appendChild(document.createTextNode(r.text)); continue; }
          let p = 0;
          for (const [a, b] of ranges) {
            if (a > p) target.appendChild(document.createTextNode(r.text.slice(p, a)));
            target.appendChild(el('mark', null, r.text.slice(a, b)));
            p = b;
          }
          if (p < r.text.length) target.appendChild(document.createTextNode(r.text.slice(p)));
        }
      }
    }
    function tcNode(m) {
      const tc = CORE.timecode(m, S.stream, { long: S.long, refMs: S.refMs });
      // T5：內嵌面板收到播放器時間後，可點與否、跳到哪裡依時間軸換算（VOD：版本 offset＋連結時間差；直播：DVR 範圍）
      if (embed && S.clock) {
        const vt = CORE.videoTimeOf(m, S.clock, syncOpts());
        if (vt == null || !CORE.inRange(vt, S.clock)) return el('span', 'tc static', tc.text);
        const text = S.clock.live ? tc.text : CORE.fmtDur(vt);
        const b = el('button', 'tc', text); b.type = 'button'; b.setAttribute('aria-label', '跳轉至 ' + text);
        b.addEventListener('click', (e) => { e.stopPropagation(); if (!S.clock.live) pinAt(m, vt); seek(vt); });
        return b;
      }
      if (tc.seconds == null) return el('span', 'tc static', tc.text);
      const b = el('button', 'tc', tc.text); b.type = 'button'; b.setAttribute('aria-label', tc.label);
      b.addEventListener('click', (e) => { e.stopPropagation(); seek(tc.seconds); });
      return b;
    }
    function nameNode(it, cls) {
      const n = el('span', 'nm' + (cls ? ' ' + cls : ''), it.name || '（未知）');
      if (it.key) {
        n.setAttribute('role', 'button'); n.tabIndex = 0; n.title = '只看這位使用者';
        n.addEventListener('click', () => setUserChip(it));
        n.addEventListener('keydown', (e) => { if (e.key === 'Enter') setUserChip(it); });
      }
      return n;
    }
    function roleOf(m) {
      const b = m.authorBadges || [];
      return b.includes('owner') ? 'owner' : b.includes('moderator') ? 'mod' : b.includes('member') ? 'member' : '';
    }
    function head(body, it) {
      const m = it.m;
      body.appendChild(tcNode(m));
      body.appendChild(nameNode(it, roleOf(m)));
      if (m.authorHandle && m.authorHandle !== it.name) body.appendChild(el('span', 'hd', m.authorHandle));
      for (const b of m.authorBadges || []) if (BADGE[b]) body.appendChild(el('span', 'bdg ' + BADGE[b][0], BADGE[b][1]));
      if (it.cats.includes('raid') && m.type !== T.RAID) body.appendChild(el('span', 'bdg raid', '✨ 降落'));
      if (m.deleted) body.appendChild(el('span', 'bdg del', '已刪除'));
    }

    function renderEntry(e) {
      if (e.kind === 'phase') {
        const d = el('div', 'phase'); d.setAttribute('role', 'separator');
        d.appendChild(el('span', null, e.label));
        return d;
      }
      const it = e.it, m = it.m, kw = S.f.keyword;
      let row;
      if (m.type === T.SUPERCHAT || m.type === T.SUPERSTICKER) {
        row = el('div', 'card' + (m.deleted ? ' deleted' : ''));
        const col = CORE.parseColor(m.color);
        if (col) { row.style.background = col.bg; row.style.color = col.fg; row.classList.add(col.fg === '#fff' ? 'on-dark' : 'on-light'); } else row.classList.add('nocolor');
        const hr = el('div', 'hd-row');
        hr.append(avatar(m, it.name), tcNode(m), nameNode(it, ''), el('span', 'amt', m.amount || ''));
        row.appendChild(hr);
        if (m.deleted) hr.appendChild(el('span', 'bdg del', '已刪除'));
        if (m.type === T.SUPERSTICKER) {
          const stk = el('div', 'stk');
          const src = CORE.safeImg(m.stickerSrc);
          // v44（17.2）alt：貼圖描述；沒有圖時以 alt 文字當後備（都沒有才顯示 🏷）
          const alt = typeof m.stickerAlt === 'string' ? m.stickerAlt : '';
          if (src) {
            const img = el('img'); img.src = src; img.alt = alt || '超級貼圖'; img.title = alt; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
            img.addEventListener('error', () => { img.replaceWith(alt ? el('span', 'stk-alt', alt) : document.createTextNode('🏷')); }, { once: true });
            stk.appendChild(img);
          } else if (alt) stk.appendChild(el('span', 'stk-alt', alt));
          else stk.textContent = '🏷';
          row.appendChild(stk);
        }
        if ((m.runs || []).length) { const tx = el('div', 'tx content'); renderRuns(tx, m.runs, kw); row.appendChild(tx); }
      } else if (m.type === T.GIFT) {
        row = el('div', 'giftcard' + (m.deleted ? ' deleted' : ''));
        const g = el('span', 'gimg'); g.setAttribute('aria-hidden', 'true');
        const src = CORE.safeImg(m.giftImage);
        if (src) { const img = el('img'); img.src = src; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; g.appendChild(img); } else g.textContent = '🎁';
        const info = el('div', 'ginfo');
        info.append(tcNode(m), nameNode(it, ''), el('span', 'bdg gift', '🎁 禮物'));
        if (m.deleted) info.appendChild(el('span', 'bdg del', '已刪除'));
        const sub = el('div', 'sub content');
        if (m.giftName) {
          sub.append('送出 ');
          const gn = el('span', 'gname'); renderRuns(gn, [{ text: m.giftName }], kw); sub.appendChild(gn);
          if (m.giftCount > 1) sub.append(' ×' + m.giftCount);
        } else renderRuns(sub, m.runs, kw); // 結構未確認前：顯示擷取到的文字
        info.appendChild(sub);
        row.append(g, info);
        if (m.jewels) row.appendChild(el('span', 'jw', fmtN(m.jewels) + ' Jewels'));
      } else if (m.type === T.MEMBERSHIP || m.type === T.MILESTONE) {
        row = el('div', 'msg member-ev' + (m.deleted ? ' deleted' : ''));
        const body = el('div', 'body');
        body.append(tcNode(m), nameNode(it, 'member'), el('span', 'bdg member', m.type === T.MILESTONE ? '里程碑' : '會員'));
        if (m.deleted) body.appendChild(el('span', 'bdg del', '已刪除'));
        const sub = el('div', 'sub content'); renderRuns(sub, m.runs, kw); body.appendChild(sub);
        row.append(avatar(m, it.name), body);
      } else if (m.type === T.RAID) {
        row = el('div', 'msg raid');
        const body = el('div', 'body');
        body.append(tcNode(m), el('span', 'bdg raid', '✨ 降落'));
        const sub = el('div', 'sub content'); renderRuns(sub, m.runs, kw); body.appendChild(sub);
        const ic = el('span', 'av', '✨'); ic.setAttribute('aria-hidden', 'true');
        row.append(ic, body);
      } else if (m.type === T.SYSTEM) {
        row = el('div', 'msg sys');
        const ic = el('span', 'av', 'i'); ic.setAttribute('aria-hidden', 'true');
        const body = el('div', 'body');
        body.appendChild(tcNode(m));
        const c = el('span', 'content'); renderRuns(c, m.runs, kw); body.appendChild(c);
        row.append(ic, body);
      } else {
        row = el('div', 'msg' + (m.deleted ? ' deleted' : ''));
        const body = el('div', 'body');
        head(body, it);
        const c = el('span', 'content'); renderRuns(c, m.runs, kw); body.appendChild(c);
        row.append(avatar(m, it.name), body);
      }
      row.dataset.id = m.id;
      if (m.id === S.currentId) row.classList.add('current');
      // F-18：選了剪輯版時，剪輯版中沒有的訊息淡色顯示並標示
      if (S.ver !== 'v1' && (m.phase || 'live') === 'live' && CORE.versionOffset(m, S.ver) == null) {
        row.classList.add('cut');
        row.appendChild(el('span', 'bdg cut', '剪輯版中不存在'));
      }
      return row;
    }

    // 內嵌面板 → top frame（只送給 youtube.com）
    function toTop(msg) {
      if (!(embed && root.parent && root.parent !== root)) return false;
      try { root.parent.postMessage(Object.assign({ __ytcas: true }, msg), C.YT_ORIGIN); } catch (_) { return false; }
      return true;
    }
    function seek(seconds) {
      if (toTop({ type: C.FM.SEEK_TO, seconds })) return; // T5：由 top frame 執行跳轉
      root.open('https://www.youtube.com/watch?v=' + encodeURIComponent(S.videoId) + '&t=' + Math.max(0, seconds) + 's', '_blank', 'noopener');
    }

    // ---------------- 套用篩選
    function apply(o) {
      o = o || {};
      const t0 = performance.now();
      const r = CORE.filter(S.items, S.f);
      S.counts = r.counts;
      // v44（T5.3 (K)）VOD 模式（v1）：清單依同步用的時間排序（live 來源的訊息以校正值換算），同步點才涵蓋所有訊息
      let list = r.list;
      if (vodOrder()) {
        if (!S.cal || Math.abs(S.calN - S.items.length) > Math.max(50, S.calN * 0.05)) { S.cal = CORE.vodCalibration(S.items.map((x) => x.m), S.stream); S.calN = S.items.length; }
        list = CORE.sortForVod(list, S.ver, S.cal);
      }
      S.sortedVod = vodOrder();
      // 列的 key：訊息用 id；分隔線用 phase 名稱＋出現序號（量測高度快取以 key 為準）
      const entries = CORE.withPhaseDividers(list);
      let seq = 0;
      for (const e of entries) e.key = e.kind === 'phase' ? 'ph:' + e.phase + ':' + (seq++) : e.it.m.id;
      S.timings.filterMs = performance.now() - t0;
      for (const p of CORE.PILLS) {
        const b = pillBtn[p];
        b.setAttribute('aria-selected', String(S.f.pill === p));
        b.querySelector('.num').textContent = fmtN(S.counts[p]);
        if (p === 'all') b.setAttribute('aria-label', '全部訊息 ' + fmtN(S.counts.all));
      }
      S.entries = entries; S.points = null;
      if (S.mode === 'sync') o = Object.assign({}, o, { toBottom: false });
      S.vl.set(entries, o);
      showEmpty(entries.length ? null : (S.items.length ? 'nomatch' : 'none'));
      resume.hidden = S.mode === 'sync' ? !S.syncPaused : (S.vl.follow || !entries.length);
      renderMeta();
      if (S.mode === 'sync') doSync(false);
    }

    // ---------------- T5：時間軸同步（F-08）
    const syncOpts = () => ({ ver: S.ver, shift: S.link ? S.link.shift : 0, points: S.points, baseline: effBaseline(), cal: vodOrder() ? S.cal : null,
      latency: S.latency, target: S.clock && S.clock.live && S.mode === 'sync' ? CORE.liveTarget(S.clock, S.anchor, S.latency) : undefined });
    // 基準：本頁量到的；還沒量到（進入頁面時已不在最新、徽章說不在最新）時用記住的上一次的值
    function effBaseline() { return S.baseline != null ? S.baseline : (S.liveSync && typeof S.liveSync.baseline === 'number' ? S.liveSync.baseline : null); }

    // ---------------- v44（T5.3 (L)）同步微調（直播延遲）：chrome.storage.local 'liveSync' = { byChannel: { 頻道: 秒 }, last: 秒, baseline: 秒 }
    const LS_KEY = 'liveSync';
    const chanKey = () => (S.stream && (S.stream.channelHandle || S.stream.channelId)) || '';
    async function loadLiveSync() {
      try { const r = await chrome.storage.local.get(LS_KEY); S.liveSync = (r && r[LS_KEY]) || {}; } catch (_) { S.liveSync = S.liveSync || {}; }
      applyLatency();
    }
    function applyLatency() {
      const ls = S.liveSync || {};
      const k = chanKey();
      const by = ls.byChannel || {};
      if (k && typeof by[k] === 'number') { S.latency = by[k]; S.latencyFrom = 'channel'; }
      else if (typeof ls.last === 'number') { S.latency = ls.last; S.latencyFrom = 'last'; } // 沒校正過的頻道：用最近一次校正的值
      else { S.latency = C.PANEL.LIVE_LATENCY_DEFAULT_SEC; S.latencyFrom = 'default'; }
      renderSub();
    }
    let lsSave = 0;
    function saveLiveSync(patch) {
      S.liveSync = Object.assign({}, S.liveSync || {}, patch);
      clearTimeout(lsSave);
      lsSave = setTimeout(() => { try { const p = chrome.storage.local.set({ [LS_KEY]: S.liveSync }); if (p && p.catch) p.catch(() => {}); } catch (_) { /* 測試頁 */ } }, 800);
    }
    function shiftLatency(d) {
      S.latency = Math.max(-600, Math.min(600, Math.round((S.latency + d) * 10) / 10));
      S.latencyFrom = 'channel';
      const k = chanKey();
      const by = Object.assign({}, (S.liveSync && S.liveSync.byChannel) || {});
      if (k) by[k] = S.latency;
      // 只保留最近 200 個頻道
      const keys = Object.keys(by); if (keys.length > 200) delete by[keys[0]];
      saveLiveSync({ byChannel: by, last: S.latency });
      renderSub(); S.vl.refresh(); doSync(false);
    }
    let lastBaselineSave = 0;
    function rememberBaseline() {
      if (S.baseline == null || Date.now() - lastBaselineSave < 30000) return;
      lastBaselineSave = Date.now();
      saveLiveSync({ baseline: Math.round(S.baseline * 10) / 10 });
    }
    // VOD 模式：內嵌面板收到 live: false 的播放器時間，且看的是 v1
    function vodOrder() { return !!(embed && S.clock && !S.clock.live && (!S.ver || S.ver === 'v1')); }
    // v43（16.1 (F)）直播倒轉到最早收錄的訊息之前：提示，不要看起來像停著不動
    function setHint(text) {
      if (syncHint.textContent !== text) syncHint.textContent = text;
      syncHint.hidden = !text;
    }
    function rowOf(id) {
      for (const n of list.querySelectorAll('.vrow > [data-id]')) if (n.dataset.id === id) return n;
      return null;
    }
    function setCurrent(id) {
      if (id === S.currentId) return;
      const old = S.currentId;
      S.currentId = id;
      if (old) { const n = rowOf(old); if (n) n.classList.remove('current'); }
      if (id) { const n = rowOf(id); if (n) n.classList.add('current'); }
    }
    // 點時間碼：記下被點的訊息與「下一則」的時間（同步點中第一個時間大於它的）
    function pinAt(m, t) {
      if (!S.points) S.points = CORE.syncPoints(S.entries, syncOpts());
      const nx = S.points.find((p) => p.t > t + 0.001);
      S.pin = { id: m.id, t, next: nx ? nx.t : null };
      S.syncPaused = false;
      setCurrent(m.id);
    }
    function doSync(smooth) {
      if (!S.clock || S.mode !== 'sync') return;
      if (!S.points && !S.clock.live) S.points = CORE.syncPoints(S.entries, syncOpts());
      let i = CORE.syncIndex(S.entries, S.clock, syncOpts());
      // v44（T5.3 (K) 4）點時間碼跳轉後：藍框標在被點的那則，直到播放位置越過下一則（或往回超過 5 秒）
      if (S.pin && !S.clock.live) {
        const pi = S.entries.findIndex((e) => e.kind === 'msg' && e.it.m.id === S.pin.id);
        const t = S.clock.currentTime;
        if (pi >= 0 && t >= S.pin.t - 5 && (S.pin.next == null || t < S.pin.next)) i = pi;
        else S.pin = null;
      }
      setCurrent(i >= 0 ? S.entries[i].it.m.id : null);
      S.diag.target = S.clock.live ? CORE.liveTarget(S.clock, S.anchor, S.latency) : null;
      S.diag.targetMsg = i >= 0 ? S.entries[i].it.m.timestampAbs : null;
      let hint = '';
      if (S.clock.live && i < 0 && S.entries.length) {
        const firstLive = S.entries.find((e) => e.kind === 'msg' && (e.it.m.phase || 'live') === 'live');
        if (firstLive) hint = '此時間點之前沒有收錄（最早 ' + CORE.fmtClock(firstLive.it.m.timestampAbs, S.refMs) + '）';
      }
      setHint(hint);
      if (!S.syncPaused && S.entries.length) S.vl.reveal(Math.max(0, i), smooth);
    }
    function onClock(c) {
      if (!c || typeof c.currentTime !== 'number' || !Number.isFinite(c.currentTime)) return;
      const first = !S.clock;
      const prev = S.clock;
      const liveChanged = !!S.clock && !!S.clock.live !== !!c.live;
      const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      S.clock = { currentTime: c.currentTime, paused: !!c.paused, duration: num(c.duration), seekStart: num(c.seekStart), seekEnd: num(c.seekEnd),
        live: !!c.live, at: num(c.at) || Date.now(), liveHead: c.liveHead === true || c.liveHead === false ? c.liveHead : null,
        badge: typeof c.badge === 'string' ? c.badge.slice(0, 16) : null };
      // v43（T5.2，審查十一 16.3）使用者在播放器上跳轉 → 視為要求重新跟隨，解除「同步暫停」。
      // 依據：top 的 seeked 累計次數（seeks）有變化；或播放位置與預期（上一次＋經過時間）差超過 SEEK_JUMP_SEC（seeked 沒觸發時的後備）
      let seeked = false;
      const seeks = num(c.seeks);
      if (seeks != null) { if (S.lastSeeks != null && seeks !== S.lastSeeks) { seeked = true; S.diag.seeks++; } S.lastSeeks = seeks; }
      if (!seeked && prev && !first) {
        const expect = prev.currentTime + (prev.paused ? 0 : (S.clock.at - prev.at) / 1000);
        if (Math.abs(S.clock.currentTime - expect) > C.PANEL.SEEK_JUMP_SEC) { seeked = true; S.diag.jumps++; }
      }
      if (seeked) S.syncPaused = false;
      // v43（16.1 (F)）在最新時本來就有的延遲（基準）
      if (S.clock.live) S.baseline = CORE.nextBaseline(S.baseline, S.clock, C.PANEL.LIVE_EDGE_SEC, C.PANEL.BASELINE_DRIFT);
      else S.baseline = null;
      // F-18：VOD 依影片長度自動選版本（使用者手動選過就不改）
      if (!S.clock.live && !S.verManual && S.stream && Array.isArray(S.stream.versions) && S.stream.versions.length > 1) {
        const v = CORE.pickVersion(S.stream.versions, S.clock.duration);
        if (v && v !== S.ver) { S.ver = v; S.points = null; renderSub(); S.vl.refresh(); }
      }
      const mode = S.clock.live && CORE.atLiveEdge(S.clock, C.PANEL.LIVE_EDGE_SEC, S.baseline) ? 'tail' : 'sync';
      if (mode !== S.mode) {
        S.mode = mode; S.syncPaused = false;
        if (mode === 'tail') { setCurrent(null); setHint(''); S.diag.target = null; S.diag.targetMsg = null; resume.textContent = '↓ 恢復自動捲動'; S.vl.toBottom(); }
        else resume.textContent = '↓ 回到播放位置';
        resume.hidden = true;
        renderSub(); // 同步微調只在直播倒轉時顯示
      } else if (seeked && mode === 'sync') resume.hidden = true;
      else if (seeked && mode === 'tail' && S.clock.live) S.vl.toBottom(); // 跳回最新：回到跟隨到底
      // v44（T5.3 (L)）直播：在最新時與每次跳轉時重新定錨；倒轉中目標時間依播放位置前進（不依賴 seekEnd 之後怎麼動）
      if (S.clock.live) {
        if (mode === 'tail' || seeked || !S.anchor || liveChanged) S.anchor = { ct: S.clock.currentTime, abs: CORE.playheadAbs(S.clock, effBaseline()) };
        if (prev && prev.live && typeof prev.seekEnd === 'number' && typeof S.clock.seekEnd === 'number') {
          const dt = (S.clock.at - prev.at) / 1000;
          if (dt > 0.2 && dt < 10) { const r = (S.clock.seekEnd - prev.seekEnd) / dt; S.seekEndRate = S.seekEndRate == null ? r : S.seekEndRate * 0.9 + r * 0.1; }
        }
        rememberBaseline();
      } else { S.anchor = null; S.seekEndRate = null; }
      // 時間碼的可點與文字依 clock 而定：重新繪製可見列；VOD 排序改變時重新套用（T5.3 (K)）
      if (vodOrder() !== S.sortedVod && !S.loading) apply({ reset: true });
      else if (first || liveChanged) S.vl.refresh();
      if (mode === 'sync') doSync(!first && !seeked);
    }

    // ---------------- T5：版本（F-18）與連結影片（F-18 第 6 點）
    function renderSub() {
      const vers = (S.stream && Array.isArray(S.stream.versions)) ? S.stream.versions : [];
      verPick.textContent = '';
      if (vers.length > 1 && !S.link) {
        for (const v of vers) {
          const o = el('option', null, (v.label || v.id) + (typeof v.duration === 'number' ? ' ' + CORE.fmtDur(v.duration) : ''));
          o.value = v.id;
          verPick.appendChild(o);
        }
        verPick.value = S.ver;
        verPick.hidden = false;
      } else verPick.hidden = true;
      if (S.link) {
        const sh = S.link.shift;
        linkText.textContent = '同步原始場次「' + ((S.stream && S.stream.title) || S.link.orig) + '」・時間差 ' + (sh >= 0 ? '+' : '−') + Math.abs(sh) + ' 秒';
        linkBox.hidden = false;
      } else linkBox.hidden = true;
      const showLat = !!(embed && S.clock && S.clock.live && S.mode === 'sync');
      if (showLat) {
        const L = S.latency;
        latText.textContent = '同步微調：畫面落後 ' + (L >= 0 ? '' : '−') + Math.abs(L) + ' 秒' + (S.latencyFrom === 'channel' ? '（本頻道）' : S.latencyFrom === 'last' ? '（沿用上次）' : '');
        latText.title = '藍框的訊息比畫面內容新（畫面還沒演到就先出現）→ 按 +；藍框的訊息比畫面內容舊 → 按 −';
      }
      latBox.hidden = !showLat;
      sub.hidden = verPick.hidden && linkBox.hidden && latBox.hidden;
    }
    let linkSave = 0;
    function shiftLink(d) {
      if (!S.link) return;
      S.link.shift = Math.round((S.link.shift + d) * 10) / 10;
      S.points = null;
      renderSub();
      S.vl.refresh();
      doSync(false);
      clearTimeout(linkSave);
      linkSave = setTimeout(() => {
        try {
          const p = chrome.runtime.sendMessage({ type: RT.LINK_VIDEO, videoId: S.link.orig, linkedVideoId: S.videoId, offsetShift: S.link.shift });
          if (p && p.catch) p.catch(() => {});
        } catch (_) { /* 測試頁 */ }
      }, 800);
    }

    // ---------------- T5：收錄狀態與 F-12 說明
    let noteTimer = 0;
    function renderNote() {
      const n = CORE.captureNote(S.capture);
      clearTimeout(noteTimer);
      const key = n ? n.text : '';
      S.noteKey = key;
      if (!n || S.noteDismissed === key) { note.hidden = true; return; }
      noteText.textContent = n.text;
      note.className = 'p-note ' + n.tone;
      note.hidden = false;
      if (!n.sticky) noteTimer = setTimeout(() => { note.hidden = true; }, 10000);
    }

    // 一次性的提示（用同一個 p-note 列，10 秒後隱藏；之後的收錄狀態會覆蓋它）
    function showNotice(text, tone) {
      clearTimeout(noteTimer);
      S.noteKey = 'notice:' + text;
      noteText.textContent = text;
      note.className = 'p-note ' + (tone || 'info');
      note.hidden = false;
      noteTimer = setTimeout(() => { note.hidden = true; }, 10000);
    }

    function showEmpty(kind) {
      empty.hidden = !kind;
      if (!kind) return;
      empty.textContent = '';
      const map = {
        loading: ['⏳', '正在載入聊天紀錄…', ''],
        none: ['💬', '還沒有訊息', '有人留言後會顯示在這裡'],
        nomatch: ['🔍', '找不到符合的訊息', '試試其他關鍵字，或清除篩選'],
        nostream: ['📂', '還沒有收錄任何場次', '在 YouTube 開著有聊天室的影片，訊息就會自動收錄'],
        error: ['⚠', '無法讀取聊天紀錄', '請重新開啟此頁'],
      }[kind];
      const ico = el('span', 'ico', map[0]); ico.setAttribute('aria-hidden', 'true');
      empty.append(ico, el('b', null, map[1]));
      if (map[2]) empty.appendChild(el('span', null, map[2]));
    }

    function renderMeta() {
      meta.textContent = '';
      const s = S.stream;
      if (!s) return;
      const liveNow = s.isLive && s.endedAt == null && s.startedAt != null;
      if (liveNow) { const d = el('span', 'live-dot'); d.setAttribute('aria-hidden', 'true'); meta.appendChild(d); }
      const status = liveNow ? '直播中' : s.startPending ? '等待開播' : (s.startedAt == null && s.scheduledStartAt) ? '待機室' : s.endedAt ? '已結束' : '';
      const parts = [];
      if (embed && status) parts.push(status);
      if (!embed) parts.push(s.title || s.videoId);
      parts.push(fmtN(S.items.length) + ' 則');
      meta.append(parts.join(' · '));
      meta.title = parts.join(' · ');
    }

    // ---------------- 載入
    let loadSeq = 0;
    async function load(videoId) {
      const my = ++loadSeq;
      // T5.1（13.3）：載入期間 S.loading 必須為 true。v41 以前重新載入時沒有設，載入中收到的推播寫進即將被覆蓋的清單而遺失
      if (S.videoId !== (videoId || '')) S.pendingPush = [];
      S.loading = true;
      S.diag.loads++;
      S.videoId = videoId || '';
      S.items = []; S.byId = new Map(); S.pinned = []; S.stream = null; S.pinOpen = false;
      S.currentId = null; S.syncPaused = false; S.entries = []; S.points = null; S.cal = null; S.calN = 0; S.pin = null;
      renderPin();
      S.vl.set([], { reset: true });
      showEmpty('loading');
      if (!embed && S.videoId && root.history && root.history.replaceState) {
        try { const u = new URL(location.href); u.searchParams.set('v', S.videoId); history.replaceState(null, '', u); } catch (_) { /* 略過 */ }
      }
      if (!S.videoId) { showEmpty(embed ? 'none' : 'nostream'); S.loading = false; return; }
      try {
        const t0 = performance.now();
        // T5（F-18 第 6 點）：內嵌面板看的是某場的連結影片（剪輯版重新上傳）→ 載入原始場次，以時間差同步
        S.link = null;
        let dataVid = S.videoId;
        if (embed && !(await DB.getStream(S.videoId))) {
          const hit = CORE.findLinkedStream(await DB.listStreams(), S.videoId);
          if (hit) { S.link = { orig: hit.stream.videoId, shift: Number(hit.link.offsetShift) || 0, label: hit.link.label || '' }; dataVid = hit.stream.videoId; }
        }
        if (my !== loadSeq) return;
        const [stream, msgs, pinned] = await Promise.all([DB.getStream(dataVid), DB.queryMessages(dataVid), DB.queryPinned(dataVid)]);
        if (my !== loadSeq) return;
        S.timings.queryMs = performance.now() - t0;
        S.stream = stream || { videoId: S.videoId };
        S.long = CORE.isLongStream(S.stream);
        S.refMs = S.stream.startedAt || (msgs[0] && msgs[0].timestampAbs) || null;
        const handles = new Set();
        for (const m of msgs) if (m.authorHandle) handles.add(m.authorHandle);
        for (const p of pinned) if (p.authorHandle) handles.add(p.authorHandle);
        S.channels = await DB.getChannels(Array.from(handles));
        if (my !== loadSeq) return;
        const t1 = performance.now();
        S.items = msgs.map((m) => CORE.indexMessage(m, S.channels));
        S.avatars = new Map();
        S.items.forEach((it, i) => { indexIds(it.m, i); rememberAvatar(it.m); });
        S.timings.indexMs = performance.now() - t1;
        S.pinned = CORE.dedupePinned(pinned);
        renderPin();
        S.ver = 'v1'; S.verManual = false; S.points = null;
        if (S.liveSync) applyLatency(); // 頻道已知：套用該頻道的同步微調（v44）
        renderSub();
        S.loading = false;
        S.diag.dbCount = msgs.length;
        // 載入期間收到的推播：資料庫快照之後的才補上（upsert 以 id／別名去重，不會重複計數）
        if (S.pendingPush.length) { const pend = S.pendingPush; S.pendingPush = []; upsert(pend); }
        const liveNow = S.stream.isLive && S.stream.endedAt == null;
        // T5.1：時間軸同步中（播放器時間比資料先到）不覆寫「↓ 回到播放位置」
        if (S.mode !== 'sync') resume.textContent = embed || liveNow ? '↓ 恢復自動捲動' : '↓ 跳到最新';
        apply({ reset: true, toBottom: embed || liveNow, toTop: !(embed || liveNow) });
        setCurrentCount();
        S.timings.firstScreenMs = performance.now() - t0;
      } catch (e) {
        console.warn('[ytcas] 檢視器載入失敗', C.asciiOnly(e && e.message));
        S.loading = false;
        showEmpty('error');
      }
    }

    const optLabel = (s, n) => {
      const d = s.startedAt || s.scheduledStartAt || s.lastMessageAt;
      return [s.title || s.videoId, d ? new Date(d).toLocaleDateString() : '', fmtN(n != null ? n : s.messageCount || 0) + ' 則'].filter(Boolean).join(' · ');
    };
    async function loadStreamList() {
      try { S.streams = await DB.listStreams(); } catch (_) { S.streams = []; }
      if (!pick) return;
      pick.textContent = '';
      for (const s of S.streams) {
        const o = el('option', null, optLabel(s));
        o.value = s.videoId;
        pick.appendChild(o);
      }
      pick.hidden = !S.streams.length;
    }
    // T4.1（審查十一 5.2）選單筆數：目前場次隨推播更新（以已載入的筆數為準）；其他場次在游標移到選單上或取得焦點時重新查詢
    //（最多每 2 秒一次）。只改選項文字與新增場次，不重建選單，不影響目前的選擇
    function setCurrentCount() {
      if (!pick || !S.videoId) return;
      const o = Array.from(pick.options).find((x) => x.value === S.videoId);
      const s = S.streams.find((x) => x.videoId === S.videoId);
      if (o && s) { const t = optLabel(Object.assign({}, s, S.stream || {}), S.items.length); if (o.textContent !== t) o.textContent = t; }
    }
    let lastListRefresh = 0;
    async function refreshStreamCounts() {
      if (!pick || Date.now() - lastListRefresh < 2000) return;
      lastListRefresh = Date.now();
      let list;
      try { list = await DB.listStreams(); } catch (_) { return; }
      const opts = new Map(Array.from(pick.options).map((o) => [o.value, o]));
      list.forEach((s, i) => {
        const n = s.videoId === S.videoId && !S.loading ? Math.max(S.items.length, s.messageCount || 0) : null;
        let o = opts.get(s.videoId);
        if (!o) { // 新的場次：依清單順序插入
          o = el('option', null, '');
          o.value = s.videoId;
          pick.insertBefore(o, pick.options[i] || null);
        }
        const t = optLabel(s, n);
        if (o.textContent !== t) o.textContent = t;
      });
      S.streams = list;
      pick.hidden = !list.length;
    }
    if (pick) for (const ev of ['pointerenter', 'focus']) pick.addEventListener(ev, () => { refreshStreamCounts(); });

    // ---------------- 推播：新訊息、刪除標記、頻道名稱
    // 推播合併成每 300ms 最多一次；reset：既有訊息內容改變（刪除標記、名稱），可見列需重新繪製
    let pendingApply = 0;
    let pendingReset = false;
    let lastStreamCheck = 0;
    function scheduleApply(reset) {
      if (reset) pendingReset = true;
      if (pendingApply) return;
      pendingApply = setTimeout(() => {
        pendingApply = 0;
        const r = pendingReset; pendingReset = false;
        apply({ toBottom: S.vl.follow, reset: r });
      }, 300);
    }
    // id 與別名（F-14 aliasIds）都對應到清單位置：同一則訊息以不同 id 送來時更新既有那筆，不重複計數（13.3）
    function indexIds(m, i) {
      S.byId.set(m.id, i);
      for (const a of m.aliasIds || []) if (a) S.byId.set(a, i);
    }
    function findIndex(m) {
      let i = S.byId.get(m.id);
      if (i == null) for (const a of m.aliasIds || []) { i = S.byId.get(a); if (i != null) break; }
      return i == null ? null : i;
    }
    function upsert(messages) {
      let added = false;
      for (const m of messages) {
        if (!m || !m.id || m.videoId !== (S.link ? S.link.orig : S.videoId)) continue;
        const it = CORE.indexMessage(m, S.channels);
        rememberAvatar(m);
        const i = findIndex(m);
        if (i != null) { S.items[i] = it; indexIds(m, i); continue; }
        // 通常是最新的訊息：從尾端往前找插入位置
        let j = S.items.length;
        while (j > 0 && S.items[j - 1].m.timestampAbs > m.timestampAbs) j--;
        S.items.splice(j, 0, it);
        added = true;
        if (j !== S.items.length - 1) { S.byId = new Map(); S.items.forEach((x, k) => indexIds(x.m, k)); } else indexIds(m, j);
      }
      return added;
    }
    function onRuntime(msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === RT.NEW_MESSAGES && Array.isArray(msg.messages)) {
        S.diag.pushRecv++;
        if (msg.videoId !== (S.link ? S.link.orig : S.videoId)) { S.diag.pushOther++; return; }
        S.lastPushAt = Date.now();
        if (S.loading) { S.diag.pushBuffered++; S.pendingPush.push(...msg.messages); return; }
        S.diag.pushApplied++;
        const changed = msg.messages.some((m) => m && findIndex(m) != null); // 既有訊息更新（例如被刪除）
        if (upsert(msg.messages)) setCurrentCount();
        scheduleApply(changed);
        maybeRefreshStream();
      } else if (msg.type === RT.CHANNEL_RESOLVED && msg.handleOrId && msg.displayName) {
        S.channels.set(msg.handleOrId, { handleOrId: msg.handleOrId, displayName: msg.displayName, avatar: msg.avatar });
        let hit = false;
        S.items.forEach((it, i) => { if (it.m.authorHandle === msg.handleOrId) { S.items[i] = CORE.indexMessage(it.m, S.channels); hit = true; } });
        if (hit) scheduleApply(true);
      }
    }
    // 場次資訊（開播／結束時間）變化時重新載入：phase 與 offset 可能已被 background 重算（F-14）
    async function maybeRefreshStream() {
      const now = Date.now();
      if (now - lastStreamCheck < 15000) return;
      lastStreamCheck = now;
      try {
        const [s, pinned] = await Promise.all([DB.getStream(S.videoId), DB.queryPinned(S.videoId)]);
        const old = S.stream || {};
        if (s && (s.startedAt !== old.startedAt || s.endedAt !== old.endedAt || !!s.startPending !== !!old.startPending)) { load(S.videoId); return; }
        if (s) { S.stream = s; renderMeta(); }
        S.pinned = CORE.dedupePinned(pinned); renderPin();
      } catch (_) { /* 下次再試 */ }
    }
    if (root.chrome && chrome.runtime && chrome.runtime.onMessage) chrome.runtime.onMessage.addListener(onRuntime);

    // T5.1（13.1 (B)）推播的後備：收錄中的場次（直播中）超過 15 秒沒有收到推播時，每 5 秒比對資料庫筆數，
    // 有新訊息就以 offset 索引只讀新的部分（offset 未知時才讀整場，最多每 30 秒一次）
    // v43（審查十一 15 節第 2 點）：退讓中（劇院模式，top 的 PANEL_STATE）或分頁隱藏時暫停；比對改用實際筆數（count，只讀索引鍵）；
    // offset 未知只能讀整場時，間隔拉長為 FULL_POLL_MS（messages 沒有 videoId＋timestampAbs 索引，記入 F-20）
    let pollBusy = false, lastFullPoll = 0;
    async function pollNew() {
      if (pollBusy || S.loading || !S.stream || !S.videoId) return;
      if (S.hostPaused || (root.document && document.hidden)) return;
      const s0 = S.stream;
      if (!(s0.isLive && s0.endedAt == null) || Date.now() - S.lastPushAt < 15000) return;
      pollBusy = true;
      try {
        const vid = S.link ? S.link.orig : S.videoId;
        const s = await DB.getStream(vid);
        if (!s) return;
        const known = S.items.length;
        const real = DB.countMessages ? await DB.countMessages(vid) : (s.messageCount || 0);
        S.diag.dbReal = real;
        if (real <= known && (s.lastMessageAt || 0) <= (S.items.length ? S.items[S.items.length - 1].m.timestampAbs : 0)) return;
        S.diag.polls++;
        let fresh;
        let maxOff = null;
        for (let i = S.items.length - 1; i >= 0 && i >= S.items.length - 200; i--) { const o = S.items[i].m.videoOffsetSec; if (typeof o === 'number') { maxOff = maxOff == null ? o : Math.max(maxOff, o); } }
        if (maxOff != null) fresh = await DB.queryMessagesFromOffset(vid, maxOff - 120);
        else {
          if (Date.now() - lastFullPoll < C.PANEL.FULL_POLL_MS) return;
          lastFullPoll = Date.now();
          fresh = await DB.queryMessages(vid);
        }
        if (S.loading || vid !== (S.link ? S.link.orig : S.videoId)) return;
        const before = S.items.length;
        upsert(fresh);
        S.diag.pollAdded += S.items.length - before;
        S.diag.dbCount = real;
        if (S.items.length !== before) { setCurrentCount(); scheduleApply(false); }
      } catch (_) { /* 下次再試 */ } finally { pollBusy = false; }
    }
    setInterval(pollNew, 5000);

    // ---------------- T5：top frame 的訊息（只接受 youtube.com 的 parent；THEME 由 theme.js 處理）
    function onFrame(e) {
      if (!embed || e.source !== root.parent || e.origin !== C.YT_ORIGIN) return;
      const d = e.data;
      if (!d || d.__ytcas !== true) return;
      if (d.type === C.FM.VOD_TIME) { S.diag.vodTime++; onClock(d); }
      else if (d.type === C.FM.THEME) S.diag.theme++;
      else if (d.type === C.FM.PANEL_STATE) S.hostPaused = !!d.paused;
      else if (d.type === C.FM.CAPTURE_STATUS) {
        S.diag.capture++;
        S.capture = { capturing: !!d.capturing, reason: d.reason || null, f12: d.f12 || null, viewMode: d.viewMode || null };
        renderNote();
      }
    }
    if (embed) { root.addEventListener('message', onFrame); toTop({ type: C.FM.PANEL_READY }); }

    // ---------------- v44（T5.3，審查十一 18.4）F-20 P9：面板 viewer 本身的記憶體
    // 面板是擴充功能 origin 的 iframe（另一個程序），top 與聊天室框架的 P9 量不到。記錄中且選了 P9 才取樣；只有數字。
    // heap（performance.memory）、DOM 節點、清單筆數（訊息／篩選後列）、虛擬列表實際繪出的列數
    const DG = C.DIAG;
    let diagSt = { active: false };
    let lastP9 = 0;
    if (embed && root.chrome && chrome.storage && chrome.storage.local) {
      try {
        const p = chrome.storage.local.get(DG.STATE_KEY);
        if (p && p.then) p.then((o) => { diagSt = (o && o[DG.STATE_KEY]) || { active: false }; lastP9 = 0; }).catch(() => {});
        if (chrome.storage.onChanged) chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch[DG.STATE_KEY]) { diagSt = ch[DG.STATE_KEY].newValue || { active: false }; lastP9 = 0; } });
      } catch (_) { /* 測試頁 */ }
    }
    const p9On = () => !!diagSt.active && Array.isArray(diagSt.probes) && diagSt.probes.includes('P9');
    function p9Sample() {
      const pm = (typeof performance !== 'undefined' && performance.memory) || null;
      const mb = (v) => (typeof v === 'number' ? Math.round(v / 104857.6) / 10 : null);
      return { usedJSHeapMB: mb(pm && pm.usedJSHeapSize), totalJSHeapMB: mb(pm && pm.totalJSHeapSize), heapLimitMB: mb(pm && pm.jsHeapSizeLimit),
        domNodes: document.getElementsByTagName('*').length, items: S.items.length, entries: S.entries.length,
        rendered: list.querySelectorAll('.vrow').length, avatars: S.avatars.size, hidden: !!document.hidden, hostPaused: !!S.hostPaused, mode: S.mode };
    }
    function p9Tick(force) {
      if (!p9On()) return;
      const every = Math.max(DG.P9_MIN_MINUTES, Number(diagSt.p9Minutes) || DG.P9_MINUTES) * 60000;
      if (!force && lastP9 && Date.now() - lastP9 < every - 1000) return;
      lastP9 = Date.now();
      const rec = { ts: lastP9, probe: 'P9', kind: 'memory', ctx: { env: 'panel', videoId: S.link ? S.link.orig : S.videoId }, data: p9Sample() };
      try { const p = chrome.runtime.sendMessage({ type: RT.DIAG_LOG, records: [rec] }); if (p && p.catch) p.catch(() => {}); } catch (_) { /* ignore */ }
    }
    if (embed) setInterval(() => p9Tick(false), 15000);

    // ---------------- 啟動
    const ready = (async () => {
      if (embed) await loadLiveSync();
      if (!embed) await loadStreamList();
      let v = S.videoId;
      if (!v && !embed && S.streams.length) v = S.streams[0].videoId;
      if (pick && v) pick.value = v;
      await load(v);
    })();

    return {
      ready, load, state: S, _onRuntime: onRuntime, _shiftLatency: shiftLatency, _p9Sample: p9Sample, _p9Tick: p9Tick, _avatarUrl: (m) => avatarUrl(m), _onFrame: onFrame, _onClock: onClock, _onCapture: (d) => { S.capture = d; renderNote(); }, _refreshStreamCounts: refreshStreamCounts, apply,
      els: { panel, list, pills: pillBtn, user: uField, keyword: kField, pin, menu, moreBtn, miDel, empty, resume, meta, pick, closeBtn, verPick, linkBox, linkText, note, noteText, latBox, latText },
    };
  }

  root.YTCAS_VIEWER = { mount, VList };

  // viewer.html：<main id="app" data-autostart>
  try {
    const app = document.getElementById('app');
    if (app && app.hasAttribute('data-autostart')) {
      const q = new URLSearchParams(location.search);
      root.YTCAS_VIEWER.current = mount(app, { embed: q.get('embed') === '1', videoId: q.get('v') || '' });
    }
  } catch (e) { console.warn('[ytcas] 檢視器啟動失敗', C.asciiOnly(e && e.message)); }
})(typeof globalThis !== 'undefined' ? globalThis : self);
