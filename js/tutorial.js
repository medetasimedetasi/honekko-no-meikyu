// チュートリアル（OP のメニューの「遊び方」から）。練習用の盤と手札を組んで、左下の顔がしゃべる吹き出しで案内する。
// 練習1 歩く → 練習2 足踏み（待ちぶせて先に叩く）→ 練習3 「歩く」がないとき（いらないカードを右の窓の「1マス移動に使う」で）
// 吹き出し：1ページずつ、1文字ずつ跳ねて出る。言い終えて次のページがあれば行末に ▼ が上下し、どこを押しても（Enter・スペースでも）次のページ。
//   そのあいだ盤・手札・キーの操作は受け付けない（#tut-veil が画面をおおう）。最後のページを言い終えたら操作できる。字が出ている間は顔が口パク
// ゲーム（game3d.js）とのつなぎ：起動時に Tutorial.init(api)。手番の前に allow(kind, payload) で止められ、手番のあとに after()、
//   階段に着いたら logic の次の階の代わりに descend(st) で次の練習の盤にする。ルール（logic.js）はそのまま使う
(() => {
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const se = name => globalThis.Music?.se(name);
const face = on => globalThis.FaceAnim?.talk?.(on);
let api = null, active = false, li = 0, step = null, el = null, arrived = false;
let used = null;                   // いま通した手番で使ったカードの id（'run' など。カードを使わない手番は null）。after で分かれ道に使う

// 盤：# 壁、. 床、P 主人公、S 階段、r ラット。手札と山札はカードの id（山札は後ろから引く）
// pages：吹き出しのせりふ。1つ＝1ページ（中の1つずつで改行）。押すと次のページ。次のページがある間は、盤の操作を受け付けない（押すと文字送り）
const LESSONS = [
  {
    name: '歩く',
    map: [
      '##########',
      '#........#',
      '#........#',
      '#..##....#',
      '#..#.S...#',
      '#........#',
      '#.P......#',
      '#........#',
      '#........#',
      '##########'],
    hand: ['walk', 'walk', 'run', 'walk', 'walk'],
    draw: ['walk', 'run', 'walk', 'walk', 'walk', 'walk', 'run', 'walk'],
    steps: {
      start: {
        pages: [['チュートリアルをするぞ。', '面倒だろうがクリアしたらおまけがある。奮って参加してほしい。', 'まずは階段を目指して歩いてみろ。'], ['矢印キーか、となりのマスをクリックで1マス進む。', '1マスごとに「歩く」を1枚使って、山札から1枚引くんだ。', '奥の階段まで行ってみろ。']],
        allow: move,
        after: () => 'run',
      },
      run: {
        pages: [['いいぞ。', '「走る」なら2マスまで進める。', '「走る」を選んで、右の窓の「移動に使う」を押すと、進めるマスが光る。押してみろ。']],
        allow: move,
        after: () => (used === 'run' ? 'ran' : 'runHint'),
      },
      runHint: {                        // 「走る」を使わずに歩いた（歩くたびにもう一度）
        pages: [['黒い靴が「走る」カードだ。選択して使え。', '「走る」を選んで、右の窓の「移動に使う」を押してみろ。']],
        allow: move,
        after: () => (used === 'run' ? 'ran' : 'runHint'),
      },
      ran: {                            // 「走る」で進んだ
        pages: [['よし。その調子だ。']],
        allow: move,
      },
    },
  },
  {
    name: '足踏み',
    map: [
      '##########',
      '#........#',
      '#........#',
      '#........#',
      '#.######.#',
      '#.P.r..S.#',
      '#.######.#',
      '#........#',
      '#........#',
      '##########'],
    hand: ['sword', 'walk', 'walk', 'walk', 'walk'],
    draw: ['walk', 'walk', 'walk', 'walk', 'walk', 'walk'],
    steps: {
      start: {
        pages: [['ラットがいるな。倒すぞ。', '敵はとなりにいると攻撃してきて、いないと1マス寄ってくる。', 'いま歩いてとなりに入ると、先に攻撃される。'], ['そこで「足踏み」だ。', '「歩く」を選んで、右の窓の「捨てて引き直す」を押すと、その場で1ターン待てる。']],
        mark: 'discard',
        allow(kind, p, st) {
          if (kind === 'discard') return card(st, p)?.cardId === 'sword' ? '剣はあとで使うので、残しておこう' : true;
          return 'いまは足踏みしてみよう（いらないカードを選んで「捨てて引き直す」）';
        },
        after: st => (adjacentEnemy(st) ? 'attack' : null),
      },
      attack: {
        pages: [['ラットがきたな。 こちらの番だ。'], ['「剣」を選ぶと届くマスが光る。攻撃だ。']],
        allow(kind, p, st) {
          return kind === 'play' && p.mode === 'effect' && HK.cardOf(card(st, p.cardId)).damage ? true : '「剣」でラットを攻撃しよう';
        },
        after: st => (st.enemies.length ? null : 'go'),
      },
      go: {
        pages: [['先に叩けたな。', '寄ってくる敵は、足踏みで待ちぶせると先に攻撃できる。', '階段へ進もう。']],
        allow: move,
      },
    },
  },
  {
    name: '歩くがないとき',
    map: [
      '##########',
      '#........#',
      '#........#',
      '#........#',
      '#..####..#',
      '#.P...S..#',
      '#..####..#',
      '#........#',
      '#........#',
      '##########'],
    hand: ['sword', 'copper', 'shield', 'bread', 'gold'],
    draw: ['copper', 'shield', 'gem', 'sword', 'copper', 'bread'],
    steps: {
      start: {
        pages: [['「歩く」がないな。問題ない。', 'どのカードでも1マスなら進める。効果は出ないが。', '不要なカードを選んで、右の窓の「1マス移動に使う」だ。']],
        mark: 'forced',
        allow: (kind, p) => (kind === 'play' && p.mode === 'forced' ? true : 'いまは「1マス移動に使う」を試そう'),
        after: () => 'arrow',
      },
      arrow: {
        pages: [['よし。 移動に使ったカードは捨て札に行くだけだ。財宝もなくならない。'], ['クリックでもカードを選んで進める。が、自動でカードを捨ててしまう。注意しろ。'], ['慎重な場面では「1マス移動に使う」を使うといい。', '階段へ進もう。']],
        allow: (kind, p) => (kind === 'play' && p.mode === 'forced' ? true : 'いまは移動に使って、階段へ進もう'),
      },
    },
  },
];
const DONE = [['おつかれさま。 基本はこれでおしまいだ。'], ['矢印キーで歩く。足踏みで待ちぶせる。「歩く」がなければ、いらないカードで1マス進む。'], ['では。']];

function move(kind, p, st) { const c = kind === 'play' && card(st, p.cardId); return c && (p.mode === 'forced' || HK.cardOf(c).moveDistance) ? true : 'いまは階段へ歩いていこう'; }
function card(st, id) { return st.hand.find(c => c.id === id); }
function adjacentEnemy(st) { return st.enemies.some(e => Math.abs(e.x - st.player.x) + Math.abs(e.y - st.player.y) === 1); }

// 練習の盤を、いまの状態（st）に組み込む。ルールの外の値は使わない（壁・床・敵・カードの並びだけ決める）
function build(st, L) {
  const map = L.map.map(r => r.replace(/[^#]/g, '.'));
  let player = null, exit = null; const enemies = [];
  L.map.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === 'P') player = { x, y };
    else if (ch === 'S') exit = { x, y };
    else if (ch === 'r') enemies.push({ ...HK.enemyInfo('rat'), type: 'rat', x, y, id: enemies.length, hp: HK.enemyInfo('rat').maxHp });
  }));
  const mk = id => ({ id: st.nextCardId++, cardId: id });
  Object.assign(st, { map, exit, enemies, groundItems: [], floor: 1 });
  Object.assign(st.player, player, { hp: st.player.maxHp, temporaryBlock: 0, temporaryAttack: 0, reflect: false, ember: 0, combo: 0 });
  st.hand = L.hand.map(mk); st.drawPile = L.draw.map(mk).reverse(); st.discardPile = []; st.removedCards = [];
  st.log = [];
}

// ---------------------------------------------------------------- 吹き出しの絵（窓としっぽを1枚のドット絵で。1ドット＝u）
// 縁はほかの窓（game3d.js の pixFrame・半透明の夜色）と同じ重ね方：外から 濃い線／明るい縁2ドット（右下は影の色）／濃い線／影、中は半透明。下に2ドットの落ち影
const BW = 127, BH = 128, TAIL = 17;                 // 窓の幅・高さ、しっぽの長さ（u）
const RINGS = ['#221b17', ['#b8c4cc', '#506573'], ['#7a8e9c', '#506573'], '#221b17', '#0b1120cc'], FILL = '#0b1120cc', DROP = 2;
function bubbleImage() {
  const W = BW, H = BH + TAIL + DROP, R = 6;
  const inRect = (x, y) => {
    const px = x + 0.5, py = y + 0.5;
    if (px < 0 || px > W || py < 0 || py > BH) return false;
    const cx = Math.min(Math.max(px, R), W - R), cy = Math.min(Math.max(py, R), BH - R);
    return (px - cx) ** 2 + (py - cy) ** 2 <= R * R + 0.3;
  };
  // しっぽ：窓の下辺（x 34〜58）から、左下の顔へ向けて細くなる
  const inTail = (x, y) => {
    if (y < BH - 10 || y >= BH + TAIL) return false;
    const t = Math.max(0, (y - BH + 1) / TAIL);
    return x >= Math.round(34 - 8 * t) && x <= Math.round(58 - 26 * t);
  };
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && (inRect(x, y) || inTail(x, y));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), N = RINGS.length;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let col = null;
    if (inside(x, y)) {
      // いちばん近い外のドットまでの距離で、縁の何本目かを決める（外が左上にあれば明るい色、右下なら影の色）
      let best = Infinity, bx = 0, by = 0;
      for (let dy = -N; dy <= N; dy++) for (let dx = -N; dx <= N; dx++) {
        if (inside(x + dx, y + dy)) continue;
        const d = dx * dx + dy * dy; if (d < best) { best = d; bx = dx; by = dy; }
      }
      const k = Math.round(Math.sqrt(best)) - 1;
      const ring = RINGS[k];
      col = k >= N || k < 0 ? FILL : Array.isArray(ring) ? (bx + by < 0 || (bx + by === 0 && by < 0) ? ring[0] : ring[1]) : ring;
    } else if (inside(x, y - DROP)) col = '#00000080';
    if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
  }
  return c.toDataURL();
}
// ▼（行の終わり。金に濃い縁）
function moreImage() {
  const rows = ['ccccccccc', 'cgggggggc', '.cgggggc.', '..cgggc..', '...cgc...', '....c....'];
  const c = document.createElement('canvas'); c.width = 9; c.height = rows.length; const g = c.getContext('2d');
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') { g.fillStyle = ch === 'g' ? '#f0b84a' : '#221b17'; g.fillRect(x, y, 1, 1); } }));
  return c.toDataURL();
}

