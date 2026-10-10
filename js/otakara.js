// ほねっこの迷宮 — おたから（コレクション・キャラメイクの着せ替え）。2026-10-09
// 帰還・踏破のエンディングで、その探索のスコアがしきい値を超えると手に入る（js/ending.js）。手に入れたものはこのブラウザに残す。
// 見る所：OP のメニューの「おたから」（js/opening.js。まだのものは影と条件だけ）。使う所：キャラメイクの「おたから」の欄。
// アイコンは js/otakara_assets.js（おたから_20261008/作業/アイコンを打つ.py が書き出す 18×18）。
//   Otakara.list            おたからの一覧（id・名前・説明・手に入る点 need）
//   Otakara.has(id) / add(id) / when(id)   持っているか・手に入れる・手に入れた日時
//   Otakara.newFor(score, cleared, run)   その点（と踏破したか・探索の結果）で新しく手に入るもの（まだ持っていないもの）
//   Otakara.need(u)         手に入る条件の文
//   Otakara.icon(id, shadow) アイコンのキャンバス（shadow＝まだのものの影）
//   Otakara.faceLook(look)  キャラメイクの見た目（look.ota＝付けているおたからの id の配列）→ 顔グラ（FaceKit）と盤のキャラの髪に渡す見た目
(() => {
'use strict';
// 手に入る点は仮（1回の探索のスコア）。500・1000、そのあとは1000ごと（2026-10-09。眼鏡がチュートリアルのおまけになったので詰めた）。決まったらここを直す
// kind：acc＝キャラメイクの「おたから」の欄で付ける部品（part＝顔グラの部品の名前、colors＝色の置き換え、group＝同時に1つだけ）
//       style＝「髪型」の選択肢に増える、hair＝「髪の色」の色見本に増える
//       outfit＝顔グラの衣装（FaceKit.outfits の名前。「おたから」の欄で着る／脱ぐ。group 服で1つだけ）
// got：点ではなく、その探索の結果 r（エンディングのデータ：status・total・ms など）で決まる。secret：手に入れる前は条件を「？？？？」
// clear：点ではなく、踏破したら手に入る。tutorial：チュートリアルを最後までやったら手に入る（js/tutorial.js）
// （2026-10-09：メカクレは一式をやめて、髪型・髪の色・眼鏡・飾りを別々に）
// text（説明）は漢字を使わない（2026-10-09 ユーザー指定）
const LIST = [
  { id: '白い花', name: '白い花', need: 500, kind: 'acc', part: '白い花', text: 'しろいはなのかみかざり。' },
  { id: '星かざり', name: '星かざり', need: 1000, kind: 'acc', part: '星かざり', text: 'きんいろのほしのかみどめ。' },
  { id: '眼鏡', name: 'めがね', tutorial: true, kind: 'acc', part: '眼鏡', group: '眼鏡', text: 'とてもたいせつなもの。チュートリアルクリアのあかし。' },
  { id: '紫黒', name: '紺の染め液', need: 2000, kind: 'hair', text: 'かみをむらさきがかったくろにそめるえき。' },
  { id: 'メカクレ', name: 'メカクレ', need: 3000, kind: 'style', text: 'かためがかくれるながいまえがみのかみがた。' },
  { id: '赤い眼鏡', name: 'おしゃれなめがね', need: 4000, kind: 'acc', part: '眼鏡', colors: { '#5c422c': '#d24a3c' }, group: '眼鏡', text: 'あかいフレームのおしゃれなめがね。' },
  { id: '赤い石の星かざり', name: '赤い石の星かざり', need: 5000, kind: 'acc', part: '星かざり（右）', text: 'まんなかにあかいいしのある、きんいろのほしのかみどめ。みぎにつける。' },
  { id: '白い帽子', name: '白い帽子', need: 6000, kind: 'acc', part: '白い帽子', group: 'かぶりもの', text: 'しろいナイスなぼうし。' },   // 2026-10-10 キャラグラ作成①から。かぶりもの（バンダナと同時に1つ。フードのときは顔グラ側で外れる）
  { id: 'しいたけベレー', name: 'しいたけベレー', need: 11400, secret: true, kind: 'acc', part: 'しいたけベレー', group: 'かぶりもの', text: 'きのこなかわいいベレーぼう。' },   // 2026-10-10 キャラグラ作成①から。条件は「？？？？」
  { id: 'イエロージャンパー', name: 'イエロージャンパー', clear: true, kind: 'outfit', part: 'イエロージャンパー', group: '服', text: 'きいろいジャンパー。' },   // 2026-10-09 キャラグラ作成①から
  // 2026-10-10 キャラグラ作成①から（条件はユーザー指定）。手に入れる前は条件を「？？？？」（secret）
  { id: '赤いスカーフ', name: '赤いスカーフ', kind: 'outfit', part: '赤いスカーフ', group: '服', secret: true,
    got: r => r.status === 'RETURNED' && r.ms < 10 * 60 * 1000, text: 'じょうねつてきなあかいスカーフ。' },   // 迷宮の中の時間10分未満で、帰還の巻物で帰る
  { id: 'バンダナ', name: 'バンダナ', kind: 'acc', part: 'バンダナ', group: 'かぶりもの', secret: true,
    got: r => r.status === 'CLEARED' && r.total >= 12000, text: 'とってもクールなバンダナ。' },   // スコア12000以上で30階を踏破。かぶりもの（FaceKit.hats）は同時に1つ。フードのときは顔グラ側で外れる
];
const KEY = 'honekko.otakara.v1';
let owned = {};
try { owned = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { owned = {}; }
// 確かめ用：URL に ?ota=all を付けると、全部持っている扱い（このブラウザの記録には残さない。外せば元どおり。2026-10-10）
const ALL = /[?&]ota=all\b/.test(location.search);
if (ALL) owned = Object.fromEntries(LIST.map(u => [u.id, owned[u.id] || Date.now()]));
const save = () => { if (ALL) return; try { localStorage.setItem(KEY, JSON.stringify(owned)); } catch { /* 保存なし */ } };

const cache = new Map();
function icon(id, shadow = false) {
  const k = id + (shadow ? ':影' : ''); if (cache.has(k)) return cache.get(k);
  const a = globalThis.OTAKARA_ICONS?.[id]; const c = document.createElement('canvas'); c.width = c.height = 18;
  if (a) {
    const g = c.getContext('2d'), im = g.createImageData(18, 18);
    a.rows.forEach((r, y) => [...r].forEach((ch, x) => {
      if (ch === '.') return;
      const h = shadow ? (ch === 'K' ? '#18222d' : '#2c3a48') : a.pal[ch], o = (y * 18 + x) * 4;   // 影：縁は濃い紺、中は暗い灰青
      im.data[o] = parseInt(h.slice(1, 3), 16); im.data[o + 1] = parseInt(h.slice(3, 5), 16); im.data[o + 2] = parseInt(h.slice(5, 7), 16);
      im.data[o + 3] = ch === 'K' ? 255 : Math.round(255 * (a.inner ?? 1));
    }));
    g.putImageData(im, 0, 0);
  }
  cache.set(k, c); return c;
}

// キャラメイクの見た目 → 顔グラと盤のキャラに渡す見た目
// look.ota の部品（kind acc）を顔グラの部品にする。髪型メカクレ・髪の色紫黒は look.style／look.hair にそのまま入る（持っていなければいつもの）
function faceLook(look) {
  if (!look) return look;
  const out = { ...look }, acc = [];
  if (out.style === 'メカクレ' && !owned['メカクレ']) out.style = '元の髪';
  if (out.hair === '紫黒' && !owned['紫黒']) out.hair = out.nation;
  for (const u of LIST) if (u.kind === 'acc' && owned[u.id] && (look.ota || []).includes(u.id)) acc.push(u.colors ? { name: u.part, colors: u.colors } : { name: u.part });
  out.acc = acc;
  const fit = LIST.find(u => u.kind === 'outfit' && owned[u.id] && (look.ota || []).includes(u.id));   // 衣装（なし＝盗賊の服）
  out.outfit = fit ? fit.part : null;
  return out;
}

globalThis.Otakara = {
  list: LIST,
  has: id => !!owned[id],
  when: id => owned[id] || null,
  add(id) { if (!owned[id]) { owned[id] = Date.now(); save(); } },
  newFor: (score, cleared = false, run = null) => LIST.filter(u => !u.tutorial && !owned[u.id]
    && (u.got ? !!run && u.got(run) : u.clear ? cleared : score >= u.need)),   // cleared＝踏破した、run＝その探索の結果（got の条件）
  need: u => (u.secret ? '？？？？' : u.tutorial ? 'チュートリアルを最後までやる' : u.clear ? '地下迷宮を踏破する' : `1回の探索で ${u.need.toLocaleString()}点 以上`),   // 手に入る条件の文
  forTutorial: () => LIST.filter(u => u.tutorial && !owned[u.id]),   // チュートリアルを終えたときに新しく手に入るもの
  count: () => LIST.filter(u => owned[u.id]).length,
  icon, faceLook,
};
})();
