// banjo-nx-installer: banjo-nx's own Python shader tools (py/: copies of banjo-nx's tools/deko3d_glsl.py,
// deko3d_glsl_opt.py with its shader lists, early_alpha.py, renut_early_alpha.py and reNut's dump_shaders.py), run
// unchanged in Pyodide (vendor/pyodide, 0.27.7 core, with its numpy for early_alpha.py's self-check) so the page's
// GLSL is the native chain's.
import { decodePartition } from './lzx.js';

export const PY_FILES = ['deko3d_glsl.py', 'deko3d_glsl_opt.py', 'gpr32_shaders.txt', 'lightbranch_shaders.txt',
                         'nullps_shaders.txt', 'skinonce_shaders.txt', 'early_alpha.py', 'renut_early_alpha.py',
                         'dump_shaders.py', 'banjo_dump.py'];

// loadPyodide: from vendor/pyodide/pyodide.mjs; readFile(name) -> Promise<string> (the page: fetch; Node: fs).
export async function loadPython(loadPyodide, indexURL, readFile) {
  // py/banjo_dump.py decodes Rare's LZX partitions with lib/lzx.js through this.
  globalThis.banjoLzxPartition = (data, windowBits, frames) => decodePartition(data, windowBits, frames);
  const pyodide = await loadPyodide({ indexURL });
  await pyodide.loadPackage('numpy', { messageCallback: () => {} });
  pyodide.FS.mkdirTree('/py');
  for (const name of PY_FILES) pyodide.FS.writeFile('/py/' + name, await readFile(name));
  pyodide.runPython(`
import sys, os, io, shutil, contextlib
sys.path.insert(0, '/py')
import deko3d_glsl, deko3d_glsl_opt, renut_early_alpha, banjo_dump
def _convert(text, stage):
    out, _ = deko3d_glsl.convert(text, stage, deko3d_glsl.DEFAULT_UBO_MAP, 'handle')
    return out
def _optimise(text, stage, name):
    return deko3d_glsl_opt.optimise(text, deko3d_glsl_opt.DEFAULT, stage, name)
def _early_alpha(items):
    # renut_early_alpha.py on a folder of the pixel shaders' HLSL, as the native build runs it (in place)
    d = '/ea/batch'
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    for n, t in items:
        with open(f'{d}/{n}.hlsl', 'w', encoding='utf-8', newline='') as f:
            f.write(t)
    sys.argv = ['renut_early_alpha.py', d, '--jobs', '1']
    with contextlib.redirect_stdout(io.StringIO()):
        renut_early_alpha.main()
    out = []
    for n, _ in items:
        with open(f'{d}/{n}.hlsl', encoding='utf-8', newline='') as f:
            out.append((n, f.read()))
    return out
`);
  const convert = pyodide.globals.get('_convert');
  const optimise = pyodide.globals.get('_optimise');
  const earlyAlpha = pyodide.globals.get('_early_alpha');
  const dumpFile = pyodide.globals.get('banjo_dump').dump_file;
  return {
    pyodide,
    // SPIRV-Cross's Vulkan GLSL -> uam's GLSL (tools/deko3d_shaders.py's step); stage 'vert' or 'frag'
    convert: (text, stage) => convert(text, stage),
    // the default passes (glsl_opt_any of the native chain); name: the shader's 16 hex digits
    optimise: (text, stage, name) => optimise(text, stage, name),
    // [[name, hlsl]] -> [[name, rewritten hlsl]]
    earlyAlpha(items) {
      if (!items.length) return [];
      const r = earlyAlpha(items);
      const out = r.toJs();
      r.destroy();
      return out;
    },
    // one game file (its bytes, or a Blob: in a worker read by Python as it goes, through Emscripten's WORKERFS, not
    // copied in first) -> { results: [container bytes], problems: count }
    dumpFile(source) {
      const lazy = typeof Blob !== 'undefined' && source instanceof Blob && pyodide.FS.filesystems.WORKERFS &&
                   typeof FileReaderSync !== 'undefined';
      let path = '/game.bin';
      if (lazy) {
        pyodide.FS.mkdirTree('/mnt');
        pyodide.FS.mount(pyodide.FS.filesystems.WORKERFS, { blobs: [{ name: 'game.bin', data: source }] }, '/mnt');
        path = '/mnt/game.bin';
      } else {
        pyodide.FS.writeFile(path, source);
      }
      try {
        const r = dumpFile(path);
        const [results, problems] = r.toJs();
        r.destroy();
        return { results: results.map(([, blob]) => blob), problems: problems.length };
      } finally {
        if (lazy) pyodide.FS.unmount('/mnt');
        else pyodide.FS.unlink(path);
      }
    },
  };
}