// ---------------------------------------------------------------- 吹き出し（せりふを1ページずつ）
const CHAR_MS = 40;                // 1文字の間
let talk = null, veil = null;      // talk：{ pages, i, chars, timer, done, then }（then＝最後のページのあとに押したら呼ぶ）
let gift = null;                   // おまけの演出（開いている間の { root, timer, done }）
// 文字送り待ち（言いかけ、次のページがある、最後のあとに続きがある、おまけの演出中）か。このあいだは盤の操作を止める
const holding = () => !!(active && (gift || (talk && (!talk.done || talk.i < talk.pages.length - 1 || talk.then))));
function syncVeil() { veil?.classList.toggle('on', holding()); }
function ensureWin() {
  if (el) return;
  veil = document.createElement('div'); veil.id = 'tut-veil';   // 盤ぜんたいをおおう透明の幕（吹き出しの下）。押すと文字送り
  veil.addEventListener('click', ev => { ev.stopPropagation(); api.startAudio(); advance(); });
  $('#stage').appendChild(veil);
  let eat = null;                                                   // 文字送りに使ったキー：離すまで（押しっぱなしのくり返しも）ゲームに渡さない
  addEventListener('keydown', ev => {                               // 文字送り待ちのあいだ、キーはゲームに渡さない（Esc のメニューだけ通す）
    if (ev.key === eat) { ev.preventDefault(); ev.stopImmediatePropagation(); return; }
    if (!holding() || ev.key === 'Escape') return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    if (!ev.repeat && (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'z' || ev.key === 'Z')) { eat = ev.key; advance(); }
  }, true);
  addEventListener('keyup', ev => { if (ev.key === eat) eat = null; }, true);
  el = document.createElement('div'); el.id = 'tut';
  el.style.setProperty('--bubble', `url(${bubbleImage()})`); el.style.setProperty('--more', `url(${moreImage()})`);
  el.innerHTML = '<div class="t mm l"><span class="hd"></span><button class="mm s" data-act="quit">やめる</button></div><div class="bd mm b"></div><div class="acts"></div>';
  $('#stage').appendChild(el);
  el.addEventListener('click', ev => {
    const b = ev.target.closest('button');
    api.startAudio();
    if (b) { ev.stopPropagation(); return onButton(b.dataset.act); }
    advance();
  });
}
// せりふを始める（前のせりふは消す）。buttons は最後のページを言い終えたら出す
function speak(head, pages, buttons = [], then = null) {
  ensureWin(); el.classList.add('show');
  clearTimeout(talk?.timer);
  el.querySelector('.hd').textContent = head;
  el.querySelector('.acts').innerHTML = '';
  talk = { pages: pages.slice(), i: -1, buttons, then };   // pages は写し（はみ出しで足すページは、その場かぎり）
  nextPage();
}
// 次のページ：吹き出しの中を入れ替えて、ページの行（改行）をつづけて1文字ずつ
function nextPage() {
  const t = talk; t.i++;
  const bd = el.querySelector('.bd'); bd.innerHTML = '';
  for (const line of t.pages[t.i]) {
    const ln = document.createElement('div'); ln.className = 'ln';
    ln.innerHTML = [...line].map(ch => `<span class="ch">${esc(ch)}</span>`).join('');
    bd.appendChild(ln);
  }
  // 入りきらないとき（画面の大きさで字の大きさが変わる）：はみ出した行を、すぐ次のページへ送る（▼の分もみて）
  const probe = document.createElement('i'); probe.className = 'more'; bd.lastElementChild.appendChild(probe);
  const carry = [];
  while (bd.children.length > 1 && bd.scrollHeight > bd.clientHeight + 1) {
    carry.unshift(bd.lastElementChild.textContent); bd.lastElementChild.remove();
    bd.lastElementChild.appendChild(probe);
  }
  probe.remove();
  if (carry.length) t.pages.splice(t.i + 1, 0, carry);
  t.chars = [...bd.querySelectorAll('.ch')]; t.n = 0; t.done = false;
  face(true); syncVeil();
  const tick = () => {
    const c = t.chars[t.n++]; if (c) c.classList.add('on');
    if (t.n < t.chars.length) t.timer = setTimeout(tick, CHAR_MS); else pageDone();
  };
  tick();
}
function pageDone() {
  const t = talk; clearTimeout(t.timer); t.done = true; face(false);
  t.chars.forEach(c => c.classList.add('on', 'now'));
  const ln = el.querySelector('.bd .ln:last-child');
  if (t.i < t.pages.length - 1 || t.then) { const m = document.createElement('i'); m.className = 'more'; ln.appendChild(m); }
  else showButtons();
  syncVeil();
}
function showButtons() {
  el.querySelector('.bd .more')?.remove();
  el.querySelector('.acts').innerHTML = talk.buttons.map(([a, tx, c]) => `<button class="mm m ${c || ''}" data-act="${a}">${esc(tx)}</button>`).join('');
}
// 吹き出し（か幕）を押した：言いかけなら言い切る、言い終えていれば次のページ
function advance() {
  if (gift) return closeGift();
  const t = talk; if (!t) return;
  if (!t.done) return pageDone();
  if (t.i < t.pages.length - 1) { se('ui_cursor'); nextPage(); }
  else if (t.then) { const f = t.then; t.then = null; f(); }
}

