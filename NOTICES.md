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
| [culdcept-nx-installer](https://github.com/ChanseyIsTheBest/culdcept-nx-installer), rr6-nx-installer and sa2-nx-ult-installer by ChanseyIsTheBest (2026-11-22): the packing (`lib/lz4b.js`, `pack_worker.js`), the ASF reader and writer (`lib/asf.js`), the movies' re-encode (`lib/movies.js`, `movie_worker.js`, `wasm/src/vc1/` from their `wasm/src/wmv3/`), the music's Opus (`lib/adx.js`, `lib/audio.js`, `audio_worker.js`: sa2-nx-ult's ADX decode), the zip writer's streamed entries, the download without a known size, the Node tests | `lib/`, `*_worker.js`, `wasm/src/vc1/`, `test/` | GPL-3.0 |
| [LZ4](https://github.com/lz4/lz4) 1.10.0 by Yann Collet: `lz4.c`, `lz4.h`, `lz4hc.c`, `lz4hc.h`, unmodified (from rr6-nx-installer) | `wasm/src/lz4/`, `wasm/lz4.*` | BSD 2-Clause (`wasm/src/lz4/LICENSE`) |
| [ZXC](https://github.com/hellobertrand/zxc) 0.15.0 by Bertrand Lebonnois: its library, unmodified but for `zxc_driver.c` left out (from rr6-nx-installer, with its `rr6_zxc.c` exports) | `wasm/src/zxc/`, `wasm/zxc.*` | BSD 3-Clause (`wasm/src/zxc/LICENSE`) |
| [rapidhash](https://github.com/Nicoshev/rapidhash) by Nicolas De Carli, bundled with ZXC | `wasm/src/zxc/src/lib/vendors/rapidhash.h`, `wasm/zxc.*` | MIT (`wasm/src/zxc/THIRD_PARTY_NOTICES`) |
| [FFmpeg](https://ffmpeg.org) 4.4's VC-1 and WMV3 decoders (libavcodec and libavutil, configured with those decoders only; the copy in nights-nx's `sdk/thirdparty/FFmpeg`), with the `vc1_wasm.c` exports (from culdcept-nx-installer's `wmv3_wasm.c`) | `wasm/src/vc1/`, `wasm/vc1.*` | LGPL-2.1-or-later |

`wasm/uam.*` is built by `wasm/src/uam/build_wasm_uam.sh` and `wasm/renut_hlsl.*` by
`wasm/src/translator/build_wasm_translator.sh` (Emscripten 6.0.11) from the banjo-nx sources; `wasm/lz4.*` by
`wasm/src/lz4/build.sh`, `wasm/zxc.*` by `wasm/src/zxc/build.sh` and `wasm/vc1.*` by `wasm/src/vc1/build.sh` (Emscripten
6.0.11). The H.265 and Opus encoders are the browser's own (WebCodecs): the page ships none.

The licenses of the software in the NRO are listed in nights-nx's repository, with its source code. `py/dump_shaders.py`, `py/banjo_dump.py` and `lib/lzx.js` are banjo-nx-installer's Nuts & Bolts dump, loaded by `lib/py.js` but not used for NiGHTS.
