// 以本 frame 自己的身分送訊息給自己（e.source = 本 frame，不是 parent）：驗證只接受 parent 的訊息
window.__selfPost = (m) => window.postMessage(m, location.origin);
