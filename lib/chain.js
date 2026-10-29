// banjo-nx-installer: one shader through banjo-nx's deko3d chain (docs/deko3d-renderer.md section 5 of banjo-nx), in
// the page. The native build: the translator's first run dumps the pixel shaders' HLSL, tools/renut_early_alpha.py
// rewrites them, the second run compiles (DXC 1.8.2407, -spirv -DBANJO_DEKO3D), tools/deko3d_shaders.py turns the
// SPIR-V into uam's GLSL (SPIRV-Cross + tools/deko3d_glsl.py) and tools/deko3d_glsl_opt.py applies its default passes.
// Here:
//   wasm/renut_hlsl   the translator (exact: test/translate_node.mjs)
//   py (Pyodide)      renut_early_alpha.py, deko3d_glsl.py, deko3d_glsl_opt.py unchanged (exact: test/py_passes_node.mjs)
//   wasm/dxc_web      DXC v2025.1 (bejeweled3-nx-installer's: fixed arguments, the y flip of a vertex shader undone
//                     below, the deko3d defines as #define lines): NOT the native DXC, see test/chain_node.mjs
//   wasm/spirv_cross  SPIRV-Cross 22b22f56 (exact: test/spirv_cross_node.mjs)
export const DXC_PREAMBLE = '#define BANJO_DEKO3D 1\n#define RENUT_RECOMP 1\n';

// DXC's -fvk-invert-y, as SPIRV-Cross writes it (bejeweled3-nx-installer's lib/deko3d.js): back to the position as
// it is, what the native chain (compiled without the flag for deko3d) writes.
export function undoInvertY(glsl) {
  // A copy of a variable flipped: "vec4 _A = _B; _A.y = -_B.y; gl_Position = _A;" -> "gl_Position = _B;".
  let m = /^([ \t]*)vec4 (_\d+) = (_\d+);\n[ \t]*\2\.y = -\3\.y;\n[ \t]*gl_Position = \2;$/m.exec(glsl);
  if (m) return glsl.slice(0, m.index) + `${m[1]}gl_Position = ${m[3]};` + glsl.slice(m.index + m[0].length);
  // banjo-nx-installer: a computed value flipped in place: "vec4 _N = <expr>; _N.y = -_N.y; gl_Position = _N;" ->
  // "gl_Position = <expr>;" when _N is used nowhere else (as the native chain writes it), else the flip alone goes.
  m = /^([ \t]*)vec4 (_\d+) = (.+);\n[ \t]*\2\.y = -\2\.y;\n[ \t]*gl_Position = \2;$/m.exec(glsl);
  if (m) {
    const uses = glsl.match(new RegExp(`\\b${m[2]}\\b`, 'g')).length;
    const tail = glsl.slice(m.index + m[0].length);
    if (uses === 4) return glsl.slice(0, m.index) + `${m[1]}gl_Position = ${m[3]};` + tail;
    return glsl.slice(0, m.index) + `${m[1]}vec4 ${m[2]} = ${m[3]};\n${m[1]}gl_Position = ${m[2]};` + tail;
  }
  // banjo-nx-installer: a constant position, the flip folded into its y: "gl_Position = vec4(0.0, -0.0, 0.0, 0.0);" ->
  // the native "gl_Position = vec4(0.0);", and the same with NaN (0x7fc00000 flipped is 0xffc00000) or infinity.
  m = /^([ \t]*)gl_Position = vec4\((.*)\);$/m.exec(glsl);
  if (m) {
    const parts = splitTopLevel(m[2]);
    if (parts.length === 4 && parts.every(isConstant)) {
      parts[1] = negateConstant(parts[1]);
      const args = parts.every((p) => p === parts[0]) ? parts[0] : parts.join(', ');  // SPIRV-Cross's own form
      return glsl.slice(0, m.index) + `${m[1]}gl_Position = vec4(${args});` + glsl.slice(m.index + m[0].length);
    }
  }
  throw new Error('the vertex shader has no y flip where DXC puts it');
}

function splitTopLevel(text) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (text[i] === ',' && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  out.push(text.slice(start).trim());
  return out;
}

const FLOAT_LITERAL = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/;
const BITS_LITERAL = /^uintBitsToFloat\(0x([0-9a-f]+)u( \/\* -?[a-z]+ \*\/)?\)$/;
const isConstant = (p) => FLOAT_LITERAL.test(p) || BITS_LITERAL.test(p);

// SPIRV-Cross's text of the constant with its sign bit flipped.
function negateConstant(p) {
  if (FLOAT_LITERAL.test(p)) return p.startsWith('-') ? p.slice(1) : '-' + p;
  const bits = (parseInt(BITS_LITERAL.exec(p)[1], 16) ^ 0x80000000) >>> 0;
  const exponent = (bits >>> 23) & 0xff, mantissa = bits & 0x7fffff, negative = bits >>> 31;
  const note = exponent === 0xff ? (mantissa ? ' /* nan */' : negative ? ' /* -inf */' : ' /* inf */') : '';
  return `uintBitsToFloat(0x${bits.toString(16)}u${note})`;
}

// hlsl: the translator's text (a pixel shader after early alpha); modules: { dxc, spirvCross } Emscripten modules;
// py: lib/py.js. Returns the optimised GLSL (what the package holds) or throws.
export function hlslToGlsl(name, hlsl, modules, py) {
  const { dxc, spirvCross } = modules;
  const vertex = name.startsWith('vs_');
  dxc.FS.writeFile('/s.hlsl', DXC_PREAMBLE + hlsl);
  const crc = dxc.ccall('compile', 'number', ['string', 'string', 'number'], ['/s.hlsl', '/s.spv', vertex ? 1 : 0]);
  if (crc !== 0) throw new Error(`DXC rejected ${name} (${crc})`);
  spirvCross.FS.writeFile('/s.spv', dxc.FS.readFile('/s.spv'));
  const xrc = spirvCross.callMain(['/s.spv', '--version', '460', '--vulkan-semantics', '--relax-nan-checks',
                                   '--output', '/s.vk.glsl']);
  if (xrc !== 0 && xrc !== undefined) throw new Error(`SPIRV-Cross rejected ${name} (${xrc})`);
  let vk = spirvCross.FS.readFile('/s.vk.glsl', { encoding: 'utf8' });
  if (vertex) vk = undoInvertY(vk);
  const stage = vertex ? 'vert' : 'frag';
  return py.optimise(py.convert(vk, stage), stage, name.slice(3));
}
