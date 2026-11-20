"""Serve one reusable Point-SAM on http://127.0.0.1:3211."""

import json
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from urllib.parse import urlsplit

from trial_model import InvalidInput, PointSAM


class Handler(BaseHTTPRequestHandler):
    def local_origin(self):
        origin = self.headers.get("Origin", "")
        try:
            parsed = urlsplit(origin)
            return (
                origin
                if parsed.scheme in ("http", "https")
                and parsed.hostname in ("localhost", "127.0.0.1", "::1")
                else None
            )
        except ValueError:
            return None

    def reply(self, status, payload):
        body = json.dumps(payload, allow_nan=False).encode()
        self.send_response(status)
        if self.local_origin():
            self.send_header("Access-Control-Allow-Origin", self.local_origin())
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.reply(200, {})

    def do_GET(self):
        if self.path != "/status":
            return self.reply(404, {"error": "unknown endpoint"})
        self.reply(
            200,
            dict(
                ready=True,
                status="ready",
                model="Point-SAM",
                device=self.server.model.device,
            ),
        )

    def do_POST(self):
        if self.path != "/segment":
            return self.reply(404, {"error": "unknown endpoint"})
        if self.headers.get("Origin") and not self.local_origin():
            return self.reply(403, {"error": "local browser origins only"})
        if self.headers.get_content_type() != "application/json":
            return self.reply(415, {"error": "expected application/json"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 16 * 1024 * 1024:
                return self.reply(413, {"error": "expected a body of 1 byte to 16 MiB"})
            request = json.loads(self.rfile.read(length))
        except (ValueError, RecursionError):
            return self.reply(400, {"error": "invalid JSON body or Content-Length"})
        try:
            with self.server.inference_lock:
                result = self.server.model.segment(request)
        except InvalidInput as error:
            return self.reply(422, {"error": str(error)})
        except Exception as error:
            traceback.print_exc()
            return self.reply(500, {"error": f"Point-SAM inference failed: {error}"})
        self.reply(200, result)


if __name__ == "__main__":
    with ThreadingHTTPServer(("127.0.0.1", 3211), Handler) as server:
        print("Loading Point-SAM checkpoint...", flush=True)
        server.model = PointSAM()
        server.inference_lock = Lock()
        print(
            f"Point-SAM ready on http://127.0.0.1:3211 ({server.model.device})",
            flush=True,
        )
        server.serve_forever()
