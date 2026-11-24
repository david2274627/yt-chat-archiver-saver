// 擷取引擎（SPEC F-01、F-02、F-14、F-15、F-19、3.2）：嵌入式 chat frame 與彈出式聊天室共用。
// 不依賴 chrome.*：送出函式由呼叫端提供（content.js 包 chrome.runtime.sendMessage；測試頁用假函式）。
// 選擇器一律取自 selectors.js；未在 docs/youtube-dom-notes.md 確認的結構在 selectors.js 標「待實機確認」。
// 輸出到 console 的內容只有標籤名稱與筆數，不含任何訊息文字。
(function (root) {
  'use strict';
  const C = root.YTCAS_CONST;
  const S = root.YTCAS_SEL;
  const T = C.MSG_TYPE;
  const RT = C.RT;
  const SAVED = 'ytcasSaved'; // dataset 鍵：data-ytcas-saved="1"（已擷取）／"skip"（不擷取，可修剪）

  // ---------------------------------------------------------------- 工具
  function hash(str) {
    let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
      h2 = (h2 ^ (h2 >>> 15)) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  // v44（T5.3，審查十一 17.2）圖片網址正規化（表符、頭像、貼圖、禮物共用）：協定相對網址（//host/…）補 https:；
  // 只接受 https（data:、blob:、javascript:、http: 一律丟棄）
  const httpsOnly = (u) => {
    if (typeof u !== 'string') return '';
    const s = u.trim();
    if (s.startsWith('//')) return 'https:' + s;
    return s.startsWith('https://') ? s : '';
  };
  // img 元素 → https 網址：先用屬性值（協定相對網址補 https:），不行再用瀏覽器已解析的 .src。
  // v43 以前是 `getAttribute('src') || img.src`：屬性是協定相對網址時不是空字串，不會改用 .src，接著被 httpsOnly 丟掉
  const imgUrl = (img) => (img ? httpsOnly(img.getAttribute('src') || '') || httpsOnly(img.src || '') : '');
  const httpsOnlyUrl = httpsOnly; // T5.1：頭像補送用（同一規則）

  // v44（T5.3，審查十一 17.1）訊息中的連結：完整網址只在 href（顯示文字本來就會截斷）。
  // YouTube 的 /redirect?…&q=<網址> 解出 q；站內連結（頻道、影片、#hashtag）保留為 https://www.youtube.com/… 的完整網址；
  // 只接受 http:／https:，其他協定丟棄（只留文字）
  function linkUrl(href) {
    if (typeof href !== 'string' || !href.trim()) return '';
    let u;
    try { u = new URL(href.trim(), 'https://www.youtube.com/'); } catch (_) { return ''; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    const yt = /(^|\.)youtube\.com$/i.test(u.hostname);
    if (yt && u.pathname === S.chat.link.redirectPath) {
      const q = u.searchParams.get(S.chat.link.redirectParam);
      if (!q) return '';
      let t;
      try { t = new URL(q); } catch (_) { return ''; }
      return t.protocol === 'https:' || t.protocol === 'http:' ? t.href : '';
    }
    return u.href;
  }

  // 直播 #timestamp（當地時間，只到分鐘；例「下午10:23」「10:23 PM」「22:23」）→ ms。
  // 擷取時間夾在該分鐘範圍內（SPEC F-02 v29）；解析失敗回傳 null。
  // v51（T6.2，審查十一 32.7）**結果不得在未來**：實機待機室進入頁面時載入的歷史訊息有前幾天的（YouTube 只顯示時間、不顯示日期），
  //   v50 以「晚超過 12 小時才當前一天」判斷 → 昨天的「下午11:13」在今天 20:22 擷取被當成今天 23:13（未來），還被分到「直播中」。
  //   規則：ceil（這則最晚可能的時間；預設＝擷取時間＋CLOCK_FUTURE_TOL_MS）→ 取「同一個顯示時間」不晚於 ceil 的最近一次（往前推整天）。
  //   沒有上午／下午標記且 ≤ 12 點（可能是沒標記的 12 小時制）→ h 與 h＋12 兩種解讀取不晚於 ceil 的較晚者。
  //   回溯擷取（backlog）由 backfill 依 DOM 順序從最新一則往回傳 ceil（下一則的時間），重建跨好幾天的日期。
  const CLOCK_RE = /(上午|下午|午前|午後|AM|PM|a\.m\.|p\.m\.)?\s*(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?\s*(上午|下午|AM|PM|a\.m\.|p\.m\.)?/i;
  const DAY_MS = 24 * 3600 * 1000;
  // 回傳 { ts, futureShift（同一天的解讀在未來、往前推了）, daysBack（相對擷取當天往前推的天數）, marker, sec } 或 null
  function clockInfo(text, now, ceil) {
    const m = CLOCK_RE.exec(String(text || ''));
    if (!m) return null;
    let h = Number(m[2]);
    const min = Number(m[3]);
    const sec = m[4] != null ? Number(m[4]) : null;
    if (h > 23 || min > 59 || (sec != null && sec > 59)) return null;
    const ap = (m[1] || m[5] || '').toLowerCase();
    const pm = ap === '下午' || ap === '午後' || ap === 'pm' || ap === 'p.m.';
    const am = ap === '上午' || ap === '午前' || ap === 'am' || ap === 'a.m.';
    if ((pm || am) && h > 12) return null;
    if (pm && h < 12) h += 12;
    if (am && h === 12) h = 0;
    const lim = typeof ceil === 'number' && Number.isFinite(ceil) ? ceil : now + C.CLOCK_FUTURE_TOL_MS;
    const at = (hh) => { const d = new Date(now); d.setHours(hh, min, sec == null ? 0 : sec, 0); return d.getTime(); };
    // 同一個顯示時間不晚於 lim 的最近一次
    const latest = (base) => base + Math.floor((lim - base) / DAY_MS) * DAY_MS;
    const today = at(h);
    let ts = latest(today);
    if (!ap && h <= 12) { const alt = latest(at(h === 12 ? 0 : h + 12)); if (alt > ts) ts = alt; }
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    return { ts, futureShift: today > now + C.CLOCK_FUTURE_TOL_MS && ts < today, daysBack: Math.max(0, Math.ceil((startOfDay.getTime() - ts) / DAY_MS)),
      marker: !!ap, sec: sec != null };
  }
  const lastClock = { info: null, text: '' }; // parseMessage 最後一次的時間解析（擷取引擎統計 clockFuture、P7 ts-format 用；同步讀取）
  function parseClock(text, now, ceil) {
    const c = clockInfo(text, now, ceil);
    if (!c) return null;
    const span = c.sec ? 999 : 59999;
    // 夾在該分鐘範圍內、且不晚於擷取時間（未來 CLOCK_FUTURE_TOL_MS 內的時鐘誤差 → 擷取時間）
    return c.ts > now ? now : Math.min(now, c.ts + span);
  }
  // P7 ts-format：#timestamp 文字的「形狀」（數字 → d、標記 → A／P，其他字元只保留冒號、空白、負號），不記原文
  function clockShape(text) {
    const s = String(text || '').trim().slice(0, 24);
    return s.replace(/上午|午前|AM|a\.m\./gi, 'A').replace(/下午|午後|PM|p\.m\./gi, 'P').replace(/\d/g, 'd').replace(/[^dAP:：\s-]/g, '?').replace(/：/g, ':');
  }

  // 顯示時間所在分鐘的開頭（ms）；解析失敗回傳 null（與 parseClock 同一套規則，只是不夾到擷取時間）
  function clockMinute(text, now) {
    const m = CLOCK_RE.exec(String(text || ''));
    if (!m) return null;
    const v = parseClock(text, now);
    if (v == null) return null;
    const d = new Date(v);
    d.setSeconds(0, 0);
    if (m[4] != null) return null; // 有秒數的格式：parseClock 已經精確
    return d.getTime();
  }

  // 重播 #timestamp（影片時間，如 1:23、1:02:03、-0:05）→ 秒；解析失敗回傳 null
  function parseOffset(text) {
    const m = /^\s*(-)?(?:(\d+):)?(\d{1,2}):(\d{2})\s*$/.exec(String(text || ''));
    if (!m) return null;
    const s = (Number(m[2] || 0) * 3600) + Number(m[3]) * 60 + Number(m[4]);
    return m[1] ? -s : s;
  }

  // 訊息內容 → runs（文字與表符）。相鄰文字合併。
  function runsOf(el) {
    const out = [];
    if (!el) return out;
    const push = (t) => {
      if (!t) return;
      const last = out[out.length - 1];
      if (last && last.text != null && !last.link) last.text += t; else out.push({ text: t });
    };
    const walk = (node) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) push(n.nodeValue);
        else if (n.nodeType === 1) {
          if (n.tagName === 'IMG') {
            out.push({ emoji: { src: imgUrl(n), alt: n.getAttribute('alt') || '',
              shortcut: n.getAttribute(S.chat.emojiShortcutAttr) || '' } });
          } else if (n.tagName === 'A' && n.matches(S.chat.link.anchor)) {
            // v44（17.1）：{ text, link: { url } }；網址不合格 → 只留文字
            // v45（20.4 第 4 點）文字就是 @handle 的連結：一律連到 https://www.youtube.com/@handle（不管 href 指向哪裡）
            const text = n.textContent || '';
            const h = C.domHandle(text); // v48（28.2）連結文字是 DOM 給的：短 handle（@无恋）也算
            const url = h ? C.handleUrl(h) : linkUrl(n.getAttribute('href') || '');
            if (url && text) out.push({ text, link: { url } });
            else if (url) out.push({ text: url, link: { url } });
            else push(text);
          } else walk(n);
        }
      }
    };
    walk(el);
    return out;
  }
  const textRuns = (s) => (s ? [{ text: s }] : []);

  // 作者名稱：只取 #author-name 自己的文字（不含 #chip-badges 等子元素）
  function authorNameOf(el) {
    const n = el.querySelector(S.chat.author.name);
    if (!n) return '';
    let s = '';
    for (const c of n.childNodes) if (c.nodeType === 3) s += c.nodeValue;
    return clean(s) || clean(n.textContent);
  }

  const BADGES = new Set(['owner', 'moderator', 'member', 'verified']);
  function badgesOf(el) {
    const out = [];
    const t = (el.getAttribute(S.chat.authorTypeAttr) || '').toLowerCase();
    if (BADGES.has(t)) out.push(t);
    el.querySelectorAll(S.chat.author.badges).forEach((b) => {
      const v = (b.getAttribute(S.chat.badgeTypeAttr) || '').toLowerCase();
      if (BADGES.has(v) && !out.includes(v)) out.push(v);
    });
    return out;
  }

  function cssVar(el, names) {
    try {
      const cs = getComputedStyle(el);
      for (const n of names) { const v = cs.getPropertyValue(n).trim(); if (v) return v; }
    } catch (_) { /* 測試環境 */ }
    return '';
  }

  // v47（26.4）文字色變數 → { header?, author?, timestamp?, body? }；只接受色碼（#rgb／#rrggbb／#rrggbbaa、rgb()／rgba()），都沒有 → null
  const COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|#[0-9a-f]{8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/i;
  function textColors(el, vars) {
    if (!vars) return null;
    const out = {};
    for (const [k, name] of Object.entries(vars)) {
      const v = cssVar(el, [name]);
      if (v && COLOR_RE.test(v)) out[k] = v.toLowerCase().replace(/\s+/g, '');
    }
    return Object.keys(out).length ? out : null;
  }

  // 刪除狀態（待實機確認：屬性名稱與 #deleted-state 內容）
  function isDeletedEl(el) {
    const D = S.chat.deleted;
    if (D.attr && el.hasAttribute(D.attr)) return true;
    const st = el.querySelector(D.stateEl);
    return !!(st && clean(st.textContent));
  }

  // ---------------------------------------------------------------- 解析單一訊息元件
  // ctx: { source, now, startedAt, endedAt, scheduledStartAt }
  // 回傳 null 表示不擷取（佔位元素、跑馬燈項目等）
  const SKIP_TAGS = new Set([S.chat.placeholderItem, S.chat.tickerSponsorItem]);
  const KNOWN_SYSTEM_TAGS = new Set([S.chat.viewerEngagement]);
  const unknownLogged = new Set();

  function parseMessage(el, ctx) {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return null;
    let type = S.messageTypeByTag[tag] || T.SYSTEM;
    if (type === T.SYSTEM && !KNOWN_SYSTEM_TAGS.has(tag) && !unknownLogged.has(tag)) {
      unknownLogged.add(tag);
      console.info('[ytcas] 未知訊息元件', tag);
    }
    const name = authorNameOf(el);
    const handle = name.startsWith('@') ? name : '';
    const photo = el.querySelector(S.chat.author.photo);
    const m = {
      id: el.id || '',
      type,
      authorHandle: handle,
      authorChannelId: '',
      authorUrl: C.handleUrl(handle), // v48（27 第 2 點）路徑段以 encodeURIComponent 編碼（@又新-david、@魚_5123）
      authorAvatar: imgUrl(photo),
      authorBadges: badgesOf(el),
      runs: [],
    };
    if (name && !handle) m.authorName = name;
    const msgEl = el.querySelector(S.chat.message);

    if (tag === S.chat.membershipItem) {
      const P = S.chat.membership;
      const head = [clean((el.querySelector(P.primaryText) || {}).textContent), clean((el.querySelector(P.subtext) || {}).textContent)].filter(Boolean).join(' ');
      m.runs = textRuns(head);
      const body = runsOf(msgEl);
      if (body.length && m.runs.length) m.runs.push({ text: '\n' });
      m.runs.push(...body);
    } else if (type === T.SUPERCHAT || type === T.SUPERSTICKER) {
      m.amount = clean((el.querySelector(S.chat.purchaseAmount) || {}).textContent);
      m.color = cssVar(el, type === T.SUPERCHAT ? S.chat.paidMessageColorVars : S.chat.paidStickerColorVars);
      // v47（T5.6，審查十一 26.4）YouTube 給這則 SC 的文字色（標題列、名稱、時間、內文）：檢視器優先使用，取不到才用對比度規則
      const tc = textColors(el, type === T.SUPERCHAT ? S.chat.paidMessageTextColorVars : S.chat.paidStickerTextColorVars);
      if (tc) m.textColors = tc;
      m.runs = runsOf(msgEl);
      if (type === T.SUPERSTICKER) {
        const st = el.querySelector(S.chat.stickerImg);
        m.stickerSrc = imgUrl(st);
        // v44（17.2）貼圖描述：沒有圖時以 alt 文字當後備
        const alt = st ? clean(st.getAttribute('alt') || st.getAttribute('aria-label') || '') : '';
        if (alt) m.stickerAlt = alt.slice(0, 200);
      }
    } else if (tag === S.chat.giftMessage) {
      // F-13 禮物：v46（T5.5，審查十一 24.3）依實機結構專用解析（selectors.js chat.gift、dom-notes 5.3）：
      //   送禮者 handle＝#author-name-v2（authorSource: 'dom'）、頭像＝#author-photo img、內文＝#message-v2、
      //   禮物圖片＝#gift-image img（擷取當下沒有 src → captureNode 延遲補送）、alt＝禮物名稱（giftName）
      const G = S.chat.gift;
      const an = clean((el.querySelector(G.author) || {}).textContent);
      if (an) {
        const h = C.domHandle(an); // v48（28.2）DOM 給的送禮者：短 handle 也算
        if (h) { m.authorHandle = h; m.authorUrl = C.handleUrl(h); delete m.authorName; } else { m.authorName = an; }
        m.authorSource = 'dom';
      }
      if (!m.authorAvatar) m.authorAvatar = imgUrl(el.querySelector(G.photo));
      const me = el.querySelector(G.message);
      m.runs = me ? runsOf(me) : msgEl ? runsOf(msgEl) : textRuns(clean(el.textContent).slice(0, 300));
      const gimg = el.querySelector(G.image);
      if (gimg) {
        const u = imgUrl(gimg);
        if (u) m.giftImage = u;
        const alt = clean(gimg.getAttribute('alt') || '');
        if (alt) m.giftName = alt.slice(0, 100);
      } else {
        // 結構不同（舊版元件）：第一張非頭像圖片作為禮物圖片
        const gi = Array.from(el.querySelectorAll('img')).filter((i) => i !== photo).map((i) => imgUrl(i)).find(Boolean);
        if (gi) m.giftImage = gi;
      }
      m.rawTag = tag;
      // v45（T5.4，審查十一 20.4 第 3 點）後備（#author-name-v2 取不到時）：從內文開頭的 @handle 推出送禮者（authorSource: 'text'）。
      // 只取 @ 開頭的 handle 格式，不比對任何語言的文字
      if (!m.authorHandle && !m.authorName) {
        const first = m.runs.find((r) => r && typeof r.text === 'string' && r.text.trim());
        const h = first ? C.handleOf(first.text) : '';
        if (h) { m.authorHandle = h; m.authorUrl = C.handleUrl(h); m.authorSource = 'text'; }
      }
    } else if (type === T.SYSTEM || tag === S.chat.giftRedemption || tag === S.chat.giftAnnouncement) {
      // 結構未確認的元件：保存 #message，沒有時保存可見文字（上限 300 字）供日後重新分類
      m.runs = msgEl ? runsOf(msgEl) : textRuns(clean(el.textContent).slice(0, 300));
      if (type === T.SYSTEM) m.rawTag = tag;
    } else {
      m.runs = runsOf(msgEl);
    }

    // 時間（F-02）：直播讀當地時間、重播讀影片時間
    const tsText = clean((el.querySelector(S.chat.timestamp) || {}).textContent);
    if (ctx.source === 'replay') {
      const off = parseOffset(tsText);
      m.videoOffsetSec = off;
      m.timestampAbs = ctx.startedAt != null && off != null ? ctx.startedAt + off * 1000 : ctx.now;
      m.phase = 'live';
    } else {
      // T5.1（審查十一 13.1 (C)）聊天室顯示的時間只到分鐘：parseClock 只有在擷取時間落在該分鐘內才有秒數，
      // 其餘一律落在分鐘的開頭或最後一刻 → 同一分鐘的訊息時間相同、offset 的秒數全部一樣。
      // 即時到達（observer 擷取）的訊息改用到達時間，只要與顯示的分鐘相差 ≤ 90 秒（時鐘誤差、傳遞延遲）；
      // 進入頁面時的歷史訊息（回溯、補掃、修剪前補擷取）維持用顯示時間。tsSource 記錄來源
      // v51（32.7）ctx.clockCeil：回溯擷取時由 backfill 依 DOM 順序給「下一則（較新）的時間」，重建跨日日期
      const ci = clockInfo(tsText, ctx.now, ctx.clockCeil);
      lastClock.info = ci; lastClock.text = tsText;
      const ts = ci ? parseClock(tsText, ctx.now, ctx.clockCeil) : null;
      const minute = ts == null || ctx.clockCeil != null ? null : clockMinute(tsText, ctx.now);
      if (ctx.arrival && (ts == null || (minute != null && Math.abs(ctx.now - (minute + 30000)) <= 90000))) {
        m.timestampAbs = ctx.now;
        m.tsSource = 'arrival';
      } else {
        m.timestampAbs = ts == null ? ctx.now : ts;
        // 重建後比擷取時間早超過 24 小時：日期是依順序推出來的（中間可能隔了好幾天）→ clock-ambiguous（面板「≈」加註日期可能不準）
        m.tsSource = ts == null ? 'capture' : (ctx.now - ts >= DAY_MS ? 'clock-ambiguous' : 'clock');
      }
      // 開播時間未定：offset 先存 null，開播後由 background 回填（F-14）。
      // T3.6：預定時間未到，或預定時間已過但尚未確認開播（startPending）→ pre（livePhase）
      m.videoOffsetSec = ctx.startedAt != null ? Math.round((m.timestampAbs - ctx.startedAt) / 100) / 10 : null;
      m.phase = livePhase(m.timestampAbs, ctx);
    }
    if (isDeletedEl(el)) { m.deleted = true; m.deletedAt = ctx.now; }
    // T3.5：歡迎／守則提示每次重新整理 id 都不同 → 同一場次以內容產生固定 id（只存一筆）
    if (tag === S.chat.viewerEngagement && ctx.videoId) m.id = C.viewerEngagementId(ctx.videoId, m.runs);
    // v45（T5.4，審查十一 21.3）頁面狀態提示（依元件標籤，不比對文字）：不參與 pre／live／post，檢視器顯示在最上方
    if (tag === S.chat.viewerEngagement) m.notice = true;
    return m;
  }

  // 直播收錄的 phase（F-14）：有開播時間 → 依時間；沒有 → 預定時間未到或等待開播確認 = pre，否則 live
  // v51（T6.2，審查十一 32.9）有預定時間、還沒確認開播 → 一律暫定 pre（不以預定時間推算 live）。
  // 實機：預定時間剛過、頁面 meta 下一次重讀（startPending）之前到的一則被判成 live，之後的又是 pre，分段來回跳。
  // 確認開播後由 background 依實際時間重算（pre → live）
  function livePhase(ts, ctx) {
    if (ctx.startedAt != null) return ts < ctx.startedAt ? 'pre' : (ctx.endedAt != null && ts > ctx.endedAt ? 'post' : 'live');
    return ctx.startPending || ctx.scheduledStartAt != null ? 'pre' : 'live';
  }
  // 降落橫幅（取不到 id）：同一場同一段文字視為同一則，id 以內容雜湊產生（SPEC 4.3 補救 id）
  // v47（T5.6，審查十一 26.1）phase 與其他訊息同一規則（v46 以前一律 live：待機室的降落被放進「直播中」段）
  function parseRaid(el, ctx, videoId) {
    const runs = textRuns(clean(el.textContent).slice(0, 300));
    if (!runs.length) return null;
    return { id: 'ytcas-raid-' + hash(videoId + '\u0001' + runs[0].text), type: T.RAID, authorHandle: '', authorChannelId: '',
      authorUrl: '', authorAvatar: '', authorBadges: [], runs, timestampAbs: ctx.now,
      videoOffsetSec: ctx.startedAt != null ? Math.round((ctx.now - ctx.startedAt) / 100) / 10 : null,
      phase: ctx.source === 'replay' ? 'live' : livePhase(ctx.now, ctx) };
  }

  // ---------------------------------------------------------------- F-20 結構探針（P7，同 docs/poc-clip-path.md 附錄 C／E）
  // 只輸出後代的標籤、id、屬性名稱（不含值）、img 網域、尺寸、「有沒有文字」；不輸出任何文字
  // 連結種類（不輸出網址本身）：handle（/@…）、channel（/channel/…）、redirect、watch、other、none
  function hrefKind(h) {
    if (h == null) return 'none';
    let u;
    try { u = new URL(h, 'https://www.youtube.com/'); } catch (_) { return 'invalid'; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return u.protocol.replace(':', '');
    if (!/(^|\.)youtube\.com$/i.test(u.hostname)) return 'external';
    if (/^\/@/.test(u.pathname)) return 'handle';
    if (/^\/channel\//.test(u.pathname)) return 'channel';
    if (u.pathname === S.chat.link.redirectPath) return 'redirect';
    if (u.pathname === '/watch') return 'watch';
    return u.pathname === '/' ? 'root' : 'other';
  }
  function structureOf(root, max) {
    max = max || 80;
    const out = [];
    const host = (u) => { try { return new URL(u, location.href).hostname; } catch (_) { return '(invalid)'; } };
    const walk = (el, depth) => {
      for (const c of el.children) {
        if (out.length >= max) return;
        let size = '';
        try { const r = c.getBoundingClientRect(); size = Math.round(r.width) + 'x' + Math.round(r.height); } catch (_) { /* ignore */ }
        out.push({ d: depth, tag: c.tagName.toLowerCase() + (c.id ? '#' + c.id : ''),
          attrs: c.getAttributeNames().filter((a) => a !== 'id' && a !== 'class' && a !== 'style' && !a.startsWith('data-ytcas')),
          img: c.tagName === 'IMG' ? host(c.getAttribute('src') || '') : undefined, size,
          hasText: Array.from(c.childNodes).some((n) => n.nodeType === 3 && n.nodeValue.trim()),
          // v45（T5.4，審查十一 20.4）不含文字的定位線索：自己的文字是否以 @ 開頭（handle 的位置）、連結指向的種類
          at: Array.from(c.childNodes).some((n) => n.nodeType === 3 && /^\s*@/.test(n.nodeValue)) || undefined,
          href: c.tagName === 'A' ? hrefKind(c.getAttribute('href')) : undefined });
        if (depth < 8) walk(c, depth + 1);
      }
    };
    walk(root, 1);
    return { tag: root.tagName.toLowerCase(), hasId: !!root.id, attrs: root.getAttributeNames().filter((a) => a !== 'id' && !a.startsWith('data-ytcas')), tree: out };
  }

  // ---------------------------------------------------------------- 引擎
  // opts: { doc, source: 'live'|'replay'|'popout', send(msg) → Promise<response>, isConnected() → bool,
  //         now?() → ms, onStatus?(status), log?: boolean }
  let liveObservers = 0;

  function createEngine(opts) {
    const doc = opts.doc || document;
    const now = opts.now || Date.now;
    const source = opts.source;
    const isConnected = opts.isConnected || (() => true);
    const st = {
      videoId: null, info: null, stream: {}, session: null,
      mode: 'pending', // pending（等場次資訊）／capturing／paused／disconnected／no-video-id／stopped
      items: null, banner: null,
      queue: [], unflushed: new Set(), sending: null, batchTimer: 0, trimTimer: 0, pollTimer: 0, statsTimer: 0,
      pinnedSent: new Set(), deletedReported: new Set(),
      pendingDeleted: [], waiters: [],
      pinShown: new Set(), pinMissing: new Map(), unpinned: new Set(), // v52（33.3）取消置頂偵測
      stats: { captured: 0, added: 0, merged: 0, unchanged: 0, fpMerged: 0, dropped: 0, rejected: 0, trimmed: 0, deleted: 0, deletedMissing: 0, pinned: 0,
        observedAdded: 0, backfillRuns: 0, backfillCaptured: 0, lateCaptured: 0, dupCaptured: 0, avatarLate: 0, avatarMissing: 0, stickerLate: 0, stickerMissing: 0, giftLate: 0, giftMissing: 0, scTotal: 0, scTextColors: 0,
        // v48（T5.7，28.3）時間來源、背景擷取
        itemsSwaps: 0, itemsStaleHeals: 0, ts_arrival: 0, ts_clock: 0, ts_capture: 0, hiddenCaptured: 0, hiddenBatches: 0, hiddenBulk: 0, hiddenBulkMsgs: 0, hiddenBatchMax: 0,
        // v50（T6.1，30.5）自己送出的訊息：看到暫時 id、替換配對（新節點／原地改 id／事後配對）、頁面移除已存節點（非修剪、非開頭）
        // v51（32.2）合併次數依規則分開計（replacedTemp／Removed／Swap、late、inPlaceMerged）；idChanges、idFromEmpty、pageRemoved 是事件次數
        ownTempSeen: 0, ownTempStored: 0, ownTempDropped: 0, ownReplacedTemp: 0, ownReplacedRemoved: 0, ownReplacedSwap: 0, ownInPlaceMerged: 0, ownLate: 0, idChanges: 0, idFromEmpty: 0, pageRemoved: 0,
        // v51（T6.2，32.7）時間解析在未來而往前推、重建後早於擷取超過 24 小時
        clockFuture: 0, clockAmbiguous: 0,
        // v52（T6.3，33.1）videoId 不一致（不換場次、暫停）的次數；降落當成結束訊號的次數
        videoMismatch: 0, raidEnd: 0, unpinned: 0 },
      seenIds: new Set(),
      // v50（30.5）最近 90 秒擷取的文字訊息（配對暫時節點 → 正式節點）：{ id, key, el, list, at, m, removedAt, head, trimmed, matched, reborn }
      recent: [], trimmedEls: new WeakSet(), ownRecent: [], // v51（32.2）最近 5 次合併的 id 形狀（P1 own.recent）
      observers: [], startSeq: 0, lastStatus: '', durationWait: 0,
      createdAt: Date.now(),
      p7: new Map(), // F-20 P7：reason:tag → 次數
      giftStructSent: 0, // v45（20.4）禮物結構（非記錄期間也送）
      f12: null, viewMode: null, // F-12 結果：null（未執行）／running／switched／already／failed:<原因>
    };

    // F-20：診斷探針回呼（content.js 只在記錄中轉送；這裡只組筆數、標籤、屬性名稱）
    const diag = (probe, kind, data) => { if (opts.onDiag) try { opts.onDiag(probe, kind, data); } catch (_) { /* ignore */ } };
    function probeStructure(reason, el) {
      if (!opts.onDiag || !el) return;
      const tag = el.tagName.toLowerCase();
      const k = reason + ':' + tag;
      const n = st.p7.get(k) || 0;
      if (n >= C.DIAG.P7_MAX_PER_TAG) return;
      st.p7.set(k, n + 1);
      diag('P7', 'structure', Object.assign({ reason }, structureOf(el)));
    }
    // v47（T5.6，審查十一 26.4）F-20 P7：SC 元件上實際有的 --yt-live-chat-paid-* 變數名稱（只有名稱，不含值）、
    // 本套件讀到的文字色欄位。同一類型每場最多 P7_MAX_PER_TAG 次。用來確認 selectors.js 的變數名稱
    function probeColorVars(el, m) {
      if (!opts.onDiag) return;
      const k = 'sc-colors:' + m.type;
      const n = st.p7.get(k) || 0;
      if (n >= C.DIAG.P7_MAX_PER_TAG) return;
      st.p7.set(k, n + 1);
      const names = [];
      try { for (let i = 0; i < el.style.length; i++) { const p = el.style[i]; if (p.startsWith(S.chat.paidColorVarPrefix)) names.push(p.slice(0, 80)); } } catch (_) { /* ignore */ }
      diag('P7', 'sc-color-vars', { type: m.type, inlineVars: names.slice(0, 30), got: m.textColors ? Object.keys(m.textColors) : [], hasBg: !!m.color });
    }
    // P2：#items 節點分類（標籤 × 已存／略過／未存）
    function itemsBreakdown() {
      const box = st.items;
      if (!box) return { total: null };
      const byTag = {};
      for (const el of box.children) {
        const t = el.tagName.toLowerCase();
        const b = byTag[t] || (byTag[t] = { saved: 0, skip: 0, unsaved: 0 });
        const v = el.dataset[SAVED];
        if (v === '1') b.saved++; else if (v === 'skip') b.skip++; else b.unsaved++;
      }
      return { total: box.children.length, byTag };
    }

    const setStatus = (mode, extra) => {
      st.mode = mode;
      const s = Object.assign({ videoId: st.videoId, capturing: mode === 'capturing', reason: mode === 'capturing' ? null : mode }, extra || {});
      const key = JSON.stringify(s);
      if (key === st.lastStatus) return;
      st.lastStatus = key;
      if (opts.onStatus) try { opts.onStatus(s); } catch (_) { /* ignore */ }
    };

    const ctxNow = () => ({ source, videoId: st.videoId, now: now(), startedAt: st.stream.startedAt ?? null, endedAt: st.stream.endedAt ?? null,
      scheduledStartAt: st.stream.scheduledStartAt ?? null, startPending: !!st.stream.startPending });

    // ------------------------------------------------ 送出（3.2：重試 0.5／1／2 秒；失敗留待下一批）
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    async function sendWithRetry(msg) {
      const delays = [500, 1000, 2000];
      for (let i = 0; ; i++) {
        if (!isConnected()) throw Object.assign(new Error('disconnected'), { disconnected: true });
        try {
          const r = await opts.send(msg);
          if (r && typeof r === 'object' && typeof r.ok === 'boolean') return r;
          throw new Error('no response');
        } catch (e) {
          if (e && e.disconnected) throw e;
          if (i >= delays.length) throw e;
          await sleep(delays[i]);
        }
      }
    }

    function disconnect() {
      if (st.mode === 'disconnected') return;
      st.queue.length = 0;
      st.unflushed.clear();
      clearTimeout(st.batchTimer);
      setStatus('disconnected');
      console.info('[ytcas] 擴充功能已重新載入，本頁停止收錄（DOM 修剪照常）；重新整理頁面即可恢復');
    }

    function enqueue(m) {
      st.queue.push(m);
      if (m.id) st.unflushed.add(m.id);
      if (st.queue.length > 2000) { // 3.2：上限 2000，丟棄最舊的
        const drop = st.queue.splice(0, st.queue.length - 2000);
        st.stats.dropped += drop.length;
        for (const d of drop) if (d.id) st.unflushed.delete(d.id);
      }
      if (st.queue.length >= C.BATCH_MAX) flush();
      else if (!st.batchTimer) st.batchTimer = setTimeout(() => { st.batchTimer = 0; flush(); }, C.BATCH_INTERVAL_MS);
    }

    // 單一送出流程：一次最多 200 則（含先前失敗留下的），直到佇列清空
    function flush() {
      clearTimeout(st.batchTimer); st.batchTimer = 0;
      if (st.sending) { st.sending.again = true; return st.sending.p; }
      if (!st.queue.length || st.mode !== 'capturing') return Promise.resolve();
      const job = { again: false };
      job.p = (async () => {
        while (st.queue.length && st.mode === 'capturing') {
          const batch = st.queue.splice(0, 200);
          let r;
          try {
            r = await sendWithRetry({ type: RT.SAVE_MESSAGES, videoId: st.videoId, stream: streamMeta(), messages: batch,
              captureSessionId: st.session && st.session.captureSessionId, source });
          } catch (e) {
            if (e && e.disconnected) { disconnect(); return; }
            st.queue.unshift(...batch); // 留待下一批一起送
            if (st.queue.length > 2000) { const d = st.queue.splice(0, st.queue.length - 2000); st.stats.dropped += d.length; for (const x of d) if (x.id) st.unflushed.delete(x.id); }
            if (!st.batchTimer) st.batchTimer = setTimeout(() => { st.batchTimer = 0; flush(); }, C.BATCH_INTERVAL_MS);
            return;
          }
          if (!r.ok) {
            if (r.error === 'paused') { pauseCapture(r.reason || 'paused'); return; }
            st.stats.rejected += batch.length; // ok:false 不重試（3.2）
          } else {
            for (const k of ['added', 'merged', 'unchanged', 'fpMerged']) st.stats[k] += r[k] || 0;
            // T3.6：background 重新抓取 meta 確認的開播／結束時間 → 之後的訊息以此計算 phase 與 offset
            const ch = adoptTimes(r.stream);
            if (ch.start) console.info('[ytcas] 採用 background 確認的開播時間', { videoId: st.videoId, source: st.stream.startedAtSource });
            if (ch.end) {
              console.info('[ytcas] 採用 background 確認的結束時間，之後的訊息標為結束後（post）', { videoId: st.videoId });
              probeStructure('stream-end', doc.querySelector(S.chat.renderer)); // F-20 P7：直播結束時的聊天室結構
            }
          }
          for (const m of batch) if (m.id) st.unflushed.delete(m.id);
          resolveWaiters();
          if (r.ok) await retryPendingDeleted();
        }
      })().finally(() => {
        st.sending = null;
        if (job.again && st.queue.length) flush();
      });
      st.sending = job;
      return job.p;
    }

    // 等某個 id 寫入完成（刪除通知先後順序，3.2 v29）
    function whenWritten(id) {
      if (!st.unflushed.has(id)) return Promise.resolve();
      return new Promise((res) => { st.waiters.push({ id, res }); flush(); });
    }
    function resolveWaiters() {
      st.waiters = st.waiters.filter((w) => { if (!st.unflushed.has(w.id)) { w.res(); return false; } return true; });
    }

    // ------------------------------------------------ 刪除（F-14）
    async function reportDeleted(id, deletedAt) {
      if (!id || st.deletedReported.has(id) || st.mode !== 'capturing') return;
      st.deletedReported.add(id);
      await whenWritten(id);
      try {
        const r = await sendWithRetry({ type: RT.MESSAGE_DELETED, videoId: st.videoId, id, deletedAt });
        if (r.ok && r.found) st.stats.deleted++;
        else if (r.ok) st.pendingDeleted.push({ id, deletedAt });
      } catch (e) { if (e && e.disconnected) disconnect(); }
    }
    async function retryPendingDeleted() {
      if (!st.pendingDeleted.length) return;
      const list = st.pendingDeleted.splice(0);
      for (const d of list) {
        try {
          const r = await sendWithRetry({ type: RT.MESSAGE_DELETED, videoId: st.videoId, id: d.id, deletedAt: d.deletedAt });
          if (r.ok && r.found) st.stats.deleted++; else st.stats.deletedMissing++; // 只重送一次
        } catch (e) { if (e && e.disconnected) { disconnect(); return; } }
      }
    }
    function checkDeleted(el) {
      if (el.dataset[SAVED] !== '1' || !el.id || st.deletedReported.has(el.id)) return;
      if (isDeletedEl(el)) reportDeleted(el.id, now());
    }

    // ------------------------------------------------ 擷取
    // how：observer／backfill／sweep（定時補掃）／trim（修剪前補擷取）／pending（等待期超過上限）
    // force：等待場次資訊期間（pending）也解析並排入佇列（收錄開始後才送出）
    // v51（T6.2，審查十一 32.7）回溯擷取（backlog）的日期重建：#items 依時間排列，從最新一則往回，
    // 每一則的時間不得晚於下一則（較新）→ 各節點的 ceil（parseClock 取不晚於 ceil 的那一天）。重播不需要（影片時間）
    function backlogCeils() {
      const map = new Map();
      if (!st.items || source === 'replay') return map;
      const t = now();
      let ceil = t + C.CLOCK_FUTURE_TOL_MS;
      const kids = st.items.children;
      for (let i = kids.length - 1; i >= 0; i--) {
        const el = kids[i];
        const tsText = clean((el.querySelector(S.chat.timestamp) || {}).textContent);
        const ci = tsText ? clockInfo(tsText, t, ceil) : null;
        if (!ci) continue;
        map.set(el, ceil);
        ceil = ci.ts + (ci.sec ? 999 : 59999);
      }
      return map;
    }
    // P7 ts-format：時間解析在未來（往前推）、重建後超過 24 小時、或解析失敗時，記 #timestamp 的形狀（不記原文）、
    // Date.now() 與時區名稱。每種原因每場最多 P7_MAX_PER_TAG 次
    function probeTs(reason, text) {
      if (!opts.onDiag) return;
      const k = 'ts:' + reason;
      const n = st.p7.get(k) || 0;
      if (n >= C.DIAG.P7_MAX_PER_TAG) return;
      st.p7.set(k, n + 1);
      let tz = '';
      try { tz = String(Intl.DateTimeFormat().resolvedOptions().timeZone || '').slice(0, 40); } catch (_) { /* ignore */ }
      diag('P7', 'ts-format', { reason, shape: clockShape(text), len: String(text || '').length, now: Date.now(), tzOffsetMin: new Date().getTimezoneOffset(), tz });
    }

    function captureNode(el, how, force, batch, ceil) {
      if (el.nodeType !== 1 || el.dataset[SAVED]) return;
      if (!st.items || el.parentElement !== st.items) return; // T3.4 防呆：只擷取 #items 的直接子節點
      if (st.mode !== 'capturing' && !(force && st.mode === 'pending')) return;
      // v48（T5.7，審查十一 28.3）分頁在背景（document.hidden）時，Chrome 節流讓聊天室更新成批到達：
      // 同一次回呼新增超過 ARRIVAL_HIDDEN_BATCH_MAX 則 → 到達時間不是發送時間，改用顯示時間（clock，只到分鐘）。
      // 背景時仍逐則插入（批次小）→ 照常用到達時間
      const hidden = !!doc.hidden;
      const bulk = hidden && how === 'observer' && (batch || 0) > C.ARRIVAL_HIDDEN_BATCH_MAX;
      let m = null;
      lastClock.info = null; lastClock.text = '';
      const cx = Object.assign(ctxNow(), { arrival: how === 'observer' && !bulk });
      if (typeof ceil === 'number') cx.clockCeil = ceil;
      try { m = parseMessage(el, cx); } catch (e) { console.info('[ytcas] 訊息解析失敗', el.tagName.toLowerCase(), String(e && e.message)); }
      if (!m) { el.dataset[SAVED] = 'skip'; return; }
      el.dataset[SAVED] = '1';
      // v51（32.7）P1 clockFuture：同一天的解讀在未來、往前推了的筆數；clockAmbiguous：重建後早於擷取超過 24 小時
      if (source !== 'replay' && m.tsSource !== 'arrival') {
        const ci = lastClock.info;
        if (ci && ci.futureShift) { st.stats.clockFuture++; probeTs('future', lastClock.text); }
        if (m.tsSource === 'clock-ambiguous') { st.stats.clockAmbiguous++; probeTs('ambiguous', lastClock.text); }
        if (!ci && lastClock.text) probeTs('unparsed', lastClock.text);
      }
      // v48（28.3）P1：時間來源分布、背景擷取筆數
      if (m.tsSource) st.stats['ts_' + m.tsSource] = (st.stats['ts_' + m.tsSource] || 0) + 1;
      if (hidden) st.stats.hiddenCaptured++;
      if (bulk) st.stats.hiddenBulkMsgs++;
      // F-20 P7：未知元件、禮物元件 → 結構紀錄（同一標籤每場最多 3 次）
      if (opts.onDiag && ((m.type === T.SYSTEM && m.rawTag && !KNOWN_SYSTEM_TAGS.has(m.rawTag)) || m.type === T.GIFT)) {
        probeStructure(m.type === T.GIFT ? 'gift' : 'unknown', el);
      }
      if (m.type === T.SUPERCHAT || m.type === T.SUPERSTICKER) { st.stats.scTotal++; if (m.textColors) st.stats.scTextColors++; probeColorVars(el, m); }
      // v45（T5.4，審查十一 20.4 第 1 點）非記錄期間也保留禮物結構（只有標籤、屬性名稱、img 網域、定位線索；不含文字）：
      // background 存在 chrome.storage.session 的最近 5 筆，診斷匯出時附上。每個引擎最多送 5 次
      if (m.type === T.GIFT && opts.onGiftStructure && st.giftStructSent < 5) {
        st.giftStructSent++;
        try { opts.onGiftStructure(Object.assign({ tag: el.tagName.toLowerCase(), authorSource: m.authorSource || (m.authorHandle || m.authorName ? 'dom' : 'none'),
          hasGiftImage: !!m.giftImage }, structureOf(el))); } catch (_) { /* ignore */ }
      }
      if (m.deleted && m.id) st.deletedReported.add(m.id);
      st.stats.captured++;
      if (how && how !== 'observer') st.stats[how === 'backfill' ? 'backfillCaptured' : 'lateCaptured']++;
      if (!m.authorAvatar && m.type !== T.SYSTEM) watchAvatar(el, m);
      if (m.type === T.SUPERSTICKER && !m.stickerSrc) watchSticker(el, m);
      // v46（24.3）禮物圖片也是延遲設定 src：同一套補送（giftLate／giftMissing）
      if (m.type === T.GIFT && !m.giftImage) watchImg(el, m, S.chat.gift.image, 'giftImage', 'giftLate', 'giftMissing');
      // 同一頁已擷取過的 id 再次出現（YouTube 重新插入節點）：只計數供診斷，去重由 background 負責
      if (m.id) {
        if (st.seenIds.has(m.id)) st.stats.dupCaptured++;
        else { if (st.seenIds.size > 20000) st.seenIds.clear(); st.seenIds.add(m.id); }
      }
      ownMatch(el, m, how);
      enqueue(m);
    }

    // ------------------------------------------------ v50（T6.1，審查十一 30.5）自己送出的訊息：暫時節點 → 正式節點
    // YouTube 先插入暫時節點（id 不同、到達時間＝送出時間），伺服器確認後換成正式節點。兩個都存 → 面板出現兩則。
    // 正式節點出現時，找最近 90 秒內同作者同內容、尚未配對、而且「看得出是暫時節點」的那一筆：
    //   暫時 id（S.isTempChatId）、或被頁面移除（不是本套件修剪、不是列表開頭）、或所在的 #items 已被換掉且沒有以同 id 重新出現。
    // 配對到 → 正式節點沿用暫時節點的時間（到達時間、offset、phase），帶 replacesId 讓 background 合併成一筆（以正式 id 為主）。
    // 同一個人連續送出相同內容：兩個節點都還在頁面上、也都不是暫時 id → 不配對（不同訊息不可合併）
    // v51（T6.2，審查十一 31.1、32.2）規則與統計：
    //   - 暫時 id（S.isTempChatId：`C` 開頭、≤ 31 字、不是 `ChwK`，實機 `CM_E…|28`、`CITy…|27`）→ 配對（replacedTemp）。
    //   - 頁面移除：只在「舊節點被移除後 OWN_REMOVE_WINDOW_MS（10 秒）內出現新節點」才算（replacedRemoved）；
    //     舊節點又被插回頁面（YouTube 重新排版）→ 取消「被移除」。洗版的同一人兩次「777」不會配對（都還在頁面上，或相隔超過 10 秒）。
    //   - 列表被換掉且沒有以同 id 重新出現 → 配對（replacedSwap）。
    //   - id 原地改變：**同作者同內容才合併**（inPlaceMerged）；不同作者或內容（節點被重複利用）→ 當成新的一則，不合併。
    //   - P1 的 idChanges、pageRemoved 是「觀察到的事件次數」，不是合併次數；合併次數是 replaced*、late、inPlaceMerged
    const isTemp = (id) => S.isTempChatId(id);
    const idShape = (id) => ({ p: String(id || '').slice(0, 4), len: String(id || '').length }); // 只有前 4 碼與長度（不含內容）
    const OWN_REMOVE_WINDOW_MS = 10 * 1000;
    const OWN_P7_MAX = 30; // P7 own-replace：合併一定記（每場上限 30 筆），不受 P7_MAX_PER_TAG 限制
    // v52（T6.3，審查十一 33.6）暫時節點＝暫時 id 形狀＋文字＋到達時間（擷取端只看直播，重播在 ownMatch 就排除），配對限 30 秒
    const OWN_TEMP_WINDOW_MS = 30 * 1000;
    const isTempEntry = (e) => isTemp(e.id) && e.m && e.m.type === T.TEXT && e.m.tsSource === 'arrival';
    function pruneRecent() {
      const t = now() - C.OWN_REPLACE_WINDOW_MS;
      while (st.recent.length && (st.recent[0].at < t || st.recent.length > 400)) {
        const e = st.recent.shift();
        if (isTempEntry(e) && !e.matched) st.stats.ownTempDropped++; // v52（33.8.3）暫時節點 90 秒內沒等到正式節點（兩筆都留著）
      }
    }
    // 看得出是暫時節點的依據：'temp'／'removed'／'swap'；看不出 → ''
    function tempRule(e) {
      if (isTempEntry(e)) return now() - e.at <= OWN_TEMP_WINDOW_MS ? 'temp' : '';
      if (e.removedAt != null) return !e.trimmed && !e.head && now() - e.removedAt <= OWN_REMOVE_WINDOW_MS ? 'removed' : '';
      return !e.el.isConnected && e.list !== st.items && !e.reborn && !e.trimmed ? 'swap' : '';
    }
    function ownAdopt(m, e) {
      m.timestampAbs = e.m.timestampAbs;
      if (e.m.tsSource) m.tsSource = e.m.tsSource; else delete m.tsSource;
      m.videoOffsetSec = e.m.videoOffsetSec;
      m.phase = e.m.phase;
      if (e.id) m.replacesId = e.id;
      else m.replacesFallback = { type: e.m.type, authorHandle: e.m.authorHandle || '', authorChannelId: e.m.authorChannelId || '', runs: e.m.runs || [], timestampAbs: e.m.timestampAbs };
    }
    function probeOwn(kind, e, el, m, extra) {
      const rec = Object.assign({ kind, oldId: e ? idShape(e.id) : null, newId: m ? idShape(m.id) : null, dtMs: e ? now() - e.at : null }, extra || {});
      if (kind !== 'temp-seen') { st.ownRecent.push(rec); if (st.ownRecent.length > 5) st.ownRecent.shift(); } // P1 own.recent：記錄開始前的合併也看得到
      if (!opts.onDiag) return;
      const n = st.p7.get('own') || 0;
      if (n >= OWN_P7_MAX) return;
      st.p7.set('own', n + 1);
      const attrs = (x) => (x && x.getAttributeNames ? x.getAttributeNames().filter((a) => a !== 'id' && !a.startsWith('data-ytcas')).slice(0, 20) : []);
      diag('P7', 'own-replace', Object.assign({}, rec, { oldRemoved: !!(e && e.removedAt != null), oldHead: !!(e && e.head), oldTempId: !!(e && isTemp(e.id)),
        sameEl: !!(e && el && e.el === el), oldAttrs: e ? attrs(e.el) : [], newAttrs: attrs(el) }));
    }
    function remember(el, m, key) {
      if (!st.recent.some((e) => e.id === m.id && e.el === el)) st.recent.push({ id: m.id, key, el, list: st.items, at: now(), m: Object.assign({}, m), removedAt: null, head: false, trimmed: false, matched: !!(m.replacesId || m.replacesFallback), reborn: false });
    }
    function ownMatch(el, m, how) {
      if (source === 'replay') return;
      const key = C.ownKey(m);
      if (!key) return;
      pruneRecent();
      // 同 id 重新出現（列表被換掉後的新節點）：舊紀錄改指向新節點，不再當成暫時節點
      for (const e of st.recent) if (m.id && e.id === m.id) { e.reborn = true; e.el = el; e.list = st.items; e.removedAt = null; }
      if (isTemp(m.id)) {
        st.stats.ownTempSeen++;
        // v52（33.8.3）暫時節點本身照常存（之後正式節點出現時合併成一筆）：tempStored
        if (m.tsSource === 'arrival') st.stats.ownTempStored++;
        if (!st.recent.some((e) => e.id === m.id)) probeOwn('temp-seen', null, el, m, { how, tsSource: m.tsSource || null });
      } else {
        let rule = '';
        const e = st.recent.find((x) => x.key === key && !x.matched && x.id !== m.id && (rule = tempRule(x)));
        if (e) {
          ownAdopt(m, e);
          e.matched = true;
          st.stats[rule === 'temp' ? 'ownReplacedTemp' : rule === 'removed' ? 'ownReplacedRemoved' : 'ownReplacedSwap']++;
          probeOwn('new-node', e, el, m, { how, rule });
        }
      }
      remember(el, m, key);
    }
    // 已存的節點又被插回頁面（YouTube 重新排版）→ 不再當成「被移除」
    function onReadded(n) {
      for (const e of st.recent) if (e.el === n) e.removedAt = null;
    }
    // 頁面移除了已存的節點（不是本套件修剪）。之前已擷取、同作者同內容、仍在頁面上、沒配對過的正式節點 → 事後配對（暫時節點晚於正式節點才移除）。
    // 事後配對只限暫時 id，或正式節點在移除前 OWN_REMOVE_WINDOW_MS 內才出現
    function onRemoved(n, prev) {
      const e = st.recent.find((x) => x.el === n && x.id === n.id);
      if (!e) return;
      if (st.trimmedEls.has(n)) { e.trimmed = true; return; }
      let p = prev;
      while (p && p.nodeType !== 1) p = p.previousSibling;
      e.removedAt = now();
      e.head = !p;
      st.stats.pageRemoved++;
      if (e.head || e.matched || st.mode !== 'capturing') return;
      const t = now();
      const later = st.recent.find((x) => x !== e && x.key === e.key && !x.matched && !isTemp(x.id) && x.at >= e.at && x.el.isConnected && x.id !== e.id
        && ((isTempEntry(e) && t - e.at <= OWN_TEMP_WINDOW_MS) || t - x.at <= OWN_REMOVE_WINDOW_MS));
      if (!later) return;
      e.matched = true; later.matched = true;
      const fix = Object.assign({}, later.m);
      ownAdopt(fix, e);
      later.m = fix;
      st.stats.ownLate++;
      probeOwn('late', e, later.el, fix, { rule: isTempEntry(e) ? 'temp' : 'removed' });
      enqueue(fix);
    }
    // 同一個節點的 id 原地改變：重新解析。**同作者同內容**（最近 90 秒內擷取過）才帶 replacesId 合併；
    // 不同作者或內容（YouTube 重複利用節點顯示別則訊息）→ 當成新的一則，不合併
    function onIdChanged(el, oldId) {
      if (!el.id || el.id === oldId || el.dataset[SAVED] !== '1' || st.mode !== 'capturing') return;
      st.stats.idChanges++;
      if (!oldId) st.stats.idFromEmpty++;
      let m = null;
      try { m = parseMessage(el, ctxNow()); } catch (_) { /* ignore */ }
      if (!m) return;
      // v52（T6.3，33.8.3）id 先被清空再設成新值（實機 idFromEmpty＝每則即時訊息都有）：oldId 是空的 → 以節點找最近一次的紀錄。
      // v51 以 id '' 找，暫時節點「暫時 id → 空 → 正式 id」時找不到 → 不合併，兩筆都存
      const e = oldId ? st.recent.find((x) => x.el === el && x.id === oldId) : st.recent.slice().reverse().find((x) => x.el === el);
      if (e && e.id === el.id) { if (m.id) st.seenIds.add(m.id); return; } // 清空後設回同一個 id：同一則，不必重送
      const key = C.ownKey(m);
      if (e && (key ? key === e.key : C.ownKey(e.m) === '' && JSON.stringify(e.m.runs || []) === JSON.stringify(m.runs || []) && (e.m.authorHandle || '') === (m.authorHandle || ''))) {
        ownAdopt(m, e);
        m.replaceInPlace = true;
        e.matched = true; e.id = m.id; e.m = Object.assign({}, m);
        st.stats.ownInPlaceMerged++;
        probeOwn('in-place', e, el, m, { rule: 'same-node', fromEmpty: !oldId });
      } else if (key) remember(el, m, key);
      if (m.id) st.seenIds.add(m.id);
      enqueue(m);
    }

    // T5.1（審查十一第 10 節）頭像延遲載入：擷取當下 yt-img-shadow 的 img 還沒有 https 的 src（空的或 data: 佔位圖）。
    // 監看該 img 的 src 最多 10 秒，取得 https 網址就送出同一則訊息的補充（background 依 F-14「只補空欄位」合併）。
    // 節點在這之前被修剪或逾時就放棄；同時監看的數量有上限
    const AVATAR_WAIT_MS = 10000, AVATAR_MAX_WATCH = 60;
    let avatarWatch = 0;
    // v44（17.2）貼圖（stickerSrc）也走同一套延遲載入補送，統計 stickerLate／stickerMissing
    function watchAvatar(el, m) { watchImg(el, m, S.chat.author.photo, 'authorAvatar', 'avatarLate', 'avatarMissing'); }
    function watchSticker(el, m) { watchImg(el, m, S.chat.stickerImg, 'stickerSrc', 'stickerLate', 'stickerMissing'); }
    function watchImg(el, m, sel, field, lateKey, missKey) {
      const img = el.querySelector(sel);
      if (!img || avatarWatch >= AVATAR_MAX_WATCH || typeof MutationObserver === 'undefined') return;
      avatarWatch++;
      const vid = st.videoId; // 擷取時的場次（訊息物件本身不一定帶 videoId）
      let done = false;
      const finish = () => { if (done) return; done = true; avatarWatch--; mo.disconnect(); clearTimeout(timer); };
      const check = () => {
        if (done) return;
        const u = imgUrl(img);
        if (!u) return;
        finish();
        if (!el.isConnected || st.mode !== 'capturing' || vid !== st.videoId) return;
        st.stats[lateKey]++;
        enqueue(Object.assign({}, m, { [field]: u }));
      };
      const mo = new MutationObserver(check);
      mo.observe(img, { attributes: true, attributeFilter: ['src'] });
      const timer = setTimeout(() => { if (!done) { st.stats[missKey]++; finish(); } }, AVATAR_WAIT_MS);
      check();
    }

    // v52（T6.3，審查十一 33.3 第 1 點）取消置頂：之前在置頂列的那則消失（或換成別則）超過 UNPIN_GRACE_MS → UNPIN。
    // YouTube 重新渲染置頂列時會短暫移除再加回（可能換 id）：3 秒內又出現就不算。原生置頂列被隱藏（30.2 選 A）不影響（只看 DOM）
    const UNPIN_GRACE_MS = 3000;
    function checkUnpinned(cur) {
      const t = now();
      for (const id of cur) { st.pinMissing.delete(id); st.pinShown.add(id); }
      for (const id of Array.from(st.pinShown)) {
        if (cur.has(id)) continue;
        if (!st.pinMissing.has(id)) { st.pinMissing.set(id, t); continue; }
        if (t - st.pinMissing.get(id) < UNPIN_GRACE_MS) continue;
        st.pinShown.delete(id); st.pinMissing.delete(id);
        st.unpinned.add(id);
        st.stats.unpinned++;
        sendWithRetry({ type: RT.UNPIN, videoId: st.videoId, id, unpinnedAt: t - UNPIN_GRACE_MS, source }).catch((e) => { if (e && e.disconnected) disconnect(); });
      }
    }
    function capturePinned() {
      if (st.mode !== 'capturing') return;
      const cur = new Set();
      if (st.banner) st.banner.querySelectorAll(S.chat.bannerPinnedMessage).forEach((el) => { if (el.id) cur.add(el.id); });
      // 取消後又置頂（同一個 id 再出現）→ 重新送 SAVE_PINNED（background 清掉 unpinnedAt）
      for (const id of cur) if (st.unpinned.has(id)) { st.unpinned.delete(id); st.pinnedSent.delete(id); }
      checkUnpinned(cur);
      if (!st.banner) return;
      st.banner.querySelectorAll(S.chat.bannerPinnedMessage).forEach((el) => {
        if (!el.id || st.pinnedSent.has(el.id)) return;
        let m;
        try { m = parseMessage(el, ctxNow()); } catch (_) { return; }
        if (!m) return;
        st.pinnedSent.add(el.id);
        m.pinnedAt = now();
        st.stats.pinned++;
        sendWithRetry({ type: RT.SAVE_PINNED, videoId: st.videoId, message: m, source })
          .catch((e) => { if (e && e.disconnected) disconnect(); else st.pinnedSent.delete(el.id); });
      });
      st.banner.querySelectorAll(S.chat.bannerRedirect).forEach((el) => {
        if (el.dataset[SAVED]) return;
        probeStructure('raid', el); // F-20 P7：降落橫幅結構（待實機確認的元件）
        const m = parseRaid(el, ctxNow(), st.videoId);
        el.dataset[SAVED] = m ? '1' : 'skip';
        if (m) { st.stats.captured++; enqueue(m); }
        // v52（T6.3，審查十一 33.1 第 4 點）降落橫幅（yt-live-chat-banner-redirect-renderer，實機已驗證）＝原直播結束：
        // 以降落時間暫定結束時間（endedAtSource 'raid'），之後的訊息標 post；background 照常重新抓取，meta 的 endDate 覆蓋
        if (m && source !== 'replay' && st.stream.startedAt != null && st.stream.endedAt == null) {
          if (adoptTimes({ endedAt: now(), endedAtSource: 'raid' }).end) {
            st.stats.raidEnd++;
            st.raidAt = now();
            console.info('[ytcas] 降落：暫以降落時間為結束時間，之後的訊息標為結束後（post）', { videoId: st.videoId });
            if (opts.onRaid) try { opts.onRaid({ videoId: st.videoId, at: st.raidAt }); } catch (_) { /* ignore */ }
          }
        }
      });
    }

    // ------------------------------------------------ 修剪（F-01：數量觸發為主、計時器保底）
    // T3.3（審查十追加）：一律從最舊的節點移除，不得跳過未擷取的舊節點去移除較新的節點
    //（v29 的「只移除已標記節點」會在列表開頭有一批未標記節點時卡住：新訊息一標記就被移除、舊節點永遠留著）。
    //   收錄中：最舊節點未擷取 → 先擷取（標記）再移除；解析失敗標 skip 後移除。
    //   暫停、無 videoId、失去連線、已停止：不擷取，直接移除最舊的。
    //   等待場次資訊（pending）：保留未擷取節點以便回溯擷取，但超過 PENDING_MAX 時先解析排入佇列再移除最舊的。
    const PENDING_MAX = 200;
    function trim() {
      const box = st.items;
      if (!box) return;
      const freeAll = st.mode === 'paused' || st.mode === 'disconnected' || st.mode === 'no-video-id' || st.mode === 'stopped';
      const pending = st.mode === 'pending';
      const limit = pending ? PENDING_MAX : C.DOM_MAX_MESSAGES;
      let over = box.children.length - limit;
      let ceils = null; // v51（32.7）需要補擷取時才計算（依順序重建日期）
      while (over > 0) {
        const el = box.firstElementChild;
        if (!el) break;
        if (!el.dataset[SAVED] && !freeAll) {
          if (!ceils) ceils = backlogCeils();
          captureNode(el, pending ? 'pending' : 'trim', pending, 0, ceils.get(el));
          if (!el.dataset[SAVED]) break; // 仍無法擷取（理論上不會發生）：寧可不修剪也不遺失
        }
        if (st.mode === 'capturing') checkDeleted(el);
        st.trimmedEls.add(el); // v50（30.5）本套件修剪的節點不是「被頁面替換」
        el.remove();
        over--;
        st.stats.trimmed++;
      }
    }

    // v48（T5.7，審查十一 28.3）這次回呼新增到 #items 的訊息數（背景分頁「一批到達」的判斷與統計）
    function onItemsMutation(records) {
      let batch = 0;
      for (const r of records) if (r.type === 'childList' && r.target === st.items) for (const n of r.addedNodes) if (n.nodeType === 1) batch++;
      if (batch && doc.hidden) {
        st.stats.hiddenBatches++;
        if (batch > C.ARRIVAL_HIDDEN_BATCH_MAX) st.stats.hiddenBulk++;
        if (batch > st.stats.hiddenBatchMax) st.stats.hiddenBatchMax = batch;
      }
      // v50（30.5）先處理移除（暫時節點與正式節點可能在同一次回呼內一刪一增），再處理新增
      if (st.recent.length) {
        for (const r of records) {
          if (r.type !== 'childList' || r.target !== st.items) continue;
          r.removedNodes.forEach((n) => { if (n.nodeType === 1 && n.dataset[SAVED] === '1') onRemoved(n, r.previousSibling); });
        }
      }
      for (const r of records) {
        // T3.4：observer 為了刪除偵測帶 subtree，childList 也會回報訊息內部的後代（徽章、圖示、span…）；
        // 只有 #items 的直接子節點才是訊息
        if (r.type === 'childList') {
          if (r.target !== st.items) continue;
          st.stats.observedAdded += r.addedNodes.length;
          r.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.dataset[SAVED] === '1') onReadded(n); else captureNode(n, 'observer', false, batch); });
        }
        else if (r.type === 'attributes' && r.attributeName === 'id') {
          if (r.target.parentElement === st.items) onIdChanged(r.target, r.oldValue);
        }
        else if (r.type === 'attributes' && st.mode === 'capturing') {
          const el = r.target.closest && r.target.closest('[data-ytcas-saved="1"]');
          if (el && st.items && el.parentElement === st.items) checkDeleted(el);
        }
      }
      trim();
    }

    function observe(target, fn, options) {
      const mo = new MutationObserver(fn);
      mo.observe(target, options);
      st.observers.push(mo);
      liveObservers++;
      return mo;
    }
    function disconnectObservers() {
      for (const mo of st.observers) { mo.disconnect(); liveObservers--; }
      st.observers.length = 0;
    }

    // 找 #items 與置頂列；YouTube 重建時重新掛上
    function attach() {
      const items = doc.querySelector(S.chat.items);
      const banner = doc.querySelector(S.chat.bannerContainer);
      if (items === st.items && banner === st.banner && (items || st.items === null)) return !!items;
      disconnectObservers();
      st.items = items;
      st.banner = banner;
      if (!items) return false;
      // v50（30.5）id 屬性：自己送出的訊息若原地換成正式 id（attributeOldValue 取舊 id）
      const attrs = ['id'].concat(S.chat.deleted.attr ? [S.chat.deleted.attr] : []);
      observe(items, onItemsMutation, { childList: true, attributes: true, subtree: true, attributeFilter: attrs, attributeOldValue: true });
      if (banner) observe(banner, () => capturePinned(), { childList: true, subtree: true });
      // F-01 AC：切換影片後不得累加。每個聊天室最多 2 個（訊息列表＋置頂列）
      console.info('[ytcas] 擷取 observer 已掛上（本頁共 ' + liveObservers + ' 個；每個聊天室最多 2 個）', { source });
      return true;
    }

    // 回溯擷取（F-02 v28）：#items 內既有訊息全部擷取一次（重複由 id 去重）。
    // T3.3：先確認 st.items 就是目前的 #items（YouTube 可能整個換掉列表元素），不是就重新掛上。
    // how：backfill（開始收錄、重新掛上、F-12 切換後）／sweep（定時補掃：observer 漏掉的節點）
    function backfill(how) {
      if (st.items !== doc.querySelector(S.chat.items) || (st.items && !st.items.isConnected)) attach();
      if (!st.items) return;
      if ((how || 'backfill') === 'backfill') st.stats.backfillRuns++;
      const ceils = backlogCeils(); // v51（32.7）依順序重建日期
      Array.from(st.items.children).forEach((el) => captureNode(el, how || 'backfill', false, 0, ceils.get(el)));
      capturePinned();
      trim();
      if ((how || 'backfill') === 'backfill') flush(); // 等待期排入佇列的訊息（pending）在收錄開始後立即送出
    }

    function streamMeta() {
      const i = st.info || {};
      const m = { isLive: source !== 'replay' };
      for (const k of ['title', 'channelName', 'channelHandle', 'channelUrl']) if (i[k]) m[k] = i[k];
      for (const k of ['startedAt', 'startedAtSource', 'endedAt', 'endedAtSource', 'scheduledStartAt']) if (st.stream[k] != null) m[k] = st.stream[k];
      if (st.stream.startPending) m.startPending = true;
      if (typeof st.stream.scheduledFuture === 'boolean') m.scheduledFuture = st.stream.scheduledFuture; // v47（26.1）
      return m;
    }

    // 場次資訊 → 開播／結束時間與來源（T3.6：C.deriveStartTimes 與 background 共用；預定時間已過但未確認開播 = startPending）
    function deriveTimes(info) {
      return C.deriveStartTimes({ startDate: info.startDate, endDate: info.endDate, knownScheduled: st.stream.scheduledStartAt ?? null, now: now() });
    }

    // T3.6：依來源等級採用開播／結束時間（C.START_SOURCE_RANK）。來源：STREAM_INFO、CAPTURE_START／SAVE_MESSAGES 的回應、
    // 播放器訊號。等級較高者覆蓋較低者；預定時間（scheduled）不得寫入 startedAt。回傳是否有變動
    // v47（T5.6，審查十一 26.1）頁面 meta 說預定開播時間在未來（scheduledFuture）→ 待機室：預定時間以最新的為準、
    // 已採用的開播時間（重播以外）清除，之後也不採用（background 回傳的、播放器訊號都一樣）；降落、會員、禮物等事件從來不是開播訊號
    function adoptTimes(t) {
      if (!t) return { start: false, end: false };
      const out = { start: false, end: false };
      // v48（T5.7，審查十一 27 第 1 點）background 重新抓取確認正在直播（提早開播）→ 本分頁沒重新整理的舊 meta 說「在未來」不再當成待機室
      if (typeof t.liveConfirmedAt === 'number' && !st.stream.liveConfirmedAt) { st.stream.liveConfirmedAt = t.liveConfirmedAt; st.stream.scheduledFuture = false; }
      if (t.scheduledFuture === true && typeof t.scheduledStartAt === 'number' && !st.stream.liveConfirmedAt) {
        st.stream.scheduledStartAt = t.scheduledStartAt;
        st.stream.scheduledFuture = true;
        if (st.stream.startedAt != null && st.stream.startedAtSource !== 'replay' && st.stream.endedAt == null) {
          console.info('[ytcas] 待機室（預定開播時間在未來）：不採用已記錄的開播時間', { videoId: st.videoId, source: st.stream.startedAtSource || null });
          st.stream.startedAt = null; st.stream.startedAtSource = null; out.start = true;
        }
      } else if (t.scheduledFuture === false) st.stream.scheduledFuture = false;
      const future = C.isFutureScheduled(st.stream, now());
      for (const [k, flag] of [['startedAt', 'start'], ['endedAt', 'end']]) {
        const v = typeof t[k] === 'number' ? t[k] : null;
        const src = t[k + 'Source'] || null;
        if (v == null || src === 'scheduled') continue;
        if (k === 'startedAt' && future && src !== 'replay') continue;
        const cur = st.stream[k] == null ? -1 : C.startRank(st.stream[k + 'Source']);
        if (C.startRank(src) > cur && st.stream[k] !== v) { st.stream[k] = v; st.stream[k + 'Source'] = src; out[flag] = true; }
      }
      if (st.stream.scheduledStartAt == null && typeof t.scheduledStartAt === 'number') st.stream.scheduledStartAt = t.scheduledStartAt;
      st.stream.startPending = st.stream.startedAt == null && !future && !!(t.startPending || st.stream.startPending);
      return out;
    }

    async function beginCapture() {
      const seq = ++st.startSeq;
      if (!isConnected()) { disconnect(); return; }
      let r;
      try {
        r = await sendWithRetry({ type: RT.CAPTURE_START, videoId: st.videoId, source,
          duration: st.info && typeof st.info.duration === 'number' ? st.info.duration : null, stream: streamMeta() });
      } catch (e) {
        if (e && e.disconnected) { disconnect(); return; }
        console.info('[ytcas] 無法開始收錄（background 無回應），5 秒後重試'); // 暫時性，會自動重試：info
        setTimeout(() => { if (seq === st.startSeq && st.mode === 'pending') beginCapture(); }, 5000);
        return;
      }
      if (seq !== st.startSeq) return; // 期間 videoId 已改變
      if (!r.ok) { console.warn('[ytcas] 無法開始收錄', r.error); setStatus('paused', { reason: 'error' }); return; }
      if (!r.allowed) { pauseCapture(r.reason || 'paused'); return; }
      st.session = { captureSessionId: r.captureSessionId, versionId: r.versionId };
      // background 已知的開播／結束時間（彈出視窗由 FETCH_STREAM_META 補齊）
      if (r.stream) adoptTimes(r.stream);
      setStatus('capturing');
      backfill('backfill');
      if (!st.f12) autoLiveMode(); // F-12（v30）：開始收錄時切到「即時聊天室」，同一頁只做一次
    }

    // ------------------------------------------------ F-12 自動切換「即時聊天室」
    // 只依位置與 aria-selected（第 1 項 = 重點、第 2 項 = 即時），不依文字。先直接點；沒切成再「展開選單 → 點」；
    // 仍失敗就 warnOnce 放棄，不重試。選單可能比 #items 晚出現：最多等 F12_MENU_WAIT_MS。
    const F12_STEP_MS = 300;
    const F12_MENU_WAIT_MS = 5000;
    const viewItems = () => Array.from(doc.querySelectorAll(S.chat.viewSelector.items));
    const sel = (a) => !!a && a.getAttribute('aria-selected') === 'true';
    function viewMode() {
      const it = viewItems();
      if (it.length < 2) return 'unknown';
      return sel(it[1]) ? 'live' : (sel(it[0]) ? 'top' : 'unknown');
    }
    async function autoLiveMode() {
      st.f12 = 'running';
      const done = (r) => {
        st.f12 = r;
        st.viewMode = viewMode();
        // 聊天室已載入卻切不過去會影響存檔完整：warn；沒有選單（例如部分重播頁）屬可接受：info
        if (r.startsWith('failed')) S.warnOnce('F-12:' + r, '無法自動切換到「即時聊天室」', r === 'failed:no-menu' ? 'info' : 'warn');
        if (opts.onF12) try { opts.onF12({ f12: r, viewMode: st.viewMode }); } catch (_) { /* ignore */ }
        // T3.3：切換後 YouTube 會重新渲染列表（可能整個換掉 #items）→ 稍後再回溯擷取一次
        if (r === 'switched') setTimeout(() => { if (st.mode === 'capturing') backfill('backfill'); }, 500);
      };
      const t0 = Date.now();
      while (viewItems().length < 2) {
        if (st.mode !== 'capturing') { st.f12 = null; return; }
        if (Date.now() - t0 > F12_MENU_WAIT_MS) return done('failed:no-menu');
        await sleep(250);
      }
      if (st.mode !== 'capturing') { st.f12 = null; return; } // 暫停中不切換
      let it = viewItems();
      if (sel(it[1])) return done('already');
      if (!sel(it[0])) return done('failed:unknown-state');
      it[1].click();
      await sleep(F12_STEP_MS);
      if (sel(viewItems()[1])) return done('switched');
      const trig = doc.querySelector(S.chat.viewSelector.trigger);
      if (!trig) return done('failed:no-trigger');
      trig.click();
      await sleep(F12_STEP_MS);
      it = viewItems();
      if (it[1]) it[1].click();
      await sleep(F12_STEP_MS);
      return done(sel(viewItems()[1]) ? 'switched' : 'failed:not-selected');
    }

    function pauseCapture(reason) {
      st.queue.length = 0;
      st.unflushed.clear();
      resolveWaiters();
      st.session = null;
      setStatus('paused', { reason: 'paused', policy: reason });
      trim();
    }

    function endSession() {
      const s = st.session;
      st.session = null;
      if (s && isConnected()) {
        try { const p = opts.send({ type: RT.CAPTURE_END, captureSessionId: s.captureSessionId, endedAt: now(), source }); if (p && p.catch) p.catch(() => {}); } catch (_) { /* ignore */ }
      }
    }

    function logStats(final) {
      const s = st.stats;
      if (!s.captured && !final && !opts.onDiag) return; // 沒有收錄時不輸出 Console；診斷記錄中仍記錄（暫停、等待等狀態也要看得到）
      // 只記筆數（id 一致性驗證：重播時 idMerged ≫ fpMerged 代表直播與重播的訊息 id 相同）
      // T3.3 診斷：itemsIsCurrent（st.items 是否為目前的 #items 且仍在頁面上）、unmarkedNodes（#items 內未擷取數）、
      // observedAdded（這一分鐘 observer 看到的新增節點）、backfillRuns、backfillCaptured（回溯擷取到的）、
      // lateCaptured（定時補掃或修剪前才擷取到的 = observer 漏掉的）、dupCaptured（同頁同 id 再次出現 = YouTube 重新插入）
      const box = st.items;
      const cur = doc.querySelector(S.chat.items);
      const obj = { videoId: st.videoId, source, mode: st.mode, captured: s.captured,
        added: s.added, idMerged: s.merged + s.unchanged - s.fpMerged, fpMerged: s.fpMerged, dropped: s.dropped, rejected: s.rejected,
        trimmed: s.trimmed, pinned: s.pinned, deleted: s.deleted, deletedMissing: s.deletedMissing,
        domNodes: box ? box.children.length : null,
        itemsIsCurrent: !!box && box === cur && box.isConnected,
        itemsCount: doc.querySelectorAll(S.chat.anyItems).length,
        unmarkedNodes: box ? Array.from(box.children).filter((el) => !el.dataset[SAVED]).length : null,
        observedAdded: s.observedAdded, backfillRuns: s.backfillRuns, backfillCaptured: s.backfillCaptured,
        lateCaptured: s.lateCaptured, dupCaptured: s.dupCaptured, f12: st.f12,
        scTotal: s.scTotal, scTextColors: s.scTextColors, // v47（26.4）SC 中取得 YouTube 文字色的筆數
        // v48（T5.7，28.3、28.4）時間來源分布（arrival＝到達時間、clock＝顯示的分鐘、capture＝讀不到時間）、
        // 背景（document.hidden）擷取筆數、背景回呼數／一批超過門檻的回呼數與訊息數／最大批次、禮物圖片延遲補送成功／放棄
        tsSource: { arrival: s.ts_arrival, clock: s.ts_clock, capture: s.ts_capture, ambiguous: s['ts_clock-ambiguous'] || 0 },
        // v51（T6.2，32.7）clockFuture＝顯示時間以「今天」解讀會在未來、往前推了的筆數（回溯擷取的前幾天訊息）；
        // clockAmbiguous＝依順序重建後早於擷取超過 24 小時（日期可能不準）
        clockFuture: s.clockFuture, clockAmbiguous: s.clockAmbiguous,
        hidden: { captured: s.hiddenCaptured, batches: s.hiddenBatches, bulk: s.hiddenBulk, bulkMsgs: s.hiddenBulkMsgs, batchMax: s.hiddenBatchMax },
        giftLate: s.giftLate, giftMissing: s.giftMissing,
        // v48（28.1）itemsSwaps：YouTube 換掉 #items 的次數（重新掛上並回溯擷取）；itemsStaleHeals：統計當下發現沒掛在目前列表、立即重新掛上的次數
        itemsSwaps: s.itemsSwaps, itemsStaleHeals: s.itemsStaleHeals,
        // v50（T6.1，30.5）自己送出的訊息：tempSeen＝看到暫時 id、replaced＝新節點配對、inPlace＝原地改 id、late＝事後配對、
        // pageRemoved＝頁面移除已存節點（不是修剪、不是列表開頭）
        // v51（T6.2，32.2）合併次數（merged：依規則分開）與觀察到的事件次數（events）分開，名稱即語意
        // v52（T6.3，33.8.3）暫時節點的去向：tempStored＝暫時節點已存（等正式節點合併）、tempPending＝目前還在等、
        // tempDropped＝90 秒內沒等到（兩筆都留著；之後可由 fixOwnDuplicates 處理）。合併成功的計在 merged.temp／removed／inPlace
        videoMismatch: s.videoMismatch, raidEnd: s.raidEnd, // v52（33.1）
        own: { tempSeen: s.ownTempSeen, tempStored: s.ownTempStored, tempDropped: s.ownTempDropped,
          tempPending: st.recent.filter((e) => isTempEntry(e) && !e.matched).length,
          merged: { temp: s.ownReplacedTemp, removed: s.ownReplacedRemoved, swap: s.ownReplacedSwap, late: s.ownLate, inPlace: s.ownInPlaceMerged },
          events: { idChanges: s.idChanges, idFromEmpty: s.idFromEmpty, pageRemoved: s.pageRemoved },
          recent: st.ownRecent.slice() } };
      if (s.captured || final) console.info('[ytcas] 收錄統計' + (final ? '（結束）' : ''), obj);
      // F-20 P1／P2：同一份統計寫入診斷記錄（只有筆數）；時間來源一併記錄，供開播判斷驗證
      diag('P1', final ? 'stats-final' : 'stats', Object.assign({}, obj, { times: {
        startedAtSource: st.stream.startedAtSource || null, startPending: !!st.stream.startPending,
        hasStartedAt: st.stream.startedAt != null, hasEndedAt: st.stream.endedAt != null } }));
      diag('P2', 'items', itemsBreakdown());
      s.observedAdded = 0; // 每分鐘歸零
      // v48（T5.7，審查十一 28.1）統計當下 observer 沒掛在目前的 #items（YouTube 換了列表、下一次定時檢查還沒跑；
      // 背景分頁的計時器被節流時可能長達 1 分鐘）→ 立即重新掛上並回溯擷取，不等下一次 tick
      if (!final && st.mode === 'capturing' && !obj.itemsIsCurrent && cur) { s.itemsStaleHeals++; tick(); }
    }

    // ------------------------------------------------ 對外
    // 定時：重新確認列表元素（T3.3：v29 只在「原本沒有列表」時回溯，YouTube 換掉列表元素後新列表的既有節點永遠未擷取）、
    // 補掃 observer 漏掉的節點、保底修剪
    // v52（T6.3，33.1 第 2 點）F-20 P7 video-switch：videoId 不一致時的聊天室狀態（只有布林、數字）。
    // 用來實機確認降落導航時 iframe 是否重新載入、#items 何時換掉（dom-notes 2.10）
    function probeSwitch(phase) {
      if (!opts.onDiag) return;
      const cur = doc.querySelector(S.chat.items);
      const kids = cur ? Array.from(cur.children) : [];
      diag('P7', 'video-switch', { phase, itemsSame: !!cur && cur === st.items, itemsConnected: !!(st.items && st.items.isConnected), itemsNodes: kids.length,
        seenNodes: kids.filter((el) => el.id && st.seenIds.has(el.id)).length, frameAgeSec: Math.round((Date.now() - st.createdAt) / 1000),
        sinceMismatchSec: st.mismatchAt ? Math.round((now() - st.mismatchAt) / 1000) : null });
    }
    function tick() {
      const prev = st.items;
      const ok = attach();
      if (ok && prev && st.items !== prev) st.stats.itemsSwaps++; // v48（28.1）YouTube 換掉了 #items
      // v52（33.1 第 2 點）videoId 不一致中：#items 換掉、而且新列表沒有本頁看過的 id → 新的聊天室，重新綁定
      if (st.mismatch && ok && st.items !== prev) {
        const kids = Array.from(st.items.children);
        const seen = kids.filter((el) => el.id && st.seenIds.has(el.id)).length;
        if (kids.length && !seen) {
          probeSwitch('rebind');
          const info = st.mismatchInfo;
          st.mismatch = null; st.mismatchInfo = null;
          st.rebinding = true;
          try { api.setInfo(info); } finally { st.rebinding = false; }
          return;
        }
        probeSwitch('swap-same-chat');
      }
      if (ok && st.items !== prev && st.mode === 'capturing') backfill('backfill');
      else if (ok && st.mode === 'capturing') backfill('sweep');
      // 聊天室已渲染（有 renderer）且超過 10 秒仍找不到訊息列表才是問題：warn；載入中不輸出
      if (!ok && st.mode !== 'stopped' && doc.querySelector(S.chat.renderer) && Date.now() - st.createdAt > 10000) {
        S.warnOnce('chat.items', S.chat.items, 'warn');
      }
      trim();
    }

    const api = {
      // 設定或更新場次資訊（STREAM_INFO 或網址參數）；videoId 改變時結束舊收錄、重新開始
      setInfo(info) {
        if (!info || st.mode === 'stopped') return;
        const vid = typeof info.videoId === 'string' && /^[\w-]{6,20}$/.test(info.videoId) ? info.videoId : null;
        // v52（T6.3，審查十一 33.1 第 2 點）嵌入式聊天室（bindVideo）：videoId 綁定後同一個聊天室文件不換場次。
        // 實機：降落時 top 先導航到新直播，舊的聊天室（仍顯示原直播）收到新 videoId → 原直播之後的訊息被存進新場次、標成直播中。
        // 收到不同的 videoId → 送出剩下的、結束 session、暫停（video-mismatch），記 P7 video-switch；
        // YouTube 換掉 #items、新列表裡沒有本頁看過的 id（新的聊天室）才重新綁定（tick）
        if (opts.bindVideo && vid && st.videoId && vid !== st.videoId && !st.rebinding) {
          if (st.mismatch !== vid) {
            st.mismatch = vid; st.mismatchAt = now(); st.stats.videoMismatch++;
            probeSwitch('mismatch');
            if (st.mode === 'capturing') { flush(); endSession(); logStats(true); }
            pauseCapture('video-mismatch');
          }
          st.mismatchInfo = Object.assign({}, st.mismatchInfo || {}, info);
          return;
        }
        if (opts.bindVideo && vid && vid === st.videoId && st.mismatch) {
          // top 又導航回原本的影片：恢復收錄
          st.mismatch = null; st.mismatchInfo = null; probeSwitch('back');
          setStatus('pending'); beginCapture();
        }
        const changed = vid && vid !== st.videoId;
        st.info = Object.assign({}, st.info || {}, info);
        if (changed) st.stream = {}; // 新影片：先清掉舊場次的時間，再依新資訊判斷
        const ch = adoptTimes(deriveTimes(st.info));
        // T3.6 E-3 第 2 點：播放器長度由無變有（top frame 偵測，頁面載入 60 秒後才送）→ 開播訊號（signal，誤差 ≤ 30 秒），
        // 只在等待開播確認時採用；之後由 background 重新抓取的實際時間（meta-actual）覆蓋
        if (typeof info.liveSignalAt === 'number' && source !== 'replay' && st.stream.startedAt == null && !C.isFutureScheduled(st.stream, now())
          && (st.stream.startPending || (st.stream.scheduledStartAt != null && st.stream.scheduledStartAt <= now()))) {
          if (adoptTimes({ startedAt: info.liveSignalAt, startedAtSource: 'signal' }).start) {
            console.info('[ytcas] 偵測到開播訊號（播放器），暫以偵測時間為開播時間，待 background 確認', { videoId: st.videoId });
          }
        }
        // T3.5 F-2：收錄中得知結束時間 → 之後的訊息標 post；送出時帶 endedAt，background 依 F-14 重算 phase
        if (!changed && ch.end) {
          console.info('[ytcas] 已得知直播結束時間，之後的訊息標為結束後（post）', { videoId: st.videoId });
          probeStructure('stream-end', doc.querySelector(S.chat.renderer));
        }
        if (changed) {
          if (st.videoId) { flush(); endSession(); logStats(true); }
          st.videoId = vid;
          st.pinnedSent.clear(); st.pinShown.clear(); st.pinMissing.clear(); st.unpinned.clear(); st.deletedReported.clear(); st.pendingDeleted.length = 0; st.seenIds.clear(); st.p7.clear();
          for (const k of Object.keys(st.stats)) st.stats[k] = 0;
          // 新影片：先前標記過的節點屬於舊影片，不再擷取（iframe 通常會重新載入，這裡只是保險）
          setStatus('pending');
          clearTimeout(st.durationWait); st.durationWait = 0;
          // F-18：重播需要影片長度判斷版本；top frame 的 video 可能稍晚才有長度，最多等 3 秒（取不到視為 v1）
          if (source === 'replay' && typeof st.info.duration !== 'number') {
            st.durationWait = setTimeout(() => { st.durationWait = 0; beginCapture(); }, 3000);
          } else beginCapture();
        } else if (st.durationWait && typeof st.info.duration === 'number') {
          clearTimeout(st.durationWait); st.durationWait = 0;
          beginCapture();
        }
      },
      noVideoId() { if (!st.videoId) { setStatus('no-video-id'); trim(); } },
      // 暫停設定變更後重新判斷（content.js 監聽 storage.onChanged）
      recheckPolicy() {
        if (st.videoId && (st.mode === 'paused')) { setStatus('pending'); beginCapture(); }
      },
      start() {
        tick();
        st.trimTimer = setInterval(tick, C.DOM_TRIM_INTERVAL_MS);
        st.statsTimer = setInterval(() => logStats(false), 60000);
      },
      stop() {
        if (st.mode === 'stopped') return;
        flush();
        endSession();
        logStats(true);
        clearInterval(st.trimTimer); clearInterval(st.statsTimer); clearTimeout(st.batchTimer);
        disconnectObservers();
        setStatus('stopped');
      },
      flush,
      state: () => ({ mode: st.mode, videoId: st.videoId, queue: st.queue.length, session: st.session, stream: Object.assign({}, st.stream),
        stats: Object.assign({}, st.stats), observers: liveObservers, f12: st.f12, viewMode: st.viewMode || viewMode() }),
      _trim: trim,
      _logStats: (final) => logStats(final),
      _tick: tick,
    };
    return api;
  }

  root.YTCAS_CAPTURE = { createEngine, parseMessage, parseRaid, parseClock, clockInfo, clockShape, parseOffset, runsOf, hash, structureOf, observers: () => liveObservers };
})(typeof globalThis !== 'undefined' ? globalThis : self);
