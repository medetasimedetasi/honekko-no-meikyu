# 職業の紋章（2026-10-14 ユーザー指定）：紋章の盾の土台＋職業のドット絵（盗賊＝ナイフ、戦士＝鎧、魔法使い＝杖）。
# 大（job_*）：左下の顔グラの左上に置く。盾 20×24 粒、紙 28×30。絵は盾から少しはみ出すくらい大きく
# 小（job_*_s）：ランキングの表（キャラの頭の絵 14 の横）に置く。盾 11×13 粒、紙 15×16（大を縮めるとドットがくずれるので、別に打つ）
# 盾の外の縁は濃紺、内側に金のふち、中は青（右下半分は一段暗く）。絵のまわりには濃紺の縁（はみ出した所でも読めるように）
# 動かすと、js/game3d.js の UI_ICONS に貼る行を 制作/職業の紋章.txt に書き、見本 制作/職業の紋章_8倍.png を作る
import math, os
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
PAL = {'K': '#0b1120', 'g': '#f0b84a', 'G': '#ae6f47', 'f': '#425c8d', 'F': '#2b3e6d',
       'w': '#fbf3e2', 's': '#b8c4cc', 'S': '#7a8e9c', 'h': '#8a5a38', 'H': '#5c422c', 'o': '#4aa3e8', 'O': '#2b3e6d'}
BIG = dict(SW=20, SH=24, W=28, H=30, SX=4, SY=3, flat=12, rim=2)
SMALL = dict(SW=11, SH=13, W=15, H=16, SX=2, SY=1, flat=6, rim=2)   # rim 2＝濃紺の縁の内側に金を1粒

def shield(c):
    SW, SH, flat, rim = c['SW'], c['SH'], c['flat'], c['rim']
    def inside(x, y):
        if y < 0 or y >= SH or x < 0 or x >= SW: return False
        cx = (SW - 1) / 2
        if y <= flat: return not (y == 0 and x in (0, SW - 1))
        t = (y - flat) / (SH - flat)                    # 下はとがる（ふくらんだ弧で）
        hw = (SW / 2) * math.sqrt(max(0, 1 - t * t)) - t * 1.2
        return abs(x - cx) <= hw
    g = [['.'] * c['W'] for _ in range(c['H'])]
    for y in range(SH):
        for x in range(SW):
            if not inside(x, y): continue
            ch = 'K' if any(not inside(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))) else None
            if not ch and any(not inside(x + dx, y + dy) for dx in range(-rim, rim + 1) for dy in range(-rim, rim + 1) if abs(dx) + abs(dy) <= rim):
                ch = 'G' if (x > SW / 2 and y > SH / 6) or y > SH - SH / 4 else 'g'   # 金のふち（右下は影の金）
            if not ch: ch = 'F' if x + y * 0.8 > SW * 0.95 else 'f'                  # 中：右下半分は一段暗く
            g[c['SY'] + y][c['SX'] + x] = ch
    return g

def blank(n): return [['.'] * n for _ in range(n)]
def setp(a, x, y, ch):
    if 0 <= y < len(a) and 0 <= x < len(a[0]): a[y][x] = ch

def knife(n, kb, kh, guard):    # 右上へ向けた刃（白と鋼の3粒幅）、金のつば、茶の柄、金の柄頭。刃は短め（長いと剣に見える）
    a = blank(n); c = lambda k: n - 2 - k
    for k in range(kb):
        setp(a, c(k) - 1, k, 'w'); setp(a, c(k), k, 'w'); setp(a, c(k) + 1, k, 's')
    for d in range(-guard, guard + 1): setp(a, c(kb) + d, kb + d, 'g')
    for k in range(kb + 1, kb + 1 + kh): setp(a, c(k) - 1, k, 'h'); setp(a, c(k), k, 'H')
    setp(a, c(kb + 1 + kh) - 1, kb + 1 + kh, 'g'); setp(a, c(kb + 1 + kh), kb + 1 + kh, 'g')
    return a

