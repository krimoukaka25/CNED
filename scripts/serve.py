#!/usr/bin/env python3
"""Static dev server with caching disabled (avoids stale app.js / data modules)."""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


with Server(("0.0.0.0", PORT), NoCacheHandler) as httpd:
    print(f"Serving on http://localhost:{PORT} (no-cache)")
    httpd.serve_forever()
