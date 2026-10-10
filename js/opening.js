// ほねっこの迷宮 — OP（タイトル → メニュー → 種族えらび → キャラメイク）
// game3d.js が起動時に Opening.init(api) を呼ぶ。キャラメイクが終わったら api.begin(look) でゲームを始める。
//
// 流れ（1コマ80ms。タイトルのコマはロゴ制作セッションの成果、img/op/title_*.png）
//  1. 登場：ロゴが落ちてきて、犬が出てくると同時に市場の絵（乗算で暗くした）がゆっくり出る
//  2. 待機：犬が尻尾を振り、START が明滅。押すとメニュー（はじめから・つづきから・遊び方・ハイスコア・おたから）
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
const MENU = [['new', 'はじめから'], ['cont', 'つづきから'], ['help', '遊び方'], ['score', 'ハイスコア'], ['treasure', 'おたから']];
// キャラメイクの選びどころ（顔グラ FaceKit の look）
const STYLES = [['元の髪', 'いつもの'], ['ショートカット', 'ショートカット'], ['オールバック', 'オールバック'], ['センターパート', 'センターパート'], ['七三分けロング', '七三分けロング'], ['ポニーテール', 'ポニーテール']];
const HAIRS = [['東国人', '#2c3a48', '#18222d', '黒'], ['西国人', '#6e655a', '#4a4640', '灰'], ['南国人', '#f0b84a', '#8a5a38', '金'], ['北国人', '#b8c4cc', '#7a8e9c', '銀'], ['森国人', '#cca673', '#8a5a38', '亜麻'], ['はてない国人', '#d24a3c', '#8f2f2b', '赤']];
const IRISES = [['琥珀', '#ae6f47', '#f0b84a'], ['青', '#425c8d', '#4aa3e8'], ['緑', '#5c7236', '#8eaa48'], ['茶', '#5c422c', '#8a5a38'], ['赤', '#d24a3c', '#e7a08a']];
const BIG = 3, FOOT_X = 398, FOOT_Y = 420, FACE_X = 24, FACE_Y = CH - 96 * BIG;   // キャラメイクの左側（顔は画面の下のふちに胸もと）

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
  el.back?.classList.toggle('show', ['select', 'toCreate', 'create', 'toSelect'].includes(m));   // 種族えらび・キャラメイクの間は左上に「タイトルへ」
  // 種族えらびの間は、画面の上のまん中に「群衆から種族をえらんでください。」（2026-10-09 もどした。窓の中だと窓が画面からはみ出すので、群衆の上に）
  if (el.hint) { el.hint.textContent = '群衆から種族をえらんでください。'; el.hint.classList.toggle('show', m === 'select'); }
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
  } else if (mode === 'idle' || mode === 'menu') {
    market(1, 1);
    thinText(); sheet(img.introL, I.letters, I.frames - 1, 6); sheet(img.idleD, D.deco, k % D.frames, 4, [mode === 'menu' && T.startBox, dog && DOG_BOX].filter(Boolean));
    if (dog) drawDog(now);
  } else if (mode === 'press') {
    const p = Math.min(k + 1, P.frames - 1);                   // 1コマ目から（START はメニューを出したときに消えている）
    market(1, 1 - ease(k / 40));                              // 乗算がゆっくり抜けて明るくなる
    thinText(P.thin_dx[p]); sheet(img.pressL, P.letters, p, 6);
    if (!dog) sheet(img.pressD, P.deco, p, 4);
    else {   // 着せ替えの犬：フリスビーは飛んでこない（いつもの犬がくわえる場面を飛ばす）。犬は字といっしょに右へ抜ける
      if (p < P.dog_gone) sheet(img.idleD, D.deco, 0, 4, [T.startBox, DOG_BOX]); else sheet(img.pressD, P.deco, p, 4);
      if (P.thin_dx[p] !== null) drawDog(now, P.thin_dx[p] / 2);
    }
  } else if (mode === 'select') {
    const who = locked || hover;
    market(1, who && img['cut' + who] ? 1 : 0);                // 選んだ人のほかは乗算で暗く（2026-10-09）
    if (who && img['cut' + who]) g.drawImage(img['cut' + who], 0, 0, CW, CH);   // 選んだ人だけ、明るいまま
    if (who && img['ol' + who]) g.drawImage(img['ol' + who], 0, 0, CW, CH);
  } else if (mode === 'leaving') {
    drawLeaving(k);
  } else {   // toCreate・create・toSelect
    const a = mode === 'toCreate' ? ease(k / 6) : mode === 'toSelect' ? 1 - ease(k / 6) : 1;
    market(1, a, 0.35 * a);
    if (mode !== 'toSelect') drawCreate(now, a);
  }
}
// 「この姿で迷宮へ」のあと（コマ k）：立ち絵がその場で 3倍 → 2倍 → 盤と同じ大きさ（1粒＝1ドット）に縮み、
// 盤の最初のマスへ走っていく。走るあいだに市場が暗くなり、真っ暗で着いたら OP が消えてゲームの画面になる（主人公はちょうどその位置）
const SHRINK = [3, 3, 2, 2, 1, 1];   // 縮むコマ（倍率）
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
  const im = api.spr(api.PGROUP, name, flip, api.hairSwap(effLook().hair));
  g.drawImage(im, Math.round(x - im.width * s / 2), y - api.ground * s, im.width * s, im.height * s);
}
function drawCreate(now, a) {
  if (faceFrames) { g.globalAlpha = a; g.drawImage(faceFrames[Math.floor(now / 1000 * faceFps) % faceFrames.length], FACE_X, FACE_Y, 96 * BIG, 96 * BIG); g.globalAlpha = 1; }
  const im = api.spr(api.PGROUP, `fr_idle_${(now % 1460) < 820 ? 0 : 1}`, false, api.hairSwap(effLook().hair));
  g.globalAlpha = a; g.drawImage(im, Math.round(FOOT_X - im.width * BIG / 2), FOOT_Y - api.ground * BIG, im.width * BIG, im.height * BIG); g.globalAlpha = 1;
}

