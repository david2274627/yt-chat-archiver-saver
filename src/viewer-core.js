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
  // v45（21.3）notice：頁面狀態提示（歡迎、聊天室模式、重播已啟用…），不屬於 pre／live／post
  const PHASE_LABEL = Object.freeze({ notice: '聊天室提示', pre: '直播開始前（待機室）', live: '直播中', post: '直播結束後' });
  // 在清單中插入分隔線：清單出現 notice、pre 或 post 時，每段開頭都加上該段標籤；只有 live 時不加
  // v46（T5.5，審查十一 24.7）跨日分隔線 { kind: 'day', day: YYYYMMDD, label: '2026/11/19（四）' }：
  //   相鄰兩則的 timestampAbs 跨越本機日期時插入（各段皆適用）；與 phase 標題同時出現時先 phase 標題、再日期；
  //   段內第一則的日期與前一段最後一則不同時也顯示。段內只在日期「往後」時插入（VOD 依影片時間排序時，
  //   午夜前後的到達時間可能有幾秒前後顛倒，不來回插入）。清單第一則前不加（時間碼本身會顯示日期）。
  //   opts.tzOffsetMin：以指定的 UTC 偏移（分鐘，東正）計算日期（測試用；預設本機時區）
  const WEEKDAY = '日一二三四五六';
  function dayParts(ms, tz) {
    if (tz == null) { const d = new Date(ms); return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getDay()]; }
    const d = new Date(ms + tz * 60000);
    return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCDay()];
  }
  function dayKey(ms, tz) { const p = dayParts(ms, tz); return p[0] * 10000 + p[1] * 100 + p[2]; }
  function dayLabel(ms, tz) { const p = dayParts(ms, tz); return p[0] + '/' + pad(p[1]) + '/' + pad(p[2]) + '（' + WEEKDAY[p[3]] + '）'; }
  function withPhaseDividers(list, opts) {
    const tz = opts && opts.tzOffsetMin != null ? opts.tzOffsetMin : null;
    const hasOther = list.some((it) => phaseOf(it.m) !== 'live');
    const out = [];
    let cur = null, lastDay = null;
    for (const it of list) {
      const p = phaseOf(it.m);
      const segStart = p !== cur;
      if (segStart) { if (hasOther) out.push({ kind: 'phase', phase: p, label: PHASE_LABEL[p] || p }); cur = p; }
      const ts = it.m && it.m.timestampAbs;
      if (typeof ts === 'number' && Number.isFinite(ts)) {
        const k = dayKey(ts, tz);
        if (lastDay != null && (segStart ? k !== lastDay : k > lastDay)) out.push({ kind: 'day', day: k, label: dayLabel(ts, tz) });
        if (segStart || lastDay == null || k > lastDay) lastDay = k;
      }
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
    const phase = phaseOf(m);
    if (phase === 'notice') return { text: fmtClock(m.timestampAbs, ref), seconds: null };
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

  // ---------------------------------------------------------------- F-08 時間軸同步（T5）
  // clock：top frame 的 VOD_TIME { currentTime, paused, duration, seekStart, seekEnd, live, at }
  //   VOD（live: false）：影片時間 = 該版本的 offset（v1 為 videoOffsetSec，F-18）＋ 連結影片的 offsetShift
  //   直播中（live: true）：以 DVR 可回放範圍換算（F-08 v37 長期直播備註 (b)）：影片時間 = seekEnd − 基準 − (取樣時間 − 訊息時間)
  //   兩者都只用 phase 'live' 的訊息（F-14：pre／post 不參與跟隨與跳轉）
  // v44（T5.3，審查十一 18.1 (K)）VOD 同步用的時間。v1 的 offset 有兩種來源：
  //   replay（YouTube 重播的影片時間，準確）與 live 收錄的估計值（到達時間 − 開播時間，含聊天延遲）。
  //   已合併的訊息以 replay offset 為準（mergeMessage 已改寫）；只有 live 來源的訊息以校正值 cal 換算：
  //   (timestampAbs − startedAt) / 1000 + cal.delta（cal 由 vodCalibration 依同場已合併訊息的差距中位數算出）
  function versionOffset(m, ver, cal) {
    const v = ver && ver !== 'v1' ? (m.offsets ? m.offsets[ver] : null) : m.videoOffsetSec;
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    if ((!ver || ver === 'v1') && cal && cal.delta != null && cal.startedAt != null && m.offsetSource !== 'replay'
      && typeof m.timestampAbs === 'number' && Array.isArray(m.sources) && m.sources.includes('live')) {
      return (m.timestampAbs - cal.startedAt) / 1000 + cal.delta;
    }
    return v;
  }
  // 校正值：同場「live 與 replay 都收過、offset 已是 replay」的訊息，replay offset 與 live 估計值（到達時間 − 開播）的差距中位數。
  // 差距超過 ±10 分鐘的略過（開播時間錯誤等）；少於 minPairs 筆不校正
  function vodCalibration(msgs, stream, minPairs) {
    const startedAt = stream && typeof stream.startedAt === 'number' ? stream.startedAt : null;
    const out = { delta: null, pairs: 0, startedAt, liveOnly: 0, replay: 0 };
    if (startedAt == null || !Array.isArray(msgs)) return out;
    const ds = [];
    for (const m of msgs) {
      const src = Array.isArray(m.sources) ? m.sources : [];
      if (m.offsetSource === 'replay') out.replay++;
      else if (src.includes('live')) out.liveOnly++;
      if (m.offsetSource !== 'replay' || !src.includes('live') || !src.includes('replay')) continue;
      if (typeof m.videoOffsetSec !== 'number' || typeof m.timestampAbs !== 'number' || (m.phase || 'live') !== 'live') continue;
      const d = m.videoOffsetSec - (m.timestampAbs - startedAt) / 1000;
      if (Math.abs(d) <= 600) ds.push(d);
    }
    out.pairs = ds.length;
    const need = minPairs == null ? 5 : minPairs;
    const median = (a) => { a.sort((x, y) => x - y); const k = a.length >> 1; return a.length % 2 ? a[k] : (a[k - 1] + a[k]) / 2; };
    if (ds.length >= need) { out.delta = median(ds); out.how = 'merged'; }
    // 後備：live 與 replay 沒有合併（id 不同、各存一份）時，以「同作者、同內容、各只出現一次」配對（也就是疑似重複的筆數）
    const pairs = contentPairs(msgs, startedAt);
    out.dupPairs = pairs.length;
    if (out.delta == null && pairs.length >= need) { out.delta = median(pairs.map((p) => p.d)); out.how = 'content'; }
    return out;
  }
  const contentKey = (m) => [m.type || '', String(m.authorHandle || m.authorChannelId || '').toLowerCase(),
    (m.runs || []).map((r) => (r && r.text) || (r && r.emoji && (r.emoji.alt || r.emoji.shortcut)) || '').join('').normalize('NFKC').replace(/\s+/g, ' ').trim()].join('\u0001');
  // 只有 live 來源 vs 只有 replay 來源、同作者同內容、雙方各只出現一次、offset 差距 ≤ 10 分鐘 → { live, replay, d }
  function contentPairs(msgs, startedAt) {
    if (startedAt == null || !Array.isArray(msgs)) return [];
    const lv = new Map(), rp = new Map();
    const add = (map, k, m) => { const a = map.get(k); if (a) a.push(m); else map.set(k, [m]); };
    for (const m of msgs) {
      if ((m.phase || 'live') !== 'live' || typeof m.timestampAbs !== 'number') continue;
      const src = Array.isArray(m.sources) ? m.sources : [];
      const k = contentKey(m);
      if (k.endsWith('\u0001')) continue; // 沒有文字內容（貼圖、系統訊息）不配對
      if (src.includes('replay') && !src.includes('live') && m.offsetSource === 'replay' && typeof m.videoOffsetSec === 'number') add(rp, k, m);
      else if (src.includes('live') && !src.includes('replay')) add(lv, k, m);
    }
    const out = [];
    for (const [k, a] of lv) {
      const b = rp.get(k);
      if (a.length !== 1 || !b || b.length !== 1) continue;
      const d = b[0].videoOffsetSec - (a[0].timestampAbs - startedAt) / 1000;
      if (Math.abs(d) <= 600) out.push({ live: a[0], replay: b[0], d });
    }
    return out;
  }
  // VOD 模式的清單順序：依同步用的時間排序（v1）。pre／post 與沒有 offset 的以「到達時間 − 開播」排入同一條時間軸
  function vodSortKey(m, ver, cal) {
    if ((m.phase || 'live') === 'live') { const t = versionOffset(m, ver, cal); if (t != null) return t; }
    if (cal && cal.startedAt != null && typeof m.timestampAbs === 'number') return (m.timestampAbs - cal.startedAt) / 1000;
    return typeof m.videoOffsetSec === 'number' ? m.videoOffsetSec : 0;
  }
  // v45（T5.4，審查十一 21.2）依 phase 分段（頁面狀態提示 → pre → live → post），段內各自依時間：
  // live 依同步時間（校正後的影片時間），pre／post 依 timestampAbs。v44 把 post 的「開播後秒數」與 live 的影片時間混排，
  // 校正值為負（VOD 開頭被剪）時兩者穿插、分段標題重複
  const PHASE_RANK = Object.freeze({ notice: 0, pre: 1, live: 2, post: 3 });
  function phaseOf(m) { return C.isNotice(m) ? 'notice' : ((m && m.phase) || 'live'); }
  function sortForVod(list, ver, cal) {
    const keyed = list.map((it, i) => {
      const p = phaseOf(it.m);
      const k = p === 'live' ? vodSortKey(it.m, ver, cal) : (typeof it.m.timestampAbs === 'number' ? it.m.timestampAbs / 1000 : 0);
      return { it, i, r: PHASE_RANK[p] != null ? PHASE_RANK[p] : 2, k };
    });
    keyed.sort((a, b) => (a.r - b.r) || (a.k - b.k) || (a.i - b.i));
    return keyed.map((x) => x.it);
  }
  // v46（T5.5，審查十一 24.6）會員訊息（yt-live-chat-membership-item-renderer）的 runs＝標題（#header-primary-text＋#header-subtext）
  //＋{ text: '\n' }＋使用者留言（#message；capture.js）。有留言＝里程碑（「已加入會員 N 個月」＋留言），沒有＝新會員等公告
  function memberParts(m) {
    const runs = (m && m.runs) || [];
    const i = runs.findIndex((r) => r && r.text === '\n' && !r.emoji && !r.link);
    return i < 0 ? { head: runs, body: [] } : { head: runs.slice(0, i), body: runs.slice(i + 1) };
  }
  const hasContent = (runs) => runs.some((r) => r && (r.emoji || (typeof r.text === 'string' && r.text.trim())));
  function isMilestone(m) {
    if (!m) return false;
    if (m.type === T.MILESTONE) return true;
    return m.type === T.MEMBERSHIP && hasContent(memberParts(m).body);
  }
  // v46（T5.5，審查十一第 23 節第 2 點）待機室：不論播放器回報什麼（待機室的播放器可能在播預告／倒數，currentTime 會走、
  // 徽章顯示「非最新」）一律不做時間軸同步。判定只看場次與訊息：
  //   場次還沒載入 → 視為待機室（保守，不同步）；已結束 → 否；等待開播確認 → 是；已開播 → 否；
  //   沒有開播時間但有預定開播時間 → 是；兩者都沒有（場次資訊抓取失敗）→ 有訊息且全部是 pre（收錄時判定為待機室）→ 是
  // v47（T5.6，審查十一 26.1）預定開播時間在未來（頁面 meta）→ 一律待機室，不論 startedAt（C.effectiveStart）
  function isWaitingRoom(stream, items, now) {
    if (!stream) return true;
    if (stream.endedAt != null) return false;
    if (stream.startedAt != null && stream.startedAtSource === 'replay') return false; // 重播來源例外
    if (C.isFutureScheduled(stream, now)) return true;
    if (stream.startPending) return true;
    if (C.effectiveStart(stream, now) != null) return false;
    if (stream.scheduledStartAt != null) return true;
    let pre = 0;
    for (const it of items || []) {
      const p = phaseOf(it && it.m ? it.m : it);
      if (p === 'pre') pre++;
      else if (p !== 'notice') return false;
    }
    return pre > 0;
  }
  function videoTimeOf(m, clock, o) {
    if (!m || !clock || phaseOf(m) !== 'live') return null;
    if (clock.live) {
      // v45（T5.4，審查十一 20.2）牆上時間錨點：畫面上的媒體時間 t 對應的真實時間 ≈ A + t（A＝在最新時量到的 now − currentTime）；
      // 再加上直播延遲 o.latency（同步微調）。本頁還沒量過 A → 不可點（不依賴 seekEnd：實機 seekEnd 會停住不前進）
      if (typeof m.timestampAbs !== 'number' || !o || typeof o.wallA !== 'number') return null;
      return (m.timestampAbs - o.wallA) / 1000 + (o.latency || 0);
    }
    const off = versionOffset(m, o && o.ver, o && o.cal);
    return off == null ? null : off + ((o && o.shift) || 0);
  }
  function inRange(t, clock) {
    if (t == null || !clock) return false;
    // v45：seekEnd 可能停住 → 上限取 seekEnd 與目前播放位置較大者
    if (clock.live) return typeof clock.seekStart === 'number' && t >= clock.seekStart - 1 && t <= Math.max(typeof clock.seekEnd === 'number' ? clock.seekEnd : -Infinity, clock.currentTime) + 1;
    return t >= 0 && (clock.duration == null || t <= clock.duration + 1);
  }
  // 直播中：在最新 → 一般的「跟隨到底」；倒轉 DVR → 依時間軸同步。
  // v43（T5.2，審查十一 16.1 (F)）：YouTube 一般延遲模式下，在最新時 seekEnd − currentTime 本來就有數十秒。
  //   判定順序：播放器「直播」徽章（clock.liveHead：true／false；null＝讀不到）→ 延遲 ≤ 基準（在最新時量到的延遲）＋ edgeSec
  function liveLag(clock) {
    return clock && clock.live && typeof clock.seekEnd === 'number' ? clock.seekEnd - clock.currentTime : null;
  }
  function atLiveEdge(clock, edgeSec, baseline) {
    const lag = liveLag(clock);
    if (lag == null) return false;
    if (clock.liveHead === true || clock.liveHead === false) return clock.liveHead;
    return lag <= (baseline || 0) + edgeSec;
  }
  // 基準延遲的更新：徽章說在最新 → 直接採用；徽章說不在最新、暫停中 → 不學；
  // 讀不到徽章時：第一個樣本、或比基準小 → 採用；在最新範圍內但較大 → 每次只往上追 drift 比例（延遲慢慢變大的長時間直播）；
  // 超出範圍（倒轉中）→ 不變
  function nextBaseline(b, clock, edgeSec, drift) {
    const lag = liveLag(clock);
    if (lag == null || lag < 0 || clock.paused) return b;
    if (clock.liveHead === true) return lag;
    if (clock.liveHead === false) return b;
    if (b == null || lag < b) return lag;
    if (lag <= b + edgeSec) return b + (lag - b) * (drift == null ? 0.05 : drift);
    return b;
  }
  // 直播中目前播放位置對應的實際時間（ms）：扣掉在最新時本來就有的延遲（基準）
  function playheadAbs(clock, baseline) {
    const behind = Math.max(0, (clock.seekEnd - clock.currentTime) - (baseline || 0));
    return clock.at - behind * 1000;
  }
  // v44（T5.3 (L)）直播倒轉時的目標時間（ms）：以跳轉當下為錨點，之後依播放位置前進（不依賴 seekEnd 之後的變化）；
  // 再扣掉直播延遲（畫面落後真實時間的秒數，「同步微調」）。anchor：{ ct: 當時的 currentTime, abs: 當時的 playheadAbs }
  function liveTarget(clock, anchor, latencySec) {
    const base = anchor ? anchor.abs + (clock.currentTime - anchor.ct) * 1000 : clock.at;
    return base - (latencySec || 0) * 1000;
  }
  // v45（T5.4，審查十一 20.2）牆上時間錨點。直播的 currentTime 是連續的媒體時間，在最新時 A＝at − currentTime×1000；
  // 倒轉時目標＝A + currentTime×1000 − 同步微調×1000。完全不用 seekEnd（實機在最新時 seekEnd 速度 0.00，會停住）。
  // 在最新期間持續取樣（每秒最多一次，最多 maxN 個），A 取中位數，吸收播放器緩衝造成的小抖動
  function median(a) {
    if (!a || !a.length) return null;
    const s = a.slice().sort((x, y) => x - y);
    const k = s.length >> 1;
    return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
  }
  function wallSample(clock) { return clock.at - clock.currentTime * 1000; }
  function nextWallSamples(samples, clock, maxN) {
    const out = (samples || []).concat([wallSample(clock)]);
    return out.length > (maxN || 60) ? out.slice(out.length - (maxN || 60)) : out;
  }
  // v47（T5.6，審查十一 26.2）錨點的取樣狀態機（純函式）。實機（圖6）：網址帶 &t=600s 載入時，播放器先短暫在最新、
  // 之後才跳到 t= 的位置；v46 在那幾秒就取了樣本，之後把倒轉的位置當成最新。規則：
  //   1. 樣本的有效條件：直播、播放中、在最新（徽章「最新」；讀不到徽章時依延遲基準）連續穩定 stableMs、期間沒有 seek，
  //      之前取的候選樣本才採用（一段「穩定期」採用後，之後每秒的樣本直接加入）。任何 seek 都重新計時、丟掉候選。
  //   2. 採用後 guardMs 內被 seek 到「非最新」→ 作廢這批樣本，退回上一段的錨點（沒有就 null：重新提示先點「直播」）。
  //   3. strict（網址帶 t=、或剛作廢過）：要等使用者從「非最新」點回最新（liveClicked）後穩定 stableMs，或穩定 strictMs；
  //      讀不到徽章時一律 strictMs。
  function anchorInit(strict) {
    return { cand: [], samples: [], wallA: null, prevWallA: null, stableSince: null, lastAt: 0, acceptedAt: null, committed: false,
      lastSeekAt: null, fromBehindAt: null, prevBehind: false, strict: !!strict, liveClicked: false, voids: 0 };
  }
  function anchorStep(a, clock, o) {
    const s = Object.assign({}, a || anchorInit(o && o.strict));
    o = o || {};
    const stableMs = o.stableMs || 3000, guardMs = o.guardMs || 5000, strictMs = o.strictMs || 10000, maxN = o.maxN || 60;
    const now = clock.at;
    let invalidated = false;
    if (o.seeked) {
      s.lastSeekAt = now;
      if (s.prevBehind) s.fromBehindAt = now; // 從「非最新」跳轉（點「直播」或拖到最新）
      s.stableSince = null; s.cand = []; s.lastAt = 0; s.committed = false;
    }
    // 2. 採用後短時間內被 seek 到非最新 → 作廢（徽章可能晚一拍才變：seek 後 2 秒內看到「非最新」都算）
    if (s.acceptedAt != null && s.lastSeekAt != null && s.lastSeekAt >= s.acceptedAt && s.lastSeekAt - s.acceptedAt <= guardMs
      && now - s.lastSeekAt <= 2000 && clock.live && clock.liveHead === false) {
      s.wallA = s.prevWallA; s.prevWallA = null; s.samples = []; s.acceptedAt = null;
      s.voids++; s.strict = true; s.liveClicked = false; s.fromBehindAt = null;
      invalidated = true;
    }
    const eligible = !!clock.live && !clock.paused && !!o.edge && clock.liveHead !== false;
    if (!eligible) {
      s.stableSince = null; s.cand = []; s.committed = false;
      s.prevBehind = !!clock.live && clock.liveHead === false;
      return { state: s, invalidated };
    }
    s.prevBehind = false;
    if (clock.liveHead === true && s.fromBehindAt != null && now - s.fromBehindAt <= 3000) s.liveClicked = true;
    if (s.stableSince == null) s.stableSince = now;
    if (now - s.lastAt >= 1000) { s.cand = s.cand.concat([wallSample(clock)]); s.lastAt = now; }
    const need = clock.liveHead === true && (!s.strict || s.liveClicked) ? stableMs : strictMs;
    if (now - s.stableSince >= need && s.cand.length) {
      if (!s.committed) { s.prevWallA = s.wallA; s.samples = []; s.acceptedAt = now; s.committed = true; }
      const all = s.samples.concat(s.cand);
      s.samples = all.length > maxN ? all.slice(all.length - maxN) : all;
      s.cand = [];
      s.wallA = median(s.samples);
      s.strict = false;
    }
    return { state: s, invalidated };
  }
  function wallTarget(clock, wallA, latencySec) {
    if (typeof wallA !== 'number') return null;
    return wallA + clock.currentTime * 1000 - (latencySec || 0) * 1000;
  }
  // 清單（withPhaseDividers 的輸出）中「目前播放位置」的訊息：影片時間 ≤ t 的最後一則。
  // 直播：依 timestampAbs（清單本來就依此排序）二分搜尋；VOD：依該版本 offset，先抽出有 offset 的訊息（遞增）再二分搜尋
  function syncIndex(entries, clock, o) {
    if (!clock || !entries || !entries.length) return -1;
    const isMsg = (e) => e.kind === 'msg' && phaseOf(e.it.m) === 'live';
    if (clock.live) {
      if (o && o.target === null) return -1; // v45：本頁還沒量過錨點 → 不同步
      const target = o && typeof o.target === 'number' ? o.target : playheadAbs(clock, o && o.baseline) - ((o && o.latency) || 0) * 1000;
      let lo = 0, hi = entries.length - 1, ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const e = entries[mid];
        // v45：清單最上方的頁面狀態提示（與其後的分隔線）視為 −∞，維持二分搜尋需要的遞增
        // v46：分隔線（phase 標題、跨日分隔線，可能連續兩條）取前一則訊息的時間
        const tOf = (j) => {
          for (let k = j; k >= 0; k--) { const x = entries[k]; if (x.kind === 'msg') return phaseOf(x.it.m) === 'notice' ? -Infinity : x.it.m.timestampAbs; }
          return -Infinity;
        };
        const t = tOf(mid);
        if (t <= target) { ans = mid; lo = mid + 1; } else hi = mid - 1;
      }
      while (ans >= 0 && !isMsg(entries[ans])) ans--;
      return ans;
    }
    const t = clock.currentTime;
    const pts = (o && o.points) || syncPoints(entries, o);
    let lo = 0, hi = pts.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (pts[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans < 0 ? -1 : pts[ans].i;
  }
  // VOD 同步用的（清單索引, 影片時間）序列；offset 偶有倒退時保留遞增的部分（二分搜尋的前提）
  function syncPoints(entries, o) {
    const out = [];
    let last = -Infinity;
    entries.forEach((e, i) => {
      if (e.kind !== 'msg' || phaseOf(e.it.m) !== 'live') return;
      const off = versionOffset(e.it.m, o && o.ver, o && o.cal);
      if (off == null) return;
      const t = off + ((o && o.shift) || 0);
      if (t < last) return;
      last = t;
      out.push({ i, t });
    });
    return out;
  }
  // F-18：依影片長度選版本（差 ≤ 2 秒）；都不符回傳 null
  function pickVersion(versions, duration) {
    if (!Array.isArray(versions) || typeof duration !== 'number' || !Number.isFinite(duration)) return null;
    let best = null;
    for (const v of versions) {
      if (typeof v.duration !== 'number') continue;
      const d = Math.abs(v.duration - duration);
      if (d <= 2 && (!best || d < best.d)) best = { id: v.id, d };
    }
    return best ? best.id : null;
  }
  // 連結影片（F-18 第 6 點）：檢視中的影片是哪一場的剪輯版
  function findLinkedStream(streams, videoId) {
    for (const s of streams || []) {
      const l = (s.linkedVideos || []).find((x) => x && x.videoId === videoId);
      if (l) return { stream: s, link: l };
    }
    return null;
  }

  // ---------------------------------------------------------------- F-12 面板說明（T5）
  // CAPTURE_STATUS { capturing, reason, f12, viewMode } → { text, tone: 'info'|'warn', sticky } 或 null
  function captureNote(cs) {
    if (!cs) return null;
    if (!cs.capturing) {
      if (cs.reason === 'paused' || cs.reason === 'global' || cs.reason === 'channel') return { text: '已暫停收錄（可在擴充功能選單恢復）', tone: 'info', sticky: true };
      if (cs.reason === 'disconnected') return { text: '擴充功能已重新載入，本頁暫停收錄', tone: 'warn', sticky: true };
      if (cs.reason === 'no-video-id') return { text: '無法取得影片資訊，本聊天室不收錄', tone: 'warn', sticky: true };
      return null;
    }
    const f = String(cs.f12 || '');
    if (f === 'switched') return { text: '已自動切換為「即時聊天室」，以完整保存訊息', tone: 'info', sticky: false };
    if (f.startsWith('failed')) return { text: '無法自動切換到「即時聊天室」：「重點聊天室訊息」模式下部分訊息不會被保存。關閉優化面板後可在聊天室頂部手動切換', tone: 'warn', sticky: true };
    return null;
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

  // v47（T5.6，審查十一 26.4）SC 卡片的顏色：底色＝m.color（parseColor）；文字色優先用擷取時保存的 YouTube 文字色
  // （m.textColors：header／author／timestamp／body，顯示時再驗證一次色碼），取不到的欄位用對比度規則（parseColor 的 fg）。
  // from：'youtube'（至少一個欄位來自 YouTube）／'contrast'／null（沒有底色）
  const TEXT_COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|#[0-9a-f]{8}|rgba?\(\d{1,3},\d{1,3},\d{1,3}(,(0|1|0?\.\d+))?\))$/i;
  function scColors(m) {
    const col = parseColor(m && m.color);
    if (!col) return null;
    const tc = (m && m.textColors && typeof m.textColors === 'object') ? m.textColors : {};
    const ok = (v) => (typeof v === 'string' && TEXT_COLOR_RE.test(v.replace(/\s+/g, '')) ? v.replace(/\s+/g, '') : null);
    const header = ok(tc.header), author = ok(tc.author), timestamp = ok(tc.timestamp), body = ok(tc.body);
    const from = header || author || timestamp || body ? 'youtube' : 'contrast';
    const base = header || body || col.fg;
    // on-dark／on-light（徽章等的配色）：依實際採用的主要文字色的亮度
    const p = parseColor(base);
    const light = p ? p.fg === '#000' : col.fg === '#fff'; // 文字色本身是亮色 → 底是暗的
    return { bg: col.bg, header: header || col.fg, author: author || header || col.fg, timestamp: timestamp || header || col.fg,
      body: body || header || col.fg, from, onDark: light };
  }

  // ---------------------------------------------------------------- 圖片
  const safeImg = (u) => (u && C.isAllowedImageUrl(u) ? u : '');
  // v44（17.1）訊息連結：只接受 http／https（顯示時再檢查一次，舊資料或匯入資料也一樣）
  const safeLink = (u) => {
    if (typeof u !== 'string' || !u) return '';
    try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : ''; } catch (_) { return ''; }
  };

  // v47（T5.6，審查十一 26.3）作者頻道網址（頭像點擊）：頻道 id（UC…）優先 → 已存的 authorUrl（只接受 youtube.com 的
  // /channel/UC… 或 /@handle）→ @handle。一律正規化為 https://www.youtube.com/…；都沒有 → ''（頭像不可點）
  const CH_ID = /^UC[\w-]{22}$/;
  function channelUrl(m) {
    if (!m) return '';
    if (typeof m.authorChannelId === 'string' && CH_ID.test(m.authorChannelId)) return 'https://www.youtube.com/channel/' + m.authorChannelId;
    if (typeof m.authorUrl === 'string' && m.authorUrl) {
      try {
        const x = new URL(m.authorUrl);
        if ((x.protocol === 'https:' || x.protocol === 'http:') && /^(www\.|m\.)?youtube\.com$/i.test(x.hostname)) {
          const p = x.pathname.replace(/\/+$/, '');
          const cm = /^\/channel\/(UC[\w-]{22})$/.exec(p);
          if (cm) return 'https://www.youtube.com/channel/' + cm[1];
          const hm = /^\/(@[^/]+)$/.exec(p);
          if (hm) { let h = hm[1]; try { h = decodeURIComponent(h); } catch (_) { /* 原樣 */ } if (C.handleOf(h) === h) return C.handleUrl(h); }
        }
      } catch (_) { /* 不是網址 */ }
    }
    const h = typeof m.authorHandle === 'string' ? m.authorHandle.trim() : '';
    return h && C.handleOf(h) === h ? C.handleUrl(h) : '';
  }

  root.YTCAS_VIEWER_CORE = Object.freeze({
    channelUrl, scColors,
    PILLS, PHASE_LABEL, norm, contentText, displayName, authorKey, isBot, categories, indexMessage, filter,
    matchRanges, emojiMatches, withPhaseDividers, dayKey, dayLabel, fmtDur, fmtClock, isLongStream, timecode, dedupePinned, parseColor, safeImg, safeLink,
    versionOffset, vodCalibration, contentPairs, vodSortKey, sortForVod, phaseOf, memberParts, isMilestone, isWaitingRoom, videoTimeOf, inRange, liveLag, atLiveEdge, nextBaseline, playheadAbs, liveTarget, median, wallSample, nextWallSamples, anchorInit, anchorStep, wallTarget, syncIndex, syncPoints, pickVersion, findLinkedStream, captureNote,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
