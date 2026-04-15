from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        return


def main():
    port = int(os.environ.get("PORT", "8787"))
    root = Path(__file__).resolve().parents[1]
    os.chdir(root)
    server = ThreadingHTTPServer(("127.0.0.1", port), QuietHandler)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
