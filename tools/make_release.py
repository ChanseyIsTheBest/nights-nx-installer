#!/usr/bin/env python3
"""nights-nx-installer: fills release/ from a nights-nx distribution build (from banjo-nx-installer's).

    python tools/make_release.py --nro <distribution nights-nx.nro> --nights <nights-nx root> --xex <default.xex>
        --xexp <the title update's default.xexp> [--pipelines <pipeline_list.bin>] [--reference <folder of
        test/full_node.mjs's output>] [--version 0.1.0]

The NRO must be a distribution build (nights-nx: an empty shader table and GLSL package, tools/renut_switch_shader_cache.py
--only and tools/deko3d_shader_package.py --only --raw on an empty folder: NiGHTS makes no shader at runtime): it carries
none of the game's shaders. release/ then holds the NRO, its pipeline list, the translator's shader_common.h, and
manifest.json naming each file's SHA-256 and the supported default.xex and default.xexp (their SHA-256 only). With
--reference, the SHA-256 of the deko3d_glsl.bin and deko3d_shaders.bin a run of the whole build made (they are the same
bytes in every browser): the page then says whether its own are identical. release/variants.txt is written by
nights-nx's tools/deko3d_variant_cache.py --export-variants.
"""
import argparse
import hashlib
import json
import os
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--nro', required=True)
    ap.add_argument('--nights', required=True)
    ap.add_argument('--xex', required=True)
    ap.add_argument('--xexp', required=True)
    ap.add_argument('--pipelines')
    ap.add_argument('--reference')
    ap.add_argument('--version', default='0.1.0')
    a = ap.parse_args()
    release = os.path.join(ROOT, 'release')
    os.makedirs(release, exist_ok=True)
    pipelines = a.pipelines or os.path.join(a.nights, 'dist', 'switch', 'nights-nx', 'pipeline_list.bin')
    copies = [(a.nro, 'nights-nx.nro'), (pipelines, 'pipeline_list.bin'),
              (os.path.join(a.nights, 'app', 'thirdparty', 'reblue-XenosRecomp', 'XenosRecomp', 'shader_common.h'),
               'shader_common.h')]
    for src, name in copies:
        shutil.copyfile(src, os.path.join(release, name))
    build = {
        'edition': 'Xbox Live Arcade (title 58411268) with its title update',
        'version': a.version,
        'xex_sha256': sha256(a.xex),
        'xexp_sha256': sha256(a.xexp),
        'nro': 'nights-nx.nro',
        'nro_sha256': sha256(os.path.join(release, 'nights-nx.nro')),
        'files': [{'path': name, 'source': name, 'sha256': sha256(os.path.join(release, name))}
                  for name in ('pipeline_list.bin',)],
    }
    if a.reference:
        build['deko3d_glsl_sha256'] = sha256(os.path.join(a.reference, 'deko3d_glsl.bin'))
        build['deko3d_shaders_sha256'] = sha256(os.path.join(a.reference, 'deko3d_shaders.bin'))
    with open(os.path.join(release, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump({'version': 1, 'builds': [build]}, f, indent=2)
        f.write('\n')
    print(json.dumps(build, indent=2))


if __name__ == '__main__':
    main()
