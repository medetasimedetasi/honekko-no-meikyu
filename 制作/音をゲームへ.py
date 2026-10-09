# 音楽ジャンルのセッションが決めた曲・効果音（音楽案_20261006/採用）を、ゲームで読める JS（audio/*.js）に書き出す。
# ファイルを直接開いた（file://）ときは fetch で音を読めないので、base64 にして <script> で読み込む（js/music.js が必要なときに読む）。
# 採用の曲が増えたり替わったりしたら、下の表を直して動かし直す。
import base64, json, os
SRC = 'D:/ほねっこの迷宮/音楽案_20261006/採用'
OUT = 'D:/ほねっこの迷宮/3D版_20261007/audio'
os.makedirs(OUT, exist_ok=True)
TRACKS = {   # ゲームでの名前: 採用のファイル（.json があればループ）
    'b1': 'A_floor1_honekko_sneak_loop_頭へ戻る',   # B1〜10F：もとの A の頭〜39.8秒（b120、毎小節の重い「ドン」が次に鳴る直前。41秒からリコーダー）を、曲の頭へ戻してくり返す（2026-10-09 ユーザー指定）
    'b11': 'E2_floor11_creep_loop',               # B11〜20F
    'b21': 'F1_floor21_pavane_loop',              # B21〜24F
    'b25': 'G7_canon_viols_loop_案1_曲頭に戻る',   # B25〜30F（つなぎ方は案1で仮。案2_中盤に戻る に替えるならここ）
    # 'danger'（危険時の曲・仮/pinch_loop）は 2026-10-09 にやめた（ユーザー：ピンチ曲は流さない・削除）
    'return': 'J5_return_relief',                 # 帰還のジングル
    'gameover': 'GO3_limp_recorder_lute',         # ゲームオーバーのジングル
    'stairs': 'ST3_stairs_echo',                  # 階段の効果音
    'title': '仮/title_bagpipe_loop',             # タイトル（バグパイプ。仮＝BP2、ユーザーが選んだら同じ名前で中身が替わる）
    'ending': '仮/ending',                        # エンディング（仮＝EN2、110秒、ループしない）
    'tetteree': '仮/score_tetteree',              # 最終スコアの「テッテレー」
}
for key, name in TRACKS.items():
    data = base64.b64encode(open(f'{SRC}/{name}.ogg', 'rb').read()).decode()
    meta = {'src': name}
    if os.path.exists(f'{SRC}/{name}.json'):
        j = json.load(open(f'{SRC}/{name}.json', encoding='utf8'))
        meta.update(loopStart=j['loop_start_sec'], loopEnd=j['loop_end_sec'])
    open(f'{OUT}/{key}.js', 'w', encoding='utf8').write(
        f'// {name}.ogg（音楽案_20261006/採用）。制作/音をゲームへ.py が書き出す。手で直さない\n'
        f'(globalThis.HK_AUDIO ||= {{}})[{json.dumps(key)}] = {json.dumps({**meta, "data": data}, ensure_ascii=False)};\n')
    print(key, name, os.path.getsize(f'{OUT}/{key}.js') // 1024, 'KB', meta.get('loopStart'), meta.get('loopEnd'))

# 効果音（仮/効果音/*.ogg、名前は game3d.js の sfx に合わせてある）は1つにまとめて audio/se.js へ。起動時に読む
SE_DIR = f'{SRC}/仮/効果音'
se = {}
for f in sorted(os.listdir(SE_DIR)):
    if f.endswith('.ogg'): se[f[:-4]] = base64.b64encode(open(f'{SE_DIR}/{f}', 'rb').read()).decode()
loops = {j['file'][:-4] for j in json.load(open(f'{SE_DIR}/効果音.json', encoding='utf8')) if j.get('loop')}
head = '// 効果音（音楽案_20261006/採用/仮/効果音）。制作/音をゲームへ.py が書き出す。手で直さない'
body = json.dumps({k: {'loop': k in loops, 'data': v} for k, v in se.items()})
open(f'{OUT}/se.js', 'w', encoding='utf8').write(head + chr(10) + 'globalThis.HK_SE = ' + body + ';' + chr(10))
print('se', len(se), os.path.getsize(f'{OUT}/se.js') // 1024, 'KB', sorted(loops))
