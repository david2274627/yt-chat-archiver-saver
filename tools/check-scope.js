#!/usr/bin/env node
// 跨函式引用區域識別字檢查（審查十一第 12 節，T5.1）。沒有相依套件（CLAUDE.md）。
// 用法：node tools/check-scope.js src/content.js src/panel.js …（不帶參數時檢查 src/*.js）
//
// 抓的問題：IIFE 內「最外層的函式」A 使用了只宣告在另一個最外層函式 B 內的識別字
//（例：headerButton() 宣告在 runChat() 外，卻呼叫 runChat 的區域函式 post → ReferenceError）。
// 作法（近似，非完整的 JS 解析）：
//   1. 簡易斷詞：略過註解、字串、樣板字串（${} 內仍斷詞）、正規表示式字面值。
//   2. 找出 IIFE 內最外層（大括號深度 1）的 function 宣告與其範圍。
//   3. 每個範圍收集「宣告」：const／let／var 後的名稱（含簡單解構）、function 名稱、函式與箭頭函式的參數、catch 參數。
//   4. 每個最外層函式中使用的識別字（前面不是「.」、後面不是物件字面值的「:」），若不在自己的宣告、
//      IIFE 層級的宣告中，卻出現在其他最外層函式的宣告中 → 回報。
// 限制：不分辨巢狀作用域（同一個最外層函式內一律視為可見）；這個檢查只針對「跨最外層函式」這一類錯誤。
'use strict';
const fs = require('fs');
const path = require('path');

const KEYWORDS = new Set(('break case catch class const continue debugger default delete do else export extends finally for function if import in ' +
  'instanceof let new return super switch this throw try typeof var void while with yield await async of static get set null true false undefined').split(' '));

// 方法簡寫判斷時排除的控制結構關鍵字（`{ for (…) {` 不是方法；get／set 等可以是方法名稱）
const CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'function', 'return', 'typeof', 'await', 'new']);

function tokenize(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  const isIdStart = (c) => /[A-Za-z_$À-￿]/.test(c);
  const isId = (c) => /[A-Za-z0-9_$À-￿]/.test(c);
  // 正規表示式可以出現的位置：前一個有意義的 token 是運算子／標點或特定關鍵字
  const regexOk = () => {
    const t = toks[toks.length - 1];
    if (!t) return true;
    if (t.type === 'id') return ['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof'].includes(t.v);
    if (t.type === 'num' || t.type === 'str') return false;
    return !/^[)\]}]$/.test(t.v);
  };
  const stack = []; // 樣板字串的 ${ 巢狀
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); i = i < 0 ? n : i + 2; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      toks.push({ type: 'str', v: '', p: i }); i = j + 1; continue;
    }
    if (c === '`' || (c === '}' && stack.length && stack[stack.length - 1] === 0)) {
      if (c === '}') stack.pop();
      let j = i + 1;
      while (j < n && src[j] !== '`') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') { stack.push(0); j += 2; break; }
        j++;
      }
      if (src[j - 1] === '{' && src[j - 2] === '$') { toks.push({ type: 'str', v: '', p: i }); i = j; continue; }
      toks.push({ type: 'str', v: '', p: i }); i = j + 1; continue;
    }
    if (c === '/' && regexOk()) {
      let j = i + 1, cls = false;
      while (j < n && (src[j] !== '/' || cls)) { if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; j++; }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      toks.push({ type: 'str', v: '', p: i }); i = j; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]))) {
      let j = i + 1; while (j < n && /[0-9a-zA-Z_.]/.test(src[j])) j++;
      toks.push({ type: 'num', v: src.slice(i, j), p: i }); i = j; continue;
    }
    if (isIdStart(c)) {
      let j = i + 1; while (j < n && isId(src[j])) j++;
      toks.push({ type: 'id', v: src.slice(i, j), p: i }); i = j; continue;
    }
    if (c === '{' && stack.length) stack[stack.length - 1]++;
    if (c === '}' && stack.length) stack[stack.length - 1]--;
    const three = src.slice(i, i + 3);
    if (three === '...' || three === '===' || three === '!==' || three === '**=' || three === '>>>') { toks.push({ type: 'p', v: three, p: i }); i += 3; continue; }
    const two = src.slice(i, i + 2);
    if (['=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>'].includes(two)) { toks.push({ type: 'p', v: two, p: i }); i += 2; continue; }
    toks.push({ type: 'p', v: c, p: i }); i++;
  }
  return toks;
}

