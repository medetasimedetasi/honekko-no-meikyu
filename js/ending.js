// ほねっこの迷宮 — クリア演出（踏破・帰還の巻物）。game3d.js が Ending.play(data, api) を呼ぶ。
// 流れ：暗転 → 背景の1枚絵とクレジット → 巻物が開く → 撃破（どんっ）→ 財宝（チャリン → お金がスコアへ吸い込まれる）
//       → 最終スコア（後光・記録更新なら紙吹雪）→ おたから（シュッ）→ 名前入力 → ランキング → 暗転してOPへ
// 途中で一定の点を超えるたびに宝箱のアイコンが増える。クリック・Enter・スペースで、いまの段を早送りする。
// ドットは 960×540 のキャンバス（盤やキャラチップと同じ細かさ）に、整数の位置・コマ単位（12コマ/秒）で描く（opening.js と同じ）。
// 文字と窓は DOM（マルモニカ・ドット絵の窓）。見た目は 3D版.html の「クリア演出」の CSS。
// 音（js/music.js、2026-10-08 OP作成セッションが追加）：曲は game3d.js の showResult が Music.jingle('ending') で流す。集計の効果音は下の se()／roll。
//   宝箱が増える「ディロン」＝chest、おたからの「シュッ」＝unlock
// ランキングは js/ranking.js（ブラウザに残す。2026-10-09 OP作成セッション）。なければ下の store に、閉じるまでだけ残す
// 仮のもの：（背景の1枚絵は 2026-10-10 に本番の絵へ。js/ending_bg.js）
//           宝箱のしきい値とおたからの条件。決まったら下の表を直す。
(() => {
'use strict';
const CW = 960, CH = 540, STEP = 1000 / 12;
const A = globalThis.ENDING_ASSETS;
const TREASURE_MAX = 14;                                       // 財宝のアイコンを並べる数（2026-10-10。15個からは「+点数」に重なるので、14個までにして個数を出す）
const CHEST_AT = [300, 1000, 2000, 4000, 7000];                  // 宝箱のアイコンが増える点（仮）
const UNLOCKS = [{ id: '白い花', name: '白い花', need: 300 }];   // おたから（キャラメイクの着せ替え）と、手に入る点（仮）
const CREDITS = [                                                // クレジット（2026-10-10 ユーザーの文。t＝大きい字、s＝小さい見出し、''＝名前。上の「踏破した／帰還した」は credits() が足す）
  ['t', 'ほねっこの迷宮'], ['', ''],
  ['s', '原作'], ['', '電網適応アイドレス'], ['', '『ほねっこの迷宮』'], ['', '芝村裕吏'], ['', ''],
  ['s', '原作ゲームデザイン'], ['', '芝村裕吏'], ['', ''],
  ['s', 'グラフィック二次創作版デザイン'], ['', '谷坂少年'], ['', ''],
  ['s', 'グラフィック'], ['', '谷坂少年'], ['', 'Claude Code Opus5.5（Anthropic）'], ['', 'Codex　GPT-6.1sol（OpenAI）'], ['', ''],
  ['s', 'コーディング'], ['', 'Claude Code Opus5.5（Anthropic）'], ['', ''],
  ['s', '音楽・効果音'], ['', '谷坂少年'], ['', 'Claude Code Opus5.5（Anthropic）'], ['', 'ElevenLabs'], ['', ''], ['', ''],
  ['s', 'テストプレイヤー'], ['', 'テストプレイヤーのみなさん'], ['', '玄霧さん'], ['', '鷹臣さん'], ['', '一法師リツさん'], ['', 'ダムレイさん'], ['', '七飾蛍さん'], ['', 'ばろーるさん'], ['', ''], ['', ''],
  ['', '©芝村裕吏'], ['', ''],
  ['t', 'Thank you for playing!'], ['', '&芝村さん、後ほねっこのみなさん'],
];
const C = { ink: '#221b17', paper: '#f2dcb4', paper2: '#e1bc88', paperEdge: '#cca673', rod: '#8a5a38', rod2: '#5c422c',
  gold: '#f0b84a', gold2: '#ae6f47', night: '#0b1120', night2: '#18222d', night3: '#2c3a48', white: '#fbf3e2' };
const CONFETTI = ['#d24a3c', '#f0b84a', '#4aa3e8', '#8eaa48', '#fbf3e2', '#e7a08a', '#7582a9'];

// ---- 仮の保存先（ランキング・持っているおたから）。ゲームを閉じると消える。保存先が決まったらここだけ差し替える
const store = { ranking: [], owned: new Set(), lastName: 'ローグ' };

let root, cv, g, active = false, frame = 0, timer = null, skip = false, clickWaiters = [];
const S = {};          // いま描いている物

// ---------------------------------------------------------------- 小道具
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function sprite(rows, pal, inner = 1) {          // 記号の行 → キャンバス（K は外周の黒として不透明）
  const c = canvas(rows[0].length, rows.length), x = c.getContext('2d'), im = x.createImageData(c.width, c.height);
  rows.forEach((r, y) => [...r].forEach((ch, i) => {
    if (ch === '.' || !pal[ch]) return;
    const h = pal[ch], o = (y * c.width + i) * 4;
    im.data[o] = parseInt(h.slice(1, 3), 16); im.data[o + 1] = parseInt(h.slice(3, 5), 16); im.data[o + 2] = parseInt(h.slice(5, 7), 16);
    im.data[o + 3] = ch === 'K' ? 255 : Math.round(255 * inner);
  }));
  x.putImageData(im, 0, 0); return c;
}
const GLYPH = {};
for (const [ch, rows] of Object.entries(A.digits.glyphs)) GLYPH[ch] = sprite(rows, A.digits.pal);
const digitsW = (s, k) => ([...s].reduce((w, ch) => w + (GLYPH[ch] ? GLYPH[ch].width - 1 : 4), 0) + 1) * k;
function digits(s, x, y, k = 2) {                // 数字（字の縁は1ドット重ねて詰める）。x, y は左上、k は倍率
  let cx = x;
  for (const ch of s) { const gl = GLYPH[ch]; if (!gl) { cx += 4 * k; continue; } g.drawImage(gl, cx, y, gl.width * k, gl.height * k); cx += (gl.width - 1) * k; }
}
const comma = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const blit = (img, x, y, k = 1) => g.drawImage(img, Math.round(x), Math.round(y), img.width * k, img.height * k);
const rect = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
const COIN = sprite(['.KKKK.', 'KYYYOK', 'KYWYOK', 'KYYYOK', 'KOOOOK', '.KKKK.'], { K: C.ink, Y: C.gold, O: C.gold2, W: C.white });
const CHEST = sprite(['.KKKKKKKK.', 'KRRRRRRRRK', 'KRRRRRRRRK', 'KKKKYYKKKK', 'KRRRYYRRRK', 'KRRRRRRRRK', 'KRRRRRRRRK', 'KKKKKKKKKK'],
  { K: C.ink, R: '#8f2f2b', Y: C.gold });

// ---------------------------------------------------------------- 音（js/music.js）
const se = n => globalThis.Music?.se(n) || false;
const loopSe = { roll: null, pour: null };
function loopOn(k, name) { if (!loopSe[k]) loopSe[k] = globalThis.Music?.seLoop(name) || { stop() {} }; }
function loopOff(k) { loopSe[k]?.stop(); loopSe[k] = null; }

// ---------------------------------------------------------------- 時間（コマ）と早送り
const waitFrames = n => new Promise(res => { const until = frame + n; const w = { until, res }; clickWaiters.push(w); });
function onTick() {
  frame++;
  for (let i = clickWaiters.length - 1; i >= 0; i--) if (skip || frame >= clickWaiters[i].until) { const w = clickWaiters.splice(i, 1)[0]; w.res(); }
  draw();
}
let advance = null;    // 「クリックで次へ」を待っているとき
function onInput(ev) {
  if (!active) return;
  if (ev.type === 'keydown') {
    if (S.typing) return;                                 // 名前を入れているときはキーはそのまま
    if (!['Enter', ' ', 'Escape'].includes(ev.key)) return;
    ev.preventDefault();
  }
  ev.stopPropagation();
  if (advance) { if (frame < advanceFrom) return; const a = advance; advance = null; a(); return; }
  skip = true;                                            // いまの段を早送り
}
let advanceFrom = 0;
const clickToGo = () => new Promise(res => { advanceFrom = frame + 3; advance = res; });   // 出てすぐ（3コマ）のクリックは数えない（前の段のクリックで飛ばないように）

// ---------------------------------------------------------------- 描く
function draw() {
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, CW, CH);
  if (S.bg) drawBackground();
  if (S.rays != null) drawRays();
  if (S.scroll) drawScroll();
  if (S.confetti) drawConfetti();
  if (S.dim) rect(0, 0, CW, CH, 'rgba(11,17,32,0.62)');      // おたから・名前・ランキングの場面は、うしろを沈める
  if (S.unlock) drawUnlock();
  if (S.fade) rect(0, 0, CW, CH, `rgba(11,17,32,${S.fade})`);
}
// 背景（仮）：夜の洞窟、奥の宝の光、宝を見つけたフードの後ろ姿（主人公の斜め後ろ×3）
// 1枚絵（2026-10-10）：踏破＝お宝の光、帰還＝階段を上って地上へ（js/ending_bg.js、480×270 を2倍）。字が読めるよう少し沈める。絵がなければ下の仮の絵
const BG_DIM = 0.3;
const BG = {};
for (const [k, src] of Object.entries(globalThis.ENDING_BG || {})) { const im = new Image(); im.src = src; BG[k] = im; }
function drawBackground() {
  const im = BG[S.bgKey] || BG[S.status === 'RETURNED' ? 'returned' : 'cleared'];   // bgKey：2の B60F 踏破＝final・全職クリア＝grandslam（js/ending_bg2.js、game3d.js の endingData が決める）
  if (im && im.complete && im.naturalWidth) { g.drawImage(im, 0, 0, CW, CH); rect(0, 0, CW, CH, `rgba(11,17,32,${BG_DIM})`); return; }
  rect(0, 0, CW, CH, C.night);
  for (let i = 0; i < 6; i++) rect(0, 300 + i * 40, CW, 40, i % 2 ? C.night2 : C.night);
  const cx = 600, cy = 330;
  [[150, C.night3], [110, '#3f2d21'], [76, '#5c422c'], [48, C.gold2], [24, C.gold]].forEach(([r, c]) => {   // 宝の光（段の丸）
    g.fillStyle = c;
    for (let y = -r; y <= r; y += 6) { const w = Math.floor(Math.sqrt(r * r - y * y) / 6) * 6; g.fillRect(cx - w, cy + y, w * 2, 6); }
  });
  if (S.hero) blit(S.hero, 330, 470 - S.hero.height * 3, 3);
}
// 後光：巻物の上のまん中から放射状（4ドットのかたまりで計算して、コマごとに少し回す）
function drawRays() {
  const cx = 480, cy = 120, n = 14, rot = S.rays * 0.05;
  g.fillStyle = 'rgba(240,184,74,0.32)';
  for (let y = 0; y < CH; y += 4) for (let x = 0; x < CW; x += 4) {
    const a = Math.atan2(y + 2 - cy, x + 2 - cx) + rot, s = ((a / (Math.PI * 2) * n) % 1 + 1) % 1;
    if (s < 0.42) g.fillRect(x, y, 4, 4);
  }
}
// 巻物：上下の巻き軸と紙。S.scroll.open（0〜1、コマで段々に）で開く
const PX0 = 200, PW0 = 560, PY = 36, PH = 468;
// 並べ方（2026-10-20 ユーザー指定：2で敵の種類が増えて巻物からはみ出したため）。入りきらないときだけ順に、
// ①巻物を横に広げて3列 ②行を詰める ③巻物の中で上へ流す。ふだんの量なら今までどおり（幅560・2列・行36）
const LIST_TOP = 132, LIST_BOTTOM = 488;
function layoutFor(nKills, nTre) {
  const need = l => Math.ceil(nKills / l.cols) * l.rh + 18 + Math.ceil(nTre / l.cols) * l.th;
  const base = { px: PX0, pw: PW0, cols: 2, colW: 262, x0: 236, rh: 36, th: 42 };
  const wide = { px: 80, pw: 800, cols: 3, colW: 256, x0: 112, rh: 36, th: 42 };
  const tight = { ...wide, rh: 32, th: 36 };   // 28 だとアイコンが上下で重なった
  for (const l of [base, wide]) if (need(l) <= LIST_BOTTOM - LIST_TOP) return l;
  return { ...tight, flow: need(tight) > LIST_BOTTOM - LIST_TOP };
}
const colX = (l, i) => l.x0 + (i % l.cols) * l.colW;
function drawScroll() {
  const L = S.lay || { px: PX0, pw: PW0 }, PX = L.px, PW = L.pw;
  const open = S.scroll.open, h = Math.round(PH * open / 6) * 6, top = 270 - Math.round(h / 2 / 6) * 6;
  rect(PX, top, PW, h, C.paper);
  rect(PX, top, PW, 4, C.paperEdge); rect(PX, top + h - 4, PW, 4, C.paperEdge);
  rect(PX, top, 4, h, C.paperEdge); rect(PX + PW - 4, top, 4, h, C.paperEdge);
  for (const ry of [top - 10, top + h - 2]) { rect(PX - 16, ry, PW + 32, 12, C.rod); rect(PX - 16, ry + 8, PW + 32, 4, C.rod2); rect(PX - 24, ry - 2, 8, 16, C.rod2); rect(PX + PW + 16, ry - 2, 8, 16, C.rod2); }
  if (open < 1) return;
  // スコア（上）：お金のアイコン＋数字（4倍）＋宝箱
  const sc = S.score, txt = comma(sc.shown), k = 4, w = digitsW(txt, k), x = 480 - Math.round(w / 2 / 4) * 4 + 24;
  let by = 60; if (sc.bounce > 0) { by -= [0, 4, 8, 4][sc.bounce] ?? 0; }
  blit(COIN, x - 40, by + 4, 4);
  digits(txt, x, by, k);
  sc.chests.forEach((c, i) => { const age = frame - c.at, dy = age < 1 ? -8 : age < 2 ? -4 : 0; blit(CHEST, 604 + i * 24 - (sc.chests.length - 1) * 0, 108 + dy, 2); });
  // 撃破と財宝の一覧（2〜3列）。流すときは巻物の中だけに描く（S.listOff だけ上へずらす）
  const off = S.listOff || 0;
  g.save(); g.beginPath(); g.rect(PX + 4, LIST_TOP - 16, PW - 8, LIST_BOTTOM - LIST_TOP + 16); g.clip();
  for (const r of S.rows) {
    const age = frame - r.at; if (age < 0) continue;
    const dy = (age < 1 ? -12 : age < 2 ? -4 : 0) - off;   // どんっ（上から落ちて止まる）
    blit(r.icon, r.x, r.y + dy + 30 - r.icon.height);
    digits('x' + r.count, r.x + 40, r.y + dy + 8, 2);
    digits('+' + comma(r.count * r.value), r.x + 130, r.y + dy + 8, 2);
  }
  // 財宝：アイコンが1つずつ並ぶ
  for (const t of S.treasure) {
    const ty = t.y - off;
    for (let i = 0; i < t.shown; i++) { const age = frame - t.at[i], dy = age < 1 ? -6 : 0; blit(t.icon, t.x + i * t.step, ty + dy, 2); }
    if (t.count > t.nIcons && t.shown >= t.nIcons) { const s = 'x' + t.count, ex = t.x + (t.nIcons - 1) * t.step + t.icon.width * 2; digits(s, ex - digitsW(s, 2) + 4, ty + 22, 2); }   // 15個以上：最後のアイコンの右下に個数
    if (t.done) digits('+' + comma(t.count * t.value), t.x + 150, ty + 10, 2);
  }
  g.restore();
  // 吸い込まれていくお金
  for (const c of S.coins) {
    const tt = (frame - c.at) / c.dur; if (tt < 0 || tt > 1) continue;
    const x = c.x0 + (c.x1 - c.x0) * tt, y = c.y0 + (c.y1 - c.y0) * tt - Math.sin(Math.PI * tt) * 60;
    blit(COIN, Math.round(x / 2) * 2, Math.round(y / 2) * 2, 2);
  }
}
function drawConfetti() {
  for (const p of S.confetti) {
    const t = frame - p.at; if (t < 0) continue;
    const y = p.y + t * p.vy, x = p.x + [0, 2, 4, 2, 0, -2, -4, -2][(t + p.ph) % 8];
    if (y > CH) continue;
    rect(Math.round(x / 2) * 2, Math.round(y / 2) * 2, p.w, p.h, p.c);
  }
}
function drawUnlock() {
  const u = S.unlock, xs = [-60, 140, 330, 420, 444, 450], i = Math.min(xs.length - 1, frame - u.at);
  if (i < 0) return;
  blit(u.img, xs[i], 236, 3);
}

// ---------------------------------------------------------------- DOM（文字と窓）
const el = {};
function buildDom() {
  root = document.createElement('div'); root.id = 'ending';
  root.innerHTML = `<canvas id="end-cv" width="${CW}" height="${CH}"></canvas>
    <div id="end-credits"></div><div id="end-head" class="mm m"></div><div id="end-final" class="mm l"></div>
    <div id="end-msg" class="pixwin mm m"></div><div id="end-win" class="pixwin"></div><div id="end-hint" class="mm s"></div>`;
  ($('#stage') || document.body).appendChild(root);
  cv = root.querySelector('#end-cv'); g = cv.getContext('2d');
  for (const k of ['credits', 'head', 'final', 'msg', 'win', 'hint']) el[k] = root.querySelector('#end-' + k);
  root.addEventListener('pointerdown', onInput);
  addEventListener('keydown', onInput, true);
}
function $(s) { return document.querySelector(s); }
function fixScroll() { for (let e = root; e; e = e.parentElement) if (e.scrollTop) e.scrollTop = 0; }   // 入力欄に入ると画面ごとずれることがあるので戻す
const show = (e, on = true) => e.classList.toggle('show', on);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hint = t => { el.hint.textContent = t || ''; show(el.hint, !!t); };

// ---------------------------------------------------------------- 流れ
async function fade(to, n = 4) {   // 暗転（4段で、点滅しない）
  const from = S.fade || 0;
  for (let i = 1; i <= n; i++) { S.fade = from + (to - from) * i / n; await waitFrames(1); }
  S.fade = to;
}
async function credits(data) {
  skip = false;
  el.credits.innerHTML = `<div class="mm l">${data.status === 'CLEARED' ? '地下迷宮を踏破した' : '地上へ帰還した'}</div><br>` +
    CREDITS.map(([k, t]) => `<div class="mm ${k === 't' ? 'l' : k === 's' ? 's dim' : 'm'}">${esc(t) || '&nbsp;'}</div>`).join('');
  show(el.credits); let y = 280;
  el.credits.style.transform = `translateY(calc(var(--u) * ${y}))`;
  const total = 280 + el.credits.offsetHeight / (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')) || 2) - 40;
  for (let i = 0; i < total && !skip; i += 2) { y -= 2; el.credits.style.transform = `translateY(calc(var(--u) * ${y}))`; await waitFrames(1); }   // 1コマに2ドットずつ上へ（整数のドット）
  show(el.credits, false);
}
async function countTo(target) {          // スコアを target まで回す（ダラララ）。宝箱のしきい値を超えたら増やす
  const sc = S.score; sc.target = target;
  if (sc.shown < sc.target && !skip) loopOn('roll', 'tally_roll');   // ダラララ（数え終わったら止める）
  while (sc.shown < sc.target) {
    const d = skip ? sc.target - sc.shown : Math.max(1, Math.ceil((sc.target - sc.shown) / 4));
    sc.shown = Math.min(sc.target, sc.shown + d); passChests(); await waitFrames(1);
  }
  loopOff('roll');
}
function passChests() {
  const sc = S.score;
  while (sc.chests.length < CHEST_AT.length && sc.shown >= CHEST_AT[sc.chests.length]) { sc.chests.push({ at: frame }); se('chest'); }   // ディロン
}
async function scoreSheet(data) {
  skip = false;
  S.scroll = { open: 0 }; S.score = { shown: 0, target: 0, chests: [], bounce: 0 }; S.rows = []; S.treasure = []; S.coins = []; S.listOff = 0;
  const L = S.lay = layoutFor(data.kills.filter(k => k.count > 0).length, data.treasure.filter(t => t.count > 0).length);
  const follow = async bottom => { if (!L.flow) return; const want = Math.max(0, bottom - LIST_BOTTOM); while (S.listOff < want) { S.listOff = skip ? want : Math.min(want, S.listOff + 6); if (!skip) await waitFrames(1); } };   // 流す：新しい行が見えるところまで上へ
  for (let i = 1; i <= 6; i++) { S.scroll.open = i / 6; await waitFrames(1); }
  el.head.textContent = 'スコア'; show(el.head);
  // 撃破：1行ずつ（どんっ）、点を足す
  const kills = data.kills.filter(k => k.count > 0);
  for (const [i, k] of kills.entries()) {
    const r = { ...k, x: colX(L, i), y: LIST_TOP + Math.floor(i / L.cols) * L.rh, at: frame };
    await follow(r.y + L.rh); r.at = frame;
    S.rows.push(r); se('tally_don');   // どんっ
    await waitFrames(skip ? 0 : 2); await countTo(S.score.target + k.count * k.value); if (!skip) await waitFrames(2);
  }
  // 財宝：アイコンが1つずつ並び（チャリン）、お金がスコアへ飛ぶ（じゃらら → どたたた）
  const ty0 = LIST_TOP + Math.ceil(kills.length / L.cols) * L.rh + 18;
  const tre = data.treasure.filter(t => t.count > 0);
  for (const [i, t] of tre.entries()) {
    const nIcons = Math.min(t.count, TREASURE_MAX);   // 並べるのは14個まで。それより多いときは、最後のアイコンに「x個数」を重ねる
    const step = Math.max(8, Math.min(30, Math.floor(110 / Math.max(1, nIcons - 1))));
    const row = { ...t, x: colX(L, i), y: ty0 + Math.floor(i / L.cols) * L.th, shown: 0, at: [], step, nIcons, done: false };
    await follow(row.y + L.th);
    S.treasure.push(row);
    for (let n = 0; n < nIcons; n++) { row.shown = n + 1; row.at.push(frame); if (!skip) { se('tally_coin'); await waitFrames(1); } }   // チャリン
    row.done = true;
    // お金：アイコン1つにつき2枚、少しずつずらして飛ばす。着いた分だけ点を足す
    const coins = [];
    for (let n = 0; n < nIcons; n++) for (let m = 0; m < 2; m++) coins.push({ x0: row.x + n * row.step + 8, y0: row.y - S.listOff, x1: 480 - 60, y1: 64, at: frame + coins.length, dur: 6, v: 0 });
    const each = Math.floor(t.count * t.value / coins.length); coins.forEach((c, j) => { c.v = j === coins.length - 1 ? t.count * t.value - each * (coins.length - 1) : each; });
    S.coins.push(...coins);
    if (!skip) loopOn('pour', 'coins_pour');   // じゃらら（飛んでいるあいだ）
    let paid = 0;
    while (paid < coins.length) {
      if (skip) { for (const c of coins.slice(paid)) S.score.target += c.v; paid = coins.length; S.coins = []; break; }
      const arrived = coins.filter(c => frame - c.at >= c.dur).length;
      for (; paid < arrived; paid++) S.score.target += coins[paid].v;
      const d = Math.max(1, Math.ceil((S.score.target - S.score.shown) / 3)); S.score.shown = Math.min(S.score.target, S.score.shown + d); passChests();
      await waitFrames(1);
    }
    loopOff('pour'); if (!skip) se('coins_suck');   // どたたた（吸い込まれ終わり）
    await countTo(S.score.target); S.coins = [];
  }
  await countTo(data.total);
  se('tally_roll_end');   // 数え終わりの止め
}
async function finale(data, record) {
  skip = false;
  el.head.textContent = '最終スコア';
  globalThis.Music?.jingle('tetteree');   // テッテレー
  for (let b = 1; b <= 3; b++) { S.score.bounce = b; await waitFrames(1); } S.score.bounce = 0;
  S.rays = 0; const raysTimer = setInterval(() => { if (S.rays != null) S.rays++; }, STEP);
  if (record) {
    el.final.textContent = '記録更新！'; show(el.final);
    S.confetti = Array.from({ length: 70 }, (_, i) => ({ x: Math.floor(Math.random() * CW / 2) * 2, y: -20 - Math.floor(Math.random() * 300), vy: 4 + 2 * (i % 3),
      w: i % 2 ? 4 : 6, h: i % 3 ? 4 : 6, c: CONFETTI[i % CONFETTI.length], at: frame, ph: i % 8 }));
  }
  hint('クリックで次へ'); await clickToGo(); hint('');
  clearInterval(raysTimer);
}
async function unlocks(data) {
  const O = globalThis.Otakara;   // おたから（js/otakara.js）。なければ下の仮の表
  const got = O ? O.newFor(data.total, data.status === 'CLEARED', data) : UNLOCKS.filter(u => data.total >= u.need && !store.owned.has(u.id));
  for (const u of got) {
    if (!data.demo) { if (O) O.add(u.id); else store.owned.add(u.id); }   // E・Y キーの見本（demo）では手に入れない。2（preview＝ランキングなし）では手に入る（2026-10-20）
    const a = globalThis.OTAKARA_ICONS?.[u.id] || A.treasures[u.id]; S.unlock = { img: sprite(a.rows, a.pal, a.inner ?? 1), at: frame };
    se('unlock');   // シュッ
    await waitFrames(6);
    el.msg.textContent = `${u.name}を手に入れた！`; show(el.msg);
    hint('クリックで次へ'); await clickToGo(); hint('');
    show(el.msg, false); S.unlock = null;
  }
  return got;
}
function nameInput() {
  return new Promise(res => {
    S.typing = true;
    const last = globalThis.Ranking ? Ranking.lastName : store.lastName;
    el.win.innerHTML = `<div class="t mm m">名前を入れてください</div>
      <input id="end-name" class="mm m" maxlength="8" value="${esc(last)}" spellcheck="false" autocomplete="off">
      <div class="btns"><button class="mm m primary" id="end-ok">決定</button></div>`;
    el.win.className = 'pixwin show name';
    const inp = el.win.querySelector('#end-name');
    const done = () => { se('ui_decide'); const v = inp.value.trim() || 'ローグ'; store.lastName = v; if (globalThis.Ranking) Ranking.lastName = v; S.typing = false; show(el.win, false); fixScroll(); res(v); };
    el.win.querySelector('#end-ok').onclick = ev => { ev.stopPropagation(); done(); };
    inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter' && !ev.isComposing) done(); });
    el.win.onpointerdown = ev => ev.stopPropagation();          // 窓の中のクリックは「次へ」にしない
    setTimeout(() => { inp.focus({ preventScroll: true }); inp.select(); fixScroll(); }, 0);
  });
}
const mmss = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const board = game => globalThis.Ranking?.for?.(game) || globalThis.Ranking;   // 1（30F）と2（60F）でランキングを分ける（js/ranking.js。2026-10-20）
async function ranking(entry, preview = false, game = 'classic') {
  const Ranking = board(game);
  let all, rank;
  if (preview) {                                        // E キーの見本：記録もオンラインへの送信もしない。今の表に、見本の行を差しこんで見せるだけ
    all = (globalThis.Ranking ? Ranking.list() : store.ranking.slice()).concat(entry).sort((a, b) => b.score - a.score || a.turns - b.turns || a.ms - b.ms);
    rank = all.indexOf(entry) + 1;
  } else if (globalThis.Ranking) { const r = Ranking.add(entry); entry = r.entry; rank = r.rank; all = Ranking.list(); }   // ブラウザに残す
  else { store.ranking.push(entry); store.ranking.sort((a, b) => b.score - a.score); all = store.ranking; rank = all.indexOf(entry) + 1; }
  // キャラの頭の絵の横に職業の紋章（小）、そのあとに職業の欄（2026-10-14 ユーザー指定）。職業のない古い記録は盗賊
  const job = e => e.job || '盗賊', emb = e => globalThis.HK_JOB_ICON?.(job(e), true) || '';
  const row = (e, i) => `<tr class="${e === entry ? 'me' : ''}"><td>${i + 1}</td><td>${esc(e.name)}</td><td>${comma(e.score)}</td><td class="pic">${e.icon ? `<img src="${e.icon}">` : ''}${emb(e) ? `<img class="job" src="${emb(e)}" alt="${esc(job(e))}">` : ''}</td><td class="jb">${esc(job(e))}</td><td>${e.turns}</td><td>${mmss(e.ms)}</td></tr>`;
  el.win.innerHTML = `<div class="t mm m">ランキング（${game === 'cardrogue' ? '60F' : '30F'}）</div><table class="mm s"><tr><th>順位</th><th>名前</th><th>スコア</th><th></th><th>職業</th><th>ターン</th><th>時間</th></tr>` +
    all.slice(0, 10).map(row).join('') + (rank > 10 ? `<tr class="gap"><td colspan="7">…</td></tr>${row(entry, rank - 1)}` : '') +   // 10位より下なら、自分の行を下に足す
    `</table>` + (preview ? '<p class="online mm s">見本なので、ランキングには記録しません</p>' : globalThis.Ranking?.online.enabled ? '<p class="online mm s">オンラインに送っています…</p>' : '');
  el.win.className = 'pixwin show rank';
  if (!preview && globalThis.Ranking?.online.enabled) {             // オンラインにも送って、順位を下に出す（つながらなければ、次に開いたとき送り直す）
    const line = el.win.querySelector('.online');
    Ranking.online.submit(entry).then(r => { line.textContent = r.ok ? `オンライン ${r.rank}位（${r.total}件中）` : r.error === 'not-ready' ? 'オンラインの60Fの表は準備中です（このブラウザには残しました）' : 'オンラインに送れませんでした。次に送り直します'; });
  }
  hint('クリックでタイトルへ'); await clickToGo(); hint(''); show(el.win, false);
}

// ---------------------------------------------------------------- 入口
async function play(data, api = {}) {
  if (active) return;
  if (!root) buildDom();
  active = true; frame = 0; skip = false; advance = null; clickWaiters = [];
  for (const k of Object.keys(S)) delete S[k];
  S.hero = data.hero || null; S.fade = 1; S.status = data.status; S.bgKey = data.bg || null;
  show(root); timer = setInterval(onTick, STEP);
  const best = globalThis.Ranking ? board(data.game).best() : store.ranking.length ? store.ranking[0].score : -1, record = data.total > best;
  S.bg = true; await fade(0, 6);
  await credits(data);
  await scoreSheet(data);
  await finale(data, record);
  S.rays = null; S.confetti = null; show(el.final, false); show(el.head, false); S.dim = true;
  await unlocks(data);
  const name = await nameInput();
  await ranking({ name, score: data.total, icon: data.playerIcon || '', face: data.face || '', job: data.job || '盗賊', turns: data.turns, ms: data.ms, floor: data.floor, status: data.status }, !!data.preview, data.game);
  await fade(1, 6);
  loopOff('roll'); loopOff('pour');
  clearInterval(timer); timer = null; active = false; show(root, false); fixScroll();
  api.done?.();
}
globalThis.Ending = { play, get active() { return active; }, store };
})();
