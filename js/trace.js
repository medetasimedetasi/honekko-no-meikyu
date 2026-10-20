// 敵ターンを「演出用の出来事の列」として書き出す。
// 判定は元ロジックの se() と同じ順番・同じ条件でなぞる。実際の盤面は元の se() が決め、
// こちらは見せ方の台本だけを作る（ゲームではずれたら警告して、差分だけの演出に切り替える）。
(function () {
  const DIRS = [[0, -1, 'w'], [-1, 0, 'a'], [0, 1, 's'], [1, 0, 'd']];
  const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

  function snapshot(st) {
    return {
      map: st.map.slice(),
      player: { x: st.player.x, y: st.player.y, hp: st.player.hp, temporaryBlock: st.player.temporaryBlock, reflect: !!st.player.reflect },
      enemies: st.enemies.map(e => ({ id: e.id, type: e.type, name: e.name, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, attack: e.attack, poison: e.poison ?? 0, immobilized: !!e.immobilized })),
    };
  }

  function traceEnemyTurn(src) {
    const s = snapshot(src), p = s.player, list = s.enemies, ev = [];
    const floor = c => s.map[c.y]?.[c.x] === '.';
    const at = c => list.find(e => e.x === c.x && e.y === c.y);
    const hurt = (e, n, kind) => {
      e.hp -= n;
      ev.push({ t: 'hit', id: e.id, amount: n, kind, hpAfter: e.hp });
      if (e.hp <= 0 && list.includes(e)) { list.splice(list.indexOf(e), 1); ev.push({ t: 'die', id: e.id }); }
    };
    for (const e of [...list]) if (e.poison > 0) { e.poison--; hurt(e, 1, 'poison'); }
    for (const e of [...list]) {
      if (p.hp <= 0) break;
      const stuck = e.immobilized; e.immobilized = false;
      if (dist(e, p) === 1) {
        const block = p.temporaryBlock, blocked = Math.min(block, e.attack), dmg = Math.max(0, e.attack - block);
        p.temporaryBlock = 0; p.hp = Math.max(0, p.hp - dmg);
        ev.push({ t: 'attack', id: e.id, from: { x: e.x, y: e.y }, dmg, blocked, hpAfter: p.hp });
        if (p.reflect) hurt(e, blocked, 'reflect');
        p.reflect = false;
        continue;
      }
      if (stuck) { ev.push({ t: 'stuck', id: e.id }); continue; }
      const options = DIRS.map(([dx, dy, d]) => ({ x: e.x + dx, y: e.y + dy, d }))
        .filter(c => floor(c) && !at(c) && !(c.x === p.x && c.y === p.y) && dist(c, p) < dist(e, p))
        .sort((a, b) => dist(a, p) - dist(b, p));
      if (options.length) {
        const to = options[0];
        ev.push({ t: 'move', id: e.id, from: { x: e.x, y: e.y }, to: { x: to.x, y: to.y }, d: to.d });
        e.x = to.x; e.y = to.y;
      } else ev.push({ t: 'wait', id: e.id });
    }
    return { events: ev, result: s };
  }

  // 元の se() の結果と台本の結果が同じか
  function matches(trace, st) {
    const r = trace.result;
    if (r.player.hp !== st.player.hp || r.player.temporaryBlock !== st.player.temporaryBlock || r.player.reflect !== !!st.player.reflect) return false;
    if (r.enemies.length !== st.enemies.length) return false;
    return r.enemies.every((e, i) => {
      const o = st.enemies[i];
      return o.id === e.id && o.x === e.x && o.y === e.y && o.hp === e.hp && (o.poison ?? 0) === e.poison && !!o.immobilized === e.immobilized;
    });
  }

  // ---- 2（CardRogue.html の関数 Fe）の敵ターン（2026-10-18）。1との違い：足止めは数で数える（毎ターン1減る）、
  // 鉄骨防御・城塞の鎧・魔法の盾は1回だけ防御を残す（革鎧の加算も防御と一緒に消える）、軽減した量を返し刃用に足す、ロードオブザピットは2マス進む
  function snapshot2(st) {
    const s = snapshot(st), p = st.player;
    Object.assign(s.player, { lastBlocked: p.lastBlocked ?? 0, ironDefense: p.ironDefense ?? 0, fortressHits: p.fortressHits ?? 0, magicShieldHits: p.magicShieldHits ?? 0, leatherBonus: p.leatherBonus ?? 0 });
    st.enemies.forEach((e, i) => { s.enemies[i].immobilized = e.immobilized; });
    return s;
  }
  function traceEnemyTurn2(src) {
    const s = snapshot2(src), p = s.player, list = s.enemies, ev = [];
    const floor = c => s.map[c.y]?.[c.x] === '.';
    const at = c => list.find(e => e.x === c.x && e.y === c.y);
    const hurt = (e, n, kind) => {
      e.hp -= n;
      ev.push({ t: 'hit', id: e.id, amount: n, kind, hpAfter: e.hp });
      if (e.hp <= 0 && list.includes(e)) { list.splice(list.indexOf(e), 1); ev.push({ t: 'die', id: e.id }); }
    };
    for (const e of [...list]) if (e.poison > 0) { e.poison--; hurt(e, 1, 'poison'); }
    for (const e of [...list]) {
      if (p.hp <= 0) break;
      const stuck = e.immobilized; e.immobilized = Math.max(0, Number(e.immobilized || 0) - 1) || false;
      if (dist(e, p) === 1) {
        const block = p.temporaryBlock, blocked = Math.min(block, e.attack), dmg = Math.max(0, e.attack - block);
        p.lastBlocked += blocked;
        let kept = false;
        if (p.ironDefense > 0) { p.ironDefense--; kept = true; } else if (p.fortressHits > 0) { p.fortressHits--; kept = true; } else if (p.magicShieldHits > 0) { p.magicShieldHits--; kept = true; }
        if (!kept) { p.temporaryBlock = 0; p.leatherBonus = 0; }
        p.hp = Math.max(0, p.hp - dmg);
        ev.push({ t: 'attack', id: e.id, from: { x: e.x, y: e.y }, dmg, blocked, kept, hpAfter: p.hp });
        if (p.reflect) hurt(e, blocked, 'reflect');
        p.reflect = false;
        continue;
      }
      if (stuck) { ev.push({ t: 'stuck', id: e.id }); continue; }
      const steps = e.type === 'pitLord' ? 2 : 1;
      let moved = false;
      for (let i = 0; i < steps && dist(e, p) > 1; i++) {
        const options = DIRS.map(([dx, dy, d]) => ({ x: e.x + dx, y: e.y + dy, d }))
          .filter(c => floor(c) && !at(c) && !(c.x === p.x && c.y === p.y) && dist(c, p) < dist(e, p))
          .sort((a, b) => dist(a, p) - dist(b, p));
        if (!options.length) break;
        const to = options[0];
        ev.push({ t: 'move', id: e.id, from: { x: e.x, y: e.y }, to: { x: to.x, y: to.y }, d: to.d });
        e.x = to.x; e.y = to.y; moved = true;
      }
      if (!moved) ev.push({ t: 'wait', id: e.id });
    }
    return { events: ev, result: s };
  }
  function matches2(trace, st) {
    const r = trace.result;
    if (r.player.hp !== st.player.hp || r.player.temporaryBlock !== st.player.temporaryBlock || r.player.reflect !== !!st.player.reflect) return false;
    if (r.enemies.length !== st.enemies.length) return false;
    return r.enemies.every((e, i) => {
      const o = st.enemies[i];
      return o.id === e.id && o.x === e.x && o.y === e.y && o.hp === e.hp && (o.poison ?? 0) === e.poison && !!o.immobilized === !!e.immobilized;
    });
  }

  globalThis.HKTrace = { snapshot, traceEnemyTurn, matches, traceEnemyTurn2, matches2 };
})();
