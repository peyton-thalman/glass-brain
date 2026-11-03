"""Serve Glass Brain at http://localhost:8787 with caching off, so edits show up on reload.

POST /api/claude relays one Messages API call for the Meeting prep page (web/prep.html). The API key stays here, read
from ANTHROPIC_API_KEY or .env.local, and never reaches the page. Only the models below are allowed, the size of a
request is capped, and nothing is logged or written to disk. The relay needs the anthropic package:
    uv run --with anthropic serve.py      (or pip install anthropic)
"""
import http.server, functools, json, os

ROOT = os.path.dirname(os.path.abspath(__file__))
MODELS = {"claude-opus-5-5", "claude-sonnet-5-5"}
MAX_BODY = 400_000  # bytes: the notes, the household and the engine's answers, with room to spare
EFFORTS = {"low", "medium", "high"}


def api_key():
    if os.environ.get("ANTHROPIC_API_KEY"):
        return os.environ["ANTHROPIC_API_KEY"]
    try:
        with open(os.path.join(ROOT, ".env.local")) as f:
            for line in f:
                k, _, v = line.strip().partition("=")
                if k == "ANTHROPIC_API_KEY" and v:
                    return v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return None


_client = None


def client():
    global _client
    if _client is None:
        import anthropic  # only the relay needs it; the static site runs without it
        _client = anthropic.Anthropic(api_key=api_key(), max_retries=3, timeout=300.0)
    return _client


def relay(body):
    """One Messages API call. Returns (status, json-able dict)."""
    if not api_key():
        return 503, {"error": "no_key", "message": "No API key yet. Add ANTHROPIC_API_KEY=... to .env.local and restart the server."}
    try:
        import anthropic
    except ImportError:
        return 503, {"error": "no_sdk", "message": "The relay needs the anthropic package: run the server with  uv run --with anthropic serve.py"}
    model = body.get("model")
    if model not in MODELS:
        return 400, {"error": "model", "message": f"Model must be one of {sorted(MODELS)}."}
    try:
        r = client().beta.messages.create(
            model=model,
            max_tokens=16000,
            system=body["system"],
            messages=body["messages"],
            tools=body["tools"],
            output_config={"effort": body.get("effort") if body.get("effort") in EFFORTS else "medium"},
            cache_control={"type": "ephemeral"},  # each turn resends the conversation; cache it
            # On a policy decline the API retries on Anthropic's recommended fallback model instead of refusing.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        return 200, r.to_dict()
    except anthropic.AuthenticationError:
        return 401, {"error": "auth", "message": "The API key in .env.local was rejected."}
    except anthropic.RateLimitError:
        return 429, {"error": "rate_limit", "message": "Claude's API is rate-limiting this key. Wait a minute and try again."}
    except anthropic.BadRequestError as e:
        return 400, {"error": "bad_request", "message": e.message}
    except anthropic.APIStatusError as e:
        return 502, {"error": "api", "message": f"Claude's API returned {e.status_code}. Try again in a moment."}
    except anthropic.APIConnectionError:
        return 502, {"error": "network", "message": "Couldn't reach Claude's API. Check the internet connection."}


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass

    def do_POST(self):
        if self.path != "/api/claude":
            return self.send_error(404)
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            status, out = 413, {"error": "size", "message": "That request is too large."}
        else:
            try:
                body = json.loads(self.rfile.read(n))
                status, out = relay(body)
            except (ValueError, KeyError, TypeError):
                status, out = 400, {"error": "shape", "message": "The page sent a malformed request."}
        data = json.dumps(out).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    handler = functools.partial(NoCache, directory=os.path.join(ROOT, "web"))
    port = int(os.environ.get("PORT", 8787))
    print(f"Glass Brain → http://localhost:{port}")
    http.server.ThreadingHTTPServer(("", port), handler).serve_forever()
