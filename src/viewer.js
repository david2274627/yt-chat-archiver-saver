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
    let width = 0;

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
    const schedule = () => { if (!raf) raf = document.hidden ? setTimeout(draw, 50) : requestAnimationFrame(draw); };

    scroller.addEventListener('scroll', () => {
      const t = scroller.scrollTop;
      if (Math.abs(t - progTop) > 1) { // 使用者捲動
        const atBottom = t >= maxTop() - 24;
        if (atBottom !== follow) { follow = atBottom; if (onFollow) onFollow(follow); }
        progTop = -1;
      }
      schedule();
    }, { passive: true });
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
      get follow() { return follow; },
      set onFollow(f) { onFollow = f; },
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
    top.append(mark, ttl, meta, moreBtn);
    panel.appendChild(top);

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
    menu.append(miTheme, miDel);
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
    const listWrap = el('div', 'list-wrap');
    listWrap.append(list, empty, resume);
    panel.appendChild(listWrap);

    S.vl = VList(list, renderEntry, estimate);
    S.vl.onFollow = (f) => { resume.hidden = f || !S.items.length; };
    resume.addEventListener('click', () => S.vl.toBottom());

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
    function syncMenu() {
      const th = root.YTCAS_THEME && root.YTCAS_THEME.current;
      miThemeVal.textContent = th ? THEME_NAME[th.mode] || '' : '';
      miDelChk.textContent = S.f.hideDeleted ? '✓' : '';
      miDel.setAttribute('aria-checked', String(S.f.hideDeleted));
    }
    function closeMenu() { S.menuOpen = false; menu.hidden = true; moreBtn.setAttribute('aria-expanded', 'false'); }
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      S.menuOpen = !S.menuOpen; menu.hidden = !S.menuOpen; moreBtn.setAttribute('aria-expanded', String(S.menuOpen));
      if (S.menuOpen) { syncMenu(); const f = menu.querySelector('button'); if (f) f.focus(); }
    });
    document.addEventListener('click', (e) => { if (S.menuOpen && !menu.contains(e.target)) closeMenu(); });
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); moreBtn.focus(); } });
    miTheme.addEventListener('click', () => { const th = root.YTCAS_THEME && root.YTCAS_THEME.current; if (th) th.cycle(); syncMenu(); });
    miDel.addEventListener('click', () => { S.f.hideDeleted = !S.f.hideDeleted; syncMenu(); apply({ reset: true, toBottom: S.vl.follow }); });

    function openBackend() {
      const url = (root.chrome && chrome.runtime && chrome.runtime.getURL ? chrome.runtime.getURL('src/viewer.html') : 'viewer.html') + '?v=' + encodeURIComponent(S.videoId);
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
    function avatar(m, name) {
      const src = CORE.safeImg(m.authorAvatar);
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
          const ranges = kw ? CORE.matchRanges(r.text, kw) : [];
          if (!ranges.length) { box.appendChild(document.createTextNode(r.text)); continue; }
          let p = 0;
          for (const [a, b] of ranges) {
            if (a > p) box.appendChild(document.createTextNode(r.text.slice(p, a)));
            box.appendChild(el('mark', null, r.text.slice(a, b)));
            p = b;
          }
          if (p < r.text.length) box.appendChild(document.createTextNode(r.text.slice(p)));
        }
      }
    }
    function tcNode(m) {
      const tc = CORE.timecode(m, S.stream, { long: S.long, refMs: S.refMs });
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
          if (src) { const img = el('img'); img.src = src; img.alt = '超級貼圖'; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; stk.appendChild(img); }
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
      return row;
    }

    function seek(seconds) {
      if (embed && root.parent && root.parent !== root) {
        root.parent.postMessage({ __ytcas: true, type: C.FM.SEEK_TO, seconds }, C.YT_ORIGIN); // T5 由 top frame 執行跳轉
        return;
      }
      root.open('https://www.youtube.com/watch?v=' + encodeURIComponent(S.videoId) + '&t=' + Math.max(0, seconds) + 's', '_blank', 'noopener');
    }

    // ---------------- 套用篩選
    function apply(o) {
      o = o || {};
      const t0 = performance.now();
      const r = CORE.filter(S.items, S.f);
      S.counts = r.counts;
      // 列的 key：訊息用 id；分隔線用 phase 名稱＋出現序號（量測高度快取以 key 為準）
      const entries = CORE.withPhaseDividers(r.list);
      let seq = 0;
      for (const e of entries) e.key = e.kind === 'phase' ? 'ph:' + e.phase + ':' + (seq++) : e.it.m.id;
      S.timings.filterMs = performance.now() - t0;
      for (const p of CORE.PILLS) {
        const b = pillBtn[p];
        b.setAttribute('aria-selected', String(S.f.pill === p));
        b.querySelector('.num').textContent = fmtN(S.counts[p]);
        if (p === 'all') b.setAttribute('aria-label', '全部訊息 ' + fmtN(S.counts.all));
      }
      S.vl.set(entries, o);
      showEmpty(entries.length ? null : (S.items.length ? 'nomatch' : 'none'));
      resume.hidden = S.vl.follow || !entries.length;
      renderMeta();
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
      S.videoId = videoId || '';
      S.items = []; S.byId = new Map(); S.pinned = []; S.stream = null; S.pinOpen = false;
      renderPin();
      S.vl.set([], { reset: true });
      showEmpty('loading');
      if (!embed && S.videoId && root.history && root.history.replaceState) {
        try { const u = new URL(location.href); u.searchParams.set('v', S.videoId); history.replaceState(null, '', u); } catch (_) { /* 略過 */ }
      }
      if (!S.videoId) { showEmpty(embed ? 'none' : 'nostream'); S.loading = false; return; }
      try {
        const t0 = performance.now();
        const [stream, msgs, pinned] = await Promise.all([DB.getStream(S.videoId), DB.queryMessages(S.videoId), DB.queryPinned(S.videoId)]);
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
        S.items.forEach((it, i) => S.byId.set(it.m.id, i));
        S.timings.indexMs = performance.now() - t1;
        S.pinned = CORE.dedupePinned(pinned);
        renderPin();
        S.loading = false;
        const liveNow = S.stream.isLive && S.stream.endedAt == null;
        resume.textContent = embed || liveNow ? '↓ 恢復自動捲動' : '↓ 跳到最新';
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
    function upsert(messages) {
      let added = false;
      for (const m of messages) {
        if (!m || !m.id || m.videoId !== S.videoId) continue;
        const it = CORE.indexMessage(m, S.channels);
        const i = S.byId.get(m.id);
        if (i != null) { S.items[i] = it; continue; }
        // 通常是最新的訊息：從尾端往前找插入位置
        let j = S.items.length;
        while (j > 0 && S.items[j - 1].m.timestampAbs > m.timestampAbs) j--;
        S.items.splice(j, 0, it);
        added = true;
        if (j !== S.items.length - 1) S.items.forEach((x, k) => S.byId.set(x.m.id, k)); else S.byId.set(m.id, j);
      }
      return added;
    }
    function onRuntime(msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === RT.NEW_MESSAGES && msg.videoId === S.videoId && !S.loading && Array.isArray(msg.messages)) {
        const changed = msg.messages.some((m) => m && S.byId.has(m.id)); // 既有訊息更新（例如被刪除）
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

    // ---------------- 啟動
    const ready = (async () => {
      if (!embed) await loadStreamList();
      let v = S.videoId;
      if (!v && !embed && S.streams.length) v = S.streams[0].videoId;
      if (pick && v) pick.value = v;
      await load(v);
    })();

    return {
      ready, load, state: S, _onRuntime: onRuntime, _refreshStreamCounts: refreshStreamCounts, apply,
      els: { panel, list, pills: pillBtn, user: uField, keyword: kField, pin, menu, moreBtn, miDel, empty, resume, meta, pick },
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
