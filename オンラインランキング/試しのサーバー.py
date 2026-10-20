# オンラインランキングの試し（Code.gs と同じ受け答えを手元でする。記録はメモリの中だけ）
# 使い方：python 試しのサーバー.py 8742 → js/ranking_config.js の HK_RANKING_URL を 'http://127.0.0.1:8742/exec' にして試す
# 2026-10-20：2（game: 'cardrogue'）の表を分けた。3つめに old を付けると、game を分けない前の Code.gs のふりをする（2の表はまだ、の確かめ用）
import json, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

rows = []
OLD = len(sys.argv) > 2 and sys.argv[2] == 'old'
game_ = lambda g: 'classic' if OLD or g != 'cardrogue' else 'cardrogue'


def ordered(game):
    return sorted([r for r in rows if r.get('game', 'classic') == game], key=lambda r: (-r['score'], r['turns'], r['ms']))


class H(BaseHTTPRequestHandler):
    def send(self, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        q = parse_qs(urlparse(self.path).query)
        n, game = int(q.get('n', ['50'])[0]), game_(q.get('game', [''])[0])
        all_ = ordered(game)
        self.send({'ok': True, 'total': len(all_), 'list': all_[:min(100, n)], **({} if OLD else {'game': game})})

    def do_POST(self):
        d = json.loads(self.rfile.read(int(self.headers['Content-Length'])).decode())
        game = game_(d.get('game'))
        if not any(r['id'] == d['id'] for r in rows):
            rows.append({k: d.get(k) for k in ('id', 'name', 'score', 'status', 'floor', 'turns', 'ms', 'icon', 'job')} | {'date': int(time.time() * 1000), 'game': game})
        all_ = ordered(game)
        self.send({'ok': True, 'rank': next(i for i, r in enumerate(all_) if r['id'] == d['id']) + 1, 'total': len(all_)})

    def log_message(self, *a): pass


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8742
# 試しの記録を2件
rows += [{'id': 'seed-aaaaaaaa', 'name': 'しばむら', 'score': 2210, 'status': 'CLEARED', 'floor': 30, 'turns': 388, 'ms': 1520000, 'icon': '', 'date': 0},
         {'id': 'seed-bbbbbbbb', 'name': 'テスター', 'score': 95, 'status': 'RETURNED', 'floor': 2, 'turns': 21, 'ms': 90000, 'icon': '', 'date': 0},
         {'id': 'seed-cccccccc', 'name': 'ろくじゅう', 'score': 31805, 'status': 'CLEARED', 'floor': 60, 'turns': 2100, 'ms': 5400000, 'icon': '', 'job': '戦士', 'date': 0, 'game': 'cardrogue'}]
ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
