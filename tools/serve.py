"""Serve the site locally and open it in a browser.

    python tools/serve.py            # serve on 8777 and open a browser
    python tools/serve.py --port 9000 --no-open

The site is plain static files, so this is only a convenience - any static
server works, and GitHub Pages needs no equivalent. It does set no-cache
headers, because the whole point of running it locally is to see an edit
without fighting the browser cache.
"""

import argparse
import functools
import http.server
import os
import socketserver
import threading
import webbrowser

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # one line per request, without the date noise
        status = args[1] if len(args) > 1 else ""
        if status and not status.startswith("2"):
            print(f"  {status} {args[0]}")


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8777)
    ap.add_argument("--no-open", action="store_true", help="do not launch a browser")
    args = ap.parse_args(argv)

    handler = functools.partial(Handler, directory=REPO)
    with Server(("127.0.0.1", args.port), handler) as httpd:
        url = f"http://127.0.0.1:{args.port}/"
        print(f"serving {REPO}\n  -> {url}\nCtrl+C to stop")
        if not args.no_open:
            threading.Timer(0.5, webbrowser.open, [url]).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
