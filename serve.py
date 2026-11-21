"""Local test server for the installer page (GitHub Pages already serves these types correctly).
From bejeweled3-nx-installer's serve.py (GPL-3.0); banjo-nx-installer adds /_test_list.

  python serve.py [port] [folder] [--test-files <folder>] [--test-packages <folder>]

--test-files also serves that folder at /_test/, with HTTP range requests, and its file list at /_test_list, for
test/browser.html: the browser test reads your game files from there without loading them whole. Only for testing
on your own computer: the server listens on 127.0.0.1 only.
--test-packages (renut-nx, 2026-11-01) serves a folder's files at /_pkg/ and their names at /_pkg_list: the title update
and DLC packages test/browser.html gives the worker.
--test-out <file> (rr6-nx-installer, 2026-11-10): POST /_test_write?offset=N writes the request's body at offset N of that
file (truncated at offset 0): test/browser.html saves the zip there as it streams, for test/check_zip.py."""
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
    test_packages = None
    test_out = None

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def test_path(self):
        for prefix, folder in (('/_test/', self.test_files), ('/_pkg/', self.test_packages)):
            if not folder or not self.path.startswith(prefix):
                continue
            relative = urllib.parse.unquote(self.path[len(prefix):].split('?')[0])
            full = os.path.realpath(os.path.join(folder, relative))
            if not full.startswith(os.path.realpath(folder) + os.sep) or not os.path.isfile(full):
                return ''
            return full
        return None

    def do_POST(self):
        path, _, query = self.path.partition('?')
        if not self.test_out or path != '/_test_write':
            return self.send_error(404)
        offset = int(urllib.parse.parse_qs(query).get('offset', ['0'])[0])
        length = int(self.headers.get('Content-Length', '0'))
        mode = 'wb' if offset == 0 else 'r+b'
        with open(self.test_out, mode) as f:
            f.seek(offset)
            left = length
            while left:
                piece = self.rfile.read(min(left, 1 << 20))
                if not piece:
                    break
                f.write(piece)
                left -= len(piece)
        self.send_response(204)
        self.end_headers()

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
        if self.test_packages and self.path.split('?')[0] == '/_pkg_list':
            names = sorted(n for n in os.listdir(self.test_packages) if os.path.isfile(os.path.join(self.test_packages, n)))
            body = json.dumps(names).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
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
    if '--test-out' in args:
        at = args.index('--test-out')
        Handler.test_out = args[at + 1]
        del args[at:at + 2]
    if '--test-packages' in args:
        at = args.index('--test-packages')
        Handler.test_packages = args[at + 1]
        del args[at:at + 2]
    port = int(args[0]) if args else 8193
    root = args[1] if len(args) > 1 else '.'
    handler = functools.partial(Handler, directory=root)
    # culdcept-nx-installer (2026-11-20): a deeper listen queue than socketserver's 5. The page's full test reads the
    # game files with many range requests at once (the packers, and the movie and audio jobs ahead of the zip) while it
    # writes the zip here: with 5, Windows refused a write's connection (net::ERR_CONNECTION_REFUSED) mid-run.
    http.server.ThreadingHTTPServer.request_queue_size = 128
    http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
