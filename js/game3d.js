// ほねっこの迷宮 — 3D版（テスト用）
// ゲームの判定はすべて元ロジック（logic.js の HK）が行い、ここは見せ方だけを担当する。
// 動く見本（2D）の game.js を土台に、盤・キャラ・光・カメラを3D（three.js）に置き換えた。
// ・動きの計算は2Dのときと同じ「盤のドット座標（px, py）」で行い、描くときに3Dの位置へ移す
//   （X = (px - OX) / T, Z = (py - OY) / T。ふだんのカメラでは2Dのときと同じ画面の位置になる）
// ・数字・体力の札・効果のドットは、3Dの位置を画面に写して、上の2Dの層に描く
(() => {
'use strict';
globalThis.startGame3D = (THREE) => {
const { HK, HKTrace, SPR, PAL32 } = globalThis;
if (globalThis.SPR_DIAG) Object.assign(SPR.groups, globalThis.SPR_DIAG);   // 斜め前・斜め後ろのドット
if (globalThis.SPR_HD) Object.assign(SPR.groups, globalThis.SPR_HD);       // 大きく細かい敵の絵（試し。js/enemies_hd.js）
if (globalThis.SPR_ICON) SPR.groups.icon = globalThis.SPR_ICON;              // カードの絵（共有32色・外周1ドット黒、18×18。js/icons.js）
if (globalThis.SPR_ICON_MAP) Object.assign(SPR.cardIcon, globalThis.SPR_ICON_MAP);   // 移動のカードは靴の色で段階を分ける
if (globalThis.CARD_BACK) {                                                    // カードの裏面（木瓜形の紋。js/cardback.js）
  document.documentElement.style.setProperty('--back-card', `url(${CARD_BACK.card})`);
  document.documentElement.style.setProperty('--back-pile', `url(${CARD_BACK.pile})`);
}
const near = PAL32.nearest;

// ---------------------------------------------------------------- 定数
const NW = 480, NH = 270, T = 24;
const OX = 144, OY = 36;                // マス(1,1) の左上（盤は画面の中央、手前に手札）
const FRAME = { x0: OX - 12, y0: OY - 32, x1: OX + 192 + 12, y1: OY + 192 + 10 };
const tileX = x => OX + (x - 1) * T, tileY = y => OY + (y - 1) * T;
const footX = x => tileX(x) + 12, footY = y => tileY(y) + 21;
const DIRV = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0] };
const DIRNAME = { w: '北', a: '西', s: '南', d: '東' };
const TORCHES = [OX + 60, OX + 132];
const E = SPR.env;

// ---------------------------------------------------------------- ドットの読み込み
function rgba(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length > 6 ? parseInt(h.slice(6, 8), 16) : 255];
}
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function bake(rows, pal, flip = false) {
  const h = rows.length, w = rows[0].length, c = canvas(w, h), x = c.getContext('2d'), img = x.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
    const ch = rows[y][flip ? w - 1 - i : i];
    if (ch === '.') continue;
    const col = pal[ch].length > 7 ? pal[ch] : near(pal[ch]);     // 共有32色にそろえる（半透明の色はそのまま）
    const [r, g, b, a] = rgba(col), o = (y * w + i) * 4;
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = a;
  }
  x.putImageData(img, 0, 0);
  return c;
}
const cache = new Map();
// ---- 動きのコマは書き出さず、立ち姿に操作をかけて作る（データを軽くし、衣装が替わっても動くように）。
// 絵（js/enemies_hd.js）には立ち姿（fr_idle_0・bk_idle_0）と骨組み rig（呼吸で足す行・股の高さ・左右の足の列など）だけがある。
// 操作の意味は 敵の絵_20261007/敵を組み立てる.py の apply_ops と同じ（見本はそちらで作る）。
//   breath：呼吸（rig.breath 行を足して、そこから上を1行上げる）
//   leg：左（0）／右（1）の足のかたまりを横に dx、上に dy（'max'＝rig.lift）動かす。股より上へ出た分は体の後ろ（空いている所だけ）
//   bob：股より上（頭・胴・手）を n 行下げる（足にかぶせる＝ひざが曲がって見える）
//   erase：立ち姿の手袋などを消す（腕の部品に替える。g.erase[向き][名前]）
//   lean：股より上を横に n 粒ずらす（体を前後に傾ける）
//   arm：腕の部品（g.parts['fr_' か 'bk_' + 名前]）を、体の傾き・沈みに合わせて重ねる（部品の behind＝体の後ろ：空いている所にだけ描く）
// 表は common（みんな）と player（主人公。絵の animSet）。'fr_…'／'bk_…' の行があれば向きごとにそちらを使う
const ANIM_SETS = {
  common: {
    idle_1: [{ breath: 1 }],                                                       // 待機の呼吸
    move_0: [{ leg: 0, dy: 'max' }], move_1: [{ leg: 1, dy: 'max' }],              // 敵の足踏み（1マスに1歩）
  },
  player: {
    walk_0: [{ leg: 0, dx: -2 }, { leg: 1, dx: 2 }, { bob: 1 }], walk_1: [{ leg: 1, dy: 5 }],   // 歩き：踏み出し → すれちがい（右足）
    walk_2: [{ bob: 1 }], walk_3: [{ leg: 0, dy: 5 }],                                          //   → 踏み込み → すれちがい（左足）。上げた足はすその後ろに隠れる
    bk_walk_1: [{ leg: 0, dy: 5 }], bk_walk_3: [{ leg: 1, dy: 5 }],   // 斜め後ろは、踏み出したあとに後ろの足（左）が上がる順にしないと後ろ歩きに見える
    atk_0: [{ erase: 'weapon' }, { lean: -1 }, { arm: 'back' }],                                                          // 攻撃：振りかぶり
    atk_1: [{ erase: 'weapon' }, { leg: 0, dx: -1 }, { leg: 1, dx: 2 }, { lean: 2 }, { bob: 1 }, { arm: 'thrust' }],      //   → 踏み込んで突き出す
    atk_2: [{ erase: 'weapon' }, { lean: 1 }, { bob: 1 }, { arm: 'down' }],                                               //   → 振り下ろし
    atk_3: [],                                                                                                             //   → 戻る
    hurt_0: [{ erase: 'weapon' }, { erase: 'other' }, { lean: -2 }, { arm: 'flail_l' }, { arm: 'flail_r' }, { arm: 'shut' }],   // 被弾：のけぞって両手を放り出し、目をつぶる
    hurt_1: [{ lean: -1 }, { arm: 'shut' }],                                                                               //   → 戻りかけ（目はつぶったまま）
  },
};
const ANIM_OPS = ANIM_SETS.common;   // （古い名前。みんなの表）
function opsFor(g, view, name) {
  for (const set of [ANIM_SETS[g.animSet], ANIM_SETS.common]) if (set) { const o = set[view + '_' + name] || set[name]; if (o) return o; }
  return null;
}
function makeFrame(g, name) {
  const m = /^(fr|bk)_(.+)$/.exec(name), rig = m && g.rig?.[m[1]], ops = m && opsFor(g, m[1], m[2]), base = m && g.frames[m[1] + '_idle_0'];
  if (!rig || !ops || !base) return null;
  const H = base.length, W = base[0].length, L0 = rig.legTop, blank = () => Array(W).fill('.');
  let n = base.map(r => r.split('')), ox = 0, oy = 0;      // ox, oy：体を傾けた・沈めた量（腕の部品をそれだけずらす）
  for (const op of ops) {
    if (op.erase) {
      const er = g.erase?.[m[1]]?.[op.erase];
      if (er) { const [x0, y0, x1, y1] = er.rect; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (er.letters.includes(n[y][x])) n[y][x] = '.'; }
    }
    if (op.lean) {
      const up = n.slice(0, L0).map(r => r.slice());
      for (let y = 0; y < L0; y++) { n[y] = blank(); for (let x = 0; x < W; x++) if (up[y][x] !== '.' && x + op.lean >= 0 && x + op.lean < W) n[y][x + op.lean] = up[y][x]; }
      ox += op.lean;
    }
    if (op.breath) { const o = n.map(r => r.slice()); for (let y = rig.top - 1; y < rig.breath; y++) n[y] = o[y + 1]; }
    if (op.leg !== undefined) {
      const [x0, x1] = rig.feet[op.leg], [a, b] = rig.legcols[op.leg], dx = op.dx || 0, dy = op.dy === 'max' ? rig.lift[op.leg] : (op.dy || 0), seg = [];
      for (let y = L0; y <= rig.bot; y++) { seg.push(n[y].slice(x0, x1)); for (let x = x0; x < x1; x++) n[y][x] = '.'; }
      seg.forEach((row, yy) => row.forEach((ch, xx) => {
        const y = L0 + yy - dy, x = x0 + xx + dx;
        if (ch === '.' || y < 0 || y >= H || x < 0 || x >= W) return;
        if (y >= L0 || (n[y][x] === '.' && a <= x0 + xx && x0 + xx <= b)) n[y][x] = ch;
      }));
    }
    if (op.bob) {
      const up = n.slice(0, L0).map(r => r.slice());
      for (let y = 0; y < L0; y++) n[y] = y < op.bob ? blank() : up[y - op.bob].slice();   // 股より上は行ごと入れ替える（フードの頭も沈む）
      for (let y = L0; y < Math.min(H, L0 + op.bob); y++) for (let x = 0; x < W; x++) if (up[y - op.bob][x] !== '.') n[y][x] = up[y - op.bob][x];   // 股の行には重ねる
      oy += op.bob;
    }
    if (op.arm) {
      const pt = g.parts?.[m[1] + '_' + op.arm];
      if (pt) pt.rows.forEach((r, yy) => [...r].forEach((ch, xx) => { const y = pt.y + yy + oy, x = pt.x + xx + ox; if (ch !== '.' && y >= 0 && y < H && x >= 0 && x < W && !(pt.behind && n[y][x] !== '.')) n[y][x] = ch; }));   // behind：体の後ろ（空いている所にだけ）
    }
  }
  return n.map(r => r.join(''));
}
function ensureFrame(g, name) {     // ないコマは操作で作って覚えておく（作れなければ false）
  if (g.frames[name]) return true;
  const f = makeFrame(g, name); if (f) g.frames[name] = f; return !!f;
}
function spr(group, frame, flip = false, palSwap = null) {
  const key = group + '/' + frame + (flip ? '/f' : '') + (palSwap ? '/' + JSON.stringify(palSwap) : '');
  let c = cache.get(key);
  if (!c) {
    const g = SPR.groups[group];
    if (!g || !ensureFrame(g, frame)) throw new Error('no sprite ' + key);
    c = bake(g.frames[frame], palSwap ? { ...g.pal, ...palSwap } : g.pal, flip);
    cache.set(key, c);
  }
  return c;
}
function rot90(src, times) {          // 効果の向き替え（ドットを補間なしで90度ずつ回す）
  let c = src;
  for (let t = 0; t < times; t++) {
    const n = canvas(c.height, c.width), x = n.getContext('2d');
    x.translate(n.width, 0); x.rotate(Math.PI / 2); x.drawImage(c, 0, 0); c = n;
  }
  return c;
}
const rotCache = new Map();
function sprDir(group, frame, dir) {   // 右向きの効果を w/a/s/d に向ける
  const key = group + frame + dir;
  if (!rotCache.has(key)) {
    const base = spr(group, frame, dir === 'a');
    rotCache.set(key, dir === 's' ? rot90(base, 1) : dir === 'w' ? rot90(base, 3) : base);
  }
  return rotCache.get(key);
}

// ---------------------------------------------------------------- 敵の見た目
const ENEMY_LOOK = {
  rat: { kind: 'rat' }, goblin: { kind: 'goblin' }, orc: { kind: 'orc' },
  // 4〜12階層の敵は、それぞれの絵（js/enemies_hd.js。素材は drive-download の敵の絵）
  'depth-4': { kind: 'hobgoblin' }, 'depth-5': { kind: 'skeleton' }, 'depth-6': { kind: 'zombie' },
  'depth-7': { kind: 'zombie', recolor: { '#7a8e9c': '#cca673', '#6e655a': '#897d69', '#506573': '#8a5a38', '#2c3a48': '#5c422c' } },   // グール（ゾンビの肌を黄ばんだ土気色に。色トレスの線も肌に合わせる）
  'depth-8': { kind: 'ogre' }, 'depth-9': { kind: 'troll' }, 'depth-10': { kind: 'gargoyle' },
  'depth-11': { kind: 'minotaur' }, 'depth-12': { kind: 'golem' },
};
const DEEP_SKINS = ['#d9d1b8', '#93a68c', '#8c9478', '#c9a77a', '#8a9aa8', '#9a8bb0', '#b08a7a', '#7f9fb0'];
function enemyLook(type) {
  if (ENEMY_LOOK[type]) return ENEMY_LOOK[type];
  const n = Number(/depth-(\d+)/.exec(type)?.[1] ?? 5);
  const skin = DEEP_SKINS[n % DEEP_SKINS.length], [r, g, b] = rgba(skin);
  const dark = '#' + [r, g, b].map(v => Math.round(v * 0.76).toString(16).padStart(2, '0')).join('');
  return { kind: 'orc', swap: { G: skin, g: dark, V: '#4a4458', v: '#36313f' }, recolor: { '#8eaa48': skin, '#5c7236': dark, '#34402a': '#221b17', '#506573': '#4a4640' }, stand: true };
}
const KIND = {
  rat: { ground: 12, move: [['move_0', 55], ['move_1', 55], ['move_2', 60]], moveMs: 170 },
  goblin: { ground: 20, move: [['move_0', 60], ['move_1', 80], ['move_2', 70]], moveMs: 200 },
  orc: { ground: 24, move: [['move_0', 120], ['move_1', 120]], moveMs: 240 },
};
for (const k of ['hobgoblin']) KIND[k] = KIND.goblin;
for (const k of ['skeleton', 'zombie', 'ogre', 'troll', 'gargoyle', 'minotaur', 'golem']) KIND[k] = KIND.orc;
// 待機（呼吸）：idle_0＝吐いた姿、idle_1＝吸って胸から上が1ドット上がった姿
const HOP_PX = 2;   // 敵が歩くときの弾みの高さ（画面のドット）
const EIDLE = () => newEntityAnim([['idle_0', 820], ['idle_1', 640]], true);
// 色の置き換え（色→色）を、その絵の記号の置き換えに直す（大きな絵は記号が絵ごとに違う）
function lookSwap(v, group) {
  if (v.swapOf === group) return v.swapMap;
  const r = v.look.recolor, g = SPR.groups[group];
  let sw = v.look.swap || null;
  if (r && g.k) { sw = {}; for (const [ch, c] of Object.entries(g.pal)) if (r[c]) sw[ch] = r[c]; }
  v.swapOf = group; v.swapMap = sw; return sw;
}
// 頭の上の高さ（大きな絵は top、ほかは ground）
const headH = v => { const eg = SPR.groups[egroup(v.kind)]; return eg.k ? eg.top : Math.min(eg.ground ?? KIND[v.kind].ground, 22); };

// ---------------------------------------------------------------- 時計と待ち
let clock = 0, baseSpeed = 1, speed = 1, hitstopUntil = 0;
const waiters = [];
const wait = ms => new Promise(res => waiters.push({ at: clock + ms, res }));
function hitstop(ms) { hitstopUntil = performance.now() + ms; }

// ---------------------------------------------------------------- 音
const audio = { ctx: null, master: null, bgmGain: null, sfxGain: null, muted: false, started: false };
function startAudio() {
  if (audio.started) return;
  audio.started = true;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    audio.ctx = ctx;
    audio.master = ctx.createGain(); audio.master.connect(ctx.destination);
    audio.bgmGain = ctx.createGain(); audio.bgmGain.gain.value = 0; audio.bgmGain.connect(audio.master);
    audio.sfxGain = ctx.createGain(); audio.sfxGain.gain.value = 0.9 * (globalThis.Music?.volume.se ?? 7) / 7; audio.sfxGain.connect(audio.master);   // 仮の合成音も効果音の音量に合わせる
    globalThis.Music?.attach(ctx, audio.master);   // 曲とジングル（js/music.js。音楽案_20261006/採用 の曲）
    setMute(audio.muted);
  } catch { /* 音なしで続ける */ }
}
function setMute(m) {
  audio.muted = m;
  if (audio.master) audio.master.gain.value = m ? 0 : 1;
}
function noiseBuf() {
  if (audio.noise) return audio.noise;
  const ctx = audio.ctx, b = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return (audio.noise = b);
}
function sfx(name) {
  if (globalThis.Music?.se(name)) return;   // 効果音のファイルがあればそれ（js/music.js）。なければ下の仮の合成音
  const ctx = audio.ctx; if (!ctx) return;
  const t = ctx.currentTime, out = audio.sfxGain;
  const env = (node, peak, dur, attack = 0.004) => {
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur); node.connect(g); g.connect(out); return g;
  };
  const noise = (dur, type, f0, f1, peak, q = 1) => {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf();
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    s.connect(f); env(f, peak, dur); s.start(t); s.stop(t + dur + 0.02);
  };
  const tone = (type, f0, f1, dur, peak, delay = 0) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t + delay);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + delay + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + delay); g.gain.exponentialRampToValueAtTime(peak, t + delay + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur); o.connect(g); g.connect(out); o.start(t + delay); o.stop(t + delay + dur + 0.02);
  };
  switch (name) {
    case 'step': noise(0.05, 'lowpass', 700 + Math.random() * 300, 0, 0.09); break;
    case 'estep': noise(0.04, 'lowpass', 500, 0, 0.05); break;
    case 'swing': noise(0.13, 'bandpass', 2600, 700, 0.11, 2); break;
    case 'hit': tone('sine', 170, 55, 0.14, 0.32); noise(0.05, 'highpass', 1800, 0, 0.08); break;
    case 'hurt': tone('square', 210, 95, 0.16, 0.06); noise(0.08, 'lowpass', 1200, 0, 0.14); break;
    case 'block': tone('triangle', 720, 0, 0.22, 0.09); tone('triangle', 1080, 0, 0.18, 0.05); break;
    case 'pickup': tone('sine', 880, 0, 0.07, 0.07); tone('sine', 1320, 0, 0.09, 0.06, 0.06); break;
    case 'heal': tone('sine', 660, 990, 0.25, 0.06); break;
    case 'die': noise(0.3, 'lowpass', 900, 200, 0.12); break;
    case 'stairs': [523, 440, 349, 294].forEach((f, i) => tone('triangle', f, 0, 0.16, 0.06, i * 0.09)); break;
    case 'card': noise(0.04, 'highpass', 3000, 0, 0.04); break;
    case 'bump': tone('sine', 120, 90, 0.07, 0.12); break;
    case 'shoot': noise(0.09, 'bandpass', 3500, 1500, 0.08, 3); break;
  }
}

// ---------------------------------------------------------------- 状態
let st = null;          // 元ロジックの状態
let busy = false, queued = null;
let targeting = null;   // カードの向き選び
const handEl = document.querySelector('#hand');
let selected = null;    // 選んだカードの id
let hoverTile = null;
let dispHp = 10, dispBlock = 0;
const view = { player: null, enemies: new Map(), items: [], fx: [], nums: [], marks: [], shake: null, fade: 0, banner: null, motes: [] };

function snap(s) {
  return {
    player: { ...s.player }, floor: s.floor, map: s.map.slice(), exit: { ...s.exit },
    enemies: s.enemies.map(e => ({ ...e })), items: s.groundItems.map(i => ({ ...i })),
    hand: s.hand.map(c => ({ ...c })), status: s.gameStatus, log: s.log.slice(),
    drawN: s.drawPile.length, discN: s.discardPile.length,
    prefer: { w: s.preferWeaponsNextFloor, a: s.preferArmorNextFloor, s: s.preferScrollsNextFloor },
  };
}

function newEntityAnim(seq, loop = false) { return { seq, t0: clock, loop }; }
function animFrame(a) {
  if (!a) return null;
  const total = a.seq.reduce((s, [, d]) => s + d, 0);
  let t = clock - a.t0;
  if (a.loop) t = ((t % total) + total) % total; else if (t >= total) return a.seq[a.seq.length - 1][0];
  for (const [f, d] of a.seq) { if (t < d) return f; t -= d; }
  return a.seq[a.seq.length - 1][0];
}
function animDone(a) { return !a || a.loop || clock - a.t0 >= a.seq.reduce((s, [, d]) => s + d, 0); }

const PIDLE = [['idle_0', 520], ['idle_1', 420]];
function playerIdle(p) { p.anim = newEntityAnim(PIDLE, true); p.anim.t0 -= Math.random() * 300; }
function makePlayer() {
  const p = { x: st.player.x, y: st.player.y, px: footX(st.player.x), py: footY(st.player.y), dir: 's', alpha: 1, tw: null, ox: 0, oy: 0, lift: 0, flip: false };
  playerIdle(p); return p;
}
function makeEnemy(e) {
  const look = enemyLook(e.type), k = KIND[look.kind];
  const v = { id: e.id, type: e.type, look, kind: look.kind, x: e.x, y: e.y, px: footX(e.x), py: footY(e.y), facing: 1, alpha: 1, tw: null, hp: e.hp, maxHp: e.maxHp, poison: e.poison ?? 0, stuck: !!e.immobilized };
  v.anim = EIDLE();
  v.anim.t0 -= Math.random() * 1400;
  void k;
  return v;
}
// 敵は主人公の方を向く：左右は主人公のいる側（同じ列なら保つ）、主人公が奥にいれば斜め後ろ
function faceEnemy(v) { const p = view.player; if (!p) return; if (p.x !== v.x) v.facing = p.x > v.x ? 1 : -1; v.back = p.y < v.y; }
// 主人公が近づいたら（縦横斜めに2マス以内）、待機中の敵はその場で振り向く（左右の反転と、斜め前・斜め後ろ）
const LOOK_NEAR = 2;
function lookAtPlayer() {
  const p = view.player; if (!p) return;
  for (const v of view.enemies.values()) if (!v.dying && !v.tw && Math.max(Math.abs(p.x - v.x), Math.abs(p.y - v.y)) <= LOOK_NEAR) faceEnemy(v);
}
// 難易度の帯（1〜10階・11〜20階・21〜30階）に出る敵のうち、いちばん高い攻撃力。
// 元ロジックでは、階 F の敵の強さは f＝⌊(F−1)/3⌋＋1 から f＋2 まで（攻撃力＝強さ）。帯でいちばん強い敵は帯の最後の階にだけ出る
const tierMaxAtk = floor => { const end = Math.min(30, Math.ceil(floor / 10) * 10); return Math.floor((end - 1) / 3) + 3; };
function syncView(full = false) {
  if (full || !view.player) view.player = makePlayer();
  const p = view.player;
  p.x = st.player.x; p.y = st.player.y; p.px = footX(p.x); p.py = footY(p.y); p.tw = null; p.alpha = 1;
  const keep = new Map();
  for (const e of st.enemies) {
    let v = !full && view.enemies.get(e.id);
    if (!v || v.dead) v = makeEnemy(e);
    v.x = e.x; v.y = e.y; v.px = footX(e.x); v.py = footY(e.y); v.tw = null; v.hp = e.hp; v.maxHp = e.maxHp; v.poison = e.poison ?? 0; v.stuck = !!e.immobilized;
    faceEnemy(v); keep.set(e.id, v);
  }
  if (!full) for (const [id, v] of view.enemies) if (v.dying && !v.gone && !keep.has(id)) keep.set(id, v);
  view.enemies = keep;
  view.items = st.groundItems.map(i => ({ ...i, alpha: 1, lift: 0 }));
  dispHp = st.player.hp; dispBlock = st.player.temporaryBlock;
}

