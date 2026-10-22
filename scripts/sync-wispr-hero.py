"""Extract the user-supplied, read-only homepage hero. Run with MIRROR [--check]."""
import argparse
from copy import deepcopy
import math
import hashlib
import json
from pathlib import Path
import re
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('mirror', type=Path)
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
html = (args.mirror / 'index.html').read_text()
asset_root = args.mirror / 'assets/cdn.prod.website-files.com/682f84b3838c89f8ff7667db'
archive = asset_root / '683e1e4368e08951ef7080d5_Flow header animation_toasts_trimmed v2.lottie'
font = asset_root / '682fbd676708c4fa3708edc8_Figtree-SemiBold.woff2'
with zipfile.ZipFile(archive) as z:
    manifest = json.loads(z.read('manifest.json'))
    animation = z.read('animations/' + manifest['animations'][0]['id'] + '.json')
tracks = []
for curve, duration in [('curve1', 35), ('curve2', 60)]:
    match = re.search(r'<svg[^>]*viewBox="([^"]+)"[^>]*>\s*<path id="' + curve + r'".*?</svg>', html, re.S)
    if not match:
        raise ValueError('Missing reference SVG: ' + curve)
    svg = match.group()
    path = re.search(r'<path[^>]* d="([^"]+)"', svg).group(1)
    copy = re.search(r'<textPath[^>]*>(.*?)</textPath>', svg, re.S).group(1)
    travel = int(re.search(r'<text\s+x="(-?\d+)"', svg).group(1))
    tracks.append(dict(viewBox=match.group(1), path=path, copy=copy, travel=travel, duration=duration))
# The sole AE expression is loopOut() on the waveform's time remap.
# Expand its linear sawtooth to data so Electron's CSP does not need unsafe-eval.
runtime = json.loads(animation)
wave = runtime['assets'][0]['layers'][0]
remap = wave['tm']
assert remap['x'] == 'var $bm_rt;\n$bm_rt = loopOut();'
first, last = remap['k']
period = last['t'] - first['t']
assert first['t'] == 0 and first['s'] == [0]
assert first['i']['x'] == first['i']['y'] and first['o']['x'] == first['o']['y']
keys = [deepcopy(first)]
# A billionth of a frame represents the discontinuity; all displayed frames
# retain the original linear interpolation, to floating-point precision.
for cycle in range(1, math.ceil(wave['op'] / period) + 1):
    end = cycle * period
    keys.append(dict(t=end if cycle == 1 else end - 1e-9, s=last['s'], h=1))
    start = deepcopy(first)
    start['t'] = end + 1e-9 if cycle == 1 else end
    keys.append(start)
keys.append(dict(t=keys[-1]['t'] + period, s=last['s']))
remap['k'] = keys
del remap['x']
runtime_bytes = (json.dumps(runtime, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
source = dict(tracks=tracks, provenance=dict(
    archive=archive.name,
    archiveSha256=hashlib.sha256(archive.read_bytes()).hexdigest(),
    animationSha256=hashlib.sha256(animation).hexdigest(),
    font=font.name, fontSha256=hashlib.sha256(font.read_bytes()).hexdigest(),
    playerVersion='5.13.0'))
outputs = {
    root / 'src/renderer/hub/assets/wispr-hero.json': animation,
    root / 'src/renderer/hub/assets/wispr-hero-runtime.json': runtime_bytes,
    root / 'src/renderer/hub/assets/wispr-hero-source.json': (json.dumps(source, ensure_ascii=False, indent=2) + '\n').encode(),
    root / 'public/fonts/wispr-figtree-semibold.woff2': font.read_bytes(),
}
for path, data in outputs.items():
    if args.check:
        if path.read_bytes() != data:
            raise ValueError('Reference differs: ' + str(path))
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    print(('PASS ' if args.check else 'Wrote ') + str(path.relative_to(root)))
