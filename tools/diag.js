// F-20 診斷記錄控制頁（擴充功能內頁面：chrome-extension://<ID>/tools/diag.html；T7 移到後台「設定 → 進階」）
// T3.8（審查十追加七 F）：單一切換按鈕（開始／停止（剩 mm:ss）／取消排程）、結束方式二選一（記錄 N 分鐘／指定結束時間）、
// 最長時限移到「進階」作為安全上限並即時提示；B-3：上一段尚未匯出時提示並提供「先匯出再開始」。
(function () {
  'use strict';
  const C = self.YTCAS_CONST;
  const RT = C.RT;
  const D = C.DIAG;
  const PROBE_LABELS = {
    P1: 'P1 收錄統計（每分鐘，各聊天室）',
    P2: 'P2 訊息列表節點分類（標籤 × 已存／未存，每分鐘）',
    P3: 'P3 場次資訊＋播放器長度（變化時＋每 5 分鐘）',
    P4: 'P4 聊天室 iframe 狀態、頁面與聊天室屬性變化',
    P5: 'P5 欄位統計、場次 phase 分布與收錄紀錄摘要（每 10 分鐘）',
    P6: 'P6 彈出視窗開啟／關閉／接手、斷線分頁',
    P7: 'P7 結構探針（未知元件、禮物、降落、直播結束時自動記錄結構）',
    P8: 'P8 本套件的警告、錯誤與例外',
    P9: 'P9 記憶體（JS heap、DOM 節點數；面板另記清單筆數與繪出列數；間隔見下方）',
  };
  const pad = (n) => String(n).padStart(2, '0');
  const hhmm = (t) => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const fmt = (t) => (t ? new Date(t).toLocaleString('zh-TW', { hour12: false }) : '—');
  // 剩餘時間 mm:ss（超過 60 分鐘時分鐘數照實顯示，例如 125:30）
  function mmss(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return pad(Math.floor(s / 60)) + ':' + pad(s % 60);
  }

  // ---------------------------------------------------------------- 純函式（測試頁直接呼叫）
  // form: { schedule, startAt(ms|null), endMode: 'minutes'|'end', minutes, endAt(ms|null), hours, probes }
  // 回傳 { ok, error?, scheduled, startAt, endAt, effectiveEnd, exceeds, hours, warning, opts }
  function computePlan(form, now) {
    const hours = Math.min(D.MAX_HOURS, Math.max(D.MIN_HOURS, Math.round(Number(form.hours) || D.DEFAULT_HOURS)));
    const scheduled = !!form.schedule && typeof form.startAt === 'number' && form.startAt > now;
    if (form.schedule && !(typeof form.startAt === 'number')) return { ok: false, error: '請選擇開始時間，或取消「排程開始」' };
    const start = scheduled ? form.startAt : now;
    let end;
    if (form.endMode === 'end') {
      if (typeof form.endAt !== 'number') return { ok: false, error: '請選擇結束時間' };
      if (form.endAt <= start) return { ok: false, error: '結束時間必須晚於開始時間' };
      end = form.endAt;
    } else {
      const m = Number(form.minutes);
      if (!Number.isFinite(m) || m < 1 || m > 1440 || Math.round(m) !== m) return { ok: false, error: '分鐘數請輸入 1～1440 的整數' };
      end = start + m * 60000;
    }
    const limitEnd = start + hours * 3600e3;
    const exceeds = end > limitEnd;
    const effectiveEnd = Math.min(end, limitEnd);
    const opts = { hours, endAt: end };
    if (scheduled) opts.startAt = start;
    if (Array.isArray(form.probes)) opts.probes = form.probes;
    // v44（T5.3，18.4）P9 取樣間隔（分鐘）：診斷頁預設 1 分鐘
    const p9 = Number(form.p9Minutes);
    if (form.p9Minutes != null && form.p9Minutes !== '' && (!Number.isFinite(p9) || p9 < D.P9_MIN_MINUTES || p9 > D.P9_MAX_MINUTES || Math.round(p9) !== p9)) {
      return { ok: false, error: 'P9 取樣間隔請輸入 ' + D.P9_MIN_MINUTES + '～' + D.P9_MAX_MINUTES + ' 的整數（分鐘）' };
    }
    opts.p9Minutes = Number.isFinite(p9) && form.p9Minutes !== '' && form.p9Minutes != null ? p9 : D.P9_PAGE_DEFAULT_MINUTES;
    return { ok: true, scheduled, startAt: start, endAt: end, effectiveEnd, exceeds, hours,
      warning: exceeds ? '超過最長時限 ' + hours + ' 小時，將於上限時停止（' + hhmm(effectiveEnd) + '）' : '', opts,
      immediateFallback: !!form.schedule && !scheduled }; // 排程時間已過 → 立即開始
  }

  // 切換按鈕的狀態（以 background 回傳的 status 為準）
  function buttonState(st, now) {
    if (st && st.active) return { action: 'stop', cls: 'danger', label: '停止記錄（剩 ' + mmss((st.endsAt || now) - now) + '）' };
    if (st && st.scheduled) return { action: 'cancel', cls: 'secondary', label: '取消排程（' + hhmm(st.startAt) + ' 開始）' };
    return { action: 'start', cls: 'primary', label: '開始記錄' };
  }

  self.YTCAS_DIAG_UI = { computePlan, buttonState, mmss };

  // ---------------------------------------------------------------- 畫面
  const $ = (id) => document.getElementById(id);
  if (!$('btn-toggle')) return; // 測試頁只載入純函式時
  const ctl = (op, extra) => chrome.runtime.sendMessage(Object.assign({ type: RT.DIAG_CONTROL, op }, extra || {}));
  const msg = (s) => { $('msg').textContent = s; };
  const toMs = (v) => (v ? new Date(v).getTime() : null);
  let status = null;
  let statusAt = 0;
  let staleTabs = [];

  for (const p of D.PROBES) {
    const l = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = p; cb.checked = true; cb.className = 'probe';
    const span = document.createElement('span');
    span.textContent = PROBE_LABELS[p] || p;
    l.append(cb, span);
    $('probes').append(l);
  }

  function readForm() {
    return {
      schedule: $('schedule').checked, startAt: toMs($('startAt').value),
      endMode: $('mode-end').checked ? 'end' : 'minutes', minutes: $('minutes').value === '' ? NaN : Number($('minutes').value),
      endAt: toMs($('endAt').value), hours: Number($('hours').value),
      probes: Array.from(document.querySelectorAll('.probe:checked')).map((x) => x.value),
      p9Minutes: $('p9Minutes') ? $('p9Minutes').value : null,
    };
  }

  // 結束方式二選一：未選的欄位停用；排程開始勾選後才顯示開始時間
  function syncForm() {
    const endMode = $('mode-end').checked;
    $('minutes').disabled = endMode;
    $('endAt').disabled = !endMode;
    $('start-field').hidden = !$('schedule').checked;
    const now = Date.now();
    const p = computePlan(readForm(), now);
    if (!p.ok) { $('plan').textContent = p.error; $('limit-warn').hidden = true; return p; }
    $('plan').textContent = (p.scheduled ? hhmm(p.startAt) + ' 開始' : (p.immediateFallback ? '排程時間已過，將立即開始' : '立即開始')) +
      '，' + hhmm(p.effectiveEnd) + ' 停止';
    $('limit-warn').hidden = !p.exceeds;
    $('limit-warn').textContent = p.warning;
    return p;
  }
  ['schedule', 'startAt', 'mode-minutes', 'mode-end', 'minutes', 'endAt', 'hours', 'p9Minutes'].forEach((id) => {
    if (!$(id)) return;
    $(id).addEventListener('input', syncForm);
    $(id).addEventListener('change', syncForm);
  });
  // Enter 在分鐘欄位 = 按「開始記錄」
  $('minutes').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && buttonState(status, Date.now()).action === 'start') { e.preventDefault(); $('btn-toggle').click(); }
  });

  function renderStatus() {
    const now = Date.now();
    const s = status || {};
    const b = buttonState(status, now);
    const btn = $('btn-toggle');
    btn.textContent = b.label;
    btn.className = b.cls;
    btn.dataset.action = b.action;
    const el = $('status');
    el.textContent = '';
    const head = document.createElement('span');
    if (s.active) { head.className = 'rec'; head.textContent = '● 記錄中（REC）'; }
    else if (s.scheduled) head.textContent = '◷ 已排程，' + hhmm(s.startAt) + ' 開始';
    else head.textContent = '○ 未記錄';
    el.append(head, document.createTextNode('\n' + [
      (s.active || s.scheduled) ? '開始：' + fmt(s.startAt) + '　停止：' + fmt(s.endsAt) : '',
      s.stoppedAt && !s.active && !s.scheduled ? '上一段：' + fmt(s.startAt) + ' ～ ' + fmt(s.stoppedAt) + '（' + (s.reason === 'limit' ? '時間到' : s.reason === 'manual' ? '手動停止' : s.reason || '—') + '）' : '',
      '記錄筆數：' + (s.records ?? '—'),
    ].filter(Boolean).join('\n')));
    const showUnexp = !!(s.unexported && !s.active && !s.scheduled);
    $('unexported').hidden = !showUnexp;
    $('btn-export-start').hidden = !showUnexp;
    // 記錄中或已排程時，表單鎖定（以 background 狀態為準）
    const busy = !!(s.active || s.scheduled);
    for (const id of ['schedule', 'startAt', 'mode-minutes', 'mode-end', 'hours']) $(id).disabled = busy;
    if (busy) { $('minutes').disabled = true; $('endAt').disabled = true; document.querySelectorAll('.probe').forEach((c) => { c.disabled = true; }); }
    else { document.querySelectorAll('.probe').forEach((c) => { c.disabled = false; }); syncForm(); }
    // 斷線分頁
    $('stale').hidden = !staleTabs.length;
    if (staleTabs.length) {
      $('stale-text').textContent = staleTabs.length + ' 個 YouTube 分頁沒有連線（擴充功能更新後尚未重新接上），這些分頁的探針不會記錄：' +
        staleTabs.map((t) => '#' + t.tabId + '（' + (t.kind === 'popout' ? '彈出視窗' : t.kind === 'watch' ? '影片頁' : '其他') + (t.video ? ' ' + t.video : '') + '）').join('、') +
        '。可按「重新接上這些分頁」，或對這些分頁按 F5。';
    }
  }

  async function refresh() {
    try {
      const r = await ctl('status');
      if (r && r.ok) { status = r.status; statusAt = Date.now(); }
      else msg('無法取得狀態：' + ((r && r.error) || '沒有回應'));
    } catch (e) { msg('無法取得狀態：' + (e && e.message)); }
    renderStatus();
  }

  function stamp(t) {
    const d = new Date(t);
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  }
  async function doExport() {
    const r = await ctl('export');
    if (!r || !r.ok) { msg('匯出失敗：' + (r && r.error)); return false; }
    const blob = new Blob([JSON.stringify(r.data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const filename = D.DOWNLOAD_DIR + '/ytcas-diag-' + stamp(r.data.exportedAt) + '.json';
    try {
      await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
      msg('已匯出 ' + r.data.records.length + ' 筆（' + Math.round(blob.size / 1024) + ' KB）：下載\\' + filename.replace('/', '\\') + '　→ 請放進 docs/diag/raw/');
      return true;
    } catch (e) { msg('下載失敗：' + (e && e.message)); return false; }
    finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
  }

  async function doStart() {
    const p = syncForm();
    if (!p.ok) { msg(p.error); ($('mode-end').checked ? $('endAt') : $('minutes')).focus(); return; }
    if (!p.opts.probes || !p.opts.probes.length) { msg('請至少勾選一個探針（進階）'); return; }
    const r = await ctl('start', { opts: p.opts });
    if (!r || !r.ok) { msg('開始失敗：' + (r && r.error)); return; }
    staleTabs = r.staleTabs || [];
    msg((r.status.active ? '已開始記錄' : '已排程') + (p.exceeds ? '（' + p.warning + '）' : ''));
    status = r.status; statusAt = Date.now();
    renderStatus();
  }

  // 請求進行中停用切換按鈕，避免在狀態更新前連按造成重複開始／停止
  let inFlight = false;
  $('btn-toggle').addEventListener('click', async () => {
    if (inFlight) return;
    const action = buttonState(status, Date.now()).action;
    inFlight = true;
    $('btn-toggle').disabled = true;
    try {
      if (action === 'start') {
        if (status && status.unexported && !confirm('上一段記錄尚未匯出，開始新的一段會清除它（' + status.records + ' 筆）。確定嗎？')) return;
        await doStart();
      } else {
        const r = await ctl('stop'); // 停止與取消排程都不再額外確認
        msg(r && r.ok ? (action === 'cancel' ? '已取消排程' : '已停止') : '失敗：' + (r && r.error));
        await refresh();
      }
    } finally {
      inFlight = false;
      $('btn-toggle').disabled = false;
    }
  });
  $('btn-export-start').addEventListener('click', async () => { if (await doExport()) { await refresh(); await doStart(); } });
  $('btn-export').addEventListener('click', async () => { await doExport(); await refresh(); });
  $('btn-summary').addEventListener('click', async () => {
    const r = await ctl('summary', { maxLines: 200 });
    if (!r || !r.ok) { msg('失敗：' + (r && r.error)); return; }
    try { await navigator.clipboard.writeText(r.text); msg('已複製摘要（' + r.text.split('\n').length + ' 行）'); } catch (e) { msg('無法寫入剪貼簿：' + (e && e.message)); }
  });
  $('btn-clear').addEventListener('click', async () => {
    if (!confirm('清除所有診斷記錄？（不影響聊天存檔）')) return;
    const r = await ctl('clear');
    msg(r && r.ok ? '已清除' : '失敗：' + (r && r.error));
    await refresh();
  });
  $('btn-reinject').addEventListener('click', async () => {
    const r = await ctl('reinject', { tabIds: staleTabs.map((t) => t.tabId) });
    if (!r || !r.ok) { msg('失敗：' + (r && r.error)); return; }
    staleTabs = r.staleTabs || [];
    msg('已重新接上 ' + r.reinject.ok + '／' + r.reinject.tabs + ' 個分頁' + (staleTabs.length ? '；仍有 ' + staleTabs.length + ' 個需要按 F5' : ''));
    renderStatus();
  });

  // 狀態以 background 為準：每 1 秒查一次（剩餘時間每秒更新），並監聽 diagState 變化
  try { chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch[D.STATE_KEY]) refresh(); }); } catch (_) { /* ignore */ }
  setInterval(refresh, 1000);
  ctl('staleTabs').then((r) => { if (r && r.ok) { staleTabs = r.staleTabs || []; renderStatus(); } }).catch(() => {});
  syncForm();
  refresh();
  void statusAt;
})();
