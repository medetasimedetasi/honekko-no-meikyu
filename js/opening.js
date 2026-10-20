// ほねっこの迷宮 — OP（タイトル → メニュー → 種族えらび → キャラメイク）
// game3d.js が起動時に Opening.init(api) を呼ぶ。キャラメイクが終わったら api.begin(look) でゲームを始める。
//
// 流れ（1コマ80ms。タイトルのコマはロゴ制作セッションの成果、img/op/title_*.png）
//  1. 登場：ロゴが落ちてきて、犬が出てくると同時に市場の絵（乗算で暗くした）がゆっくり出る
//  2. 待機：犬が尻尾を振り、START が明滅。押すとメニュー（はじめから・つづきから・遊び方・ハイスコア（30F）・ハイスコア（60F）・おたから）
//  3. はじめから：犬がフリスビーを追って消え、ロゴが右へ抜ける。同時に市場の絵の乗算が抜けて明るくなる
//  4. 種族えらび：カーソルが触れた人に白い輪郭（ユーザーが手直しした輪郭レイヤー）、右に種族の説明。押すと「この種族にしますか？」
//  5. キャラメイク：市場がまた暗くなり、左下に顔グラ・その右に立ち絵、右の窓で髪型・髪の色・目の色・フード
// 絵はすべて 960×540 のキャンバスに、それぞれのドットの粒（市場＝2px、ロゴの字＝6px、飾り＝4px、チップ＝1粒1px）のまま整数倍で描く。
// 素材は OP_20261008/作業/ゲームへ書き出し.py が img/op と js/op_data.js に書き出す。
// 音：タイトル〜キャラメイクは Music.title()（バグパイプの曲）、メニューの音は Music.se('ui_…')。
// URL に ?skipop をつけると OP を飛ばして、前回の見た目ですぐ始める（テスト用）。
(() => {
'use strict';
const CW = 960, CH = 540, S = 2, FR = 80;          // S：ゲーム画面（480×270）の1ドット＝キャンバスの2px。FR：1コマの長さ
const MUL = '#7a8e9c';                              // 市場の絵を暗くする乗算の色（共有32色の灰青）
// 市場の6人と種族（輪郭レイヤーの番号）。左右キーで選ぶ順は画面の左から
const PEOPLE = {
  1: { id: '西国人', text: 'にゃんにゃん共和国における基本人種の一つ。本来は共和国の砂漠地帯に住む人々のことを指した。' },
  2: { id: '北国人', text: 'わんわん帝國における主要種族。寒冷地に住む。' },
  3: { id: '南国人', text: 'にゃんにゃん共和国における種族の一つ。バイオテクノロジーと食の種族。' },
  4: { id: 'はてない国人', text: '頑健な肉体と強靭な精神力で知られる人。はてない国の住人。' },
  5: { id: '東国人', text: 'わんわん帝国の種族の一つ。越前藩国などに住む都市住民や、暁の円卓や神聖巫連盟などに住む田舎の住民がいる。' },
  6: { id: '森国人', text: 'にゃんにゃん共和国の森林に住む人々のこと。耳が長い。' },
};
const ORDER = [1, 2, 3, 4, 6, 5];
const MENU = [['new', 'はじめから'], ['cont', 'つづきから'], ['help', '遊び方'], ['score', 'ハイスコア（30F）'], ['score60', 'ハイスコア（60F）'], ['treasure', 'おたから']];   // ハイスコアは1（30F）と2（60F）で分ける（2026-10-20 ユーザー指定）
// キャラメイクの選びどころ（顔グラ FaceKit の look）
// どちらを遊ぶか（2026-10-18 ユーザー指定）：はじめから・つづきからで、ほねっこの迷宮（1）と CardRogue（2）を選ぶ（原作2の「カードローグ１・２」と同じ形）。
// CardRogue をはじめからにすると、タイトルに「CardRogue」が降ってきて（START のところに着地）、ロゴが抜けて種族えらびへ。職業えらびは CardRogue だけ（1には職業がない）
const GAMES = [['classic', 'ほねっこの迷宮', '30階層'], ['cardrogue', 'CardRogue', '60階層']];
let sub = null, subFrom = 0, playGame = 'classic';   // sub：メニューの中の「どちらを遊ぶ？」（'new'＝はじめから・'cont'＝つづきから）。subFrom：もどったときのカーソル
const CR_K = 5, CR_TOP = 394, CR_HOLD = 14;           // CardRogue の文字：書体1粒＝キャンバス4px、着地した文字の上端、降ってから抜けはじめるまでのコマ
const CR_DROP = [-120, -10, 120, 270, CR_TOP, CR_TOP + 8, CR_TOP];   // 降ってくる上端（コマごと。着地で1粒沈んで戻る）
let crImg = null;
// CardRogue の OP（2026-10-18 ユーザー指定）：CardRogue の文字が着地したあと、フリスビーをくわえた犬の群れが左から右へ走り抜け、そのあいだにロゴが抜ける。
// 走りは ドット犬アニメの「12_ゴールデン_走り」4コマ（OP_RUN、33×21・右向き）を同じものを重ねて使い、口にフリスビー（赤い円盤を横から見た形）を足す。
// 並び・速さ・出る順は毎回同じ（固定の OP。種を決めた乱数）。位置は飾りの粒（キャンバス4px）ごと、1コマに整数の粒ずつ進む
const PACK_K = 4, PACK_N = 16, PACK_AT = 8;            // 1粒＝キャンバス4px、犬の数、文字が降りはじめてから群れが出るまでのコマ
const PACK = (() => {
  let s = 20261018; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const lanes = Array.from({ length: PACK_N }, (_, i) => i).sort(() => rnd() - 0.5);
  return lanes.map((ln, i) => {
    const v = 12 + Math.floor(rnd() * 5);               // 1コマに 12〜16 粒
    const late = Math.floor(rnd() * 16);                // 出てくるのが何コマ遅れるか（ばらけて次々に走ってくる）
    return { foot: 90 + Math.round(ln * 44 / (PACK_N - 1)) + Math.floor(rnd() * 3), v, x0: -36 - late * v, ph: Math.floor(rnd() * 4) };
  }).sort((a, b) => a.foot - b.foot);                   // 奥（上）から描く
})();
let packImgs = null, packT0 = 0;
const STYLES = [['元の髪', 'いつもの'], ['ショートカット', 'ショートカット'], ['オールバック', 'オールバック'], ['センターパート', 'センターパート'], ['七三分けロング', '七三分けロング'], ['ポニーテール', 'ポニーテール']];
const HAIRS = [['東国人', '#2c3a48', '#18222d', '黒'], ['西国人', '#6e655a', '#4a4640', '灰'], ['南国人', '#f0b84a', '#8a5a38', '金'], ['北国人', '#b8c4cc', '#7a8e9c', '銀'], ['森国人', '#cca673', '#8a5a38', '亜麻'], ['はてない国人', '#d24a3c', '#8f2f2b', '赤']];
const IRISES = [['琥珀', '#ae6f47', '#f0b84a'], ['青', '#425c8d', '#4aa3e8'], ['緑', '#5c7236', '#8eaa48'], ['茶', '#5c422c', '#8a5a38'], ['赤', '#d24a3c', '#e7a08a']];
const BIG = 3, FOOT_X = 398, FOOT_Y = 420, FACE_X = 24, FACE_Y = CH - 96 * BIG;   // キャラメイクの左側（顔は画面の下のふちに胸もと）

// 職業えらび（2026-10-14、原作2の職業に向けた見本。ユーザー指定の形）：種族えらびのあとに1段。ほかを暗くして、まん中に盤の主人公を3倍で、
// 下に職業の名前（窓なし・縁取り文字）、左右の大きな ◀ ▶ で切り替える。キャラか名前を押す（Enter）と決まって「すがたをきめる」へ
// 絵は js/enemies_hd.js（戦士・魔法使いは、本番に書き出されるまで js/jobs_trial.js の仮の絵）。絵のない職業は出さない
const JOBS = [{ id: '盗賊', group: 'thief_hd' }, { id: '戦士', group: 'warrior_hd' }, { id: '魔法使い', group: 'mage_hd' }];
const JOB_K = 6, JOB_X = CW / 2, JOB_FOOT = 372;    // 盤の3倍（盤は1粒＝キャンバス2px）、足もと（キャンバスの px）。名前と少しあける（2026-10-14 ユーザー指定で少し上へ）
const JOB_SIDE_K = 4, JOB_SIDE_DX = 260;            // 左右のほかの職業（2026-10-14 ユーザー指定）：盤の2倍で、矢印の外側に。少し暗く
const JOB_DARK = 0.72;                              // 職業えらびの暗さ
let jobSel = 0, jobBump = 0, fromJob = false;     // fromJob：職業えらびから「すがたをきめる」・種族えらびへ移るところ
let run = null;          // 「この姿で迷宮へ」のあと：盤の大きさに縮んで、最初のマスまで走る
let api = null, cv = null, g = null, root = null, active = false, raf = 0;
let mode = 'intro', t0 = 0, menuSel = 0, hover = 0, locked = 0, look = null, faceFrames = null, faceFps = 8, typing = 0, mulFrom = 0;
const img = {}, el = {};
let T = null, HIT = null;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
const se = n => globalThis.Music?.se(n);   // メニューの音（ui_start・ui_cursor・ui_decide・ui_cancel）
const frameNo = now => Math.floor((now - t0) / FR);
function setMode(m) {
  mode = m; t0 = performance.now();
  el.back?.classList.toggle('show', ['select', 'job', 'toCreate', 'create', 'toSelect'].includes(m));   // 種族えらび・職業えらび・キャラメイクの間は左上に「タイトルへ」
  el.job?.classList.toggle('show', m === 'job');
  if (el.inn) { el.inn.classList.toggle('show', m === 'idle' || m === 'menu'); el.inn.disabled = !globalThis.Inn?.unlocked(); }   // タイトルの間は左下に「宿屋」（解放までグレー）
  if (el.notice) {   // 宿屋が開いて初めてタイトルに来たとき、1回だけ「ダンディが宿にやってきた。」（2026-10-20 ユーザー指定）
    const want = (m === 'idle' || m === 'menu') && globalThis.Inn?.unlocked() && !Inn.announced;
    if (want && !el.notice.classList.contains('show')) { el.notice.classList.add('show'); Inn.announced = true; se('cat_trill'); }
    else if (!(m === 'idle' || m === 'menu')) el.notice.classList.remove('show');
  }
  // 種族えらびの間は、画面の上のまん中に「群衆から種族をえらんでください。」（2026-10-09 もどした。窓の中だと窓が画面からはみ出すので、群衆の上に）
  if (el.hint) {
    if (m === 'select') el.hint.textContent = '群衆から種族をえらんでください。';
    else if (m === 'job') el.hint.innerHTML = '職業をえらんでください。<small class="mm w">キャラクターを押すと決まります</small>';
    el.hint.classList.toggle('show', m === 'select' || m === 'job');
  }
}
const save = l => { try { localStorage.setItem('honekko.look', JSON.stringify(l)); } catch {} };
const load = () => { try { return JSON.parse(localStorage.getItem('honekko.look')); } catch { return null; } };

// ---------------------------------------------------------------- 描く
function sheet(im, meta, k, scale, clearBox) {      // 縦に並んだコマの k 枚目を、粒のまま scale 倍で。clearBox は消す枠（1つか、枠の配列）
  if (!im) return;
  if (clearBox && !Array.isArray(clearBox[0])) clearBox = [clearBox];
  if (!clearBox || !clearBox.length) { g.drawImage(im, 0, k * meta.height, meta.width, meta.height, 0, 0, meta.width * scale, meta.height * scale); return; }
  const c = sheet.tmp || (sheet.tmp = document.createElement('canvas')); c.width = meta.width; c.height = meta.height;
  const x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height); x.drawImage(im, 0, k * meta.height, meta.width, meta.height, 0, 0, meta.width, meta.height);
  for (const [x0, y0, x1, y1] of clearBox) x.clearRect(x0, y0, x1 - x0, y1 - y0);    // START・いつもの犬を消す（ほかの絵はこの枠にない）
  g.drawImage(c, 0, 0, meta.width * scale, meta.height * scale);
}
const TEXT = [...'電網適応アイドレス'];
function thinText(dx = 0) {     // 「電網適応アイドレス」（ドットではない細い字。ロゴ制作セッションの再生ページと同じ置き方）
  if (dx === null) return;
  const X0 = 120, X1 = 357, BASE = 52, SIZE = 14.5, SX = 0.58;
  g.font = `100 ${SIZE * S}px 'IBM Plex Sans JP'`; g.fillStyle = '#b8c4cc';
  const ws = TEXT.map(ch => g.measureText(ch).width * SX);
  const gap = ((X1 - X0) * S - ws.reduce((a, b) => a + b, 0)) / (TEXT.length - 1);
  let x = (X0 + dx) * S;
  TEXT.forEach((ch, i) => { g.save(); g.translate(x, BASE * S); g.scale(SX, 1); g.fillText(ch, 0, 0); g.restore(); x += ws[i] + gap; });
}
// 市場の絵。show：出ぐあい（0＝真っ暗〜1）、mul：乗算の強さ（0＝明るいまま〜1）、dark：さらに暗くする
function market(show, mul, dark = 0) {
  g.fillStyle = '#0b1120'; g.fillRect(0, 0, CW, CH);
  if (!img.market || show <= 0) return;
  g.globalAlpha = show; g.drawImage(img.market, 0, 0, CW, CH); g.globalAlpha = 1;
  if (mul > 0) { g.globalCompositeOperation = 'multiply'; g.globalAlpha = mul; g.fillStyle = MUL; g.fillRect(0, 0, CW, CH); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; }
  if (dark > 0) { g.fillStyle = `rgba(11,17,32,${dark})`; g.fillRect(0, 0, CW, CH); }
}
const ease = t => Math.max(0, Math.min(1, t));

function draw(now) {
  const k = frameNo(now), I = T.intro, D = T.idle, P = T.press;
  g.imageSmoothingEnabled = false;
  if (mode === 'intro') {
    if (k >= 7 && landed < 1) { landed = 1; se('logo_land1'); }    // ロゴの着地音（音楽ジャンルセッションの案A。2026-10-10）：「ほねっこの」は7コマ目に着地（軽め）
    if (k >= 19 && landed < 2) { landed = 2; se('logo_land2'); }   // 「迷宮」は19コマ目に着地（重め）。クリックで登場を飛ばしたときは鳴らさない
    market(ease((k - T.dogIn) / 25), 1);                      // 犬が出てくると同時に、2秒ほどかけて出る
    thinText(); sheet(img.introL, I.letters, Math.min(k, I.frames - 1), 6); sheet(img.introD, I.deco, Math.min(k, I.frames - 1), 4, dog ? [DOG_BOX] : null);
    if (dog && k >= T.dogIn) drawDog(now);
  } else if (mode === 'idle' || mode === 'menu' || mode === 'crDrop') {
    market(1, 1);
    thinText(); sheet(img.introL, I.letters, I.frames - 1, 6); sheet(img.idleD, D.deco, k % D.frames, 4, [mode !== 'idle' && T.startBox, dog && DOG_BOX].filter(Boolean));
    if (dog) drawDog(now);
    if (mode === 'crDrop') {
      drawCR(CR_DROP[Math.min(k, CR_DROP.length - 1)], 0); if (k >= 4 && landed < 3) { landed = 3; se('logo_land2'); }   // 着地の「どすっ」
      if (k >= PACK_AT && !packT0) packT0 = now;           // フリスビー犬の群れが走ってくる
      drawPack(now);
    }
  } else if (mode === 'press') {
    const p = Math.min(k + 1, P.frames - 1);                   // 1コマ目から（START はメニューを出したときに消えている）
    market(1, 1 - ease((k - pressSkip) / 40));                // 乗算がゆっくり抜けて明るくなる（飛ばしたコマは数えない）
    thinText(P.thin_dx[p]); sheet(img.pressL, P.letters, p, 6);
    if (playGame === 'cardrogue' && P.thin_dx[p] !== null) drawCR(CR_TOP, P.thin_dx[p]);   // CardRogue の文字も、ロゴと一緒に右へ抜ける
    if (!dog && playGame !== 'cardrogue') sheet(img.pressD, P.deco, p, 4);
    else {   // 着せ替えの犬：フリスビーは飛んでこない（いつもの犬がくわえる場面を飛ばす）。犬は字といっしょに右へ抜ける
      if (p < P.dog_gone) sheet(img.idleD, D.deco, 0, 4, [T.startBox, dog && DOG_BOX].filter(Boolean)); else sheet(img.pressD, P.deco, p, 4);   // CardRogue のいつもの犬は、群れが通るまで座ったまま
      if (dog && P.thin_dx[p] !== null) drawDog(now, P.thin_dx[p] / 2);
    }
    if (playGame === 'cardrogue') drawPack(now);
  } else if (mode === 'select') {
    const who = locked || hover;
    market(1, who && img['cut' + who] ? 1 : 0);                // 選んだ人のほかは乗算で暗く（2026-10-09）
    if (who && img['cut' + who]) g.drawImage(img['cut' + who], 0, 0, CW, CH);   // 選んだ人だけ、明るいまま
    if (who && img['ol' + who]) g.drawImage(img['ol' + who], 0, 0, CW, CH);
  } else if (mode === 'job') {
    market(1, 1, JOB_DARK);                                    // ほかは暗く（群衆の青いフードとキャラがまざらないよう、強めに）
    drawJob(now);
  } else if (mode === 'leaving') {
    drawLeaving(k);
  } else {   // toCreate・create・toSelect
    const a = mode === 'toCreate' ? ease(k / 6) : mode === 'toSelect' ? 1 - ease(k / 6) : 1;
    if (fromJob && mode === 'toCreate') market(1, 1, JOB_DARK + (0.35 - JOB_DARK) * a);   // 職業えらびの暗さから、そのまま移る（いったん明るくならないように）
    else if (fromJob && mode === 'toSelect') market(1, 1, JOB_DARK * a);
    else market(1, a, 0.35 * a);
    if (mode !== 'toSelect') drawCreate(now, a);
  }
}
// 「この姿で迷宮へ」のあと（コマ k）：立ち絵がその場で 3倍 → 2倍 → 盤と同じ大きさ（1粒＝1ドット）に縮み、
// 盤の最初のマスへ走っていく。走るあいだに市場が暗くなり、真っ暗で着いたら OP が消えてゲームの画面になる（主人公はちょうどその位置）
const SHRINK = [3, 3, 2, 2, 1, 1];   // 縮むコマ（倍率）
// 「CardRogue」の文字（仮のロゴ、2026-10-18）：マルモニカ 16px を粒に起こし（にじみを切る）、金の字・濃い茶の縁・茶の影。CR_K 倍で、横のまん中に
function crLogo() {
  if (crImg) return crImg;
  const t = 'CardRogue', m = document.createElement('canvas'), mx = m.getContext('2d');
  mx.font = '16px MaruMonica'; const w = Math.ceil(mx.measureText(t).width) + 6, h = 22;
  m.width = w; m.height = h; mx.font = '16px MaruMonica'; mx.textBaseline = 'top'; mx.fillStyle = '#fff'; mx.fillText(t, 3, 2);
  const a = mx.getImageData(0, 0, w, h).data, on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && a[(y * w + x) * 4 + 3] > 110;
  let top = h, bot = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) { top = Math.min(top, y); bot = Math.max(bot, y); }
  const c = document.createElement('canvas'); c.width = w; c.height = h + 2; const x2 = c.getContext('2d');
  const dot = (x, y, col) => { x2.fillStyle = col; x2.fillRect(x, y, 1, 1); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {   // 影（1粒下の縁）→ 縁 → 字
    if (!on(x, y - 2) && [[-1, 0], [1, 0], [0, -1], [0, 1], [0, 0]].some(([dx, dy]) => on(x + dx, y - 2 + dy))) dot(x, y, '#5c422c');
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!on(x, y) && [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]].some(([dx, dy]) => on(x + dx, y + dy))) dot(x, y, '#221b17');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) dot(x, y, y <= top ? '#fbf3e2' : y >= bot - 1 ? '#e28515' : '#f0b84a');
  return (crImg = c);
}
function packFrames() {   // 走りの4コマに、口のフリスビーを重ねたもの（右に3粒広げる）
  if (packImgs !== null) return packImgs;
  const R = globalThis.OP_RUN; if (!R || !img.run) return null;
  const MOUTH = [8, 9, 10, 9];                            // 舌の行（コマごと）。円盤はその上下にまたがる
  const DISC = ['.KKKKK.', 'KrrrrrK', 'KRRRRRK', '.KKKKK.'], C2 = { K: '#221b17', r: '#d24a3c', R: '#8f2f2b' };
  packImgs = R.ms.map((_, k) => {
    const c = document.createElement('canvas'); c.width = R.w + 3; c.height = R.h; const x = c.getContext('2d');
    x.drawImage(img.run, k * R.w, 0, R.w, R.h, 0, 0, R.w, R.h);
    DISC.forEach((row, dy) => [...row].forEach((ch, dx) => { if (ch !== '.') { x.fillStyle = C2[ch]; x.fillRect(27 + dx, MOUTH[k] - 2 + dy, 1, 1); } }));
    return c;
  });
  return packImgs;
}
function drawPack(now) {   // フリスビー犬の群れ（packT0 から何コマ目か）
  const fr = packFrames(); if (!fr || !packT0) return;
  const f = Math.floor((now - packT0) / FR), H = globalThis.OP_RUN.h;
  for (const d of PACK) {
    const x = d.x0 + d.v * f; if (x > 240 || x < -40) continue;
    const im = fr[(f + d.ph) % fr.length];
    g.drawImage(im, x * PACK_K, (d.foot - H) * PACK_K, im.width * PACK_K, im.height * PACK_K);
  }
}
function drawCR(top, dx) {   // top：上端（キャンバスの px）、dx：右へのずれ（ゲーム画面のドット。ロゴが抜けるとき）
  const im = crLogo(), w = im.width * CR_K;
  g.drawImage(im, Math.round(CW / 2 - w / 2 + dx * S), top, w, im.height * CR_K);
}
function drawLeaving(k) {
  const r = run, rk = k - SHRINK.length, t = r.frames ? ease(rk / r.frames) : 1;
  market(1, 1, 0.35 + 0.65 * ease(rk / r.frames));          // 走るあいだに暗くなる
  let s = 1, x = FOOT_X, y = FOOT_Y, name = 'fr_idle_0', flip = false;
  if (k < SHRINK.length) s = SHRINK[k];
  else {
    x = Math.round(FOOT_X + (r.tx - FOOT_X) * t); y = Math.round(FOOT_Y + (r.ty - FOOT_Y) * t);
    const view = r.ty < FOOT_Y && Math.abs(r.ty - FOOT_Y) > Math.abs(r.tx - FOOT_X) ? 'bk' : 'fr';
    name = rk < r.frames ? `${view}_walk_${rk % 4}` : `${view}_idle_0`; flip = r.tx < FOOT_X;   // 絵は右向きなので、左へは反転
  }
  const grp = jobGroup(look?.job), im = sprOr(grp, name, flip, api.hairSwap(effLook().hair, grp));
  g.drawImage(im, Math.round(x - im.width * s / 2), y - api.groundOf(grp) * s, im.width * s, im.height * s);
}
function drawCreate(now, a) {
  if (faceFrames) { g.globalAlpha = a; g.drawImage(faceFrames[Math.floor(now / 1000 * faceFps) % faceFrames.length], FACE_X, FACE_Y, 96 * BIG, 96 * BIG); g.globalAlpha = 1; }
  const grp = jobGroup(look?.job), im = sprOr(grp, `fr_idle_${(now % 1460) < 820 ? 0 : 1}`, false, api.hairSwap(effLook().hair, grp));
  g.globalAlpha = a; g.drawImage(im, Math.round(FOOT_X - im.width * BIG / 2), FOOT_Y - api.groundOf(grp) * BIG, im.width * BIG, im.height * BIG); g.globalAlpha = 1;
}
// ---------------------------------------------------------------- 職業えらび
const jobsNow = () => JOBS.filter(j => api.hasSprite?.(j.group));
const jobGroup = id => (jobsNow().find(j => j.id === id) || jobsNow()[0] || { group: api.PGROUP }).group;
function sprOr(group, name, flip, swap) {   // そのコマがない絵（仮の絵で歩きがないなど）は、立ち姿で
  try { return api.spr(group, name, flip, swap); } catch { return api.spr(group, name.startsWith('bk_') ? 'bk_idle_0' : 'fr_idle_0', flip, swap); }
}
function jobBox() {   // まん中のキャラの範囲（キャンバスの px）。押すと決まる
  const j = jobsNow()[jobSel], im = j && sprOr(j.group, 'fr_idle_0', false, null); if (!im) return null;
  return { x: JOB_X - im.width * JOB_K / 2, y: JOB_FOOT - api.groundOf(j.group) * JOB_K, w: im.width * JOB_K, h: im.height * JOB_K };
}
function sideJobs() {   // 左右に並べるほかの職業：[左（前）, 右（次）]。職業が2つなら右だけ
  const js = jobsNow(), n = js.length; if (n < 2) return [];
  const r = { j: js[(jobSel + 1) % n], d: 1, x: JOB_X + JOB_SIDE_DX };
  return n < 3 ? [r] : [{ j: js[(jobSel - 1 + n) % n], d: -1, x: JOB_X - JOB_SIDE_DX }, r];
}
function sideBox(sd) {
  const im = sprOr(sd.j.group, 'fr_idle_0', false, null);
  return { x: sd.x - im.width * JOB_SIDE_K / 2, y: JOB_FOOT - api.groundOf(sd.j.group) * JOB_SIDE_K, w: im.width * JOB_SIDE_K, h: im.height * JOB_SIDE_K };
}
function drawJob(now) {
  const j = jobsNow()[jobSel]; if (!j) return;
  for (const sd of sideJobs()) {   // ほかの職業：止まった立ち姿を小さく、暗めに
    const im = sprOr(sd.j.group, 'fr_idle_0', false, api.hairSwap(PEOPLE[locked]?.id, sd.j.group)), b = sideBox(sd);
    g.filter = 'brightness(0.55)'; g.drawImage(im, Math.round(b.x), b.y, b.w, b.h); g.filter = 'none';
  }
  const im = sprOr(j.group, `fr_idle_${(now % 1460) < 820 ? 0 : 1}`, false, api.hairSwap(PEOPLE[locked]?.id, j.group));
  const hop = now - jobBump < 120 ? JOB_K : 0;                 // 切り替えたとき、1粒だけ跳ねる
  g.drawImage(im, Math.round(JOB_X - im.width * JOB_K / 2), JOB_FOOT - api.groundOf(j.group) * JOB_K - hop, im.width * JOB_K, im.height * JOB_K);
}
function enterJob() {
  const prev = load(), js = jobsNow();
  jobSel = Math.max(0, js.findIndex(j => j.id === prev?.job));
  hideWin(); se('ui_decide'); setMode('job'); renderJob();
}
function renderJob() { const j = jobsNow()[jobSel]; el.job.querySelector('.nm').textContent = j ? j.id : ''; }
function stepJob(d) { const n = jobsNow().length; if (n < 2) return; jobSel = (jobSel + d + n) % n; jobBump = performance.now(); se('ui_cursor'); renderJob(); }
// ◀ ▶ のドット（2026-10-14 ユーザー指定：字ではなくドットで）。右向きの三角（中 8×15 粒）に1粒の縁。左は反転。ふだんは白、カーソルが乗ると金
function arrowDot(fill, left) {
  const W = 10, H = 17, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  const inside = (px, py) => py >= 1 && py <= 15 && px >= 1 && px - 1 < 1 + Math.min(py - 1, 15 - py);
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const on = inside(px, py), edge = !on && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inside(px + dx, py + dy));
    if (!on && !edge) continue;
    x.fillStyle = on ? fill : '#0b1120'; x.fillRect(left ? W - 1 - px : px, py, 1, 1);
  }
  return c.toDataURL();
}
function backFromJob() { se('ui_cancel'); fromJob = true; setMode('toSelect'); }

