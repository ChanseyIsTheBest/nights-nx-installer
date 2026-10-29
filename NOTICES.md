# Third-party notices

| Component | Where | License |
|---|---|---|
| banjo-nx-installer (ChanseyIsTheBest, beside banjo-nx): this page's starting point: the page, the worker, the shader build (`lib/build.js`, `lib/chain.js`, `lib/package.js`, `lib/variants.js`, the GLSL and uam workers), the release tool and the tests | everything | GPL-3.0 |
| [futari-nx-installer](https://github.com/ChanseyIsTheBest/futari-nx-installer) (from sa2-nx-installer and nfsmw-nx-installer): the XEX reader and the STFS package reader | `lib/xex.js`, `lib/stfs.js` | GPL-3.0 |
| [libmspack](https://www.cabextract.org.uk/libmspack/) by Stuart Caie (LZX decoder), built for WebAssembly by futari-nx (`shaders/wasm/build_wasm_tools.sh`, `shaders/wasm/futari_lzx.cpp`, from the unmodified `lzxd.c` and `system.c`); with those sources it can be rebuilt and replaced by a modified version | `wasm/lzx.*` | LGPL-2.1 |
| nights-nx's shader dump rules (`tools/renut_shader_dump.py`: reNut's `find_shader_headers`), ported to JavaScript | `lib/nights_dump.js` | GPL-3.0 |
| [bejeweled3-nx-installer](https://github.com/ChanseyIsTheBest/bejeweled3-nx-installer), [sa2-nx-installer](https://github.com/ChanseyIsTheBest/sa2-nx-installer) and peggle2-nx by ChanseyIsTheBest: this page's starting point (the worker, the zip writer, the raw zstd frames of the GLSL package, the translator's front end, the test server) | `worker.js`, `app.js`, `lib/zip.js`, `lib/package.js`, `wasm/src/translator/`, `serve.py` | GPL-3.0 |
| [nfsmw-nx-installer](https://github.com/StevensND/nfsmw-nx-installer) by StevensND: the download service worker and the worker's download stream (through bejeweled3-nx-installer), the zip writer | `sw.js`, `worker.js`, `lib/zip.js` | GPL-3.0 |
| banjo-nx's shader tools, run unchanged in Pyodide: `tools/deko3d_glsl.py`, `tools/deko3d_glsl_opt.py` (and its shader lists), `tools/early_alpha.py`, `tools/renut_early_alpha.py` | `py/` | GPL-3.0 |
| [reNut](https://github.com/masterspike52/reNut) by masterspike52: `tools/dump_shaders.py` (run unchanged; its LZX decoder ported to JavaScript in `lib/lzx.js`) and the shader translator's reNut version | `py/dump_shaders.py`, `lib/lzx.js`, `wasm/renut_hlsl.*` | reuse permitted by its author |
| XenosRecomp ([hedge-dev](https://github.com/hedge-dev/XenosRecomp) and contributors), in reNut's version as banjo-nx carries it | `wasm/renut_hlsl.*`, `release/shader_common.h` | MIT |
| [uam](https://github.com/devkitPro/uam) by fincs (with Mesa's GLSL compiler and the nouveau codegen in `mesa-imported/`), with SwitchWakerHD's patches and banjo-nx's passes, as banjo-nx's `app/thirdparty/uam` | `wasm/uam.*`, `wasm/src/uam/` | uam: zlib License; Mesa: MIT and others (see its sources) |
| [DirectXShaderCompiler](https://github.com/microsoft/DirectXShaderCompiler) v2025.1 with SPIRV-Tools and SPIRV-Headers, and the `dxc_web.cpp` wrapper, as built by nfsmw-nx-installer (from bejeweled3-nx-installer) | `wasm/dxc_web.*` | NCSA (LLVM); SPIRV-Tools: Apache-2.0; SPIRV-Headers: MIT; the wrapper: GPL-3.0 |
| [SPIRV-Cross](https://github.com/KhronosGroup/SPIRV-Cross) (commit `22b22f56`), unmodified (from bejeweled3-nx-installer) | `wasm/spirv_cross.*` | Apache-2.0 |
| [Pyodide](https://pyodide.org) 0.27.7 (CPython 3.12 for WebAssembly) and its numpy 2.0.2 wheel, unmodified | `vendor/pyodide/` | Pyodide: MPL-2.0; CPython: PSF License; numpy: BSD-3-Clause |
| [xxHash](https://github.com/Cyan4973/xxHash) and [{fmt}](https://github.com/fmtlib/fmt), in the translator | `wasm/renut_hlsl.*` | BSD-2-Clause; MIT |
| [Emscripten](https://emscripten.org) 6.0.11 runtime and the musl libc it links | `wasm/*.mjs`, `wasm/*.wasm` | MIT and NCSA |

`wasm/uam.*` is built by `wasm/src/uam/build_wasm_uam.sh` and `wasm/renut_hlsl.*` by
`wasm/src/translator/build_wasm_translator.sh` (Emscripten 6.0.11) from the banjo-nx sources.

The licenses of the software in the NRO are listed in nights-nx's repository, with its source code. `py/dump_shaders.py`, `py/banjo_dump.py` and `lib/lzx.js` are banjo-nx-installer's Nuts & Bolts dump, loaded by `lib/py.js` but not used for NiGHTS.
