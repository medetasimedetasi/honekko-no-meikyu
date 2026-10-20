# 原作2の CardRogue.html からゲームロジック部分だけを切り出して js/logic2.js を作る（1の 動く見本_20261007/制作/build_logic.py と同じやり方）。
# ロジックの中身は1文字も変えない。描画（DOM）が始まる直前で切り、使う関数を globalThis.HK2 に出すだけ。
# 3D版は CardRogue を遊ぶときに HK を HK2 に差し替える（js/game3d.js の useRules）
import re, hashlib, pathlib

here = pathlib.Path(__file__).resolve().parents[1]
src = (here.parent / 'CardRogue.html').read_text(encoding='utf8')
js = max(re.findall(r'<script[^>]*>(.*?)</script>', src, re.S), key=len)

marker = 'var E=document.querySelector("#app")'
cut = js.index(marker)
logic = js[:cut]

# 名前は CardRogue.html（2026-10-14 版）の縮めた名前。原作が更新されたら、ここを見直す
exports = ('globalThis.HK2={cards:w,cardOf:x,damageOf:le,newRun:Qe,newRunWizard:Qe,newRunWarrior:or,newRunRogue:ar,'
           'play:Sr,enemyTurn:Fe,nextFloor:tr,discard:Nr,wait:Tr,autoMove:Je,movePriority:Yr,confirmPriority:Ir,'
           'firstInRange:ae,dirs:v,isFloor:C,enemyAt:M,dist:me,score:W,enemyInfo:ze,fusionOptions:Ee,'
           'warriorOptions:we,smallFusionPairs:Te,magicTargets:ce,fetchTargets:$e,isTreasureLike:ne,rogueMoveMax:Ye,'
           'LAST_FLOOR:60,BOSS_FLOOR:59};})();')

out = here / 'js' / 'logic2.js'
digest = hashlib.sha256(logic.encode('utf8')).hexdigest()
out.write_text('// 原作2の CardRogue.html のゲームロジックをそのまま切り出したもの（制作/build_logic2.py で生成）\n'
               f'// 元ロジック部分 sha256: {digest}\n' + logic + exports, encoding='utf8')
print('wrote', out, len(logic), digest)
