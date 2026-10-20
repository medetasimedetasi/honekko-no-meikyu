// CardRogue（原作2、D:/ほねっこの迷宮/CardRogue.html）を遊ぶときの、2だけの見せ方（2026-10-18）。
// ルールは js/logic2.js（原作の無改変の切り出し）。ここは入力の形（距離・飛行の道・カードを選ぶ）と、新しいカードの仮の見せ方だけ。
// game3d.js が CardRogueKit(G) を呼んで使う（G：game3d.js の中の状態と関数。G.st・G.HK はいまの値を返す）
// 骨組みの段階：新しいカードの効果の演出は、今ある斬撃・印で代用している（あとで足す）
globalThis.CardRogueKit = function (G) {
  const { DIRV, T } = G;
  const PROFESSION = { 盗賊: 'rogue', 戦士: 'warrior', 魔法使い: 'wizard' };

  function newRun() {                                    // 職業ごとの初期デッキで始める（原作の Qe・or・ar）
    const HK = G.HK, prof = PROFESSION[globalThis.HK_PLAYER?.look?.job] || 'rogue';
    return { rogue: HK.newRunRogue, warrior: HK.newRunWarrior, wizard: HK.newRunWizard }[prof]();
  }

  // ---- 向き・距離を選ぶカード：どの形で選ぶか（null＝選ばずに使う）。1のカードは今までどおり（攻撃＝向き、移動＝向きと距離）
  function targetSpec(c, mode) {
    if (mode === 'forced') return { kind: 'move', max: 1 };
    if (c.magicEffect) {
      switch (c.magicEffect) {
        case 'teleport': return { kind: 'move', max: 4, overWalls: true, overEnemies: true };   // 瞬間移動：壁・敵を越えて直線1〜4
        case 'blast': return { kind: 'blast', max: c.range, square: !!c.square };              // 火球など：着弾の距離を選ぶ（square：まわり8マス）
        case 'flight': return { kind: 'path', max: 5 };                                         // 飛行：曲がりながら1〜5歩
        case 'evade': return { kind: 'move', max: 1 };                                          // 回避障壁など：1マス動く（動かずに使うのは窓で）
        case 'bolt': case 'paralysis': return { kind: 'attack', range: c.range };
        case 'lightning': return { kind: 'attack', range: c.range, line: true };               // 稲妻：壁までの一直線の敵すべて
        case 'charge': return { kind: 'attack', range: c.range, charge: true };                // 体当たり：隣の敵には使えない（助走が要る）
        case 'poison': return { kind: 'area', area: 'around', tint: 'poison' };                // 毒：まわり8マス（向きなし）
        case 'fetch': return { kind: 'area', area: 'fetch' };                                  // 取寄：5マス以内の品
      }
      return null;
    }
    if (c.warriorEffect === 'breakthrough') return { kind: 'move', max: c.moveDistance ?? 3, overEnemies: true };   // 突破の構え：敵を越える
    if (c.warriorEffect === 'areaAttack' && c.area === 'around') return { kind: 'area', area: 'around', tint: 'attack' };   // 蛮人斧：まわり8マス（向きなし）
    if (c.warriorEffect === 'areaAttack' && c.area === 'line') return { kind: 'attack', range: c.range, line: true };       // 地裂きの大槌：直線の敵すべて
    if (c.rogueEffect === 'move') return { kind: 'move', max: c.treasureMove ? G.HK.rogueMoveMax(G.st, c) : c.moveDistance };
    if (['strike', 'snare', 'throw'].includes(c.rogueEffect)) return { kind: 'attack', range: c.range };
    if (c.rogueEffect === 'trap') return { kind: 'area', area: 'trap' };                       // 宝罠：品の上にいる敵すべて
    if (c.rogueEffect) return null;
    if (c.damage) return { kind: 'attack', range: c.range ?? 1 };
    if (c.moveDistance) return { kind: 'move', max: c.moveDistance };
    return null;
  }

  const aimOnSelect = c => c.type !== '移動' && c.rogueEffect !== 'throw' && c.magicEffect !== 'evade';
  // 選べるマス（game3d.js の targetOptions の代わり。壁・敵を越える移動、爆炎の着弾、飛行の道。ほかは null で今までどおり）
  function targetOptions(tg) {
    if (!(tg.overWalls || tg.overEnemies || tg.kind === 'blast' || tg.kind === 'path' || tg.line || tg.charge)) return null;
    const st = G.st, HK = G.HK, p = st.player, out = {};
    if (tg.line || tg.charge) {                          // 稲妻・地裂き：壁までの一直線を全部光らせ、当たる敵すべてに枠（hits）。体当たり：隣の敵は狙えない
      for (const d of Object.keys(DIRV)) {
        const tiles = [], hits = []; let target = null;
        for (let n = 1; n <= tg.range; n++) {
          const x = p.x + DIRV[d][0] * n, y = p.y + DIRV[d][1] * n;
          if (!HK.isFloor(st, { x, y })) break;
          const en = HK.enemyAt(st, { x, y });
          if (tg.line) { tiles.push({ x, y, n }); if (en) { hits.push({ x, y }); target = target || { x, y }; } continue; }
          if (en) { if (n > 1) target = { x, y }; break; }
          tiles.push({ x, y, n });
        }
        out[d] = { tiles, target, hits };
      }
      return out;
    }
    if (tg.kind === 'path') {                            // 飛行：道の先から1歩ずつ（壁は越えない・敵は越える）
      const end = pathEnd(tg);
      for (const d of Object.keys(DIRV)) {
        const x = end.x + DIRV[d][0], y = end.y + DIRV[d][1];
        out[d] = { tiles: tg.path.length < tg.max && HK.isFloor(st, { x, y }) ? [{ x, y, n: tg.path.length + 1 }] : [], target: null };
      }
      return out;
    }
    for (const d of Object.keys(DIRV)) {
      const [dx, dy] = DIRV[d], tiles = [];
      for (let n = 1; n <= tg.max; n++) {
        const x = p.x + dx * n, y = p.y + dy * n;
        if (x < 0 || y < 0 || x > 9 || y > 9) break;
        const floor = HK.isFloor(st, { x, y }), en = HK.enemyAt(st, { x, y });
        if (tg.kind === 'blast') { if (!floor) break; tiles.push({ x, y, n }); continue; }   // 着弾まで壁を越えない。敵の上にも落とせる
        if (!floor) { if (tg.overWalls) continue; break; }
        if (en) { if (tg.overEnemies) continue; break; }
        tiles.push({ x, y, n });
      }
      out[d] = { tiles, target: null };
    }
    return out;
  }

  // ---- 向きのない範囲（蛮人斧・毒・取寄・宝罠）：光らせるマス tiles と、当たる相手の枠 marks
  function areaTiles(tg) {
    const st = G.st, HK = G.HK, p = st.player, tiles = [], marks = [];
    if (tg.area === 'around') {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; const c = { x: p.x + dx, y: p.y + dy };
        if (!HK.isFloor(st, c)) continue; tiles.push(c); if (HK.enemyAt(st, c)) marks.push(c);
      }
    } else if (tg.area === 'fetch') {
      for (let y = 1; y <= 8; y++) for (let x = 1; x <= 8; x++) if (Math.abs(x - p.x) + Math.abs(y - p.y) <= 5 && HK.isFloor(st, { x, y }) && (x !== p.x || y !== p.y)) tiles.push({ x, y });
      for (const it of st.groundItems) if (Math.abs(it.x - p.x) + Math.abs(it.y - p.y) <= 5) marks.push({ x: it.x, y: it.y });
    } else if (tg.area === 'trap') {
      for (const it of st.groundItems) { tiles.push({ x: it.x, y: it.y }); if (HK.enemyAt(st, it)) marks.push({ x: it.x, y: it.y }); }
    }
    return { tiles, marks };
  }
  const areaHas = (tg, x, y) => areaTiles(tg).tiles.some(c => c.x === x && c.y === y) || (x === G.st.player.x && y === G.st.player.y);
  const AREA_COL = { attack: '210,74,60', poison: '142,170,72', fetch: '74,163,232', trap: '240,184,74' };

  // ---- 飛行の道
  function pathEnd(tg) {
    let x = G.st.player.x, y = G.st.player.y;
    for (const d of tg.path) { x += DIRV[d][0]; y += DIRV[d][1]; }
    return { x, y };
  }
  function pathKey(tg, d) {                              // 十字キー：1歩足す。来た道を戻る向きなら1歩消す
    const last = tg.path[tg.path.length - 1], back = { w: 's', s: 'w', a: 'd', d: 'a' };
    if (last && back[last] === d) { tg.path.pop(); tg.dir = tg.path[tg.path.length - 1] || null; return; }
    const o = targetOptions(tg)[d];
    if (!o.tiles.length) { G.say(tg.path.length >= tg.max ? `飛べるのは${tg.max}歩まで` : 'そっちには飛べない'); G.bumpFace(d); return; }
    tg.path.push(d); tg.dir = d;
  }
  function flightReach(tg) {                             // 主人公から5歩以内で行けるマスと、そこまでのいちばん短い道（壁は越えない・敵は越える）
    const st = G.st, start = { x: st.player.x, y: st.player.y }, key = c => c.x + ',' + c.y, prev = new Map([[key(start), null]]), q = [{ ...start, n: 0 }], out = new Map();
    while (q.length) {
      const c = q.shift(); if (c.n >= tg.max) continue;
      for (const d of Object.keys(DIRV)) {
        const nx = { x: c.x + DIRV[d][0], y: c.y + DIRV[d][1], n: c.n + 1 }, k = key(nx);
        if (prev.has(k) || !G.HK.isFloor(st, nx)) continue;
        prev.set(k, { from: key(c), d }); q.push(nx);
        if (!G.HK.enemyAt(st, nx)) out.set(k, nx);
      }
    }
    const pathTo = k => { const ds = []; for (let e = prev.get(k); e; e = prev.get(e.from)) ds.unshift(e.d); return ds; };
    return { tiles: out, pathTo };
  }
  function pathClick(tg, x, y) {                         // 押したマス：道の先なら飛ぶ。行けるマスなら、そこまでのいちばん短い道にする
    const end = pathEnd(tg);
    if (tg.path.length && end.x === x && end.y === y) { pathConfirm(tg); return true; }
    const r = flightReach(tg), k = x + ',' + y;
    if (r.tiles.has(k)) { tg.path = r.pathTo(k); tg.dir = tg.path[tg.path.length - 1]; return true; }
    for (const d of Object.keys(DIRV)) if (end.x + DIRV[d][0] === x && end.y + DIRV[d][1] === y) { pathKey(tg, d); return true; }
    return false;
  }
  function pathConfirm(tg) {
    if (!tg.path.length) return;
    G.perform('play', { ...(tg.extra || {}), cardId: tg.cardId, mode: tg.mode, path: tg.path.slice() });
  }
  function drawTargeting(g, tg) {                        // 飛行の道：通るマスを青、次に行けるマスを薄く（爆炎は着弾の範囲を足して、ふつうの描き方へ）
    if (tg.kind === 'blast') { drawBlastArea(g, tg); return false; }
    if (tg.kind === 'area') {                              // 向きのない範囲：範囲を光らせ、当たる相手（敵・品）に枠
      const { tiles, marks } = areaTiles(tg), col = AREA_COL[tg.tint || tg.area] || AREA_COL.attack, tx = x => (x - 1) * T, ty = y => (y - 1) * T;
      for (const c of tiles) {
        g.fillStyle = `rgba(${col},${tg.area === 'fetch' ? 0.18 : 0.42})`; g.fillRect(tx(c.x) + 1, ty(c.y) + 1, T - 3, T - 3);
        g.lineWidth = 1; g.strokeStyle = 'rgba(34,27,23,0.6)'; g.strokeRect(tx(c.x) + 0.5, ty(c.y) + 0.5, T - 2, T - 2);
        g.strokeStyle = `rgba(${col},0.9)`; g.strokeRect(tx(c.x) + 1.5, ty(c.y) + 1.5, T - 4, T - 4);
      }
      for (const c of marks) { g.lineWidth = 1; g.strokeStyle = `rgba(${col},1)`; g.strokeRect(tx(c.x) + 2.5, ty(c.y) + 2.5, T - 6, T - 6); g.strokeRect(tx(c.x) + 3.5, ty(c.y) + 3.5, T - 8, T - 8); }
      return true;
    }
    if (tg.kind !== 'path') return false;
    const tx = x => (x - 1) * T, ty = y => (y - 1) * T, box = (x, y, a) => {
      g.fillStyle = `rgba(74,163,232,${a})`; g.fillRect(tx(x) + 1, ty(y) + 1, T - 3, T - 3);
      g.lineWidth = 1; g.strokeStyle = 'rgba(34,27,23,0.75)'; g.strokeRect(tx(x) + 0.5, ty(y) + 0.5, T - 2, T - 2);
      g.strokeStyle = 'rgba(74,163,232,1)'; g.strokeRect(tx(x) + 1.5, ty(y) + 1.5, T - 4, T - 4);
    };
    for (const c of flightReach(tg).tiles.values()) box(c.x, c.y, 0.16);   // 5歩以内で降りられるマス（薄く）
    let x = G.st.player.x, y = G.st.player.y;
    for (const d of tg.path) { x += DIRV[d][0]; y += DIRV[d][1]; box(x, y, 0.62); }
    if (tg.path.length) { g.lineWidth = 1; g.strokeStyle = 'rgba(240,184,74,1)'; g.strokeRect(tx(x) + 2.5, ty(y) + 2.5, T - 6, T - 6); g.strokeRect(tx(x) + 3.5, ty(y) + 3.5, T - 8, T - 8); }   // 降りるマス（金の枠）
    for (const o of Object.values(targetOptions(tg))) for (const c of o.tiles) box(c.x, c.y, 0.34);
    return true;
  }

  function drawAfter(g, tg) {                           // 稲妻・地裂き：2体目からの敵にも枠（1体目はふつうの描き方で付く）
    if (!tg.line) return;
    const tx = x => (x - 1) * T, ty = y => (y - 1) * T;
    for (const o of Object.values(targetOptions(tg))) for (const c of (o.hits || []).slice(1)) {
      g.lineWidth = 1; g.strokeStyle = 'rgba(34,27,23,0.75)'; g.strokeRect(tx(c.x) + 0.5, ty(c.y) + 0.5, T - 2, T - 2);
      g.strokeStyle = '#d24a3c'; g.strokeRect(tx(c.x) + 1.5, ty(c.y) + 1.5, T - 4, T - 4); g.strokeRect(tx(c.x) + 2.5, ty(c.y) + 2.5, T - 6, T - 6);
    }
  }
  // ---- 使う前に何かを選ぶカード（true＝ここで引き受けた）。enchant（付与魔法）は1の武器合体の窓がそのまま使える
  function pick(title, list, base, toPayload, empty = '対象がありません。カードもターンも消費しません。') {
    G.showDialog(title, list.length ? '<p>使用する対象を選んでください。</p>' : `<p>${empty}</p>`,
      list.map(o => [o.label, () => G.perform('play', { ...base, ...toPayload(o) })]).concat([['やめる', G.cancelAll]]));
  }
  function useCard(cobj, base) {
    const st = G.st, HK = G.HK, c = HK.cardOf(cobj), name = h => HK.cardOf(h).name, others = st.hand.filter(h => h.id !== cobj.id);
    const w = c.warriorEffect, r = c.rogueEffect;
    if (['deleteHand', 'upgradeWeapon', 'upgradeArmor', 'recover'].includes(w)) {
      pick({ deleteHand: 'どの2枚を捨てていく？', upgradeWeapon: 'どの武器を強化する？', upgradeArmor: 'どの防具を強化する？', recover: '捨て札から何を回収する？' }[w],
        HK.warriorOptions(st, cobj), base, o => (o.targetCardId !== undefined ? { targetCardId: o.targetCardId } : { materialCardIds: o.materialCardIds }));
      return true;
    }
    if (r === 'exchange') { pick('どのカードと入れ替える？', others.map(h => ({ label: name(h), id: h.id })), base, o => ({ targetCardId: o.id })); return true; }
    if (r === 'fusion') { pick('どれを小合体する？', HK.smallFusionPairs(st).map(pr => ({ label: `${name(pr[0])}×2`, ids: pr.map(h => h.id) })), base, o => ({ materialCardIds: o.ids })); return true; }
    if (r === 'throw') {                                 // 宝投げ：投げる宝を選んでから、向きを選ぶ
      const list = st.hand.filter(h => h.id !== cobj.id && HK.isTreasureLike(h));
      if (!list.length) { G.showDialog('何を投げる？', '<p>手札に宝・黄金剣がありません。</p>', [['やめる', G.cancelAll]]); return true; }
      G.showDialog('何を投げる？', '<p>投げたカードは永久に除外されます。</p>', list.map(h => [name(h), () => { G.closeDialog(); G.beginTargeting(cobj, { targetCardId: h.id }); }]).concat([['やめる', G.cancelAll]]));
      return true;
    }
    if (r === 'delete') {                                // 大削除：所持カードから別の2枚（手札・山札・捨て札。一時待機は除く）
      const pool = ['hand', 'drawPile', 'discardPile'].flatMap(k => st[k]).filter(h => h.id !== cobj.id);
      if (pool.length < 2) { G.showDialog('大削除', '<p>除外できるカードが2枚ありません。</p>', [['やめる', G.cancelAll]]); return true; }
      const step = first => G.showDialog(first ? `2枚目を選ぶ（1枚目：${name(first)}）` : '永久に除外する1枚目を選ぶ', '<p>選んだカードはデッキから永久になくなります。</p>',
        pool.filter(h => !first || h.id !== first.id).map(h => [name(h), () => (first ? G.perform('play', { ...base, materialCardIds: [first.id, h.id] }) : step(h))]).concat([['やめる', G.cancelAll]]));
      step(null); return true;
    }
    if (c.magicEffect === 'evade') {                     // 回避障壁など：その場で防御だけ、または1マス動く
      G.showDialog(c.name, '<p>防御を得て、1マス動くこともできます。</p>', [['その場で使う', () => G.perform('play', base), 'primary'], ['1マス動く', () => { G.closeDialog(); G.beginTargeting(cobj); }], ['やめる', G.cancelAll]]);
      return true;
    }
    return false;
  }

  // ---- 敵の変化の見せ方（魔法・技・範囲の武器など、1の武器以外でまとめて）：減った体力・押し引き・倒れる・毒・足止め
  const enemiesChanged = (s0, mid) => s0.enemies.length !== mid.enemies.length || s0.enemies.some(e => {
    const m = mid.enemies.find(n => n.id === e.id);
    return !m || m.hp !== e.hp || m.x !== e.x || m.y !== e.y || !!m.immobilized !== !!e.immobilized || (m.poison ?? 0) !== (e.poison ?? 0);
  });
  async function animateEnemyChanges(s0, mid, dir, noSlash = false) {   // noSlash：当たりの演出を先に見せたとき（魔法・範囲）は斬撃を出さない
    const jobs = []; let k = 0;
    for (const e of s0.enemies) {
      const m = mid.enemies.find(n => n.id === e.id), v = G.findView(e.id); if (!v) continue;
      const lost = e.hp - (m ? m.hp : 0), moved = m && (m.x !== e.x || m.y !== e.y);
      const stuck = m && m.immobilized && !e.immobilized, poisoned = m && (m.poison ?? 0) > (e.poison ?? 0);
      if (!(lost > 0) && !moved && !stuck && !poisoned) continue;
      jobs.push((async i => {
        await G.wait(i * 70);
        if (lost > 0) {
          if (!noSlash) { const d = dir || 'd', img = G.sprDir('slash', '0', d); G.addFx('slash', [['0', 40], ['1', 60], ['2', 80]], v.px - img.width / 2, v.py - 12 - img.height / 2, { dir: d }); }
          G.hitstop(25); await G.enemyHurt(v, lost, { fromDir: dir });
        }
        if (moved) { await G.tween(v, G.footX(m.x), G.footY(m.y), 110, G.easeOut); v.x = m.x; v.y = m.y; }
        if (m) {
          v.poison = m.poison ?? 0; v.stuck = !!m.immobilized;
          if (poisoned) G.addMark('poison', '1', v.px, v.py - 18, 700);
          if (stuck) G.addMark('stuck', '0', v.px, v.py - 6, 600, 3);
        } else await G.enemyDie(v);
      })(k++));
    }
    await Promise.all(jobs);
  }

  // ================================================================ 演出（2026-10-18）
  // 2Dの層（480×270）に、盤のドット座標で描く。光る・飛ぶ・広がるのは一度きりで、点滅はさせない（ユーザーの決まり）
  const FX = [], PARTS = [];
  const now = () => G.clock;
  const ease = q => 1 - (1 - q) * (1 - q), clamp = q => Math.max(0, Math.min(1, q));
  function fx(ms, draw) { const f = { t0: now(), ms, draw }; FX.push(f); return f; }
  function part(o) { PARTS.push({ t0: now(), g: 0, size: 1, a: 1, ...o }); }
  function burst(x, y, n, cols, speed = 60, opt = {}) {      // 粒をまわりへ（opt.dir：向きのまわりだけ、opt.up：上へ、opt.g：重力）
    for (let i = 0; i < n; i++) {
      const base = opt.dir != null ? opt.dir : Math.random() * Math.PI * 2, a = base + (opt.dir != null ? (Math.random() - 0.5) * (opt.spread ?? 1.6) : 0);
      const v = speed * (0.4 + Math.random() * 0.8);
      part({ x: x + (Math.random() - 0.5) * (opt.jit ?? 4), y: y + (Math.random() - 0.5) * (opt.jit ?? 4), vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.75 - (opt.up ?? 0),
        g: opt.g ?? 0, life: (opt.life ?? 420) * (0.6 + Math.random() * 0.5), col: cols[Math.floor(Math.random() * cols.length)], size: Math.random() < (opt.big ?? 0.25) ? 2 : 1 });
    }
  }
  const dot = (g, x, y, n, col, a) => { if (a <= 0.01) return; g.globalAlpha = Math.min(1, a); g.fillStyle = col; g.fillRect(Math.round(x - n / 2), Math.round(y - n / 2), n, n); };
  function seg(g, a, b, n, col, al) {                        // 盤の2点のあいだに線（画面のドットで）
    const [x0, y0] = G.S(a.x, a.y), [x1, y1] = G.S(b.x, b.y), L = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= L; i++) dot(g, x0 + (x1 - x0) * i / L, y0 + (y1 - y0) * i / L, n, col, al);
  }
  function ellipse(g, c, rx, ry, n, col, al, from = 0, to = Math.PI * 2) {   // 盤の点 c のまわりの楕円（画面で）
    const [cx, cy] = G.S(c.x, c.y), k = G.scaleNow(), N = Math.max(16, Math.round((rx + ry) * k * 2.2));
    for (let i = 0; i <= N; i++) { const a = from + (to - from) * i / N; dot(g, cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k, n, col, al); }
  }
  function drawFx() {
    const g = G.ctx, c = now();
    for (let i = FX.length - 1; i >= 0; i--) if (c - FX[i].t0 >= FX[i].ms) FX.splice(i, 1);
    for (let i = PARTS.length - 1; i >= 0; i--) if (c - PARTS[i].t0 >= PARTS[i].life) PARTS.splice(i, 1);
    if (!FX.length && !PARTS.length) return;
    const k = G.scaleNow();
    g.save();
    for (const f of FX) { g.save(); f.draw(g, clamp((c - f.t0) / f.ms), k); g.restore(); }
    for (const p of PARTS) {
      const t = (c - p.t0) / 1000, q = (c - p.t0) / p.life, [sx, sy] = G.S(p.x + p.vx * t, p.y + p.vy * t + p.g * t * t);
      dot(g, sx, sy, Math.max(1, Math.round(p.size * k)), p.col, clamp((1 - q) * 1.6) * p.a);
    }
    g.restore();
  }
  // 光（js/game3d.js の fxLight）：x, y は足もと（盤のドット）。env(t)：0→1→0 のなめらかな明るさ
  const env = (t, up = 0.15) => t < up ? ease(t / up) : 1 - ease((t - up) / (1 - up));
  const glow = (x, y, color, power, ms, opt = {}) => G.fxLight(t => ({ x, y, h: opt.h ?? 0.5, color, power: power * env(t, opt.up), dist: opt.dist ?? 4 }), ms);
  const body = v => ({ x: v.px, y: v.py - 12 });                 // キャラの胴のあたり
  const tileC = (x, y) => ({ x: G.footX(x), y: G.footY(y) - 9 }); // マスの真ん中（床）
  const dirAng = d => Math.atan2(DIRV[d][1], DIRV[d][0]);

  // ---- 飛ぶもの：火の玉・魔法の弾・しびれの弾・火の矢・投げた宝（着いたら resolve）
  const SHOT = {
    fire:   { core: '#fbf3e2', halo: '#f0b84a', rim: '#d24a3c', trail: '#d24a3c', sparks: ['#f0b84a', '#d24a3c', '#e1bc88'], size: 4, arc: 8, ms: 3.6, light: ['#ffa850', 2.5, 1.4] },   // 飛んでいるあいだは小さな光（着弾で大きく）
    arcane: { core: '#fbf3e2', halo: '#4aa3e8', rim: '#647091', trail: '#4aa3e8', sparks: ['#4aa3e8', '#b8c4cc', '#fbf3e2'], size: 3, arc: 0, ms: 2.4, light: ['#6ab8ff', 2.5, 1.4] },
    stun:   { core: '#fbf3e2', halo: '#f0b84a', rim: '#cca673', trail: '#f0b84a', sparks: ['#f0b84a', '#fbf3e2'], size: 3, arc: 0, ms: 2.8, wave: 4, light: ['#ffe08a', 6] },
    arrow:  { core: '#fbf3e2', halo: '#f0b84a', rim: '#d24a3c', trail: '#d24a3c', sparks: ['#f0b84a', '#d24a3c', '#fbf3e2'], size: 2, arc: 0, ms: 2.0, sprite: 'arrow', light: ['#ffa850', 5] },
    coin:   { core: '#fbf3e2', halo: '#f0b84a', rim: '#ae6f47', trail: '#f0b84a', sparks: ['#f0b84a', '#fbf3e2'], size: 4, arc: 14, ms: 3.2, light: null },
  };
  function shot(from, to, kind, dir) {
    const S = SHOT[kind], dist = Math.hypot(to.x - from.x, to.y - from.y), ms = Math.round(60 + dist * S.ms);
    const pos = q => {
      const w = S.wave ? Math.sin(q * Math.PI * 4) * S.wave * (1 - q) : 0, nx = -(to.y - from.y) / (dist || 1), ny = (to.x - from.x) / (dist || 1);
      return { x: from.x + (to.x - from.x) * q + nx * w, y: from.y + (to.y - from.y) * q + ny * w - Math.sin(Math.PI * q) * S.arc };
    };
    let lastEmit = 0;
    if (S.light) G.fxLight(t => { const p = pos(t); return { x: p.x, y: p.y + 12, h: 0.6, color: S.light[0], power: S.light[1] * Math.min(1, t * 5), dist: S.light[2] ?? 3 }; }, ms);   // 弾といっしょに動く光
    fx(ms, (g, t, k) => {
      for (let i = 16; i >= 1; i--) { const q = t - i * 0.022; if (q < 0) continue; const p = pos(q), [sx, sy] = G.S(p.x, p.y); dot(g, sx, sy, Math.max(1, Math.round(Math.max(1, S.size - i / 5) * k)), i < 6 ? S.halo : S.trail, (1 - i / 17) * 0.8); }
      const p = pos(t), [sx, sy] = G.S(p.x, p.y);
      if (S.sprite) { const img = G.sprDir(S.sprite, '0', dir || 'd'); g.globalAlpha = 1; g.imageSmoothingEnabled = false; g.drawImage(img, Math.round(sx - img.width * k / 2), Math.round(sy - img.height * k / 2), img.width * k, img.height * k); }
      else { dot(g, sx, sy, Math.round((S.size + 4) * k), S.rim, 0.35); dot(g, sx, sy, Math.round((S.size + 2) * k), S.halo, 0.8); dot(g, sx, sy, Math.round(S.size * k), S.core, 1); }
      if (now() - lastEmit > 18) { lastEmit = now(); burst(p.x, p.y, 2, S.sparks, 22, { life: 320, jit: 3 }); }
    });
    return G.wait(ms);
  }
  // ---- 当たったところの小さな火花
  function impact(c, cols, n = 12, speed = 70) {
    burst(c.x, c.y, Math.round(n * 1.6), cols, speed * 1.2, { life: 440, big: 0.45 });
    fx(260, (g, t, k) => { ellipse(g, c, 3 + 10 * ease(t), 2 + 7 * ease(t), Math.max(1, Math.round(2 * k)), cols[0], (1 - t) * 0.9); });   // 当たった輪
  }
  // ---- 爆発：着弾したマスと、まわり（十字／8マス）に炎の輪と粒
  function explode(tiles, power = 1) {
    G.sfx('explode'); G.shake(1 + power, 150 + power * 40);
    { const c = tileC(tiles[0][0], tiles[0][1]); glow(c.x, c.y + 9, '#ff9a40', 15 + power * 5, 750, { up: 0.06, dist: 4.5 + power, h: 0.7 }); }   // 着弾で大きく
    tiles.forEach(([x, y], i) => {
      const c = tileC(x, y), main = i === 0, R = main ? 13 : 11;
      const blob = (g, cx, cy, r, col, al) => { if (r < 1) return; g.globalAlpha = al; g.fillStyle = col; for (let dy = -Math.round(r); dy <= Math.round(r); dy++) { const w = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)) * 1.25); g.fillRect(Math.round(cx - w), Math.round(cy + dy * 0.8), w * 2 + 1, 1); } };
      fx(620, (g, t, k) => {
        const grow = ease(Math.min(1, t * 2.4)), a = t < 0.35 ? 1 : 1 - ease((t - 0.35) / 0.65), [cx, cy0] = G.S(c.x, c.y), cy = cy0 - 4 * t * k;
        blob(g, cx, cy, (R * grow) * k, '#d24a3c', a * 0.75);                         // 外：赤
        blob(g, cx, cy - 1, (R * 0.72 * grow) * k * (1 - 0.3 * t), '#f0b84a', a * 0.9);  // 中：橙
        blob(g, cx, cy - 2, (R * 0.4 * grow) * k * (1 - t), '#fbf3e2', a);            // 芯：白
        ellipse(g, c, R * 0.6 + R * 0.9 * ease(t), (R * 0.6 + R * 0.9 * ease(t)) * 0.62, Math.max(1, Math.round(2 * k)), '#f0b84a', (1 - t) * 0.8);   // 衝撃の輪
      });
      burst(c.x, c.y - 2, main ? 34 : 16, ['#f0b84a', '#d24a3c', '#e1bc88', '#fbf3e2'], main ? 120 : 80, { up: 30, g: 110, life: 640, big: 0.45 });
      burst(c.x, c.y, main ? 10 : 5, ['#4a4640', '#6e655a', '#a19077'], 26, { up: 34, life: 900, big: 0.8 });   // 煙
    });
    return G.wait(240);
  }
  // ---- 雷：主人公から一直線（ぎざぎざの形は1回だけ決めて、そのまま薄くなる）
  function lightning(from, to) {
    G.sfx('thunder'); G.shake(1, 120);
    const L = Math.hypot(to.x - from.x, to.y - from.y), n = Math.max(3, Math.round(L / 7)), nx = -(to.y - from.y) / (L || 1), ny = (to.x - from.x) / (L || 1);
    const nl = Math.max(2, Math.min(4, Math.round(L / 22)));   // 雷の形に合わせて、線の上に小さな光を並べる（丸くひとつではなく）
    for (let i = 0; i < nl; i++) { const q = (i + 0.5) / nl; glow(from.x + (to.x - from.x) * q, from.y + (to.y - from.y) * q + 12, '#8cc4ff', 4.5, 480, { up: 0.06, dist: 1.7, h: 0.4 }); }
    const pts = Array.from({ length: n + 1 }, (_, i) => { const q = i / n, o = i === 0 || i === n ? 0 : (Math.random() - 0.5) * 9; return { x: from.x + (to.x - from.x) * q + nx * o, y: from.y + (to.y - from.y) * q + ny * o }; });
    const br = [0.2, 0.4, 0.6, 0.8].map(q => { const i = Math.round(q * n), a = pts[i], s = Math.random() < 0.5 ? 1 : -1; return [a, { x: a.x + nx * s * 9 + (to.x - from.x) / (L || 1) * 6, y: a.y + ny * s * 9 + (to.y - from.y) / (L || 1) * 6 }]; });
    fx(420, (g, t, k) => {
      const reach = Math.min(1, t / 0.12), a = t < 0.2 ? 1 : 1 - ease((t - 0.2) / 0.8), m = Math.max(1, Math.ceil(n * reach));
      for (let i = 0; i < m; i++) { seg(g, pts[i], pts[i + 1], Math.max(4, Math.round(5 * k)), '#4aa3e8', a * 0.35); }
      for (let i = 0; i < m; i++) { seg(g, pts[i], pts[i + 1], Math.max(2, Math.round(2 * k)), '#fbf3e2', a); }
      if (reach >= 1) for (const [p, q] of br) { seg(g, p, q, Math.max(2, Math.round(2 * k)), '#4aa3e8', a * 0.5); seg(g, p, q, Math.max(1, Math.round(k)), '#fbf3e2', a * 0.8); }
    });
    return G.wait(160);
  }
  // ---- 毒の霧：まわり8マスに、緑のもやがふくらんで昇って消える
  function poisonCloud(center) {
    G.sfx('poison');
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const c = tileC(center.x + dx, center.y + dy);
      for (let j = 0; j < 3; j++) {
        const ox = (Math.random() - 0.5) * 12, oy = (Math.random() - 0.5) * 8, delay = Math.random() * 0.25, R = 7 + Math.random() * 4;
        fx(900, (g, t, k) => {
          const q = clamp((t - delay) / (1 - delay)); if (q <= 0) return;
          const r = (2 + R * ease(Math.min(1, q * 1.5))) * k, [cx, cy] = G.S(c.x + ox, c.y + oy - q * 10), a = (q < 0.3 ? q / 0.3 : 1 - (q - 0.3) / 0.7) * 0.6;
          g.globalAlpha = a; g.fillStyle = j % 2 ? '#5c7236' : '#8eaa48';
          for (let yy = -Math.round(r); yy <= Math.round(r); yy++) { const w = Math.round(Math.sqrt(Math.max(0, r * r - yy * yy))); g.fillRect(Math.round(cx - w), Math.round(cy + yy * 0.7), w * 2 + 1, 1); }
        });
      }
      burst(c.x, c.y, 3, ['#8eaa48', '#cca673'], 14, { up: 18, life: 700 });
    }
    return G.wait(320);
  }
  // ---- 膜（魔法の盾・回避・鉄骨防御）：キャラのまわりに楕円の輪が下から閉じて、ひし形の粒が昇る
  function barrier(v, col = '#4aa3e8', hi = '#fbf3e2') {
    G.sfx('barrier');
    G.fxLight(t => ({ x: v.px, y: v.py, h: 0.6, color: col, power: 5 * env(t, 0.3), dist: 2.6 }), 900);
    const c = { x: v.px, y: v.py - 12 };
    fx(900, (g, t, k) => {
      const c = { x: v.px, y: v.py - 12 - (v.lift || 0) };      // キャラについていく（回避で1歩よけるとき）
      const draw = ease(Math.min(1, t / 0.3)), a = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35, n = Math.max(2, Math.round(2 * k));
      if (draw >= 1) { const [cx, cy] = G.S(c.x, c.y); g.globalAlpha = 0.16 * a; g.fillStyle = col; for (let dy = -19; dy <= 19; dy++) { const w = Math.round(15 * Math.sqrt(Math.max(0, 1 - (dy / 19) * (dy / 19))) * k); g.fillRect(Math.round(cx - w), Math.round(cy + dy * k), w * 2 + 1, Math.max(1, Math.round(k))); } }
      ellipse(g, c, 15, 19, n, col, a * 0.9, Math.PI / 2 - Math.PI * draw, Math.PI / 2 + Math.PI * draw);
      ellipse(g, c, 12, 16, Math.max(1, Math.round(k)), hi, a * 0.55, Math.PI / 2 - Math.PI * draw, Math.PI / 2 + Math.PI * draw);
    });
    for (let i = 0; i < 16; i++) part({ x: c.x + (Math.random() - 0.5) * 26, y: c.y + 12, vx: 0, vy: -28 - Math.random() * 30, life: 700, col: i % 2 ? col : hi, size: Math.random() < 0.4 ? 2 : 1 });
    return G.wait(300);
  }
  // ---- 力をためる（大打撃・号令・魔力）：足もとから輪が昇り、粒が立ちのぼる
  function powerUp(v, cols = ['#d24a3c', '#f0b84a', '#fbf3e2']) {
    G.sfx('power');
    const f = { x: v.px, y: v.py };
    fx(700, (g, t, k) => {                                    // うっすら光の柱
      const [cx, cy] = G.S(f.x, f.y), a = Math.sin(Math.PI * t) * 0.22, h = 34 * k * ease(Math.min(1, t * 2));
      g.globalAlpha = a; g.fillStyle = cols[1] || cols[0]; g.fillRect(Math.round(cx - 7 * k), Math.round(cy - h), Math.round(14 * k), Math.round(h));
    });
    for (let j = 0; j < 3; j++) fx(700, (g, t, k) => {
      const q = clamp(t * 1.3 - j * 0.2); if (q <= 0) return;
      ellipse(g, { x: f.x, y: f.y - 2 - q * 28 }, 12 - q * 4, 4 - q, Math.max(2, Math.round(2 * k)), cols[j % cols.length], (1 - q) * 0.95);
    });
    for (let i = 0; i < 26; i++) part({ x: f.x + (Math.random() - 0.5) * 20, y: f.y - Math.random() * 6, vx: 0, vy: -34 - Math.random() * 46, life: 700, col: cols[i % cols.length], size: Math.random() < 0.45 ? 2 : 1 });
    return G.wait(320);
  }
  // ---- なぎ払い（蛮人斧）：主人公のまわりを1周する斬撃の弧
  function spin(v) {
    G.sfx('whoosh'); G.sfx('swing_sword');
    const c = { x: v.px, y: v.py - 10 };
    fx(360, (g, t, k) => {
      const head = -Math.PI / 2 + ease(Math.min(1, t / 0.75)) * Math.PI * 2, a = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
      for (let i = 0; i < 48; i++) {
        const ang = head - i * 0.06, w = 1 - i / 48;
        for (const [rr, col, n] of [[25, '#b8c4cc', i < 10 ? 3 : 2], [22, '#fbf3e2', i < 16 ? 2 : 1]]) { const [cx, cy] = G.S(c.x + Math.cos(ang) * rr, c.y + Math.sin(ang) * rr * 0.68); dot(g, cx, cy, Math.max(1, Math.round(n * k)), col, a * w); }
      }
    });
    return G.wait(260);
  }
  // ---- 地割れ（地裂きの大槌）：主人公から向きの先へ、床にひびが走って石が跳ねる
  function groundCrack(from, d, n) {
    G.sfx('crack'); G.shake(3, 220);
    const [dx, dy] = DIRV[d], c0 = tileC(from.x, from.y), start = { x: c0.x + dx * 12, y: c0.y + dy * 12 }, pts = [start];   // 主人公のマスにはかけない（マスの端から）
    for (let i = 1; i <= n * 3; i++) { const q = i / 3; pts.push({ x: start.x + dx * 24 * q + (dy ? (Math.random() - 0.5) * 6 : 0), y: start.y + dy * 24 * q + (dx ? (Math.random() - 0.5) * 4 : 0) }); }
    let popped = 0;                                          // ひびが届いたマスから、石と土ぼこり
    fx(1000, (g, t, k) => {
      const reach = Math.ceil((pts.length - 1) * Math.min(1, t / 0.3)), a = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      for (let i = 0; i < reach; i++) { seg(g, pts[i], pts[i + 1], Math.max(3, Math.round(3 * k)), '#221b17', a * 0.9); seg(g, { x: pts[i].x, y: pts[i].y - 2 }, { x: pts[i + 1].x, y: pts[i + 1].y - 2 }, Math.max(1, Math.round(k)), '#f0b84a', a * 0.6); }
      while (popped < Math.floor(reach / 3)) {
        popped++; const c = tileC(from.x + dx * popped, from.y + dy * popped);
        burst(c.x, c.y, 16, ['#8a5a38', '#5c422c', '#cca673'], 60, { up: 80, g: 280, life: 700, big: 0.7 }); burst(c.x, c.y, 8, ['#6e655a', '#a19077'], 22, { up: 14, life: 900, big: 0.8 });
      }
    });
    return G.wait(320);
  }
  // ---- 小さな大槌を振り下ろす（地裂きの大槌）：主人公の手もとから、後ろへ振りかぶって向きの先の床へ
  function hammerSwing(v, d) {
    G.sfx('whoosh');
    const [dx, dy] = DIRV[d], pv = { x: v.px + dx * 2, y: v.py - 15 }, hit = { x: v.px + dx * 15, y: v.py - 3 + dy * 9 };   // 手もと（支点）と、打つ床の点
    const a1 = Math.atan2((hit.y - pv.y) / 0.8, hit.x - pv.x), a0 = a1 + (dx < 0 ? 2.7 : -2.7), L = 17, ms = 170;   // 2コマ：振りかぶり ms、振り下ろしはそのあと（2026-10-18 ユーザー指定）
    let landed = false;
    fx(ms + 200, (g, t, k) => {
      const q = Math.min(1, t * (ms + 200) / ms);
      const ang = q < 1 ? a0 : a1, al = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2;
      const hx = pv.x + Math.cos(ang) * L, hy = pv.y + Math.sin(ang) * L * 0.8;
      seg(g, pv, { x: hx, y: hy }, Math.max(2, Math.round(2 * k)), '#221b17', al);              // 柄（黒い縁）
      seg(g, pv, { x: hx, y: hy }, Math.max(1, Math.round(k)), '#cca673', al);                    // 柄（木）
      const [cx, cy] = G.S(hx, hy), w = Math.round(9 * k), h = Math.round(7 * k);                  // 頭（鉄の塊）
      g.globalAlpha = al; g.fillStyle = '#221b17'; g.fillRect(Math.round(cx - w / 2) - 1, Math.round(cy - h / 2) - 1, w + 2, h + 2);
      g.fillStyle = '#7a8e9c'; g.fillRect(Math.round(cx - w / 2), Math.round(cy - h / 2), w, h);
      g.fillStyle = '#b8c4cc'; g.fillRect(Math.round(cx - w / 2), Math.round(cy - h / 2), w, Math.max(1, Math.round(k)));
      g.fillStyle = '#506573'; g.fillRect(Math.round(cx - w / 2), Math.round(cy + h / 2) - Math.max(1, Math.round(k)), w, Math.max(1, Math.round(k)));
      if (q >= 1 && !landed) { landed = true; G.sfx('bump'); G.shake(2, 120); burst(hit.x, hit.y + 2, 10, ['#a19077', '#6e655a', '#cca673'], 40, { up: 30, g: 160, life: 500, big: 0.6 }); }
    });
    return G.wait(ms + 20);
  }
  // ---- 速さの線（突進・素早い一撃）
  function speedLines(a, b) {
    fx(260, (g, t, k) => {
      const al = 1 - t, L = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
      for (const o of [-8, -5, -2, 1, 4, 7]) seg(g, { x: a.x + nx * o, y: a.y + ny * o }, { x: a.x + (b.x - a.x) * (0.4 + 0.6 * t) + nx * o, y: a.y + (b.y - a.y) * (0.4 + 0.6 * t) + ny * o }, 1, '#fbf3e2', al * 0.55);
    });
  }
  // ---- うず（瞬間移動）：inward＝吸い込まれて消える／外＝広がって現れる
  function swirl(c, inward) {
    fx(360, (g, t, k) => {
      for (let i = 0; i < 24; i++) {
        const ang = i / 24 * Math.PI * 2 + t * 6 + (i % 3) * 0.4, r = (inward ? 1 - ease(t) : ease(t)) * (18 + (i % 3) * 4) + 2, [sx, sy] = G.S(c.x + Math.cos(ang) * r, c.y + Math.sin(ang) * r * 0.75);
        dot(g, sx, sy, Math.max(1, Math.round((i % 2 ? 2 : 1) * k)), i % 2 ? '#4aa3e8' : '#fbf3e2', (inward ? 1 - t * 0.6 : 1 - t) * 0.95);
      }
    });
    return G.wait(200);
  }

  // ---- カードごとの演出（animatePlayerPhase から）。true＝見せ終わった（敵の変化も済ませた）
  const firstHit = (s0, mid) => s0.enemies.find(e => { const m = mid.enemies.find(n => n.id === e.id); return !m || m.hp !== e.hp || !!m.immobilized !== !!e.immobilized; });
  function lineEnd(s0, d, range) {                               // 向きの先で、壁の手前の最後のマス
    let x = s0.player.x, y = s0.player.y;
    for (let i = 1; i <= range; i++) { const nx = x + DIRV[d][0], ny = y + DIRV[d][1]; if (s0.map[ny]?.[nx] !== '.') break; x = nx; y = ny; }
    return { x, y };
  }
  async function playEffect(c, cobj, s0, mid, action) {
    const p = G.view.player, d = action.direction, me = body(p), m = c.magicEffect, w = c.warriorEffect, r = c.rogueEffect;
    const hit = firstHit(s0, mid), hitV = hit && G.findView(hit.id), hitC = hitV ? body(hitV) : null;
    const after = async () => { await animateEnemyChanges(s0, mid, d, true); };
    if (m === 'bolt' || m === 'paralysis') {
      G.sfx('magic'); const to = hitC || tileC(lineEnd(s0, d, c.range).x, lineEnd(s0, d, c.range).y);
      await shot(me, to, m === 'bolt' ? 'arcane' : 'stun', d);
      glow(to.x, to.y + 12, m === 'bolt' ? '#6ab8ff' : '#ffe08a', m === 'bolt' ? 13 : 9, 460, { up: 0.08, dist: m === 'bolt' ? 3.6 : 3 });   // 着弾で大きく
      impact(to, m === 'bolt' ? ['#4aa3e8', '#fbf3e2', '#b8c4cc'] : ['#f0b84a', '#fbf3e2'], m === 'bolt' ? 16 : 10);
      await after(); return true;
    }
    if (m === 'lightning') { const e = lineEnd(s0, d, c.range); await lightning(me, tileC(e.x, e.y)); for (const e2 of s0.enemies) { const v = G.findView(e2.id); if (v && !mid.enemies.some(n => n.id === e2.id && n.hp === e2.hp)) impact(body(v), ['#4aa3e8', '#fbf3e2'], 8); } await after(); return true; }
    if (m === 'blast') {
      G.sfx('magic');
      const n = action.distance || 1, land = { x: s0.player.x + DIRV[d][0] * n, y: s0.player.y + DIRV[d][1] * n };
      await shot(me, tileC(land.x, land.y), 'fire', d);
      const area = [[land.x, land.y]];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; if (!c.square && dx && dy) continue; if (s0.map[land.y + dy]?.[land.x + dx] === '.') area.push([land.x + dx, land.y + dy]); }
      await explode(area, c.square ? 2 : 1); await after(); return true;
    }
    if (m === 'poison') { await poisonCloud(s0.player); await after(); return true; }
    if (m === 'shield') { await barrier(p, '#4aa3e8'); return true; }
    if (m === 'evade') { await barrier(p, '#b8c4cc'); return true; }
    if (m === 'fetch') { await fetchItems(s0, mid); return true; }
    if (['replenish', 'detect', 'enchant'].includes(m)) { await powerUp(p, ['#4aa3e8', '#647091', '#fbf3e2']); return true; }
    if (w === 'areaAttack' && c.area === 'around') { await spin(p); await after(); return true; }
    if (w === 'areaAttack' && c.area === 'line') { await hammerSwing(p, d); await groundCrack(s0.player, d, c.range); await after(); return true; }
    if (w === 'boost' || w === 'rally') { await powerUp(p); return true; }
    if (w === 'retain') { await barrier(p, '#b8c4cc', '#7a8e9c'); return true; }
    if (r === 'throw') { G.sfx('shoot'); await shot(me, hitC || tileC(lineEnd(s0, d, c.range).x, lineEnd(s0, d, c.range).y), 'coin', d); if (hitC) { G.sfx('tally_coin'); impact(hitC, ['#f0b84a', '#fbf3e2'], 12); } await after(); return true; }
    if (r === 'strike' && cobj.cardId === 'fireArrow') { G.sfx('shoot'); await shot(me, hitC || tileC(lineEnd(s0, d, c.range).x, lineEnd(s0, d, c.range).y), 'arrow', d); if (hitC) { impact(hitC, ['#f0b84a', '#d24a3c', '#fbf3e2'], 18, 90); glow(hitC.x, hitC.y + 12, '#ffa850', 9, 450, { up: 0.1, dist: 3 }); } await after(); return true; }
    if (r === 'strike') {                                      // 素早い一撃：速さの線と、突きの絵を短く
      G.sfx('whoosh'); if (hitC) { speedLines(me, hitC); const img = G.sprDir('thrust', '0', d); G.addFx('thrust', [['0', 30], ['1', 40], ['2', 40]], hitC.x - img.width / 2, hitC.y - img.height / 2, { dir: d }); await G.wait(70); impact(hitC, ['#fbf3e2', '#b8c4cc'], 8, 60); }
      await after(); return true;
    }
    return false;
  }
  async function afterWeapon(c, s0, mid) {                     // 魔法杖：魔力をためた
    if ((mid.player.magicCharge ?? 0) > (s0.player.magicCharge ?? 0)) await powerUp(G.view.player, ['#4aa3e8', '#647091', '#fbf3e2']);
  }
  async function fetchItems(s0, mid) {                          // 取寄魔法：床の品が主人公へ飛んでくる
    G.sfx('magic');
    const p = G.view.player, to = body(p), got = s0.items.filter(i => !mid.items.some(j => j.x === i.x && j.y === i.y));
    G.view.items = G.view.items.filter(i => !got.some(gg => gg.x === i.x && gg.y === i.y));
    got.forEach((it, i) => {
      const from = tileC(it.x, it.y), img = G.spr(...G.iconRef(it.cardId));
      fx(420 + i * 60, (g, t, k) => {
        const q = ease(clamp((t * (420 + i * 60) - i * 60) / 420)), x = from.x + (to.x - from.x) * q, y = from.y + (to.y - from.y) * q - Math.sin(Math.PI * q) * 14, [sx, sy] = G.S(x, y);
        g.globalAlpha = q < 0.85 ? 1 : (1 - q) / 0.15; g.imageSmoothingEnabled = false; g.drawImage(img, Math.round(sx - img.width * k / 2), Math.round(sy - img.height * k / 2), img.width * k, img.height * k);
        if (Math.random() < 0.5) burst(x, y, 1, ['#4aa3e8', '#fbf3e2'], 10, { life: 240, jit: 3 });
      });
    });
    await G.wait(480 + got.length * 60); G.sfx('pickup');
  }
  // ---- 動く魔法・技（瞬間移動・飛行・突進魔法・突破の構え・回避障壁）。true＝見せ終わった
  async function playMove(c, s0, mid, action) {
    const p = G.view.player, m = c.magicEffect, w = c.warriorEffect, to = { x: mid.player.x, y: mid.player.y };
    const moveP = async (path, ms, lift = () => 0, each = null) => {     // 道に沿って主人公を動かす（lift：浮き上がり）
      const pts = [{ x: p.px, y: p.py }, ...path.map(c2 => ({ x: G.footX(c2.x), y: G.footY(c2.y) }))], n = pts.length - 1, t0 = now();
      for (;;) {
        const q = Math.min(1, (now() - t0) / ms), f = q * n, i = Math.min(n - 1, Math.floor(f)), r2 = f - i;
        p.px = pts[i].x + (pts[i + 1].x - pts[i].x) * r2; p.py = pts[i].y + (pts[i + 1].y - pts[i].y) * r2; p.lift = lift(q);
        if (each) each(q); if (q >= 1) break; await G.wait(16);
      }
      p.lift = 0; p.x = to.x; p.y = to.y; p.px = G.footX(to.x); p.py = G.footY(to.y);
    };
    const straight = () => { const out = []; let x = s0.player.x, y = s0.player.y; for (let i = 0; i < 9 && (x !== to.x || y !== to.y); i++) { x += DIRV[action.direction][0]; y += DIRV[action.direction][1]; out.push({ x, y }); } return out; };
    if (m === 'teleport') {
      G.sfx('teleport'); swirl(body(p), true);
      let t0 = now(); while (now() - t0 < 180) { p.alpha = 1 - (now() - t0) / 180; await G.wait(16); }
      Object.assign(p, { x: to.x, y: to.y, px: G.footX(to.x), py: G.footY(to.y) }); p.dir = action.direction;
      swirl(body(p), false); t0 = now(); while (now() - t0 < 200) { p.alpha = (now() - t0) / 200; await G.wait(16); } p.alpha = 1;
      return true;
    }
    if (m === 'flight' && action.path) {
      G.sfx('whoosh');
      const path = []; let x = s0.player.x, y = s0.player.y; for (const d of action.path) { x += DIRV[d][0]; y += DIRV[d][1]; path.push({ x, y }); }
      p.dir = action.path[0];
      await moveP(path, 150 * path.length, q => Math.round(Math.min(1, q * 6, (1 - q) * 6) * 7), q => { p.dir = action.path[Math.min(action.path.length - 1, Math.floor(q * action.path.length))]; if (Math.random() < 0.4) burst(p.px, p.py + 2, 1, ['#b8c4cc', '#fbf3e2'], 12, { life: 300, up: -10 }); });
      G.sfx('step'); burst(p.px, p.py, 6, ['#a19077', '#6e655a'], 20, { life: 380 });
      return true;
    }
    if (m === 'charge') {                                        // 突進魔法：一気に駆けて当たる
      const path = straight(); G.sfx('whoosh'); speedLines(body(p), body({ px: G.footX(to.x), py: G.footY(to.y) }));
      await moveP(path, 55 * path.length);
      const hit = firstHit(s0, mid), v = hit && G.findView(hit.id);
      if (v) { G.sfx('hit'); G.shake(2, 140); impact(body(v), ['#4aa3e8', '#fbf3e2', '#647091'], 18, 90); }
      await animateEnemyChanges(s0, mid, action.direction, true); return true;
    }
    if (w === 'breakthrough') {                                  // 突破の構え：敵の上を跳び越える
      const path = straight(), n = path.length; G.sfx('whoosh');
      await moveP(path, 75 * n + 40, q => Math.round(Math.sin(Math.PI * q) * (7 + 3 * n)));   // 速く跳ぶ（2026-10-18 ユーザー指定）
      G.sfx('bump'); G.shake(1, 100); burst(p.px, p.py, 8, ['#a19077', '#6e655a', '#cca673'], 30, { life: 420 });
      await barrier(p, '#b8c4cc', '#7a8e9c'); return true;
    }
    if (m === 'evade') { await barrier(p, '#b8c4cc'); await moveP(straight(), 120, q => Math.round(Math.sin(Math.PI * q) * 4)); return true; }
    return false;
  }
  function blockKept(v) { return barrier(v, '#b8c4cc', '#7a8e9c'); }   // 敵の攻撃を受けても防御が残った（鉄骨防御・城塞の鎧・魔法の盾）

  // ---- 爆炎の着弾の範囲（向きを選んでいるあいだ、着弾のマスとまわりを橙の枠で）
  function drawBlastArea(g, tg) {
    if (tg.kind !== 'blast' || !tg.dir || !tg.dist) return;
    const st = G.st, land = { x: st.player.x + DIRV[tg.dir][0] * tg.dist, y: st.player.y + DIRV[tg.dir][1] * tg.dist }, tx = x => (x - 1) * T, ty = y => (y - 1) * T;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!tg.square && dx && dy) continue;
      const x = land.x + dx, y = land.y + dy; if (st.map[y]?.[x] !== '.') continue;
      g.fillStyle = `rgba(240,184,74,${dx || dy ? 0.28 : 0.45})`; g.fillRect(tx(x) + 2, ty(y) + 2, T - 5, T - 5);
      g.lineWidth = 1; g.strokeStyle = 'rgba(240,184,74,0.95)'; g.strokeRect(tx(x) + 2.5, ty(y) + 2.5, T - 6, T - 6);
    }
  }

  // ---- 一時待機の山（盗賊）：ライトのカードは手札から一時待機へ、ターンが進むと一時待機から捨て札へ飛ぶ
  function flyCards(fromSel, toSel, n) {
    const stage = document.querySelector('#stage'), a = document.querySelector(fromSel), b = document.querySelector(toSel);
    if (!stage || !a || !b || !n) return;
    const sr = stage.getBoundingClientRect(), ar = a.querySelector('.stack')?.getBoundingClientRect() || a.getBoundingClientRect(), br = b.querySelector('.stack')?.getBoundingClientRect() || b.getBoundingClientRect();
    for (let i = 0; i < Math.min(n, 4); i++) {
      const el = document.createElement('i'); el.className = 'cr-fly';
      Object.assign(el.style, { left: `${ar.left - sr.left}px`, top: `${ar.top - sr.top}px`, width: `${Math.min(ar.width, br.width)}px`, height: `${Math.min(ar.height, br.height)}px` });
      stage.appendChild(el);
      const dx = br.left - ar.left, dy = br.top - ar.top;
      el.animate([{ transform: 'translate(0,0)', opacity: 1 }, { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 20}px)`, opacity: 1, offset: 0.5 }, { transform: `translate(${dx}px, ${dy}px)`, opacity: 0.6 }],
        { duration: 300, delay: i * 50, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'forwards' }).onfinish = () => el.remove();
    }
  }

  // ---- 手札の色帯の文字（2の新しいカード。null なら1と同じ決め方）
  const WORD = {
    paralysis: '痙攣', fetch: '取寄せ', teleport: '瞬間移動', flight: '飛行', replenish: '補充', detect: '探知', enchant: '付与',
    deleteHand: '捨てていく', boost: '強撃+8', retain: '鉄骨防御', upgradeWeapon: '武器+1', upgradeArmor: '防具+1', rally: '号令', recover: '回収',
    snare: '足止め', hunt: '宝探し', exchange: '入れ替え', delete: '大削除', searchLight: '調査', fusion: '小合体', ember: '残火', searchTreasure: '宝整理',
  };
  function cardEffect(cobj) {
    const c = G.HK.cardOf(cobj);
    if (c.magicEffect) return c.magicBlock ? `防御${c.magicBlock}` : c.magicEffect === 'charge' ? `突進×${c.power}` : c.power ? `魔法${c.power}` : WORD[c.magicEffect];
    if (c.damage) return null;
    if (c.warriorEffect === 'breakthrough') return `突破${c.moveDistance}`;
    if (c.warriorEffect) return WORD[c.warriorEffect] || c.type;
    if (c.rogueEffect) {
      const r = c.rogueEffect;
      return r === 'strike' ? `攻撃${c.power}` : r === 'throw' ? `宝投げ${c.power}` : r === 'move' ? (c.treasureMove ? '宝歩き' : `移動${c.moveDistance}`)
        : r === 'heal' ? `回復${c.power}` : r === 'ward' ? `防御+${c.power}` : r === 'trap' ? `宝罠${c.power}` : WORD[r] || c.type;
    }
    if (c.leather) return `防御+${c.block}`;
    return null;
  }
  // 体力の下の効果の札（2で増えた状態）
  function statusEffects() {
    const st = G.st, p = st.player;
    return [p.magicCharge && `魔力＋${p.magicCharge}`, p.magicShieldHits && '魔法の盾', p.ironDefense && '鉄骨防御', p.fortressHits && '城塞の鎧',
      p.leatherBonus && `革鎧＋${p.leatherBonus}`, p.swordCharge && `剣＋${p.swordCharge}`, st.preserveMagic && '補充魔法',
      st.detectNextFloor && '次の階：魔法', st.extraItemsNextFloor && `次の階：品＋${st.extraItemsNextFloor}`].filter(Boolean);
  }

  // ---- 確認用（?dev の C）：全部のカードの一覧から、手札に入れる。5枚あるときは選んでいるカード（なければ右端）と入れ替え
  function devCards() {
    let el = document.getElementById('cr-dev');
    if (el) { el.remove(); return; }
    const HK = G.HK, ids = Object.keys(HK.cards), byType = new Map();
    for (const id of ids) { const t = HK.cards[id].type; if (!byType.has(t)) byType.set(t, []); byType.get(t).push(id); }
    el = document.createElement('div'); el.id = 'cr-dev';
    el.innerHTML = '<div class="bar"><b>全部のカード（確認用）</b><input placeholder="名前でしぼる"><button data-a="clear">手札を空に</button><button data-a="heal">HP全快</button><button data-a="close">閉じる（C）</button></div><div class="list"></div>';
    const list = el.querySelector('.list');
    const draw = (f = '') => {
      list.innerHTML = '';
      for (const [t, arr] of byType) {
        const hit = arr.filter(id => !f || HK.cards[id].name.includes(f)); if (!hit.length) continue;
        const h = document.createElement('h4'); h.textContent = `${t}（${hit.length}）`; list.appendChild(h);
        for (const id of hit) { const b = document.createElement('button'); b.title = HK.cards[id].description || ''; b.append(G.iconCanvas(id), HK.cards[id].name); b.onclick = () => add(id); list.appendChild(b); }
      }
    };
    const add = id => {
      const st = G.st, card = { id: st.nextCardId++, cardId: id };
      if (HK.cards[id].light && !Array.isArray(st.waitingPile)) st.waitingPile = [];   // ライトのカードは一時待機の山が要る（盗賊以外で試すとき）
      if (st.hand.length < 5) st.hand.push(card);
      else { const i = st.hand.findIndex(h => h.id === G.selected); st.hand.splice(i >= 0 ? i : st.hand.length - 1, 1, card); }
      G.cancelAll2(); G.say(`${HK.cards[id].name}を手札に`);
    };
    el.querySelector('input').oninput = ev => draw(ev.target.value.trim());
    el.querySelector('.bar').onclick = ev => {
      const a = ev.target.dataset?.a; if (!a) return;
      if (a === 'close') el.remove();
      if (a === 'clear') { G.st.hand.length = 0; G.cancelAll2(); }
      if (a === 'heal') { G.st.player.hp = G.st.player.maxHp; G.syncUI(); }
    };
    el.addEventListener('keydown', ev => ev.stopPropagation());
    draw(); document.getElementById('stage').appendChild(el);
  }

  return { aimOnSelect, devCards, areaHas, drawAfter, newRun, targetSpec, targetOptions, pathKey, pathClick, pathConfirm, drawTargeting, useCard, enemiesChanged, animateEnemyChanges, cardEffect, statusEffects,
    drawFx, playEffect, playMove, afterWeapon, blockKept, flyCards };
};
