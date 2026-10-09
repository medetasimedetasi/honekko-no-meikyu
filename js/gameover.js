// ほねっこの迷宮 — ゲームオーバーの演出。game3d.js の showResult が GameOver.play(opts) を呼ぶ。
// 流れ（1コマ80ms）：画面がだんだん暗くなる → 「GAME OVER」が1文字ずつ落ちてきて少し跳ねて止まり、「…」が1つずつ出る
//   → 倒れた主人公を、青い服の二足歩行の子犬2匹が担架で左へ運んで退場 → 到達の階とターン、「もう一度」「タイトルへ」
// 暗転と文字は 240×135 のキャンバス（1ドット＝ゲーム画面の2px、タイトルの犬と同じ細かさ）の中で、整数の位置・コマ単位で描く。
// 担架の一行だけは、ユーザーの指定で、ドットの格子を気にせず画面の真ん中から左へさーっと素早く抜ける（960×540 の別のキャンバスに
// 4倍で描き、位置は時間でなめらかに動かす。足のコマは80msごと）。一行は不透明度80％。
// クリックで最後まで飛ばす。絵は js/gameover_assets.js（ゲームオーバー_20261008/作業/絵.py から書き出し）。
(() => {
'use strict';
const CW = 240, CH = 135, FR = 80;
const A = globalThis.GAMEOVER_ASSETS;
const TEXT = 'GAME OVER', TEXT_Y = 26;
const DROP = [-10, -6, -3, -1, 1, 0];            // 文字が落ちてきて少し跳ねて止まるまでの高さ（コマごと、ドット）
const DARK = 0.8, DARK_FRAMES = 8;               // 暗くなる強さと、かかるコマ数
const GROUND = 112;                              // 犬の足もとの高さ（ドット）
const K = 4, SW = CW * K, SH = CH * K;            // 担架の一行のキャンバス（960×540、1ドット＝4px）
const APPEAR = 10, WALK_FROM = 18, SPEED = 560;  // 一行が出るコマ、走り出すコマ、走る速さ（画面の px/秒）
const ALPHA = 0.8;                               // 一行の不透明度
let root = null, cv = null, g = null, cv2 = null, g2 = null, panel = null, active = false, timer = 0, raf = 0, frame = 0, t0 = 0, opts = null, ended = false;
const sprites = {};

// ---------------------------------------------------------------- 絵
function sprite(rows, pal) {
  const w = Math.max(...rows.map(r => r.length)), c = document.createElement('canvas'); c.width = w; c.height = rows.length;
  const x = c.getContext('2d'), im = x.createImageData(w, rows.length);
  rows.forEach((r, y) => [...r].forEach((ch, i) => {
    const h = ch !== '.' && pal[ch]; if (!h) return;
    const o = (y * w + i) * 4; im.data[o] = parseInt(h.slice(1, 3), 16); im.data[o + 1] = parseInt(h.slice(3, 5), 16); im.data[o + 2] = parseInt(h.slice(5, 7), 16); im.data[o + 3] = 255;
  }));
  x.putImageData(im, 0, 0); return c;
}
function dogRows(f, front) {
  const top = front ? A.topFront : A.topBack, w = top[0].length, blank = '.'.repeat(w);
  const rows = [...Array(A.bob[f]).fill(blank), ...top, ...A.legs[f]];
  return A.bob[f] ? rows : [...rows, blank];
}
function buildSprites(hair) {
  const pal = { ...A.pal };
  if (hair) { pal.A = hair[0]; pal.a = hair[1]; }   // 主人公の髪（キャラメイクの髪色）
  for (const f of 'ABCD') { sprites['front' + f] = sprite(dogRows(f, true), pal); sprites['back' + f] = sprite(dogRows(f, false), pal); }
  sprites.hero = sprite(A.hero, pal); sprites.stretcher = sprite(A.stretcher, pal);
  sprites.letters = letters();
}
// 「GAME OVER」の文字：マルモニカを書体本来の 16px でキャンバスに描き、半分より濃い所だけ拾って1ドットの線にする。縁は1ドットの黒
function letters() {
  const out = [], tmp = document.createElement('canvas'), t = tmp.getContext('2d', { willReadFrequently: true });
  tmp.width = 20; tmp.height = 20;
  for (const ch of TEXT) {
    t.clearRect(0, 0, 20, 20); t.font = "16px 'MaruMonica'"; t.textBaseline = 'top'; t.fillStyle = '#fff'; t.fillText(ch, 2, 2);
    const w = ch === ' ' ? 5 : Math.ceil(t.measureText(ch).width), d = t.getImageData(0, 0, 20, 20).data;
    const c = document.createElement('canvas'); c.width = w + 2; c.height = 18; const x = c.getContext('2d');
    const on = (px, py) => px >= 0 && py >= 0 && px < 20 && py < 20 && d[(py * 20 + px) * 4 + 3] > 127;
    for (let y = 0; y < 18; y++) for (let i = 0; i < w + 2; i++) {
      const sx = i + 1, sy = y + 1;
      if (on(sx, sy)) { x.fillStyle = '#fbf3e2'; x.fillRect(i, y, 1, 1); }
      else if ([[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => on(sx + dx, sy + dy))) { x.fillStyle = '#221b17'; x.fillRect(i, y, 1, 1); }
    }
    out.push({ ch, c, w });
  }
  return out;
}

// ---------------------------------------------------------------- 描く（コマ番号だけで決まる）
function draw(k) {
  g.clearRect(0, 0, CW, CH);
  g.fillStyle = `rgba(11,17,32,${(DARK * Math.min(1, k / DARK_FRAMES)).toFixed(3)})`; g.fillRect(0, 0, CW, CH);
  // GAME OVER（文字は2コマおきに落ちてくる）
  const L = sprites.letters, total = L.reduce((s, l) => s + l.w, 0);
  let x = Math.round((CW - total - 18) / 2);
  L.forEach((l, i) => {
    const age = k - (6 + i * 2);
    if (age >= 0 && l.ch !== ' ') g.drawImage(l.c, x - 1, TEXT_Y + DROP[Math.min(age, DROP.length - 1)] - 1);
    x += l.w;
  });
  for (let i = 0; i < 3; i++) if (k >= 6 + L.length * 2 + 2 + i * 3) { g.fillStyle = '#221b17'; g.fillRect(x + 2 + i * 6, TEXT_Y + 11, 4, 4); g.fillStyle = '#fbf3e2'; g.fillRect(x + 3 + i * 6, TEXT_Y + 12, 2, 2); }
}
// 担架の一行（前の犬・担架・主人公・後ろの犬）。時間でなめらかに左へ。後ろの犬は半歩ずらして歩く
const groupW = () => A.frontHandX + A.stretcherW - 1 + A.topBack[0].length;          // 一行の幅（ドット）
const startX = () => Math.round((SW - groupW() * K) / 2);                            // 画面の真ん中から
function groupAt(ms) {
  const run = Math.max(0, ms - WALK_FROM * FR) / 1000;
  return { x: startX() - run * SPEED, step: run > 0 ? Math.floor(ms / FR) : -1 };
}
function drawGroup(ms) {
  g2.clearRect(0, 0, SW, SH);
  if (ms < APPEAR * FR) return;
  const { x, step } = groupAt(ms), ff = step < 0 ? 'B' : 'ABCD'[step % 4], bf = step < 0 ? 'B' : 'ABCD'[(step + 2) % 4];
  const front = sprites['front' + ff], back = sprites['back' + bf], top = GROUND - front.height;
  // いったん不透明のまま1枚に組んでから、まとめて80％で描く（重なった所が透けないように）
  const gc = drawGroup.c || (drawGroup.c = document.createElement('canvas')), w = groupW(), x2 = gc.getContext('2d');
  gc.width = w; gc.height = GROUND + 1;
  const sx = A.frontHandX, sy = top + A.handY + A.bob[ff];
  x2.drawImage(sprites.stretcher, sx, sy); x2.drawImage(sprites.hero, sx + 7, sy - 8); x2.drawImage(front, 0, top); x2.drawImage(back, sx + A.stretcherW - 1, GROUND - back.height);
  g2.globalAlpha = ALPHA; g2.drawImage(gc, Math.round(x), 0, gc.width * K, gc.height * K); g2.globalAlpha = 1;
}
const goneMs = () => WALK_FROM * FR + (startX() + groupW() * K) / SPEED * 1000 + 100;   // 一行が左の外へ出きる時間

// ---------------------------------------------------------------- 流れ
function tick() { frame++; draw(frame); }
function loop(now) {
  if (!active) return;
  const ms = now - t0; drawGroup(ms);
  if (!ended && ms >= goneMs()) finish();
  raf = requestAnimationFrame(loop);
}
function finish() {
  ended = true;
  if (frame < 40) { frame = 40; draw(frame); }       // 飛ばしたときは文字を出しきる
  t0 = performance.now() - goneMs();
  panel.innerHTML = `<p class="mm w">${esc(opts.info || '')}</p><div class="acts"><button class="primary mm w" data-act="again">もう一度 / B1F から</button>${opts.onTitle ? '<button class="mm w" data-act="title">タイトルへ</button>' : ''}</div>`;
  panel.classList.add('show');
}
function close(then) {
  active = false; clearInterval(timer); timer = 0; cancelAnimationFrame(raf); root.style.display = 'none'; panel.classList.remove('show');
  then?.();
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function build() {
  root = document.createElement('div'); root.id = 'gameover';
  root.innerHTML = `<canvas width="${CW}" height="${CH}"></canvas><canvas class="go-group" width="${SW}" height="${SH}"></canvas><div class="go-panel pixwin"></div>`;
  (document.getElementById('stage') || document.body).appendChild(root);
  cv = root.querySelector('canvas'); g = cv.getContext('2d'); g.imageSmoothingEnabled = false; panel = root.querySelector('.go-panel');
  cv2 = root.querySelector('.go-group'); g2 = cv2.getContext('2d'); g2.imageSmoothingEnabled = false;
  root.addEventListener('pointerdown', ev => { if (!active || ev.target.closest('button')) return; if (!ended) finish(); });   // クリックで最後まで飛ばす
  panel.addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    globalThis.Music?.se('ui_decide');
    close(b.dataset.act === 'title' ? opts.onTitle : opts.onAgain);
  });
  addEventListener('keydown', ev => {
    if (!active) return;
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopImmediatePropagation(); if (!ended) finish(); else close(opts.onAgain); }
  }, true);
}
// opts：{ hair: [明, 中] 主人公の髪の色, info: '到達 B3F・42ターン', onAgain(), onTitle() }
async function play(o) {
  if (active) return;
  opts = o || {};
  if (!root) build();
  try { await document.fonts.load("16px 'MaruMonica'", TEXT); } catch {}
  buildSprites(opts.hair);
  active = true; ended = false; frame = 0; panel.classList.remove('show'); root.style.display = 'block';
  draw(0); clearInterval(timer); timer = setInterval(tick, FR);
  t0 = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
}
globalThis.GameOver = { play, get active() { return active; } };
})();
