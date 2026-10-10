# 全体公開版（2026-10-10〜）：身内版（この 3D版_20261007、リポジトリ honekko-no-meikyu）の中身を、全体公開版のフォルダ（別のリポジトリ）へ写す。
# 中身は同じで、ちがうのはランキングだけ（js/ranking_config.js：送り先＝別のスプレッドシート、ブラウザの中の記録の置き場所、版の名前）。
# 全体公開版の js/ranking_config.js は全体公開版のフォルダの中で持ち、ここからは上書きしない。
# 制作用のもの（オンラインランキング/・制作/・はじめに読む.md）は写さない。
# 使い方：python 制作/全体公開へ.py → 全体公開版のフォルダで git add -A・commit・push
import os, shutil, subprocess
SRC = 'D:/ほねっこの迷宮/3D版_20261007'
DST = 'D:/ほねっこの迷宮/全体公開版'
KEEP = {'js/ranking_config.js'}                                  # 全体公開版のものを使う
SKIP = ('オンラインランキング/', '制作/', 'はじめに読む.md')       # 制作用
CONFIG = """// 全体公開版のランキングの設定（身内版の js/ranking_config.js とは別。3D版_20261007/制作/全体公開へ.py は、このファイルを上書きしない）。
// 送り先：全体公開版用の Google Apps Script のウェブアプリの URL（…/exec）。空のままなら、オンラインには送らない（このブラウザの記録だけ）。
globalThis.HK_RANKING_URL = '';
// このブラウザの中の記録の置き場所：身内版（honekko.ranking.v1）と同じ github.io に置くので、分ける
globalThis.HK_RANKING_KEY = 'honekko.public.ranking.v1';
globalThis.HK_RANKING_VERSION = 'public-20261010';
"""
files = subprocess.run(['git', 'ls-files'], cwd=SRC, capture_output=True, text=True, encoding='utf8', check=True).stdout.split('\n')
files = [f for f in files if f and not f.startswith(SKIP) and f not in KEEP]
os.makedirs(DST, exist_ok=True)
# 身内版で消えたファイルは、全体公開版からも消す（.git と KEEP は残す）
want = set(files) | KEEP
for root, dirs, names in os.walk(DST):
    dirs[:] = [d for d in dirs if d != '.git']
    for n in names:
        rel = os.path.relpath(os.path.join(root, n), DST).replace('\\', '/')
        if rel not in want: os.remove(os.path.join(root, n)); print('消した', rel)
changed = 0
for f in files:
    s, d = os.path.join(SRC, f), os.path.join(DST, f)
    os.makedirs(os.path.dirname(d), exist_ok=True)
    if not os.path.exists(d) or open(s, 'rb').read() != open(d, 'rb').read():
        shutil.copy2(s, d); changed += 1
cfg = os.path.join(DST, 'js/ranking_config.js')
if not os.path.exists(cfg): open(cfg, 'w', encoding='utf8').write(CONFIG); print('全体公開版の ranking_config.js を作った')
print('写した', changed, '/', len(files), '件 →', DST)
