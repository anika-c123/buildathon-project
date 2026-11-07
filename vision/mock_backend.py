"""Local-only test receiver for FlowDesk vision camera_state events.
No Claude, GitHub, FastAPI, or additional dependencies needed.
"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/health':
            self.send_error(404)
            return
        body = b'{"ok": true}'
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != '/event':
            self.send_error(404)
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 65536:
                raise ValueError('Invalid event length')
            payload = json.loads(self.rfile.read(size))
            if (payload.get('v') != 1 or payload.get('source') != 'vision'
                    or payload.get('type') != 'camera_state'):
                raise ValueError('Invalid PLocked message envelope')
            if not isinstance(payload.get('timestamp'), int):
                raise ValueError('Missing millisecond timestamp')
            data = payload.get('data')
            if not isinstance(data, dict) or data.get('state') not in ('present', 'away', 'phone_in_hand'):
                raise ValueError('Invalid camera state')
            if not isinstance(data.get('confidence'), (int, float)) or not 0 <= data['confidence'] <= 1:
                raise ValueError('Invalid confidence')
            print('RECEIVED /event:', json.dumps(payload), flush=True)
            body = b'{"ok": true}'
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ValueError, json.JSONDecodeError, AttributeError) as error:
            self.send_error(400, str(error))

if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 8000), Handler)
    print('TEST backend on http://127.0.0.1:8000 — Ctrl+C to stop', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
