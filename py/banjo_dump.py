"""banjo-nx-installer: reNut's tools/dump_shaders.py (copied unchanged as dump_shaders.py) run in Pyodide on one game
file at a time, the page holding the file. Two things are swapped in, nothing else:

  - Rare's LZX partitions are decoded by lib/lzx.js (a line-for-line port of the tool's LZXDecoder), called through
    the JavaScript function banjoLzxPartition(data, window_bits, frames) the page puts on globalThis, with the
    partition's compressed bytes only: the Python decoder is far too slow for 1.9 GB of compressed bundles;
  - the tool names shaders by xxhash's XXH3-64 (the xxhash module is not in Pyodide): here a stand-in only used to tell
    containers apart; the page's translator names each shader by its XXH3 itself, as the native build does.

dump_bytes(path) -> list of (kind, blob) for the containers in that file (process_file's results).
"""
import hashlib
import sys
import types

xxhash = types.ModuleType('xxhash')
xxhash.xxh3_64_hexdigest = lambda blob: hashlib.sha1(bytes(blob)).hexdigest()[:16]
sys.modules['xxhash'] = xxhash
# The tool imports ProcessPoolExecutor for its main() (not used here); Pyodide has no _multiprocessing.
_process = types.ModuleType('concurrent.futures.process')
_process.ProcessPoolExecutor = None
sys.modules['concurrent.futures.process'] = _process

import dump_shaders as ds  # noqa: E402
import js  # noqa: E402
from pyodide.ffi import to_js  # noqa: E402


def _part(self, i):
    buf = self.cache.get(i)
    if buf is None:
        _, _, frames = self.parts[i]
        if frames[0][2] < 0:
            n, o, _ = frames[0]
            buf = bytes(self.data[o:o + n])
        else:
            # only this partition's compressed bytes go to JavaScript (a bundle is up to 819 MB)
            lo = min(o for _, o, _ in frames)
            hi = max(o + c for _, o, c in frames)
            flat = [v for n, o, c in frames for v in (n, o - lo, c)]
            chunk = to_js(memoryview(self.data)[lo:hi])
            buf = bytes(js.banjoLzxPartition(chunk, self.window_bits, to_js(flat)).to_py())
        self.cache[i] = buf
    return buf


ds.RareLZXSource._part = _part


def dump_file(path):
    """process_file of the tool on one file: [(kind, blob)], and its problems."""
    _, results, problems = ds.process_file(path)
    return [(r['kind'], bytes(r['blob'])) for r in results], problems
