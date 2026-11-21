// 對比度檢查（SPEC 10.3：本文 ≥ 4.5、次要 ≥ 3）。用法：node tools/check-contrast.js src/styles/tokens.css
const fs = require('fs');
const css = fs.readFileSync(process.argv[2], 'utf8');
function block(sel) {
  const i = css.indexOf(sel + ' {');
  const j = css.indexOf('}', i);
  const o = {};
  for (const m of css.slice(i, j).matchAll(/--ytcas-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) o[m[1]] = m[2];
  return o;
}
const lum = (hex) => {
  const c = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const PAIRS = [
  // [前景, 背景, 最低要求, 用途]
  ['text', 'surface', 4.5, '本文'], ['text', 'bg', 4.5, '本文（頁面底）'], ['text', 'surface-2', 4.5, '本文（hover／輸入框）'],
  ['text-2', 'surface', 4.5, '次要內容（副標、說明）'], ['text-2', 'surface-2', 4.5, '次要內容（輸入框）'],
  ['text-3', 'surface', 3, '提示文字（@handle、placeholder）'], ['text-3', 'surface-2', 3, '提示文字（輸入框）'],
  ['accent', 'surface', 4.5, '強調色文字'], ['accent', 'accent-soft', 4.5, '選中膠囊'],
  ['on-accent', 'accent', 4.5, '主按鈕文字'], ['on-danger', 'danger', 4.5, '關閉優化面板'],
  ['timecode', 'surface', 4.5, '時間碼'], ['timecode', 'accent-soft', 4.5, '時間碼（VOD 當前訊息）'],
  ['owner', 'surface', 4.5, '主播名稱'], ['moderator', 'surface', 4.5, '管理員名稱'], ['member', 'surface', 4.5, '會員名稱'],
  ['raid', 'raid-soft', 4.5, '降落標籤'], ['text', 'raid-soft', 4.5, '降落列本文'],
  ['gift', 'gift-soft', 4.5, '禮物標籤'], ['text', 'gift-soft', 4.5, '禮物卡本文'],
  ['text', 'highlight', 4.5, '搜尋 mark'], ['text-3', 'bg', 3, '提示文字（頁面底）'],
  ['owner', 'surface-2', 4.5, '主播徽章'], ['moderator', 'surface-2', 4.5, '管理員徽章'], ['member', 'surface-2', 4.5, '會員徽章'],
  ['accent', 'surface-2', 4.5, '強調色文字（輸入框底）'], ['text-3', 'raid-soft', 3, '降落列提示文字'],
  ['current-ring', 'surface', 3, 'VOD 當前藍框（非文字）'], ['focus-ring', 'surface', 3, 'focus 外框（非文字）'],
  // v46（T5.5，審查十一 24.6）四種卡片：SC／超級貼圖（底色來自訊息，文字色依對比度選黑白，見 parseColor；沒有顏色時 text／surface-2）、
  // 禮物（gift-soft）、會員里程碑（member-strong 標題列＋member-soft 留言區）
  ['text-2', 'gift-soft', 4.5, '禮物卡內文（.sub）'], ['text-3', 'gift-soft', 3, '禮物卡提示文字（@handle、不可點時間碼）'],
  ['timecode', 'gift-soft', 4.5, '禮物卡時間碼'], ['text-2', 'raid-soft', 4.5, '降落列內文（.sub）'],
  ['on-member', 'member-strong', 4.5, '里程碑標題列（名稱、月數、時間碼）'], ['member', 'member-soft', 4.5, '里程碑徽章'],
  ['text', 'member-soft', 4.5, '里程碑留言'], ['member-strong', 'surface', 3, '里程碑標題列與面板底的區隔（非文字）'],
  ['text', 'accent-soft', 4.5, '會員列／目前訊息本文'],
];
let fail = 0;
const rows = [];
for (const [name, sel] of [['淺色', ':root'], ['深色', '[data-theme="dark"]']]) {
  const base = block(':root');
  const t = name === '淺色' ? base : { ...base, ...block(sel) };
  for (const [f, b, min, use] of PAIRS) {
    const r = ratio(t[f], t[b]);
    const ok = r >= min;
    if (!ok) fail++;
    rows.push(`| ${name} | ${use} | \`${f}\` ${t[f]} / \`${b}\` ${t[b]} | ${r.toFixed(2)} | ≥ ${min} | ${ok ? '✅' : '❌'} |`);
  }
}
console.log('| 主題 | 用途 | 前景 / 背景 | 對比度 | 要求 | 結果 |\n|---|---|---|---|---|---|\n' + rows.join('\n'));
console.log('\nFAIL=' + fail);
process.exit(fail ? 1 : 0);
