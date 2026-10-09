// ほねっこの迷宮 — ランキング（テストプレイ用）。遊んだブラウザの中（localStorage）に残し、送り先があればオンラインにも送る。
// 帰還・踏破でエンディングの名前入力のあとに記録（js/ending.js）。ゲームオーバーは記録しない（原作と同じ）。
// 見る所：エンディングの最後の表と、OP のメニューの「ハイスコア」（js/opening.js。「このブラウザ」「オンライン」の切り替え）。
// 並び：スコアの高い順。同じ点なら少ないターン、短い時間が上。このブラウザには上から50件まで残す。
//   Ranking.add(entry)  → { entry, rank }   entry = { name, score, icon(キャラの頭の dataURL), face(顔グラ 96×96 の dataURL), turns, ms, floor, status('CLEARED'|'RETURNED') }
//   Ranking.list()      上からの一覧（このブラウザ）
//   Ranking.best()      いちばん上の点（記録がなければ -1）
//   Ranking.lastName    前に入れた名前（名前入力の最初の値）
//   Ranking.text()      テキストにした一覧（テストプレイの結果を送ってもらう用。クリップボードへ）
//   Ranking.clear()     全部消す
// オンライン（送り先は js/ranking_config.js の HK_RANKING_URL。Google Apps Script のウェブアプリ。オンラインランキング/ を参照）
//   Ranking.online.enabled      送り先があるか
//   Ranking.online.submit(e)    → { ok, rank, total }  送る（つながらなければ、あとで送り直す印をつけておく）
//   Ranking.online.fetch(n)     → { ok, total, list }  上から n 件
//   Ranking.online.flush()      まだ送れていない記録を送り直す
(() => {
'use strict';
const KEY = 'honekko.ranking.v1', NAME_KEY = 'honekko.lastName', MAX = 50, VERSION = 'test-20261009';
const URL_ = String(globalThis.HK_RANKING_URL || '').trim();
const read = () => { try { const a = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(a) ? a : []; } catch { return []; } };
let list = read();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* 保存できない（プライベートウィンドウなど）ときは、閉じるまでだけ */ } };
const order = (a, b) => b.score - a.score || a.turns - b.turns || a.ms - b.ms;
const mmss = ms => { const s = Math.floor((ms || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const reach = e => (e.status === 'CLEARED' ? '踏破' : `帰還 B${e.floor ?? '?'}F`);
const day = t => { const d = new Date(t || 0); return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
const newId = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

// ---- オンライン（つながらないときは待ちすぎない：8秒であきらめる）
async function call(opts = {}, query = '') {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 8000);
  try {
    // POST は text/plain で送る（Apps Script は前もっての問い合わせ＝preflight に答えられないため）
    const res = await fetch(URL_ + query, { ...opts, signal: ac.signal, redirect: 'follow' });
    return await res.json();
  } finally { clearTimeout(timer); }
}
const online = {
  get enabled() { return !!URL_; },
  async submit(e) {
    if (!URL_) return { ok: false, error: 'no-url' };
    try {
      // 絵は顔グラを送る（約4KB。送り先の上限 8000 文字を超えるときは、キャラの頭の小さな絵）
      const pic = e.face && e.face.length <= 8000 ? e.face : (e.icon || '');
      const body = { id: e.id, name: e.name, score: e.score, status: e.status, floor: e.floor, turns: e.turns, ms: Math.round(e.ms || 0), icon: pic, version: VERSION };
      const r = await call({ method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
      if (r && r.ok) { e.sent = true; e.onlineRank = r.rank; save(); }
      return r || { ok: false };
    } catch (err) { return { ok: false, error: String(err && err.name || err) }; }
  },
  async fetch(n = 50) {
    if (!URL_) return { ok: false, error: 'no-url' };
    try { return await call({}, `?n=${n}`); } catch (err) { return { ok: false, error: String(err && err.name || err) }; }
  },
  async flush() {
    if (!URL_) return;
    for (const e of list.filter(x => !x.sent && x.id)) { const r = await online.submit(e); if (!r.ok) break; }
  },
};

globalThis.Ranking = {
  add(e) {
    const entry = { ...e, id: newId(), date: Date.now(), sent: false };
    list.push(entry); list.sort(order);
    const rank = list.indexOf(entry) + 1;
    list = list.slice(0, MAX); save();
    return { entry, rank };
  },
  list: () => list.slice(),
  best: () => (list.length ? list[0].score : -1),
  mine: id => list.some(e => e.id === id),
  get lastName() { try { return localStorage.getItem(NAME_KEY) || 'ローグ'; } catch { return 'ローグ'; } },
  set lastName(v) { try { localStorage.setItem(NAME_KEY, v); } catch { /* 保存なし */ } },
  text() {
    return ['ほねっこの迷宮 ランキング（テストプレイ）', ...list.map((e, i) =>
      `${i + 1}位 ${e.name} ${e.score}点 ${reach(e)} ${e.turns}ターン ${mmss(e.ms)} (${day(e.date)})`)].join('\n');
  },
  clear() { list = []; save(); },
  online, mmss, reach,
};
})();
