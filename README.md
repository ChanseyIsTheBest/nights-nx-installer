<div align=center>

<img src="icons/icon-192.png" alt="NiGHTS into Dreams..." width="20%">

</div>
<h1 align=center>nights-nx installer</h1>

A web page that builds the Nintendo Switch package of **NiGHTS into Dreams...** (Xbox Live Arcade, title `58411268`)
for [nights-nx](https://github.com/ChanseyIsTheBest/nights-nx) from the player's own copy, in the browser. Nothing is
uploaded: the game's files never leave the computer.

The release NRO carries no game data: none of the game's files and none of its shaders. The page makes the shaders
from the player's files, as nights-nx's native build makes them:

1. **The shaders' containers** (`lib/nights_dump.js`): `default.xex` is decrypted and unpacked (`lib/xex.js`, with
   libmspack's LZX decoder in WebAssembly, `wasm/lzx.*`), and the containers compiled into it are found by reNut's
   `find_shader_headers` rules; the stand-alone ones are `shader/xbox 360/*.wvu` and `*.wpu`. 99 shaders, the same as
   nights-nx's native dump (NiGHTS makes none at runtime).
2. **Renut's translator** (`wasm/renut_hlsl`, XenosRecomp in WebAssembly): each container's HLSL and the numbers of the
   NRO's shader table (masks, vertex inputs, literals).
3. **GLSL for the console**, on a pool of workers (`glsl_worker.js`): `renut_early_alpha.py` (pixel shaders), DXC,
   SPIRV-Cross, `deko3d_glsl.py` and `deko3d_glsl_opt.py`, the Python tools unchanged in
   [Pyodide](https://pyodide.org).
4. **deko3d_glsl.bin** (`lib/package.js`, version 2 of the GLSL package, tag `renut7-bnxglsl1`): the GLSL and the shader
   table, which the NRO reads next to itself.
5. **deko3d_shaders.bin**: every shader variant of `release/variants.txt` (from nights-nx's
   `tools/deko3d_variant_cache.py --export-variants`) plus each shader as it is, compiled by uam in WebAssembly
   (`wasm/uam`, the console's compiler with banjo-nx's flags), so the console compiles nothing at its first start.
6. **nights-nx.zip**, streamed to a download by the service worker (`sw.js`): `switch/nights-nx/` with the NRO,
   `pipeline_list.bin`, the two shader files and `game_root/` (the game's files and the title update's
   `default.xexp`). `renut.toml` is not in it: the NRO writes it at its first start, so an update never overwrites
   the player's settings.

## What the player chooses

- **Both packages at once**: the game (`Content/0000000000000000/58411268/000D0000/<package>` of a console's storage)
  and its title update (`000B0000/<package>`, or the `TU_...` file of the console's `Cache` folder), read in place
  (`lib/stfs.js`); or
- **the extracted game folder**, with the update's `default.xexp` beside `default.xex`.

`default.xex` and `default.xexp` are recognised by their SHA-256 (`release/manifest.json`).

## Use

    python serve.py 8193 .

then open http://127.0.0.1:8193/ in a Chromium browser (service-worker downloads, `webkitdirectory`, nested
workers).

## Release files

`release/` is filled by `tools/make_release.py` from a nights-nx **distribution build**: its own shader table empty
(nights-nx: `tools/renut_switch_shader_cache.py --pc app/out/pc-nx --only <an empty folder> --out-dir
app/out/renut_switch_dist`) and no GLSL package (`BANJO_DEKO3D_GLSL_CPP` pointing at no file), so it reads every
shader from `deko3d_glsl.bin`. With `--reference`, the manifest also holds the SHA-256 of the two shader files a Node
run made (`test/full_node.mjs`), so the page can say whether its own are identical.

## Tests (Node 24, from this folder)

| Test | What it checks |
|---|---|
| `test/full_node.mjs <game folder> <nights-nx> <out>` | the whole build as the page runs it, against nights-nx's native dump, shader table and GLSL |
| `test/chain_node.mjs`, `test/translate_node.mjs`, `test/py_passes_node.mjs`, `test/spirv_cross_node.mjs`, `test/uam_node.mjs` | banjo-nx-installer's checks of the chain's parts |
| `test/browser.html` (with `python serve.py 8193 . --test-files <game>`) | worker.js in a browser, the zip read back |

Outputs of the tests (shader files, zips) are game data: never commit or share them.

See NOTICES.md for what comes from where and its licences. GPL-3.0 (LICENSE).
