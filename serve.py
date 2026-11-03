"""Serve Glass Brain at http://localhost:8787 with caching off, so edits show up on reload."""
import http.server, functools, os

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass

if __name__ == "__main__":
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
    handler = functools.partial(NoCache, directory=root)
    port = int(os.environ.get("PORT", 8787))
    print(f"Glass Brain → http://localhost:{port}")
    http.server.ThreadingHTTPServer(("", port), handler).serve_forever()