// ---------------------------------------------------------------- 毎コマ
function tick(now) {
  if (!active) return;
  const st = root.parentElement;                 // ボタンにフォーカスが移ると #stage がスクロールして下の手札がのぞくので、0に戻す
  if (st.scrollTop || st.scrollLeft) { st.scrollTop = 0; st.scrollLeft = 0; }
  const k = frameNo(now);
  if (mode === 'intro' && k >= T.intro.frames) setMode('idle');
  else if (mode === 'press' && k >= T.press.exit_start + 12) enterSelect();   // ロゴと骨が抜けきったら
  else if (mode === 'toCreate' && k >= 6) setMode('create');
  else if (mode === 'toSelect' && k >= 6) enterSelect();
  else if (mode === 'leaving' && k >= SHRINK.length + run.frames + 3) finish();
  draw(now);
  raf = requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- メニュー
// 選べない項目：「つづきから」は、保存した探索がないときはグレーにして選べない（カーソルも止まらない）
const menuOff = i => MENU[i][0] === 'cont' && !api.saveInfo?.();
function showMenu() {
  setMode('menu'); se('ui_start');
  if (menuOff(menuSel)) menuSel = 0;
  el.menu.innerHTML = MENU.map(([id, nm], i) => `<button class="mm w${i === menuSel ? ' on' : ''}${menuOff(i) ? ' off' : ''}" data-menu="${i}"${menuOff(i) ? ' disabled' : ''}>${esc(nm)}</button>`).join('');
  el.menu.classList.add('show'); el.toast.textContent = '';
}
function stepMenu(d) {                                        // 上下キー：選べない項目は飛ばす
  let i = menuSel;
  do i = (i + d + MENU.length) % MENU.length; while (menuOff(i) && i !== menuSel);
  pickMenu(i);
}
function pickMenu(i) {
  if (menuOff(i)) return;
  if (i !== menuSel) se('ui_cursor');
  menuSel = i; [...el.menu.children].forEach((b, j) => b.classList.toggle('on', j === i));
  el.toast.textContent = MENU[i][0] === 'cont' ? contInfo() : '';
}
function contInfo() {                                         // 「つづきから」の中身：B7F　112ターン　10/9 21:30 に中断
  const d = api.saveInfo?.(); if (!d) return 'つづきから遊べる探索はありません';
  const t = new Date(d.savedAt);
  return `B${d.floor}F　${d.turn}ターン　${t.getMonth() + 1}/${t.getDate()} ${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')} の続き`;
}
function runMenu(i) {
  const id = MENU[i][0];
  if (id === 'new') { se('ui_decide'); setTimeout(() => se('dog_bark'), 150); el.menu.classList.remove('show'); el.toast.textContent = ''; setMode('press'); return; }   // 犬の「わんわん」（決定の音のすぐあと。2026-10-10）
  if (id === 'score' && globalThis.Ranking) { se('ui_decide'); openRank(); return; }
  if (id === 'treasure' && globalThis.Otakara) { se('ui_decide'); openOta(); return; }
  if (id === 'cont') {                                         // つづきから：保存した探索があれば、そこから
    if (!api.saveInfo?.()) { se('ui_cancel'); el.toast.textContent = 'つづきから遊べる探索はありません'; return; }
    se('ui_decide'); el.menu.classList.remove('show'); el.toast.textContent = ''; toResume(); return;
  }
  if (id === 'help' && globalThis.Tutorial) { se('ui_decide'); el.menu.classList.remove('show'); el.toast.textContent = ''; toTutorial(); return; }
  se('ui_cancel'); el.toast.textContent = `「${MENU[i][1]}」は準備中です`;
}

// ---------------------------------------------------------------- ハイスコア（js/ranking.js）
// メニューの上に窓を重ねる。上の札で「このブラウザ」（ここに残した記録）と「オンライン」（みんなの記録。送り先があるとき）を切り替える。
// どちらも上位10件。もどる（Esc・Enter・窓の外を押す）でメニューへ。左右キーで札を切り替える。
// このブラウザ：記録をテキストで書き出す（クリップボード。テストプレイの結果を送ってもらう用）・消す
// オンライン：開くたびに読み直す（「更新」でも）。自分の記録は水色。まだ送れていない記録があれば、先に送り直す
let rankOpen = false, clearArmed = false, rankTab = 'local', onlineData = null, onlineSeq = 0;
function openRank() {
  rankOpen = true; clearArmed = false;
  el.menu.classList.remove('show'); el.toast.textContent = '';
  el.rank.classList.add('show'); setRankTab(rankTab);
}
// おたから：ハイスコアと同じ窓に、おたからを1つずつ札で並べる。持っているものはアイコン・名前・説明、まだのものは影と条件だけ
function openOta() {
  rankOpen = true; rankTab = 'ota';
  el.menu.classList.remove('show'); el.toast.textContent = '';
  const O = globalThis.Otakara;
  el.rank.innerHTML = `<div class="t mm w"><span>おたから</span><small class="mm m">${O.count()} / ${O.list.length}</small></div><div class="list ota">`
    + O.list.map(u => {
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
  const R = globalThis.Ranking, seq = ++onlineSeq;
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
    + `<span class="face">${pic ? `<img src="${pic}" alt="">` : ''}</span>`
    + `<span class="who"><span class="nm mm">${esc(e.name)}</span><span class="sc mm">${Number(e.score).toLocaleString()}<small class="mm l">点</small></span></span>`
    + `<span class="how mm"><span class="mm l">${R.reach(e)}</span><br>${e.turns}<small class="mm l">ターン</small>　${R.mmss(e.ms)}</span></div>`;
}).join('') + '</div>';
function renderRank(note = '') {
  const R = globalThis.Ranking, online = rankTab === 'online';
  const tabs = `<span class="tabs"><button class="mm m tab${online ? '' : ' on'}" data-act="tab-local">このブラウザ</button><button class="mm m tab${online ? ' on' : ''}" data-act="tab-online">オンライン</button></span>`;
  let body, info, btns;
  if (!online) {
    const all = R.list(), top = all.slice(0, 10);
    info = `このブラウザの記録　${all.length}件`;
    body = top.length ? rankRows(top, () => false)
      : '<p class="empty mm l">まだ記録はありません。<br><small class="mm m">帰還の巻物で地上へ帰るか、地下30階を踏破すると記録されます。</small></p>';
    btns = top.length ? `<button class="mm m" data-act="copy">記録を書き出す</button><button class="mm m${clearArmed ? ' warn' : ''}" data-act="clear">${clearArmed ? '本当に消す？' : '記録を消す'}</button>` : '';
  } else if (!R.online.enabled) {
    info = ''; btns = '';
    body = '<p class="empty mm l">オンラインの送り先が、まだ設定されていません。<br><small class="mm m">js/ranking_config.js に送り先の URL を入れると使えます。</small></p>';
  } else if (!onlineData) {
    info = ''; btns = ''; body = '<p class="empty mm l">読み込んでいます…</p>';
  } else if (!onlineData.ok) {
    info = ''; btns = '<button class="mm m" data-act="reload">もう一度</button>';
    body = '<p class="empty mm l">つながりませんでした。<br><small class="mm m">インターネットにつながっているか確かめて、もう一度読んでください。</small></p>';
  } else {
    info = `みんなの記録　${onlineData.total}件`; btns = '<button class="mm m" data-act="reload">更新</button>';
    body = onlineData.list.length ? rankRows(onlineData.list, e => R.mine(e.id)) : '<p class="empty mm l">まだ記録はありません。</p>';
  }
  el.rank.innerHTML = `<div class="t mm w"><span>ハイスコア</span>${tabs}<small class="mm m">${info}</small></div>${body}`
    + `<div class="acts"><span class="note mm m">${esc(note)}</span>${btns}<button class="mm m primary" data-act="back">もどる</button></div>`;
}
async function copyRank() {
  const text = globalThis.Ranking.text();
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
    else { globalThis.Ranking.clear(); clearArmed = false; se('ui_decide'); renderRank('記録を消しました'); }
  }
}

// ---------------------------------------------------------------- 種族えらび
function enterSelect() {
  setMode('select'); hover = 0; locked = 0; setHover(5);   // 最初は東国人を選んだ状態（カーソルが人に乗っていなくても）
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
  const nation = PEOPLE[locked].id, prev = load();
  look = { style: '元の髪', hood: true, nation, hair: nation, iris: '琥珀' };
  if (prev && prev.nation === nation) Object.assign(look, { style: prev.style, hood: prev.hood, hair: prev.hair, iris: prev.iris });
  look.ota = (prev?.ota || []).filter(id => globalThis.Otakara?.has(id));   // 付けていたおたから（持っているものだけ）
  faceFrames = null; rebuildFace(); se('ui_decide');
  renderCreate(); setMode('toCreate');
}
// 髪型と髪の色の選択肢（おたからの「メカクレ」「紫黒」を持っていれば増える）
const stylesNow = () => STYLES.concat(globalThis.Otakara?.has('メカクレ') ? [['メカクレ', 'メカクレ']] : []);
const hairsNow = () => HAIRS.concat(globalThis.Otakara?.has('紫黒') ? [['紫黒', '#2b3e6d', '#0e1c3f', '紫黒']] : []);
function renderCreate() {
  const sw = (key, list, cur) => list.map(([id, a, b, nm]) => `<button class="sw${id === cur ? ' on' : ''}" data-${key}="${esc(id)}" title="${esc(nm || id)}" style="--a:${a};--b:${b}"></button>`).join('');
  const ST = stylesNow(), si = Math.max(0, ST.findIndex(s => s[0] === look.style));
  el.win.innerHTML = `<div class="t mm w">すがたをきめる<small class="mm w">${esc(look.nation)}</small></div>
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
  const have = O.list.filter(u => (u.kind === 'acc' || u.kind === 'outfit') && O.has(u.id)); if (!have.length) return '';
  const on = look.ota || [];
  return `<span class="lab mm w">おたから</span><span class="sws ota">${have.map(u => `<button class="ob${on.includes(u.id) ? ' on' : ''}" data-ota="${esc(u.id)}" title="${esc(u.name)}"></button>`).join('')}</span>`;
}
function paintOtaButtons() {   // ボタンの中にアイコン（キャンバス）を入れる
  el.win.querySelectorAll('button[data-ota]').forEach(b => { b.innerHTML = ''; b.appendChild(globalThis.Otakara.icon(b.dataset.ota)); });
}
function changeLook(patch) { se('ui_cursor'); Object.assign(look, patch); rebuildFace(); renderCreate(); }
function confirmCreate() {
  se('ui_decide'); save(look); hideWin();
  api.begin({ ...look });                                    // ゲーム（B1F）を OP の裏で用意して、主人公の最初のマスを知る
  const f = api.playerFoot(), tx = f.x * 2, ty = f.y * 2;    // ゲーム画面（480×270）→ OP のキャンバス（960×540）
  run = { tx, ty, frames: Math.max(8, Math.round(Math.hypot(tx - FOOT_X, ty - FOOT_Y) / 16)) };   // 1コマに約16ドット
  setMode('leaving');
}
// つづきから：保存した探索に切り替えてから、OP を消す（チュートリアルと同じ消え方）
function toResume() {
  active = false; cancelAnimationFrame(raf);
  if (!api.resume()) { show(); return; }
  root.classList.add('out');
  setTimeout(() => { root.style.display = 'none'; root.classList.remove('out'); }, 700);
}
// 遊び方：前にキャラメイクした見た目（なければいつもの見た目）で、チュートリアルの盤へ（js/tutorial.js）
function toTutorial() {
  active = false; cancelAnimationFrame(raf);
  api.tutorial(load());
  root.classList.add('out');
  setTimeout(() => { root.style.display = 'none'; root.classList.remove('out'); }, 700);
}
function backToSelect() { se('ui_cancel'); hideWin(); look = null; faceFrames = null; setMode('toSelect'); }
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
function onMove(ev) { if (mode === 'select') { const n = hitAt(ev); cv.style.cursor = n ? 'pointer' : ''; setHover(n); } }
function onClick(ev) {
  api.startAudio();
  if (mode === 'intro') { t0 -= T.intro.frames * FR; return; }      // 登場を飛ばす
  if (mode === 'idle') { showMenu(); return; }
  if (rankOpen) { closeRank(); return; }                             // ハイスコアの窓の外を押した
  if (mode === 'select') { const n = hitAt(ev); if (n && !locked) lock(n); else if (!n && locked) unlock(); }
}
function onMenuClick(ev) { const b = ev.target.closest('button'); if (!b || b.disabled) return; api.startAudio(); pickMenu(+b.dataset.menu); runMenu(+b.dataset.menu); }
function onMenuHover(ev) { const b = ev.target.closest('button'); if (b) pickMenu(+b.dataset.menu); }
function onWinClick(ev) {
  const b = ev.target.closest('button');
  if (!b) { const bd = el.win.querySelector('.bd'); if (bd?.dataset.full && bd.textContent !== bd.dataset.full) { clearTimeout(typing); bd.textContent = bd.dataset.full; } return; }
  const d = b.dataset;
  if (d.act === 'yes') enterCreate();
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
    changeLook({ ota: [...s] });
  }
}
function onKey(ev) {
  if (!active) return;
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
  } else if (mode === 'select') {
    const i = ORDER.indexOf(locked || hover);
    if (!locked && (k === 'ArrowRight' || k === 'ArrowDown')) setHover(ORDER[(i + 1) % ORDER.length]);
    else if (!locked && (k === 'ArrowLeft' || k === 'ArrowUp')) setHover(ORDER[(i - 1 + ORDER.length) % ORDER.length]);
    else if (ok) locked ? enterCreate() : lock(hover);
    else if (k === 'Escape') { if (locked) unlock(); else show(); }
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
  root.style.display = ''; active = true; look = null; faceFrames = null; locked = 0; hover = 0; menuSel = 0;
  hideWin(); el.menu.classList.remove('show'); el.hint.classList.remove('show'); el.toast.textContent = '';
  rankOpen = false; el.rank.classList.remove('show');
  setMode('intro'); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
}
globalThis.Opening = { init, show, get active() { return active; } };
})();
