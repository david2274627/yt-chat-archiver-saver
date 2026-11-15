// content script：三種環境（SPEC 3.1、F-19）
//   1. top watch 頁（www.youtube.com/watch）：場次資訊提供者（STREAM_INFO）、F-19 自動接手；按鈕、面板、clip-path 於 T5／T6 實作
//   2. 嵌入式 chat frame（iframe 內的 /live_chat、/live_chat_replay）：擷取、修剪
//   3. 彈出式聊天室（頂層頁面的 /live_chat、/live_chat_replay）：擷取、修剪
// 輸出到 console 的內容只有標籤、筆數與時間，不含訊息文字。
(function () {
  'use strict';
  const C = globalThis.YTCAS_CONST;
  const S = globalThis.YTCAS_SEL;
  const CAP = globalThis.YTCAS_CAPTURE;
  if (!C || !S) return;
  const FM = C.FM;
  const RT = C.RT;
  const YT = C.YT_ORIGIN;

  const path = location.pathname;
  const isTop = window === window.top;
  const isChatPath = path.startsWith('/live_chat'); // 含 /live_chat_replay
  const env = isChatPath ? (isTop ? 'popout' : 'chatframe') : (isTop ? 'top' : 'other');

  const connected = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; } };
  const send = (msg) => {
    if (!connected()) return Promise.reject(Object.assign(new Error('disconnected'), { disconnected: true }));
    return chrome.runtime.sendMessage(msg);
  };
  const isVideoId = (v) => typeof v === 'string' && /^[\w-]{6,20}$/.test(v);

  if (env === 'chatframe' || env === 'popout') runChat();
  else if (env === 'top') runTop();

  // ================================================================ chat frame／彈出式聊天室
  function runChat() {
    if (!CAP) return;
    const replay = path.startsWith('/live_chat_replay');
    // 彈出視窗的重播仍記為 replay（offset 來自影片時間）；直播的彈出視窗記為 popout（F-19）
    const source = replay ? 'replay' : (env === 'popout' ? 'popout' : 'live');
    const urlVid = new URLSearchParams(location.search).get('v');

    const post = (type, payload) => {
      if (env !== 'chatframe') return;
      try { window.parent.postMessage(Object.assign({ __ytcas: true, type }, payload || {}), YT); } catch (_) { /* 非 YouTube 頁面內嵌 */ }
    };

    // 診斷（只記屬性名稱與狀態）：phase 判斷來源（F-14 第 3 點）與 F-12 結果。F-12 有結果時輸出，最晚 10 秒
    let diagDone = false;
    const diag = (f12) => {
      if (diagDone) return;
      diagDone = true;
      const r = document.querySelector(S.chat.renderer);
      const s = engine.state();
      console.info('[ytcas] 聊天室環境（診斷）', { env, source, rendererAttrs: r ? r.getAttributeNames() : null,
        hasItems: !!document.querySelector(S.chat.items), urlHasV: !!urlVid, mode: s.mode,
        viewMode: (f12 && f12.viewMode) || s.viewMode, f12: (f12 && f12.f12) || s.f12 || 'not-run' });
    };
    const engine = CAP.createEngine({
      doc: document, source, send, isConnected: connected,
      onStatus: (s) => post(FM.CAPTURE_STATUS, s),
      onF12: (r) => diag(r),
    });
    setTimeout(() => diag(null), 10000);
    engine.start();

    if (env === 'popout') {
      if (isVideoId(urlVid)) engine.setInfo({ videoId: urlVid });
      else { S.warnOnce('popout:videoId', location.pathname); engine.noVideoId(); }
    } else {
      // 嵌入式：網址通常只有 continuation，videoId 以 top frame 的 STREAM_INFO 為準（4.3 v29）
      let got = false;
      window.addEventListener('message', (e) => {
        if (e.origin !== YT || e.source !== window.parent || !e.data || e.data.__ytcas !== true) return;
        if (e.data.type !== FM.STREAM_INFO) return;
        const d = e.data;
        if (!isVideoId(d.videoId)) return;
        got = true;
        engine.setInfo({
          videoId: d.videoId, title: str(d.title), channelName: str(d.channelName), channelHandle: str(d.channelHandle),
          channelUrl: str(d.channelUrl), startDate: num(d.startDate), endDate: num(d.endDate),
          isLiveBroadcast: typeof d.isLiveBroadcast === 'boolean' ? d.isLiveBroadcast : null, duration: num(d.duration),
        });
      });
      const t0 = Date.now();
      const ask = () => {
        if (got) return;
        if (Date.now() - t0 > C.STREAM_INFO_MAX_WAIT_MS) {
          if (isVideoId(urlVid)) engine.setInfo({ videoId: urlVid });
          else { S.warnOnce('chatframe:STREAM_INFO', '30 秒內沒有收到 top frame 的場次資訊'); engine.noVideoId(); }
          return;
        }
        post(FM.STREAM_INFO_REQUEST);
        setTimeout(ask, C.STREAM_INFO_RETRY_MS);
      };
      ask();
    }

    // F-15：暫停設定變更 → 重新判斷（暫停由 background 的 SAVE_MESSAGES 回應 paused 生效）
    try {
      chrome.storage.onChanged.addListener((changes) => {
        if ('captureEnabled' in changes || 'captureExcludedChannels' in changes) engine.recheckPolicy();
      });
    } catch (_) { /* ignore */ }

    // 離開頁面：送出剩餘訊息並結束 session（送不到時由 background 以最後寫入時間補 endedAt）
    window.addEventListener('pagehide', () => engine.stop());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') engine.flush(); });
  }

  function str(v) { return typeof v === 'string' ? v.slice(0, 500) : ''; }
  function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }

  // ================================================================ top watch 頁
  function runTop() {
    const T = S.top;
    let lastStatus = null; // 嵌入式聊天室回報的 CAPTURE_STATUS
    let diagFor = '';

    const currentVideoId = () => {
      if (location.pathname === '/watch') return new URLSearchParams(location.search).get('v');
      const m = /^\/live\/([\w-]{6,20})/.exec(location.pathname);
      return m ? m[1] : null;
    };
    const chatIframe = () => document.querySelector(T.chatIframe);
    const metaContent = (sel) => { const el = document.querySelector(sel); return el ? el.getAttribute('content') : null; };
    const parseDate = (s) => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : null; };

    function streamInfo() {
      const videoId = currentVideoId();
      if (!isVideoId(videoId)) return null;
      const a = document.querySelector(T.channelLink);
      const href = a ? a.getAttribute('href') || '' : '';
      const hm = /^\/(@[^/?#]+)/.exec(href);
      let handle = '';
      if (hm) { try { handle = decodeURIComponent(hm[1]); } catch (_) { handle = hm[1]; } }
      const live = metaContent(T.isLiveMeta);
      const v = document.querySelector(T.video);
      const d = v && Number.isFinite(v.duration) && v.duration > 0 ? Math.round(v.duration) : null;
      return {
        videoId,
        title: metaContent(T.titleMeta) || '',
        channelName: a ? (a.textContent || '').trim() : '',
        channelHandle: handle,
        channelUrl: href ? new URL(href, YT).href : '',
        startDate: parseDate(metaContent(T.startDateMeta)),
        endDate: parseDate(metaContent(T.endDateMeta)),
        isLiveBroadcast: live == null ? null : /^true$/i.test(live),
        duration: d,
      };
    }

    function sendInfo() {
      const f = chatIframe();
      const info = streamInfo();
      if (!f || !f.contentWindow || !info) return;
      try { f.contentWindow.postMessage(Object.assign({ __ytcas: true, type: FM.STREAM_INFO }, info), YT); } catch (_) { /* ignore */ }
      if (diagFor !== info.videoId) {
        diagFor = info.videoId;
        // 診斷（F-14 phase 判斷來源）：只記是否存在與時間，不記標題與聊天內容
        const iso = (t) => (t == null ? null : new Date(t).toISOString());
        console.info('[ytcas] 場次資訊（診斷）', { videoId: info.videoId, startDate: iso(info.startDate), endDate: iso(info.endDate),
          isLiveBroadcast: info.isLiveBroadcast, rawIsLive: metaContent(T.isLiveMeta), duration: info.duration,
          hasStartDateMeta: !!document.querySelector(T.startDateMeta), hasEndDateMeta: !!document.querySelector(T.endDateMeta),
          now: new Date().toISOString() });
      }
    }

    window.addEventListener('message', (e) => {
      const f = chatIframe();
      if (e.origin !== YT || !f || e.source !== f.contentWindow || !e.data || e.data.__ytcas !== true) return;
      if (e.data.type === FM.STREAM_INFO_REQUEST) sendInfo();
      else if (e.data.type === FM.CAPTURE_STATUS) {
        lastStatus = { videoId: e.data.videoId, capturing: !!e.data.capturing, reason: e.data.reason || null, at: Date.now() };
      }
    });

    // 影片長度（F-18）：重播的 video 長度可能稍晚才確定
    let boundVideo = null;
    function bindVideo() {
      const v = document.querySelector(T.video);
      if (!v || v === boundVideo) return;
      boundVideo = v;
      v.addEventListener('durationchange', sendInfo);
      v.addEventListener('loadedmetadata', sendInfo);
    }

    document.addEventListener('yt-navigate-finish', () => {
      lastStatus = null;
      bindVideo();
      setTimeout(sendInfo, 800); // microdata 隨導航更新的時機待實機確認；chat frame 也會主動要求
    });

    // 聊天室 iframe 狀態（診斷）：彈出視窗開啟時主分頁的嵌入式聊天室是否仍存在（F-19 第 4 點，待實機確認）
    let lastFrameKey = '';
    setInterval(() => {
      bindVideo();
      const f = chatIframe();
      let p = null;
      try { p = f && f.contentWindow ? f.contentWindow.location.pathname : null; } catch (_) { p = 'cross-origin'; }
      const st = { present: !!f, visible: !!(f && f.offsetHeight > 0), path: p, height: f ? f.offsetHeight : 0 };
      const key = JSON.stringify([st.present, st.visible, st.path]);
      if (key !== lastFrameKey) {
        lastFrameKey = key;
        if (currentVideoId()) console.info('[ytcas] 聊天室 iframe 狀態（診斷）', st);
      }
    }, 1000);

    // F-19：彈出視窗關閉 → 主分頁自動接手（展開聊天室、恢復收錄；預設開啟面板於 T5）
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (!msg || msg.type !== RT.CAPTURE_END || msg.source !== 'popout' || msg.videoId !== currentVideoId()) return;
        handoff();
      });
    } catch (_) { /* ignore */ }

    function handoff() {
      const f = chatIframe();
      const visible = !!(f && f.offsetHeight > 0);
      if (visible && lastStatus && lastStatus.capturing && lastStatus.videoId === currentVideoId()) {
        console.info('[ytcas] 彈出視窗已關閉；主分頁聊天室已在收錄中');
        return;
      }
      if (!visible) {
        const t = S.findChatTeaser(document, C.OPEN_PANEL_LABELS);
        if (!t || t.button.disabled) { S.warnOnce('handoff:teaser', '找不到可用的「開啟面板」，無法自動展開聊天室'); return; }
        console.info('[ytcas] 彈出視窗已關閉，自動展開聊天室恢復收錄');
        t.button.click();
        return;
      }
      // 聊天室看得到但沒有在收錄：等 chat frame 回報（它會自己開始）；5 秒後仍沒有就記錄一次
      setTimeout(() => {
        if (!(lastStatus && lastStatus.capturing)) console.warn('[ytcas] 彈出視窗已關閉，但主分頁聊天室沒有回報收錄中', lastStatus && lastStatus.reason);
      }, 5000);
    }

    bindVideo();
  }
})();
