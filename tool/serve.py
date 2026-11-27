#!/usr/bin/env python3
"""The site as GitHub Pages serves it, on this machine: files as they are and
404.html (with status 404) for every other address, which is how
/in/<callsign> reaches in/shell.js. 127.0.0.1 is a secure context, so the
service worker and the install offer work as on xprs.dev.

    python3 tool/serve.py [port]        # http://127.0.0.1:8800/in/
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'max-age=600')   # as GitHub Pages
        super().end_headers()

    def send_error(self, code, message=None, explain=None):
        if code != 404:
            return super().send_error(code, message, explain)
        body = open(os.path.join(ROOT, '404.html'), 'rb').read()
        self.send_response(404)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8800
    ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