// 從 tokens[a..b) 收集宣告的名稱
function declsIn(t, a, b) {
  const out = new Set();
  const addPattern = (k) => { // 簡單解構：{ a, b: c, ...d } / [a, b]；回傳結束位置
    let depth = 0;
    for (; k < b; k++) {
      const x = t[k];
      if (x.v === '{' || x.v === '[') depth++;
      else if (x.v === '}' || x.v === ']') { depth--; if (depth === 0) return k; }
      else if (x.type === 'id' && !KEYWORDS.has(x.v)) {
        const nx = t[k + 1];
        if (nx && nx.v === ':') continue; // 鍵名（後面的才是變數）
        out.add(x.v);
        if (nx && nx.v === '=') { // 預設值：略過到下一個 , 或結尾
          let d = 0;
          for (k += 2; k < b; k++) { if (/[{[(]/.test(t[k].v)) d++; else if (/[}\])]/.test(t[k].v)) { if (d === 0) { k--; break; } d--; } else if (t[k].v === ',' && d === 0) break; }
        }
      }
    }
    return k;
  };
  const params = (k) => { // k 指向 '('
    let d = 0;
    for (; k < b; k++) {
      const x = t[k];
      if (x.v === '(' || x.v === '{' || x.v === '[') d++;
      else if (x.v === ')' || x.v === '}' || x.v === ']') { d--; if (d === 0) return k; }
      else if (x.type === 'id' && !KEYWORDS.has(x.v) && d >= 1) {
        const nx = t[k + 1], pv = t[k - 1];
        if (nx && nx.v === ':') continue;
        if (pv && pv.v === '=') continue; // 預設值中的識別字是使用，不是宣告
        out.add(x.v);
      }
    }
    return k;
  };
  for (let k = a; k < b; k++) {
    const x = t[k];
    if (x.type !== 'id') continue;
    if ((x.v === 'const' || x.v === 'let' || x.v === 'var')) {
      // 同一個宣告可能有多個：const a = 1, b = 2
      let j = k + 1;
      while (j < b) {
        if (t[j].v === '{' || t[j].v === '[') j = addPattern(j) + 1;
        else if (t[j].type === 'id') { out.add(t[j].v); j++; }
        // 略過初始值到同層的 , 或 ;
        let d = 0;
        for (; j < b; j++) {
          const v = t[j].v;
          if (v === '(' || v === '{' || v === '[') d++;
          else if (v === ')' || v === '}' || v === ']') { if (d === 0) break; d--; }
          else if ((v === ',' || v === ';') && d === 0) break;
          else if (d === 0 && t[j].type === 'id' && (v === 'of' || v === 'in') && t[j - 1] && t[j - 1].type === 'id') break;
        }
        if (t[j] && t[j].v === ',') { j++; continue; }
        break;
      }
    } else if (x.v === 'function') {
      let j = k + 1;
      if (t[j] && t[j].v === '*') j++;
      if (t[j] && t[j].type === 'id') { out.add(t[j].v); j++; }
      if (t[j] && t[j].v === '(') params(j);
    } else if (x.v === 'catch' && t[k + 1] && t[k + 1].v === '(') {
      if (t[k + 2] && t[k + 2].type === 'id') out.add(t[k + 2].v);
    } else if (x.v === 'class' && t[k + 1] && t[k + 1].type === 'id') out.add(t[k + 1].v);
  }
  // 箭頭函式參數：x => …、(a, b) => …
  for (let k = a; k < b; k++) {
    if (t[k].v !== '=>') continue;
    const pv = t[k - 1];
    if (pv && pv.type === 'id') out.add(pv.v);
    else if (pv && pv.v === ')') {
      let d = 0, j = k - 1;
      for (; j >= a; j--) { if (t[j].v === ')') d++; else if (t[j].v === '(') { d--; if (d === 0) break; } }
      params(j);
    }
  }
  // 方法簡寫的參數：name(a, b) { … }（物件字面值中）
  for (let k = a; k + 1 < b; k++) {
    if (t[k].type === 'id' && !CONTROL.has(t[k].v) && t[k + 1].v === '(' && t[k - 1] && (t[k - 1].v === ',' || t[k - 1].v === '{' || t[k - 1].v === 'get' || t[k - 1].v === 'set' || t[k - 1].v === 'async')) {
      let d = 0, j = k + 1;
      for (; j < b; j++) { if (t[j].v === '(') d++; else if (t[j].v === ')') { d--; if (d === 0) break; } }
      if (t[j + 1] && t[j + 1].v === '{') params(k + 1);
    }
  }
  return out;
}

