/** @OnlyCurrentDoc */
// ↑ 許可を「このスプレッドシートだけ」に絞る印（ないと「すべてのスプレッドシートの閲覧・編集」の許可を求められる）
// ほねっこの迷宮 — オンラインランキング（Google Apps Script。スプレッドシートの「拡張機能 → Apps Script」に貼る）
// ウェブアプリとして公開すると、ゲーム（js/ranking.js）がここへ記録を送り（POST）、上位を読む（GET ?n=50）。
// 記録はこのスプレッドシートの「ranking」シートに1行ずつたまる。おかしな記録は、シートの行を消せばランキングからも消える。
// 受け付けるのは、ゲームが送る形と範囲に合うものだけ（名前は8文字まで、スコア 0〜100000、階 1〜30 など）。
// 2026-10-20：2（CardRogue・60F）の記録は別のシート「ranking60」に分ける（送るときに game: 'cardrogue'、読むときに ?game=cardrogue。階 1〜60）。
//   game がないものは今までどおり1の「ranking」。読んだ答えに game を返す（ゲームはそれを見て、この版に出し直されたかを知る）。

const SHEETS = { classic: 'ranking', cardrogue: 'ranking60' }, MAX_FLOOR = { classic: 30, cardrogue: 60 };
const HEAD = ['id', 'date', 'name', 'score', 'status', 'floor', 'turns', 'ms', 'icon', 'version', 'job'];   // job：職業（2026-10-14 に足した。前の記録は空＝盗賊）
const JOBS = ['盗賊', '戦士', '魔法使い'];

function game_(g) { return g === 'cardrogue' ? 'cardrogue' : 'classic'; }
function sheet_(game) {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), name = SHEETS[game_(game)];
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(HEAD); sh.setFrozenRows(1); }
  else if (sh.getRange(1, HEAD.length).getValue() !== HEAD[HEAD.length - 1]) sh.getRange(1, HEAD.length).setValue(HEAD[HEAD.length - 1]);   // 前からあるシートに、職業の見出しを足す
  return sh;
}
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function rows_(game) {
  const v = sheet_(game).getDataRange().getValues(); v.shift();
  return v.filter(r => r[0]).map(r => { const o = {}; HEAD.forEach((k, i) => { o[k] = r[i]; }); return o; });
}
function sorted_(game) {
  return rows_(game).sort((a, b) => b.score - a.score || a.turns - b.turns || a.ms - b.ms);
}

// 上位を読む：?n=50（最大100）。2の表は ?game=cardrogue
function doGet(e) {
  const p = (e && e.parameter) || {}, game = game_(p.game);
  const n = Math.min(100, Math.max(1, Number(p.n) || 50));
  const all = sorted_(game);
  return json_({ ok: true, game: game, total: all.length, list: all.slice(0, n).map(r => ({
    id: r.id, name: String(r.name), score: r.score, status: r.status, floor: r.floor, turns: r.turns, ms: r.ms, icon: r.icon, job: JOBS.indexOf(r.job) >= 0 ? r.job : '盗賊',
    date: r.date instanceof Date ? r.date.getTime() : r.date })) });
}

// 記録を送る：{ id, name, score, status, floor, turns, ms, icon, version, job, game }（同じ id は1回だけ。game: 'cardrogue' なら2の表へ）
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents), game = game_(d.game);
    const id = String(d.id || '');
    if (!/^[\w-]{8,40}$/.test(id)) return json_({ ok: false, error: 'id' });
    let name = String(d.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 8) || 'ローグ';
    if (/^[=+\-@]/.test(name)) name = "'" + name;                      // シートの数式にならないように
    const score = Math.floor(Number(d.score)), turns = Math.floor(Number(d.turns)), ms = Math.floor(Number(d.ms)), floor = Math.floor(Number(d.floor));
    if (!(score >= 0 && score <= 100000)) return json_({ ok: false, error: 'score' });
    if (!(turns >= 0 && turns <= 100000 && ms >= 0 && ms <= 864000000 && floor >= 1 && floor <= MAX_FLOOR[game])) return json_({ ok: false, error: 'value' });
    const status = d.status === 'CLEARED' ? 'CLEARED' : 'RETURNED';
    let icon = String(d.icon || '');
    if (icon.length > 8000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(icon)) icon = '';
    const sh = sheet_(game);
    const last = sh.getLastRow();
    const ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => r[0]) : [];
    const job = JOBS.indexOf(d.job) >= 0 ? d.job : '盗賊';
    if (ids.indexOf(id) < 0) sh.appendRow([id, new Date(), name, score, status, floor, turns, ms, icon, String(d.version || '').slice(0, 20), job]);
    const all = sorted_(game);
    return json_({ ok: true, game: game, rank: all.findIndex(r => r.id === id) + 1, total: all.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
