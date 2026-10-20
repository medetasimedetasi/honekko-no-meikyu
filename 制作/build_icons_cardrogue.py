# 2（CardRogue）の新しいカードの絵を、3D版の js/icons_cardrogue.js に書き出す（2026-10-18）。
# 絵は カードの絵_カードローグ_20261018/icons_cardrogue.json（カードアイコンのセッションの カードの絵を作る_カードローグ.py が書き出す）。
# 1の絵（js/icons.js）は書き換えない。2の絵は別の組（game3d.js の icon_cr）にして、2を遊ぶときだけ使う。
# 名前が1と同じカード（剣・黄金剣・革鎧）は1の絵を共有する（引継ぎ_カードの絵_カードローグ_20261018.md の決まり）
import json, pathlib

here = pathlib.Path(__file__).resolve().parents[1]
src = here.parent / 'カードの絵_カードローグ_20261018' / 'icons_cardrogue.json'
d = json.loads(src.read_text(encoding='utf8'))
out = {'w': d['w'], 'h': d['h'], 'pal': d['pal'], 'frames': d['frames'], 'iconOf': d['iconOf'],
       'share': {'rogueSword': 'sword', 'wizardGoldSword': 'swordgold', 'leather': 'armor'}}   # 1の絵（icon の組）を使うカード
dst = here / 'js' / 'icons_cardrogue.js'
dst.write_text('// 2（CardRogue）の新しいカードの絵（18×18、共有32色・外周1ドット黒・中80%）。制作/build_icons_cardrogue.py が書き出す。手で直さない\n'
               'globalThis.SPR_ICON_CR=' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf8')
print('wrote', dst, len(d['frames']), 'frames', len(d['iconOf']), 'cards')