// ---------------------------------------------------------------- おまけ（チュートリアルを最後までやったときの、おたからの演出）
// 暗くした画面に、回る金の光（キャンバスの中で4コマ）・上から落ちて弾むアイコン（4倍）・名前と説明の窓。押すと閉じて、もう一度／タイトルへ
const RAY = 64;                    // 光のキャンバス（1ドット＝2u）
function rayFrames() {
  const out = [];
  for (let k = 0; k < 4; k++) {
    const c = document.createElement('canvas'); c.width = c.height = RAY; const g = c.getContext('2d');
    for (let y = 0; y < RAY; y++) for (let x = 0; x < RAY; x++) {
      const dx = x + 0.5 - RAY / 2, dy = y + 0.5 - RAY / 2, r = Math.hypot(dx, dy);
      if (r > RAY / 2) continue;
      const a = (Math.atan2(dy, dx) / Math.PI * 180 + 360 + k * 7.5) % 30;   // 12本の光。1コマに 7.5° ずつ回る
      let al = 0;
      if (r < 11) al = 0.35;                                       // まん中のまるい光
      else if (a < 15) al = r < 18 ? 0.5 : r < 25 ? 0.32 : 0.16;   // 光の帯（外ほど薄く、3段）
      if (al) { g.fillStyle = `rgba(240,184,74,${al})`; g.fillRect(x, y, 1, 1); }
    }
    out.push(c.toDataURL());
  }
  return out;
}
let RAYS = null;
function openGift(items, done) {
  RAYS ||= rayFrames();
  const u = items[0], O = globalThis.Otakara;
  const root = document.createElement('div'); root.id = 'tut-gift';
  root.innerHTML = `<div class="hd mm t">チュートリアルクリア！</div><div class="rays"></div><div class="ico"></div>`
    + `<div class="win pixwin"><div class="nm mm l">おたから「${esc(u.name)}」を手に入れた！</div><div class="tx mm m">${esc(u.text)}</div></div>`
    + `<div class="hint mm s">クリックで次へ</div>`;
  root.querySelector('.ico').appendChild(O.icon(u.id));
  root.addEventListener('click', ev => { ev.stopPropagation(); advance(); });
  $('#stage').appendChild(root);
  let f = 0; const rays = root.querySelector('.rays');
  gift = { root, done, timer: setInterval(() => { rays.style.backgroundImage = `url(${RAYS[f++ % 4]})`; }, 160) };
  rays.style.backgroundImage = `url(${RAYS[0]})`;
  requestAnimationFrame(() => root.classList.add('on'));
  se('unlock');                                                   // シュッ（落ちてくる）
  setTimeout(() => { if (gift?.root === root) globalThis.Music?.jingle('tetteree'); }, 380);   // 着いたらテッテレー
  syncVeil();
}
function closeGift() {
  const g = gift; if (!g) return;
  gift = null; clearInterval(g.timer); se('ui_decide');
  g.root.classList.remove('on'); setTimeout(() => g.root.remove(), 250);
  g.done?.(); syncVeil();
}
function nudge(msg) { api.say(msg); se('ui_cancel'); }