// ---------------------------------------------------------------- 3D：色とテクスチャ（光の試作と同じ。いまは B21〜30F の藍色の地下水）
const C = {
  void: '#0b1120', bgDeep: '#0e1c3f', rock: '#2b3e6d', rockTop: '#425c8d', rockHi: '#647091', seam: '#2b3e6d', floorA: '#647091', floorB: '#7582a9', floorHi: '#b8c4cc', floorLo: '#425c8d', ao: '#2b3e6d', mossRate: 0.15,
  slate: '#506573', slateHi: '#7a8e9c', metal: '#b8c4cc', glow: '#4aa3e8',
  moss0: '#34402a', moss1: '#5c7236', moss2: '#8eaa48', ember: '#f0b84a', white: '#fbf3e2', red: '#d24a3c', dark: '#221b17',
};
// 盤（床・壁・額縁）の色はゾーンごと（背景の絵に合わせる）。どれも共有32色の中から。
// rock＝壁の側面／rockTop＝壁の天面／rockHi＝天面の縁の明るい線／bgDeep＝目地・影／seam＝床の目地と小石／floorA・floorB＝床の市松（近い2色）
const BOARD_THEMES = {
  '砂岩': { bgDeep: '#3f2d21', rock: '#6e655a', rockTop: '#a19077', rockHi: '#cca673', seam: '#cca673', floorA: '#e1bc88', floorB: '#f2dcb4',
    floorHi: '#fbf3e2', floorLo: '#cca673', ao: '#cca673', mossRate: 0.12,
    floorRamp: ['#f2dcb4', '#e1bc88', '#cca673', '#8a5a38', '#5c7236'], wallRamp: ['#a19077', '#6e655a', '#3f2d21'], hemiSky: '#fff1dc', hemiGround: '#3f2d21', sun: '#fff0dd' },
  '苔と松明': { bgDeep: '#18222d', rock: '#2c3a48', rockTop: '#506573', rockHi: '#7a8e9c', seam: '#4a4640', floorA: '#897d69', floorB: '#a19077',
    floorHi: '#cca673', floorLo: '#6e655a', ao: '#4a4640', mossRate: 0.3,
    floorRamp: ['#a19077', '#897d69', '#6e655a', '#4a4640', '#5c7236'], wallRamp: ['#506573', '#2c3a48', '#18222d'], hemiSky: '#e8ecf0', hemiGround: '#18222d', sun: '#f0f0ff' },
  '地下水': { bgDeep: '#0e1c3f', rock: '#2b3e6d', rockTop: '#425c8d', rockHi: '#647091', seam: '#2b3e6d', floorA: '#647091', floorB: '#7582a9',
    floorHi: '#b8c4cc', floorLo: '#425c8d', ao: '#2b3e6d', mossRate: 0.15,
    floorRamp: ['#7582a9', '#647091', '#425c8d', '#2b3e6d', '#5c7236'], wallRamp: ['#425c8d', '#2b3e6d', '#0e1c3f'], hemiSky: '#dfe6ff', hemiGround: '#1d2a4a', sun: '#e8eeff' },
};
let boardTheme = null;
const PX = T;
function texOf(c, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}
function rnd(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }
const texCache = new Map();
function sprTex(group, frame, flip = false, swap = null) {
  const key = group + '/' + frame + (flip ? '/f' : '') + (swap ? '/' + JSON.stringify(swap) : '');
  if (!texCache.has(key)) texCache.set(key, texOf(spr(group, frame, flip, swap)));
  return texCache.get(key);
}
const painter = (c) => { const x = c.getContext('2d'); return [x, (col, a, b, w, h) => { x.fillStyle = col; x.fillRect(a, b, w, h); }]; };
// 盤の絵（案B「古い絵本」に寄せた描き方）。色はゾーンの表（C）から。
// 床：石畳。タイルは左上が明るく右下が暗い縁で厚みを出し、ところどころにひび・淡い菱形の模様・小石・苔。壁の根元には床に影
const tileHi = isB => isB ? C.floorHi : C.floorB, tileLo = isB => isB ? C.floorA : C.floorLo;
function crackOn(f, R, a, b, col, len = 5) {            // ひび（斜めに折れながら伸びる1ドットの線）
  let x = a + 4 + Math.floor(R() * 14), y = b + 4 + Math.floor(R() * 14), dx = R() < 0.5 ? 1 : -1;
  for (let i = 0; i < len; i++) { f(col, x, y, 1, 1); if (R() < 0.6) x += dx; y += 1; if (R() < 0.25) dx = -dx; }
}
function floorTexture() {
  const c = canvas(192, 192), [x, f] = painter(c), R = seeded(st.floor * 7919 + 13);
  const isFloor = (tx, ty) => st.map[ty]?.[tx] === '.';
  for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) {
    const a = tx * T, b = ty * T, isB = (tx + ty) % 2 === 1;
    f(isB ? C.floorB : C.floorA, a, b, T, T);
    for (let n = 0; n < 3; n++) f(tileLo(isB), a + 3 + Math.floor(R() * 18), b + 3 + Math.floor(R() * 18), 2, 1);   // 石のまだら（控えめに）
    f(tileHi(isB), a, b, T - 1, 1); f(tileHi(isB), a, b, 1, T - 1);                          // 左上の明るい縁
    f(tileLo(isB), a + 1, b + T - 2, T - 2, 1); f(tileLo(isB), a + T - 2, b + 1, 1, T - 2);   // 右下の暗い縁
    f(C.seam, a + T - 1, b, 1, T); f(C.seam, a, b + T - 1, T, 1);                            // 目地
    if (!isFloor(tx + 1, ty + 1) || (tx + 1 === st.exit.x && ty + 1 === st.exit.y)) continue;
    const r = R();
    if (r < 0.14) {                                  // 淡い菱形の模様（古い敷石の刻み）
      const cx = a + 11, cy = b + 11;
      for (let k = -4; k <= 4; k++) { const w = 4 - Math.abs(k); f(tileLo(isB), cx - w, cy + k, 1, 1); f(tileLo(isB), cx + w, cy + k, 1, 1); }
    } else if (r < 0.3) crackOn(f, R, a, b, tileLo(isB), 5 + Math.floor(R() * 4));
    else if (r < 0.42) { const px = a + 3 + Math.floor(R() * 15), py = b + 3 + Math.floor(R() * 15); f(C.seam, px, py + 1, 2, 1); f(tileHi(isB), px, py, 2, 1); }   // 小石
    if (R() < C.mossRate) {                          // 目地の苔
      const p = 3 + Math.floor(R() * 16);
      if (R() < 0.5) { f(C.moss0, a + T - 2, b + p, 2, 3); f(C.moss1, a + T - 2, b + p, 1, 2); } else { f(C.moss0, a + p, b + T - 2, 3, 2); f(C.moss1, a + p, b + T - 2, 2, 1); }
    }
    if (ty === 0 || st.map[ty][tx + 1] === '#') {    // 北どなりが壁：壁の根元の影（床の上に2ドット）
      f(C.ao, a, b, T - 1, 2); f(tileLo(isB), a, b + 2, T - 1, 1);
    }
  }
  x.drawImage(spr('stairs', '0'), (st.exit.x - 1) * T, (st.exit.y - 1) * T);
  return texOf(c);
}
// 壁ブロックの天面：角の丸い一枚石。縁は左上が明るく右下が暗い。ひびと小さな苔の葉
function leaf(f, a, b) { f(C.moss1, a + 1, b, 1, 1); f(C.moss1, a, b + 1, 3, 1); f(C.moss2, a + 1, b + 1, 1, 1); f(C.moss0, a + 1, b + 2, 1, 1); }
function wallTopTexture(seed) {
  const c = canvas(24, 24), [, f] = painter(c), r = rnd(seed);
  f(C.rockTop, 0, 0, 24, 24);
  for (let n = 0; n < 4; n++) f(C.rock, 3 + Math.floor(r() * 18), 3 + Math.floor(r() * 18), 2, 1);   // 石のまだら（控えめに）
  f(C.rockHi, 1, 0, 22, 1); f(C.rockHi, 0, 1, 1, 22); f(C.rockHi, 1, 1, 2, 1);
  f(C.rock, 1, 23, 22, 1); f(C.rock, 23, 1, 1, 22); f(C.rock, 21, 22, 2, 1);
  f(C.bgDeep, 0, 0, 1, 1); f(C.bgDeep, 23, 0, 1, 1); f(C.bgDeep, 0, 23, 1, 1); f(C.bgDeep, 23, 23, 1, 1);   // 角を丸く
  crackOn(f, r, 0, 0, C.rock, 4 + Math.floor(r() * 4));
  if (r() < 0.8) leaf(f, 3 + Math.floor(r() * 16), 3 + Math.floor(r() * 16));
  return texOf(c);
}
// 壁の側面：上の縁は明るく、下は影。まん中に小さな苔の葉（案Bのブロックの正面の葉）
function wallSideTexture(h) {
  const c = canvas(24, h), [, f] = painter(c);
  f(C.rock, 0, 0, 24, h); f(C.rockTop, 0, 0, 24, 1); f(C.bgDeep, 0, h - 1, 24, 1);
  f(C.bgDeep, 0, 0, 1, h); f(C.bgDeep, 23, 0, 1, h);
  for (let n = 0; n < 6; n++) f(n % 2 ? C.rockTop : C.bgDeep, 2 + (n * 4) % 21, 1 + (n * 3) % Math.max(1, h - 2), 1, 1);
  if (h >= 6) leaf(f, 10, Math.floor(h / 2) - 2);
  return texOf(c);
}
// 外周の壁の正面：大きさのそろわない丸い石の積み上げ。目地は暗く、ところどころ苔
function stonesTexture(w, h, vertical = false, seed = 5) {
  const c = canvas(w, h), [, f] = painter(c), r = rnd(seed), L = vertical ? h : w, D = vertical ? w : h;
  const box = (pa, pb, la, lb, col) => vertical ? f(col, pb, pa, lb, la) : f(col, pa, pb, la, lb);
  box(0, 0, L, D, C.bgDeep);
  const rowH = D <= 12 ? D : 7;
  for (let y0 = 0; y0 < D; y0 += rowH) {
    const hh = Math.min(rowH, D - y0);
    let p = -Math.floor(r() * 6);
    while (p < L) {
      const len = 7 + Math.floor(r() * 9), s0 = Math.max(0, p), s1 = Math.min(L, p + len - 1), sl = s1 - s0;
      if (sl > 1 && hh > 2) {
        box(s0, y0, sl, hh - 1, C.rock);
        box(s0, y0, sl, 1, C.rockTop); box(s0, y0, 1, hh - 1, C.rockTop);                 // 上と左は明るく
        box(s0 + 1, y0 + hh - 2, sl - 1, 1, C.bgDeep);                                     // 下は影
        box(s0, y0, 1, 1, C.bgDeep); box(s1 - 1, y0, 1, 1, C.bgDeep);                       // 角を丸く
        if (r() < 0.45) box(s0 + 1 + Math.floor(r() * Math.max(1, sl - 3)), y0 + 1 + Math.floor(r() * Math.max(1, hh - 3)), 1, 1, r() < 0.5 ? C.rockHi : C.bgDeep);
        if (r() < 0.22) { box(s1 - 1, y0 + hh - 3, 2, 2, C.moss0); box(s1 - 1, y0 + hh - 3, 1, 1, C.moss1); }   // 目地の苔
      }
      p += len;
    }
  }
  return texOf(c);
}
const brickTexture = (w, h) => stonesTexture(w, h, false, 5);
// 外周の壁・ふちの天面：石の笠木。長い向きにそって石を並べる
function capTexture(w, h) {
  const c = canvas(w, h), [, f] = painter(c), r = rnd(w * 31 + h), vertical = h > w, L = vertical ? h : w, D = vertical ? w : h;
  const box = (pa, pb, la, lb, col) => vertical ? f(col, pb, pa, lb, la) : f(col, pa, pb, la, lb);
  box(0, 0, L, D, C.rockTop);
  let p = 0;
  while (p < L) {
    const len = 10 + Math.floor(r() * 12), e = Math.min(L, p + len);
    box(p, 0, e - p, 1, C.rockHi); box(p, 0, 1, D, C.rockHi);
    box(p, D - 1, e - p, 1, C.rock); box(e - 1, 0, 1, D, C.bgDeep);
    if (r() < 0.5) box(p + 2 + Math.floor(r() * Math.max(1, e - p - 4)), Math.floor(D / 2), 1, 1, C.rock);
    if (r() < 0.2 && D >= 6) { box(e - 3, 1, 2, 1, C.moss1); box(e - 2, 2, 1, 1, C.moss0); }
    p = e;
  }
  return texOf(c);
}
// ---------------------------------------------------------------- 盤の絵（案B。js/boardtiles.js）
// 床は1マス48×48、壁ブロックの天面48×48・側面48×16、外周の石積み220×52。盤は倍の細かさ（RS）で描くので、1ドット＝画面の1ドット。
// 絵は砂岩の色で描いてあり、ゾーンごとに同じ段の色へ置き換える（BOARD_THEMES の floorRamp／wallRamp）。読み込みが済むまでは前の描き方
const TILE = { ready: false, img: {}, cache: new Map() };
if (globalThis.BOARD_TILES) {
  const B = globalThis.BOARD_TILES, load = src => new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
  Promise.all([load(B.floor), ...B.tops.map(load), ...B.sides.map(load), load(B.wall)]).then(([floor, ...rest]) => {
    TILE.img = { floor, tops: rest.slice(0, 4), sides: rest.slice(4, 8), wall: rest[8] };
    TILE.ready = true;
    if (st) { boardTheme = null; buildBackground(); }        // 絵がそろったら盤と額縁を描き直す
  });
}
// 色の置き換え（砂岩の段 → いまのゾーンの段）。結果はゾーンごとに覚えておく
function tinted(key, img, from, to) {
  const k = key + '|' + to.join(',');
  if (TILE.cache.has(k)) return TILE.cache.get(k);
  const c = canvas(img.width, img.height), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height), m = new Map(from.map((h, i) => [parseInt(h.slice(1), 16), rgba(to[i])]));
  for (let i = 0; i < d.data.length; i += 4) {
    const t = m.get((d.data[i] << 16) | (d.data[i + 1] << 8) | d.data[i + 2]);
    if (t) { d.data[i] = t[0]; d.data[i + 1] = t[1]; d.data[i + 2] = t[2]; }
  }
  x.putImageData(d, 0, 0); TILE.cache.set(k, c); return c;
}
const floorSheet = () => tinted('floor', TILE.img.floor, BOARD_TILES.floorRamp, C.floorRamp);
const wallImg = (key, img) => tinted(key, img, BOARD_TILES.wallRamp, C.wallRamp);
function tileFloorTexture() {
  const N = 48, c = canvas(N * 8, N * 8), x = c.getContext('2d'), R = seeded(st.floor * 7919 + 13), S = BOARD_TILES.floorSets, sheet = floorSheet();
  x.imageSmoothingEnabled = false;
  for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) {
    const light = (tx + ty) % 2 === 1, deco = R() < (light ? 0.28 : 0.15) && st.map[ty + 1]?.[tx + 1] === '.';
    const set = light ? (deco ? S.lightDeco : S.light) : (deco ? S.darkDeco : S.dark), k = set[Math.floor(R() * set.length)];
    x.drawImage(sheet, (k % 4) * N, Math.floor(k / 4) * N, N, N, tx * N, ty * N, N, N);
    if (ty === 0 || st.map[ty][tx + 1] === '#') { x.fillStyle = C.floorRamp[2]; x.fillRect(tx * N + 1, ty * N + 1, N - 2, 3); }   // 壁の根元の影
  }
  x.drawImage(spr('stairs', '0'), (st.exit.x - 1) * N, (st.exit.y - 1) * N, N, N);
  return texOf(c);
}
// 天面の絵から帯を切り出して並べる（外周の壁の笠木・ふちの天面）。vertical なら縦に並べる
function topStrip(w, h, vertical, seed) {
  const c = canvas(w, h), x = c.getContext('2d'), r = rnd(seed), L = vertical ? h : w, D = vertical ? w : h;
  x.imageSmoothingEnabled = false;
  for (let p = 0; p < L; p += 48) {
    const src = wallImg('top' + (Math.floor(r() * 4)), TILE.img.tops[Math.floor(r() * 4)]);
    if (vertical) x.drawImage(src, 24 - D / 2, 0, D, 48, 0, p, D, 48); else x.drawImage(src, 0, 24 - D / 2, 48, D, p, 0, 48, D);
  }
  return texOf(c);
}
function tileWallTop(seed) { const k = seed % 4; return texOf(wallImg('top' + k, TILE.img.tops[k])); }
function tileWallSide(seed = 0) { const k = seed % 4; return texOf(wallImg('side' + k, TILE.img.sides[k])); }
function tileBackWall() {
  const c = canvas(432, 52), x = c.getContext('2d'), w = wallImg('wall', TILE.img.wall);
  x.drawImage(w, 0, 0); x.drawImage(w, 216, 0);       // 220 幅の石積みを2つ並べる（つなぎ目は石の目地に隠れる）
  return texOf(c);
}
function pillarTop(seed) {
  const c = canvas(24, 24), [, f] = painter(c), r = rnd(seed);
  f(C.rockTop, 0, 0, 24, 24); f(C.rockHi, 0, 0, 24, 2); f(C.rockHi, 0, 0, 2, 24); f(C.rock, 22, 0, 2, 24); f(C.rock, 0, 22, 24, 2);
  if (r() < 0.6) { const a = 3 + Math.floor(r() * 12), b = 3 + Math.floor(r() * 12); f(C.moss1, a, b, 6, 3); f(C.moss0, a + 1, b + 3, 4, 1); f(C.moss2, a + 2, b, 2, 1); }
  return texOf(c);
}
function pillarSide(seed) {
  const c = canvas(24, 24), [, f] = painter(c), r = rnd(seed);
  f(C.rock, 0, 0, 24, 24); f(C.bgDeep, 0, 23, 24, 1); f(C.bgDeep, 0, 11, 24, 1); f(C.bgDeep, r() < 0.5 ? 7 : 15, 0, 1, 11); f(C.bgDeep, r() < 0.5 ? 5 : 17, 12, 1, 11);
  f(C.rockTop, 0, 0, 24, 1);
  if (r() < 0.5) { const a = Math.floor(r() * 20); f(C.moss1, a, 0, 3, 3 + Math.floor(r() * 4)); }
  return texOf(c);
}

// ---------------------------------------------------------------- 3D：描画の準備とカメラ
const glCanvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: false });
const RS = 2;                                   // 3Dを描く細かさ（480×270 の何倍か）。盤の絵は1ドット＝この細かさの1ドット
renderer.setPixelRatio(1); renderer.setSize(NW * RS, NH * RS, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;
const scene = new THREE.Scene();
// カメラ：本当に傾けた3Dのカメラ（南の斜め上から見下ろす）。光の試作と同じ仕組み
// ・elev … 仰角（ふだん45度）／fit … 1 で床の1ドット＝画面の1ドット／persp … 遠近（0＝なし）
const cam = new THREE.OrthographicCamera(-10, 10, 5.625, -5.625, 1, 400);
const CAM0 = { cx: 4, cz: 4, zoom: 1, elev: 45, fit: 1, persp: 0, dof: 0 };   // 盤は真ん中。上の壁は体力の棒の下にもぐる（手札の絵が見えるよう、下を空ける）
const camS = { ...CAM0, sx: 0, sy: 0 };
const Po = new THREE.Matrix4(), Pp = new THREE.Matrix4(), Pm = new THREE.Matrix4();
const DIST = 60, NEAR = 1, FAR = 200;
function updateCamera() {
  const el = camS.elev * Math.PI / 180, z = camS.zoom;
  const snap = v => Math.round(v * PX * z) / (PX * z);
  const tx = snap(camS.cx), tz = snap(camS.cz);
  cam.position.set(tx, DIST * Math.sin(el), tz + DIST * Math.cos(el)); cam.up.set(0, 1, 0); cam.lookAt(tx, 0, tz);
  cam.updateMatrixWorld();
  const stretch = 1 + camS.fit * (1 / Math.sin(el) - 1);
  const hw = NW / PX / 2 / z, hh = NH / PX / 2 / z / stretch, ox = camS.sx / PX / z, oy = camS.sy / PX / z / stretch;
  Po.makeOrthographic(-hw + ox, hw + ox, hh + oy, -hh + oy, NEAR, FAR);
  const q = NEAR / DIST;
  Pp.makePerspective((-hw + ox) * q, (hw + ox) * q, (hh + oy) * q, (-hh + oy) * q, NEAR, FAR);
  for (let i = 0; i < 16; i++) Pm.elements[i] = Po.elements[i] * (1 - camS.persp) + Pp.elements[i] * camS.persp;
  cam.projectionMatrix.copy(Pm); cam.projectionMatrixInverse.copy(Pm).invert();
}
// 盤のドット座標 ⇄ 3D ⇄ 画面
const toWorld = (px, py) => ({ x: (px - OX) / T, z: (py - OY) / T });
const _v = new THREE.Vector3();
function S(px, py, h = 0) {
  const w = toWorld(px, py); _v.set(w.x, h, w.z).project(cam);
  return [(_v.x + 1) / 2 * NW, (1 - _v.y) / 2 * NH];
}
function groundAt(sx, sy) {        // 画面の点 → 床（高さ0）の上の点
  const ndx = sx / NW * 2 - 1, ndy = 1 - sy / NH * 2;
  const a = new THREE.Vector3(ndx, ndy, -1).unproject(cam), b = new THREE.Vector3(ndx, ndy, 1).unproject(cam);
  const t = a.y / (a.y - b.y); return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

// 1枚絵の背景（B キーで3Dの立方体と切り替え）。10階ごとにゾーンの絵を替える（js/bgzones.js：砂岩／苔と松明／地下水）。
// 絵は 480×270 のキャンバスに描き、動き（炎・滝＝決まったコマの差分、砂岩＝風に乗る砂粒）はそこへ塗り重ねて、テクスチャとして盤の後ろに敷く
const bgScene = new THREE.Scene(), bgCam = new THREE.OrthographicCamera(0, NW, NH, 0, -1, 1);
let bgFlatMesh = null, flatMode = false, bgPreview = null;   // bgPreview：G キーで選んだ確認用のゾーン
const bgCv = canvas(NW, NH), bgCx = bgCv.getContext('2d', { willReadFrequently: true });
const bgTex = new THREE.CanvasTexture(bgCv);
bgTex.magFilter = bgTex.minFilter = THREE.NearestFilter; bgTex.generateMipmaps = false; bgTex.colorSpace = THREE.SRGBColorSpace;
bgFlatMesh = new THREE.Mesh(new THREE.PlaneGeometry(NW, NH), new THREE.MeshBasicMaterial({ map: bgTex }));
bgFlatMesh.position.set(NW / 2, NH / 2, 0); bgScene.add(bgFlatMesh);
const bgZone = { z: null, img: null, px: null, frame: -1, last: 0, parts: [] };
const bgImgs = new Map();
function zoneOfFloor(f) { const Z = globalThis.BG_ZONES || []; return Z.find(z => f >= z.from && f <= z.to) || Z[Z.length - 1]; }
function setBgZone(z) {
  if (!z || bgZone.z === z) return;
  bgZone.z = z; bgZone.frame = -1; bgZone.parts = []; bgZone.px = null;
  let img = bgImgs.get(z);
  const ready = () => {
    if (bgZone.z !== z) return;
    bgZone.img = img; bgCx.drawImage(img, 0, 0); bgZone.px = bgCx.getImageData(0, 0, NW, NH).data;   // 砂粒が岩と同じ色かを見るため
    bgTex.needsUpdate = true;
  };
  if (!img) { img = new Image(); bgImgs.set(z, img); img.onload = ready; img.src = z.base; } else if (img.complete) ready(); else img.onload = ready;
}
// 砂粒：遠くの粒は暗い色で遅く、近くの粒は明るい色で速い。左から右へ流れ、たまに少し強く吹く。同じ色の岩の上ではひとつ暗い色で見せる
function newGrain(x) {
  const far = Math.random() < 0.55;
  return { x: x ?? Math.random() * NW, y: 10 + Math.random() * 245, v: far ? 0.6 + Math.random() * 0.4 : 1.3 + Math.random() * 0.9, far,
    ph: Math.random() * 6.28, amp: 0.6 + Math.random() * 1.4, len: far || Math.random() < 0.65 ? 1 : 2 };
}
function tickBackground(now) {
  const z = bgZone.z; if (!z || !bgZone.img) return;
  if (z.sand) {
    if (now - bgZone.last < 60) return;                 // 砂粒は 60ms ごとに1歩
    const steps = Math.min(4, Math.round((now - bgZone.last) / 60)) || 1; bgZone.last = now;
    if (!bgZone.parts.length) for (let i = 0; i < z.sand.n; i++) bgZone.parts.push(newGrain());
    const t = now / 60, gust = 1 + 0.4 * Math.max(0, Math.sin(t / 160 * Math.PI * 2)) ** 3;
    bgCx.drawImage(bgZone.img, 0, 0);
    for (const p of bgZone.parts) {
      p.x += p.v * gust * steps; p.y += 0.08 * gust * steps;
      if (p.x > NW + 5 || p.y > NH - 8) Object.assign(p, newGrain(-2 - Math.random() * 10));
      const x = Math.floor(p.x), y = Math.floor(p.y + p.amp * Math.sin(p.ph + t * 0.15)), n = p.len + (gust > 1.3 && !p.far ? 1 : 0);
      for (let d = 0; d < n; d++) {
        const xx = x - d; if (xx < 0 || xx >= NW || y < 0 || y >= NH) continue;
        let col = p.far ? z.sand.far : z.sand.near;
        const i = (y * NW + xx) * 4, here = '#' + [0, 1, 2].map(k => bgZone.px[i + k].toString(16).padStart(2, '0')).join('');
        if (here === col) col = col === z.sand.near ? z.sand.far : z.sand.dark;
        bgCx.fillStyle = col; bgCx.fillRect(xx, y, 1, 1);
      }
    }
    bgTex.needsUpdate = true; return;
  }
  if (!z.frames.length) return;
  const f = Math.floor(now / z.ms) % z.frames.length;
  if (f === bgZone.frame) return;
  bgZone.frame = f;
  bgCx.drawImage(bgZone.img, 0, 0);
  const d = z.frames[f];
  for (let i = 0; i < d.length; i += 3) { bgCx.fillStyle = z.cols[d[i + 2]]; bgCx.fillRect(d[i], d[i + 1], 1, 1); }
  bgTex.needsUpdate = true;
}

// ---------------------------------------------------------------- 3D：光（光の試作で合わせた値）
const ambient = new THREE.AmbientLight('#ffffff', 0.81); scene.add(ambient);
const hemi = new THREE.HemisphereLight('#dfe6ff', '#1d2a4a', 0.55); scene.add(hemi);
const sky = new THREE.DirectionalLight('#e8eeff', 1.3); sky.position.set(-4, 10, -5); sky.target.position.set(0, 0, 0); scene.add(sky, sky.target);
const torches = [];
for (const tx of [2.5, 5.5]) {
  const L = new THREE.PointLight('#ffd9a0', 6, 8, 1.3);
  L.position.set(tx, 0.85, 0.45); L.castShadow = true;
  L.shadow.mapSize.set(512, 512); L.shadow.camera.near = 0.05; L.shadow.camera.far = 12; L.shadow.bias = -0.004;
  scene.add(L); torches.push({ L, x: tx, base: 6, ph: Math.random() * 6 });
}

// ---------------------------------------------------------------- 3D：額縁（奥の壁・左右のふち・手前のふち）。ゾーンの色が替わったら作り直す
const lambert = (map, extra = {}) => new THREE.MeshLambertMaterial({ map, ...extra });
function box(parent, w, h, d, x, y, z, mats) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m; }
const frameGrp = new THREE.Group(); scene.add(frameGrp);
function buildFrame() {
  for (const ch of [...frameGrp.children]) { frameGrp.remove(ch); disposeTree(ch); }
  const tl = TILE.ready, bh = 26 / PX;
  const cap = lambert(tl ? topStrip(432, 12, false, 1) : capTexture(216, 6)), face = lambert(tl ? tileBackWall() : brickTexture(216, 26)), dark = lambert(tl ? tileWallTop(1) : capTexture(24, 24));
  box(frameGrp, 9, bh, 0.25, 4, bh / 2, -0.125, [dark, dark, cap, dark, face, dark]);
  const rimCap = lambert(tl ? topStrip(24, 432, true, 2) : capTexture(12, 216)), rimSide = lambert(wallSideTexture(6));
  box(frameGrp, 0.5, 0.25, 8.7, -0.25, 0.125, 4.1, [rimSide, rimSide, rimCap, rimSide, rimSide, rimSide]);
  box(frameGrp, 0.5, 0.25, 8.7, 8.25, 0.125, 4.1, [rimSide, rimSide, rimCap, rimSide, rimSide, rimSide]);
  const lipCap = lambert(tl ? topStrip(432, 20, false, 3) : capTexture(216, 10)), lipFace = lambert(wallSideTexture(4));
  box(frameGrp, 9, 0.17, 0.42, 4, 0.085, 8.21, [lipFace, lipFace, lipCap, lipFace, lipFace, lipFace]);
}
// ゾーンの色を盤に当てる（色の表を差し替え、光の色も合わせ、額縁を描き直す。盤そのものは buildBackground が描く）
function applyBoardTheme(name) {
  const t = BOARD_THEMES[name] || BOARD_THEMES['地下水'];
  if (boardTheme === t) return;
  boardTheme = t; Object.assign(C, t);
  hemi.color.set(t.hemiSky); hemi.groundColor.set(t.hemiGround); sky.color.set(t.sun);
  buildFrame();
}
const flameMats = [];
for (const t of torches) {
  const fm = new THREE.MeshBasicMaterial({ map: sprTex('torch', '0'), alphaTest: 0.5 });
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(7 / PX, 11 / PX), fm); fl.position.set(t.x, 0.78, 0.01); scene.add(fl); flameMats.push(fm);
  const br = new THREE.Mesh(new THREE.PlaneGeometry(7 / PX, 7 / PX), new THREE.MeshBasicMaterial({ map: sprTex('bracket', '0'), alphaTest: 0.5 }));
  br.position.set(t.x, 0.42, 0.005); scene.add(br);
}

// ---------------------------------------------------------------- 3D：盤（階ごとに作り直す）
const board = new THREE.Group(); scene.add(board);
const floorOverC = canvas(192, 192), floorOverTex = texOf(floorOverC);
const floorOver = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ map: floorOverTex, transparent: true, depthWrite: false }));
floorOver.rotation.x = -Math.PI / 2; floorOver.position.set(4, 0.004, 4); floorOver.renderOrder = 1; scene.add(floorOver);
function disposeTree(o) { o.traverse(m => { if (m.geometry) m.geometry.dispose(); const ms = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []; ms.forEach(mm => { if (mm.map && !mm.map.shared) mm.map.dispose(); mm.dispose(); }); }); }
function buildBackground() {
  const zone = bgPreview || zoneOfFloor(st.floor);
  setBgZone(zone); applyBoardTheme(zone?.name);
  for (const ch of [...board.children]) { board.remove(ch); disposeTree(ch); }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), lambert(TILE.ready ? tileFloorTexture() : floorTexture()));
  floor.rotation.x = -Math.PI / 2; floor.position.set(4, 0, 4); floor.receiveShadow = true; board.add(floor);
  const wallH = 8 / PX, side = lambert(TILE.ready ? tileWallSide(st.floor) : wallSideTexture(8));
  let i = 0;
  for (let ty = 1; ty <= 8; ty++) for (let tx = 1; tx <= 8; tx++) {
    if (st.map[ty][tx] !== '#') continue;
    const seed = (i++) * 17 + st.floor * 5 + 3, top = lambert(TILE.ready ? tileWallTop(seed) : wallTopTexture(seed));
    box(board, 1, wallH, 1, tx - 0.5, wallH / 2, ty - 0.5, [side, side, top, side, side, side]);
  }
  floorOverKey = '';
}

