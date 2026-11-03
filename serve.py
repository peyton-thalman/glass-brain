"""Serve Glass Brain at http://localhost:8787 with caching off, so edits show up on reload."""
import http.server, functools, os

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass

    def do_GET(self):
        # The X-ray moved from household.html to the front door; keep old links working (the #hash rides along).
        if self.path.split("?")[0] in ("/household.html", "/household"):
            self.send_response(301)
            self.send_header("Location", "/")
            self.end_headers()
            return
        super().do_GET()

if __name__ == "__main__":
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
    handler = functools.partial(NoCache, directory=root)
    print("Glass Brain → http://localhost:8787")
    http.server.ThreadingHTTPServer(("", 8787), handler).serve_forever()
