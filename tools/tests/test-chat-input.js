// T6 chat frame 端（src/chat-input.js）測試：SPEC 6.2 第 2 點、6.3。結果顯示在頁面並存於 window.__results。
(function () {
  'use strict';
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });
  function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
  function eq(a, b, m) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m || 'not equal') + '：實際 ' + x + '，預期 ' + y); }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, ms, msg) { const t0 = performance.now(); while (!(await fn())) { if (performance.now() - t0 > (ms || 3000)) throw new Error('逾時：' + (msg || '')); await sleep(20); } }

  const frame = document.getElementById('chat');
  const W = () => frame.contentWindow;
  const D = () => frame.contentDocument;
  const q = (sel) => D().querySelector(sel);
  const M = () => W().YTCAS_CHAT_INPUT.measure(D(), W(), W().YTCAS_SEL, W().YTCAS_CONST);
  // 以 iframe 內的絕對位置（px，相對 iframe 頂端）放元素；#chat 從 40px 開始
  const place = (el, top, h) => { el.hidden = false; el.style.top = (top - 40) + 'px'; el.style.height = h + 'px'; };
  const placeAbs = (el, top, h) => { el.hidden = false; el.style.top = top + 'px'; el.style.height = h + 'px'; };
  function reset() {
    place(q('yt-live-chat-banner-manager'), 485, 53);
    const pp = q('#panel-pages'); place(pp, 538, 62);
    q('#input-panel').style.height = '62px';
    q('#action-panel').hidden = true;
    q('#ov-child').hidden = true;
    for (const s of ['yt-emoji-picker-renderer', 'yt-live-chat-message-buy-flow-renderer', '#hdr-dd', '#product-picker', '#purchase-page']) q(s).hidden = true;
    q('#input-panel').hidden = false;
  }

  test('白名單量測（6.3 v25／v26）：置頂列＋輸入列 → iframe 底邊 − 置頂列頂端；投票卡（#chat > #action-panel）完整露出', async () => {
    await until(() => W() && W().YTCAS_CHAT_INPUT && q('#input-panel'), 3000, 'fixture 載入');
    eq(W().innerHeight, 600);
    reset();
    let m = M();
    eq([m.vh, m.hasInput, m.bottomZoneHeight, m.src, m.inputH, m.popupOpen], [600, true, 115, 'whitelist', 62, false], '置頂列＋輸入列');
    place(q('#action-panel'), 355, 130);
    m = M();
    eq([m.bottomZoneHeight, m.src], [245, 'whitelist'], '投票卡：600 − 355');
    q('#action-panel').hidden = true;
    q('yt-live-chat-banner-manager').style.height = '0px';
    eq(M().bottomZoneHeight, 62, '沒有置頂訊息：只有輸入列');
  });

  test('覆蓋層（ytls-widget-overlay-manager）：容器本身不計、只計可見子元素；子元素量出 > 60% → 不採計', () => {
    reset();
    placeAbs(q('#ov-child'), 450, 100);
    let m = M();
    eq([m.bottomZoneHeight, m.src, m.overlayIgnored], [150, 'overlay', false], '覆蓋層子元素比白名單高');
    placeAbs(q('#ov-child'), 100, 400);
    m = M();
    eq([m.bottomZoneHeight, m.src, m.overlayIgnored], [115, 'whitelist', true], '> 60%：不採計（白名單不受此限）');
    q('#ov-child').hidden = true;
    place(q('#action-panel'), 150, 300);
    eq(M().bottomZoneHeight, 450, '白名單（投票卡）不套用 60% 規則');
  });

  test('VOD 重播（6.3 v26）：#input-panel 與置頂列高度 0 → 沒有輸入區（hasInput false、0）', () => {
    reset();
    q('yt-live-chat-banner-manager').style.height = '0px';
    q('#panel-pages').style.height = '0px';
    q('#input-panel').style.height = '0px';
    const m = M();
    eq([m.hasInput, m.bottomZoneHeight, m.src], [false, 0, 'none']);
  });

  test('彈窗偵測（6.3）：表符選單、購買流程 → popupOpen＋popupTop（最上方者）；$ 選單在 #input-panel 內不算（已含在高度內）；頂部列的下拉選單不算', () => {
    reset();
    placeAbs(q('yt-emoji-picker-renderer'), 250, 290);
    let m = M();
    eq([m.popupOpen, m.popupTop], [true, 250], '表符選單');
    placeAbs(q('yt-live-chat-message-buy-flow-renderer'), 120, 400);
    eq(M().popupTop, 120, '購買流程（較上方）');
    q('yt-emoji-picker-renderer').hidden = true; q('yt-live-chat-message-buy-flow-renderer').hidden = true;
    const pk = q('#product-picker'); pk.hidden = false;
    q('#input-panel').style.height = '';
    q('#panel-pages').style.top = (400 - 40) + 'px'; q('#panel-pages').style.height = '200px';
    m = M();
    eq([m.popupOpen, m.bottomZoneHeight > 115], [false, true], '$ 選單：不算彈窗，底部互動區變高');
    pk.hidden = true;
    q('#hdr-dd').hidden = false;
    eq(M().popupOpen, false, '頂部列內的下拉選單（F-12 自動切換時）不算');
  });

  test('回報（6.3）：只在變化時送 CHAT_INPUT_STATE；CHAT_INPUT_REQUEST 強制重送；PANEL_STATE on → 隱藏原生列表與頂部列（visibility）、退讓或關閉 → 還原；stop 後全部還原', async () => {
    reset();
    const sent = [];
    const CI = W().YTCAS_CHAT_INPUT;
    const ci = CI.create({ doc: D(), win: W(), S: W().YTCAS_SEL, C: W().YTCAS_CONST, post: (type, d) => sent.push([type, d]),
      accept: (e) => e.source === W().parent && !!e.data && e.data.__ytcas === true });
    ci.start();
    eq(sent.length, 1, '開始時送一次');
    eq([sent[0][0], sent[0][1].bottomZoneHeight], ['CHAT_INPUT_STATE', 115]);
    await sleep(700); // 保底輪詢 500ms：狀態沒變 → 不重送
    eq(sent.length, 1, '沒有變化不重送');
    place(q('#action-panel'), 355, 130);
    await until(() => sent.length === 2, 2000, '投票卡出現 → 重送');
    eq(sent[1][1].bottomZoneHeight, 245);
    W().__selfPost({ __ytcas: true, type: 'CHAT_INPUT_REQUEST' }); // 來源是 iframe 自己 → 不接受
    await sleep(150);
    eq(sent.length, 2, '只接受 parent 的要求');
    frame.contentWindow.postMessage({ __ytcas: true, type: 'CHAT_INPUT_REQUEST' }, location.origin);
    await sleep(150);
    // 上一行同樣是從本頁（parent）送出：e.source＝parent
    eq(sent.length, 3, 'CHAT_INPUT_REQUEST 強制重送');
    // 面板開啟 → 隱藏原生訊息列表與頂部列（visibility，不改 height／display）
    const vis = (s) => W().getComputedStyle(q(s)).visibility;
    const disp = (s) => W().getComputedStyle(q(s)).display;
    frame.contentWindow.postMessage({ __ytcas: true, type: 'PANEL_STATE', on: true, paused: false }, location.origin);
    await until(() => vis('#item-list') === 'hidden', 1000, '隱藏列表');
    eq([vis('yt-live-chat-header-renderer'), disp('#item-list'), vis('#input-panel')], ['hidden', 'block', 'visible'], '只用 visibility、輸入區照常');
    frame.contentWindow.postMessage({ __ytcas: true, type: 'PANEL_STATE', on: true, paused: true, reason: 'theater' }, location.origin);
    await until(() => vis('#item-list') === 'visible', 1000, '退讓 → 還原');
    frame.contentWindow.postMessage({ __ytcas: true, type: 'PANEL_STATE', on: true, paused: false }, location.origin);
    await until(() => vis('#item-list') === 'hidden', 1000);
    frame.contentWindow.postMessage({ __ytcas: true, type: 'PANEL_STATE', on: false, paused: false }, location.origin);
    await until(() => vis('#item-list') === 'visible', 1000, '關閉面板 → 還原（6.5 AC 7）');
    frame.contentWindow.postMessage({ __ytcas: true, type: 'PANEL_STATE', on: true, paused: false }, location.origin);
    await until(() => vis('#item-list') === 'hidden', 1000);
    ci.stop();
    eq([vis('#item-list'), !!D().getElementById(CI.HIDE_STYLE_ID)], ['visible', false], 'stop 後還原');
    const n = sent.length;
    q('#action-panel').hidden = true;
    await sleep(700);
    eq(sent.length, n, 'stop 後不再回報');
    // 隱私：只有數字、布林與來源代碼
    for (const [, d] of sent) assert(Object.values(d).every((v) => v === null || ['number', 'boolean'].includes(typeof v) || ['whitelist', 'overlay', 'fallback', 'zone', 'none'].includes(v)), JSON.stringify(d));
  });

  test('T6.1（30.3）點 $ 後 #input-panel 不見了：#panel-pages 改顯示 $ 頁面、或只剩購買流程 → 仍有互動區（hasInput、purchase）、不退回全高；VOD 的 #panel-pages 1px 不算', () => {
    reset();
    // #panel-pages 改顯示 $ 頁面（推測結構）
    q('#input-panel').hidden = true;
    q('#purchase-page').hidden = false;
    place(q('#panel-pages'), 300, 300);
    let m = M();
    eq([m.hasInput, m.purchase, m.bottomZoneHeight, m.inputH], [true, true, 300, 0], '#panel-pages 顯示 $ 頁面');
    // 只剩聊天室內的購買流程（#panel-pages 高度 0）
    q('#purchase-page').hidden = true;
    q('#panel-pages').style.height = '0px';
    q('yt-live-chat-banner-manager').style.height = '0px';
    placeAbs(q('yt-live-chat-message-buy-flow-renderer'), 200, 400);
    m = M();
    eq([m.hasInput, m.purchase, m.bottomZoneHeight, m.popupOpen, m.popupTop, m.src], [true, true, 400, true, 200, 'zone'], '購買流程');
    // 一般狀態：輸入區可見、沒有 $ → purchase false
    reset();
    m = M();
    eq([m.hasInput, m.purchase, m.bottomZoneHeight], [true, false, 115]);
    // $ 選單在 #input-panel 內展開 → purchase（剩餘高度不足時不退讓）
    q('#product-picker').hidden = false;
    eq(M().purchase, true, '$ 選單展開');
    // VOD：#panel-pages 高 1px、#input-panel 高 0
    reset();
    q('yt-live-chat-banner-manager').style.height = '0px';
    place(q('#panel-pages'), 599, 1); // 實機 VOD：底邊 1px（dom-notes 第 3 節）
    q('#input-panel').style.height = '0px';
    m = M();
    eq([m.hasInput, m.purchase, m.bottomZoneHeight], [false, false, 1], 'VOD 仍是沒有輸入區（面板全高）');
  });

  test('T6.1（30.2，使用者選 A）面板開啟時原生置頂列也隱藏（visibility）→ 不算底部互動區（只露出輸入列）；投票卡照樣露出；退讓或關閉 → 置頂列恢復並重新回報', async () => {
    reset();
    const sent = [];
    const CI = W().YTCAS_CHAT_INPUT;
    const ci = CI.create({ doc: D(), win: W(), S: W().YTCAS_SEL, C: W().YTCAS_CONST, post: (type, d) => sent.push(d),
      accept: (e) => e.source === W().parent && !!e.data && e.data.__ytcas === true });
    ci.start();
    const bz = () => sent[sent.length - 1].bottomZoneHeight;
    const vis = (s) => W().getComputedStyle(q(s)).visibility;
    eq(bz(), 115, '面板關閉：置頂列＋輸入列');
    frame.contentWindow.postMessage({ __ytcas: true, type: 'PANEL_STATE', on: true, paused: false }, location.origin);
    await until(() => bz() === 62, 2000, '隱藏置頂列後重新回報');
    eq([vis('yt-live-chat-banner-manager'), vis('#input-panel'), W().getComputedStyle(q('yt-live-chat-banner-manager')).display], ['hidden', 'visible', 'block'], '只用 visibility');
    place(q('#action-panel'), 355, 130);
    await until(() => bz() === 245, 2000, '投票卡照樣露出');
    q('#action-panel').hidden = true;
    frame.contentWindow.postMessage({ __ytcas: true, type: 'PANEL_STATE', on: true, paused: true, reason: 'theater' }, location.origin);
    await until(() => bz() === 115 && vis('yt-live-chat-banner-manager') === 'visible', 2000, '退讓 → 置頂列恢復');
    ci.stop();
  });

  test('T6.4（35.1）置頂列裡的投票橫幅：面板開啟時置頂列隱藏、只露出含投票的 banner-renderer（置頂訊息維持隱藏）並算進底部互動區；收合 40px → 展開時 ResizeObserver 更新；#action-panel 投票卡照舊；關閉面板 → 還原', async () => {
    reset();
    const S = W().YTCAS_SEL;
    eq([S.chat.pollCard, S.chat.pollBanner], ['yt-live-chat-banner-poll-renderer', 'yt-live-chat-banner-renderer:has(yt-live-chat-banner-poll-renderer)'], '已驗證的選擇器（dom-notes 2.11）');
    // 實機結構（35.1）：banner-manager > div#visible-banners > banner-renderer > div#banner-container > div#contents > banner-poll-renderer
    const mk = (tag, attrs, kids) => { const e = D().createElement(tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); for (const k of kids || []) e.append(k); return e; };
    const mgr = q('yt-live-chat-banner-manager');
    mgr.style.top = ''; mgr.style.height = ''; mgr.style.bottom = '62px'; // 底邊貼著輸入列（#panel-pages 538～600）
    const pinned = mk('yt-live-chat-banner-renderer', { style: 'display:block;height:40px;overflow:hidden' }, [mk('div', { id: 'banner-container' }, [mk('div', { id: 'contents' }, [mk('yt-live-chat-banner-header-renderer')])])]);
    const pollR = mk('yt-live-chat-banner-poll-renderer', { style: 'display:block;height:32px' });
    const pollB = mk('yt-live-chat-banner-renderer', { style: 'display:block;height:40px;overflow:hidden' }, [mk('div', { id: 'banner-container' }, [mk('div', { id: 'contents' }, [pollR])])]);
    const vb = mk('div', { id: 'visible-banners' }, [pinned, pollB]);
    mgr.append(vb);
    const vis = (el) => W().getComputedStyle(el).visibility;
    const sent = [];
    const ci = W().YTCAS_CHAT_INPUT.create({ doc: D(), win: W(), S, C: W().YTCAS_CONST, post: (type, d) => sent.push(d),
      accept: (e) => e.source === W().parent && !!e.data && e.data.__ytcas === true });
    const bz = () => sent[sent.length - 1].bottomZoneHeight;
    try {
      ci.start();
      eq(bz(), 142, '面板關閉：置頂列整體（置頂訊息＋投票，600 − 458）');
      frame.contentWindow.postMessage({ __ytcas: true, type: 'PANEL_STATE', on: true, paused: false }, location.origin);
      await until(() => bz() === 102, 2000, '只露出投票橫幅（600 − 498）');
      eq([vis(mgr), vis(pinned), vis(pollB), vis(pollR)], ['hidden', 'hidden', 'visible', 'visible'], '置頂訊息維持隱藏、投票露出');
      // 展開（使用者點開）：banner-renderer 40 → 120px，置頂列往上長
      pollB.style.height = '120px';
      await until(() => bz() === 182, 2000, '展開 → ResizeObserver 更新（600 − 418）');
      pollB.style.height = '40px';
      await until(() => bz() === 102, 2000, '收合 → 回到 102');
      // 投票結束（投票橫幅移除）→ 只剩輸入列
      pollB.remove();
      await until(() => bz() === 62, 2000, '沒有投票：置頂訊息照 30.2 選 A 隱藏');
      // #action-panel 那種投票卡維持原白名單
      place(q('#action-panel'), 355, 130);
      await until(() => bz() === 245, 2000, '#action-panel 投票卡');
      q('#action-panel').hidden = true;
      frame.contentWindow.postMessage({ __ytcas: true, type: 'PANEL_STATE', on: false }, location.origin);
      await until(() => vis(mgr) === 'visible', 2000, '關閉 → 還原');
    } finally { ci.stop(); vb.remove(); mgr.style.bottom = ''; }
  });

  test('T6.3（33.8.4）P7 poll-structure：找到標籤或 id 含 poll／action-panel 的元素 → 記祖先鏈、位置、visibility、是否在面板隱藏範圍內；大小改變再記；只在記錄中運作；沒有文字', async () => {
    reset();
    const logs = [];
    let active = false;
    const CI = W().YTCAS_CHAT_INPUT;
    const poll = D().createElement('yt-live-chat-poll-renderer');
    poll.style.display = 'block'; poll.style.height = '40px'; poll.textContent = '投票題目';
    q('#item-list').appendChild(poll); // 模擬：投票卡在訊息列表範圍內（實際位置待實機）
    const pw = CI.watchPolls({ doc: D(), win: W(), S: W().YTCAS_SEL, active: () => active, onLog: (k, d) => logs.push([k, d]) });
    pw.scan();
    eq(logs.length, 0, '沒有在記錄：不記');
    active = true;
    pw.scan();
    await until(() => logs.length >= 1, 2000, '找到投票卡');
    const d = logs[0][1];
    eq([logs[0][0], d.why, d.t, d.h, d.underHidden, d.inItems], ['poll-structure', 'found', 'yt-live-chat-poll-renderer', 40, true, false]);
    assert(d.chain.some((c) => c.t === 'div#item-list') && d.chain[d.chain.length - 1].t === 'yt-live-chat-app', '祖先鏈到 yt-live-chat-app ' + JSON.stringify(d.chain.map((c) => c.t)));
    poll.style.height = '160px';
    await until(() => logs.some(([, x]) => x.why === 'resize' && x.h === 160), 2000, '展開後再記');
    // #action-panel 也算（id 含 action-panel）
    q('#action-panel').hidden = false;
    q('#action-panel').style.height = '30px';
    pw.scan();
    await until(() => logs.some(([, x]) => x.t === 'div#action-panel'), 2000, '#action-panel');
    pw.stop();
    poll.remove();
    assert(!JSON.stringify(logs).includes('投票題目'), '沒有文字');
    const SAFE = /^[A-Za-z0-9_\-#.:/ ,=+()[\]|]{0,160}$/;
    for (const [, x] of logs) for (const c of [x, ...x.chain]) for (const k of ['t', 'vis', 'ov', 'mh']) if (c[k] != null) assert(SAFE.test(String(c[k])), '可通過消毒：' + k + '=' + c[k]);
  });

  test('T6.1（30.1）表符選單在輸入列下方（輸入列被往上推）：bottomZoneHeight 涵蓋被推上去的輸入列（top 端取 min(popupTop, 底部互動區頂端) − 8）', () => {
    reset();
    place(q('#panel-pages'), 200, 400); // #input-panel 在 #panel-pages 頂端（200）
    placeAbs(q('yt-emoji-picker-renderer'), 262, 338);
    const m = M();
    eq([m.popupOpen, m.popupTop, m.bottomZoneHeight], [true, 262, 400]);
    assert(Math.min(m.popupTop, m.vh - m.bottomZoneHeight) === 200, '最上方是輸入列（200）');
  });

  test('T6.1（30.1、30.3）F-20 P7 zone-structure：$ 流程或彈窗開著時、結構改變才記一筆，關上時再記一筆；只有標籤、靜態 id、可見、高度、頂端（沒有文字）', async () => {
    reset();
    const logs = [];
    const CI = W().YTCAS_CHAT_INPUT;
    const ci = CI.create({ doc: D(), win: W(), S: W().YTCAS_SEL, C: W().YTCAS_CONST, post: () => {}, onLog: (k, d) => logs.push([k, d]),
      accept: () => false });
    ci.start();
    eq(logs.length, 0, '一般狀態不記');
    q('#input-panel').hidden = true;
    q('#purchase-page').hidden = false;
    place(q('#panel-pages'), 300, 300);
    ci.send(false);
    eq(logs.length, 1);
    const [k, d] = logs[0];
    eq([k, d.reason, d.m.purchase, d.m.hasInput], ['zone-structure', 'purchase', true, true]);
    const role = (r) => d.els.find((x) => x.role === r);
    eq([role('panel-pages').v, role('panel-pages').h, role('input-panel').v], [true, 300, false]);
    assert(d.els.some((x) => x.role === 'panel-pages-child' && x.t === 'div#purchase-page' && x.v), '#panel-pages 的子元素');
    ci.send(false);
    eq(logs.length, 1, '結構沒變不重記');
    reset();
    ci.send(false);
    eq([logs.length, logs[1][1].reason], [2, 'closed'], '關上時記一筆');
    ci.send(false);
    eq(logs.length, 2, '一般狀態不再記');
    // 表符選單 → popup；輸入列的位置也在記錄內（上下關係）
    placeAbs(q('yt-emoji-picker-renderer'), 250, 290);
    ci.send(false);
    eq(logs[2][1].reason, 'popup');
    assert(logs[2][1].els.some((x) => x.role === 'emoji' && x.top === 250 && x.v), '表符選單位置');
    // v51（32.6）投票卡出現 → reason action-panel，記錄內部元件標籤
    q('yt-emoji-picker-renderer').hidden = true;
    const ap = q('#action-panel');
    ap.textContent = '';
    const poll = D().createElement('yt-live-chat-poll-renderer'); poll.style.display = 'block'; poll.style.height = '120px';
    poll.appendChild(D().createElement('div')).id = 'choices';
    ap.appendChild(poll);
    place(ap, 355, 130);
    ci.send(false);
    const apLog = logs[logs.length - 1][1];
    eq(apLog.reason, 'action-panel');
    assert(apLog.els.some((x) => x.role === 'action-panel-child' && x.t === 'yt-live-chat-poll-renderer' && x.v), '投票卡元件標籤 ' + JSON.stringify(apLog.els.filter((x) => /action/.test(x.role))));
    assert(apLog.els.some((x) => x.role === 'action-panel-grandchild' && x.t === 'div#choices'), '第二層');
    ap.hidden = true;
    ci.stop();
    // v51（32.1）role 全部通過 background 的消毒規則（v50 的 'panel-pages>' 被換成 [removed]）
    const SAFE = /^[A-Za-z0-9_\-#.:/ ,=+()[\]|]{0,160}$/;
    for (const [, d] of logs) for (const x of d.els) assert(SAFE.test(x.role) && SAFE.test(x.t), 'role／標籤可通過消毒：' + x.role + ' ' + x.t);
    const s = JSON.stringify(logs);
    assert(!s.includes('聊天室') && !s.includes('"$"'), '沒有文字');
  });

  // ---------------------------------------------------------------- 執行
  (async () => {
    const list = document.getElementById('list');
    const results = [];
    for (const t of tests) {
      const li = document.createElement('li');
      const t0 = performance.now();
      try { await t.fn(); li.className = 'ok'; li.textContent = '✅ ' + t.name + '（' + Math.round(performance.now() - t0) + ' ms）'; results.push({ name: t.name, ok: true }); }
      catch (e) { li.className = 'ng'; li.textContent = '❌ ' + t.name + ' — ' + (e && e.message); results.push({ name: t.name, ok: false, error: String(e && e.message) }); console.error(e); }
      list.appendChild(li);
    }
    const ok = results.filter((r) => r.ok).length;
    document.getElementById('summary').textContent = '通過 ' + ok + ' / ' + results.length;
    window.__results = results;
  })();
})();