// ---------------------------------------------------------------- 3D：盤の外（45度に回した柱の積み上げ）と動く水
const cliffs = new THREE.Group(); scene.add(cliffs);
{
  const tops = [0, 1, 2, 3].map(i => lambert(pillarTop(40 + i))), sides = [0, 1, 2].map(i => lambert(pillarSide(80 + i)));
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const r = rnd(9), cols = [];
  const grid = new Map(), cell = (i, j) => { const k = i + ',' + j; if (!grid.has(k)) grid.set(k, r()); return grid.get(k); };
  const noise = (u, v) => {
    const i = Math.floor(u / 3), j = Math.floor(v / 3), fu = u / 3 - i, fv = v / 3 - j, sm = t => t * t * (3 - 2 * t);
    const a = cell(i, j), b = cell(i + 1, j), c = cell(i, j + 1), d = cell(i + 1, j + 1);
    return (a + (b - a) * sm(fu)) * (1 - sm(fv)) + (c + (d - c) * sm(fu)) * sm(fv);
  };
  for (let u = -14; u <= 14; u++) for (let v = -14; v <= 14; v++) {
    const x = 4 + (u - v) * Math.SQRT1_2, z = 4 + (u + v) * Math.SQRT1_2;
    const left = x < -1.15, right = x > 9.15;
    if (!(left || right) || z < -5 || z > 13.5 || x < -7.5 || x > 15.5) continue;
    const edge = left ? -1.15 - x : x - 9.15, n = noise(u + 20, v + 20);
    let h = 4.2 - 0.55 * (z + 1.5) - 0.2 * edge + (n - 0.5) * 6 + (r() < 0.25 ? 1 : 0);
    h = Math.round(h);
    if (h < -1 || n < 0.22) continue;
    cols.push({ x, z, h });
  }
  const buckets = new Map(), dummy = new THREE.Object3D();
  for (const c of cols) {
    const ti = Math.floor(r() * tops.length), si = Math.floor(r() * sides.length);
    for (let y = -2; y < c.h; y++) {
      const key = (y === c.h - 1 ? 't' + ti : 'n') + '-' + si;
      if (!buckets.has(key)) buckets.set(key, { top: y === c.h - 1 ? tops[ti] : sides[si], side: sides[si], list: [] });
      buckets.get(key).list.push([c.x, y + 0.5, c.z]);
    }
  }
  for (const b of buckets.values()) {
    const im = new THREE.InstancedMesh(cube, [b.side, b.side, b.top, b.side, b.side, b.side], b.list.length);
    b.list.forEach(([x, y, z], i) => { dummy.position.set(x, y, z); dummy.rotation.set(0, Math.PI / 4, 0); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
    im.instanceMatrix.needsUpdate = true; cliffs.add(im);
  }
  cliffs.userData.cols = cols;
}
const waterC = canvas(48, 48), waterTex = texOf(waterC, true);
waterTex.repeat.set(12, 12);
function paintWater(t) {
  const [, f] = painter(waterC); f(C.bgDeep, 0, 0, 48, 48);
  const r = rnd(3);
  for (let i = 0; i < 22; i++) {
    const bx = Math.floor(r() * 48), by = Math.floor(r() * 48), sp = 1 + Math.floor(r() * 3);
    const yy = (by + Math.floor(t / 220) * sp) % 48, len = 2 + Math.floor(r() * 4);
    f(i % 5 === 0 ? C.glow : C.rock, bx, yy, len, 1);
  }
  waterTex.needsUpdate = true;
}
paintWater(0);
{
  const water = new THREE.Mesh(new THREE.PlaneGeometry(48, 48), new THREE.MeshBasicMaterial({ map: waterTex, color: '#c8d4ff' }));
  water.rotation.x = -Math.PI / 2; water.position.set(4, -1.05, 4); cliffs.add(water);
}
const fallTexes = [];
{
  const fallC = canvas(8, 24), [, f] = painter(fallC), fallTex = texOf(fallC, true);
  f(C.rockTop, 0, 0, 8, 24);
  for (let yy = 0; yy < 24; yy++) { f(yy % 6 < 3 ? C.glow : C.floorB, 2 + (yy % 4 === 0 ? 1 : 0), yy, 2, 1); f(yy % 8 < 2 ? C.white : C.glow, 5, yy, 1, 1); }
  f(C.rock, 0, 0, 1, 24); f(C.rock, 7, 0, 1, 24);
  const cols = cliffs.userData.cols.filter(c => c.h >= 2).sort((a, b) => a.z - b.z);
  const picks = [cols.find(c => c.x < 0 && c.z < 2), cols.find(c => c.x > 8 && c.z < 3), cols.find(c => c.x < -2 && c.z > 3), cols.find(c => c.x > 10 && c.z > 4)].filter(Boolean);
  for (const c of picks) {
    const len = c.h + 1.05, t2 = fallTex.clone(); t2.repeat.set(1, len); t2.needsUpdate = true; fallTexes.push(t2);
    const fall = new THREE.Mesh(new THREE.PlaneGeometry(8 / PX, len), new THREE.MeshBasicMaterial({ map: t2 }));
    fall.position.set(c.x, c.h - len / 2, c.z + Math.SQRT1_2 + 0.01); cliffs.add(fall);
    const L = new THREE.PointLight('#4aa3e8', 1.4, 3.2, 1.2); L.position.set(c.x, -0.6, c.z + 1.0); cliffs.add(L);
  }
}
const embers = [];
{
  const emberMat = new THREE.MeshBasicMaterial({ color: '#f0b84a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < 18; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1 / PX, 1 / PX), emberMat.clone()); scene.add(m);
    embers.push({ m, t0: -Math.random() * 3000, life: 1800 + Math.random() * 1800, x: 0, sx: 0 });
  }
}
function setFlat(on) { flatMode = on; cliffs.visible = !on; }      // 1枚絵（2D）がふだん。B で3Dの立方体と切り替え

// ---------------------------------------------------------------- 3D：紙のキャラ（足もとを軸に、カメラの傾きに合わせて後ろへ倒す）
const UP_NORMAL = geo => { const n = geo.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0); n.needsUpdate = true; return geo; };
let paperTilt = 0;
class Paper {
  constructor(group) {
    const g = SPR.groups[group];
    // k：絵の細かさ（盤と同じ倍の細かさで描いた絵は k=2。紙の大きさは 絵のドット数÷k）
    const k = g.k || 1;
    this.group = group; this.w = g.w / k; this.h = g.h / k; this.ground = g.ground ?? (g.h - 1);
    this.mat = new THREE.MeshLambertMaterial({ alphaTest: 0.5, side: THREE.DoubleSide });
    this.pivot = new THREE.Group(); scene.add(this.pivot);
    this.mesh = new THREE.Mesh(UP_NORMAL(new THREE.PlaneGeometry(this.w / PX, this.h / PX)), this.mat);
    this.mesh.position.y = (2 * (this.ground + 1) / k - this.h) / 2 / PX;
    this.mesh.castShadow = true; this.pivot.add(this.mesh);
    this.alpha = 1;
  }
  frame(name, flip, swap) {
    const g = SPR.groups[this.group];
    if (!ensureFrame(g, name)) name = g.frames[name.slice(0, 3) + 'idle_0'] ? name.slice(0, 3) + 'idle_0' : Object.keys(g.frames).find(n => n.endsWith('idle_0')) || Object.keys(g.frames)[0];
    const t = sprTex(this.group, name, flip, swap);
    if (this.mat.map !== t) { this.mat.map = t; this.mat.needsUpdate = true; }
  }
  setAlpha(a) {
    if (a === this.alpha) return;
    this.alpha = a; this.mat.transparent = a < 1; this.mat.opacity = a; this.mat.alphaTest = a < 1 ? 0.02 : 0.5; this.mat.needsUpdate = true;
    this.mesh.castShadow = a > 0.5;
  }
  put(px, py, lift = 0) {
    const w = toWorld(px, py);
    this.pivot.position.set(w.x, lift / PX, w.z); this.pivot.rotation.x = -paperTilt;
  }
  dispose() { scene.remove(this.pivot); this.mesh.geometry.dispose(); this.mat.dispose(); }
}
const PGROUP = SPR.groups.thief_hd ? 'thief_hd' : SPR.groups.thief ? 'thief' : 'player';   // 主人公：細かい絵（thief_hd、js/enemies_hd.js）があればそれ。まだ描いていないコマ（歩き・攻撃・被弾）は立ち姿になる
const egroup = kind => SPR.groups[kind + '_hd'] ? kind + '_hd' : SPR.groups[kind + '_d'] ? kind + '_d' : kind;   // 大きく細かい絵（_hd）があればそれ
const papers = new Map();      // 見た目の物（主人公・敵・品） → 紙
function paperOf(ent, group) {
  let p = papers.get(ent);
  if (p && p.group !== group) { p.dispose(); p = null; }
  if (!p) { p = new Paper(group); papers.set(ent, p); }
  p.used = true; return p;
}

// ---------------------------------------------------------------- 3D：カメラの動き（攻撃のアップ）
const camTweens = [];
function twk(obj, key, to, ms, ease = t => t) {
  for (let i = camTweens.length - 1; i >= 0; i--) if (camTweens[i].obj === obj && camTweens[i].key === key) camTweens.splice(i, 1)[0].res();   // 同じ値の動きは新しい方に切り替える
  return new Promise(res => camTweens.push({ obj, key, from: obj[key] ?? 0, to, t0: clock, ms, ease, res }));
}
function stepTwk() {
  for (let i = camTweens.length - 1; i >= 0; i--) {
    const w = camTweens[i], t = Math.min(1, (clock - w.t0) / w.ms);
    w.obj[w.key] = w.from + (w.to - w.from) * w.ease(t);
    if (t >= 1) { camTweens.splice(i, 1); w.res(); }
  }
}
function camTo(p, ms, ease) { return Promise.all(Object.keys(p).map(k => twk(camS, k, p[k], ms, ease))); }
// ふだん（攻撃・被弾）はごく控えめにすばやく寄る。大アップだけ強く寄って傾ける
function camFocus(a, b, strong) {
  const ents = [a, b].flat(), pts = ents.map(e => toWorld(e.px, e.py)), pan = strong ? 1 : 0.25;
  const mx = pts.reduce((t, w) => t + w.x, 0) / pts.length, mz = pts.reduce((t, w) => t + w.z, 0) / pts.length;
  // 大アップのときは、ピントを二人に合わせて手前と奥をぼかす（dof）
  dofFocus = ents;
  return camTo({
    zoom: strong ? 2.2 : 1.08, elev: strong ? 33 : 44, fit: strong ? 0 : 0.93, persp: strong ? 0.48 : 0, dof: strong ? 1 : 0,
    cx: CAM0.cx + (mx - CAM0.cx) * pan, cz: CAM0.cz + (mz - 0.4 - CAM0.cz) * pan,
  }, strong ? 200 : 110, easeOut);
}
const camHome = (ms = 320) => camTo(CAM0, ms, easeInOut);

// ---------------------------------------------------------------- 3D：大アップの被写界深度（手前と奥のぼかし）
// カメラは見下ろしなので、画面の上が奥、下が手前。ピントを合わせた二人の高さぶんはくっきり残し、
// そこから上下に離れるほどぼかす（横と縦に分けた2回のぼかし）。dof が 0 のときは何もしない
const DOF_PAD_X = 38, DOF_PAD_Y = 25;     // くっきり残す丸の、二人のまわりの余白（拡大前のドット）
let dofFocus = [];          // ピントを合わせる相手（攻撃する側と受ける側）
const rtOpt = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true };
const rtA = new THREE.WebGLRenderTarget(NW * RS, NH * RS, rtOpt), rtB = new THREE.WebGLRenderTarget(NW * RS, NH * RS, { ...rtOpt, depthBuffer: false });
rtA.texture.colorSpace = rtB.texture.colorSpace = THREE.SRGBColorSpace;
const dofMat = new THREE.ShaderMaterial({
  uniforms: { tex: { value: null }, res: { value: new THREE.Vector2(NW, NH) }, dir: { value: new THREE.Vector2(1, 0) },
    focus: { value: new THREE.Vector2(NW / 2, NH / 2) }, halfSize: { value: new THREE.Vector2(60, 30) }, ramp: { value: 0.8 }, maxR: { value: 7 }, amt: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tex; uniform vec2 res; uniform vec2 dir; uniform vec2 focus, halfSize; uniform float ramp, maxR, amt;
    varying vec2 vUv;
    void main() {
      // 画面の点が、二人を囲む丸（超楕円・指数3：少し長方形寄り）のどれだけ外にあるか
      vec2 q = abs(vec2(vUv.x * res.x, (1.0 - vUv.y) * res.y) - focus) / halfSize;
      float d = pow(pow(q.x, 3.0) + pow(q.y, 3.0), 1.0 / 3.0);
      float r = maxR * amt * smoothstep(1.0, 1.0 + ramp, d);
      vec4 c = vec4(0.0); float ws = 0.0;
      for (int i = -4; i <= 4; i++) { float f = float(i); float w = exp(-f * f / 8.0); c += texture2D(tex, vUv + dir * f * r * 0.25 / res) * w; ws += w; }
      gl_FragColor = c / ws;
      #include <colorspace_fragment>
    }`,
  depthTest: false, depthWrite: false,
});
const dofScene = new THREE.Scene(), dofCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
dofScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), dofMat));
const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
const seeded = rnd;

// ---------------------------------------------------------------- 効果
function addFx(group, frames, x, y, opt = {}) {
  const f = { group, frames, x, y, t0: clock, dir: opt.dir, flip: opt.flip, until: clock + frames.reduce((s, [, d]) => s + d, 0) };
  view.fx.push(f); return f;
}
function addNum(text, x, y, color = '#ffffff') { view.nums.push({ text: String(text), x, y, color, t0: clock }); }
function addMark(group, frame, x, y, ms = 900, rise = 8) { view.marks.push({ group, frame, x, y, t0: clock, ms, rise }); }
function shake(amp = 2, ms = 170) { view.shake = { amp, ms, t0: clock }; }
function dust(x, y) { addFx('dust', [['0', 50], ['1', 60], ['2', 70]], x - 4, y - 4); }

// ---------------------------------------------------------------- 移動の補間
function tween(ent, tx, ty, ms, ease = t => t) {
  ent.tw = { fx: ent.px, fy: ent.py, tx, ty, t0: clock, ms, ease };
  return wait(ms);
}
function stepTween(ent) {
  const w = ent.tw; if (!w) return;
  const t = Math.min(1, (clock - w.t0) / w.ms), e = w.ease(t);
  ent.px = w.fx + (w.tx - w.fx) * e; ent.py = w.fy + (w.ty - w.fy) * e;
  if (t >= 1) ent.tw = null;
}
const easeOut = t => 1 - (1 - t) * (1 - t);

// ---------------------------------------------------------------- 描画
// 3D の上に重ねる2Dの層（数字・体力の札・効果のドット・暗転）
const cv = document.getElementById('over'), ctx = cv.getContext('2d');
cv.width = NW; cv.height = NH; ctx.imageSmoothingEnabled = false;

// 主人公の向き：斜め前・斜め後ろだけ。上へは斜め後ろ、下と左右へは斜め前。左右は直前を保ち、左は反転
// 主人公の髪の色（キャラメイクの髪色をキャラチップに反映する）。絵の髪の記号は thief_hd.roles.hair（記号→もとの色）。
// playerHair：もとの髪の色 → 新しい色（明 #8a5a38・中 #5c422c・暗 #3f2d21）。null なら絵のまま
const HAIR_PRESETS = {   // 顔グラの国ごとの髪色（2色）を、チップの3段に当てたもの（暗い段は中の色のひとつ暗い色）
  南国人: ['#f0b84a', '#8a5a38', '#5c422c'], 北国人: ['#b8c4cc', '#7a8e9c', '#506573'], 東国人: ['#2c3a48', '#18222d', '#0b1120'],
  西国人: ['#6e655a', '#4a4640', '#3f2d21'], はてない国人: ['#d24a3c', '#8f2f2b', '#3f2d21'], 森国人: ['#cca673', '#8a5a38', '#5c422c'],
  紫黒: ['#2b3e6d', '#0e1c3f', '#0b1120'],   // おたから「メカクレ一式」の髪（顔グラの紫黒）
};
let playerHair = null, playerSwapCache = null;
function setPlayerHair(cols) {     // cols：[明, 中, 暗] か、HAIR_PRESETS の名前か、null
  const c = typeof cols === 'string' ? HAIR_PRESETS[cols] : cols;
  playerHair = c ? { '#8a5a38': c[0], '#5c422c': c[1], '#3f2d21': c[2] } : null; playerSwapCache = null;
}
function hairSwap(cols) {   // 髪の色（HAIR_PRESETS の名前か [明, 中, 暗]）→ 主人公の絵の記号の置き換え（OP の広場の6人やキャラメイクでも使う）
  const c = typeof cols === 'string' ? HAIR_PRESETS[cols] : cols, roles = SPR.groups[PGROUP]?.roles?.hair;
  if (!c || !roles) return null;
  const to = { '#8a5a38': c[0], '#5c422c': c[1], '#3f2d21': c[2] }, sw = {};
  for (const [ch, base] of Object.entries(roles)) if (to[base]) sw[ch] = to[base];
  return sw;
}
function playerSwap() {
  if (playerSwapCache !== null) return playerSwapCache || null;
  const roles = SPR.groups[PGROUP]?.roles?.hair; let sw = false;
  if (playerHair && roles) { sw = {}; for (const [ch, base] of Object.entries(roles)) if (playerHair[base]) sw[ch] = playerHair[base]; }
  playerSwapCache = sw; return sw || null;
}
function playerLook(p) {
  if (p.dir === 'a') p.flip = true; else if (p.dir === 'd') p.flip = false;
  if (PGROUP.startsWith('thief')) return { prefix: p.dir === 'w' ? 'bk_' : 'fr_', flip: !!p.flip };
  return { prefix: p.dir === 'w' ? 'up_' : p.dir === 's' ? 'down_' : 'side_', flip: p.dir === 'a' };
}
// 画面に写したときの拡大率（寄ると数字や効果も大きくなる）
const scaleNow = () => camS.zoom;
function blit(img, cx, cy, k = scaleNow()) {        // 画面の点 (cx, cy) を中心に描く
  const w = img.width * k, h = img.height * k;
  ctx.drawImage(img, Math.round(cx - w / 2), Math.round(cy - h / 2), Math.round(w), Math.round(h));
}

function draw(now) {
  // 揺れ
  camS.sx = camS.sy = 0;
  if (view.shake) {
    const t = (clock - view.shake.t0) / view.shake.ms;
    if (t >= 1) view.shake = null; else { const a = view.shake.amp * (1 - t); camS.sx = Math.round(Math.sin(clock * 0.09) * a); camS.sy = Math.round(Math.cos(clock * 0.13) * a * 0.5); }
  }
  updateCamera();
  // 紙の傾き：ふだん（床をドットにそろえる・45度）は垂直、本当の傾きではカメラの方へ倒す
  { const el = camS.elev * Math.PI / 180, s = 1 + camS.fit * (1 / Math.sin(el) - 1); paperTilt = Math.max(0, el - Math.acos(Math.min(1, 1 / s))); }

  // 紙のキャラと品
  for (const pp of papers.values()) pp.used = false;
  const p = view.player;
  if (p) {
    stepTween(p);
    const look = playerLook(p), pp = paperOf(p, PGROUP);
    pp.frame(look.prefix + animFrame(p.anim), look.flip, playerSwap());
    pp.put(p.px + (p.ox || 0), p.py + (p.oy || 0), (p.lift || 0) - (p.sink || 0)); pp.setAlpha(p.alpha);
  }
  for (const v of view.enemies.values()) {
    stepTween(v);
    if (v.gone) continue;
    const grp = egroup(v.kind), pp = paperOf(v, grp), diag = grp !== v.kind;
    pp.frame((diag ? (v.back ? 'bk_' : 'fr_') : '') + animFrame(v.anim), v.facing < 0, lookSwap(v, grp));
    let hop = 0;   // 歩くときの弾み（足を上げているあいだ、体が少し浮く）
    if (v.hop) { const t = (clock - v.hop.t0) / v.hop.ms; if (t >= 1) v.hop = null; else hop = Math.sin(Math.PI * Math.min(1, t / 0.7)) * HOP_PX; }
    pp.put(v.px, v.py, (v.lift || 0) + hop); pp.setAlpha(v.alpha);
  }
  for (const it of view.items) {
    const pp = paperOf(it, 'icon'), fx = footX(it.x), fy = footY(it.y);
    pp.frame(SPR.cardIcon[it.cardId] || 'scroll', false);
    // 敵と同じマスにいるときは、品を敵の手前に出して不透明度40％（敵も品も見えるように。2026-10-09 テストプレイ）
    const under = [...view.enemies.values()].some(v => !v.gone && Math.abs(v.px - fx) < T / 2 && Math.abs(v.py - fy) < T / 2);
    pp.put(fx, under ? fy + 3 : fy - 1, it.lift || 0); pp.setAlpha(under ? Math.min(it.alpha, 0.4) : it.alpha);
  }
  for (const [ent, pp] of papers) if (!pp.used) { pp.dispose(); papers.delete(ent); }

  // 盤の上の印（自分のカードの届くマス・指しているマス）
  drawFloorOver();
  // 松明（明滅させず、炎の形だけがゆらぎ、光はゆっくり揺れる）
  for (const [i, fm] of flameMats.entries()) { const f = sprTex('torch', String(Math.floor(now / 130 + i * 2) % 4)); if (fm.map !== f) { fm.map = f; fm.needsUpdate = true; } }
  for (const t of torches) t.L.intensity = t.base * (1 + 0.05 * Math.sin(now / 1700 + t.ph));
  if (!flatMode) { if (Math.floor(now / 220) !== paintWater.last) { paintWater.last = Math.floor(now / 220); paintWater(now); } for (const t of fallTexes) t.offset.y = Math.floor(now / 70) / 24; }
  for (const e of embers) {
    let t = now - e.t0;
    if (t > e.life || t < 0) { const tr = torches[Math.floor(Math.random() * 2)]; e.t0 = now; e.x = tr.x + (Math.random() - 0.5) * 0.2; e.sx = (Math.random() - 0.5) * 0.3; t = 0; }
    const q = t / e.life;
    e.m.position.set(e.x + e.sx * q + Math.sin(t / 300) * 0.05, 0.9 + q * 0.9, 0.3);
    e.m.material.opacity = Math.sin(Math.PI * q) * 0.9;
  }
  const dofOn = camS.dof > 0.01;
  if (dofOn) renderer.setRenderTarget(rtA);
  renderer.setClearColor(C.void, 1); renderer.clear();
  if (flatMode && bgFlatMesh) {
    tickBackground(now);
    const z = camS.zoom, sx = (CAM0.cx - camS.cx) * PX * z, sy = (camS.cz - CAM0.cz) * PX * z;
    bgFlatMesh.scale.set(z, z, 1); bgFlatMesh.position.set(NW / 2 + sx + camS.sx, NH / 2 + sy - camS.sy, 0);
    renderer.render(bgScene, bgCam); renderer.clearDepth();
  }
  renderer.render(scene, cam);
  if (dofOn) {                          // 横にぼかして rtB へ、縦にぼかして画面へ
    const z = camS.zoom, u = dofMat.uniforms;
    // 二人とも入るように、くっきり残す帯の中心と幅を決める（離れた相手を槍や弓で攻撃するときも）
    const pts = dofFocus.map(e => S(e.px, e.py - 13)), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    u.focus.value.set((x0 + x1) / 2, (y0 + y1) / 2); u.halfSize.value.set((x1 - x0) / 2 + DOF_PAD_X * z, (y1 - y0) / 2 + DOF_PAD_Y * z);
    u.amt.value = camS.dof;
    u.tex.value = rtA.texture; u.dir.value.set(1, 0); renderer.setRenderTarget(rtB); renderer.render(dofScene, dofCam);
    u.tex.value = rtB.texture; u.dir.value.set(0, 1); renderer.setRenderTarget(null); renderer.render(dofScene, dofCam);
  }

  // ---- ここから2Dの層
  ctx.clearRect(0, 0, NW, NH);
  const k = scaleNow();
  // 効果（斬撃・突き・火花・煙・土ぼこり・矢）
  view.fx = view.fx.filter(f => clock < f.until);
  for (const f of view.fx) {
    let t = clock - f.t0, fr = f.frames[f.frames.length - 1][0];
    for (const [n, d] of f.frames) { if (t < d) { fr = n; break; } t -= d; }
    const img = f.dir ? sprDir(f.group, fr, f.dir) : spr(f.group, fr, !!f.flip);
    const pos = typeof f.x === 'function' ? f.x() : [f.x, f.y];
    const [cx, cy] = S(pos[0] + img.width / 2, pos[1] + img.height / 2);
    blit(img, cx, cy, k);
  }
  // しるし（盾・毒・回復など）
  view.marks = view.marks.filter(m => clock - m.t0 < m.ms);
  for (const m of view.marks) {
    const t = (clock - m.t0) / m.ms, img = spr(m.group, m.frame);
    ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    const [cx, cy] = S(m.x, m.y - img.height / 2 - easeOut(Math.min(1, t * 2)) * m.rise);
    blit(img, cx, cy, k);
    ctx.globalAlpha = 1;
  }
  // 敵の体力（頭の右上に数字ひとつ）と状態
  for (const v of view.enemies.values()) {
    if (v.gone || v.dying) continue;
    const g = headH(v);   // 大きな絵は頭の上（top：足もとから頭までの高さ）
    const [bx, by] = S(v.px + 5, v.py - g - 4 + (v.lift ? -v.lift : 0));
    drawBadge(Math.round(bx), Math.round(by), v.hp, v.hp < v.maxHp);
    if (v.poison > 0) ctx.drawImage(spr('poison', String(Math.floor(clock / 400) % 2)), Math.round(bx) - 7, Math.round(by) + 1);
    if (v.stuck) { const [sx, sy] = S(v.px, v.py); blit(spr('stuck', '0'), sx, sy, k); }
  }
  // ダメージの数字
  view.nums = view.nums.filter(n => clock - n.t0 < 820);
  for (const n of view.nums) {
    const t = (clock - n.t0) / 820, [x, y] = S(n.x, n.y - easeOut(Math.min(1, t * 1.6)) * 12);
    ctx.globalAlpha = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
    drawDigits(n.text, Math.round(x), Math.round(y), n.color, true);
    ctx.globalAlpha = 1;
  }
  // 階の切り替えの暗転（ゆっくり）
  if (view.fade > 0) { ctx.fillStyle = `rgba(11,17,32,${view.fade})`; ctx.fillRect(0, 0, NW, NH); }
  if (view.banner) drawBanner();
}

function drawDigits(text, x, y, color, center = false) {
  const w = text.length * 4 + 1;
  let cx = center ? x - Math.floor(w / 2) : x;
  for (const ch of text) {
    const name = ch === '+' ? 'plus' : ch === '-' ? 'minus' : ch;
    if (!SPR.groups.digit.frames[name]) { cx += 4; continue; }
    ctx.drawImage(spr('digit', name, false, color === '#ffffff' ? null : { W: color }), cx, y);
    cx += 4;
  }
}
function drawBadge(x, y, n, hurt) {
  const s = String(n), w = s.length * 4 + 6;
  ctx.fillStyle = '#221b17'; ctx.fillRect(x, y, w, 9);
  ctx.fillStyle = hurt ? '#8f2f2b' : '#d24a3c'; ctx.fillRect(x, y, 2, 9);
  drawDigits(s, x + 2, y + 1, hurt ? '#e7a08a' : '#ffffff');
}
// 盤の上の印は、床にぴったり重ねた板に描く（カメラが傾いても床といっしょに傾く）
let floorOverKey = '';
function drawFloorOver() {
  const key = JSON.stringify([targeting, hoverTile && !busy ? [hoverTile.x, hoverTile.y] : null, st && st.player.x, st && st.player.y, busy,
    selected, st && st.hand.map(c => c.id), st && st.enemies.map(e => [e.x, e.y]), st && st.gameStatus, dialogOpen()]);
  if (key === floorOverKey) return;
  floorOverKey = key;
  const g = floorOverC.getContext('2d');
  g.clearRect(0, 0, 192, 192);
  if (targeting && !busy) drawTargeting(g);
  else if (!busy) drawMoveRange(g);
  if (hoverTile && !busy) g.drawImage(spr('cursor', '0'), (hoverTile.x - 1) * T - 1, (hoverTile.y - 1) * T - 1);
  floorOverTex.needsUpdate = true;
}
function drawTargeting(g) {
  const tg = targeting, p = st.player;
  const opts = targetOptions(tg), tx = x => (x - 1) * T, ty = y => (y - 1) * T;
  for (const d of Object.keys(opts)) {
    const o = opts[d];
    for (const c of o.tiles) {
      const chosen = tg.dir === d && (!tg.dist || c.n <= tg.dist);
      // 色は濃いめ（砂の明るい床でも見えるように。2026-10-09 テストプレイ）。外に濃い線を1本引いて床と分ける
      const col = tg.kind === 'move' ? '74,163,232' : '210,74,60';
      g.fillStyle = `rgba(${col},${chosen ? 0.62 : 0.42})`;
      g.fillRect(tx(c.x) + 1, ty(c.y) + 1, T - 3, T - 3);
      g.strokeStyle = 'rgba(34,27,23,0.75)'; g.lineWidth = 1;
      g.strokeRect(tx(c.x) + 0.5, ty(c.y) + 0.5, T - 2, T - 2);
      g.strokeStyle = `rgba(${col},1)`;
      g.strokeRect(tx(c.x) + 1.5, ty(c.y) + 1.5, T - 4, T - 4);
    }
    if (o.target) {
      g.lineWidth = 1; g.strokeStyle = 'rgba(34,27,23,0.75)'; g.strokeRect(tx(o.target.x) + 0.5, ty(o.target.y) + 0.5, T - 2, T - 2);
      g.strokeStyle = '#d24a3c'; g.strokeRect(tx(o.target.x) + 1.5, ty(o.target.y) + 1.5, T - 4, T - 4); g.strokeRect(tx(o.target.x) + 2.5, ty(o.target.y) + 2.5, T - 6, T - 6);
    }
    if (o.tiles.length || o.target) {
      const [dx, dy] = DIRV[d], img = sprDir('arrowhint', '0', d);
      g.drawImage(img, tx(p.x) + 12 + dx * 17 - 4, ty(p.y) + 12 + dy * 17 - 4);
    }
  }
}
// 歩ける範囲（2026-10-09 テストプレイ）：何も選んでいない手番のあいだ、手札の移動のカード（歩く・走る…）で行けるマスを薄い水色に。
// 押すとそのマスへ（2マス先から）。行けるカードのうち、移動の数がそのマスにいちばん近いカードを自動で使う（moveChoices・pickMove。カードを選ぶ窓は前の版の名残）。
// 1マス先は、いままでどおり十字キーと同じ自動移動（歩くがあれば歩く。なければ、いらないカードで強行移動の確認）
function moveRange() {
  const out = new Map();
  if (!st || st.gameStatus !== 'PLAYING' || busy || targeting || selected || dialogOpen()) return out;
  const p = st.player;
  for (const cobj of st.hand) {
    const md = HK.cardOf(cobj).moveDistance; if (!md) continue;
    for (const d of Object.keys(DIRV)) {
      const [dx, dy] = DIRV[d];
      for (let n = 1; n <= md; n++) {
        const x = p.x + dx * n, y = p.y + dy * n;
        if (!HK.isFloor(st, { x, y }) || HK.enemyAt(st, { x, y })) break;
        const k = `${x},${y}`; if (!out.has(k)) out.set(k, []);
        out.get(k).push({ cobj, d, n });
      }
    }
  }
  return out;
}
function drawMoveRange(g) {
  const tx = x => (x - 1) * T, ty = y => (y - 1) * T;
  for (const k of moveRange().keys()) {
    const [x, y] = k.split(',').map(Number);
    g.fillStyle = 'rgba(74,163,232,0.26)'; g.fillRect(tx(x) + 1, ty(y) + 1, T - 3, T - 3);
    g.lineWidth = 1; g.strokeStyle = 'rgba(34,27,23,0.45)'; g.strokeRect(tx(x) + 0.5, ty(y) + 0.5, T - 2, T - 2);
    g.strokeStyle = 'rgba(74,163,232,0.85)'; g.strokeRect(tx(x) + 1.5, ty(y) + 1.5, T - 4, T - 4);
  }
}
// そのマスへ行けるカード（同じ種類・同じ合成の段は1つにまとめる。まとめた中では手札の左のもの）
function moveChoices(x, y) {
  const seen = new Map();
  for (const o of moveRange().get(`${x},${y}`) || []) { const k = `${o.cobj.cardId}+${o.cobj.rank || 0}`; if (!seen.has(k)) seen.set(k, o); }
  return [...seen.values()];
}
function pickMove(list) {
  const go = o => perform('play', { cardId: o.cobj.id, mode: 'effect', direction: o.d, distance: o.n });
  if (list.length === 1) return go(list[0]);
  return go(list.reduce((a, b) => (HK.cardOf(b.cobj).moveDistance < HK.cardOf(a.cobj).moveDistance ? b : a)));   // 聞かずに、移動の数がそのマスにいちばん近いカード（2026-10-09 ユーザー指定。下の窓は使わないが残す）
  showDialog('どのカードを使いますか？', '<p class="hint">ほかの場所を押すとやめる</p>', list.map(o => [HK.cardOf(o.cobj).name, () => { closeDialog(); go(o); }, 'pickc']));
  $('#dialog').dataset.backdrop = 'cancel'; $('#dialog .paper').classList.add('pick');   // 窓の外（暗い幕）を押すとやめる
  [...$('#dlg-actions').children].forEach((b, i) => { const o = list[i], nm = document.createElement('small'); nm.className = 'mm s'; nm.textContent = cardEffect(o.cobj); b.prepend(iconCanvas(o.cobj.cardId)); b.append(nm); });
}
// 敵のいる階で「歩く」がないとき、となりのマスを押したら「どれで移動する？」：手札を絵・名前・効果で並べ、選んだカードで1マス（効果は出ない）。
// 窓の外を押すとやめる。十字キーはいままでどおりの自動移動（2026-10-10 テストプレイ）
function pickForced(d) {
  const [dx, dy] = DIRV[d], to = { x: st.player.x + dx, y: st.player.y + dy };
  if (!HK.isFloor(st, to) || HK.enemyAt(st, to)) { say('そっちには進めない'); bumpFace(d); return; }
  const list = st.hand.slice();
  showDialog('どれで移動する？', '<p class="hint">カードの効果は出ません（ほかの場所を押すとやめる）</p>',
    list.map(c => [HK.cardOf(c).name, () => { closeDialog(); perform('play', { cardId: c.id, mode: 'forced', direction: d, distance: 1 }); }, 'pickc']));
  $('#dialog').dataset.backdrop = 'cancel'; $('#dialog .paper').classList.add('pick');   // 5枚を横1列に並べる広い窓
  [...$('#dlg-actions').children].forEach((b, i) => {
    const c = list[i], nm = document.createElement('small'); nm.className = 'mm s'; nm.textContent = cardEffect(c);
    b.prepend(iconCanvas(c.cardId)); b.append(nm);
    if (lockedCards.has(c.id)) b.classList.add('lockd');
  });
}
function drawBanner() {
  const b = view.banner, t = (clock - b.t0) / b.ms, el = document.getElementById('banner');
  if (t >= 1) { view.banner = null; el.style.opacity = 0; return; }
  const a = t < 0.2 ? t / 0.2 : t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
  const [cx, cy] = S(OX + 96, OY + 95);
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(11,17,32,0.8)'; ctx.fillRect(Math.round(cx - 50), Math.round(cy - 15), 100, 30);
  ctx.fillStyle = '#f0b84a'; ctx.fillRect(Math.round(cx - 50), Math.round(cy - 15), 100, 1); ctx.fillRect(Math.round(cx - 50), Math.round(cy + 14), 100, 1);
  ctx.globalAlpha = 1;
  el.style.opacity = a; el.textContent = b.text;
  el.style.left = `calc(var(--u) * ${cx})`; el.style.top = `calc(var(--u) * ${cy})`;
}

// ---------------------------------------------------------------- 主人公の動き
const PWALK = [['walk_0', 45], ['walk_1', 45], ['walk_2', 45], ['walk_3', 45]];
async function playerWalk(path, dir) {
  const p = view.player; p.dir = dir;
  const per = path.length > 1 ? 140 : 180;
  for (const c of path) {
    p.anim = newEntityAnim(PWALK.map(([f, d]) => [f, d * per / 180]), true);
    dust(p.px - 3 * DIRV[dir][0], p.py);
    sfx('step');
    await tween(p, footX(c.x), footY(c.y), per);
    p.x = c.x; p.y = c.y;
    lookAtPlayer();
  }
  playerIdle(p);
}
// 武器ごとの振る音：槍は突き、盾押しは盾の音、弓と毒針は飛ぶ音（shoot）だけ、ほかは斬撃
const weaponSwing = c => /槍/.test(c.name) ? 'thrust_spear' : /盾/.test(c.name) ? 'shield_clang' : c.range > 1 && (c.immobilize || c.poison) ? null : 'swing_sword';
const BIG_HOLD = 240;     // 大アップの余韻（2026-10-09 テストプレイで 350 → 240）（相手の動きが終わってからカメラを引くまで、ミリ秒）
// 攻撃：相手へ飛びかかる（絵ごと弧を描く）。カメラはふだん控えめに寄り、撃破・大ダメージだけ強く寄って傾ける
async function playerAttack(dir, impact, focus = null, swing = 'swing') {   // swing：振る音（武器ごと。null なら鳴らさない）
  const p = view.player; p.dir = dir;
  if (focus) camFocus(p, focus.v, focus.strong);
  p.anim = newEntityAnim([['atk_0', 50], ['atk_1', 50], ['atk_2', 80], ['atk_3', 80]]);
  await wait(45); if (swing) sfx(swing);
  if (focus) {
    const [dx, dy] = DIRV[dir], reach = focus.melee ? 10 : 4;
    twk(p, 'ox', dx * reach, 45, easeOut); twk(p, 'oy', dy * reach, 45, easeOut);
    twk(p, 'lift', 5, 22, easeOut).then(() => twk(p, 'lift', 0, 22));
    await wait(35);
  } else await wait(10);
  // 飛びかかりから戻り、カメラを引く（敵を倒したときは、倒れる動きを待たずに当たった直後から）
  let backed = false;
  if (focus) focus.back = () => { if (backed) return; backed = true; twk(p, 'ox', 0, 130, easeOut); twk(p, 'oy', 0, 130, easeOut); camHome(focus.strong ? 300 : 170); };
  await impact();
  // 大アップのときは、相手ののけぞり・倒れる動きが終わるまで待ち、さらに少し余韻を見せてから引く
  if (focus && focus.strong) await wait((focus.waited ? 0 : 160) + BIG_HOLD);
  if (focus) focus.back();
  await wait(focus && focus.strong ? 70 : 20);
  playerIdle(p);
}
// 確認用（U キー）：いちばん近い敵へ、大アップの攻撃をその場で再生する。見せるだけで、ルールの状態（体力・ターン）は変えない
async function previewBigCloseup() {
  if (busy || !st || st.gameStatus !== 'PLAYING') return;
  const p = view.player, list = [...view.enemies.values()].filter(v => !v.gone && !v.dying);
  if (!list.length) { say('近くに敵がいない'); return; }
  const v = list.sort((a, b) => (Math.abs(a.x - p.x) + Math.abs(a.y - p.y)) - (Math.abs(b.x - p.x) + Math.abs(b.y - p.y)))[0];
  // 実際の攻撃と同じ見え方になるよう、敵の絵だけを一時的に主人公の隣（空いている床）へ寄せる。終わったら元に戻す
  const home = { px: v.px, py: v.py, x: v.x, y: v.y };
  const free = (x, y) => st.map[y]?.[x] === '.' && !st.enemies.some(e => e.x === x && e.y === y);
  const side = [['d', 1, 0], ['a', -1, 0], ['s', 0, 1], ['w', 0, -1]].find(([, sx, sy]) => (v.x === p.x + sx && v.y === p.y + sy) || free(p.x + sx, p.y + sy));
  if (!side) { say('まわりに空きがない'); return; }
  const d = side[0];
  v.x = p.x + side[1]; v.y = p.y + side[2]; v.px = footX(v.x); v.py = footY(v.y); faceEnemy(v);
  busy = true; cancelAll();
  await playerAttack(d, async () => {
    const img = sprDir('slash', '0', d);
    addFx('slash', [['0', 40], ['1', 60], ['2', 80]], v.px - img.width / 2, v.py - 12 - img.height / 2, { dir: d });
    hitstop(80); shake(3, 200);
    v.anim = newEntityAnim([['hurt_0', 260], ['idle_0', 10]]);
    addFx('spark', [['0', 40], ['1', 60], ['2', 70]], v.px - 5, v.py - 14); sfx('hit');
    await wait(260);
    v.anim = EIDLE();
  }, { v, strong: true, melee: true, waited: true });
  await wait(380);
  Object.assign(v, home); faceEnemy(v);
  busy = false;
}
async function playerHurt(dmg, blocked) {
  const p = view.player;
  p.anim = newEntityAnim([['hurt_0', 120], ['hurt_1', 110]]);
  if (dmg > 0) { shake(2, 150); sfx('hurt'); hitstop(30); }
  if (dmg > 0) globalThis.FaceAnim?.hurt(FaceAnim.isStrong(dmg, st.player.maxHp));   // 左下の顔（js/face_anim.js）
  if (blocked > 0) { addMark('shield', '0', p.px, p.py - 20, 700, 6); sfx('block'); }
  addNum(dmg, p.px, p.py - 34, dmg > 0 ? '#ff9a8a' : '#c8d0d8');
  const hp0 = dispHp;
  dispHp = Math.max(0, dispHp - dmg); dispBlock = 0; renderStatus(); if (dmg > 0) { renderDying(true); hpHitFx(hp0, dispHp, st.player.maxHp, dmg); }
  await wait(180);
  if (dispHp > 0) playerIdle(p);
}

// ---------------------------------------------------------------- 敵の動き
async function enemyHurt(v, amount, opts = {}) {
  v.anim = newEntityAnim([['hurt_0', 120], ['idle_0', 10]]);
  if (opts.fromDir) { const [dx, dy] = DIRV[opts.fromDir]; v.tw = { fx: v.px + dx * 3, fy: v.py + dy * 2, tx: v.px, ty: v.py, t0: clock, ms: 160, ease: easeOut }; }
  addFx('spark', [['0', 40], ['1', 60], ['2', 70]], v.px - 5, v.py - 14);
  addNum(amount, v.px, v.py - headH(v) - 8, opts.color || '#ffffff');
  sfx('hit');
  v.hp = Math.max(0, v.hp - amount);
  await wait(95);
  if (v.hp > 0) v.anim = EIDLE();
}
async function enemyDie(v) {
  v.dying = true;
  v.anim = newEntityAnim([['hurt_0', 80], ['die_0', 120], ['die_1', 220]]);
  await wait(240);
  sfx('die');
  addFx('poof', [['0', 60], ['1', 80], ['2', 90], ['3', 100]], v.px - 10, v.py - 12);
  await wait(90);
  const t0 = clock;
  while (clock - t0 < 130) { v.alpha = 1 - (clock - t0) / 130; await wait(16); }
  v.gone = true;
}
async function enemyMove(v, to, d) {
  const k = KIND[v.kind];
  if (d === 'a') v.facing = -1; else if (d === 'd') v.facing = 1; else v.back = d === 'w';
  if (SPR.groups[egroup(v.kind)].k) {
    // 大きな絵：1マスに1歩。片足をはっきり上げて下ろし（左右は1歩ごとに交互）、体も少し弾む
    v.stepN = (v.stepN || 0) + 1;
    v.anim = newEntityAnim([['move_' + (v.stepN % 2), k.moveMs * 0.7], ['idle_0', k.moveMs * 0.3]]);
    v.hop = { t0: clock, ms: k.moveMs };
  } else v.anim = newEntityAnim(k.move.map(([f, ms]) => [f, ms * k.moveMs / k.move.reduce((s, [, m]) => s + m, 0)]));
  sfx('estep');
  const done = tween(v, footX(to.x), footY(to.y), k.moveMs, t => t);
  v.x = to.x; v.y = to.y;
  done.then(() => { v.anim = EIDLE(); faceEnemy(v); });
  return done;
}
// 隣の敵がいっせいに飛びかかる。当たりは1回にまとめ、ダメージと防いだ分は合算。ダメージを受けるときは控えめに寄る
async function enemiesAttack(list) {
  const p = view.player, dmg = list.reduce((t, a) => t + a.ev.dmg, 0), blocked = list.reduce((t, a) => t + a.ev.blocked, 0);
  if (dmg > 0) camFocus([p], [], false);
  for (const { v } of list) { faceEnemy(v); v.anim = newEntityAnim([['atk_0', 100], ['atk_1', 90], ['atk_2', 130], ['idle_0', 10]]); }
  await wait(100);
  for (const { v } of list) {
    const [dx, dy] = [Math.sign(p.x - v.x), Math.sign(p.y - v.y)];
    v.tw = { fx: v.px, fy: v.py, tx: v.px + dx * 7, ty: v.py + dy * 7, t0: clock, ms: 60, ease: easeOut };
    twk(v, 'lift', 4, 30, easeOut).then(() => twk(v, 'lift', 0, 30));
  }
  await wait(60);
  addFx('spark', [['0', 40], ['1', 60], ['2', 70]], p.px - 5, p.py - 16);
  if (list.length > 1 && dmg > 0) shake(3, 200);
  await playerHurt(dmg, blocked);
  for (const { v } of list) v.tw = { fx: v.px, fy: v.py, tx: footX(v.x), ty: footY(v.y), t0: clock, ms: 110, ease: easeOut };
  await wait(40);
  if (dmg > 0) camHome(170);
}
async function enemyAttack(v, ev) {
  const p = view.player;
  faceEnemy(v);
  v.anim = newEntityAnim([['atk_0', 150], ['atk_1', 110], ['atk_2', 160], ['idle_0', 10]]);
  await wait(150);
  // 相手へ飛びかかる（絵ごと小さく弧を描く。上下の相手には縦に）
  const [dx, dy] = [Math.sign(p.x - v.x), Math.sign(p.y - v.y)];
  v.tw = { fx: v.px, fy: v.py, tx: v.px + dx * 7, ty: v.py + dy * 7, t0: clock, ms: 60, ease: easeOut };
  twk(v, 'lift', 4, 30, easeOut).then(() => twk(v, 'lift', 0, 30));
  await wait(60);
  addFx('spark', [['0', 40], ['1', 60], ['2', 70]], p.px - 5, p.py - 16);
  await playerHurt(ev.dmg, ev.blocked);
  v.tw = { fx: v.px, fy: v.py, tx: footX(v.x), ty: footY(v.y), t0: clock, ms: 120, ease: easeOut };
  await wait(60);
}

// ---------------------------------------------------------------- 1手の再生
const findView = id => view.enemies.get(id);
// release(holdOf)：敵の移動をいっせいに始める。holdOf(ev) で、その敵だけ少し待たせる（ミリ秒）
async function animatePlayerPhase(s0, mid, action, card, pred, release) {
  const c = card ? HK.cardOf(card) : null;
  const p = view.player;
  const moved = s0.player.x !== mid.player.x || s0.player.y !== mid.player.y;
  if (moved) {
    const [dx, dy] = DIRV[action.direction], path = [];
    let x = s0.player.x, y = s0.player.y;
    while (x !== mid.player.x || y !== mid.player.y) { x += dx; y += dy; path.push({ x, y }); if (path.length > 8) break; }
    // 主人公が歩き出すのと同時に敵も動く。主人公がいま抜けようとしているマスに入る敵だけ、抜けるまで待つ
    const per = path.length > 1 ? 140 : 180, passed = [{ x: s0.player.x, y: s0.player.y }, ...path.slice(0, -1)];
    release(ev => { const i = passed.findIndex(t => t.x === ev.to.x && t.y === ev.to.y); return i < 0 ? 0 : i * per + per * 0.6; });
    await playerWalk(path, action.direction);
    const got = s0.items.find(i => i.x === mid.player.x && i.y === mid.player.y && !mid.items.some(j => j.x === i.x && j.y === i.y));
    if (got) await pickup(got);
    return;
  }
  if (!c || action.mode === 'forced') return;
  // 攻撃
  if (c.damage) {
    const hitE = s0.enemies.find(e => { const m = mid.enemies.find(n => n.id === e.id); return !m || m.hp !== e.hp || m.x !== e.x || m.y !== e.y; });
    const d = action.direction;
    // カメラの寄り方：強く寄るのは「与えたダメージが武器の攻撃力の2倍以上、かつ4以上」か「難易度の帯でいちばん強い敵を倒した」ときだけ
    // （4以上は 2026-10-09 テストプレイ：攻撃力1の毒針などが、残火・連撃の＋1だけで2倍になって寄っていた）
    const mE = hitE && mid.enemies.find(n => n.id === hitE.id), vF = hitE && findView(hitE.id);
    const dealt = hitE ? hitE.hp - (mE ? mE.hp : 0) : 0;
    const strong = !!hitE && ((c.damage > 0 && dealt >= c.damage * 2 && dealt >= 4) || (!mE && hitE.attack >= tierMaxAtk(s0.floor)));
    const focus = vF ? { v: vF, strong, melee: !(c.range > 1) } : null;
    await playerAttack(d, async () => {
      if (!hitE) { release(); return; }
      const v = findView(hitE.id); if (!v) { release(); return; }
      const dist = Math.abs(hitE.x - s0.player.x) + Math.abs(hitE.y - s0.player.y);
      if (c.range > 1 && (c.immobilize || c.poison)) {          // 弓・毒針：飛んでいく
        const sx0 = p.px, sy0 = p.py - 12, ex = v.px, ey = v.py - 10, ms = 60 + dist * 45;
        sfx('shoot');
        const grp = c.poison ? 'needle' : 'arrow', img = sprDir(grp, '0', d);
        const f = addFx(grp, [['0', ms]], () => { const t = Math.min(1, (clock - f.t0) / ms); return [sx0 + (ex - sx0) * t - img.width / 2, sy0 + (ey - sy0) * t - img.height / 2]; }, 0, { dir: d });
        await wait(ms);
      } else if (c.range > 1) {                                    // 槍：突き
        const tx = tileX(s0.player.x) + DIRV[d][0] * 20, ty = tileY(s0.player.y) + DIRV[d][1] * 20;
        const img = sprDir('thrust', '0', d);
        addFx('thrust', [['0', 50], ['1', 70], ['2', 70]], tx + (24 - img.width) / 2, ty + (24 - img.height) / 2 - 4, { dir: d });
        await wait(60);
      } else {                                                      // 剣・斧など：斬る
        const img = sprDir('slash', '0', d);
        addFx('slash', [['0', 40], ['1', 60], ['2', 80]], v.px - img.width / 2, v.py - 12 - img.height / 2, { dir: d });
      }
      hitstop(focus && focus.strong ? 80 : 25);
      const m = mid.enemies.find(n => n.id === hitE.id);
      const lost = hitE.hp - (m ? m.hp : 0);
      const first = Math.min(lost, pred);
      const pushed = m && (m.x !== hitE.x || m.y !== hitE.y);
      // 当たった瞬間にほかの敵が動き出す。当たった敵はのけぞり終わってから
      const hold = 150 + (pushed ? 110 : 0) + (lost > first ? 160 : 0);
      release(ev => ev.id === hitE.id ? hold : 0);
      await enemyHurt(v, first, { fromDir: d });
      if (pushed) { await tween(v, footX(m.x), footY(m.y), 110, easeOut); v.x = m.x; v.y = m.y; }
      if (lost > first) { shake(2, 140); sfx('bump'); await enemyHurt(v, lost - first, { color: '#ffd27a' }); }
      if (m) { v.poison = m.poison ?? 0; v.stuck = !!m.immobilized; if (c.poison) addMark('poison', '1', v.px, v.py - 18, 700); }
      else if (focus && focus.strong) { await enemyDie(v); focus.waited = true; }    // 大アップのときは、倒れる動きが終わるまで待ってから引く
      else {                       // ふだんは倒れる動きを待たない：カメラはすぐ引き、倒れるのは裏で続ける
        if (focus) focus.back();
        enemyDie(v); await wait(40);
      }
    }, focus, weaponSwing(c));
    return;
  }
  // 攻撃以外の効果（敵は同時に動く）
  release();
  if (c.block) { addMark('shield', '0', p.px, p.py - 22, 800, 8); if (!globalThis.Music) sfx('block');   // 防具の音はカードの行き先の演出（盾＝ガキン、鎧＝着る音）で鳴らす
    dispBlock = mid.player.temporaryBlock; renderStatus(); await wait(260); return; }
  if (c.heal) {
    const gain = mid.player.hp - s0.player.hp;
    addMark('heal', '1', p.px, p.py - 22, 800, 10); addNum('+' + gain, p.px, p.py - 34, '#a8f08f'); sfx('heal');
    dispHp = mid.player.hp; renderStatus(); await wait(320); return;
  }
  if (c.attackBoost || c.ember) { addMark('ember', '0', p.px, p.py - 22, 800, 8); if (!globalThis.Music?.se('ember')) sfx('heal');   // 残火の音（ファイルが届くまでは回復の音）
    await wait(260); return; }
  if (c.returnToSurface) { if (!globalThis.Music?.se('stairs')) sfx('stairs'); const t0 = clock; while (clock - t0 < 500) { p.alpha = 1 - (clock - t0) / 500; await wait(16); } return; }
  sfx('card'); await wait(160);
}
async function pickup(it) {
  const vi = view.items.find(i => i.x === it.x && i.y === it.y);
  sfx('pickup');
  view.items = view.items.filter(i => i !== vi);
  // 拾った道具の絵を、主人公の頭の上に出す
  const p = view.player;
  addMark('icon', SPR.cardIcon[it.cardId] || 'scroll', p.px, p.py - 27, 1000, 6);
  await wait(120);
  say(`${HK.cards[it.cardId].name}を拾った`);
}
async function animateEnemyPhase(trace, mid) {
  if (!trace || trace.bad) {           // 台本がずれたときは位置だけ合わせる
    for (const e of st.enemies) { const v = findView(e.id); if (v && (v.x !== e.x || v.y !== e.y)) { tween(v, footX(e.x), footY(e.y), 160); v.x = e.x; v.y = e.y; } }
    await wait(170); return;
  }
  let attacked = false;
  for (const ev of trace.events) {
    const v = findView(ev.id);
    if (!v || ev.t === 'move') continue;      // 移動は主人公と同時に再生済み
    if (ev.t === 'hit') { await enemyHurt(v, ev.amount, { color: ev.kind === 'poison' ? '#d5a8ff' : '#9cc7ef' }); if (ev.kind === 'poison') v.poison = Math.max(0, v.poison - 1); }
    else if (ev.t === 'die') await enemyDie(v);
    else if (ev.t === 'attack') {             // 隣の敵はいっせいに攻撃する（ダメージは合算して1つの数字）
      if (attacked) continue;
      attacked = true;
      await enemiesAttack(trace.events.filter(e => e.t === 'attack').map(e => ({ v: findView(e.id), ev: e })).filter(a => a.v));
    }
    else if (ev.t === 'stuck') { addMark('stuck', '0', v.px, v.py - 6, 500, 3); v.stuck = false; await wait(120); }
  }
  void mid;
}
async function animateDescend() {
  const p = view.player;
  if (!globalThis.Music?.se('stairs')) sfx('stairs');   // 石段を降りる足音（採用の効果音。読み込み前は仮の合成音）
  const t0 = clock;
  while (clock - t0 < 380) { const t = (clock - t0) / 380; p.sink = Math.round(t * 10); p.alpha = 1 - t; view.fade = t * 0.95; await wait(16); }
  p.sink = 0;
  buildBackground(); syncView(true); renderUI();
  globalThis.Music?.floor(st.floor);   // 帯が変わったら曲も替える
  view.banner = { text: globalThis.Tutorial?.active ? Tutorial.banner() : `B${st.floor}F`, t0: clock, ms: 1500 };
  const t1 = clock;
  while (clock - t1 < 420) { view.fade = 0.95 * (1 - (clock - t1) / 420); await wait(16); }
  view.fade = 0;
  dust(view.player.px, view.player.py);
}

// ---------------------------------------------------------------- できごとの文字（盤の左の余白に、枠なしで流れて消える）
function logDiff(a, b) {
  for (let n = 0; n <= b.length; n++) {
    const keep = b.length - n;
    if (keep <= a.length && b.slice(0, keep).every((l, i) => l === a[a.length - keep + i])) return b.slice(keep);
  }
  return b.slice();
}
const logHistory = [];          // これまでのできごと（左のタブで読む）
function flowLog(lines) {
  for (const t of lines) logHistory.push({ floor: st.floor, turn: st.turn, text: t });
  if (logOpen()) renderLogPanel();
  const box = $('#log');
  lines.forEach((t, i) => setTimeout(() => {
    const el = document.createElement('div'); el.textContent = t; el.className = 'mm s new'; box.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('new')));
    while (box.children.length > 6) box.firstChild.remove();
    setTimeout(() => el.classList.add('old'), 4200);
    setTimeout(() => el.remove(), 4900);
  }, i * 140));
}

const logOpen = () => $('#log-panel').classList.contains('open');
function renderLogPanel() {
  const el = $('#log-panel');
  if (!logHistory.length) { el.innerHTML = '<div class="empty">まだ何も起きていない</div>'; return; }
  let html = '', fl = null;
  for (const l of logHistory) {
    if (l.floor !== fl) { fl = l.floor; html += `<div class="fl">B${fl}F</div>`; }
    html += `<div class="ln"><span>${l.turn}</span>${esc(l.text)}</div>`;
  }
  el.innerHTML = html; el.scrollTop = el.scrollHeight;
}
function toggleLog(on = !logOpen()) {
  $('#log-panel').classList.toggle('open', on); $('#log-tab').classList.toggle('open', on); document.body.classList.toggle('log-open', on);
  if (on) renderLogPanel();
}

async function perform(kind, payload) {
  if (st.gameStatus !== 'PLAYING') return;
  if (busy) { queued = () => perform(kind, payload); speed = Math.max(baseSpeed, 2.4); return; }
  if (globalThis.Tutorial?.active && !Tutorial.allow(kind, payload)) { cancelAll(); return; }   // チュートリアル：いまの段で使わない行動は止める
  busy = true; closeDialog(); hideCardTip(); targeting = null; selected = null;
  const s0 = snap(st);
  const card = kind === 'play' ? st.hand.find(c => c.id === payload.cardId) : st.hand.find(c => c.id === payload);
  const pred = kind === 'play' && card && HK.cardOf(card).damage ? HK.damageOf(st, card).total : 0;
  const log0 = st.log.slice();
  let mid = null, trace = null, descended = false, res;
  if (kind === 'play') {
    res = HK.play(st, payload,
      e => { mid = snap(e); trace = HKTrace.traceEnemyTurn(e); HK.enemyTurn(e); if (!HKTrace.matches(trace, e)) { trace.bad = true; console.warn('台本と元ロジックの結果がずれました'); } },
      e => { mid = snap(e); descended = true; if (globalThis.Tutorial?.active) Tutorial.descend(e); else HK.nextFloor(e); });
  } else {
    trace = HKTrace.traceEnemyTurn(st);
    res = HK.discard(st, payload);
    if (res.ok && !HKTrace.matches(trace, st)) trace.bad = true;
    mid = { ...s0, hand: st.hand.map(c => ({ ...c })) };
  }
  if (!res.ok) { busy = false; speed = baseSpeed; say(res.message); renderUI(); return; }
  if (!mid) mid = snap(st);
  // できごとの文字：主人公の分は動き出しと同時、敵の分は敵の手番の再生と同時に流す
  const logMid = kind === 'play' ? mid.log : log0;
  flowLog(logDiff(log0, logMid));
  const enemyLog = logDiff(logMid, st.log);
  animateHand(s0, card ? card.id : null, kind === 'play' ? payload.mode : 'discard', kind === 'play' && payload.mode === 'effect' ? effectGains(s0, mid, card) : []);
  // 敵の移動は主人公の動きと同時に始める（台本がずれたときは後でまとめて合わせる）
  const moveEvents = trace && !trace.bad && !descended ? trace.events.filter(e => e.t === 'move') : [];
  let movesDone = null;
  const release = (holdOf = () => 0) => movesDone || (movesDone = Promise.all(moveEvents.map(async ev => {
    const v = findView(ev.id); if (!v) return;
    const h = holdOf(ev); if (h > 0) await wait(h);
    await enemyMove(v, ev.to, ev.d);
  })));
  if (kind === 'play') await animatePlayerPhase(s0, mid, payload, card, pred, release);
  else { release(); sfx('card_discard'); await wait(140); }
  await release();
  flowLog(enemyLog);
  if (descended) await animateDescend();
  else if (st.gameStatus !== 'RETURNED' && trace) await animateEnemyPhase(trace, mid);
  if (st.gameStatus === 'GAME_OVER') await playerDown();
  syncView(); renderStatus();
  if (!handMatches()) renderHand();                // 手札の動きは animateHand が済ませている。ずれたときだけ描き直す
  busy = false; speed = baseSpeed;
  globalThis.Tutorial?.after();
  saveRun();                                       // 中断・つづきから：1手ごと（階を降りた手も）に保存
  if (st.gameStatus !== 'PLAYING') { queued = null; showResult(); return; }
  if (queued) { const q = queued; queued = null; q(); }
}
async function playerDown() {
  const p = view.player;
  p.anim = newEntityAnim([['hurt_0', 160], ['hurt_1', 2000]]);
  await wait(260);
  const t0 = clock;
  while (clock - t0 < 600) { p.alpha = 1 - (clock - t0) / 600; await wait(16); }
}

// ---------------------------------------------------------------- 向き選び
function targetOptions(tg) {
  const p = st.player, out = {};
  for (const d of Object.keys(DIRV)) {
    const [dx, dy] = DIRV[d], tiles = [];
    let target = null;
    const lim = tg.kind === 'move' ? tg.max : tg.range;
    for (let n = 1; n <= lim; n++) {
      const x = p.x + dx * n, y = p.y + dy * n;
      if (!HK.isFloor(st, { x, y })) break;
      const en = HK.enemyAt(st, { x, y });
      if (tg.kind === 'move') { if (en) break; tiles.push({ x, y, n }); }
      else { if (en) { target = { x, y }; break; } tiles.push({ x, y, n }); }
    }
    out[d] = { tiles, target };
  }
  return out;
}
function startTargeting(cardObj, mode) {
  const c = HK.cardOf(cardObj);
  const kind = mode === 'forced' || c.moveDistance ? 'move' : 'attack';
  targeting = { cardId: cardObj.id, mode, kind, max: mode === 'forced' ? 1 : (c.moveDistance ?? 1), range: c.range ?? 1, dir: null, dist: 0 };
}
function targetKey(d) {
  const tg = targeting, o = targetOptions(tg)[d];
  if (tg.kind === 'attack') {
    if (!o.target) { say('そっちには届く敵がいない'); bumpFace(d); return; }
    perform('play', { cardId: tg.cardId, mode: tg.mode, direction: d, distance: 1 });
    return;
  }
  if (!o.tiles.length) { say('そっちには進めない'); bumpFace(d); return; }
  if (tg.max === 1) { perform('play', { cardId: tg.cardId, mode: tg.mode, direction: d, distance: 1 }); return; }
  if (tg.dir === d) tg.dist = tg.dist > 1 ? tg.dist - 1 : o.tiles.length;
  else { tg.dir = d; tg.dist = o.tiles.length; }
}
function targetConfirm() {
  const tg = targeting; if (!tg || !tg.dir) return;
  perform('play', { cardId: tg.cardId, mode: tg.mode, direction: tg.dir, distance: tg.dist });
}
function targetClick(x, y) {
  const tg = targeting, opts = targetOptions(tg);
  for (const d of Object.keys(opts)) {
    const o = opts[d];
    if (tg.kind === 'attack' && o.target && o.target.x === x && o.target.y === y) { perform('play', { cardId: tg.cardId, mode: tg.mode, direction: d, distance: 1 }); return true; }
    const hit = o.tiles.find(c => c.x === x && c.y === y);
    if (hit) {
      if (tg.kind === 'move') perform('play', { cardId: tg.cardId, mode: tg.mode, direction: d, distance: hit.n });
      else targetKey(d);
      return true;
    }
  }
  return false;        // 選べるマスではなかった
}
function bumpFace(d) {
  const p = view.player; if (!p || busy) return;
  p.dir = d; sfx('bump');
  const [dx, dy] = DIRV[d];
  p.tw = { fx: p.px + dx * 2, fy: p.py + dy * 2, tx: footX(p.x), ty: footY(p.y), t0: clock, ms: 110, ease: easeOut };
}

// ---------------------------------------------------------------- 十字キーの自動移動（元UIと同じ判断）
function autoMove(d) {
  const r = HK.autoMove(lockedCards.size ? { ...st, hand: st.hand.filter(c => !lockedCards.has(c.id)) } : st, d);   // ロックしたカードは使わない
  if (!r.ok) { say(r.message.includes('カード') ? (lockedCards.size ? 'ロックしていない移動のカードがない' : '移動に使えるカードがない') : 'そっちには進めない'); bumpFace(d); return; }
  const action = { cardId: r.card.id, mode: r.mode, direction: d, distance: 1 };
  if (!r.needsConfirmation) return perform('play', action);
  const name = HK.cardOf(r.card).name;
  showDialog('このカードで歩く？', `<div class="dlg-card"></div><p>「歩く」がないので「${esc(name)}」で1マス進みます。カードの効果は出ません。</p>`, [
    ['このカードで進む', () => perform('play', action), 'primary'],
    ['ほかのカードにする', () => showDialog('どのカードで進む？', '', st.hand.map(c => [HK.cardOf(c).name, () => perform('play', { ...action, mode: 'forced', cardId: c.id })]).concat([['やめる', cancelAll]]))],
    ['やめる', cancelAll],
  ]);
  const box = $('#dlg-body .dlg-card'), nm = document.createElement('b');   // 使うカード：絵と名前
  nm.className = 'mm l'; nm.textContent = name; box.append(iconCanvas(r.card.cardId), nm);
}

// ---------------------------------------------------------------- 手札・HUD
const $ = s => document.querySelector(s);

// ---------------------------------------------------------------- 窓とボタンの縁（角の丸いドット絵）
// 小さな絵を1枚描いて、CSS の border-image で9分割して伸ばす（1ドット＝1u。四隅はそのまま、辺と中は伸ばす）。
// 外：濃い線／内側の上と左：明るい線／内側の下と右：影の線／中：地の色／下：落ち影（窓）または厚み（ボタン）
// 窓の色の候補（切り替えのキーはなし。W は北への移動）。中の色・縁の色・中の文字（dark＝白文字に黒縁、light＝紙に濃い字）
const CREAM = [['#fbf3e2', '#cca673'], ['#e1bc88', '#cca673']], SLATE = [['#b8c4cc', '#506573'], ['#7a8e9c', '#506573']];
const WIN_THEMES = [      // 先頭がふだんの色（ユーザーが半透明の夜色に決定）
  { name: '半透明の夜色', bg: '#0b1120cc', rim: SLATE, shade: ['#0b1120cc', '#0b1120cc'] },
  { name: '紺（盤の石）', bg: '#2c3a48', rim: SLATE, shade: ['#0b1120', '#2c3a48'] },
  { name: '焦げ茶（木）', bg: '#3f2d21', rim: CREAM, shade: ['#221b17', '#3f2d21'] },
  { name: '灰茶', bg: '#4a4640', rim: [['#e1bc88', '#8a5a38'], ['#cca673', '#8a5a38']], shade: ['#221b17', '#4a4640'] },
  { name: '明るい紙（前の）', bg: '#f2dcb4', rim: CREAM, shade: ['#cca673', '#f2dcb4'], light: true },
];
let winTheme = 0;
function applyWinTheme(i) {
  const t = WIN_THEMES[winTheme = (i + WIN_THEMES.length) % WIN_THEMES.length], d = document.documentElement;
  const f = pixFrame({ r: 6, s: 7, fill: t.bg, hole: true, drop: 2, rings: ['#221b17', ...t.rim, '#221b17', t.shade] });
  d.style.setProperty('--fr-paper', f.url); d.style.setProperty('--fr-paper-s', f.s); d.style.setProperty('--fr-paper-b', f.s + f.drop);
  d.style.setProperty('--win-bg', t.bg);
  // マスの説明（小さな吹き出し）は同じ色で、縁を細く・角を小さく
  const ft = pixFrame({ r: 3, s: 4, fill: t.bg, hole: true, drop: 1, rings: ['#221b17', t.rim[0], '#221b17'] });
  d.style.setProperty('--fr-tip', ft.url); d.style.setProperty('--fr-tip-s', ft.s); d.style.setProperty('--fr-tip-b', ft.s + ft.drop);
  d.classList.toggle('win-light', !!t.light);
  return t;
}
function pixFrame({ r, s, fill, line, hi, lo, rings, hole = false, drop = 0, dropCol = '#00000080' }) {    // s：9分割の辺の太さ（真ん中の1ドットを伸ばす）
  const size = 2 * s + 1, W = size, H = size, c = canvas(W, H + drop), g = c.getContext('2d');
  rings = rings || [line, [hi, lo]];
  const inside = (x, y, inset = 0) => {
    const px = x + 0.5, py = y + 0.5, a = inset, b = W - inset, t = inset, d = H - inset, rr = r - inset;
    if (px < a || px > b || py < t || py > d) return false;
    const cx = Math.min(Math.max(px, a + rr), b - rr), cy = Math.min(Math.max(py, t + rr), d - rr);
    return (px - cx) ** 2 + (py - cy) ** 2 <= rr * rr + 0.3;
  };
  for (let y = 0; y < H + drop; y++) for (let x = 0; x < W; x++) {
    let col = null;
    if (inside(x, y)) {
      let k = 0; while (k < rings.length && inside(x, y, k + 1)) k++;
      const ring = rings[k];
      if (k === rings.length) col = hole && x === s && y === s ? null : fill;
      else col = Array.isArray(ring) ? ((x + y < W - 1) ? ring[0] : ring[1]) : ring;   // [明, 暗]：左上は明るく、右下は影
    } else if (drop && inside(x, y - drop)) col = dropCol;
    if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
  }
  return { url: `url(${c.toDataURL()})`, s, drop };
}
{
  const set = (k, f) => {
    const d = document.documentElement.style;
    d.setProperty(`--fr-${k}`, f.url); d.setProperty(`--fr-${k}-s`, f.s); d.setProperty(`--fr-${k}-b`, f.s + f.drop);
  };
  applyWinTheme(winTheme);
  set('plate', pixFrame({ r: 2, s: 3, fill: '#2c3a48', rings: ['#221b17', ['#506573', '#2c3a48']] }));
  set('btn', pixFrame({ r: 2, s: 3, fill: '#2c3a48', rings: ['#221b17', ['#506573', '#2c3a48']], drop: 1, dropCol: '#221b17' }));
  set('btn-h', pixFrame({ r: 2, s: 3, fill: '#506573', rings: ['#221b17', ['#7a8e9c', '#506573']], drop: 1, dropCol: '#221b17' }));
  set('pri', pixFrame({ r: 2, s: 3, fill: '#5c7236', rings: ['#221b17', ['#6d8541', '#34402a']], drop: 1, dropCol: '#221b17' }));
  set('pri-h', pixFrame({ r: 2, s: 3, fill: '#6d8541', rings: ['#221b17', ['#7f9a4c', '#5c7236']], drop: 1, dropCol: '#221b17' }));
  set('mv', pixFrame({ r: 2, s: 3, fill: '#4aa3e8cc', rings: ['#221b17', ['#b8c4cc', '#425c8d']], drop: 1, dropCol: '#221b17' }));     // 移動・捨てる（水色。中は不透明度80％）
  set('mv-h', pixFrame({ r: 2, s: 3, fill: '#4aa3e8cc', rings: ['#221b17', ['#fbf3e2', '#7582a9']], drop: 1, dropCol: '#221b17' }));
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const KIND_CLASS = { 移動: 'move', 攻撃: 'atk', 防御: 'def', 食料: 'food', ポーション: 'potion', 財宝: 'treasure', 消耗品: 'scroll', 護符: 'charm', 探索: 'misc' };
const CARD_W = 42, CARD_GAP = 4, CARD_REST = 224;   // 手札は盤の手前に半分しまって持つ（絵がまるごと見える高さ）
const directional = c => !!(c.damage || c.moveDistance);
function iconCanvas(cardId) {
  const s = spr('icon', SPR.cardIcon[cardId] || 'scroll'), c = canvas(s.width, s.height); c.getContext('2d').drawImage(s, 0, 0); c.className = 'icon'; return c;
}
// 値（攻撃・防御・移動・回復）はカードの下に点で並べる。7以上や得点は数字
function cardNumber(cobj) {
  const c = HK.cardOf(cobj);
  return c.damage ? HK.damageOf(st, cobj).total : c.block || c.moveDistance || c.heal || c.score || 0;
}
// 手札の上の色帯：効果と、いまの数値（強化・合成・強撃こみ）。数値のないカードは効果の名前（2026-10-09 テストプレイ）
const SCROLL_WORD = { preferWeapons: '武器選好', fuseWeapons: '武器合体', deleteCard: '削除', preferArmor: '防具選好', fuseArmor: '防具合体', preferScrolls: '巻物選好' };
function cardEffect(cobj) {
  const c = HK.cardOf(cobj);
  if (c.damage) return `攻撃${HK.damageOf(st, cobj).total}`;
  if (c.block) return `防御${c.block}`;
  if (c.moveDistance) return `移動${c.moveDistance}`;
  if (c.heal) return `回復${c.heal}`;
  if (c.attackBoost) return `強撃+${c.attackBoost}`;
  if (c.score) return `${c.score}点`;
  if (c.ember) return '残火';
  if (c.redraw) return '引き直し';
  if (c.returnToSurface) return '帰還';
  if (c.scrollEffect) return SCROLL_WORD[c.scrollEffect] || '巻物';
  return c.type;
}
// 合成の段（＋2 など）：クリア演出の数字（LoRes 9 Plus Wide Bold のドット、js/ending_assets.js）を、黒の字・白の縁に塗り替えて絵の右下に（大きさは PLUS_K）
const plusCache = new Map();
function plusImage(rank) {
  const A = globalThis.ENDING_ASSETS?.digits, txt = `+${rank}`;
  if (!A) { const b = document.createElement('b'); b.className = 'plus mm s'; b.textContent = txt; return b; }
  if (!plusCache.has(rank)) {
    const gl = [...txt].map(ch => A.glyphs[ch]).filter(Boolean), H = 8;
    const W = gl.reduce((w, g) => w + g[0].length - 1, 0) + 1, c = canvas(W, H), x = c.getContext('2d');
    let ox = 0;
    for (const g of gl) {                                   // 字の縁は1ドット重ねて詰める（クリア演出と同じ）
      g.forEach((row, y) => [...row].forEach((ch, i) => { if (ch === '.') return; if (ch === 'K' && x.getImageData(ox + i, y, 1, 1).data[3]) return; x.fillStyle = ch === 'K' ? '#fbf3e2' : '#221b17'; x.fillRect(ox + i, y, 1, 1); }));
      ox += g[0].length - 1;
    }
    plusCache.set(rank, c.toDataURL());
  }
  const im = new Image(); im.src = plusCache.get(rank); im.className = 'plus'; im.alt = txt;
  const PLUS_K = 1;   // 1ドット＝何u（2倍・1.5倍も試した。2026-10-09 いまは1倍・右下・不透明度80％を試し中）
  im.onload = () => { im.style.width = `calc(var(--u) * ${im.naturalWidth * PLUS_K})`; im.style.height = `calc(var(--u) * ${im.naturalHeight * PLUS_K})`; };
  return im;
}
// カードのロック：手札の id。ロックしたカードは十字キーの自動移動で使わない（説明の窓の鍵で切り替え。保存にも入れる）
const lockedCards = new Set();
queueMicrotask(() => { const r = document.documentElement.style; r.setProperty('--lock', `url(${lockImage(false)})`); r.setProperty('--lock-open', `url(${lockImage(true)})`); });
// 鍵の絵（7×8、1ドット＝1u）。open＝外したとき（つるの左が浮く）
function lockImage(open) {
  const rows = open ? ['.KKKKK.', '.K...K.', '.....K.', 'KKKKKKK', 'KYYYYYK', 'KYYKYYK', 'KyyKyyK', 'KKKKKKK']
                    : ['.KKKKK.', '.K...K.', '.K...K.', 'KKKKKKK', 'KYYYYYK', 'KYYKYYK', 'KyyKyyK', 'KKKKKKK'];
  const c = canvas(7, 8), g = c.getContext('2d'), P = { K: '#221b17', Y: '#f0b84a', y: '#ae6f47' };
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (P[ch]) { g.fillStyle = P[ch]; g.fillRect(x, y, 1, 1); } }));
  return c.toDataURL();
}
function toggleLock(id) {
  if (lockedCards.has(id)) lockedCards.delete(id); else lockedCards.add(id);
  globalThis.Music?.se('ui_cursor'); renderHand(); showCardTip(id); saveRun();
}
function pipsHtml(n) { return n <= 0 ? '' : n <= 6 ? '<i></i>'.repeat(n) : `<b>${n}</b>`; }
function cardValue(cobj) {
  const c = HK.cardOf(cobj);
  return c.damage ? `攻撃 ${HK.damageOf(st, cobj).total}` : c.block ? `防御 ${c.block}` : c.moveDistance ? `移動 ${c.moveDistance}` : c.heal ? `回復 ${c.heal}` : c.score ? `${c.score}点` : c.type;
}
// 手札はトランプを手で持つように扇形に広げる：手もとの下の1点（半径 FAN_R）を中心にした弧の上に、1枚 FAN_STEP 度ずつ傾けて並べる
// 端のカードが弧のぶん下がりすぎると絵が隠れるので、下がる量は FAN_DROP 倍に抑える（傾きはそのまま）
const FAN_R = 410, FAN_STEP = 5.5, FAN_DROP = 1, FAN_MAX = 30;    // 傾きをゆるめたぶん半径を大きくして、カードの間隔は前と同じに保つ
function cardPos(i, n) {
  const mid = (n - 1) / 2, rot = (i - mid) * Math.min(FAN_STEP, n > 1 ? FAN_MAX / (n - 1) : 0), a = rot * Math.PI / 180;
  return { x: Math.round(240 + FAN_R * Math.sin(a) - CARD_W / 2), y: Math.round(CARD_REST + FAN_R * (1 - Math.cos(a)) * FAN_DROP), rot };
}
function renderHand(hand = st.hand, leaving = null) {
  const el = $('#hand'); el.innerHTML = '';
  hand.forEach((cobj, i) => {
    const c = HK.cardOf(cobj), b = document.createElement('button'), pos = cardPos(i, hand.length);
    const rank = cobj.rank || 0, lk = lockedCards.has(cobj.id);
    b.className = `card k-${KIND_CLASS[c.type] || 'misc'}` + (selected === cobj.id ? ' sel' : '') + (leaving === cobj.id ? ' leaving' : '') + (lk ? ' locked' : '');
    b.dataset.id = cobj.id;
    b.style.left = `calc(var(--u) * ${pos.x})`; b.style.top = `calc(var(--u) * ${pos.y})`; b.style.setProperty('--rot', `${pos.rot}deg`);
    b.dataset.rot = pos.rot;
    b.title = `${c.name}（${cardValue(cobj)}）`;
    // 色帯＝効果といまの数値／絵＝合成の段（＋2 など）／絵の下＝カードの名前（＋は付けない）。ロックしたカードは色帯の右に鍵
    b.innerHTML = `<span class="band"><b class="eff mm s">${esc(cardEffect(cobj))}</b>${lk ? '<i class="lock"></i>' : ''}</span>`
      + `<span class="art"></span><span class="nm mm s">${esc(HK.cards[cobj.cardId].name)}</span><span class="key">${i + 1}</span>`;
    b.querySelector('.art').prepend(iconCanvas(cobj.cardId));
    if (rank) b.querySelector('.art').appendChild(plusImage(rank));
    b.onclick = () => { startAudio(); selectCard(cobj.id); };
    b.onmouseenter = () => hoverCard(cobj.id);
    b.onmouseleave = () => { clearTimeout(hoverTimer); hideCardTipSoon(); };
    el.appendChild(b);
    const nm = b.querySelector('.nm');                     // 長い名前（引き直しの護符など7字）は、字の間を1pxずつ詰めて収める（書体のドットは崩さない）
    for (let k = 1; k <= 3 && nm.scrollWidth > nm.clientWidth; k++) nm.style.letterSpacing = `-${k}px`;
  });
  renderPiles();
}
function renderPiles() {
  $('#deck-n').textContent = st.drawPile.length;
  $('#disc-n').textContent = st.discardPile.length;
  $('#deck').classList.toggle('empty', !st.drawPile.length);
  const top = st.discardPile[st.discardPile.length - 1], face = $('#disc-face');
  face.innerHTML = '';
  if (top) face.appendChild(iconCanvas(top.cardId));
  $('#disc').classList.toggle('empty', !top);
  $('#rem-n').textContent = st.removedCards.length;
  $('#rem').classList.toggle('empty', !st.removedCards.length);
}
function renderStatus() {
  const p = st.player, sc = HK.score(st).total;
  $('#floor').textContent = st.floor;
  $('#turn').textContent = st.turn;
  $('#score').textContent = sc;
  $('#hp-num').textContent = `${dispHp}/${p.maxHp}`;
  $('#hp-bar').style.width = `${Math.max(0, dispHp / p.maxHp * 100)}%`;
  $('#hp-bar').classList.toggle('low', dispHp <= Math.ceil(p.maxHp * 0.3));
  renderDying();
  $('#block').textContent = dispBlock;
  $('#block-row').classList.toggle('on', dispBlock > 0);
  const fx = [p.temporaryAttack && `強撃＋${p.temporaryAttack}`, p.ember && `残火 ${p.ember}/3`, p.reflect && '反射待機', p.combo && `連撃＋${p.combo}`,
    p.lastMoveDistance && `突撃＋${Math.min(3, p.lastMoveDistance)}`, p.lastBlocked && `返し刃＋${p.lastBlocked}`,
    st.preferWeaponsNextFloor && '次の階：武器', st.preferArmorNextFloor && '次の階：防具', st.preferScrollsNextFloor && '次の階：巻物'].filter(Boolean);
  $('#effects').innerHTML = fx.map(t => `<span>${esc(t)}</span>`).join('');
}
function renderUI() { renderStatus(); renderHand(); }

// ---------------------------------------------------------------- 使ったカードの行き先の演出
// 食べ物＝かじられて消える／薬＝飲み干されて消える／防具＝主人公に重なって着る（そのあと捨て札へ）／巻物＝広がって燃え尽きる／
// 削除で消したカード＝燃えて灰になる。カードはゲームの解像度（1ドット＝1u）の小さな絵として描き直し、そのドットを直接けずる・燃やす。
// どの演出も「経過時間 → 見た目」で決まる（render(t)）。速さを変えるときは各 dur を変える
const KIND_COLOR = { move: '#5c7236', atk: '#8f2f2b', def: '#425c8d', food: '#cca673', potion: '#d24a3c', treasure: '#f0b84a', scroll: '#6e655a', charm: '#ae6f47', misc: '#506573' };
function cardFate(cobj, mode, removedNow) {
  const t = HK.cardOf(cobj).type;
  if (mode === 'effect') {
    if (t === '食料') return 'eat';
    if (t === 'ポーション') return 'drink';
    if (t === '防御') return 'wear';
    if (t === '消耗品') return 'scroll';
  }
  return removedNow && mode !== 'effect' ? 'burn' : null;
}
function cardBitmap(cobj) {
  const W = CARD_W, H = 60, c = canvas(W, H), x = c.getContext('2d', { willReadFrequently: true }), f = (col, a, b, w, h) => { x.fillStyle = col; x.fillRect(a, b, w, h); };
  f('#221b17', 0, 0, W, H); f('#f2dcb4', 1, 1, W - 2, H - 2); f('#fbf3e2', 1, 1, W - 2, 1); f('#fbf3e2', 1, 1, 1, H - 2);
  f(KIND_COLOR[KIND_CLASS[HK.cardOf(cobj).type] || 'misc'], 1, 1, W - 2, 8); f('#221b17', 1, 9, W - 2, 1);
  x.imageSmoothingEnabled = false; x.drawImage(spr('icon', SPR.cardIcon[cobj.cardId] || 'scroll'), 3, 10, 36, 36);
  const n = Math.min(6, cardNumber(cobj)); for (let i = 0; i < n; i++) f('#3f2d21', 21 - n * 2 + i * 4, 48, 3, 3);
  return c;
}
const cardFxList = [], cardParts = [];
const uNow = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')) || 2;
const lerp = (a, b, q) => a + (b - a) * q, clamp01 = q => Math.max(0, Math.min(1, q)), ease = q => 1 - (1 - q) * (1 - q);
function seg(t, t0, t1) { return clamp01((t - t0) / Math.max(1, t1 - t0)); }
// 体力の棒のすぐ下（画面の u）。食べ物は体力にかかわるので、主人公ではなくここで食べて、目を棒へ向ける
function hpBelowU() {
  const u = uNow(), b = document.querySelector('#status .bar');
  if (!b) return [240, 46];
  const r = stageRect(b); return [(r.x + r.w / 2) / u, (r.y + r.h) / u + EAT_GAP];
}
const EAT_GAP = 26;     // 棒の下端からカードの中心まで（u）。食べ物・薬・防具・巻物はみなここで使う（目をあちこちへ動かさない）
function toStatus(sel, x, y, n, cols, spread = 0.5) {    // 使い終わりに、明るい粒をかかわる数値（体力の棒・防御）へ上げる
  const el = document.querySelector(sel), u = uNow(), r = el && stageRect(el);
  for (let k = 0; k < n; k++) {
    const tx = r ? (r.x + r.w * (0.5 + (Math.random() - 0.5) * spread)) / u : x, ty = r ? (r.y + r.h / 2) / u : y - 30;
    home(x + (Math.random() - 0.5) * 16, y + (Math.random() - 0.5) * 10, tx, ty, 260 + k * 22, cols[k % cols.length]);
  }
}
function spark(x, y, vx, vy, life, col, g = 0, size = 1) { cardParts.push({ x, y, vx, vy, life, t: 0, col, g, size }); }
function home(x, y, tx, ty, life, col, size = 1) { cardParts.push({ x, y, x0: x, y0: y, tx, ty, bow: (Math.random() - 0.5) * 30, life, t: 0, col, size, home: true }); }
// カードのドットを丸くけずる（かじる）
function biteAt(cx, x0, y0, r) {
  const g = cx.getContext('2d'); g.save(); g.globalCompositeOperation = 'destination-out';
  for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy <= r * r + 1) g.fillRect(x0 + xx, y0 + yy, 1, 1);
  g.restore();
}
// 下から燃える（ドットごとのゆらぎで、縁はオレンジと赤、燃えたところは消える）
function burnFrame(cx, src, noise, b) {
  const g = cx.getContext('2d'), W = cx.width, H = cx.height, img = src.getContext('2d').getImageData(0, 0, W, H), d = img.data, edge = [];
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
    const i = yy * W + xx, v = (1 - yy / H) * 0.75 + noise[i] * 0.25;
    if (v < b) d[i * 4 + 3] = 0;
    else if (v < b + 0.05 && d[i * 4 + 3]) { const hot = v < b + 0.025; d[i * 4] = hot ? 240 : 210; d[i * 4 + 1] = hot ? 184 : 74; d[i * 4 + 2] = hot ? 74 : 60; edge.push(i); }
    else if (v < b + 0.1 && d[i * 4 + 3]) { d[i * 4] *= 0.55; d[i * 4 + 1] *= 0.45; d[i * 4 + 2] *= 0.4; }
  }
  g.clearRect(0, 0, W, H); g.putImageData(img, 0, 0);
  return edge;
}
function fizzFrame(fx, b, x, y, sc) {
  const cx = fx.el, W = cx.width, H = cx.height, d = fx.state.img || (fx.state.img = fx.src.getContext('2d').getImageData(0, 0, W, H)), px = d.data;
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
    const i = yy * W + xx, v = (yy / H) * 0.75 + fx.noise[i] * 0.25;
    if (v < b && px[i * 4 + 3]) {
      if (Math.random() < 0.18) spark(x + (xx - W / 2) * sc, y + (yy - H / 2) * sc, (Math.random() - 0.5) * 12, -15 - Math.random() * 22, 320 + Math.random() * 260,
        `rgb(${px[i * 4]},${px[i * 4 + 1]},${px[i * 4 + 2]})`, -40);
      px[i * 4 + 3] = 0;
    }
  }
  cx.getContext('2d').putImageData(d, 0, 0);
}
function placeFx(fx, cxU, cyU, scale, rot, extra = '') {     // カードの中心を画面の u の位置に
  const u = uNow(), W = fx.el.width, H = fx.el.height;
  fx.el.style.left = (cxU - W / 2) * u + 'px'; fx.el.style.top = (cyU - H / 2) * u + 'px';
  fx.el.style.width = W * u + 'px'; fx.el.style.height = H * u + 'px';
  fx.el.style.transform = `rotate(${rot}deg) scale(${scale}) ${extra}`;
}
function playCardFx(how, cobj, box, delay = 0, gains = []) {
  const u = uNow(), el = document.createElement('canvas'), src = cardBitmap(cobj);
  el.width = src.width; el.height = src.height; el.className = 'cardfx';
  el.getContext('2d').drawImage(src, 0, 0);
  $('#stage').appendChild(el);
  const from = [(box.x + box.w / 2) / u, (box.y + box.h / 2) / u], rot0 = box.rot || 0;
  const noise = Float32Array.from({ length: src.width * src.height }, () => Math.random());
  const fx = { el, src, noise, how, cobj, from, rot0, t0: performance.now() + delay, last: 0, state: {} };
  fx.dur = { eat: 620, drink: 620, wear: 520, scroll: 780, burn: 560 }[how];
  { const se = { eat: 'eat_food', drink: 'potion_fizz', wear: /盾/.test(HK.cardOf(cobj).name) ? 'shield_clang' : 'armor_on', scroll: 'scroll_burn', burn: 'scroll_burn' }[how];   // 行き先ごとの音
    if (se) setTimeout(() => sfx(se), Math.max(0, delay)); }
  placeFx(fx, from[0], from[1], 1, rot0);
  cardFxList.push(fx);
  if (gains.length) showGains(how, gains, delay, fx.dur);
  setTimeout(() => { if (el.isConnected) el.remove(); const i = cardFxList.indexOf(fx); if (i >= 0) cardFxList.splice(i, 1); }, delay + fx.dur + (globalThis.__fxKeep || 1500));   // 保険（確認用に __fxKeep で延ばせる）
}
// カードを使って数値がどう変わったか（使う前 s0 と、主人公の手番が終わったところ mid の差。敵の手番の前）
function effectGains(s0, mid, cobj) {
  if (!mid || !cobj) return [];
  const a = s0.player, b = mid.player, c = HK.cardOf(cobj), out = [], add = (text, kind) => out.push({ text, kind });
  const d = (k) => (b[k] || 0) - (a[k] || 0);
  if (d('hp') > 0) add(`HP＋${d('hp')}`, 'hp'); else if (c.heal) add('HP 満タン', 'hp');
  if (d('maxHp') > 0) add(`最大HP＋${d('maxHp')}`, 'hp');
  if (d('temporaryBlock') > 0) add(`防御＋${d('temporaryBlock')}`, 'blk'); else if (c.block) add(`防御 ${b.temporaryBlock}のまま`, 'blk');
  if (d('temporaryAttack') > 0) add(`強撃＋${d('temporaryAttack')}`, 'etc');
  if (d('ember') > 0) add(`残火 ${b.ember}/3`, 'etc');
  if (b.reflect && !a.reflect) add('反射待機', 'etc');
  const pf = mid.prefer || {}, p0 = s0.prefer || {};
  if (pf.w && !p0.w) add('次の階：武器', 'etc');
  if (pf.a && !p0.a) add('次の階：防具', 'etc');
  if (pf.s && !p0.s) add('次の階：巻物', 'etc');
  return out;
}
// その数値を、使ったカードのすぐ右に出す。カードが着いたら出て、カードが消えた少しあとに上へ昇りながら消える
const GAIN_COLOR = { hp: '#e7a08a', blk: '#b8c4cc', etc: '#f0b84a' };
const GAIN_HOLD = 3000;     // 数値を読めるように残しておく時間（ミリ秒）
function showGains(how, gains, delay, dur) {
  const [hx, hy] = hpBelowU(), y = how === 'scroll' ? hy + 8 : hy, u = uNow();
  // まだ残っている前の数値は、重ならないようにすっと上へ消す
  for (const old of document.querySelectorAll('.card-gain')) {
    old.getAnimations().forEach(a => a.cancel());
    old.animate([{ opacity: 1, transform: 'translate(0px, -50%)' }, { opacity: 0, transform: `translate(0px, calc(-50% - ${8 * u}px))` }], { duration: 150, fill: 'forwards' }).onfinish = () => old.remove();
    setTimeout(() => old.isConnected && old.remove(), 400);
  }
  const el = document.createElement('div');
  el.className = 'card-gain';
  el.innerHTML = gains.map(g => `<b class="mm g" style="color:${GAIN_COLOR[g.kind]}">${esc(g.text)}</b>`).join('');
  Object.assign(el.style, { left: (hx + 20) * u + 'px', top: y * u + 'px' });
  $('#stage').appendChild(el);
  const total = GAIN_HOLD + 400, tIn = 180 / total, tOut = GAIN_HOLD / total;
  el.animate([
    { opacity: 0, transform: `translate(${-4 * u}px, -50%)`, easing: 'ease-out' },
    { opacity: 1, transform: 'translate(0px, -50%)', offset: tIn },
    { opacity: 1, transform: 'translate(0px, -50%)', offset: tOut, easing: 'ease-in' },
    { opacity: 0, transform: `translate(0px, calc(-50% - ${12 * u}px))` },
  ], { duration: total, delay: delay + 120, fill: 'both' })      // 緩急は区間ごと（全体にかけると、残っている時間が縮む）.onfinish = () => el.remove();
  setTimeout(() => el.isConnected && el.remove(), delay + total + 1500);     // 保険
}
// 演出ごとの見た目（t はミリ秒）
const FX = {
  eat(fx, t) {      // 体力の棒の下へ飛ぶ → 3口かじられる → 最後のかけらが棒へ吸い込まれる → 消える
    const [hx, hy] = hpBelowU(), q = ease(seg(t, 0, 200)), sc = lerp(1, 0.6, q);
    const x = lerp(fx.from[0], hx, q), y = lerp(fx.from[1], hy, q) - Math.sin(q * Math.PI) * 14;
    const bites = [[0, 36, 6, 9], [0, 40, 24, 8], [1, 30, 44, 10], [1, 10, 14, 9], [2, 18, 32, 13], [2, 6, 52, 11], [2, 34, 56, 9]];
    let squash = 1;
    for (let k = 0; k < 3; k++) {
      const tb = 230 + k * 110;
      if (t >= tb && !fx.state['b' + k]) {
        fx.state['b' + k] = 1;
        for (const [kk, bx, by, r] of bites) if (kk === k) {
          biteAt(fx.el, bx, by, r);
          const px = x + (bx - 21) * sc, py = y + (by - 30) * sc;
          for (let n = 0; n < 7; n++) spark(px, py, (Math.random() - 0.5) * 50, -10 - Math.random() * 30, 380 + Math.random() * 240, ['#cca673', '#e1bc88', '#f2dcb4', '#8a5a38'][n % 4], 160);
        }
        if (k === 2) toStatus('#status .bar', x, y, 9, ['#f0b84a', '#e7a08a', '#fbf3e2']);    // 食べ終わり：明るい粒が棒へ
      }
      if (t >= tb && t < tb + 60) squash = 1 - 0.12 * Math.sin((t - tb) / 60 * Math.PI);
    }
    const fade = 1 - seg(t, 560, 620);
    fx.el.style.opacity = fade;
    placeFx(fx, x, y, sc * squash, lerp(fx.rot0, 0, q));
  },
  drink(fx, t) {    // 体力の棒の下へ飛ぶ → 上から「しゅわー」と粒にほどけて、粒は上（体力の棒）へ昇って消える
    const [hx, hy] = hpBelowU(), q = ease(seg(t, 0, 190)), sc = lerp(1, 0.6, q);
    const x = lerp(fx.from[0], hx, q), y = lerp(fx.from[1], hy, q) - Math.sin(q * Math.PI) * 14;
    if (t >= 220) fizzFrame(fx, lerp(-0.05, 1.05, seg(t, 220, 600)), x, y, sc);
    placeFx(fx, x, y, sc, lerp(fx.rot0, 0, q));
  },
  wear(fx, t) {     // 体力の棒の下へ飛ぶ → すっと透けながら上（防御の数値）へ昇って消える
    const [bx, by] = hpBelowU(), q = ease(seg(t, 0, 180)), p = seg(t, 220, 520);
    const x = lerp(fx.from[0], bx, q), y = lerp(fx.from[1], by, q) - Math.sin(q * Math.PI) * 12 - ease(p) * 14;
    if (t >= 220 && !fx.state.piles) { fx.state.piles = 1; renderPiles(); }
    fx.el.style.opacity = 1 - p;
    placeFx(fx, x, y, lerp(1, 0.6, q), lerp(fx.rot0, 0, q));
  },
  scroll(fx, t) {   // 体力の棒の下へ浮かぶ → 縦に広がる → 下から燃え尽きる（火の粉・灰）
    const [tx, hy] = hpBelowU(), ty = hy + 8, q = ease(seg(t, 0, 190));     // 広げると縦に長いので、棒にかからないよう少し下げる
    const x = lerp(fx.from[0], tx, q), y = lerp(fx.from[1], ty, q);
    const open = ease(seg(t, 200, 340));
    const sx = lerp(1, 1.1, open), sy = t < 200 ? lerp(1, 0.4, q) : lerp(0.4, 0.9, open);
    if (t >= 360) fx.state.edge = burnFrame(fx.el, fx.src, fx.noise, lerp(-0.05, 1.05, seg(t, 360, 740)));
    placeFx(fx, x, y, 1, lerp(fx.rot0, 0, q), `scale(${sx}, ${sy})`);
    fx.scaleNow = [sx, sy]; fx.posNow = [x, y];
  },
  burn(fx, t) {     // その場で少し浮いて、下から燃えて灰になる
    const q = ease(seg(t, 0, 120)), x = fx.from[0], y = fx.from[1] - 14 * q;
    if (t >= 100) fx.state.edge = burnFrame(fx.el, fx.src, fx.noise, lerp(-0.05, 1.05, seg(t, 100, 540)));
    placeFx(fx, x, y, 1, fx.rot0);
    fx.scaleNow = [1, 1]; fx.posNow = [x, y];
  },
};
function drawCardFx(now) {
  if (globalThis.__fxNow != null) now = globalThis.__fxNow;      // 確認用：時刻を止めて1コマずつ見る
  const c = $('#card-fx'), g = c.getContext('2d');
  for (let i = cardFxList.length - 1; i >= 0; i--) {
    const fx = cardFxList[i], t = now - fx.t0;
    if (t < 0) continue;
    FX[fx.how](fx, t);
    if ((fx.how === 'scroll' || fx.how === 'burn') && fx.state.edge && fx.state.edge.length) {    // 燃える縁から火の粉と灰
      const W = fx.el.width, H = fx.el.height, [sx, sy] = fx.scaleNow, [px, py] = fx.posNow;
      for (let n = 0; n < 3; n++) {
        const e = fx.state.edge[Math.floor(Math.random() * fx.state.edge.length)], ex = px + ((e % W) - W / 2) * sx, ey = py + (Math.floor(e / W) - H / 2) * sy;
        if (Math.random() < 0.6) spark(ex, ey, (Math.random() - 0.5) * 20, -25 - Math.random() * 35, 380 + Math.random() * 300, Math.random() < 0.5 ? '#f0b84a' : '#d24a3c', -10);
        else spark(ex, ey, (Math.random() - 0.5) * 16, 5 + Math.random() * 10, 500 + Math.random() * 300, Math.random() < 0.5 ? '#4a4640' : '#6e655a', 60);
      }
    }
    if (t >= fx.dur) { fx.el.remove(); cardFxList.splice(i, 1); }
  }
  const dt = Math.min(50, now - (drawCardFx.last || now)) / 1000; drawCardFx.last = now;
  if (!cardParts.length && !c.dirty) return;
  g.clearRect(0, 0, c.width, c.height); c.dirty = cardParts.length > 0;
  for (let i = cardParts.length - 1; i >= 0; i--) {
    const p = cardParts[i]; p.t += dt * 1000;
    if (p.t >= p.life) { cardParts.splice(i, 1); continue; }
    if (p.home) {
      const q = p.t / p.life, e = q * q * (3 - 2 * q), side = Math.sin(q * Math.PI) * p.bow;
      p.x = lerp(p.x0, p.tx, e) + side; p.y = lerp(p.y0, p.ty, e);
      g.globalAlpha = q < 0.8 ? 1 : 1 - (q - 0.8) / 0.2;
    } else {
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      g.globalAlpha = p.t < p.life * 0.6 ? 1 : 1 - (p.t - p.life * 0.6) / (p.life * 0.4);
    }
    g.fillStyle = p.col; g.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
  }
  g.globalAlpha = 1;
}

// ---------------------------------------------------------------- 手札の動き
// 使ったカードは手札から行き先（捨て札）へ飛び、残りの手札は詰めて並び直し、補充のカードは山札から裏向きで飛んできてめくれる。
// 山札が尽きたときは、捨て札が山札へ戻ってシャッフルしてから配る。どれも速く。ルールの計算は済んでいて、見せ方だけ
const handMatches = () => { const ids = [...document.querySelectorAll('#hand .card')].map(b => Number(b.dataset.id)); return ids.length === st.hand.length && st.hand.every((c, i) => c.id === ids[i]); };
function stageRect(el) { const s = $('#stage').getBoundingClientRect(), r = el.getBoundingClientRect(); return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height }; }
const cardBox = b => ({ x: b.offsetLeft, y: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight, rot: Number(b.dataset.rot) || 0 });   // 傾ける前の箱と傾き
let ghosts = [];                           // いま飛んでいる写し（保険で片付けるため）
function ghostAt(el, r, cls = '') {        // 飛んでいく写し（ステージの上に、その場所・大きさで置く）
  const g = el ? el.cloneNode(true) : document.createElement('div');
  ghosts.push(g);
  g.className = (el ? el.className.replace(/\b(sel|leaving)\b/g, '') : '') + ' ghost ' + cls;
  Object.assign(g.style, { position: 'absolute', left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px', margin: 0, zIndex: 4, pointerEvents: 'none', transformOrigin: CARD_ORIGIN });
  $('#stage').appendChild(g); return g;
}
const EASE = 'cubic-bezier(.25,.8,.35,1)', CARD_ORIGIN = '50% 85%';
function animateHand(s0, usedId = null, usedMode = null, gains = []) {
  const u = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')) || 2;
  const oldEls = new Map([...document.querySelectorAll('#hand .card')].map(b => [Number(b.dataset.id), b]));
  const oldRects = new Map([...oldEls].map(([id, b]) => [id, cardBox(b)]));
  const finalIds = new Set(st.hand.map(c => c.id)), removed = new Set(st.removedCards.map(c => c.id));
  // 使ったカードは、山札が少なくてすぐ引き直したとき（同じカードがまた手札に来る）も、いったん出ていって配り直す
  const gone = s0.hand.filter(c => (c.id === usedId || !finalIds.has(c.id)) && oldEls.has(c.id));
  const fresh = st.hand.filter(c => c.id === usedId || !s0.hand.some(o => o.id === c.id));
  const reshuffle = fresh.length > s0.drawN;
  const discR = stageRect($('#disc .stack i:last-of-type')), deckR = stageRect($('#deck .stack i:last-of-type'));
  // 1) 手札を出ていくカード：捨て札へ弧を描いて飛ぶ（除外のカードは、いまは上へ浮いて消える。行き先ごとの演出は次の段で）
  gone.forEach((c, i) => {
    const r = oldRects.get(c.id);
    // 行き先ごとの演出（効果を使ったカードと、削除の巻物で消したカード）
    const how = cardFate(c, c.id === usedId ? usedMode : null, removed.has(c.id));
    if (how) { playCardFx(how, c, r, i * 45, c.id === usedId ? gains : []); return; }
    const g = ghostAt(oldEls.get(c.id), r);
    if (removed.has(c.id)) {
      g.animate([{ transform: `rotate(${r.rot}deg)`, opacity: 1 }, { transform: `translateY(${-30 * u}px) rotate(${r.rot}deg) scale(.9)`, opacity: 0 }], { duration: 260, easing: EASE, fill: 'forwards' }).onfinish = () => g.remove();
      return;
    }
    if (!gone.discardSe) { gone.discardSe = true; sfx('card_discard'); }   // 捨て札へ飛ぶ音（何枚でも1回）
    const dx = discR.x + discR.w / 2 - (r.x + r.w / 2), dy = discR.y + discR.h / 2 - (r.y + r.h / 2), k = discR.w / r.w;
    g.animate([
      { transform: `translate(0px, 0px) rotate(${r.rot}deg) scale(1)` },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 34 * u}px) rotate(${r.rot + (c.id === usedId ? 10 : 6)}deg) scale(${(1 + k) / 2})`, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) rotate(4deg) scale(${k})` },
    ], { duration: 280, delay: i * 45, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'forwards' }).onfinish = () => g.remove();
  });
  // 2) 手札を新しい並びで描き、残ったカードは前の場所から詰めて動く
  renderHand(st.hand);
  const els = new Map([...document.querySelectorAll('#hand .card')].map(b => [Number(b.dataset.id), b]));
  for (const [id, b] of els) {
    const o = oldRects.get(id); if (!o || id === usedId) continue;
    const n = cardBox(b);
    if (Math.abs(o.x - n.x) + Math.abs(o.y - n.y) + Math.abs(o.rot - n.rot) > 0.5)
      b.animate([{ transform: `translate(${o.x - n.x}px, ${o.y - n.y}px) rotate(${o.rot}deg)` }, { transform: `translate(0px, 0px) rotate(${n.rot}deg)` }], { duration: 180, easing: EASE });
  }
  // 3) 山札が尽きたら、捨て札が山札へ戻ってシャッフル
  let t0 = gone.length ? 110 : 0;
  if (reshuffle) {
    setTimeout(() => sfx('card_shuffle'), t0);
    const n = Math.min(6, Math.max(2, s0.discN + gone.length));
    for (let i = 0; i < n; i++) {
      const g = ghostAt(null, discR, 'card-back');
      g.animate([{ transform: 'translate(0px, 0px) rotate(0deg)' }, { transform: `translate(${(deckR.x - discR.x) / 2}px, ${-14 * u}px) rotate(-8deg)`, offset: 0.5 }, { transform: `translate(${deckR.x - discR.x}px, ${deckR.y - discR.y}px) rotate(0deg)` }],
        { duration: 170, delay: t0 + i * 35, easing: EASE, fill: 'forwards' }).onfinish = () => g.remove();
    }
    t0 += 170 + n * 35;
    $('#deck .stack').animate([{ transform: 'none' }, { transform: `translateX(${-2 * u}px) rotate(-3deg)` }, { transform: `translateX(${2 * u}px) rotate(3deg)` }, { transform: 'none' }], { duration: 200, delay: t0, easing: 'linear' });
    t0 += 200;
  }
  // 4) 補充：山札から裏向きで飛んできて、手札の場所でめくれる
  fresh.forEach((c, i) => {
    const b = els.get(c.id); if (!b) return;
    const n = cardBox(b), delay = t0 + i * 55;
    b.style.visibility = 'hidden';
    // 裏向きの写しを手札の場所に置き、山札の位置（山札の大きさ・傾きなし）から飛ばしてくる
    const g = ghostAt(null, n, 'card-back');
    const k = deckR.w / n.w, ox = deckR.x + deckR.w / 2 - (n.x + n.w / 2), oy = deckR.y + deckR.h / 2 - (n.y + n.h / 2);
    g.animate([{ transform: `translate(${ox}px, ${oy}px) rotate(0deg) scale(${k})` }, { transform: `translate(0px, 0px) rotate(${n.rot}deg) scale(1)` }],
      { duration: 170, delay, easing: EASE, fill: 'forwards' }).onfinish = () => {
      g.getAnimations().forEach(a => a.cancel());
      g.animate([{ transform: `rotate(${n.rot}deg) scaleX(1)` }, { transform: `rotate(${n.rot}deg) scaleX(0)` }], { duration: 55, easing: 'ease-in', fill: 'forwards' }).onfinish = () => {
        g.remove(); b.style.visibility = '';
        b.animate([{ transform: `rotate(${n.rot}deg) scaleX(0)` }, { transform: `rotate(${n.rot}deg) scaleX(1)` }], { duration: 65, easing: 'ease-out' });
        if (i === fresh.length - 1) renderPiles();
      };
      sfx('card_deal');
    };
  });
  if (!fresh.length) setTimeout(renderPiles, gone.length ? 300 : 0);
  // 保険：画面が裏に回っていたなどで「終わった」合図が届かなくても、時間がたったら必ず片付けて、カードを見せる
  const mine = ghosts.splice(0), endT = t0 + fresh.length * 55 + 450;
  setTimeout(() => {
    mine.forEach(g => g.remove());
    for (const c of fresh) { const b = els.get(c.id); if (b) b.style.visibility = ''; }
    renderPiles();
  }, endT);
}

// ダメージを受けたときの体力の棒：揺さぶって、減っていく先から粒を飛ばす。粒は画面の1ドット単位（--u）で描く
const HPFX = { OX: 20, OY: 20, BAR_X: 2, BAR_W: 190, BAR_Y: 10, BAR_H: 5 };          // 体力の欄の左上から測った、棒の中身の位置（u）
const hpParts = [];
let hpDrain = null;                                    // 先端が動いているあいだ（棒の縮みは .25 秒）
function hpHitFx(from, to, max, dmg) {
  const bar = document.querySelector('#status .bar');
  bar.classList.remove('hit'); void bar.offsetWidth; bar.classList.add('hit');
  hpDrain = { from: from / max, to: to / max, t0: performance.now(), ms: 250, n: Math.min(46, 10 + dmg * 7), made: 0 };
}
function spawnHpPart(frac) {
  const x = HPFX.OX + HPFX.BAR_X + frac * HPFX.BAR_W, y = HPFX.OY + HPFX.BAR_Y + Math.random() * HPFX.BAR_H;
  const up = Math.random() < 0.7;
  hpParts.push({ x, y, vx: 10 + Math.random() * 55, vy: up ? -(25 + Math.random() * 60) : 10 + Math.random() * 25,
    life: 380 + Math.random() * 380, t: 0, size: Math.random() < 0.3 ? 2 : 1,
    col: ['#d24a3c', '#d24a3c', '#e7a08a', '#8f2f2b', '#f0b84a'][Math.floor(Math.random() * 5)] });
}
let hpFxLast = 0;
function drawHpFx(now) {
  const dt = Math.min(50, now - (hpFxLast || now)) / 1000; hpFxLast = now;
  if (hpDrain) {
    const q = Math.min(1, (now - hpDrain.t0) / hpDrain.ms), want = Math.round(hpDrain.n * Math.min(1, q * 1.3));
    const frac = hpDrain.from + (hpDrain.to - hpDrain.from) * q;
    while (hpDrain.made < want) { spawnHpPart(frac); hpDrain.made++; }
    if (q >= 1) hpDrain = null;
  }
  const c = $('#hp-fx'), x = c.getContext('2d');
  if (!hpParts.length && !c.dirty) return;
  x.clearRect(0, 0, c.width, c.height); c.dirty = hpParts.length > 0;
  for (let i = hpParts.length - 1; i >= 0; i--) {
    const p = hpParts[i]; p.t += dt * 1000;
    if (p.t >= p.life) { hpParts.splice(i, 1); continue; }
    p.vy += 160 * dt; p.vx *= 1 - 1.5 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    x.globalAlpha = p.t < p.life * 0.6 ? 1 : 1 - (p.t - p.life * 0.6) / (p.life * 0.4);
    x.fillStyle = p.col; x.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
  }
  x.globalAlpha = 1;
}

// 瀕死（体力が3割以下）のときの、四隅の血のあと。ドットで1回だけ描いておき、出し入れは不透明度だけ
{
  const c = $('#blood'), x = c.getContext('2d'), R = seeded(4242);
  const dot = (col, a, b, w = 1, h = 1) => { x.fillStyle = col; x.fillRect(Math.round(a), Math.round(b), w, h); };
  const blob = (cx, cy, r, col) => { for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy <= r * r * (0.75 + R() * 0.25)) dot(col, cx + xx, cy + yy); };
  for (const [sx, sy] of [[0, 0], [NW, 0], [0, NH], [NW, NH]]) {
    const ix = sx ? -1 : 1, iy = sy ? -1 : 1;
    for (let i = 0; i < 40; i++) {                      // 隅に近いほど大きい（明るい赤：暗い隅でも30％で見える）
      const d = R() ** 1.4, ang = R() * Math.PI / 2, dist = d * 100;
      blob(sx + ix * Math.cos(ang) * dist, sy + iy * Math.sin(ang) * dist * 0.8, Math.round(6 + (1 - d) * 22 * R()), '#d24a3c');
    }
    for (let i = 0; i < 18; i++) {                      // 濃い赤のしみ（乾きかけ）
      const d = R() ** 1.2, ang = R() * Math.PI / 2, dist = d * 60;
      blob(sx + ix * Math.cos(ang) * dist, sy + iy * Math.sin(ang) * dist * 0.8, Math.round(2 + R() * 7), '#8f2f2b');
    }
    for (let i = 0; i < 40; i++) {                      // 飛び散ったしずく
      const ang = R() * Math.PI / 2, dist = 90 + R() * 50, w = R() < 0.3 ? 2 : 1;
      dot('#d24a3c', sx + ix * Math.cos(ang) * dist - (ix < 0 ? w : 0), sy + iy * Math.sin(ang) * dist * 0.8 - (iy < 0 ? w : 0), w, w);
    }
    if (iy > 0) for (let i = 0; i < 4; i++) {           // 上の隅からのたれ
      const dx = 10 + R() * 70, len = 20 + R() * 40;
      for (let k = 0; k < len; k++) dot('#d24a3c', sx + ix * dx - (ix < 0 ? 2 : 0), sy + 10 + k, 2, 1);
      dot('#d24a3c', sx + ix * dx - (ix < 0 ? 3 : 0) - 0.5, sy + 10 + len, 3, 2);
    }
  }
}
let bloodTimer = 0;
function renderDying(hurt = false) {
  const p = st.player, el = $('#blood'), on = dispHp > 0 && dispHp <= Math.ceil(p.maxHp * 0.3);
  globalThis.FaceAnim?.setDying(on);   // 左下の顔も瀕死の顔に
  // 危険時の曲は鳴らさない（2026-10-09 テストプレイ：ピンチ曲はやめて削除）
  if (!on) { el.classList.remove('on', 'dim'); clearTimeout(bloodTimer); bloodTimer = 0; return; }
  if (!el.classList.contains('on') || hurt) {
    el.classList.remove('dim'); el.classList.add('on');
    clearTimeout(bloodTimer); bloodTimer = setTimeout(() => el.classList.add('dim'), 2500);
  }
}

// カードの説明（カードに手をかざしたときだけ、カードの上に出る）
let tipTimer = null, tipFor = null;
function showCardTip(id) {
  clearTimeout(tipTimer);
  const i = st.hand.findIndex(c => c.id === id); if (i < 0 || busy) return;
  const cobj = st.hand[i], c = HK.cardOf(cobj), pos = cardPos(i, st.hand.length), el = $('#cardtip');
  if (targeting && targeting.cardId === id && !c.damage) return;     // 移動の向き選びの最中は出さない（武器は説明を出したまま範囲を選べる）
  tipFor = id;
  const pred = c.damage ? `<p class="pred">いま使うと <b>${HK.damageOf(st, cobj).total}</b> ダメージ・届く距離 ${c.range}</p>` : '';
  const how = c.damage ? '<p class="how">光ったマスの敵をクリック（または矢印キー）で攻撃</p>' : directional(c) ? `<p class="how">「${c.moveDistance ? '移動に使う' : '使う'}」のあと、光ったマスを選ぶ</p>` : c.type === '財宝' ? '<p class="how">持ち帰ると得点。使うことはできない</p>' : '';
  const n = cardNumber(cobj), kc = KIND_COLOR[KIND_CLASS[c.type] || 'misc'];
  const lk = lockedCards.has(cobj.id);
  el.innerHTML = `<div class="t">${n ? `<span class="badge mm m" style="--kc:${kc}">${n}</span>` : ''}<span class="nm mm m">${esc(c.name)}</span><small class="mm s">${esc(c.type)}</small>`
    + `<button class="lockbtn${lk ? ' on' : ''}" title="${lk ? 'ロックを外す' : 'ロックする（十字キーの自動移動で使わない）'}"><i></i></button></div>`
    + `<div class="bd mm m"><p>${esc(c.description)}</p>${pred}${how}${lk ? '<p class="lockd">ロック中：自動移動で使わない</p>' : ''}<div class="acts"></div></div>`;
  el.querySelector('.lockbtn').onclick = ev => { ev.stopPropagation(); startAudio(); toggleLock(cobj.id); };
  // ボタン：「使う」だけ上の行。下の行に、移動と捨てる（水色）。歩く・走るなどの移動のカードは「使う」と「1マス移動に使う」を
  // 水色の「移動に使う」1つにまとめる（2026-10-09 テストプレイ）
  const acts = el.querySelector('.acts');
  const row = () => { const r = document.createElement('div'); r.className = 'row'; acts.appendChild(r); return r; };
  const add = (r, label, fn, cls = '') => { const b = document.createElement('button'); b.textContent = label; b.className = 'mm m ' + cls; b.dataset.act = label; b.onclick = ev => { ev.stopPropagation(); startAudio(); fn(); }; r.appendChild(b); };
  if (c.moveDistance) {                                   // 移動のカードは縦に1つずつ
    add(row(), '移動に使う', () => useCard(cobj), 'mv');
    add(row(), '捨てて引き直す', () => perform('discard', cobj.id), 'mv');
  } else {
    if (c.type !== '財宝') add(row(), '使う', () => useCard(cobj), 'primary');
    const r = row();
    add(r, '1マス移動に使う', () => { selected = cobj.id; startTargeting(cobj, 'forced'); hideCardTip(); renderHand(); }, 'mv');
    add(r, '捨てて引き直す', () => perform('discard', cobj.id), 'mv');
  }
  el.style.left = 'calc(var(--u) * 356)';                // 盤の右の余白の下に固定（手札の横。盤には被らない。山札などは上の「もちもの一覧」の下へ移した）
  el.style.bottom = 'calc(var(--u) * 14)';                 // 少し上げた（2026-10-10）
  void pos;
  el.classList.add('show');
}
// カードに手をかざしたとき。説明の窓は盤の右に固定なので、「使う」へ手を動かす途中でほかのカードをかすめることがある。
// かすめたカードの説明に替わると、窓の「使う」がそのカードを使ってしまうので：
//  ・カードを選んでいる間は、ほかのカードをかざしても説明を替えない（見たいときは押して選び直す）
//  ・何も選んでいないときも、別のカードの説明が出ているなら、少しとどまってから替える
let hoverTimer = null;
const HOVER_SWITCH_MS = 250;
function hoverCard(id) {
  clearTimeout(hoverTimer); clearTimeout(tipTimer);      // カードの上に来たら、説明を閉じる予約は取り消す
  if (selected && selected !== id && st.hand.some(c => c.id === selected)) return;
  if (tipFor && tipFor !== id && $('#cardtip').classList.contains('show')) { hoverTimer = setTimeout(() => showCardTip(id), HOVER_SWITCH_MS); return; }
  showCardTip(id);
}
function hideCardTip() { clearTimeout(tipTimer); clearTimeout(hoverTimer); tipFor = null; $('#cardtip').classList.remove('show'); }
function hideCardTipSoon() {
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => {                         // 選んだカードがあれば、その説明に戻す
    const sel = selected && st.hand.find(c => c.id === selected);
    if (sel && (!targeting || (targeting.cardId === selected && HK.cardOf(sel).damage))) showCardTip(selected); else hideCardTip();
  }, 220);
}
$('#cardtip').addEventListener('mouseenter', () => clearTimeout(tipTimer));
$('#cardtip').addEventListener('mouseleave', hideCardTipSoon);

// 主人公の頭の上のふきだし
// 画面中央のひとこと（「そっちには進めない」「〇〇を拾った」など）
// 文字は書体本来の大きさ（px）で描いて、にじんだ縁を切り落としてから、画面の整数倍に拡大する（ドットをくっきり出す）
const SAY_FONTS = [
  { id: 'monica', name: 'マルモニカ', family: 'MaruMonica', px: 16 },
  { id: 'monica-edge', name: 'マルモニカ・黒縁取り', family: 'MaruMonica', px: 16, edge: '#0b1120' },
  { id: 'dot16', name: 'DotGothic16', family: 'DotGothic16', px: 16 },
  { id: 'dot16-edge', name: 'DotGothic16・黒縁取り', family: 'DotGothic16', px: 16, edge: '#0b1120' },
];
const SAY_SIZE = 12;          // 文字の高さの目安（画面の u。前は16）
let sayFont = SAY_FONTS[1];      // マルモニカ・黒縁取り（ユーザー決定）
try { const k = localStorage.getItem('honekko3d.sayFont2'); if (k) sayFont = SAY_FONTS.find(f => f.id === k) || sayFont; } catch { /* 保存なしで続ける */ }
function textBitmap(text, f, color = '#fbf3e2', fixed = null) {
  const m = canvas(1, 1).getContext('2d'); m.font = `${f.px}px "${f.family}"`;
  const w = Math.ceil(m.measureText(text).width) + 4, h = Math.ceil(f.px * 1.25) + 4;    // 縁取りのぶん、まわりに余白
  const c = canvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
  // 書体ごとに、ドットが格子にぴったり乗る位置が少しずつ違う。ずらしながら試して、にじみがいちばん少ない位置で描く
  let best = fixed;
  if (!best) for (const oy of [0, 0.25, 0.5, 0.75]) for (const ox of [0, 0.5]) {
    x.clearRect(0, 0, w, h); x.font = `${f.px}px "${f.family}"`; x.textBaseline = 'top'; x.fillStyle = color; x.fillText(text, 2 + ox, 2 + oy);
    const dd = x.getImageData(0, 0, w, h).data; let blur = 0;
    for (let i = 3; i < dd.length; i += 4) if (dd[i] > 24 && dd[i] < 232) blur++;
    if (!best || blur < best.blur) best = { blur, ox, oy };
  }
  x.clearRect(0, 0, w, h); x.font = `${f.px}px "${f.family}"`; x.textBaseline = 'top'; x.fillStyle = color; x.fillText(text, 2 + best.ox, 2 + best.oy);
  const img = x.getImageData(0, 0, w, h), d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 110 ? 255 : 0;     // にじみを切り落として、ドットの形だけにする
  if (f.edge) {                                    // 黒縁取り：文字のドットのまわり8方向を1ドットぶん黒で囲む
    const on = i => d[i * 4 + 3] === 255, rgb = [1, 3, 5].map(k => parseInt(f.edge.slice(k, k + 2), 16)), add = [];
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      if (on(yy * w + xx)) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = xx + dx, ny = yy + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && on(ny * w + nx)) { near = true; break; }
      }
      if (near) add.push(yy * w + xx);
    }
    for (const i of add) { d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = 255; }
  }
  x.putImageData(img, 0, 0);
  c.align = { ox: best.ox, oy: best.oy };
  return c;
}
function paintText(el, text, f) {
  const u = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')) || 2;
  const want = SAY_SIZE * u, k = Math.max(1, Math.round(want / f.px - 0.01));    // ちょうど半分のときは小さい方
  const src = textBitmap(text, f);
  el.width = src.width * k; el.height = src.height * k;
  const x = el.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(src, 0, 0, el.width, el.height);
  el.style.width = el.width + 'px'; el.style.height = el.height + 'px';
}
// 文字のアニメーション：1文字ずつ素早く順に出て、少し下から跳ね上がり、わずかに行きすぎて収まる（ぽよん）。
// 動きは書体のドット単位（拡大の前）で付けるので、にじまない。消えるときは点滅させず、ゆっくり薄くなる
const SAY_STEP = 25, SAY_HOP = 170;
const HOP = [[0, 4], [0.25, 1], [0.45, -2], [0.7, -1], [1, 0]];     // 経過の割合 → 縦のずれ（書体のドット）
function hopAt(t) {
  if (t <= 0) return null;
  const q = Math.min(1, t / SAY_HOP);
  for (let i = 1; i < HOP.length; i++) if (q <= HOP[i][0]) return HOP[i - 1][1] + (HOP[i][1] - HOP[i - 1][1]) * (q - HOP[i - 1][0]) / (HOP[i][0] - HOP[i - 1][0]);
  return 0;
}
let sayUntil = 0, sayText = '', sayAnim = null;
// 位置合わせは書体ごとに1回、1文字ぶんのドット絵は一度作ったら覚えておく（出すたびに作り直すと画面が一瞬止まる）
const sayAlign = new Map(), glyphCache = new Map();
function alignOf(f) {
  if (!sayAlign.has(f.id)) sayAlign.set(f.id, textBitmap('そっちには進めない剣を拾った', f).align);
  return sayAlign.get(f.id);
}
function glyphOf(ch, f) {
  const key = f.id + '|' + ch;
  if (!glyphCache.has(key)) {
    const img = textBitmap(ch, f, '#fbf3e2', alignOf(f)), d = img.getContext('2d').getImageData(0, 0, img.width, img.height).data;
    img.top = img.height; img.bottom = -1;           // 文字（縁取りこみ）のいちばん上といちばん下の行
    for (let i = 3; i < d.length; i += 4) if (d[i]) { const r = Math.floor((i >> 2) / img.width); img.top = Math.min(img.top, r); img.bottom = Math.max(img.bottom, r); }
    img.body = f.edge ? textBitmap(ch, { ...f, edge: null }, '#fbf3e2', alignOf(f)) : img;    // 影には縁取りを映さない（文字の本体だけ）
    glyphCache.set(key, img);
  }
  return glyphCache.get(key);
}
function buildSay(text, f) {
  const m = canvas(1, 1).getContext('2d'); m.font = `${f.px}px "${f.family}"`;
  const chars = [...text], glyphs = chars.map((ch, i) => ({ img: glyphOf(ch, f), x: Math.round(m.measureText(chars.slice(0, i).join('')).width) }));
  const whole = { width: Math.ceil(m.measureText(text).width) + 4, height: Math.ceil(f.px * 1.25) + 4 };
  const u = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')) || 2;
  const k = Math.max(1, Math.round(SAY_SIZE * u / f.px - 0.01)), pad = 5;
  const top = Math.min(...glyphs.map(g => g.img.top)), bottom = Math.max(...glyphs.map(g => g.img.bottom));
  const reflH = Math.ceil((bottom - top + 1) / 2) + 6;                     // 反射した影は半分の高さ（＋跳ねるぶん）
  const H = whole.height + pad * 2 + reflH;
  for (const el of [$('#say'), $('#say-shadow')]) { el.width = whole.width * k; el.height = H * k; el.style.width = el.width + 'px'; el.style.height = el.height + 'px'; }
  // いったん書体のドットの大きさで描いてから、整数倍に拡大する
  const buf = canvas(whole.width, H), sbuf = canvas(whole.width, H), refl = canvas(whole.width, reflH);
  return { glyphs, k, pad, top, bottom, reflH, buf, sbuf, refl, t0: performance.now(), done: false };
}
// 文字の下の影：文字の形を上下に返して高さを半分にし、真下に引く。藍の影色で乗算して下の床を暗くする。
// 下へいくほど段々に消える（にじませず、行ごとの濃さで）
const REFL_ALPHA = 0.85, REFL_COLOR = '#2b3e6d';      // ぼかすと薄まるぶん、少し濃いめ
function drawSay(now) {
  const a = sayAnim; if (!a || a.done) return;
  const el = $('#say'), x = el.getContext('2d'), b = a.buf.getContext('2d'), r = a.refl.getContext('2d');
  b.clearRect(0, 0, a.buf.width, a.buf.height); r.clearRect(0, 0, a.refl.width, a.refl.height);
  const floorY = a.pad + a.bottom + 2;                  // 影の付け根（文字がふだん収まったときの足もとの少し下）
  let moving = false;
  a.glyphs.forEach((g, i) => {
    const t = now - a.t0 - i * SAY_STEP, dy = hopAt(t);
    if (dy === null) { moving = true; return; }
    if (t < SAY_HOP) moving = true;
    const oy = Math.round(dy);
    b.drawImage(g.img, g.x, a.pad + oy);
    // 影：文字の行を下から1行おきに拾って、上下を返して並べる。文字が跳ね上がると、影は逆に下へ離れる
    const lift = Math.max(0, -oy), sink = Math.max(0, oy);
    for (let row = g.img.bottom - sink, ry = Math.ceil(lift / 2); row >= g.img.top; row -= 2, ry++) {
      if (ry >= a.reflH) break;
      r.drawImage(g.img.body, 0, row, g.img.width, 1, g.x, ry, g.img.width, 1);
    }
  });
  r.globalCompositeOperation = 'source-in'; r.fillStyle = REFL_COLOR; r.fillRect(0, 0, a.refl.width, a.refl.height); r.globalCompositeOperation = 'source-over';
  const sb = a.sbuf.getContext('2d'); sb.clearRect(0, 0, a.sbuf.width, a.sbuf.height);
  for (let ry = 0; ry < a.reflH; ry++) {
    sb.globalAlpha = REFL_ALPHA * Math.max(0, 1 - Math.floor(ry / 2) * 2 / a.reflH);
    sb.drawImage(a.refl, 0, ry, a.refl.width, 1, 0, floorY + ry, a.refl.width, 1);
  }
  sb.globalAlpha = 1;
  x.imageSmoothingEnabled = false; x.clearRect(0, 0, el.width, el.height);
  x.drawImage(a.buf, 0, 0, el.width, el.height);
  const sel = $('#say-shadow'), sx = sel.getContext('2d');
  // 影はドットにこだわらず、ぼかしてやわらかく（ユーザー指定）
  sx.imageSmoothingEnabled = true; sx.clearRect(0, 0, sel.width, sel.height);
  sx.filter = `blur(${(a.k * 1.3).toFixed(1)}px)`; sx.drawImage(a.sbuf, 0, 0, sel.width, sel.height); sx.filter = 'none';
  if (!moving) a.done = true;
}
function say(t) {
  if (!t) return;
  sayText = t;
  const f = sayFont, el = $('#say');
  const font = `${f.px}px "${f.family}"`;
  if (document.fonts.check(font, t)) sayAnim = buildSay(t, f);
  else {                                     // 書体がまだ読み込まれていなければ、読み込めてから作る（それまでの仮の絵は覚えない）
    sayAnim = null;
    document.fonts.load(font, t).catch(() => {}).then(() => { if (sayText === t) { glyphCache.clear(); sayAlign.clear(); sayAnim = buildSay(t, f); } });
  }
  el.classList.add('show'); $('#say-shadow').classList.add('show');
  sayUntil = performance.now() + 1300 + [...t].length * SAY_STEP;
}
function placeBubble(now) {
  drawSay(now);
  if (now > sayUntil) { $('#say').classList.remove('show'); $('#say-shadow').classList.remove('show'); }
}
// 書体くらべ（T キー）：候補を同じ文で並べ、押すと切り替える
function toggleFontCmp(on = !$('#fontcmp').classList.contains('open')) {
  const el = $('#fontcmp');
  el.classList.toggle('open', on); if (!on) return;
  el.innerHTML = '<div class="h">ひとことの書体（押すと切り替え・T で閉じる）</div>';
  for (const f of SAY_FONTS) {
    const b = document.createElement('button'); b.className = f === sayFont ? 'on' : '';
    b.innerHTML = `<span>${esc(f.name)}</span>`;
    const cv2 = document.createElement('canvas'); b.appendChild(cv2);
    const draw = () => paintText(cv2, 'そっちには進めない', f);
    draw(); document.fonts.load(`${f.px}px "${f.family}"`, 'そっちには進めない拾った').then(draw).catch(() => {});
    b.onclick = () => { sayFont = f; try { localStorage.setItem('honekko3d.sayFont2', f.id); } catch { /* 保存なし */ } toggleFontCmp(true); say('剣を拾った'); };
    el.appendChild(b);
  }
}

// 確認（盤の上に紙を1枚）
function showDialog(title, html, buttons) {
  hideCardTip(); delete $('#dialog').dataset.backdrop; $('#dialog .paper').classList.remove('pick');
  $('#dlg-title').textContent = title; $('#dlg-body').innerHTML = html;
  const acts = $('#dlg-actions'); acts.innerHTML = '';
  buttons.forEach(([label, fn, cls]) => { const b = document.createElement('button'); b.textContent = label; b.className = 'mm m ' + (cls || ''); b.onclick = () => { startAudio(); fn(); }; acts.appendChild(b); });
  $('#dialog').classList.add('open');
}
function closeDialog() { $('#dialog').classList.remove('open'); }
$('#dialog').addEventListener('click', ev => { if (ev.target.id === 'dialog' && $('#dialog').dataset.backdrop === 'cancel') { closeDialog(); globalThis.Music?.se('ui_cancel'); } });
const dialogOpen = () => $('#dialog').classList.contains('open');
function cancelAll() { targeting = null; selected = null; closeDialog(); hideCardTip(); renderHand(); }

function selectCard(id) {
  if (busy || st.gameStatus !== 'PLAYING') return;
  const cobj = st.hand.find(c => c.id === id); if (!cobj) return;
  const c = HK.cardOf(cobj);
  if (selected === id && targeting && targeting.cardId === id && c.damage) return cancelAll();   // 武器をもう一度押す＝やめる
  if (selected === id && !targeting) {                     // もう一度押す＝使う
    if (c.type !== '財宝') return useCard(cobj);
    return cancelAll();
  }
  closeDialog();
  selected = id; targeting = null; sfx('card');
  if (c.damage) startTargeting(cobj, 'effect');            // 武器は選んだ時点で届く範囲を出す。光ったマスの敵をクリックすればそのまま攻撃
  renderHand(); showCardTip(id);
}
function useCard(cobj) {
  const c = HK.cardOf(cobj), base = { cardId: cobj.id, mode: 'effect' };
  if (c.returnToSurface) return showDialog('地上へ帰る？', `<p>ここで探索を終えて、${HK.score(st).total}点を持ち帰ります。</p>`, [['帰る', () => perform('play', base), 'primary'], ['やめる', cancelAll]]);
  if (c.scrollEffect === 'deleteCard') {
    const list = st.hand.filter(h => h.id !== cobj.id).map(h => [HK.cardOf(h).name, () => perform('play', { ...base, targetCardId: h.id })]);
    return showDialog('どのカードを消す？', list.length ? '<p>使用する対象を選んでください。選んだカードはデッキから永久になくなります。</p>' : '<p>対象がありません。巻物もターンも消費しません。</p>', list.concat([['やめる', cancelAll]]));   // 対象がないときは原作の文言
  }
  if (c.scrollEffect === 'fuseWeapons' || c.scrollEffect === 'fuseArmor') {
    const list = HK.fusionOptions(st, c.scrollEffect === 'fuseArmor' ? '防御' : '攻撃').map(o => [`${o.name}×2 → ${o.resultName}`, () => perform('play', { ...base, materialCardIds: o.cards.map(a => a.id) })]);
    return showDialog('どれを合体する？', list.length ? '<p>使用する対象を選んでください。</p>' : '<p>対象がありません。巻物もターンも消費しません。</p>', list.concat([['やめる', cancelAll]]));   // 原作の文言
  }
  if (directional(c)) { selected = cobj.id; startTargeting(cobj, 'effect'); hideCardTip(); renderHand(); return; }
  perform('play', base);
}

// ---- クリア演出（js/ending.js）：踏破・帰還の巻物で、撃破と財宝を数えてスコア・ランキングへ。ゲームオーバーは下の結果の窓
function headIcon(c, size = 32) {     // 絵の上の方（頭のあたり）を size×size で切り出す
  const x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, c.height).data;
  let top = c.height, l = c.width, r = 0;
  for (let y = 0; y < c.height; y++) for (let i = 0; i < c.width; i++) if (d[(y * c.width + i) * 4 + 3]) { if (y < top) top = y; if (y < top + 12) { l = Math.min(l, i); r = Math.max(r, i); } }
  const cx = Math.round((l + r) / 2), o = canvas(size, size); o.getContext('2d').drawImage(c, cx - size / 2, top, size, size, 0, 0, size, size); return o;
}
function enemyIcon(type) {
  const look = enemyLook(type), grp = egroup(look.kind), gr = SPR.groups[grp];
  let sw = look.swap || null;
  if (look.recolor && gr.k) { sw = {}; for (const [ch, c] of Object.entries(gr.pal)) if (look.recolor[c]) sw[ch] = look.recolor[c]; }
  return headIcon(spr(grp, gr.k ? 'fr_idle_0' : 'idle_0', false, sw));
}
function endingData(s) {
  const kills = Object.entries(s.kills).map(([type, count]) => { const info = HK.enemyInfo(type); return { type, name: info.name, count, value: info.score, icon: enemyIcon(type) }; });
  const ids = Object.fromEntries(Object.entries(HK.cards).filter(([, c]) => c.type === '財宝').map(([id, c]) => [c.name, id]));
  const treasure = HK.score(s).treasure.map(t => ({ ...t, icon: spr('icon', SPR.cardIcon[ids[t.name]] || 'gem') }));
  const total = kills.reduce((n, k) => n + k.count * k.value, 0) + treasure.reduce((n, t) => n + t.count * t.value, 0);
  const g = SPR.groups[PGROUP], hero = spr(PGROUP, g.k ? 'bk_idle_0' : 'idle_0', false, playerSwap());
  return { status: s.gameStatus, floor: s.floor, turns: s.turn, ms: performance.now() - runStart, kills, treasure, total, hero,
           playerIcon: headIcon(spr(PGROUP, g.k ? 'fr_idle_0' : 'idle_0', false, playerSwap()), 30).toDataURL(), face: faceUrl() };
}
// そのとき使っていた顔グラ（左下の顔、待機の最初のコマ・96×96）。ランキングの左に出す
function faceUrl() {
  try {
    const r = FaceKit.build(FaceAnim.getLook()), c = canvas(96, 96);
    c.getContext('2d').putImageData(FaceAnim.toImageData(r.idle.frames[0]), 0, 0);
    return c.toDataURL();
  } catch { return ''; }
}
function playEnding(data) {
  globalThis.Music?.jingle('ending');   // エンディングの曲（集計の効果音は ending.js が Music.se で鳴らす）
  closeDialog(); hideCardTip();
  globalThis.Ending.play(data, { done() { newGame(); if (globalThis.Opening) Opening.show(); else $('#title').classList.add('open'); } });
}
function showResult() {
  clearSave();                                     // ゲームオーバー・帰還・踏破で、つづきからの保存は消す
  if (!(st.gameStatus !== 'GAME_OVER' && globalThis.Ending)) globalThis.Music?.jingle(st.gameStatus === 'GAME_OVER' ? 'gameover' : 'return');   // ゲームオーバー／帰還（エンディングの曲は playEnding で）
  if (st.gameStatus !== 'GAME_OVER' && globalThis.Ending) return playEnding(endingData(st));
  if (st.gameStatus === 'GAME_OVER' && globalThis.GameOver) {   // ゲームオーバーの演出（js/gameover.js）：子犬が担架で運んでいく
    const hair = HAIR_PRESETS[globalThis.HK_PLAYER?.look?.hair];
    return GameOver.play({ hair: hair && [hair[0], hair[1]], info: `到達 B${st.floor}F・${st.turn}ターン`,
      onAgain: () => newGame(), onTitle: globalThis.Opening ? () => { newGame(); Opening.show(); } : null });
  }
  const over = st.gameStatus === 'GAME_OVER', r = HK.score(st);
  const el = $('#result');
  el.innerHTML = `<div class="box"><div class="eyebrow">${over ? 'GAME OVER' : st.gameStatus === 'CLEARED' ? 'DUNGEON CLEAR' : 'RETURNED'}</div>
    <h2>${over ? '地下迷宮で力尽きた' : st.gameStatus === 'CLEARED' ? '地下迷宮を踏破した' : '地上へ帰還した'}</h2>
    <p>到達 B${st.floor}F・${st.turn}ターン</p>${over ? '' : `<p class="total">${r.total}点</p>`}
    <button class="primary" id="again">もう一度 / B1F から</button>${globalThis.Opening ? ' <button id="to-title">タイトルへ</button>' : ''}</div>`;
  el.classList.add('open');
  $('#again').onclick = () => { el.classList.remove('open'); newGame(); };
  if (globalThis.Opening) $('#to-title').onclick = () => { el.classList.remove('open'); newGame(); Opening.show(); };   // OP（タイトル）へもどる
}
function showLog() {
  const r = HK.score(st);
  showDialog('いまの様子', `<p>${st.enemies.map(e => `${esc(e.name)}　HP ${e.hp}/${e.maxHp}・攻撃 ${e.attack}${e.poison ? `・毒${e.poison}` : ''}`).join('<br>') || '敵はいません。'}</p>
    <p>持ち帰れば ${r.total}点（財宝 ${r.treasure.reduce((n, a) => n + a.count * a.value, 0)}・撃破 ${r.kills.reduce((n, a) => n + a.count * a.value, 0)}）</p>
    <p class="log">${st.log.map(esc).join('<br>')}</p>`, [['閉じる', cancelAll, 'primary']]);
}
function showHelp() {
  showDialog('遊び方', `<p>カードを使って地下30階を目指す。1枚使うと1ターン進み、敵が動く。</p>
    <p class="hint">矢印キー／となりのマス：1マス歩く<br>1〜5／カード：選ぶ（向きのあるカードは、光ったマスで使う）<br>もう一度押す・Enter：使う　F：1マス移動に使う　X：捨てて引き直す　Esc：やめる　M：音</p>
    <p class="hint">敵の頭の数字は残りの体力。マスに手をかざすと詳しく見られる。</p>`, [['閉じる', cancelAll, 'primary']]);
}
// 音量（BGM・効果音）：0〜10 の目盛り。押した目盛りの大きさにする。◀ ▶ で1つずつ。ブラウザに残す（js/music.js の setVolume）
function showVolume() {
  const M = globalThis.Music; if (!M) return;
  const rows = [['bgm', 'BGM'], ['se', '効果音']];
  showDialog('音量', `<div class="vol">${rows.map(([k, nm]) => `<div class="vrow" data-k="${k}"><span class="mm m">${nm}</span><button class="mm m step" data-d="-1">◀</button><span class="bar">${'<i></i>'.repeat(10)}</span><button class="mm m step" data-d="1">▶</button><b class="mm m n"></b></div>`).join('')}</div>`, [['閉じる', cancelAll, 'primary']]);
  const body = $('#dlg-body');
  const draw = () => body.querySelectorAll('.vrow').forEach(r => {
    const n = M.volume[r.dataset.k];
    r.querySelectorAll('.bar i').forEach((i, j) => i.classList.toggle('on', j < n));
    r.querySelector('.n').textContent = n;
  });
  const set = (k, n) => {
    M.setVolume({ [k]: n });
    if (k === 'se') { if (audio.sfxGain) audio.sfxGain.gain.value = 0.9 * M.volume.se / 7; sfx('pickup'); }   // 効果音は試しに鳴らす
    draw();
  };
  body.querySelectorAll('.vrow').forEach(r => {
    const k = r.dataset.k;
    r.querySelectorAll('.bar i').forEach((i, j) => { i.onclick = () => set(k, M.volume[k] === j + 1 ? j : j + 1); });   // 同じ目盛りをもう一度押すと1つ下げる（0 にできるように）
    r.querySelectorAll('.step').forEach(b => { b.onclick = () => set(k, M.volume[k] + Number(b.dataset.d)); });
  });
  draw();
}
function showMenu() {
  showDialog('メニュー', '', [
    ['遊び方', showHelp], ['いまの様子', showLog], ['音量', showVolume], [audio.muted ? '音を出す' : '音を消す', () => { setMute(!audio.muted); closeDialog(); }],
    ['はじめから', () => showDialog('はじめから？', '<p>今の探索をやめて B1F からやり直します。</p>', [['やり直す', () => { clearSave(); newGame(); saveRun(); }, 'primary'], ['やめる', cancelAll]])],
    ...(!globalThis.Opening ? [] : globalThis.Tutorial?.active
      ? [['タイトルへ', () => showDialog('タイトルへ？', '<p>練習をやめて、タイトルにもどります。</p>', [['もどる', () => { closeDialog(); Opening.show(); }, 'primary'], ['やめる', cancelAll]])]]
      : [['中断してタイトルへ', () => showDialog('中断する？', '<p>いまの探索を保存して、タイトルにもどります。<br>タイトルの「つづきから」で、ここから続けられます。</p>', [['中断する', () => { saveRun(); closeDialog(); Opening.show(); }, 'primary'], ['やめる', cancelAll]])]]),
    ['閉じる', cancelAll, 'primary'],
  ]);
}

// 左下の顔（顔グラ_20261007 の盗賊）
if (globalThis.FACE_PNG) $('#portrait').src = FACE_PNG;
// 画面の部品の小さな絵（階段・足あと・金貨・盾）
const UI_ICONS = {
  stairs: { pal: { a: '#b8c4cc', b: '#7a8e9c', c: '#0b1120' }, rows: [
    '..........aa', '..........ab', '.......aaaab', '.......abbbb', '....aaaab...', '....abbbb...', '.aaaab......', '.abbbb......', 'aab.........', 'abb.........', 'cccccccccccc', '............'] },
  foot: { pal: { a: '#b8c4cc' }, rows: ['.........', '.aa......', 'aaaa.....', 'aaaa..aa.', '.aa..aaaa', '.....aaaa', '.a....aa.', '......a..', '.........'] },
  coin: { pal: { a: '#f0b84a', b: '#ae6f47', c: '#fbf3e2' }, rows: ['.........', '..aaaaa..', '.aacaaab.', '.acaaaab.', '.aaaaaab.', '.aaaaaab.', '.aaaaabb.', '..bbbbb..', '.........'] },
  // 持ち物の袋（茶色いリュック、30×31。外周は白の1ドット。押すと所持カードの一覧）
  pack: { pal: { w: '#fbf3e2', k: '#221b17', D: '#3f2d21', d: '#5c422c', m: '#8a5a38', l: '#ae6f47', h: '#cca673', y: '#e1bc88', g: '#f0b84a' }, rows: [
    '..........wwwwwwwwww..........', '.........wkDDDDDDDDkw.........', '........wkDkkkkkkkkDkw........', '........wkDk......kDkw........', '........wkDk......kDkw........', '......wwkkDkkkkkkkkDkkww......', '.....wkkhhhhhhhhhhhlllkkw.....', '....wkhhhyyyhhDDhhhlllmmkw....', '...wkhhhyhhhhhDDhhhlllmmmkw...', '...wkhhhllllllDDllllllmmmkw...', '..wkkhhhllllllDDllllllmmmkkw..', '.wkDllllllllllDDllllllmmmdDkw.', '.wkDllllllllllDDllllllmmmdDkw.', '.wkDllllllllllDDllllllmmmdDkw.', '.wkDllllllllllDDllllllmmmdDkw.', '.wkDllllllllllDDllllllmmmdDkw.', '.wkDlDDDDDDDDDDDDDDDDDDDDdDkw.', '.wkDlldddddddggggdddddddddDkw.', '.wkDlllmmmmmmgDDgmmmmmmdddDkw.', '.wkDlllmmmmmmgDDgmmmmmmdddDkw.', '.wkDlllmmmmmmyggmmmmmmmdddDkw.', '.wkDllDDhhhhhhhhhhhhhhDDddDkw.', '.wkDllDlmmmmmmmmmmmmmmlDddDkw.', '.wkDllDlmmmmmmggmmmmmmlDddDkw.', '.wkDllDlmmmmmmggmmmmmmlDddDkw.', '.wkDllDlmmmmmmmmmmmmmmlDddDkw.', '..wkddDlmmmmmmmmmmmmmmlDddkw..', '..wkdddDDDDDDDDDDDDDDDDdddkw..', '...wkddddddddddddddddddddkw...', '....wkkkkkkkkkkkkkkkkkkkkw....', '.....wwwwwwwwwwwwwwwwwwww.....'] },
  shield: { pal: { a: '#7a8e9c', b: '#506573', c: '#b8c4cc' }, rows: ['.........', '.ccccccb.', '.caaaaab.', '.caaaaab.', '.caaaaab.', '..aaaab..', '..aaaab..', '...aab...', '....b....', '.........'] },
};
document.querySelectorAll('canvas[data-icon]').forEach(c => {
  const ic = UI_ICONS[c.dataset.icon]; if (!ic) return;
  const img = bake(ic.rows, ic.pal); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
});

// ---------------------------------------------------------------- マウス
function tileFromEvent(ev) {
  const r = cv.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * NW, y = (ev.clientY - r.top) / r.height * NH;
  const g = groundAt(x, y), tx = Math.floor(g.x) + 1, ty = Math.floor(g.z) + 1;    // 画面の点の下にある床のマス
  return tx >= 1 && tx <= 8 && ty >= 1 && ty <= 8 ? { x: tx, y: ty, cx: ev.clientX, cy: ev.clientY } : null;
}
cv.addEventListener('mousemove', ev => {
  hoverTile = tileFromEvent(ev);
  const tip = $('#tip');
  if (!hoverTile || !st) { tip.classList.remove('show'); return; }
  const { x, y } = hoverTile, en = st.enemies.find(e => e.x === x && e.y === y), it = st.groundItems.find(i => i.x === x && i.y === y);
  let html = '';
  if (en) html += `<b>${esc(en.name)}</b><br>体力 ${en.hp}/${en.maxHp}・攻撃 ${en.attack}${en.poison ? `・毒 あと${en.poison}回` : ''}`;
  if (it) html += `${html ? '<br>' : ''}<b>${esc(HK.cards[it.cardId].name)}</b><br>${esc(HK.cards[it.cardId].description)}`;
  if (!html && st.exit.x === x && st.exit.y === y) html = st.floor === 30 ? '<b>階段</b><br>ここで探索を終え、踏破の得点を記録します。' : '<b>階段</b><br>ここに止まると次の階へ。前の階には戻れない。';
  if (!html) { tip.classList.remove('show'); return; }
  const sr = $('#stage').getBoundingClientRect();
  tip.innerHTML = html; tip.classList.add('show');
  tip.style.left = `${ev.clientX - sr.left + 14}px`; tip.style.top = `${ev.clientY - sr.top + 10}px`;
});
cv.addEventListener('mouseleave', () => { hoverTile = null; $('#tip').classList.remove('show'); });
cv.addEventListener('click', ev => {
  startAudio();
  if (dialogOpen()) return;
  if (!st || st.gameStatus !== 'PLAYING') return;
  const t = tileFromEvent(ev);
  if (!t) { if (selected || targeting) cancelAll(); return; }                 // 盤の外の余白：カードの選択を外す
  if (targeting) { if (!targetClick(t.x, t.y)) cancelAll(); return; }          // 選べないマス：選択を外す
  if (!selected && !busy) { const ch = moveChoices(t.x, t.y); if (ch.length && ch[0].n >= 2) return pickMove(ch); }   // 歩ける範囲（光っているマス）。2マス先から。1マス先は下のいつもの自動移動（歩く、なければ十字キーと同じ選び方）
  const dx = t.x - st.player.x, dy = t.y - st.player.y;
  if (Math.abs(dx) + Math.abs(dy) === 1 && !busy) {
    if (selected) cancelAll();
    const d = dx === 1 ? 'd' : dx === -1 ? 'a' : dy === 1 ? 's' : 'w';
    if (st.enemies.length && !st.hand.some(c => c.cardId === 'walk') && !globalThis.Tutorial?.active) return pickForced(d);   // 敵のいる階で「歩く」がない：どれで進むか選ぶ
    autoMove(d);
  }
  else if (selected) cancelAll();                                              // 関係ないマス：選択を外す
});
// 画面のほかの関係ないところ（上の体力・山札・ログの文字・画面の外の余白など）を押しても、カードの選択を外す
const KEEP_SELECTION = '#hand .card, #cardtip, #dialog, #over, #menu-btn, #log-tab, #log-panel, #rem, #title, #result, #pack-btn, #pack';
// 押された場所は、ほかの処理より先（capture）に調べる。カードを押すと手札が描き直されて押した要素が外れるので、後からでは判定できない
document.addEventListener('click', ev => {
  if (!(selected || targeting) || busy || ev.target.closest?.(KEEP_SELECTION)) return;
  cancelAll();
}, true);

// ---------------------------------------------------------------- キーボード
const DEV = /[?&]dev\b/.test(location.search);   // 確認用のキーを使う（3D版.html?dev）
document.addEventListener('keydown', ev => {
  if ($('#title').classList.contains('open')) { if (!ev.repeat) startGameFromTitle(); ev.preventDefault(); return; }
  startAudio();
  if (ev.key === 'm' || ev.key === 'M') { setMute(!audio.muted); return; }
  // 確認用のキー（B・G・T・U・E・Shift＋1〜5）は、URL に ?dev を付けたときだけ（2026-10-10 リリース用に外した）
  if (DEV && (ev.key === 'b' || ev.key === 'B')) { setFlat(!flatMode); return; }
  if (DEV && (ev.key === 'g' || ev.key === 'G')) {          // 確認用：背景のゾーンを順に見る（階は変わらない）
    const Z = globalThis.BG_ZONES || []; bgPreview = Z[(Z.indexOf(bgZone.z) + 1) % Z.length]; buildBackground(); say(`背景：${bgPreview.name}`); return;
  }
  if (ev.key === 'l' || ev.key === 'L') { toggleLog(); return; }
  if (DEV && (ev.key === 't' || ev.key === 'T')) { toggleFontCmp(); return; }
  if (DEV && (ev.key === 'u' || ev.key === 'U')) { previewBigCloseup(); return; }
  if (DEV && (ev.key === 'e' || ev.key === 'E') && !busy && !globalThis.Ending?.active) { previewEnding(); return; }   // クリア演出の確かめ（見本の撃破と財宝で）
  if (DEV && ev.shiftKey && /^Digit[1-5]$/.test(ev.code)) {        // 確認用：Shift＋1〜5 … そのカードを使ったときの行き先の演出だけ見る（ルールは動かない）
    const b = document.querySelectorAll('#hand .card')[Number(ev.code.slice(5)) - 1], c = b && st.hand.find(h => h.id === Number(b.dataset.id));
    if (c) {
      const how = cardFate(c, 'effect', false) || 'burn', k = HK.cardOf(c);
      const demo = [k.heal && { text: `HP＋${k.heal}`, kind: 'hp' }, k.maxHpGain && { text: `最大HP＋${k.maxHpGain}`, kind: 'hp' }, k.block && { text: `防御＋${k.block}`, kind: 'blk' }].filter(Boolean);
      playCardFx(how, c, cardBox(b), 0, how === 'burn' ? [] : demo.length ? demo : [{ text: '（効果の例）', kind: 'etc' }]);
    }
    return;
  }
  if (ev.key === 'Escape' && logOpen()) { toggleLog(false); return; }
  if (packOpen()) { if (ev.key === 'Escape' || ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); hidePack(); } return; }   // 持ち物を開いている間は、ほかの操作をしない
  if (!st || st.gameStatus !== 'PLAYING') { if (ev.key === 'Enter' && $('#result').classList.contains('open')) $('#again').click(); return; }
  if (dialogOpen()) {
    if (ev.key === 'Escape') cancelAll();
    if (ev.key === 'Enter') { ev.preventDefault(); $('#dlg-actions .primary')?.click(); }
    return;
  }
  const d = { ArrowUp: 'w', ArrowLeft: 'a', ArrowDown: 's', ArrowRight: 'd', w: 'w', a: 'a', s: 's', d: 'd' }[ev.key];
  if (d) {
    ev.preventDefault();
    if (busy) { if (!ev.repeat && !targeting) { queued = () => autoMove(d); speed = Math.max(baseSpeed, 2.4); } return; }
    if (targeting) return targetKey(d);
    const s1 = selected && st.hand.find(c => c.id === selected);
    if (s1 && directional(HK.cardOf(s1))) { startTargeting(s1, 'effect'); hideCardTip(); renderHand(); return targetKey(d); }
    if (selected) cancelAll();
    return autoMove(d);
  }
  if (/^[1-5]$/.test(ev.key)) { const c = st.hand[Number(ev.key) - 1]; if (c) selectCard(c.id); return; }
  if (ev.key === 'Escape') return cancelAll();
  const sel = selected && st.hand.find(c => c.id === selected);
  if ((ev.key === 'f' || ev.key === 'F') && sel && !busy) { startTargeting(sel, 'forced'); hideCardTip(); renderHand(); return; }
  if ((ev.key === 'x' || ev.key === 'X') && sel && !busy) return perform('discard', sel.id);
  if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault();
    if (targeting && targeting.dir) return targetConfirm();
    if (sel && !targeting && HK.cardOf(sel).type !== '財宝') return useCard(sel);
  }
});

// ---------------------------------------------------------------- 大きさ
function fit() {
  const s = Math.min(innerWidth / NW, innerHeight / NH), u = s >= 2 ? Math.floor(s) : s;
  const stage = $('#stage');
  stage.style.width = `${NW * u}px`; stage.style.height = `${NH * u}px`;
  document.documentElement.style.setProperty('--u', `${u}px`);
  // マルモニカの文字の大きさ：目安の大きさ（u）にいちばん近い 16px の整数倍。縁取りは書体の1ドット
  // w（OP のメニューと窓）だけは大きい方へ少し寄せる（bias）：画面の倍率が 2 をわずかに下回ったとき（1.97 など）に 32px→16px と半分にならないように
  // 刻みは「画面の実際の画素」で 16 の倍数（書体のドットがにじまない）。スマホ（devicePixelRatio 2〜3）は CSS の px で 16/2・16/3 きざみに細かくなり、
  // 横持ちの小さな画面でも字が大きくなりすぎない（2026-10-10。前は CSS の 16px が最小で、目安の倍近くになっていた）。パソコン（倍率 2 未満）は前と同じ
  const f = Math.max(1, Math.floor(globalThis.devicePixelRatio || 1)), U16 = 16 / f;
  const snap = (px, bias = 0) => U16 * Math.max(1, Math.round(px / U16 + bias));
  for (const [k, want] of Object.entries({ h: 24, xl: 17, t: 15, w: 12, l: 9, m: 7, s: 6 })) {   // w：OP の窓とメニューの大きめの字
    const px = snap(want * u, k === 'w' ? 0.2 : 0);
    document.documentElement.style.setProperty(`--fs-${k}`, `${px}px`); document.documentElement.style.setProperty(`--o-${k}`, `${px / 16}px`);
  }
  // 効果の数値だけは l と t のあいだの大きさ（8px きざみ。書体の1ドットが 1.5px などになり、窓の大きさによってはドットの太さが少し不ぞろいになる）
  { const px = U16 / 2 * Math.max(2, Math.round(12 * u / (U16 / 2))); document.documentElement.style.setProperty('--fs-g', `${px}px`); document.documentElement.style.setProperty('--o-g', `${px / 16}px`); }
  // チュートリアルの吹き出しの字（11u の目安。同じく 8px きざみ。u＝2 のときだけ 24px で書体のドットが 1.5px になる）
  { const px = U16 / 2 * Math.max(2, Math.round(11 * u / (U16 / 2))); document.documentElement.style.setProperty('--fs-b', `${px}px`); document.documentElement.style.setProperty('--o-b', `${px / 16}px`); }
}
addEventListener('resize', fit);

// ---------------------------------------------------------------- はじめる
let runStart = performance.now();   // プレイ時間（クリア演出のランキング）
// ---- 中断とつづきから（2026-10-09）：いまの探索をこのブラウザに保存する（localStorage の honekko.save.v1）
// 1手ごと・階を降りたときに保存（チュートリアル中はしない）。ゲームオーバー・帰還・踏破と、「はじめから」で消す
// 保存するのは logic の状態まるごと（乱数の関数だけは保存できないので、再開のときに Math.random をつなぐ＝原作の再開と同じ）と、見た目・プレイ時間
const SAVE_KEY = 'honekko.save.v1';
function saveRun() {
  if (!st || st.gameStatus !== 'PLAYING' || globalThis.Tutorial?.active) return;
  try {
    const { rng, ...state } = st; void rng;
    localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, state, look: globalThis.HK_PLAYER?.look || null, ms: Math.round(performance.now() - runStart), savedAt: Date.now(), locked: [...lockedCards] }));
  } catch { /* 保存できないとき（プライベートウィンドウなど）は、つづきからなし */ }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* なし */ } }
function readSave() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY)), s = d && d.state;
    const ok = d && d.version === 1 && s && s.gameStatus === 'PLAYING' && Array.isArray(s.map) && s.map.length === 10 && s.player && s.exit
      && Array.isArray(s.hand) && Array.isArray(s.drawPile) && Array.isArray(s.discardPile) && Array.isArray(s.enemies) && Number.isInteger(s.floor);
    return ok ? d : null;
  } catch { return null; }
}
function resumeRun() {
  const d = readSave(); if (!d) return false;
  applyLook(d.look);
  newGame();                                       // 演出・ログ・選択を片付けてから、保存した状態に差し替える
  st = { ...d.state, rng: Math.random }; runStart = performance.now() - (d.ms || 0);
  for (const id of d.locked || []) lockedCards.add(id);
  globalThis.Music?.floor(st.floor);
  buildBackground(); syncView(true); renderStatus(); $('#hand').innerHTML = ''; animateHand({ hand: [], drawN: 99, discN: 0 });
  view.banner = { text: `B${st.floor}F`, t0: clock, ms: 1400 };
  return true;
}
function newGame() {
  globalThis.Tutorial?.stop();
  st = HK.newRun(); runStart = performance.now(); lockedCards.clear();
  globalThis.Music?.floor(st.floor);
  logHistory.length = 0; if (logOpen()) renderLogPanel();
  targeting = null; selected = null; queued = null; busy = false;
  view.fx = []; view.nums = []; view.marks = [];
  buildBackground(); syncView(true); renderStatus(); $('#hand').innerHTML = ''; closeDialog(); hideCardTip();
  animateHand({ hand: [], drawN: 99, discN: 0 });
  $('#result').classList.remove('open');
  view.banner = { text: 'B1F', t0: clock, ms: 1400 };
}
function startGameFromTitle() {
  startAudio();
  $('#title').classList.remove('open');
}
$('#log-tab').onclick = () => { startAudio(); toggleLog(); };
// 除外の束を押すと、除外したカードを文字の一覧で（同じカードはまとめる。居場所の一覧ではないので、デッキのリボルバーには入れない）
$('#rem').onclick = () => {
  startAudio();
  const count = new Map();
  for (const c of st.removedCards) { const n = HK.cardOf(c).name; count.set(n, (count.get(n) || 0) + 1); }
  const list = [...count].map(([n, k]) => `${esc(n)}${k > 1 ? `　×${k}` : ''}`).join('<br>');
  showDialog('除外したカード', `<p>${list || 'まだありません。'}</p><p class="hint">除外したカードはデッキに戻りません。</p>`, [['閉じる', cancelAll, 'primary']]);
};
$('#menu-btn').onclick = () => { startAudio(); dialogOpen() ? cancelAll() : showMenu(); };
// 持ち物（右の袋）：画面全体に暗い乗算を敷いて、いま持っているカード（手札・山札・捨て札）を小さく並べる。手札は金の縁。
// 種類ごと（移動・攻撃・防御・食料…）に並べ、手をかざすと下に名前と説明。どこかを押すか Esc で閉じる（2026-10-09 テストプレイ。リボルバーはやめた）
const PACK_ORDER = ['移動', '攻撃', '防御', '食料', 'ポーション', '護符', '消耗品', '探索', '財宝'];
function showPack() {
  if (!st) return;
  cancelAll();
  const where = [['hand', '手札'], ['drawPile', '山札'], ['discardPile', '捨て札']];
  const all = where.flatMap(([k, nm]) => st[k].map(c => ({ c, nm, hand: k === 'hand' })));
  all.sort((a, b) => {
    const A = HK.cardOf(a.c), B = HK.cardOf(b.c);
    return (PACK_ORDER.indexOf(A.type) - PACK_ORDER.indexOf(B.type)) || A.name.localeCompare(B.name, 'ja') || (a.hand ? -1 : b.hand ? 1 : 0);
  });
  const el = $('#pack'), grid = el.querySelector('.grid'), info = el.querySelector('.info');
  el.querySelector('.hd').textContent = `持ち物　${all.length}枚`;
  grid.innerHTML = '';
  for (const { c, nm, hand } of all) {
    const k = HK.cardOf(c), b = document.createElement('div');
    b.className = `mini k-${KIND_CLASS[k.type] || 'misc'}` + (hand ? ' hand' : '');
    b.innerHTML = `<span class="band"></span><span class="pips">${pipsHtml(cardNumber(c))}</span>`;
    b.querySelector('.band').after(iconCanvas(c.cardId));
    b.onmouseenter = () => { info.innerHTML = `<b>${esc(k.name)}</b><small>（${nm}）</small>　${esc(k.description)}`; };
    grid.appendChild(b);
  }
  info.textContent = '';
  el.classList.add('open'); sfx('card_pick');
}
const packOpen = () => $('#pack').classList.contains('open');
function hidePack() { $('#pack').classList.remove('open'); }
$('#pack-btn').onclick = () => { startAudio(); packOpen() ? hidePack() : showPack(); };
$('#pack').onclick = hidePack;
$('#title').onclick = startGameFromTitle;

let last = performance.now();
function tick(now) {
  const dt = Math.min(50, now - last); last = now;
  if (now >= hitstopUntil) clock += dt * speed;
  for (let i = waiters.length - 1; i >= 0; i--) if (clock >= waiters[i].at) { const w = waiters.splice(i, 1)[0]; w.res(); }
  stepTwk();
  if (st) { draw(now); placeBubble(now); drawHpFx(now); drawCardFx(now); }
  handEl.classList.toggle('aiming', !!targeting && !busy);   // マスを選んでいる間は、手札を沈めて盤のいちばん下の段をクリックできるようにする
}
function frame(now) { tick(now); requestAnimationFrame(frame); }
// チュートリアルの左下の顔（教える役）：東国人・黒髪のセンターパート・眼鏡・イエロージャンパー（2026-10-09 ユーザー指定）。おたからを持っていなくても、この顔は固定
const TUTOR_LOOK = { nation: '東国人', style: 'センターパート', iris: '茶', hood: false, acc: [{ name: '眼鏡' }], outfit: 'イエロージャンパー' };
function applyLook(look) {
  const fl = globalThis.Otakara ? Otakara.faceLook(look) : look;   // おたから（look.ota）を顔グラの部品・髪に当てた見た目
  if (fl) { globalThis.FaceAnim?.setLook(fl); setPlayerHair(fl.hair || fl.nation || null); }
  globalThis.HK_PLAYER = look ? { nation: look.nation, look: { ...look } } : null;   // ランキングのキャラアイコンなどで使う予定
}
// チュートリアル（js/tutorial.js）：練習の盤を組む・やめてタイトルへ
globalThis.Tutorial?.init({
  get st() { return st; }, say, startAudio,
  start(build, label) {
    newGame(); build(st);
    buildBackground(); syncView(true); renderStatus(); $('#hand').innerHTML = ''; animateHand({ hand: [], drawN: 99, discN: 0 });
    view.banner = { text: label, t0: clock, ms: 1400 };
  },
  quit() { newGame(); if (globalThis.Opening) Opening.show(); },
});
fit(); setFlat(true); newGame();
document.getElementById('loading')?.remove();
// OP（js/opening.js）：タイトル → 種族えらび → キャラメイク。終わったら見た目を当てて B1F から始める
if (globalThis.Opening) Opening.init({
  spr, PGROUP, hairSwap, startAudio, ground: SPR.groups[PGROUP].ground ?? 40,
  begin(look, keepSave = false) {                // keepSave：?skipop で開いたとき（つづきからの保存は消さない）
    startAudio(); applyLook(look);
    if (!keepSave) clearSave();
    newGame();
    if (!keepSave) saveRun();
  },
  saveInfo() { const d = readSave(); return d && { floor: d.state.floor, turn: d.state.turn, savedAt: d.savedAt }; },   // つづきからの中身（なければ null）
  resume() { startAudio(); return resumeRun(); },
  tutorial(look) {                      // メニューの「遊び方」：盤のキャラは前にキャラメイクした見た目、左下の顔は教える役のキャラ
    startAudio(); applyLook(look);
    globalThis.FaceAnim?.setLook(TUTOR_LOOK);
    globalThis.Tutorial?.start();
  },
  playerFoot() { return { x: footX(st.player.x), y: footY(st.player.y) }; },   // 主人公の最初の足もと（ゲーム画面 480×270 の座標）
  replayIntro() {                       // OP が消えたところで、階の表示と手札を配る演出をもう一度（OP の裏で一度流れているため）
    view.banner = { text: `B${st.floor}F`, t0: clock, ms: 1400 };
    $('#hand').innerHTML = ''; animateHand({ hand: [], drawN: 99, discN: 0 });
  },
});
else $('#title').classList.add('open');
requestAnimationFrame(frame);
function previewEnding(status = 'CLEARED') {   // クリア演出の確かめ（いまの状態に、撃破と財宝を足した見本で）
  const s = { ...st, gameStatus: status, kills: { rat: 6, goblin: 4, orc: 3, 'depth-4': 2, 'depth-5': 2, 'depth-8': 1, 'depth-11': 1 },
    drawPile: [...st.drawPile, ...['gem', 'gem', 'gold', 'gold', 'gold', 'copper', 'crown'].map((cardId, i) => ({ cardId, id: 90000 + i }))] };
  playEnding({ ...endingData(s), preview: true });   // 見本なので、ランキングには記録しない（ending.js）
}
globalThis.__demo = { get st() { return st; }, startAudio, previewEnding, setPlayerHair, HAIR_PRESETS, makeFrame, ANIM_SETS, bgZone, tickBackground, get busy() { return busy; }, view, camS, say, hpHitFx, previewBigCloseup, dofMat, playCardFx, cardFate, cardFxList, perform, autoMove, selectCard, newGame, setFlat, step: () => tick(performance.now()), setSpeed(v) { baseSpeed = speed = v; }, resync() { buildBackground(); syncView(true); renderUI(); } };
};
})();