// ---------------------------------------------------------------- 毎コマ
function tick(now) {
  if (!active) return;
  const st = root.parentElement;                 // ボタンにフォーカスが移ると #stage がスクロールして下の手札がのぞくので、0に戻す
  if (st.scrollTop || st.scrollLeft) { st.scrollTop = 0; st.scrollLeft = 0; }
  const k = frameNo(now);
  if (mode === 'intro' && k >= T.intro.frames) setMode('idle');
  else if (mode === 'press' && k >= T.press.exit_start + 12) enterSelect();   // ロゴと骨が抜けきったら
  else if (mode === 'crDrop' && k >= CR_HOLD) enterPress();
  else if (mode === 'toCreate' && k >= 6) setMode('create');
  else if (mode === 'toSelect' && k >= 6) enterSelect();
  else if (mode === 'leaving' && k >= SHRINK.length + run.frames + 3) finish();
  draw(now);
  raf = requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- メニュー
// 選べない項目：「つづきから」は、保存した探索がないときはグレーにして選べない（カーソルも止まらない）
const menuItems = () => (sub ? [...GAMES.map(([id, nm, fl]) => [id, `${nm}　${fl}`]), ['back', 'もどる']] : MENU);   // はじめから・つづきからとも階層数を出す
const anySave = () => GAMES.some(([g]) => api.saveInfo?.(g));
const menuOff = i => { const it = menuItems()[i]; if (!it) return true; if (sub === 'cont') return it[0] !== 'back' && !api.saveInfo?.(it[0]); return !sub && it[0] === 'cont' && !anySave(); };
function showMenu(quiet = false) {
  setMode('menu'); if (!quiet) se('ui_start');
  const M = menuItems(); if (menuSel >= M.length || menuOff(menuSel)) menuSel = Math.max(0, M.findIndex((_, i) => !menuOff(i)));
  el.menu.innerHTML = M.map(([id, nm], i) => `<button class="mm w${i === menuSel ? ' on' : ''}${menuOff(i) ? ' off' : ''}" data-menu="${i}"${menuOff(i) ? ' disabled' : ''}>${esc(nm)}</button>`).join('');
  el.menu.classList.add('show'); el.toast.textContent = sub === 'new' ? 'どちらで遊ぶ？' : sub === 'cont' ? menuToast(menuSel) : '';
}
function stepMenu(d) {                                        // 上下キー：選べない項目は飛ばす
  let i = menuSel;
  const n = menuItems().length;
  do i = (i + d + n) % n; while (menuOff(i) && i !== menuSel);
  pickMenu(i);
}
function pickMenu(i) {
  if (menuOff(i)) return;
  if (i !== menuSel) se('ui_cursor');
  menuSel = i; [...el.menu.children].forEach((b, j) => b.classList.toggle('on', j === i));
  el.toast.textContent = menuToast(i);
}
function menuToast(i) {   // カーソルの下の一言：つづきからの中身など
  const id = menuItems()[i]?.[0];
  if (sub === 'cont') return id === 'back' ? 'どちらの続き？' : contInfo(id);
  if (sub === 'new') return 'どちらで遊ぶ？';
  return id === 'cont' && !anySave() ? 'つづきから遊べる探索はありません' : '';
}
function contInfo(game) {                                     // 「つづきから」の中身：B7F　112ターン　10/9 21:30 に中断
  const d = api.saveInfo?.(game); if (!d) return 'つづきから遊べる探索はありません';
  const t = new Date(d.savedAt);
  return `B${d.floor}F　${d.turn}ターン　${t.getMonth() + 1}/${t.getDate()} ${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')} の続き`;
}
function runMenu(i) {
  const id = menuItems()[i][0];
  if (sub) {                                                  // 「どちらを遊ぶ？」
    if (id === 'back') { se('ui_cancel'); sub = null; menuSel = subFrom; showMenu(true); return; }
    if (menuOff(i)) { se('ui_cancel'); return; }
    const was = sub; sub = null; el.menu.classList.remove('show'); el.toast.textContent = '';
    if (was === 'new') { startNew(id); return; }
    se('ui_decide'); toResume(id); return;
  }
  if (id === 'new') { se('ui_decide'); subFrom = i; sub = 'new'; menuSel = 0; showMenu(true); return; }
  if ((id === 'score' || id === 'score60') && globalThis.Ranking) { se('ui_decide'); openRank(id === 'score60' ? 'cardrogue' : 'classic'); return; }
  if (id === 'treasure' && globalThis.Otakara) { se('ui_decide'); openOta(); return; }
  if (id === 'cont') {                                         // つづきから：どちらの続きか選ぶ（保存のないほうは選べない）
    if (!anySave()) { se('ui_cancel'); el.toast.textContent = 'つづきから遊べる探索はありません'; return; }
    se('ui_decide'); subFrom = i; sub = 'cont'; menuSel = 0; showMenu(true); return;
  }
  if (id === 'help' && globalThis.Tutorial) { se('ui_decide'); el.menu.classList.remove('show'); el.toast.textContent = ''; toTutorial(); return; }
  se('ui_cancel'); el.toast.textContent = `「${MENU[i][1]}」は準備中です`;
}

// ---------------------------------------------------------------- ハイスコア（js/ranking.js）
// メニューの上に窓を重ねる。上の札で「このブラウザ」（ここに残した記録）と「オンライン」（みんなの記録。送り先があるとき）を切り替える。
// どちらも上位10件。もどる（Esc・Enter・窓の外を押す）でメニューへ。左右キーで札を切り替える。
// このブラウザ：記録をテキストで書き出す（クリップボード。テストプレイの結果を送ってもらう用）・消す
// オンライン：開くたびに読み直す（「更新」でも）。自分の記録は水色。まだ送れていない記録があれば、先に送り直す
// 1（30F）と2（60F）は別の表（js/ranking.js の Ranking.for）。rankGame がいま開いている表
let rankOpen = false, clearArmed = false, rankTab = 'local', onlineData = null, onlineSeq = 0, rankGame = 'classic';
const rankBoard = () => globalThis.Ranking.for?.(rankGame) || globalThis.Ranking;
const rankTitle = () => (rankGame === 'cardrogue' ? 'ハイスコア（60F）' : 'ハイスコア（30F）');
function openRank(game = 'classic') {
  rankOpen = true; clearArmed = false; rankGame = game;
  el.menu.classList.remove('show'); el.toast.textContent = '';
  el.rank.classList.add('show'); setRankTab(rankTab);
}
// おたから：ハイスコアと同じ窓に、おたからを1つずつ札で並べる。持っているものはアイコン・名前・説明、まだのものは影と条件だけ
function openOta() {
  rankOpen = true; rankTab = 'ota';
  el.menu.classList.remove('show'); el.toast.textContent = '';
  const O = globalThis.Otakara;
  el.rank.innerHTML = `<div class="t mm w"><span>おたから</span><small class="mm m">${O.count()} / ${O.shown().length}</small></div><div class="list ota">`
    + O.shown().map(u => {   // シークレットおたから（hidden）は手に入れるまで出さない
      const has = O.has(u.id);
      return `<div class="row${has ? '' : ' none'}"><span class="face" data-ico="${esc(u.id)}" data-shadow="${has ? '' : '1'}"></span>`
        + `<span class="who"><span class="nm mm">${has ? esc(u.name) : '？？？'}</span><span class="tx mm l">${has ? esc(u.text) : esc(O.need(u))}</span></span>`
        + '</div>';
    }).join('') + '</div>'
    + `<div class="acts"><button class="mm m primary" data-act="back">もどる</button></div>`;
  el.rank.querySelectorAll('[data-ico]').forEach(s => s.appendChild(O.icon(s.dataset.ico, !!s.dataset.shadow)));
  el.rank.classList.add('show');
}
function closeRank() {
  if (!rankOpen) return;
  if (rankTab === 'ota') rankTab = 'local';
  rankOpen = false; se('ui_cancel');
  el.rank.classList.remove('show'); el.menu.classList.add('show');
}
function setRankTab(tab) {
  rankTab = tab; clearArmed = false;
  if (tab === 'online') loadOnline(); else renderRank();
}
async function loadOnline() {
  const R = rankBoard(), seq = ++onlineSeq;
  onlineData = null; renderRank();
  if (!R.online.enabled) return;
  await R.online.flush();
  const d = await R.online.fetch(10);
  if (seq !== onlineSeq) return;                 // 読み込みのあいだに切り替えた
  onlineData = d; if (rankOpen && rankTab === 'online') renderRank();
}
// 1人1枚の横長の札：左から 順位・顔グラ（そのとき使っていた顔）・名前とスコア・到達／ターン／時間。10人分は窓の中でスクロール
const rankRows = (list, mine) => '<div class="list">' + list.map((e, i) => {
  const R = globalThis.Ranking, pic = e.face || e.icon;
  return `<div class="row${i === 0 ? ' top' : ''}${mine(e) ? ' mine' : ''}"><b class="no mm xl">${i + 1}</b>`
    + `<span class="face">${pic ? `<img src="${pic}" alt="">` : ''}${globalThis.HK_JOB_ICON ? `<img class="job" src="${HK_JOB_ICON(e.job || '盗賊', true)}" alt="${esc(e.job || '盗賊')}">` : ''}</span>`   // 顔の右下に職業の紋章
    + `<span class="who"><span class="nm mm">${esc(e.name)}</span><span class="sc mm">${Number(e.score).toLocaleString()}<small class="mm l">点</small></span></span>`
    + `<span class="how mm"><span class="mm l">${esc(e.job || '盗賊')}・${R.reach(e)}</span><br>${e.turns}<small class="mm l">ターン</small>　${R.mmss(e.ms)}</span></div>`;
}).join('') + '</div>';
function renderRank(note = '') {
  const R = rankBoard(), online = rankTab === 'online';
  const tabs = `<span class="tabs"><button class="mm m tab${online ? '' : ' on'}" data-act="tab-local">このブラウザ</button><button class="mm m tab${online ? ' on' : ''}" data-act="tab-online">オンライン</button></span>`;
  let body, info, btns;
  if (!online) {
    const all = R.list(), top = all.slice(0, 10);
    info = `このブラウザの記録　${all.length}件`;
    body = top.length ? rankRows(top, () => false)
      : `<p class="empty mm l">まだ記録はありません。<br><small class="mm m">帰還の巻物で地上へ帰るか、${rankGame === 'cardrogue' ? '地下60階から脱出する' : '地下30階を踏破する'}と記録されます。</small></p>`;
    btns = top.length ? `<button class="mm m" data-act="copy">記録を書き出す</button><button class="mm m${clearArmed ? ' warn' : ''}" data-act="clear">${clearArmed ? '本当に消す？' : '記録を消す'}</button>` : '';
  } else if (!R.online.enabled) {
    info = ''; btns = '';
    body = '<p class="empty mm l">オンラインの送り先が、まだ設定されていません。<br><small class="mm m">js/ranking_config.js に送り先の URL を入れると使えます。</small></p>';
  } else if (!onlineData) {
    info = ''; btns = ''; body = '<p class="empty mm l">読み込んでいます…</p>';
  } else if (!onlineData.ok && onlineData.error === 'not-ready') {   // 送り先がまだ60Fの表を分けられない版（Code.gs を出し直す前）
    info = ''; btns = '';
    body = '<p class="empty mm l">オンラインの60Fの表は、まだ準備中です。<br><small class="mm m">記録はこのブラウザに残っています。</small></p>';
  } else if (!onlineData.ok) {
    info = ''; btns = '<button class="mm m" data-act="reload">もう一度</button>';
    body = '<p class="empty mm l">つながりませんでした。<br><small class="mm m">インターネットにつながっているか確かめて、もう一度読んでください。</small></p>';
  } else {
    info = `みんなの記録　${onlineData.total}件`; btns = '<button class="mm m" data-act="reload">更新</button>';
    body = onlineData.list.length ? rankRows(onlineData.list, e => R.mine(e.id)) : '<p class="empty mm l">まだ記録はありません。</p>';
  }
  el.rank.innerHTML = `<div class="t mm w"><span>${rankTitle()}</span>${tabs}<small class="mm m">${info}</small></div>${body}`
    + `<div class="acts"><span class="note mm m">${esc(note)}</span>${btns}<button class="mm m primary" data-act="back">もどる</button></div>`;
}
async function copyRank() {
  const text = rankBoard().text();
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();   // ファイルを直接開いたときなど
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  se(ok ? 'ui_decide' : 'ui_cancel');
  renderRank(ok ? 'コピーしました。そのまま貼り付けて送れます' : 'コピーできませんでした');
}
function onRankClick(ev) {
  ev.stopPropagation();
  const b = ev.target.closest('button'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'back') closeRank();
  else if (act === 'tab-local' || act === 'tab-online') { const t = act.slice(4); if (t !== rankTab) { se('ui_cursor'); setRankTab(t); } }
  else if (act === 'reload') { se('ui_cursor'); loadOnline(); }
  else if (act === 'copy') copyRank();
  else if (act === 'clear') {
    if (!clearArmed) { clearArmed = true; se('ui_cursor'); renderRank('もう一度押すと、このブラウザの記録を全部消します'); }
    else { rankBoard().clear(); clearArmed = false; se('ui_decide'); renderRank('記録を消しました'); }
  }
}

// ---------------------------------------------------------------- 種族えらび
function enterSelect() {
  fromJob = false; setMode('select'); hover = 0; locked = 0; setHover(5);   // 最初は東国人を選んだ状態（カーソルが人に乗っていなくても）
}
// 種族えらびの窓（出しっぱなし）。見出しは「迷宮に挑むのは だれ？」、人にカーソルが触れたら種族名と説明
// 窓の高さは、いちばん長い説明・問い・ボタンまで出しきった大きさに最初から固定する（文字が出るたびに伸びないように）
function fixSelectHeight() {
  el.win.style.height = '';
  const longest = Object.values(PEOPLE).reduce((a, b) => (b.text.length > a.text.length ? b : a));
  el.win.innerHTML = `<div class="t mm w">迷宮に挑むのは だれ？</div><div class="nm mm w">${esc(longest.id)}</div><p class="bd mm w">${esc(longest.text)}</p><p class="q mm w">この種族にしますか？</p><div class="acts"><button class="primary">この種族にする</button><button>やめる</button></div>`;
  el.win.classList.add('show');
  el.win.style.height = `${el.win.offsetHeight}px`; el.win.dataset.fs = getComputedStyle(document.documentElement).getPropertyValue('--fs-w');
}
function renderSelect(n) {
  clearTimeout(typing);
  const fs = getComputedStyle(document.documentElement).getPropertyValue('--fs-w');   // 画面の大きさが変わって字の大きさが変わったら測り直す
  if (el.win.classList.contains('create') || !el.win.style.height || el.win.dataset.fs !== fs) { el.win.classList.remove('create'); fixSelectHeight(); }
  el.win.innerHTML = '<div class="t mm w">迷宮に挑むのは だれ？</div>' + (n
    ? `<div class="nm mm w">${esc(PEOPLE[n].id)}</div><p class="bd mm w"></p><p class="q mm w"></p><div class="acts"></div>`
    : '<p class="dim mm w">種族を選ぶ</p>');
  el.win.classList.add('show');
  if (n) typeText(el.win.querySelector('.bd'), PEOPLE[n].text);
}
function hideWin() { el.win.classList.remove('show', 'create'); el.win.innerHTML = ''; el.win.style.height = ''; clearTimeout(typing); }
function typeText(node, text, done) {     // 1文字ずつ（0.025秒おき）。窓を押すと全部出す
  let i = 0; clearTimeout(typing);
  const stepT = () => { node.textContent = text.slice(0, ++i); if (i < text.length) typing = setTimeout(stepT, 25); else done?.(); };
  node.dataset.full = text; stepT();
}
function setHover(n) {
  if (locked || n === hover || !n) return;   // 人のいない所にカーソルが行っても、選んでいる人はそのまま
  hover = n;
  if (n) se('ui_cursor');
  renderSelect(n);
}
function lock(n) {
  if (!n) return;
  if (hover !== n) { locked = 0; setHover(n); }
  locked = n; se('ui_decide');
  const bd = el.win.querySelector('.bd'); clearTimeout(typing); bd.textContent = bd.dataset.full;
  el.win.querySelector('.q').textContent = 'この種族にしますか？';
  el.win.querySelector('.acts').innerHTML = '<button class="primary" data-act="yes">この種族にする</button><button data-act="no">やめる</button>';
}
function unlock() { se('ui_cancel'); locked = 0; renderSelect(hover); }

// ---------------------------------------------------------------- キャラメイク
// おたから（look.ota）を当てた見た目（顔グラの部品・髪型・髪の色）。js/otakara.js
const effLook = () => (globalThis.Otakara ? Otakara.faceLook(look) : look);
async function rebuildFace() {
  if (!globalThis.FaceKit) return;
  await FaceKit.ready;
  const a = FaceKit.build(effLook()).idle;
  faceFps = a.fps;
  faceFrames = a.frames.map(px => { const c = document.createElement('canvas'); c.width = c.height = 96; c.getContext('2d').putImageData(FaceAnim.toImageData(px), 0, 0); return c; });
}
function enterCreate() {
  fromJob = mode === 'job';
  const nation = PEOPLE[locked].id, prev = load();
  look = { style: '元の髪', hood: true, nation, hair: nation, iris: '琥珀' };
  if (prev && prev.nation === nation) Object.assign(look, { style: prev.style, hood: prev.hood, hair: prev.hair, iris: prev.iris });
  look.ota = (prev?.ota || []).filter(id => globalThis.Otakara?.has(id));   // 付けていたおたから（持っているものだけ）
  look.job = playGame === 'cardrogue' ? jobsNow()[jobSel]?.id || '盗賊' : '盗賊';   // 職業えらびで決めた職業（ほねっこの迷宮には職業がないので盗賊）
  faceFrames = null; rebuildFace(); se('ui_decide');
  renderCreate(); setMode('toCreate');
}
// 髪型と髪の色の選択肢（おたからの髪型〈kind style：メカクレ・ボブ・ウルフカット・坊主頭〉「紫黒」を持っていれば増える）
const stylesNow = () => STYLES.concat((globalThis.Otakara?.list || []).filter(u => u.kind === 'style' && Otakara.has(u.id)).map(u => [u.id, u.name]));
const hairsNow = () => HAIRS.concat(globalThis.Otakara?.has('紫黒') ? [['紫黒', '#2b3e6d', '#0e1c3f', '紫黒']] : []);
function renderCreate() {
  const sw = (key, list, cur) => list.map(([id, a, b, nm]) => `<button class="sw${id === cur ? ' on' : ''}" data-${key}="${esc(id)}" title="${esc(nm || id)}" style="--a:${a};--b:${b}"></button>`).join('');
  const ST = stylesNow(), si = Math.max(0, ST.findIndex(s => s[0] === look.style));
  el.win.innerHTML = `<div class="t mm w">すがたをきめる<small class="mm w">${esc(look.nation)}${playGame === 'cardrogue' && look.job ? '・' + esc(look.job) : ''}</small></div>
    <div class="rows">
      <span class="lab mm w">髪型</span><span class="sel"><button data-style-step="-1">‹</button><b class="mm w">${esc(ST[si][1])}</b><button data-style-step="1">›</button></span>
      <span class="lab mm w">髪の色</span><span class="sws">${sw('hair', hairsNow(), look.hair)}</span>
      <span class="lab mm w">目の色</span><span class="sws">${sw('iris', IRISES.map(([id, a, b]) => [id, a, b, id]), look.iris)}</span>
      <span class="lab mm w">フード</span><span class="sel"><button class="tg${look.hood ? ' on' : ''}" data-hood="1">かぶる</button><button class="tg${look.hood ? '' : ' on'}" data-hood="0">はずす</button></span>
      ${otaRow()}
    </div>
    <div class="acts"><button class="primary" data-act="go">この姿で迷宮へ</button><button data-act="repick">種族をえらびなおす</button></div>`;
  el.win.style.height = ''; el.win.classList.add('show', 'create');
  paintOtaButtons();
}
// キャラメイクの「おたから」の欄：持っているおたからを、押すたびに付ける／はずす（アイコンのボタン）。1つも持っていなければ出さない
function otaRow() {
  const O = globalThis.Otakara; if (!O) return '';
  const have = O.list.filter(u => (u.kind === 'acc' || u.kind === 'outfit' || u.kind === 'hood') && O.has(u.id)); if (!have.length) return '';
  const on = look.ota || [];
  return `<span class="lab mm w">おたから</span><span class="sws ota">${have.map(u => `<button class="ob${on.includes(u.id) ? ' on' : ''}" data-ota="${esc(u.id)}" title="${esc(u.name)}"></button>`).join('')}</span>`;
}
function paintOtaButtons() {   // ボタンの中にアイコン（キャンバス）を入れる
  el.win.querySelectorAll('button[data-ota]').forEach(b => { b.innerHTML = ''; b.appendChild(globalThis.Otakara.icon(b.dataset.ota)); });
}
function changeLook(patch) { se('ui_cursor'); Object.assign(look, patch); rebuildFace(); renderCreate(); }
function confirmCreate() {
  se('ui_decide'); save(look); hideWin();
  api.begin({ ...look }, false, playGame);                    // ゲーム（B1F）を OP の裏で用意して、主人公の最初のマスを知る
  const f = api.playerFoot(), tx = f.x * 2, ty = f.y * 2;    // ゲーム画面（480×270）→ OP のキャンバス（960×540）
  run = { tx, ty, frames: Math.max(8, Math.round(Math.hypot(tx - FOOT_X, ty - FOOT_Y) / 16)) };   // 1コマに約16ドット
  setMode('leaving');
}
// つづきから：保存した探索に切り替えてから、OP を消す（チュートリアルと同じ消え方）
function startNew(game) {   // はじめから：ほねっこの迷宮はそのままロゴが抜けて種族えらびへ。CardRogue は文字が降ってきてから
  playGame = game; se('ui_decide'); setTimeout(() => se('dog_bark'), 150);   // 犬の「わんわん」（決定の音のすぐあと。2026-10-10）
  if (game === 'cardrogue') setMode('crDrop'); else enterPress();
}
// ロゴが抜けて市場へ。着せ替えの犬のときは、フリスビーの場面（いつもの犬だけ）がなくて止まって見えるので、ロゴが抜ける少し前から（2026-10-18 ユーザー指定）。
// 市場が明るくなるのは、飛ばした分を数えずに（いきなり明るくならないように）
let pressSkip = 0;
function enterPress() {
  setMode('press');
  pressSkip = playGame === 'cardrogue' ? 15 : dog ? Math.max(0, T.press.dog_gone - 3) : 0;   // CardRogue：群れの終わりのほうが走っているうちにロゴが抜けるよう、15コマ目から
  t0 -= pressSkip * FR;
}
function toResume(game) {
  active = false; cancelAnimationFrame(raf);
  if (!api.resume(game)) { show(); return; }
  root.classList.add('out');
  setTimeout(() => { root.style.display = 'none'; root.classList.remove('out'); }, 700);
}
// 遊び方：前にキャラメイクした見た目（なければいつもの見た目）で、チュートリアルの盤へ（js/tutorial.js）
function toTutorial() {
  active = false; cancelAnimationFrame(raf);
  const l = load(); api.tutorial(l ? { ...l, job: '盗賊' } : l);   // 練習はほねっこの迷宮（盗賊）
  root.classList.add('out');
  setTimeout(() => { root.style.display = 'none'; root.classList.remove('out'); }, 700);
}
function backToSelect() { se('ui_cancel'); fromJob = false; hideWin(); look = null; faceFrames = null; setMode('toSelect'); }
function finish() {
  active = false; cancelAnimationFrame(raf);
  api.replayIntro();                       // ゲームは「この姿で迷宮へ」のときに用意ずみ。階の表示と手札を配る演出だけもう一度
  root.classList.add('out');               // 暗転からゲームの画面へ（CSS の段々の消え方）
  setTimeout(() => { root.style.display = 'none'; root.classList.remove('out'); }, 700);
}

// ---------------------------------------------------------------- 入力
function hitAt(ev) {
  const r = cv.getBoundingClientRect(), x = Math.floor((ev.clientX - r.left) / r.width * HIT.w), y = Math.floor((ev.clientY - r.top) / r.height * HIT.h);
  return x >= 0 && y >= 0 && x < HIT.w && y < HIT.h ? HIT.px[y * HIT.w + x] : 0;
}
function inJob(ev) {
  const b = jobBox(); if (!b) return false;
  const r = cv.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * CW, y = (ev.clientY - r.top) / r.height * CH;
  return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
}
function inSide(ev) {   // 左右のほかの職業のどれを押したか（-1・1、なければ 0）
  const r = cv.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * CW, y = (ev.clientY - r.top) / r.height * CH;
  for (const sd of sideJobs()) { const b = sideBox(sd); if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return sd.d; }
  return 0;
}
function onMove(ev) {
  if (mode === 'select') { const n = hitAt(ev); cv.style.cursor = n ? 'pointer' : ''; setHover(n); }
  else if (mode === 'job') cv.style.cursor = inJob(ev) || inSide(ev) ? 'pointer' : '';
}
function onClick(ev) {
  api.startAudio();
  if (mode === 'intro') { t0 -= T.intro.frames * FR; return; }      // 登場を飛ばす
  if (mode === 'idle') { showMenu(); return; }
  if (rankOpen) { closeRank(); return; }                             // ハイスコアの窓の外を押した
  if (mode === 'select') { const n = hitAt(ev); if (n && !locked) lock(n); else if (!n && locked) unlock(); }
  else if (mode === 'job') { const sd = inSide(ev); if (sd) stepJob(sd); else if (inJob(ev)) { cv.style.cursor = ''; enterCreate(); } }   // 左右の職業を押すと、それがまん中に
}
function onMenuClick(ev) { const b = ev.target.closest('button'); if (!b || b.disabled) return; api.startAudio(); pickMenu(+b.dataset.menu); runMenu(+b.dataset.menu); }
function onMenuHover(ev) { const b = ev.target.closest('button'); if (b) pickMenu(+b.dataset.menu); }
function onWinClick(ev) {
  const b = ev.target.closest('button');
  if (!b) { const bd = el.win.querySelector('.bd'); if (bd?.dataset.full && bd.textContent !== bd.dataset.full) { clearTimeout(typing); bd.textContent = bd.dataset.full; } return; }
  const d = b.dataset;
  if (d.act === 'yes') playGame === 'cardrogue' ? enterJob() : enterCreate();
  else if (d.act === 'no') unlock();
  else if (d.act === 'go') confirmCreate();
  else if (d.act === 'repick') backToSelect();
  else if (d.styleStep) { const ST = stylesNow(), i = Math.max(0, ST.findIndex(s => s[0] === look.style)), n = ST.length; changeLook({ style: ST[(i + Number(d.styleStep) + n) % n][0] }); }
  else if (d.hair) changeLook({ hair: d.hair });
  else if (d.iris) changeLook({ iris: d.iris });
  else if (d.hood) changeLook({ hood: d.hood === '1' });
  else if (d.ota) {                                           // 付ける／はずす。眼鏡と赤い眼鏡のように同じ組のものは、どちらか1つだけ
    const s = new Set(look.ota || []), O = globalThis.Otakara, u = O.list.find(x => x.id === d.ota);
    if (s.has(d.ota)) s.delete(d.ota);
    else { if (u?.group) for (const x of O.list) if (x.group === u.group) s.delete(x.id); s.add(d.ota); }
    const patch = { ota: [...s] };
    const hoodType = look.hood && O.list.find(x => x.kind === 'hood' && s.has(x.id))?.part;   // いまかぶっているフードの種類（もこもこフードなど）
    const hoodOk = globalThis.FACE_DATA?.accessories?.[u?.part]?.hoodOk || [];
    if (u?.group === 'かぶりもの' && s.has(d.ota) && !(hoodType && hoodOk.includes(hoodType))) patch.hood = false;   // かぶりもの（帽子・バンダナ）を付けたら、フードを自動で外す（フードのままだと出ないため。2026-10-10 ユーザー指定）。ヒツジの角＋もこもこフードは一緒に付けられる（2026-10-20）
    if (u?.kind === 'hood' && s.has(d.ota)) patch.hood = true;   // フードの種類を付けたら、フードをかぶる
    changeLook(patch);
  }
}
function onKey(ev) {
  if (!active || globalThis.Inn?.active) return;   // 宿屋の間は宿屋（とその上のエンディング）がキーを受ける（js/inn.js）
  ev.stopImmediatePropagation();    // OP のあいだはゲームのキーを止める
  if (ev.repeat) return;
  const k = ev.key, ok = k === 'Enter' || k === ' ';
  api.startAudio();
  if (rankOpen) {                                               // ハイスコアの窓：左右で札を切り替え、Esc・Enter でもどる
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && rankTab !== 'ota') { se('ui_cursor'); setRankTab(rankTab === 'local' ? 'online' : 'local'); }
    else if (k === 'ArrowUp' || k === 'ArrowDown') el.rank.querySelector('.list')?.scrollBy({ top: (k === 'ArrowUp' ? -1 : 1) * 120 });   // 上下でリストを動かす
    else if (k === 'Escape' || ok) closeRank();
    ev.preventDefault(); return;
  }
  if (mode === 'intro') onClick({});
  else if (mode === 'idle') showMenu();
  else if (mode === 'menu') {
    if (k === 'ArrowRight' || k === 'ArrowDown') stepMenu(1);
    else if (k === 'ArrowLeft' || k === 'ArrowUp') stepMenu(-1);
    else if (ok) runMenu(menuSel);
    else if (k === 'Escape' && sub) runMenu(menuItems().length - 1);   // 「どちらを遊ぶ？」から、もとのメニューへ
  } else if (mode === 'select') {
    const i = ORDER.indexOf(locked || hover);
    if (!locked && (k === 'ArrowRight' || k === 'ArrowDown')) setHover(ORDER[(i + 1) % ORDER.length]);
    else if (!locked && (k === 'ArrowLeft' || k === 'ArrowUp')) setHover(ORDER[(i - 1 + ORDER.length) % ORDER.length]);
    else if (ok) locked ? (playGame === 'cardrogue' ? enterJob() : enterCreate()) : lock(hover);
    else if (k === 'Escape') { if (locked) unlock(); else show(); }
  } else if (mode === 'job') {
    if (k === 'ArrowLeft' || k === 'ArrowUp') stepJob(-1);
    else if (k === 'ArrowRight' || k === 'ArrowDown') stepJob(1);
    else if (ok) enterCreate();
    else if (k === 'Escape') backFromJob();
  } else if (mode === 'create') {
    if (k === 'Enter') confirmCreate(); else if (k === 'Escape') backToSelect();
  }
  ev.preventDefault();
}

