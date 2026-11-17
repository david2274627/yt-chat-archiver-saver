// 檢視器核心邏輯（T4，SPEC F-04～F-07、F-13、F-14、10.4）：分類、篩選、搜尋、高亮範圍、時段分隔、時間碼、SC 顏色。
// 純函式：不依賴 DOM 或 chrome.*，viewer.js 與測試頁共用。
(function (root) {
  'use strict';

  const C = root.YTCAS_CONST;
  const T = C.MSG_TYPE;
  const DAY = 86400;

  // ---------------------------------------------------------------- 文字
  // 搜尋用正規化：NFKC、小寫、空白收斂（與 db.js normText 相同規則）
  const norm = (s) => String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const stripAt = (h) => String(h || '').replace(/^@/, '');

  // 訊息內容的可搜尋文字：文字 runs ＋ 表符 alt／shortcut ＋ 禮物名稱
  function contentText(m) {
    const parts = [];
    for (const r of m.runs || []) {
      if (r && r.emoji) parts.push(r.emoji.alt || '', r.emoji.shortcut || '');
      else if (r && r.text) parts.push(r.text);
    }
    if (m.giftName) parts.push(m.giftName);
    return norm(parts.join(' '));
  }

  // ---------------------------------------------------------------- 作者
  // 顯示名稱：頻道解析結果（F-03）＞擷取到的名稱＞@handle
  function displayName(m, channels) {
    const h = m.authorHandle || '';
    const ch = h && channels ? channels.get(h) : null;
    if (ch && ch.displayName) return ch.displayName;
    if (m.authorName) return m.authorName;
    return h;
  }
  function authorKey(m) { return m.authorHandle || m.authorChannelId || (m.authorName ? 'name:' + m.authorName : ''); }

  const isBot = (m, name) => {
    const list = C.BOT_BLOCKLIST;
    const h = stripAt(m.authorHandle).toLowerCase();
    const n = String(name || m.authorName || '').toLowerCase();
    return (h && list.includes(h)) || (n && list.includes(stripAt(n)));
  };

  // ---------------------------------------------------------------- F-05 分類膠囊
  // all／sc（SC、超級貼圖、禮物）／mem（新會員、里程碑、贈送與收到會員）／raid（降落橫幅＋認證實況主發言，排除機器人與本台主播／管理員）
  const PILLS = Object.freeze(['all', 'sc', 'mem', 'raid']);
  function categories(m, name) {
    const out = ['all'];
    if (m.type === T.SUPERCHAT || m.type === T.SUPERSTICKER || m.type === T.GIFT) out.push('sc');
    if (m.type === T.MEMBERSHIP || m.type === T.MILESTONE) out.push('mem');
    if (m.type === T.RAID || isRaider(m, name)) out.push('raid');
    return out;
  }
  function isRaider(m, name) {
    const b = m.authorBadges || [];
    return b.includes('verified') && !b.includes('owner') && !b.includes('moderator') && !isBot(m, name);
  }

  // ---------------------------------------------------------------- 篩選
  // 每則訊息預先算好的索引（篩選與搜尋只做字串比對，10 萬則 ≤ 300ms）
  function indexMessage(m, channels) {
    const name = displayName(m, channels);
    return { m, name, user: norm([name, m.authorHandle, m.authorName].filter(Boolean).join(' ')), text: contentText(m),
      cats: categories(m, name), key: authorKey(m) };
  }

  // state: { pill, hideDeleted, userQuery, userChip（authorKey）, keyword }
  // 回傳 { list: 索引項目[], counts: { all, sc, mem, raid } }；counts 為套用其他條件後各分類的筆數
  function filter(items, state) {
    const uq = norm(state.userQuery);
    const kw = norm(state.keyword);
    const counts = { all: 0, sc: 0, mem: 0, raid: 0 };
    const list = [];
    const pill = PILLS.includes(state.pill) ? state.pill : 'all';
    for (const it of items) {
      if (state.hideDeleted && it.m.deleted) continue;
      if (state.userChip && it.key !== state.userChip) continue;
      if (uq && !it.user.includes(uq)) continue;
      if (kw && !it.text.includes(kw)) continue;
      for (const c of it.cats) counts[c]++;
      if (pill === 'all' || it.cats.includes(pill)) list.push(it);
    }
    return { list, counts };
  }

  // ---------------------------------------------------------------- F-06 高亮
  // 回傳文字中命中關鍵字的範圍 [[start, end], ...]（不分大小寫）。小寫後長度改變的文字（少數語言）不高亮
  function matchRanges(text, keyword) {
    const k = String(keyword || '').trim().toLowerCase();
    const s = String(text || '');
    if (!k) return [];
    const low = s.toLowerCase();
    if (low.length !== s.length) return [];
    const out = [];
    let i = low.indexOf(k);
    while (i >= 0) { out.push([i, i + k.length]); i = low.indexOf(k, i + k.length); }
    return out;
  }
  // 表符命中：alt 或 shortcut 含關鍵字
  function emojiMatches(emoji, keyword) {
    const k = norm(keyword);
    if (!k || !emoji) return false;
    return norm(emoji.alt).includes(k) || norm(emoji.shortcut).includes(k);
  }

  // ---------------------------------------------------------------- F-14 時段分隔
  const PHASE_LABEL = Object.freeze({ pre: '直播開始前（待機室）', live: '直播中', post: '直播結束後' });
  // 在清單中插入分隔線：清單出現 pre 或 post 時，每段開頭都加上該段標籤；只有 live 時不加
  function withPhaseDividers(list) {
    const hasOther = list.some((it) => it.m.phase === 'pre' || it.m.phase === 'post');
    if (!hasOther) return list.map((it) => ({ kind: 'msg', it }));
    const out = [];
    let cur = null;
    for (const it of list) {
      const p = it.m.phase || 'live';
      if (p !== cur) { out.push({ kind: 'phase', phase: p, label: PHASE_LABEL[p] || p }); cur = p; }
      out.push({ kind: 'msg', it });
    }
    return out;
  }

  // ---------------------------------------------------------------- 時間碼
  const pad = (n) => String(n).padStart(2, '0');
  function fmtDur(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600), mi = Math.floor((s % 3600) / 60), se = s % 60;
    return h ? `${h}:${pad(mi)}:${pad(se)}` : `${mi}:${pad(se)}`;
  }
  function fmtClock(ms, refMs) {
    const d = new Date(ms);
    const t = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    if (refMs == null) return t;
    const r = new Date(refMs);
    return d.toDateString() === r.toDateString() ? t : `${d.getMonth() + 1}/${d.getDate()} ${t}`;
  }

  // 長期直播（SPEC F-08 v37 備註）：開播到最後訊息超過 24 小時 → offset 無意義，改顯示絕對時間
  function isLongStream(stream) {
    if (!stream || stream.startedAt == null) return false;
    const last = stream.lastMessageAt || stream.endedAt || 0;
    return last - stream.startedAt > DAY * 1000;
  }

  // 回傳 { text, seconds|null（可點擊跳轉時為秒數）, label（aria） }
  //   live：offset（可點）；pre：「開播前 12:34」；post：「結束後 3:05」；offset 未知或長期直播：當地時間（不可點）
  function timecode(m, stream, ctx) {
    const long = ctx && ctx.long;
    const ref = ctx && ctx.refMs;
    const off = typeof m.videoOffsetSec === 'number' && Number.isFinite(m.videoOffsetSec) ? m.videoOffsetSec : null;
    const phase = m.phase || 'live';
    if (phase === 'pre') {
      if (off != null && off < 0 && !long) return { text: '開播前 ' + fmtDur(-off), seconds: null };
      return { text: '開播前 ' + fmtClock(m.timestampAbs, ref), seconds: null };
    }
    if (phase === 'post') {
      if (stream && stream.endedAt != null && m.timestampAbs >= stream.endedAt) return { text: '結束後 ' + fmtDur((m.timestampAbs - stream.endedAt) / 1000), seconds: null };
      return { text: '結束後 ' + fmtClock(m.timestampAbs, ref), seconds: null };
    }
    if (off == null || long || off < 0) return { text: fmtClock(m.timestampAbs, ref), seconds: null };
    const text = fmtDur(off);
    return { text, seconds: Math.floor(off), label: '跳轉至 ' + text };
  }

  // ---------------------------------------------------------------- F-07 置頂
  // 同一則（C.samePinned：作者＋正規化內容）只留最後一次置頂的那筆，依最後置頂時間新到舊。
  // T4.1：v38 以內容＋handle 為鍵，同一則的兩次擷取只要一筆缺 handle 或空白不同就會重複顯示
  function dedupePinned(list) {
    const sorted = (list || []).filter(Boolean).slice().sort((a, b) => C.pinnedTime(b) - C.pinnedTime(a));
    const out = [];
    for (const p of sorted) if (!out.some((q) => C.samePinned(p, q))) out.push(p);
    return out;
  }

  // ---------------------------------------------------------------- SC 顏色（10.3：底色用訊息本身的等級色，文字依底色選黑或白）
  // 只接受 #rgb／#rrggbb／#aarrggbb（YouTube 舊格式）／rgb()／rgba()；回傳 { bg: 'rgb(r, g, b)', fg: '#000'|'#fff' } 或 null
  function parseColor(s) {
    const v = String(s || '').trim();
    let r, g, b;
    let mm = /^#([0-9a-f]{3})$/i.exec(v);
    if (mm) [r, g, b] = mm[1].split('').map((c) => parseInt(c + c, 16));
    else if ((mm = /^#([0-9a-f]{6})$/i.exec(v))) [r, g, b] = [0, 2, 4].map((i) => parseInt(mm[1].slice(i, i + 2), 16));
    else if ((mm = /^#[0-9a-f]{2}([0-9a-f]{6})$/i.exec(v))) [r, g, b] = [0, 2, 4].map((i) => parseInt(mm[1].slice(i, i + 2), 16));
    else if ((mm = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i.exec(v))) [r, g, b] = [mm[1], mm[2], mm[3]].map(Number);
    else return null;
    if ([r, g, b].some((x) => !(x >= 0 && x <= 255))) return null;
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    // 與黑、白的對比度取較高者
    const fg = (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? '#000' : '#fff';
    return { bg: `rgb(${r}, ${g}, ${b})`, fg };
  }

  // ---------------------------------------------------------------- 圖片
  const safeImg = (u) => (u && C.isAllowedImageUrl(u) ? u : '');

  root.YTCAS_VIEWER_CORE = Object.freeze({
    PILLS, PHASE_LABEL, norm, contentText, displayName, authorKey, isBot, categories, indexMessage, filter,
    matchRanges, emojiMatches, withPhaseDividers, fmtDur, fmtClock, isLongStream, timecode, dedupePinned, parseColor, safeImg,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