def staff(n, top, r, ox, oy, shine):   # 茶の柄、金の受け皿に青い玉（白い光・暗い影）
    a = blank(n); c = lambda k: n - 2 - k
    for k in range(top, n): setp(a, c(k) - 1, k, 'h'); setp(a, c(k), k, 'H')
    for y in range(n):
        for x in range(n):
            d = math.hypot(x - ox, y - oy)
            if d <= r: a[y][x] = 'w' if (x - ox, y - oy) in shine else ('O' if x - ox + y - oy >= 2 else 'o')
            elif d <= r + 1.2 and x <= ox and y >= oy: a[y][x] = 'g'   # 受け皿：玉の左下を抱える金の弧
    return a

ARMOR = [   # 戦士：胸当て（肩当てが盾の外へ出る）。鋼の明るい左・暗い右、金の襟と帯
    '....sss..gggg..SSS....', '.sssssssggggggSSSSSSS.', 'sssssssssggggSSSSSSSSS', 'sssssswssssssSSSSSSSSS',
    '.ssssswsssssSSSSSSSSS.', '...swsssssssSSSSSSS...', '...ssssssssSSSSSSSS...', '....sssssssSSSSSSS....',
    '....ssssssssSSSSSS....', '....gggggggggggggg....', '....sssssssSSSSSSS....', '.....ssssssSSSSSS.....',
    '......sssssSSSSS......', '.......ssssSSSS.......',
]
ARMOR_S = [
    '.s.ggg.S.', 'sssgggSSS', 'swssSSSSS', '.sssSSSS.', '.ggggggg.', '..ssSSS..', '...sSS...',
]

def put(g, art, ox, oy):
    rows = [''.join(r) for r in art] if isinstance(art[0], list) else art
    H, W = len(g), len(g[0])
    cells = {(ox + x, oy + y): ch for y, r in enumerate(rows) for x, ch in enumerate(r) if ch != '.'}
    for (x, y), ch in cells.items(): setp(g, x, y, ch)
    for (x, y) in cells:                                    # 絵のまわりに濃紺の縁
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            p = (x + dx, y + dy)
            if p not in cells and 0 <= p[1] < H and 0 <= p[0] < W: g[p[1]][p[0]] = 'K'

ICONS = [
    ('job_thief', BIG, knife(22, 9, 6, 2), 3, 5), ('job_warrior', BIG, ARMOR, 3, 9),
    ('job_mage', BIG, staff(22, 6, 3.2, 18, 3, ((-1, -1), (-1, -2), (-2, -1))), 3, 5),
    ('job_thief_s', SMALL, knife(11, 3, 3, 1), 2, 3), ('job_warrior_s', SMALL, ARMOR_S, 3, 4),
    ('job_mage_s', SMALL, staff(11, 3, 1.5, 8, 2, ((-1, -1),)), 2, 3),
]
out, rowsd = [], {}
for name, cfg, art, ox, oy in ICONS:
    g = shield(cfg); put(g, art, ox, oy); rows = [''.join(r) for r in g]; rowsd[name] = rows
    assert all(len(r) == cfg['W'] for r in rows) and len(rows) == cfg['H'], name
    used = sorted({c for r in rows for c in r if c != '.'})
    out.append(f"  {name}: {{ pal: {{ {', '.join(f'{c}: {PAL[c]!r}' for c in used)} }}, rows: [\n    " + ', '.join(repr(r) for r in rows) + "] },")
open(os.path.join(HERE, '職業の紋章.txt'), 'w', encoding='utf8').write('\n'.join(out) + '\n')
CW, CH = 32, 34
sheet = Image.new('RGBA', (3 * CW * 8, 2 * CH * 8), (136, 136, 136, 255))
for k, rows in enumerate(rowsd.values()):
    bx, by = (k % 3) * CW + 2, (k // 3) * CH + 2
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch == '.': continue
            c = PAL[ch]; col = tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) + (255,)
            for yy in range(8):
                for xx in range(8): sheet.putpixel(((bx + x) * 8 + xx, (by + y) * 8 + yy), col)
sheet.save(os.path.join(HERE, '職業の紋章_8倍.png'))
print('ok')