// ---------------------------------------------------------------- 起動
async function init(a) {
  api = a;
  root = $('#op'); cv = $('#op-cv'); g = cv.getContext('2d');
  Object.assign(el, { menu: $('#op-menu'), toast: $('#op-toast'), hint: $('#op-hint'), win: $('#op-win'), rank: $('#op-rank') });
  el.rank.addEventListener('click', onRankClick);
  el.back = $('#op-back');
  el.notice = $('#op-notice');
  el.notice?.addEventListener('click', ev => { ev.stopPropagation(); el.notice.classList.remove('show'); });
  el.inn = $('#op-inn');   // 宿屋（猫の育成、js/inn.js。2026-10-20）：ダンディ・キャットを倒して戻ると押せる
  el.inn?.addEventListener('click', ev => {
    ev.stopPropagation(); api.startAudio();
    if (el.inn.disabled || !globalThis.Inn) return;
    el.notice?.classList.remove('show');
    se('ui_decide'); rankOpen = false; el.rank.classList.remove('show'); el.menu.classList.remove('show'); el.toast.textContent = '';
    Inn.open(() => showMenu(true));   // もどったらメニューへ
  });
  el.job = $('#op-job');
  el.job.querySelectorAll('.arr').forEach(b => { const l = b.dataset.d === '-1'; b.innerHTML = `<img class="n" src="${arrowDot('#fbf3e2', l)}" alt=""><img class="h" src="${arrowDot('#f0b84a', l)}" alt="">`; });
  el.job.addEventListener('click', ev => { ev.stopPropagation(); api.startAudio(); const b = ev.target.closest('button'); if (b) stepJob(+b.dataset.d); else if (ev.target.closest('.nm')) enterCreate(); });
  el.back.addEventListener('click', ev => { ev.stopPropagation(); api.startAudio(); se('ui_cancel'); show(); });   // はじめからを選んだあと、タイトルへもどる
  cv.addEventListener('mousemove', onMove); cv.addEventListener('click', onClick);
  el.menu.addEventListener('click', onMenuClick); el.menu.addEventListener('mousemove', onMenuHover);
  el.win.addEventListener('click', onWinClick);
  addEventListener('keydown', onKey, true);
  addEventListener('resize', () => { if (active && mode === 'select' && !locked) setTimeout(() => renderSelect(hover), 0); });   // 決める前なら測り直す
  const skipop = /[?&]skipop\b/.test(location.search);
  if (skipop) { root.style.display = 'none'; api.begin(load(), true); }
  ready = prepare();                     // OP を飛ばしたときも素材は裏で読んでおく（エンディングのあとやメニューの「タイトルへ」で OP にもどるため）
  if (!skipop) { await ready; show(); }
}
let ready = null;
async function prepare() {
  const D = globalThis.OP_DATA; T = D.title;
  const bin = Uint8Array.from(atob(D.hit), c => c.charCodeAt(0));
  HIT = { w: D.w, h: D.h, px: new Uint8Array(await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()) };
  const P = 'img/op/';
  const [market, introL, introD, idleD, pressL, pressD, ...ols] = await Promise.all([
    'market', 'title_intro_letters', 'title_intro_deco', 'title_idle_deco', 'title_press_letters', 'title_press_deco', 1, 2, 3, 4, 5, 6,
  ].map(n => loadImg(P + (typeof n === 'number' ? `outline_${n}` : n) + '.png')));
  Object.assign(img, { market, introL, introD, idleD, pressL, pressD });
  ols.forEach((o, i) => { img['ol' + (i + 1)] = o; img['cut' + (i + 1)] = personCut(i + 1, o); });
  try { await document.fonts.load("100 29px 'IBM Plex Sans JP'", '電網適応アイドレス'); } catch {}
  try { await document.fonts.load("16px MaruMonica", 'CardRogue'); } catch {}   // CardRogue の文字
  if (globalThis.OP_RUN) img.run = await loadImg(OP_RUN.src);                     // CardRogue の OP の走る犬
}
// 種族えらびで、選んだ人だけ明るく見せるための切り抜き（市場の絵の、その人の白い縁の内側だけ）。
// 当たり（HIT）は白い縁の内側を塗ったもの（切れ目と画面の下の端を閉じ、手前の人が上。OP_20261008/作業/ゲームへ書き出し.py）なので、その人の当たりから縁を除いた所
function personCut(n, ol) {
  const W = HIT.w, H = HIT.h, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(ol, 0, 0, W, H); const line = x.getImageData(0, 0, W, H).data;
  x.clearRect(0, 0, W, H); x.drawImage(img.market, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H);
  for (let i = 0; i < W * H; i++) if (HIT.px[i] !== n || line[i * 4 + 3]) d.data[i * 4 + 3] = 0;
  x.putImageData(d, 0, 0);
  return c;
}
// タイトルの犬の着せ替え（2026-10-10）：ページを開いて最初のタイトルはいつもの犬。2回目から（帰還・中断・ゲームオーバーなどでもどったとき）は、
// ドット犬アニメ（js/op_dogs.js）からランダムに1匹。いつもの犬のいる所（DOG_BOX、飾りのキャンバス 240×135 の座標）を消して、そこへ左向きに置く
const DOG_BOX = [186, 58, 240, 90];
const DOG_FOOT = { right: 219, bottom: 85 };   // いつもの犬の右端と足もと
let shownOnce = false, dog = null, landed = 0;   // landed：登場でロゴの着地音を鳴らした数
const dogImgs = (globalThis.OP_DOGS || []).map(d => { const im = new Image(); im.src = d.src; return { ...d, im, total: d.ms.reduce((a, b) => a + b, 0) }; });
function drawDog(now, dx = 0) {   // dx：右へのずれ（飾りのキャンバスのドット）
  const d = dog; if (!d.im.complete) return;
  let t = now % d.total, f = 0; while (t >= d.ms[f]) t -= d.ms[f++];
  const x = DOG_FOOT.right - d.w + Math.round(dx), y = DOG_FOOT.bottom - d.h;
  g.save(); g.translate((x + d.w) * 4, y * 4); g.scale(-1, 1);   // 犬の絵は右向きなので反転して左向きに
  g.drawImage(d.im, f * d.w, 0, d.w, d.h, 0, 0, d.w * 4, d.h * 4); g.restore();
}
async function show() {     // タイトルから（メニューの「タイトルへ」、エンディングのあと、ゲームオーバーの「タイトルへ」からも）
  if (!T) await ready;
  dog = shownOnce && dogImgs.length ? dogImgs[Math.floor(Math.random() * dogImgs.length)] : null;
  landed = 0;
  shownOnce = true;
  globalThis.Tutorial?.stop();
  globalThis.Music?.title();     // タイトルの曲（バグパイプの曲ができるまでは無音）
  root.style.display = ''; active = true; look = null; faceFrames = null; locked = 0; hover = 0; menuSel = 0; sub = null; playGame = 'classic'; packT0 = 0;
  hideWin(); el.menu.classList.remove('show'); el.hint.classList.remove('show'); el.toast.textContent = '';
  rankOpen = false; el.rank.classList.remove('show');
  setMode('intro'); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
}
globalThis.Opening = { init, show, get active() { return active; } };
})();
