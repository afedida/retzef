"""Fallback static server with the MIME types Retzef needs. Used only if PowerShell cannot start."""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 43123
ROOT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")

EXTRA = {
    ".wasm": "application/wasm",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".json": "application/json",
    ".onnx": "application/octet-stream",
    ".ort": "application/octet-stream",
    ".bin": "application/octet-stream",
    ".data": "application/octet-stream",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
    ".svg": "image/svg+xml",
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        if ext in EXTRA:
            return EXTRA[ext]
        return super().guess_type(path)


def main():
    print(f"Retzef is running at http://localhost:{PORT}/")
    print("Close this window to stop.")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
