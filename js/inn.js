// ほねっこの迷宮 — 宿屋（猫の育成）。2026-10-20 猫育成グラフィックのセッションの見本（猫の育成_20261018/モーション/食べる見本.html、
// 作り方は 食べる見本を作る.py）を本編へ移したもの。絵と数は js/cat_room_data.js（猫の育成_20261018/ゲーム用/ から写す。手で直さない）。
// 決まりごとの全部は 猫の育成_20261018/はじめに読む.md と 引継ぎ_猫の育成を3D版へ_20261020.md。
//   入り口：OP の左下の「宿屋」（js/opening.js）。ダンジョンでダンディ・キャットを倒し、敗北・帰還・踏破のどれかで戻ると開く（game3d.js の showResult）
//   所持金：1と2の帰還・踏破で記録されたスコアの合計（累計ハイスコア）から、ご飯に使った額を引いたもの。ランキングの点は減らさない
//   育つ：おなかいっぱい かつ ♡満タン（なでる5回）で出撃し（どちらのゲームでも）、敗北・帰還・踏破で戻ると1つ進む。進んだらおなかと♡は空に。
//         そろわないまま出撃したときは、おなか・♡はそのまま残す。ダンジョンのクリアによる上限はなし（2026-10-20 ユーザー指定）
//   段階：赤ちゃん→子猫→成猫→デブ猫→妖怪猫（各1回）→ ダンディ ×3（1回）・×4（1回）・×5（2回）・×6（2回）・×7（3回）。ダンディは妖怪猫を大きく出す（×7 で画面いっぱい）
//   おでかけ（2026-10-20 ユーザー指定）：子猫から「おでかけ」ボタン。押すと暗転・階段の音・「猫はでかけたようだ……。」→ 猫のいない部屋（ご飯・なでるはできない）。
//         プレイヤーが出撃して戻ると帰ってくる。帰ってきたとき、CD_RATE でまだ持っていない曲の CD を1枚拾ってくる（次に宿屋を開いたときに知らせる）
//   音楽プレイヤー：CD を1枚でも拾うと、小さな机の上に蓄音機が出る。蓄音機を押すと開き、拾った曲を聴ける（Music.play）。曲名はユーザー指定（CDS）
//   コレクションケース：部屋の棚（窓の下の右の床置きのガラス戸の棚。SHELF）を押すと、全部のおたからを並べる。まだのものはシルエットと「？？？？」
//   棚の背景と蓄音機の絵は猫育成グラフィックのセッション（CAT_ROOM_DATA.bg・gram・places）。CD のアイコンは背景グラフィックのセッションの手打ち（CD_ROWS、全曲共通）
//   Inn.open(onClose) / Inn.active / Inn.unlocked() / Inn.unlock() / Inn.earn(score) / Inn.depart()（出撃）/ Inn.returned()（戻った）
(() => {
'use strict';
const D = globalThis.CAT_ROOM_DATA;
const KEY = 'honekko.cat.v1', OPEN_KEY = 'honekko.inn.v1', LOVE_MAX = 5;
const NEED = [1, 1, 1, 1, 1, 1, 2, 2, 3], LV_MAX = NEED.length;   // lv：0〜4＝段階、5〜9＝ダンディ ×3〜×7。NEED[lv]＝次へ進むのに要る「育つ出撃」の回数
const stageOf = lv => Math.min(4, lv), scaleOf = lv => (lv < 5 ? 2 : lv - 2);
const fresh = () => ({ lv: 0, prog: 0, full: 0, love: 0, earned: 0, spent: 0, armed: false, out: false, cds: [], news: null });
let S = fresh();
try { S = { ...fresh(), ...JSON.parse(localStorage.getItem(KEY)) }; } catch { /* 記録なし */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* 保存できないときは閉じるまで */ } };
const capOf = lv => D.stages[stageOf(lv)].cap;
const ready2grow = () => S.full >= capOf(S.lv) && S.love >= LOVE_MAX;
const money = () => Math.max(0, S.earned - S.spent);
const se = n => globalThis.Music?.se(n);
// CD：ステージ・OP・エンディングの13曲（曲名はユーザー指定 2026-10-20）。key は audio/<key>.js
const CDS = [['title', 'ほねっこ楽団'], ['b1', '冒険のはじまり'], ['b11', '抜き足差し足忍び足'], ['b21', '暗い洞窟のパヴァーヌ'], ['b25', 'ヴィオールの舞踏'],
  ['c31', 'きのこの森のカノン'], ['c40', 'ほねっこの迷宮'], ['c50', '死の舞踏のはじまり'], ['c59', '死の舞踏'], ['c60', 'カウントダウン'],
  ['ending', '次なる冒険へ'], ['ending_escape', '青いそら'], ['ending_gs', '彼／彼女の姿を見たモノはいない']];
const CD_RATE = 0.5;   // おでかけから帰ったとき CD を拾ってくる割合（仮）
const CD_ROWS = [      // CD のアイコン（18×18、全曲共通。手打ち）
  '......KKKKKK......', '....KKwwssssKK....', '...KwwwsssssssK...', '..KpwwwsssssssmK..', '.KypwwwssssssssmK.', '.KsypwwwsssssssmK.',
  'KssypwccccccssssmK', 'KsssypcKKKKcsssmmK', 'KssssycK..KcssmmmK', 'KssssscK..KcpymmmK', 'KssssscKKKKcwpymmK', 'KsssssccccccwwpymK',
  '.KsssssssswwwpymK.', '.KsssssssmmwwwpmK.', '..KmssssssmmwwmK..', '...KmmmmmmmmmmK...', '....KKmmmmmmKK....', '......KKKKKK......'];
const CD_PAL = { K: '#221b17', s: '#b8c4cc', m: '#7a8e9c', w: '#fbf3e2', p: '#e7a08a', y: '#f0b84a', c: '#506573' };
function cdCanvas(shadow = false) {   // shadow：まだ拾っていない CD（影）
  const c = document.createElement('canvas'); c.width = c.height = 18; const x = c.getContext('2d');
  CD_ROWS.forEach((r, y) => [...r].forEach((ch, xx) => { if (ch === '.') return; x.fillStyle = shadow ? (ch === 'K' ? '#18222d' : '#2c3a48') : CD_PAL[ch]; x.fillRect(xx, y, 1, 1); }));
  return c;
}
// 押せる所（背景のドット → 画面は3倍）：棚（コレクションケース）と蓄音機（音楽プレイヤー、CD を拾うまで出さない）
const PL = D?.places || {}, SH = PL.shelf || { x0: 161, y0: 53, x1: 205, y1: 96 }, GR = PL.gramophone || { x: 127, y: 52, w: 15, h: 17 };
const SHELF = { x: SH.x0 * 3, y: SH.y0 * 3, w: (SH.x1 - SH.x0 + 1) * 3, h: (SH.y1 - SH.y0 + 1) * 3 };
const GRAM = { x: GR.x * 3, y: GR.y * 3, w: GR.w * 3, h: GR.h * 3 };

// ---------------------------------------------------------------- 部屋の絵（見本の loop をそのまま移した。表示は 背景3：猫2：ご飯1、ダンディは猫を ×3〜×7）
const BG = 3, BED = { y: (74 + 5) * 3, x: 240 }, BED_RATE = 0.15;
const SLEEP_BREATH_MS = 1400, MS = { 立つ: 1000, 歩く: 140, 眠る: 400, 遊ぶ: 160, 毛づくろい: 200, 伸び: 250 };
const XMIN = 120, XMAX = 560, STEP_MS = 70;
const NO_ACT = { 3: ['歩く', '遊ぶ'], 4: ['歩く', '遊ぶ'] };   // デブ猫・妖怪猫は歩かない・遊ばない
const GAUGE = { x: 16, y: 64, w: 150, h: 10 }, HEART = { s: 3, x: 657 - 16 - 15 * 3, y: 10 };
const BITES = [[0, 36, 6, 9], [0, 40, 24, 8], [1, 30, 44, 10], [1, 10, 14, 9], [2, 18, 32, 13], [2, 6, 52, 11], [2, 34, 56, 9]];
const JIGGLE = [[-2, 2], [2, -1], [-1, 1], [1, 0], [0, 0]], JIG_MS = 60;
const HEART_DOTS = [
  '..bbb.....bbb..', '.bxxxb...bxxxb.', 'bxxxxxb.bxxxxxb', 'bxxxxxxbxxxxxxb', 'bxxxxxxxxxxxxxb', 'bxxxxxxxxxxxxxb', '.bxxxxxxxxxxxb.',
  '..bxxxxxxxxxb..', '...bxxxxxxxb...', '....bxxxxxb....', '.....bxxxb.....', '......bxb......', '.......b.......'];
const HEART_ROWS = HEART_DOTS.map((r, y) => (r.includes('x') ? y : -1)).filter(y => y >= 0);
const STAGE_NAMES = ['赤ちゃん', '子猫', '成猫', 'デブ猫', '妖怪猫'];
const ease = q => 1 - (1 - q) * (1 - q), seg = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a))), lerp = (a, b, q) => a + (b - a) * q;
const loadImg = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });

let root = null, cv = null, g = null, raf = 0, active = false, onClose = null, assets = null;
let fx = null, parts = [], jig = null, moneyRoll = null, heartShown = 0, heartStep = 0, last = 0;
let outing = null, notice = null, modal = null, playingCd = null;   // outing：おでかけの演出／notice：帰ってきた知らせ／modal：開いている窓（'music'・'case'）
const cat = { x: 330, face: -1, act: '立つ', t0: 0, until: 0, tx: 330, stepAt: 0, floor: 352, bed: false, box: null };
const stage = () => stageOf(S.lv), CAT = () => scaleOf(S.lv), floorY = () => (S.lv < 5 ? 352 : 366);   // ダンディは大きいので床を画面の下へ

function frameCanvas(pal, rows) {
  const c = document.createElement('canvas'); c.width = rows[0].length; c.height = rows.length; const x = c.getContext('2d');
  rows.forEach((r, y) => [...r].forEach((ch, xx) => { if (ch !== '.') { x.fillStyle = pal[ch]; x.fillRect(xx, y, 1, 1); } }));
  return c;
}
async function prepare() {
  if (assets) return assets;
  const bg = await loadImg(D.bg), gram = D.gram ? await loadImg(D.gram) : null, foods = await Promise.all(D.foods.map(f => loadImg(f.png)));
  const eat = D.stages.map(s => s.frames.map(r => frameCanvas(s.pal, r)));
  const mo = D.stages.map(s => Object.fromEntries(Object.entries(s.mo.frames).map(([k, fs]) => [k, fs.map(r => frameCanvas(s.mo.pal, r))])));
  const stand = await Promise.all(D.stages.map(async s => { const im = await loadImg(s.stand), c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0); return c; }));
  return (assets = { bg, gram, foods, eat, mo, stand });
}
function mouthOf(st) {   // かじる口の位置：3コマ目（かじる）で、体の下半分のいちばん左のドット
  const r = st.frames[2]; let best = null;
  for (let y = Math.floor(st.h * 0.45); y < st.h; y++) { const x = r[y].search(/[^.]/); if (x >= 0 && (best === null || x < best.x)) best = { x, y }; }
  return best;
}
function enter(now, bed = S.lv < 5 && Math.random() < BED_RATE) {   // 画面に入ったとき：まれにベッドの上で眠っている（ダンディは大きいのでベッドに乗らない）
  cat.bed = bed; cat.face = -1; cat.t0 = now; cat.box = null;
  if (bed) { cat.x = BED.x; cat.floor = BED.y; cat.act = '眠る'; cat.until = Infinity; }
  else { cat.x = S.lv < 5 ? 330 : 400; cat.floor = floorY(); cat.act = '立つ'; cat.until = now + 2500; }
}
function nextAct(now) {
  if (cat.bed) { cat.act = '眠る'; cat.t0 = now; cat.until = Infinity; return; }
  const pick = [['立つ', 0.25], ['歩く', 0.3], ['毛づくろい', 0.13], ['遊ぶ', 0.13], ['伸び', 0.09], ['眠る', 0.1]].filter(([k]) => !(NO_ACT[stage()] || []).includes(k));
  const sum = pick.reduce((a, [, p]) => a + p, 0), r = Math.random() * sum;
  let acc = 0, act = '立つ'; for (const [k, p] of pick) { acc += p; if (r < acc) { act = k; break; } }
  cat.act = act; cat.t0 = now;
  if (act === '歩く') { const C = CAT(); cat.tx = Math.round((XMIN + Math.random() * (XMAX - XMIN)) / C) * C; cat.face = cat.tx > cat.x ? 1 : -1; cat.stepAt = now; cat.until = Infinity; }
  else cat.until = now + (act === '立つ' ? 2500 + Math.random() * 3000 : act === '眠る' ? 7000 + Math.random() * 5000 : act === '伸び' ? MS.伸び * 4 + 400 : MS[act] * 4 * 2);
}
function actFrame(now) {
  const m = assets.mo[stage()];
  if (cat.act === '立つ') return assets.stand[stage()];
  if (cat.act === '眠る') {   // 眠る：1コマ目だけ。胴の行を1行重ねる／戻すを 1.4秒ごと
    const base = m['眠る'][0], k = Math.max(0, Math.floor((now - cat.t0) / SLEEP_BREATH_MS)) % 2;
    if (!base.breath) base.breath = deform(base, 1, 0);
    return k ? base.breath : base;
  }
  const k = Math.max(0, Math.floor((now - cat.t0) / MS[cat.act]));
  return m[cat.act][cat.act === '伸び' ? Math.min(3, k) : k % 4];
}
function biteAt(c, x0, y0, r) {
  const x = c.getContext('2d'); x.save(); x.globalCompositeOperation = 'destination-out';
  for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy <= r * r + 1) x.fillRect(x0 + xx, y0 + yy, 1, 1);
  x.restore();
}
function deform(c, dr, dc) {   // なでたときのプルン：胴の行・まん中の列を抜く／重ねる
  const w = c.width, h = c.height, src = c.getContext('2d').getImageData(0, 0, w, h);
  const r0 = Math.floor(h * 0.6), c0 = Math.floor(w / 2);
  const rows = []; for (let y = 0; y < h; y++) { if (dr < 0 && y >= r0 && y < r0 - dr) continue; rows.push(y); if (dr > 0 && y === r0) for (let k = 0; k < dr; k++) rows.push(y); }
  const cols = []; for (let x = 0; x < w; x++) { if (dc < 0 && x >= c0 && x < c0 - dc) continue; cols.push(x); if (dc > 0 && x === c0) for (let k = 0; k < dc; k++) cols.push(x); }
  const o = document.createElement('canvas'); o.width = cols.length; o.height = rows.length;
  const og = o.getContext('2d'), dst = og.createImageData(o.width, o.height);
  rows.forEach((sy, y) => cols.forEach((sx, x) => { const i = (sy * w + sx) * 4, j = (y * o.width + x) * 4; for (let k = 0; k < 4; k++) dst.data[j + k] = src.data[i + k]; }));
  og.putImageData(dst, 0, 0); return o;
}
const catBox = () => cat.box || { x: cat.x - 40, y: cat.floor - 80, w: 80, h: 80 };
function moneyShown(now) {   // ご飯を買った直後は、前の額から今の額へ 0.6秒で減っていく（だらららっ）
  if (!moneyRoll) return money();
  const q = seg(now, moneyRoll.t0, moneyRoll.t0 + 600);
  if (q >= 1) { moneyRoll = null; return money(); }
  return Math.round(lerp(moneyRoll.from, moneyRoll.to, q));
}
function eat(fi) {
  const st = D.stages[stage()], f = D.foods[fi], C = CAT();
  if (fx || S.out || outing) return;   // おでかけ中は食べない
  if (S.full >= st.cap) { fx = { refuse: true, t0: performance.now() }; se('cat_sleepy'); return; }
  if (money() < f.price) { fx = { refuse: true, t0: performance.now(), text: 'お金が足りない' }; se('ui_cancel'); return; }
  moneyRoll = { from: moneyShown(performance.now()), to: money() - f.price, t0: performance.now() }; S.spent += f.price; save();
  const im = assets.foods[fi], fc = document.createElement('canvas'); fc.width = im.width; fc.height = im.height; fc.getContext('2d').drawImage(im, 0, 0);
  cat.act = '食べる'; cat.face = -1; if (!cat.bed) cat.x = Math.max(cat.x, Math.round((st.w * C / 2 + 70) / C) * C);
  const m = mouthOf(st), right = cat.x - Math.floor(st.w / 2) * C + (m.x + 3) * C;
  fx = { fi, fc, x: right - fc.width, t0: performance.now(), done: {} };
  se('eat_food');
}
function pet() {
  if (jig || S.out || outing) return; jig = { t0: performance.now() };
  se(['cat_purr', 'cat_purr_b', 'cat_purr_c'][Math.floor(Math.random() * 3)]);   // ごろろろは3種からランダム
  if (S.love < LOVE_MAX) {
    S.love++; save();
    const b = catBox(); for (let n = 0; n < 5; n++) home(b.x + b.w / 2 + (Math.random() - 0.5) * 20, b.y + 6, HEART.x + 7.5 * HEART.s, HEART.y + 6 * HEART.s, 300 + n * 30, ['#e7a08a', '#d24a3c', '#fbf3e2'][n % 3]);
  }
}
function drawHeart(now) {
  const area = HEART_ROWS.map(y => [...HEART_DOTS[y]].filter(c => c === 'x').length).reverse(), total = area.reduce((a, b) => a + b, 0);
  let want = 0, acc = 0; while (want < area.length && Math.abs(acc + area[want] - total * S.love / LOVE_MAX) < Math.abs(acc - total * S.love / LOVE_MAX)) acc += area[want++];
  if (heartShown !== want && now - heartStep >= 40) { heartShown += Math.sign(want - heartShown); heartStep = now; }
  const top = HEART_ROWS.length - heartShown, s = HEART.s;
  HEART_DOTS.forEach((r, y) => [...r].forEach((ch, x) => {
    if (ch === '.') return;
    const filled = ch === 'x' && HEART_ROWS.indexOf(y) >= top;
    g.fillStyle = ch === 'b' ? '#221b17' : filled ? ((x === 2 || x === 3) && y === 2 ? '#fbf3e2' : '#d24a3c') : '#5c422c';
    g.fillRect(HEART.x + x * s, HEART.y + y * s, s, s);
  }));
}
const spark = (x, y, vx, vy, life, col, gr) => parts.push({ x, y, vx, vy, life, t: 0, col, g: gr });
const home = (x, y, tx, ty, life, col) => parts.push({ x, y, x0: x, y0: y, tx, ty, bow: (Math.random() - 0.5) * 30, life, t: 0, col, home: true });
function drawHud(now, st) {   // 所持金（大きく）・累計ハイスコア・満腹ゲージ・♡。ダンディの大きな猫に隠れないよう、猫のあとに描く
  g.textBaseline = 'top';
  g.font = '32px MaruMonica'; const mt = `所持金 ${moneyShown(now).toLocaleString()}`; g.fillStyle = '#221b17'; g.fillText(mt, GAUGE.x + 2, 14); g.fillStyle = '#fbf3e2'; g.fillText(mt, GAUGE.x, 12);
  g.font = '16px MaruMonica'; const ht = `累計ハイスコア ${S.earned.toLocaleString()}`; g.fillStyle = '#221b17'; g.fillText(ht, GAUGE.x + 1, 45); g.fillStyle = '#e1bc88'; g.fillText(ht, GAUGE.x, 44);
  g.fillStyle = '#221b17'; g.fillRect(GAUGE.x - 2, GAUGE.y - 2, GAUGE.w + 4, GAUGE.h + 4);
  g.fillStyle = '#5c422c'; g.fillRect(GAUGE.x, GAUGE.y, GAUGE.w, GAUGE.h);
  g.fillStyle = '#f0b84a'; g.fillRect(GAUGE.x, GAUGE.y, Math.round(GAUGE.w * Math.min(1, S.full / st.cap)), GAUGE.h);
  g.fillStyle = '#f2dcb4'; g.fillText(`おなか ${S.full}/${st.cap}`, GAUGE.x + GAUGE.w + 8, GAUGE.y - 3);
  drawHeart(now);
}
function loop(now) {
  if (!active) return;
  const dt = Math.min(50, now - last); last = now;
  const st = D.stages[stage()], C = CAT();
  g.clearRect(0, 0, cv.width, cv.height);
  g.drawImage(assets.bg, 0, 0, assets.bg.width * BG, assets.bg.height * BG);
  if (assets.gram && S.cds.length) g.drawImage(assets.gram, GRAM.x, GRAM.y, GRAM.w, GRAM.h);   // 蓄音機（CD を拾ったら）
  let fr = 0;
  if (fx && !fx.refuse) {   // 見下ろす → 頭を下げる → かじる（3口）／かむ → 頭を上げる。ご飯は置かれ、3口かじられ、粒がゲージへ飛んで消える
    const t = now - fx.t0;
    fr = t < 200 ? 0 : t < 230 ? 1 : t < 620 ? ([230, 340, 450].some(b => t >= b && t < b + 60) ? 2 : 3) : t < 760 ? 1 : 0;
    const q = ease(seg(t, 0, 200)), fc = fx.fc, fy = cat.floor - fc.height - Math.round((1 - q) * 30);
    let squash = 1;
    for (let k = 0; k < 3; k++) {
      const tb = 230 + k * 110;
      if (t >= tb && !fx.done[k]) {
        fx.done[k] = 1;
        for (const [kk, bx, by, r] of BITES) if (kk === k) {
          const x0 = Math.round(bx / 42 * fc.width), y0 = Math.round(by / 60 * fc.height), rr = Math.max(1, Math.round(r / 42 * fc.width * 0.8));
          biteAt(fc, x0, y0, rr);
          for (let n = 0; n < 7; n++) spark(fx.x + x0, fy + y0, (Math.random() - 0.5) * 50, -10 - Math.random() * 30, 380 + Math.random() * 240, ['#cca673', '#e1bc88', '#f2dcb4', '#8a5a38'][n % 4], 160);
        }
        if (k === 2) {
          for (let n = 0; n < 9; n++) home(fx.x + fc.width / 2 + (Math.random() - 0.5) * 16, fy + fc.height / 2, GAUGE.x + GAUGE.w * Math.min(1, S.full / st.cap) + (Math.random() - 0.5) * 20, GAUGE.y + GAUGE.h / 2, 260 + n * 22, ['#f0b84a', '#e7a08a', '#fbf3e2'][n % 3]);
          fx.gain = true;
        }
      }
      if (t >= tb && t < tb + 60) squash = 1 - 0.12 * Math.sin((t - tb) / 60 * Math.PI);
    }
    if (fx.gain && t >= 750) { S.full = Math.min(st.cap, S.full + D.foods[fx.fi].full); save(); fx.gain = false; }
    if (t >= 800 && !fx.mewed) { fx.mewed = true; se(stage() <= 1 ? 'cat_mew' : 'cat_meow'); }   // 頭を上げたところで、ひと声
    const a = 1 - seg(t, 560, 620);
    if (a > 0) { const h = Math.round(fc.height * squash); g.globalAlpha = a; g.drawImage(fc, fx.x, cat.floor - h - Math.round((1 - q) * 30), fc.width, h); g.globalAlpha = 1; }
    if (t > 1100 && parts.length === 0) { fx = null; nextAct(now); }
  }
  if (!fx || fx.refuse) {   // ふだんの動き：歩く（70ms ごとに1ドット）・決まった長さで次の動きへ
    if (cat.act === '食べる') nextAct(now);
    if (cat.act === '歩く') {
      while (now - cat.stepAt >= STEP_MS && cat.x !== cat.tx) { cat.x += cat.face * C; cat.stepAt += STEP_MS; }
      if (cat.x === cat.tx) nextAct(now);
    } else if (now >= cat.until) nextAct(now);
  }
  const away = S.out && !(outing && now - outing.t0 < OUT_SWAP);   // おでかけ中は猫を描かない（暗転のあいだに消える）
  let c = (fx && !fx.refuse ? assets.eat[stage()][fr] : actFrame(now)) || assets.stand[stage()], dcx = 0;
  if (jig) {
    const k = Math.max(0, Math.floor((now - jig.t0) / JIG_MS));
    if (k >= JIGGLE.length) jig = null;
    else { const [dr, dc] = JIGGLE[k]; c = deform(c, dr, dc); dcx = Math.round(dc / 2); }
  }
  const left = cat.x - (Math.floor(c.width / 2) + (cat.face > 0 ? -dcx : dcx)) * C, top = cat.floor - (c.height - 1) * C;
  if (away) cat.box = { x: -999, y: -999, w: 0, h: 0 };
  else {
    if (cat.face > 0) { g.save(); g.translate(left + c.width * C, top); g.scale(-1, 1); g.drawImage(c, 0, 0, c.width * C, c.height * C); g.restore(); }
    else g.drawImage(c, left, top, c.width * C, c.height * C);
    cat.box = { x: left, y: top, w: c.width * C, h: c.height * C };
  }
  drawHud(now, st);
  if (fx && fx.refuse) {
    const t = now - fx.t0; g.fillStyle = '#fbf3e2'; g.font = '16px MaruMonica'; g.textBaseline = 'top';
    g.fillText(fx.text || 'おなかいっぱい', Math.max(8, cat.x - 56), Math.max(90, cat.floor - st.h * C - 22));
    if (t > 1200) fx = null;
  }
  for (const p of parts) {
    p.t += dt; const q = p.t / p.life;
    let x, y;
    if (p.home) { const e = ease(Math.min(1, q)); x = lerp(p.x0, p.tx, e) + Math.sin(e * Math.PI) * p.bow; y = lerp(p.y0, p.ty, e) - Math.sin(e * Math.PI) * 20; }
    else { p.vy += p.g * dt / 1000; p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; x = p.x; y = p.y; }
    g.fillStyle = p.col; g.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  parts = parts.filter(p => p.t < p.life);
  drawOuting(now); drawNotice(now);
  raf = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- おでかけ・帰ってきた知らせ
const OUT_DARK = 400, OUT_SWAP = 400, OUT_TEXT = 2400, OUT_END = 2800;   // 暗くなる → （階段の音・猫が消える）→ 文字 → 明ける（ms）
function goOut() {
  if (S.out || outing || fx || S.lv < 1) return;
  se('ui_decide'); S.out = true; save(); outing = { t0: performance.now(), sound: false }; jig = null; renderHead(); renderFoods();
}
function textC(t, y, size, col = '#fbf3e2') {   // まん中ぞろえの文字（1ドットの影つき）
  g.font = `${size}px MaruMonica`; g.textBaseline = 'top'; const w = g.measureText(t).width, x = Math.round((cv.width - w) / 2), o = size / 16;
  g.fillStyle = '#221b17'; g.fillText(t, x + o, y + o); g.fillStyle = col; g.fillText(t, x, y);
}
function drawOuting(now) {
  if (!outing) return;
  const t = now - outing.t0;
  if (t >= OUT_SWAP && !outing.sound) { outing.sound = true; se('stairs'); }   // 階段の音
  const a = t < OUT_DARK ? t / OUT_DARK : t < OUT_TEXT ? 1 : 1 - seg(t, OUT_TEXT, OUT_END);
  g.fillStyle = `rgba(11,17,32,${a})`; g.fillRect(0, 0, cv.width, cv.height);
  if (t >= OUT_SWAP + 200 && t < OUT_TEXT) textC('猫はでかけたようだ……。', 168, 32);
  if (t >= OUT_END) outing = null;
}
function drawNotice(now) {   // 帰ってきたとき：「猫が帰ってきた。」（CD を拾ってきたら CD と曲名も）。押すか 4.5秒で消える
  if (!notice || outing) return;
  if (now - notice.t0 > 4500) { notice = null; return; }
  const h = notice.cd ? 150 : 70, y0 = Math.round((cv.height - h) / 2), w = cv.width - 192;
  g.fillStyle = 'rgba(11,17,32,0.85)'; g.fillRect(96, y0, w, h);
  g.fillStyle = '#506573'; g.fillRect(96, y0, w, 2); g.fillRect(96, y0 + h - 2, w, 2);
  textC('猫が帰ってきた。', y0 + 18, 32);
  if (notice.cd) {
    g.drawImage(notice.icon, Math.round(cv.width / 2 - 27), y0 + 58, 54, 54);   // CD は3倍
    textC(`CD「${notice.cd}」を拾ってきた！`, y0 + 118, 16, '#f0b84a');
  }
}

// ---------------------------------------------------------------- 窓（3D版の窓・ボタンと同じ角の丸いドット絵の縁。見本の pixFrame をそのまま）
function pixFrame({ r, s, fill, line, hi, lo, rings, drop = 0, dropCol = '#00000080' }) {
  const W = 2 * s + 1, H = W, c = document.createElement('canvas'); c.width = W; c.height = H + drop; const x = c.getContext('2d');
  rings = rings || [line, [hi, lo]];
  const inside = (px0, py0, inset = 0) => {
    const px = px0 + 0.5, py = py0 + 0.5, a = inset, b = W - inset, t = inset, d = H - inset, rr = r - inset;
    if (px < a || px > b || py < t || py > d) return false;
    const cx = Math.min(Math.max(px, a + rr), b - rr), cy = Math.min(Math.max(py, t + rr), d - rr);
    return (px - cx) ** 2 + (py - cy) ** 2 <= rr * rr + 0.3;
  };
  for (let y = 0; y < H + drop; y++) for (let xx = 0; xx < W; xx++) {
    let col = null;
    if (inside(xx, y)) {
      let k = 0; while (k < rings.length && inside(xx, y, k + 1)) k++;
      const ring = rings[k];
      col = k === rings.length ? fill : Array.isArray(ring) ? ((xx + y < W - 1) ? ring[0] : ring[1]) : ring;
    } else if (drop && inside(xx, y - drop)) col = dropCol;
    if (col) { x.fillStyle = col; x.fillRect(xx, y, 1, 1); }
  }
  return { url: `url(${c.toDataURL()})`, s, drop };
}
function build() {
  root = document.createElement('div'); root.id = 'inn';
  root.innerHTML = `<div class="inn-frame"><canvas width="657" height="369" aria-label="宿屋の部屋と猫"></canvas>
    <section class="inn-win"><div class="inn-head"><h2>ご飯をあげる</h2><span class="inn-acts"><button data-act="out">おでかけ</button><button class="inn-back" data-act="back">もどる</button></span></div><div class="inn-foods"></div></section></div>
    <div class="inn-modal"></div>`;
  (document.getElementById('stage') || document.body).appendChild(root);
  cv = root.querySelector('canvas'); g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
  const set = (k, f) => { root.style.setProperty(`--inn-${k}`, f.url); root.style.setProperty(`--inn-${k}-s`, f.s); root.style.setProperty(`--inn-${k}-b`, f.s + f.drop); };
  const SLATE = [['#b8c4cc', '#506573'], ['#7a8e9c', '#506573']];
  set('paper', pixFrame({ r: 6, s: 7, fill: '#0b1120cc', drop: 2, rings: ['#221b17', ...SLATE, '#221b17', ['#0b1120cc', '#0b1120cc']] }));
  set('outer', pixFrame({ r: 6, s: 7, fill: '#3f2d21', drop: 2, rings: ['#221b17', ['#fbf3e2', '#cca673'], ['#e1bc88', '#cca673'], '#221b17'] }));
  set('btn', pixFrame({ r: 2, s: 3, fill: '#2c3a48', rings: ['#221b17', ['#506573', '#2c3a48']], drop: 1, dropCol: '#221b17' }));
  set('btn-h', pixFrame({ r: 2, s: 3, fill: '#506573', rings: ['#221b17', ['#7a8e9c', '#506573']], drop: 1, dropCol: '#221b17' }));
  const at = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
  const inBox = (p, b) => p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h;
  cv.addEventListener('pointerdown', e => {
    if (notice) { notice = null; return; }                 // 知らせは押すと消える
    if (outing) return;
    const p = at(e);
    if (inBox(p, catBox())) pet();                         // 猫をクリック（なでる）
    else if (inBox(p, SHELF)) openModal('case');            // 棚を調べる → コレクションケース
    else if (S.cds.length && inBox(p, GRAM)) openModal('music');   // 蓄音機 → 音楽プレイヤー
  });
  cv.addEventListener('pointermove', e => { const p = at(e); cv.style.cursor = inBox(p, catBox()) || inBox(p, SHELF) || (S.cds.length && inBox(p, GRAM)) ? 'pointer' : 'default'; });
  root.addEventListener('click', e => {
    e.stopPropagation(); const b = e.target.closest('button'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'back') close();
    else if (act === 'out') goOut();
    else if (act === 'close') closeModal();
    else if (act === 'stop') { se('ui_cancel'); playingCd = null; globalThis.Music?.room?.(); renderModal(); }
    else if (b.dataset.cd) { se('ui_decide'); globalThis.Music?.play?.(b.dataset.cd); playingCd = b.dataset.cd; renderModal(); }
    else if (b.dataset.food) eat(+b.dataset.food);
  });
  root.addEventListener('pointerdown', e => e.stopPropagation());
  addEventListener('resize', () => { if (active) fit(); });
}
// 音楽プレイヤーとコレクションケース（窓はご飯の窓と同じ見た目。ユーザー確認済み）
function openModal(kind) { if (modal || outing) return; se('ui_decide'); modal = kind; renderModal(); root.querySelector('.inn-modal').classList.add('show'); }
function closeModal() { if (!modal) return; se('ui_cancel'); modal = null; root.querySelector('.inn-modal').classList.remove('show'); }
function renderModal() {
  const el = root.querySelector('.inn-modal'); let body = '', title = '', info = '';
  if (modal === 'music') {
    title = '音楽プレイヤー'; info = `${S.cds.length} / ${CDS.length}`;
    body = `<div class="inn-cds">${CDS.map(([k, nm]) => (S.cds.includes(k)
      ? `<button data-cd="${k}" class="${k === playingCd ? 'on' : ''}"><span class="ico" data-cdico="1"></span><span>${nm}</span></button>`
      : `<button disabled><span class="ico" data-cdico="0"></span><span>？？？？</span></button>`)).join('')}</div>`
      + `<div class="inn-macts"><button data-act="stop">とめる</button><button data-act="close">とじる</button></div>`;
  } else if (modal === 'case') {
    const O = globalThis.Otakara, list = O ? O.list : [];
    title = 'コレクションケース'; info = `${list.filter(u => O.has(u.id)).length} / ${list.length}`;
    body = `<div class="inn-case">${list.map(u => `<div class="it${O.has(u.id) ? '' : ' none'}"><span class="ico" data-ota="${u.id}" data-sh="${O.has(u.id) ? '' : '1'}"></span><span>${O.has(u.id) ? u.name : '？？？？'}</span></div>`).join('')}</div>`
      + `<div class="inn-macts"><button data-act="close">とじる</button></div>`;
  }
  el.innerHTML = `<section class="inn-win inn-mwin"><div class="inn-head"><h2>${title}</h2><small>${info}</small></div>${body}</section>`;
  el.querySelectorAll('[data-cdico]').forEach(sp => sp.appendChild(cdCanvas(sp.dataset.cdico === '0')));
  el.querySelectorAll('[data-ota]').forEach(sp => sp.appendChild(globalThis.Otakara.icon(sp.dataset.ota, !!sp.dataset.sh)));
}
function renderHead() {
  root.querySelector('.inn-frame h2').textContent = S.out ? '猫はおでかけ中……' : 'ご飯をあげる';
  root.querySelector('[data-act="out"]').style.display = S.lv >= 1 && !S.out ? '' : 'none';   // おでかけは子猫から
}
function silhouette(img) {   // まだ食べられないご飯：絵のあるドットを1色でぬる
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d');
  x.drawImage(img, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = '#0b1120'; x.fillRect(0, 0, c.width, c.height); return c.toDataURL();
}
function renderFoods() {
  root.querySelector('.inn-foods').innerHTML = D.foods.map((f, i) => {
    const lock = stage() < f.from, im = assets.foods[i];
    return `<button data-food="${i}"${lock || S.out ? ' disabled' : ''} title="${lock ? '' : `満腹＋${f.full}`}"><span class="ic"><img src="${lock ? silhouette(im) : f.png}" style="width:calc(var(--iu) * ${im.naturalWidth});height:calc(var(--iu) * ${im.naturalHeight})" alt=""></span>`
      + `<span class="tx"><span>${lock ? '？？？' : f.name}</span>${lock ? `<span class="lock">${STAGE_NAMES[f.from]}から</span>` : `<span class="pr">${f.price}</span>`}</span></button>`;
  }).join('');
}
function fit() {   // 3D版の fit() と同じ考え方：2以上なら整数に切り下げ、2未満はそのまま。ゲーム画面の約9割に外枠ごと収める
  const f = root.querySelector('.inn-frame'), stg = root.parentElement.getBoundingClientRect();
  root.style.setProperty('--iu', '1px'); root.style.setProperty('--ifs', '16px');
  const w = f.offsetWidth, h = f.offsetHeight, s = Math.min(stg.width * 0.9 / w, stg.height * 0.92 / h), u = s >= 2 ? Math.floor(s) : Math.max(0.5, s);
  root.style.setProperty('--iu', u + 'px'); root.style.setProperty('--ifs', 16 * Math.max(1, Math.round(u)) + 'px');   // 文字はマルモニカの 16px の整数倍
}
async function open(cb) {
  if (active || !D) return;
  if (!root) build();
  onClose = cb || null;
  await document.fonts.load('16px MaruMonica').catch(() => {});
  await prepare();
  active = true; fx = null; parts = []; jig = null; moneyRoll = null; outing = null; modal = null; playingCd = null; notice = null;
  heartShown = 0; heartStep = 0;
  root.querySelector('.inn-modal').classList.remove('show');
  renderHead(); renderFoods(); root.classList.add('show'); fit();
  globalThis.Music?.room?.(); if (!S.out) se('cat_trill');   // 部屋の曲（ワルツ）と、猫が出てきたあいさつ（ンルッ？）
  if (S.news) {   // おでかけから帰ってきた知らせ（CD を拾ってきたら CD と曲名）
    const nm = S.news.cd && (CDS.find(([k]) => k === S.news.cd) || [])[1];
    notice = { t0: performance.now(), cd: nm || null, icon: cdCanvas() };
    if (nm) se('unlock');
    S.news = null; save();
  }
  last = performance.now(); enter(last); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
}
function close() {
  if (!active) return;
  active = false; cancelAnimationFrame(raf); root.classList.remove('show'); se('ui_cancel');
  globalThis.Music?.title();
  const cb = onClose; onClose = null; cb?.();
}
// 宿屋が開いているあいだは、ほかの画面（OP・ゲーム）にキーを渡さない。Esc でもどる
addEventListener('keydown', ev => { if (!active) return; ev.stopImmediatePropagation(); if (ev.key === 'Escape') { ev.preventDefault(); if (modal) closeModal(); else close(); } }, true);

globalThis.Inn = {
  open, close, get active() { return active; },
  unlocked() { try { return !!localStorage.getItem(OPEN_KEY); } catch { return false; } },
  get announced() { try { return !!localStorage.getItem(OPEN_KEY + '.notice'); } catch { return true; } },   // 「ダンディが宿にやってきた。」を見せたか
  set announced(v) { try { if (v) localStorage.setItem(OPEN_KEY + '.notice', '1'); } catch { /* 保存なし */ } },
  unlock() { try { if (!localStorage.getItem(OPEN_KEY)) localStorage.setItem(OPEN_KEY, String(Date.now())); } catch { /* 保存なし */ } },
  earn(score) { if (score > 0) { S.earned += Math.round(score); save(); } },             // 帰還・踏破で記録されたスコア（1と2）を、おこづかいと累計ハイスコアへ
  depart() { S.armed = ready2grow() && S.lv < LV_MAX; save(); },                           // 出撃：そろっていれば、戻ったときに育つ
  returned() {                                                                              // 戻った（敗北・帰還・踏破）：そろって出撃していたら1つ進む。おなかと♡は空に
    if (S.out) {                                                                            // おでかけしていた猫が帰ってくる。まだ持っていない曲の CD を拾ってくることがある
      S.out = false;
      const rest = CDS.map(([k]) => k).filter(k => !S.cds.includes(k));
      const cd = rest.length && Math.random() < CD_RATE ? rest[Math.floor(Math.random() * rest.length)] : null;
      if (cd) S.cds.push(cd);
      S.news = { cd };
    }
    if (S.armed) {
      S.armed = false; S.full = 0; S.love = 0;
      if (++S.prog >= NEED[S.lv]) { S.lv++; S.prog = 0; }
    }
    save();
  },
  get state() { return { ...S, money: money(), stage: STAGE_NAMES[stage()], scale: scaleOf(S.lv) }; },
};
})();
