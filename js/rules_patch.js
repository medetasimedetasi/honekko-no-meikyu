// 元ルールからの変更点（logic.js は無改変のまま、ここで HK の関数を差し替える）。logic.js の直後に読み込む
// 2026-10-09 ユーザー指定：「歩く」が手札にないときに十字キーの自動移動で使うカードの優先順位を入れ替え
//   数字が小さいカードから使う。同じ数字なら手札の左から。90 以上は確認を出す（元と同じ）
//   元の値：財宝 10/20・射程内に敵のいない武器 40・満タン時の回復薬 50・防御1以下の防具 60・防御2以上の防具と守護の薬 70・
//           移動カードと残火の札 80・射程内に敵のいる武器 90・食料と減っている時の回復薬・強撃の薬・引き直しの護符 100・巻物 105・帰還の巻物 110
(() => {
  const { cardOf, dirs, firstInRange, isFloor, enemyAt, confirmPriority } = HK;

  function movePriority(card, st) {
    const c = cardOf(card);
    if (c.damage) return Object.keys(dirs).some(d => firstInRange(st, c, d)) ? 90 : 89;   // 武器：射程内に敵がいる 90／いない 89
    if (c.maxHpGain) return 61;                                                           // 食料
    if (c.heal) return st.player.hp < st.player.maxHp ? 61 : 40;                          // 回復薬類：HPが減っている 61／満タン 40
    if (c.attackBoost || c.redraw) return st.enemies.length ? 100 : 56;                   // 強撃の薬・引き直しの護符：階に敵がいる 100／いない 56
    if (c.scrollEffect) return 30;                                                        // 選好・合体・削除の巻物
    if (c.type === 'ポーション' && c.block) return 55;                                    // 守護の薬
    if (c.block) return (c.reflect || c.block >= 3 ? 70 : 60) + c.block / 100;            // 防具：防御3以上と鏡の盾 70／防御2以下 60。同じ帯では今の防御（強化込み）が低いものから使う
    if (c.ember) return 81;                                                               // 残火の札
    if (c.moveDistance) return 80 + c.moveDistance / 100;                                 // 移動カード（走る〜全力疾走）。移動の数が小さいものから使う（2026-10-09 ユーザー指定。強いものを後に残す）
    return c.alternativeMovePriority ?? confirmPriority;                                  // 財宝 10/20・帰還の巻物 110 など（元のまま）
  }

  // 元の autoMove と同じ手順（移動先の確認 → 「歩く」があればそれ → なければ数字のいちばん小さいカードで強行移動）。優先順位だけ上の movePriority を使う
  function autoMove(st, d) {
    if (st.gameStatus !== 'PLAYING') return { ok: false, message: 'ゲームは終了しています。' };
    if (!Object.hasOwn(dirs, d)) return { ok: false, message: '方向はW/A/S/Dから選んでください。' };
    const [dx, dy] = dirs[d], to = { x: st.player.x + dx, y: st.player.y + dy };
    if (!isFloor(st, to) || enemyAt(st, to)) return { ok: false, message: '壁または敵がいるため移動できません。' };
    const walk = st.hand.find(c => c.cardId === 'walk');
    if (walk) return { ok: true, card: walk, mode: 'effect', needsConfirmation: false };
    let best;
    for (const card of st.hand) {
      const priority = movePriority(card, st);
      if (!best || priority < best.priority) best = { card, priority };
    }
    return best ? { ok: true, ...best, mode: 'forced', needsConfirmation: best.priority >= confirmPriority }
                : { ok: false, message: '手札に移動に使用できるカードがありません。' };
  }

  Object.assign(HK, { movePriority, autoMove });
})();
