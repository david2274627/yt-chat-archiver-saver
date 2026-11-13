// PoC 下層面板（擴充功能 iframe）：點擊/滾輪透過 postMessage 回報給 top frame（T9 移除）
(function () {
  'use strict';
  const YT = 'https://www.youtube.com';
  const list = document.getElementById('list');
  for (let i = 1; i <= 200; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `測試列 #${i}（點我）`;
    b.dataset.i = String(i);
    list.appendChild(b);
  }
  const post = (msg) => window.parent.postMessage(Object.assign({ __ytcas: true, type: 'POC_STAT' }, msg), YT);
  list.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    list.querySelectorAll('button.hit').forEach((x) => x.classList.remove('hit'));
    b.classList.add('hit');
    post({ kind: 'click', i: b.dataset.i });
  });
  let lastWheel = 0;
  document.addEventListener('wheel', () => {
    const now = Date.now();
    if (now - lastWheel < 50) return; // 節流
    lastWheel = now;
    post({ kind: 'wheel' });
  }, { passive: true });
  console.log('[ytcas-poc] panel iframe origin', location.origin);
})();
