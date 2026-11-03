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
    print("Glass Brain → http://localhost:8787")
    http.server.ThreadingHTTPServer(("", 8787), handler).serve_forever()
