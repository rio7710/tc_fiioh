import http.server
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
ROOT = APP_DIR.parent
PORT = int(os.environ.get("PORT", "3000"))
API_URL = os.environ.get("API_URL", "http://api:10000")

SENSITIVE_HEADERS = {
    "authorization",
    "proxy-authorization",
    "host",
    "transfer-encoding",
    "x-forwarded-for",
    "x-forwarded-proto",
    "x-forwarded-host",
    "x-forwarded-port",
    "x-real-ip",
}


class WebGatewayHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        if self.path.split("?", 1)[0].endswith(".html"):
            self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Robots-Tag", "noindex, nofollow, noarchive")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def send_gateway_error(self, status_code: int = 502) -> None:
        body = json.dumps({"ok": False, "error": "Bad Gateway"}).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def proxy_to_api(self):
        target_url = f"{API_URL}{self.path}"
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else None

        req_headers = {}
        for key, val in self.headers.items():
            if key.lower() not in SENSITIVE_HEADERS:
                req_headers[key] = val

        try:
            req = urllib.request.Request(
                target_url,
                data=body,
                headers=req_headers,
                method=self.command,
            )
            timeout = 660 if self.path == "/api/script/generate" else 120
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                self.send_response(resp.status)
                for key, val in resp.headers.items():
                    if key.lower() not in ("transfer-encoding", "content-length"):
                        self.send_header(key, val)
                resp_body = resp.read()
                self.send_header("Content-Length", str(len(resp_body)))
                self.end_headers()
                self.wfile.write(resp_body)
        except urllib.error.HTTPError as exc:
            self.send_response(exc.code)
            for key, val in exc.headers.items():
                if key.lower() not in ("transfer-encoding", "content-length"):
                    self.send_header(key, val)
            resp_body = exc.read()
            self.send_header("Content-Length", str(len(resp_body)))
            self.end_headers()
            self.wfile.write(resp_body)
        except (BrokenPipeError, ConnectionResetError):
            # Browsers routinely cancel superseded MP4 Range requests while
            # switching calendar preview tabs. The upstream response is valid;
            # there is no gateway failure to report to a closed client socket.
            return
        except Exception as exc:
            print(f"[web_gateway] Upstream request failed: {type(exc).__name__}", file=sys.stderr)
            try:
                self.send_gateway_error(502)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def do_GET(self):
        if self.path == "/":
            self.send_response(302)
            self.send_header("Location", "/01_app/P1_title_design_preview.html")
            self.end_headers()
            return
        if self.path.startswith("/api/") or self.path.startswith("/render") or self.path.startswith("/04_exports/"):
            self.proxy_to_api()
            return
        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/") or self.path == "/render":
            self.proxy_to_api()
            return
        self.send_error(405, "Method not allowed")


if __name__ == "__main__":
    os.chdir(ROOT)
    server = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), WebGatewayHandler)
    print(f"Web gateway running on port {PORT}, proxying API to {API_URL}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
