# オンラインランキングの試し（Code.gs と同じ受け答えを手元でする。記録はメモリの中だけ）
# 使い方：python 試しのサーバー.py 8742 → js/ranking_config.js の HK_RANKING_URL を 'http://127.0.0.1:8742/exec' にして試す
import json, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

rows = []


def ordered():
    return sorted(rows, key=lambda r: (-r['score'], r['turns'], r['ms']))


class H(BaseHTTPRequestHandler):
    def send(self, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        n = int(parse_qs(urlparse(self.path).query).get('n', ['50'])[0])
        all_ = ordered()
        self.send({'ok': True, 'total': len(all_), 'list': all_[:min(100, n)]})

    def do_POST(self):
        d = json.loads(self.rfile.read(int(self.headers['Content-Length'])).decode())
        if not any(r['id'] == d['id'] for r in rows):
            rows.append({k: d.get(k) for k in ('id', 'name', 'score', 'status', 'floor', 'turns', 'ms', 'icon')} | {'date': int(time.time() * 1000)})
        all_ = ordered()
        self.send({'ok': True, 'rank': next(i for i, r in enumerate(all_) if r['id'] == d['id']) + 1, 'total': len(all_)})

    def log_message(self, *a): pass


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8742
# 試しの記録を2件
rows += [{'id': 'seed-aaaaaaaa', 'name': 'しばむら', 'score': 2210, 'status': 'CLEARED', 'floor': 30, 'turns': 388, 'ms': 1520000, 'icon': '', 'date': 0},
         {'id': 'seed-bbbbbbbb', 'name': 'テスター', 'score': 95, 'status': 'RETURNED', 'floor': 2, 'turns': 21, 'ms': 90000, 'icon': '', 'date': 0}]
ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
