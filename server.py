from __future__ import annotations

import json
import mimetypes
import os
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
ENV_FILE = ROOT / ".env"

DEFAULTS = {
    "APP_PASSCODE": "0000",
    "HACKCLUB_SEARCH_API_KEY": "sk-hcs-v1-ab39c268450a40daaeaf0b01415e3b5a18ae6bd355f14619bc5518f66b49bf2f",
    "FIREBASE_API_KEY": "AIzaSyDrBKFVbRjCNktCmjrv-bI5OSSSj41T4iI",
    "FIREBASE_AUTH_DOMAIN": "navaratne-books.firebaseapp.com",
    "FIREBASE_DATABASE_URL": "https://navaratne-books-default-rtdb.firebaseio.com",
    "FIREBASE_PROJECT_ID": "navaratne-books",
    "FIREBASE_STORAGE_BUCKET": "navaratne-books.firebasestorage.app",
    "FIREBASE_MESSAGING_SENDER_ID": "820433869013",
    "FIREBASE_APP_ID": "1:820433869013:web:71d1d2951b7384b4b4aa5c",
}


def load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()

        if value and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]

        if key and key not in os.environ:
            os.environ[key] = value


def read_config() -> dict[str, str]:
    load_env_file(ENV_FILE)
    return {name: os.environ.get(name, default) for name, default in DEFAULTS.items()}


class NavaratneHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path

        if path == "/favicon.ico":
            self.send_response(HTTPStatus.NO_CONTENT)
            self.end_headers()
            return

        if path == "/config.js":
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            config = read_config()
            payload = json.dumps(
                {
                    "passcode": config["APP_PASSCODE"],
                    "hackclubSearchApiKey": config["HACKCLUB_SEARCH_API_KEY"],
                    "firebase": {
                        "apiKey": config["FIREBASE_API_KEY"],
                        "authDomain": config["FIREBASE_AUTH_DOMAIN"],
                        "databaseURL": config["FIREBASE_DATABASE_URL"],
                        "projectId": config["FIREBASE_PROJECT_ID"],
                        "storageBucket": config["FIREBASE_STORAGE_BUCKET"],
                        "messagingSenderId": config["FIREBASE_MESSAGING_SENDER_ID"],
                        "appId": config["FIREBASE_APP_ID"],
                    },
                },
                separators=(",", ":"),
            )
            self.wfile.write(f"window.APP_CONFIG = {payload};".encode("utf-8"))
            return

        if path == "/":
            self.path = "/index.html"

        return super().do_GET()

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def guess_type(self, path: str) -> str:
        mime_type, _ = mimetypes.guess_type(path)
        return mime_type or "application/octet-stream"


def main() -> None:
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), NavaratneHandler)
    print(f"Serving on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Shutting down...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()