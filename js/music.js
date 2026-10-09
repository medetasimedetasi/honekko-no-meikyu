// ほねっこの迷宮 — 曲とジングル（音楽ジャンルのセッションが決めた曲。音楽案_20261006/採用）
// 曲の中身は audio/<名前>.js（制作/音をゲームへ.py が書き出す base64）。必要になったときに <script> で読み込む（file:// でも読めるように）。
// game3d.js の startAudio が Music.attach(ctx, 出口) を呼び、あとは場面ごとに次を呼ぶ：
//   Music.floor(n)      その階の曲（B1〜10F・B11〜20F・B21〜24F・B25〜30F）。同じ曲ならそのまま流し続ける
//   Music.title()       タイトル〜キャラメイクの曲（バグパイプ）
//   Music.jingle(name)  'return'（帰還）・'gameover'・'ending'（エンディングの曲、ループしない）・'tetteree'（最終スコア）。
//                       'tetteree' 以外は曲を止めてから1回鳴らす
//   Music.se(name)      効果音を鳴らして true。ファイルがなければ false（呼んだ側は仮の合成音のまま）。
//                       効果音は audio/se.js（音楽案_20261006/採用/仮/効果音）。ほかに 'stairs'（ST3）
//   Music.seLoop(name)  くり返す効果音（'tally_roll'・'coins_pour'）。返り値の stop() で止める
//   Music.stop()        曲を止める
//   Music.volume        音量の段階 { bgm, se }（0〜10、ふつうは7）。Music.setVolume({ bgm, se }) で変えてブラウザに残す
//                       曲（迷宮・タイトル・ジングル）と効果音は、それぞれの出口（bus）を通る
(() => {
'use strict';
const FLOOR_TRACKS = [[10, 'b1'], [20, 'b11'], [24, 'b21'], [Infinity, 'b25']];   // B25F で替えるのは、ミノタウロス（攻撃11）が出始めて初期HPを一撃で超える階だから
const VOL = { bgm: 0.32, jingle: 0.4, se: 0.8 };   // 2026-10-09 テストプレイ：BGM を小さく（0.5→0.4→0.32、ジングル 0.6→0.5→0.4）。危険時の曲はやめた（削除）
// UI の音のほかは、全体にもう一段小さく（2026-10-09 テストプレイ。攻撃の音も、2回目の直しでほかと同じく下げた）
const SE_LOUD = new Set(['ui_start', 'ui_cursor', 'ui_decide', 'ui_cancel']);
const SE_QUIET = 0.7;
const seVol = k => VOL.se * (SE_GAIN[k] ?? 1) * (SE_LOUD.has(k) ? 1 : SE_QUIET);
// 音量の段階（設定）：0〜10、ふつう7。7 のとき今の音量、10 で約1.4倍
const VOL_KEY = 'honekko.volume', VOL_STD = 7;
let level = { bgm: VOL_STD, se: VOL_STD };
try { Object.assign(level, JSON.parse(localStorage.getItem(VOL_KEY)) || {}); } catch { /* 保存なし */ }
let busBgm = null, busSe = null;
const levelGain = n => Math.max(0, Math.min(10, n)) / VOL_STD;
// sfx の名前 → 効果音のファイル（配列はその中から毎回1つをえらぶ）
const SE_ALIAS = { swing: 'swing_sword', card: 'card_pick', step: 'step_3', estep: ['estep_1', 'estep_2', 'estep_3'] };   // 主人公の足音は C だけ（ユーザー指定）
// 効果音ごとの音量の倍率（ファイルが小さすぎるもの）。足音はファイル側で +7dB 上げてもらったので、今はなし
// 効果音ごとの音量（1＝そのまま）。手札の音とカードを使った音は大きすぎたので下げる（2026-10-09 テストプレイ）
// 2回目の直し：攻撃・ダメージの音、デッキの動き（配る・捨てる・切る・選ぶ）をさらに下げた
const SE_GAIN = {
  swing_sword: 0.42, thrust_spear: 0.6,
  shoot: 0.6, hit: 0.3,   // hit＝敵に当たった音（いちばん大きいファイル。6回目の直しで 0.6→0.3）
  hurt: 0.55, die: 0.55, block: 0.55,   // 3回目の直しでさらに下げた
  card_pick: 0.3, card_deal: 0.3, card_discard: 0.3, card_shuffle: 0.3,
  step_1: 0.55, step_2: 0.55, step_3: 0.55, estep_1: 0.55, estep_2: 0.55, estep_3: 0.55,   // 足音（主人公・敵）。4回目の直し
  eat_food: 0.55, potion_fizz: 0.55, scroll_burn: 0.55, armor_on: 0.55, shield_clang: 0.6, heal: 0.7,
};
const seBufs = new Map();   // 効果音の名前 → AudioBuffer（起動時にまとめて広げる）
const FADE = 0.9;                       // 曲の切り替えの長さ（秒）
let jingleSeq = 0;
let ctx = null, out = null, want = null, playing = new Map();   // playing: 名前 → { src, gain }
const buffers = new Map(), loading = new Map();
// 鳴っている1回きりの曲（ジングル・エンディングの曲）。ほかの曲へ切り替えるときに止める
// （止めないと、エンディングを飛ばしてタイトルにもどったときに、110秒のエンディングの曲とタイトルの曲が重なる）
const jingles = new Set();
function stopJingles() {
  for (const j of jingles) { const t = ctx.currentTime; j.gain.gain.cancelScheduledValues(t); j.gain.gain.setValueAtTime(j.gain.gain.value, t); j.gain.gain.linearRampToValueAtTime(0, t + 0.4); try { j.src.stop(t + 0.45); } catch {} }
  jingles.clear();
}

function loadScript(key) {               // audio/<key>.js を読み込む（HK_AUDIO[key] に base64 が入る）
  if (globalThis.HK_AUDIO?.[key]) return Promise.resolve();
  if (!loading.has(key)) loading.set(key, new Promise(res => {
    const s = document.createElement('script'); s.src = `audio/${key}.js`; s.onload = res; s.onerror = res; document.head.appendChild(s);
  }));
  return loading.get(key);
}
async function buffer(key) {
  if (buffers.has(key)) return buffers.get(key);
  await loadScript(key);
  const a = globalThis.HK_AUDIO?.[key]; if (!a || !ctx) return null;
  if (!buffers.has(key)) {
    const bin = atob(a.data), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    buffers.set(key, ctx.decodeAudioData(u.buffer).then(b => ({ b, loopStart: a.loopStart, loopEnd: a.loopEnd })).catch(() => null));
    delete a.data;                       // 広げたら base64 は捨てる
  }
  return buffers.get(key);
}
function fadeTo(g, v) { const t = ctx.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(v, t + FADE); }
async function start(key, vol) {         // ループ曲を鳴らし始める（もう鳴っていれば音量だけ戻す）
  if (playing.has(key)) { fadeTo(playing.get(key).gain, vol); return; }
  const buf = await buffer(key); if (!buf || playing.has(key)) return;
  const src = ctx.createBufferSource(), gain = ctx.createGain();
  src.buffer = buf.b;
  if (buf.loopEnd) { src.loop = true; src.loopStart = buf.loopStart; src.loopEnd = buf.loopEnd; }
  gain.gain.value = 0; src.connect(gain); gain.connect(out); src.start();
  playing.set(key, { src, gain });
  apply();                               // 読み込みのあいだに場面が変わっていても、今の場面に合わせる
}
function stopKey(key) {
  const p = playing.get(key); if (!p) return;
  playing.delete(key); fadeTo(p.gain, 0);
  try { p.src.stop(ctx.currentTime + FADE + 0.05); } catch {}
}
// 今の場面（want＝流したい曲）に合わせて、各曲の音量をそろえる
function apply() {
  if (!ctx) return;
  for (const [key, p] of playing) {
    if (key === want) fadeTo(p.gain, VOL.bgm);
    else stopKey(key);
  }
  if (want && !playing.has(want)) start(want, VOL.bgm);
}
const trackFor = n => FLOOR_TRACKS.find(([to]) => n <= to)[1];

globalThis.Music = {
  attach(c, dest) {
    ctx = c;
    busBgm = ctx.createGain(); busBgm.gain.value = levelGain(level.bgm); busBgm.connect(dest);
    busSe = ctx.createGain(); busSe.gain.value = levelGain(level.se); busSe.connect(dest);
    out = busBgm; apply();
    for (const k of ['b1', 'stairs']) buffer(k);   // よく使う分は先に読んでおく
    loadScript('se').then(() => {                  // 効果音はまとめて広げる
      for (const [k, v] of Object.entries(globalThis.HK_SE || {})) {
        const bin = atob(v.data), u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        ctx.decodeAudioData(u.buffer).then(b => seBufs.set(k, b)).catch(() => {});
        delete v.data;
      }
    });
  },
  floor(n) {
    const key = trackFor(n); if (ctx) stopJingles(); want = key; apply();
    const next = FLOOR_TRACKS[FLOOR_TRACKS.findIndex(([, k]) => k === key) + 1];
    if (next) loadScript(next[1]);       // 次の帯の曲は先に読み込んでおく
  },
  title() { if (ctx) stopJingles(); want = 'title'; apply(); },
  stop() { if (ctx) stopJingles(); want = null; apply(); },
  async jingle(name) {
    if (name !== 'tetteree') { if (ctx) stopJingles(); want = null; apply(); }   // テッテレーはエンディングの曲に重ねる
    const asked = name === 'tetteree' ? 0 : ++jingleSeq;
    const buf = await buffer(name); if (!buf || !ctx) return;
    if (name !== 'tetteree' && (asked !== jingleSeq || want)) return;   // 読み込みのあいだに別の曲へ切り替わっていたら鳴らさない
    const src = ctx.createBufferSource(), gain = ctx.createGain(); gain.gain.value = VOL.jingle;
    src.buffer = buf.b; if (buf.loopEnd) { src.loop = true; src.loopStart = buf.loopStart; src.loopEnd = buf.loopEnd; }   // ループの区切りがあれば（エンディングの曲）ほかの曲へ切り替わるまでくり返す
    src.connect(gain); gain.connect(out); src.start(ctx.currentTime + 0.3);
    const j = { src, gain }; jingles.add(j); src.onended = () => jingles.delete(j);
  },
  se(name) {
    if (!ctx) return false;
    let k = SE_ALIAS[name] || name; if (Array.isArray(k)) k = k[Math.floor(Math.random() * k.length)];
    const b = seBufs.get(k);
    if (b) { const src = ctx.createBufferSource(), gain = ctx.createGain(); gain.gain.value = seVol(k); src.buffer = b; src.connect(gain); gain.connect(busSe); src.start(); return true; }
    const p = buffers.get(name); if (!p) { if (name === 'stairs') buffer(name); return false; }
    p.then(buf => { if (!buf) return; const src = ctx.createBufferSource(), gain = ctx.createGain(); gain.gain.value = seVol(k); src.buffer = buf.b; src.connect(gain); gain.connect(busSe); src.start(); });
    return true;
  },
  seLoop(name) {
    const b = ctx && seBufs.get(name); if (!b) return { stop() {} };
    const src = ctx.createBufferSource(), gain = ctx.createGain(); gain.gain.value = seVol(name); src.buffer = b; src.loop = true; src.connect(gain); gain.connect(busSe); src.start();
    return { stop() { const t = ctx.currentTime; gain.gain.setTargetAtTime(0, t, 0.03); try { src.stop(t + 0.2); } catch {} } };
  },
  get volume() { return { ...level }; },
  setVolume(v) {
    Object.assign(level, v);
    for (const k of ['bgm', 'se']) level[k] = Math.max(0, Math.min(10, Math.round(level[k])));
    try { localStorage.setItem(VOL_KEY, JSON.stringify(level)); } catch { /* 保存なし */ }
    if (busBgm) busBgm.gain.setTargetAtTime(levelGain(level.bgm), ctx.currentTime, 0.03);
    if (busSe) busSe.gain.setTargetAtTime(levelGain(level.se), ctx.currentTime, 0.03);
  },
  get state() { return { want, playing: [...playing.keys()], jingles: jingles.size, level: { ...level } }; },
};
})();
