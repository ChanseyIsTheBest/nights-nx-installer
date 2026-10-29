"""Local test server for the installer page (GitHub Pages already serves these types correctly).
From bejeweled3-nx-installer's serve.py (GPL-3.0); banjo-nx-installer adds /_test_list.

  python serve.py [port] [folder] [--test-files <folder>]

--test-files also serves that folder at /_test/, with HTTP range requests, and its file list at /_test_list, for
test/browser.html: the browser test reads your game files from there without loading them whole. Only for testing
on your own computer: the server listens on 127.0.0.1 only."""
import functools
import json
import http.server
import os
import re
import sys
import urllib.parse

TYPES = {'.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json'}


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **TYPES}
    test_files = None

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def test_path(self):
        if not self.test_files or not self.path.startswith('/_test/'):
            return None
        relative = urllib.parse.unquote(self.path[len('/_test/'):].split('?')[0])
        full = os.path.realpath(os.path.join(self.test_files, relative))
        if not full.startswith(os.path.realpath(self.test_files) + os.sep) or not os.path.isfile(full):
            return ''
        return full

    def do_HEAD(self):
        full = self.test_path()
        if full is None:
            return super().do_HEAD()
        if not full:
            return self.send_error(404)
        self.send_response(200)
        self.send_header('Content-Length', str(os.path.getsize(full)))
        self.send_header('Accept-Ranges', 'bytes')
        self.end_headers()

    def do_GET(self):
        if self.test_files and self.path.split('?')[0] == '/_test_list':
            # banjo-nx-installer: the test folder's files (path, size) for test/browser.html
            files = []
            for folder, _, names in os.walk(self.test_files):
                for name in names:
                    full = os.path.join(folder, name)
                    files.append({'path': os.path.relpath(full, self.test_files).replace(os.sep, '/'),
                                  'size': os.path.getsize(full)})
            body = json.dumps(sorted(files, key=lambda f: f['path'])).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        full = self.test_path()
        if full is None:
            return super().do_GET()
        if not full:
            return self.send_error(404)
        size = os.path.getsize(full)
        start, end = 0, size - 1
        match = re.fullmatch(r'bytes=(\d+)-(\d*)', self.headers.get('Range', ''))
        if match:
            start = int(match.group(1))
            end = min(int(match.group(2)) if match.group(2) else size - 1, size - 1)
            if start > end:
                return self.send_error(416)
            self.send_response(206)
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        else:
            self.send_response(200)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Content-Length', str(end - start + 1))
        self.send_header('Accept-Ranges', 'bytes')
        self.end_headers()
        with open(full, 'rb') as f:
            f.seek(start)
            left = end - start + 1
            while left:
                piece = f.read(min(left, 1 << 20))
                if not piece:
                    break
                self.wfile.write(piece)
                left -= len(piece)


if __name__ == '__main__':
    args = sys.argv[1:]
    if '--test-files' in args:
        at = args.index('--test-files')
        Handler.test_files = args[at + 1]
        del args[at:at + 2]
    port = int(args[0]) if args else 8193
    root = args[1] if len(args) > 1 else '.'
    handler = functools.partial(Handler, directory=root)
    http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