function setStep(name) {
  const L = LESSONS[li]; step = name;
  const s = L.steps[name];
  document.body.dataset.tut = s.mark || '';
  speak(`練習 ${li + 1}/${LESSONS.length}　${L.name}`, s.pages);
  se('ui_cursor');
}
function onButton(act) {
  if (act === 'quit') { se('ui_cancel'); return quit(); }
  if (act === 'again') { se('ui_decide'); return start(); }
}

// ---------------------------------------------------------------- 流れ
function start() {
  li = 0; arrived = false;
  api.start(st => build(st, LESSONS[0]), '練習 1');   // ここで newGame が走って stop() されるので、active は後で立てる
  active = true; document.body.classList.add('tut');
  setStep('start');
}
function stop() {
  if (!active) return;
  if (gift) { clearInterval(gift.timer); gift.root.remove(); gift = null; }
  active = false; step = null; clearTimeout(talk?.timer); talk = null; face(false);
  document.body.classList.remove('tut'); delete document.body.dataset.tut;
  el?.classList.remove('show'); syncVeil();
}
function quit() { stop(); api.quit(); }
// 手番の前：いまの段で許す行動か。許さないときは理由を出して止める
function allow(kind, payload) {
  if (!active) return true;
  if (li >= LESSONS.length || holding()) return false;   // 文字送り待ちのあいだは何もしない
  const s = LESSONS[li].steps[step], r = s.allow ? s.allow(kind, payload, api.st) : true;
  if (r === true) { used = kind === 'play' ? card(api.st, payload.cardId)?.cardId ?? null : null; return true; }
  nudge(r); return false;
}
// 手番のあと：次の段へ（階段を降りた手番なら、次の練習のはじめ・おしまいのせりふ）
function after() {
  if (!active) return;
  if (arrived) {
    arrived = false;
    if (li < LESSONS.length) return setStep('start');
    document.body.dataset.tut = '';
    const O = globalThis.Otakara, got = O ? O.forTutorial() : [];   // おまけ：おたから（めがね）。はじめて最後までやったときだけ。着いたときに手に入れ、演出はせりふのあと
    for (const u of got) O.add(u.id);
    speak('おしまい', DONE, [['again', 'もう一度'], ['quit', 'タイトルへ', 'primary']], got.length ? () => openGift(got, showButtons) : null); se('ui_decide');
    return;
  }
  if (li >= LESSONS.length) return;
  const s = LESSONS[li].steps[step], next = s.after?.(api.st);
  if (next) setStep(next);
}
// 階段に着いた（logic の次の階の代わり）。次の練習の盤にする。降りる動きのあとで after() がせりふを替える
function descend(st) {
  li++; arrived = true;
  if (li < LESSONS.length) build(st, LESSONS[li]);
}
function banner() { return li < LESSONS.length ? `練習 ${li + 1}` : 'おしまい'; }

globalThis.Tutorial = { init(a) { api = a; }, start, stop, allow, after, descend, banner, get active() { return active; } };
})();
