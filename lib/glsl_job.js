// banjo-nx-installer: one GLSL worker's tools and its job: the translator's HLSL of one shader -> (a pixel shader:
// renut_early_alpha.py) -> DXC -> SPIRV-Cross -> deko3d_glsl.py -> deko3d_glsl_opt.py (lib/chain.js). About 0.9 s a
// shader on one thread (early alpha, DXC and the passes a third each), so lib/build.js runs several workers:
// glsl_worker.js on the page, test/glsl_worker_node.mjs in Node.
import { hlslToGlsl } from './chain.js';
import { loadPython } from './py.js';

const quiet = () => ({ print: () => {}, printErr: () => {} });

// tools: { createDxc, createSpirvCross } (Emscripten factories), loadPyodide, pyodideIndex, readPy(name) -> text.
// Returns handle(message) -> reply for { id, name, hlsl }: { id, glsl } (UTF-8 bytes) or { id, error }.
export async function glslJob({ createDxc, createSpirvCross, loadPyodide, pyodideIndex, readPy }) {
  // A fresh options object per module: Emscripten makes the object it is given the module itself.
  const modules = { dxc: await createDxc(quiet()), spirvCross: await createSpirvCross(quiet()) };
  const py = await loadPython(loadPyodide, pyodideIndex, readPy);
  const enc = new TextEncoder();
  return ({ id, name, hlsl }) => {
    try {
      const text = name.startsWith('ps_') ? py.earlyAlpha([[name, hlsl]])[0][1] : hlsl;
      return { id, glsl: enc.encode(hlslToGlsl(name, text, modules, py)) };
    } catch (e) {
      return { id, error: e.message || String(e) };
    }
  };
}