// 使用到的識別字（排除屬性存取 a.b 的 b、物件字面值鍵 { b: … }、標籤）
function usesIn(t, a, b) {
  const out = new Map();
  for (let k = a; k < b; k++) {
    const x = t[k];
    if (x.type !== 'id' || KEYWORDS.has(x.v)) continue;
    const pv = t[k - 1], nx = t[k + 1];
    if (pv && (pv.v === '.' || pv.v === '?.')) continue;
    if (nx && nx.v === ':' && pv && (pv.v === '{' || pv.v === ',')) continue; // 物件鍵（? : 的情況前一個不是 { ,）
    if (nx && nx.v === '(' && pv && (pv.v === ',' || pv.v === '{') && (() => { // 方法簡寫的名稱
      let d = 0, j = k + 1; for (; j < b; j++) { if (t[j].v === '(') d++; else if (t[j].v === ')') { d--; if (d === 0) break; } } return t[j + 1] && t[j + 1].v === '{';
    })()) continue;
    if (!out.has(x.v)) out.set(x.v, x.p);
  }
  return out;
}

function lineOf(src, p) { let l = 1; for (let i = 0; i < p; i++) if (src.charCodeAt(i) === 10) l++; return l; }

function check(file) {
  const src = fs.readFileSync(file, 'utf8');
  const t = tokenize(src);
  // IIFE 本體：第一個 function 的 { 到對應的 }
  let s = t.findIndex((x) => x.v === 'function');
  if (s < 0) return [];
  while (s < t.length && t[s].v !== '{') s++;
  const close = (k) => { let d = 0; for (; k < t.length; k++) { if (t[k].v === '{') d++; else if (t[k].v === '}') { d--; if (d === 0) return k; } } return t.length - 1; };
  const bodyEnd = close(s);
  // 最外層（IIFE 內大括號深度 1）的 function 宣告
  const tops = [];
  let d = 0;
  for (let k = s + 1; k < bodyEnd; k++) {
    const v = t[k].v;
    if (v === '{') d++;
    else if (v === '}') d--;
    else if (d === 0 && v === 'function' && t[k + 1] && t[k + 1].type === 'id' && (!t[k - 1] || t[k - 1].v !== '=')) {
      let j = k + 2; while (t[j].v !== '{') j++;
      const e = close(j);
      tops.push({ name: t[k + 1].v, a: k, b: e + 1 });
      k = e;
    }
  }
  // IIFE 層級的宣告（最外層函式範圍以外）
  const outside = new Set();
  let prev = s + 1;
  for (const f of tops) { for (const v of declsIn(t, prev, f.a)) outside.add(v); outside.add(f.name); prev = f.b; }
  for (const v of declsIn(t, prev, bodyEnd)) outside.add(v);
  const decl = tops.map((f) => ({ f, d: declsIn(t, f.a, f.b) }));
  const problems = [];
  for (const { f, d: own } of decl) {
    for (const [name, p] of usesIn(t, f.a, f.b)) {
      if (own.has(name) || outside.has(name)) continue;
      const owners = decl.filter((o) => o.f !== f && o.d.has(name)).map((o) => o.f.name);
      if (owners.length) problems.push({ file, line: lineOf(src, p), fn: f.name, name, declaredIn: owners });
    }
  }
  return problems;
}

if (require.main === module) {
  let files = process.argv.slice(2);
  if (!files.length) files = fs.readdirSync('src').filter((f) => f.endsWith('.js')).map((f) => path.join('src', f));
  let total = 0;
  for (const f of files) {
    const ps = check(f);
    total += ps.length;
    for (const p of ps) console.log(`${p.file}:${p.line}  ${p.fn}() 使用了 ${p.name}，但它只宣告在 ${p.declaredIn.join('、')}() 內`);
  }
  console.log(total ? `\n共 ${total} 處需要檢查` : `檢查 ${files.length} 個檔案：沒有跨最外層函式引用區域識別字`);
  process.exitCode = total ? 1 : 0;
}
module.exports = { check, tokenize, declsIn, usesIn };
