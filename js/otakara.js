// ほねっこの迷宮 — おたから（コレクション・キャラメイクの着せ替え）。2026-10-09
// 帰還・踏破のエンディングで、その探索のスコアがしきい値を超えると手に入る（js/ending.js）。手に入れたものはこのブラウザに残す。
// 見る所：OP のメニューの「おたから」（js/opening.js。まだのものは影と条件だけ）。使う所：キャラメイクの「おたから」の欄。
// アイコンは js/otakara_assets.js（おたから_20261008/作業/アイコンを打つ.py が書き出す 18×18）。
//   Otakara.list            おたからの一覧（id・名前・説明・手に入る点 need）
//   Otakara.has(id) / add(id) / when(id)   持っているか・手に入れる・手に入れた日時
//   Otakara.newFor(score, cleared, run)   その点（と踏破したか・探索の結果）で新しく手に入るもの（まだ持っていないもの）
//   Otakara.forGameOver(run) ゲームオーバーで新しく手に入るもの（got の条件だけ。点では手に入らない）
//   Otakara.recordClear(game, job)  2の踏破を職業ごとに残す。全部の職業がそろった最初の1回だけ true（グランドスラム）
//   Otakara.need(u)         手に入る条件の文
//   Otakara.icon(id, shadow) アイコンのキャンバス（shadow＝まだのものの影）
//   Otakara.faceLook(look)  キャラメイクの見た目（look.ota＝付けているおたからの id の配列）→ 顔グラ（FaceKit）と盤のキャラの髪に渡す見た目
(() => {
'use strict';
// 手に入る点は仮（1回の探索のスコア）。500・1000、そのあとは1000ごと（2026-10-09。眼鏡がチュートリアルのおまけになったので詰めた）。決まったらここを直す
// 2026-10-20 ユーザー指定：ケモミミ 10,000 までは元の点のまま。しいたけベレー・赤いネクタイ・赤いリボン・ホープな服（1のハイスコアレースの名残で 11,400〜12,900 に刻んでいた）から先は、
//   新しい9件（ユーザーの一覧の順）とあわせて 11,500 から 1,500 ごとに均した（いちばん上が 29,500＝2で全部の敵を倒したくらい）。1と2で共有
// kind：acc＝キャラメイクの「おたから」の欄で付ける部品（part＝顔グラの部品の名前、colors＝色の置き換え、group＝同時に1つだけ）
//       style＝「髪型」の選択肢に増える、hair＝「髪の色」の色見本に増える
//       outfit＝顔グラの衣装（FaceKit.outfits の名前。「おたから」の欄で着る／脱ぐ。group 服で1つだけ）
//       hood＝フードの種類（FaceKit.hoods の名前。付けるとフードをかぶり、フードの部品だけ差し替わる。2026-10-20）
// hidden：シークレットおたから。手に入れるまで、おたからの窓に出さない（数にも入れない）
// got：点ではなく、その探索の結果 r（エンディングのデータ：status・total・ms・floor・game・grandSlam など。ゲームオーバーのときも呼ぶ）で決まる。secret：手に入れる前は条件を「？？？？」
// needText：got のものの、手に入る前に見せる条件の文（secret でないとき）
// clear：点ではなく、踏破したら手に入る。tutorial：チュートリアルを最後までやったら手に入る（js/tutorial.js）
// （2026-10-09：メカクレは一式をやめて、髪型・髪の色・眼鏡・飾りを別々に）
// text（説明）は漢字を使わない（2026-10-09 ユーザー指定）。2026-10-20 の13件はユーザーの言葉どおり（句点なし。漢字の2件もユーザー確認済み）
const LIST = [
  { id: '白い花', name: '白い花', need: 500, kind: 'acc', part: '白い花', group: '左の耳の上', text: 'しろいはなのかみかざり。' },
  { id: '星かざり', name: '星かざり', need: 1000, kind: 'acc', part: '星かざり', text: 'きんいろのほしのかみどめ。' },
  { id: '眼鏡', name: 'めがね', tutorial: true, kind: 'acc', part: '眼鏡', group: '眼鏡', text: 'とてもたいせつなもの。チュートリアルクリアのあかし。' },
  { id: '紫黒', name: '紺の染め液', need: 2000, kind: 'hair', text: 'かみをむらさきがかったくろにそめるえき。' },
  { id: 'メカクレ', name: 'メカクレ', need: 3000, kind: 'style', text: 'かためがかくれるながいまえがみのかみがた。' },
  { id: '赤い眼鏡', name: 'おしゃれなめがね', need: 4000, kind: 'acc', part: '眼鏡', colors: { '#5c422c': '#d24a3c' }, group: '眼鏡', text: 'あかいフレームのおしゃれなめがね。' },
  { id: '赤い石の星かざり', name: '赤い石の星かざり', need: 5000, kind: 'acc', part: '星かざり（右）', text: 'まんなかにあかいいしのある、きんいろのほしのかみどめ。みぎにつける。' },
  { id: '白い帽子', name: '白い帽子', need: 6000, kind: 'acc', part: '白い帽子', group: 'かぶりもの', text: 'しろいナイスなぼうし。' },   // 2026-10-10 キャラグラ作成①から。かぶりもの（バンダナと同時に1つ。フードのときは顔グラ側で外れる）
  { id: 'アホ毛', name: 'アホ毛', need: 8000, kind: 'acc', part: 'アホ毛', text: 'みょんみょんしたはねがみ。' },   // 2026-10-10 キャラグラ作成①から。髪飾り（フード・帽子と一緒に付けられる）。顔グラ側で髪の色に塗り替わる
  { id: 'ケモミミ', name: 'ケモミミ', need: 10000, kind: 'acc', part: 'ケモミミ', group: 'かぶりもの', text: 'ケモミミふうのかざり。' },   // 2026-10-10 キャラグラ作成①から。かぶりもの（帽子・バンダナと同時に1つ、付けるとフードを外す）。髪の色に塗り替わる
  { id: 'しいたけベレー', name: 'しいたけベレー', need: 11500, kind: 'acc', part: 'しいたけベレー', group: 'かぶりもの', text: 'きのこなかわいいベレーぼう。' },   // 2026-10-10 キャラグラ作成①から。2026-10-20 条件を見せるように（ユーザー指定）
  { id: '韋駄天の証', name: '韋駄天の証', kind: 'acc', part: '白い羽', group: '左の耳の上', needText: 'ほねっこの迷宮（30F）を０点で踏破クリア',
    got: r => r.game === 'classic' && r.status === 'CLEARED' && r.total === 0, text: 'マナーのいいかんこうきゃく。' },   // 2026-10-10 キャラグラ作成①から。2026-10-20 条件を見せて、1（30F）だけに（ユーザー指定）。顔グラの部品は「白い羽」（白い花と同じ場所なので、どちらか1つ）
  // 2026-10-10 キャラグラ作成①から。hidden＝シークレットおたから：手に入れるまで、おたからの窓に出さない（数にも入れない。ユーザー指定）
  { id: '赤いネクタイ', name: '赤いネクタイ', need: 13000, hidden: true, kind: 'outfit', part: '赤いネクタイ', group: '服', text: 'あざやかなネクタイ。' },
  { id: '赤いリボン', name: '赤いリボン', need: 14500, hidden: true, kind: 'outfit', part: '赤いリボン', group: '服', text: 'かれいなリボン。' },
  { id: 'ホープな服', name: 'ホープな服', need: 16000, hidden: true, kind: 'outfit', part: 'ホープな服', group: '服', text: 'かっこういいせいふく。' },   // 2026-10-11 キャラグラ作成①から。シークレット
  { id: 'イエロージャンパー', name: 'イエロージャンパー', clear: true, kind: 'outfit', part: 'イエロージャンパー', group: '服', text: 'きいろいジャンパー。' },   // 2026-10-09 キャラグラ作成①から
  // 2026-10-10 キャラグラ作成①から（条件はユーザー指定）。手に入れる前は条件を「？？？？」（secret）
  { id: '赤いスカーフ', name: '赤いスカーフ', kind: 'outfit', part: '赤いスカーフ', group: '服', needText: '帰還の巻物で帰還する',
    got: r => r.status === 'RETURNED', text: 'じょうねつてきなあかいスカーフ。' },   // 帰還の巻物で帰る（2026-10-20 ユーザー指定：時間の条件〈30分未満〉をやめて、条件を見せる）
  { id: 'バンダナ', name: 'バンダナ', kind: 'acc', part: 'バンダナ', group: 'かぶりもの', needText: '12,000点以上を取って踏破する',   // 2026-10-20 条件を見せるように（ユーザー指定）
    got: r => r.status === 'CLEARED' && r.total >= 12000, text: 'とってもクールなバンダナ。' },   // スコア12000以上で30階を踏破。かぶりもの（FaceKit.hats）は同時に1つ。フードのときは顔グラ側で外れる
  // 2026-10-20 キャラグラ作成②から（名前・説明・条件はユーザー指定。点は上の均し方で）
  { id: '白いコート', name: 'かっぱつなコート', need: 17500, kind: 'outfit', part: '白いコート', group: '服', text: 'とってもげんきそう' },
  { id: 'ボブ', name: 'ショートなボブ', need: 19000, kind: 'style', text: 'クールなおねえさんっぽい' },
  { id: 'ウルフカット', name: 'ウルフカット', need: 20500, kind: 'style', text: 'やせいてきでかっこいい' },   // 2026-10-20 条件を見せるように（ユーザー指定）
  { id: '精霊馬', name: '生きてるやさい', need: 22000, kind: 'acc', part: '精霊馬', group: 'かぶりもの', text: 'うごくやさい' },   // ダメージで跳ねる（FaceAnim が自動で）
  { id: '船乗りの帽子', name: '曙のぼうし', kind: 'acc', part: '船乗りの帽子', group: 'かぶりもの', needText: 'カードローグで地下60階から脱出する',
    got: r => r.game === 'cardrogue' && r.status === 'CLEARED', text: 'レプリカのぼうし' },   // 2の B60F を踏破（帰還は含まない）
  { id: '黒い中折れ帽', name: 'こじゃれたぼうし', need: 23500, kind: 'acc', part: '黒い中折れ帽', group: 'かぶりもの', text: 'なんだかクール' },
  { id: 'サングラス', name: 'サングラス', need: 25000, kind: 'acc', part: 'サングラス', group: '眼鏡', text: 'いいかんじのサングラス' },   // 前髪の上に重なり、目が透ける（顔グラ側）
  { id: '黒いスーツ', name: 'スーツ', need: 26500, kind: 'outfit', part: '黒いスーツ', group: '服', text: 'ちょっといかつい' },
  { id: 'ヒツジの角', name: 'ヒツジなホーン', need: 28000, kind: 'acc', part: 'ヒツジの角', group: 'かぶりもの', text: 'つののかざり' },   // もこもこフードのときだけ、フードと一緒に付けられる（顔グラの hoodOk）
  { id: 'ヒツジのフード', name: 'もこもこフード', need: 29500, kind: 'hood', part: 'ヒツジのフード', group: 'フード', text: 'うっすらこんじきにひかる' },
  { id: '坊主頭', name: '坊主頭', kind: 'style', secret: true, got: r => r.status === 'GAME_OVER', text: 'いきててよかった！' },   // どこでもゲームオーバー
  { id: '茶色い中折れ帽', name: 'ハードなボイルド', kind: 'acc', part: '黒い中折れ帽', colors: { '#2c3a48': '#6e655a', '#18222d': '#4a4640', '#4a4640': '#897d69', '#0b1120': '#221b17' }, group: 'かぶりもの', secret: true,
    got: r => r.game === 'cardrogue' && r.status === 'GAME_OVER' && r.floor >= 50, text: 'タフでなければ生きてはいけない' },   // 2の B50〜60F でゲームオーバー（黒い中折れ帽の色違い）
  { id: 'トレンチコート', name: 'トレンチコート', kind: 'outfit', part: 'トレンチコート', group: '服', needText: 'すべての職業でカードローグを踏破する',
    got: r => !!r.grandSlam, text: '恰好を付けろ。死ぬまでな。' },   // グランドスラム（全部の職業で2を踏破。recordClear）
];
const KEY = 'honekko.otakara.v1';
let owned = {};
try { owned = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { owned = {}; }
// 確かめ用：URL に ?ota=all を付けると、全部持っている扱い（このブラウザの記録には残さない。外せば元どおり。2026-10-10）
const ALL = /[?&]ota=all\b/.test(location.search);
if (ALL) owned = Object.fromEntries(LIST.map(u => [u.id, owned[u.id] || Date.now()]));
const save = () => { if (ALL) return; try { localStorage.setItem(KEY, JSON.stringify(owned)); } catch { /* 保存なし */ } };

// 2の踏破の記録（職業ごと）。グランドスラム＝全部の職業で踏破（トレンチコートとエンディングの絵）。職業は js/opening.js の JOBS と同じ
const GS_JOBS = ['盗賊', '戦士', '魔法使い'], CLEAR_KEY = 'honekko.clears.v1';
let clears = {};
try { clears = JSON.parse(localStorage.getItem(CLEAR_KEY)) || {}; } catch { clears = {}; }
function recordClear(game, job) {
  if (game !== 'cardrogue') return false;
  const had = GS_JOBS.every(j => clears[j]);
  if (!clears[job]) clears[job] = Date.now();
  try { localStorage.setItem(CLEAR_KEY, JSON.stringify(clears)); } catch { /* 保存なし */ }
  return !had && GS_JOBS.every(j => clears[j]);   // そろった最初の1回だけ
}

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
// look.ota の部品（kind acc）を顔グラの部品にする。髪型（kind style）・髪の色紫黒は look.style／look.hair にそのまま入る（持っていなければいつもの）
function faceLook(look) {
  if (!look) return look;
  const out = { ...look }, acc = [];
  if (LIST.some(u => u.kind === 'style' && u.id === out.style && !owned[u.id])) out.style = '元の髪';
  if (out.hair === '紫黒' && !owned['紫黒']) out.hair = out.nation;
  for (const u of LIST) if (u.kind === 'acc' && owned[u.id] && (look.ota || []).includes(u.id)) acc.push(u.colors ? { name: u.part, colors: u.colors } : { name: u.part });
  out.acc = acc;
  const fit = LIST.find(u => u.kind === 'outfit' && owned[u.id] && (look.ota || []).includes(u.id));   // 衣装（なし＝盗賊の服）
  out.outfit = fit ? fit.part : null;
  const hd = LIST.find(u => u.kind === 'hood' && owned[u.id] && (look.ota || []).includes(u.id));   // フードの種類（フードをかぶっているときだけ）
  out.hoodType = hd && out.hood ? hd.part : null;
  return out;
}

globalThis.Otakara = {
  list: LIST,
  has: id => !!owned[id],
  when: id => owned[id] || null,
  add(id) { if (!owned[id]) { owned[id] = Date.now(); save(); } },
  newFor: (score, cleared = false, run = null) => LIST.filter(u => !u.tutorial && !owned[u.id]
    && (u.got ? !!run && u.got(run) : u.clear ? cleared : score >= u.need)),   // cleared＝踏破した、run＝その探索の結果（got の条件）
  forGameOver: run => LIST.filter(u => !owned[u.id] && u.got && u.got(run)),   // ゲームオーバー（点では手に入らない）
  recordClear,
  need: u => (u.secret ? '？？？？' : u.tutorial ? 'チュートリアルを最後までやる' : u.needText ? u.needText : u.clear ? '地下迷宮を踏破する' : `1回の探索で ${u.need.toLocaleString()}点 以上`),   // 手に入る条件の文
  forTutorial: () => LIST.filter(u => u.tutorial && !owned[u.id]),   // チュートリアルを終えたときに新しく手に入るもの
  count: () => LIST.filter(u => owned[u.id]).length,
  shown: () => LIST.filter(u => !u.hidden || owned[u.id]),   // おたからの窓に出すもの（シークレットは手に入れてから）
  icon, faceLook,
};
})();
