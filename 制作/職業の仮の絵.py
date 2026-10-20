# 職業えらびの見本（2026-10-14）：主人公の職業の立ち絵（戦士・魔法使い）の「試し組み立て」の出力を、ゲームで仮に使えるように js/jobs_trial.js へ写す。
# 試しの出力：作業道具/主人公の職業/out/enemies_hd_試し.js（主人公の絵のセッションが作る。globalThis.SPR_HD={mage_hd, warrior_hd}）
# js/enemies_hd.js（本番）にまだない絵だけを足す（本番に書き出されたら、そちらが使われる）。本番に書き出されたら、このファイルと 3D版.html の読み込みを消す
import json, re
SRC = 'D:/ほねっこの迷宮/作業道具/主人公の職業/out/enemies_hd_試し.js'
DST = 'D:/ほねっこの迷宮/3D版_20261007/js/jobs_trial.js'
s = open(SRC, encoding='utf8').read()
body = s[s.index('globalThis.SPR_HD=') + len('globalThis.SPR_HD='):].rstrip().rstrip(';')
data = json.loads(body)
open(DST, 'w', encoding='utf8').write(
    '// 職業えらびの見本用の仮の絵（戦士・魔法使い）。制作/職業の仮の絵.py が 作業道具/主人公の職業/out/enemies_hd_試し.js から写す。手で直さない\n'
    '// js/enemies_hd.js にまだない絵だけを足す（本番の絵が書き出されたら、そちらが使われる）\n'
    '(() => { const J = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n'
    '  const H = globalThis.SPR_HD || (globalThis.SPR_HD = {}); for (const k in J) if (!H[k]) H[k] = J[k]; })();\n')
print(list(data), round(len(open(DST, encoding='utf8').read()) / 1024), 'KB')
