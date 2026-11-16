// F-20 診斷記錄控制頁（擴充功能內頁面：chrome-extension://<ID>/tools/diag.html；T7 移到後台「設定 → 進階」）
(function () {
  'use strict';
  const C = self.YTCAS_CONST;
  const RT = C.RT;
  const $ = (id) => document.getElementById(id);
  const PROBE_LABELS = {
    P1: 'P1 收錄統計（每分鐘，各聊天室）',
    P2: 'P2 訊息列表節點分類（標籤 × 已存／未存，每分鐘）',
    P3: 'P3 場次資訊＋播放器長度（變化時＋每 5 分鐘）',
    P4: 'P4 聊天室 iframe 狀態、頁面與聊天室屬性變化',
    P5: 'P5 欄位統計、場次 phase 分布與收錄紀錄摘要（每 10 分鐘）',
    P6: 'P6 彈出視窗開啟／關閉／接手',
    P7: 'P7 結構探針（未知元件、禮物、降落、直播結束時自動記錄結構）',
    P8: 'P8 本套件的警告、錯誤與例外',
  };

  const ctl = (op, extra) => chrome.runtime.sendMessage(Object.assign({ type: RT.DIAG_CONTROL, op }, extra || {}));
  const msg = (s) => { $('msg').textContent = s; };
  const fmt = (t) => (t ? new Date(t).toLocaleString('zh-TW', { hour12: false }) : '—');

  for (const p of C.DIAG.PROBES) {
    const l = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = p; cb.checked = true; cb.className = 'probe';
    const span = document.createElement('span');
    span.textContent = PROBE_LABELS[p] || p;
    l.append(cb, span);
    $('probes').append(l);
  }

  async function refresh() {
    const r = await ctl('status');
    if (!r || !r.ok) { $('status').textContent = '無法取得狀態：' + ((r && r.error) || '沒有回應'); return; }
    const s = r.status;
    const el = $('status');
    el.textContent = '';
    const head = document.createElement('span');
    if (s.active) { head.className = 'rec'; head.textContent = '● 記錄中（REC）'; }
    else if (s.scheduled) head.textContent = '◷ 已排程，尚未開始';
    else head.textContent = '○ 未記錄';
    el.append(head, document.createTextNode([
      '',
      '開始：' + fmt(s.startAt) + '　結束（時限）：' + fmt(s.endsAt),
      s.stoppedAt ? '已停止：' + fmt(s.stoppedAt) + '（' + (s.reason === 'limit' ? '到達時限' : s.reason === 'manual' ? '手動' : s.reason || '—') + '）' : '',
      '探針：' + ((s.probes || []).join('、') || '—'),
      '記錄筆數：' + s.records,
    ].filter((x) => x !== null).join('\n')));
    $('btn-stop').disabled = !(s.active || s.scheduled);
    if (Array.isArray(s.probes) && (s.active || s.scheduled)) {
      document.querySelectorAll('.probe').forEach((cb) => { cb.checked = s.probes.includes(cb.value); });
    }
  }

  const toMs = (v) => (v ? new Date(v).getTime() : null);

  $('btn-start').addEventListener('click', async () => {
    const probes = Array.from(document.querySelectorAll('.probe:checked')).map((x) => x.value);
    if (!probes.length) { msg('請至少勾選一個探針'); return; }
    const opts = { probes, hours: Number($('hours').value) || C.DIAG.DEFAULT_HOURS };
    const s = toMs($('startAt').value), e = toMs($('endAt').value);
    if (s) opts.startAt = s;
    if (e) opts.endAt = e;
    const st = await ctl('status');
    if (st && st.ok && st.status.records > 0 && !confirm('開始新的一段記錄會清除目前的 ' + st.status.records + ' 筆記錄。確定嗎？（請先匯出）')) return;
    const r = await ctl('start', { opts });
    msg(r && r.ok ? (r.status.active ? '已開始記錄' : '已排程') : '失敗：' + (r && r.error));
    refresh();
  });

  $('btn-stop').addEventListener('click', async () => {
    const r = await ctl('stop');
    msg(r && r.ok ? '已停止' : '失敗：' + (r && r.error));
    refresh();
  });

  function stamp(t) {
    const d = new Date(t);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  $('btn-export').addEventListener('click', async () => {
    const r = await ctl('export');
    if (!r || !r.ok) { msg('匯出失敗：' + (r && r.error)); return; }
    const blob = new Blob([JSON.stringify(r.data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const filename = C.DIAG.DOWNLOAD_DIR + '/ytcas-diag-' + stamp(r.data.exportedAt) + '.json';
    try {
      await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
      msg('已匯出 ' + r.data.records.length + ' 筆（' + Math.round(blob.size / 1024) + ' KB）：下載\\' + filename.replace('/', '\\'));
    } catch (e) {
      msg('下載失敗：' + (e && e.message));
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  });

  $('btn-summary').addEventListener('click', async () => {
    const r = await ctl('summary', { maxLines: 200 });
    if (!r || !r.ok) { msg('失敗：' + (r && r.error)); return; }
    try { await navigator.clipboard.writeText(r.text); msg('已複製摘要（' + r.text.split('\n').length + ' 行）'); } catch (e) { msg('無法寫入剪貼簿：' + (e && e.message)); }
  });

  $('btn-clear').addEventListener('click', async () => {
    if (!confirm('清除所有診斷記錄？（不影響聊天存檔）')) return;
    const r = await ctl('clear');
    msg(r && r.ok ? '已清除' : '失敗：' + (r && r.error));
    refresh();
  });

  refresh();
  setInterval(refresh, 10000);
})();
