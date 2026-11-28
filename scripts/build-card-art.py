#!/usr/bin/env python3
"""Build derived images ONLY in a staging directory, preserving all originals.

The staged VisualDatabase contains the generated asset manifest. No additional
runtime DB, startup fetch, image service, or main-branch image commits required.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
from urllib.parse import quote
from PIL import Image, ImageCms, features, __version__ as PILLOW_VERSION

MARKER = '/*__CT2_CARD_ART_MANIFEST__*/null'
OUTPUT = 'assets/generated/card-art'
ROOTS = ('assets/images/cards', 'assets/images/characters')
# Width/height bounds, quality and lossless. These are presentation-only
# display budgets; preserve aspect ratio, transparency and original preview size.
TIERS = {'hud': (128, 192, 84, False), 'card': (512, 768, 86, False),
         'preview': (None, None, 92, False)}
FRAME_POLICY = (None, None, 100, True)
BACKGROUND_POLICY = (None, None, 90, False)
PIPELINE_VERSION = 'ct2-card-art-v1'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def open_rgba(data):
    with Image.open(io.BytesIO(data)) as source:
        source.load()
        if source.format != 'PNG':
            raise ValueError('Expected PNG source')
        if getattr(source, 'n_frames', 1) != 1:
            raise ValueError('Animated PNG is not supported as static card artwork')
        rgba = source.convert('RGBA')
        # Preserve alpha and normalize tagged colors to sRGB where possible.
        profile = source.info.get('icc_profile')
        if profile:
            try:
                rgb = ImageCms.profileToProfile(source.convert('RGB'),
                    ImageCms.ImageCmsProfile(io.BytesIO(profile)),
                    ImageCms.createProfile('sRGB'), outputMode='RGB')
                rgb.putalpha(rgba.getchannel('A'))
                rgba = rgb
                profile = None  # WebP's untagged RGB is sRGB; avoids time-dependent ICC bytes.
            except (OSError, ValueError, ImageCms.PyCMSError):
                # A malformed/non-RGB profile must not silently alter artwork.
                # Retain the original tagged profile rather than drop it.
                pass
        return rgba, profile

def encode(data, source_hash, tier, policy, cache):
    w, h, quality, lossless = policy
    cache_key = digest(json.dumps([PIPELINE_VERSION, PILLOW_VERSION,
        features.version('webp'), source_hash, policy], separators=(',', ':')).encode())
    cached = cache / (cache_key + '.webp') if cache else None
    image, profile = open_rgba(data)
    if w is not None:
        image.thumbnail((w, h), Image.Resampling.LANCZOS)
    # Validate a restored cache entry (including alpha) before publishing it.
    def valid(blob):
        try:
            with Image.open(io.BytesIO(blob)) as rendered:
                rendered.load()
                return (rendered.format == 'WEBP' and rendered.size == image.size
                    and rendered.convert('RGBA').getchannel('A').tobytes() == image.getchannel('A').tobytes())
        except (OSError, ValueError):
            return False
    if cached and cached.is_file():
        candidate = cached.read_bytes()
        if valid(candidate):
            return candidate, image.size, True
    output = io.BytesIO()
    options = dict(format='WEBP', quality=quality, lossless=lossless,
                   method=6, alpha_quality=100, exact=True)
    if profile:
        options['icc_profile'] = profile
    image.save(output, **options)
    candidate = output.getvalue()
    if not valid(candidate):
        raise ValueError('WebP verification failed: dimensions or alpha changed')
    if cached:
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_bytes(candidate)
    return candidate, image.size, False

def build(site, cache=None):
    site = site.resolve()
    if (site / '.git').exists():
        raise ValueError('Refusing to modify a Git working tree; use a staged site directory')
    js = site / 'js/visual-database.js'
    source_js = js.read_text(encoding='utf-8')
    if source_js.count(MARKER) != 1:
        raise ValueError('Expected exactly one empty card-art manifest marker')
    if not features.check('webp'):
        raise RuntimeError('Pillow WebP support is required')
    generated = site / OUTPUT
    generated.mkdir(parents=True, exist_ok=True)
    if any(generated.iterdir()):
        raise ValueError('Use a clean staged directory; derived assets must not be checked into main')
    sources = sorted({p for dirname in ROOTS for p in (site / dirname).rglob('*')
                     if p.is_file() and p.suffix.lower() == '.png'})
    entries, summaries, converted = {}, [], {}
    totals = {'sourceFiles': len(sources), 'sourceBytes': 0, 'cardBytes': 0,
              'hudBytes': 0, 'previewBytes': 0, 'encodedFiles': 0,
              'cacheHits': 0, 'caseConflicts': [], 'warnings': []}
    for path in sources:
        relative = path.relative_to(site).as_posix()
        data = path.read_bytes()
        source_hash = digest(data)
        original = quote(relative, safe='/') + '?art=' + source_hash[:20]
        entry = {'original': original}
        info = {'source': relative, 'sourceBytes': len(data), 'sourceHash': source_hash}
        totals['sourceBytes'] += len(data)
        name = path.stem.lower()
        decoration = name in ('hero-frame', 'hero-background') and relative.startswith('assets/images/cards/heroes/')
        policies = ({tier: FRAME_POLICY if name == 'hero-frame' else BACKGROUND_POLICY
                     for tier in TIERS} if decoration else TIERS)
        for tier, policy in policies.items():
            cache_key = (source_hash, policy)
            if cache_key not in converted:
                blob, dimensions, hit = encode(data, source_hash, tier, policy, cache)
                # Content hash reflects the exact encoded bytes; changing any
                # encoder or original content cannot accidentally reuse old art.
                filename = digest(blob) + '.webp'
                if len(blob) < len(data):
                    (generated / filename).write_bytes(blob)
                    converted[cache_key] = (f'{OUTPUT}/{filename}', len(blob), dimensions)
                else:
                    # Do not inflate a very small or already efficient original.
                    converted[cache_key] = (None, len(data), open_rgba(data)[0].size)
                totals['cacheHits'] += int(hit)
            url, size, dimensions = converted[cache_key]
            entry[tier] = url or original
            info[tier] = {'url': entry[tier], 'bytes': size, 'width': dimensions[0], 'height': dimensions[1]}
            totals[tier+'Bytes'] += size
        entries[relative] = entry
        summaries.append(info)
    # Exact source selection preserves prior lowercase preference. Report
    # differing duplicates instead of guessing which painting the owner wants.
    for path in sources:
        if path.suffix != '.png':
            continue
        other = path.with_suffix('.PNG')
        if other.is_file() and digest(path.read_bytes()) != digest(other.read_bytes()):
            totals['caseConflicts'].append(path.relative_to(site).as_posix())
    # Keep existing CSS geometry and shared assets. Only rewrite the exact
    # published frame/background URLs in the staged CSS, not authoring CSS.
    for css_name in ('hero-card.css','unit-hud.css'):
        css = site / 'css' / css_name
        if not css.is_file():
            continue
        content = css.read_text(encoding='utf-8')
        def replace_url(match):
            path = match.group(1)
            entry = entries.get(path) or entries.get(path[:-4]+'.PNG')
            return f"url('../{entry['preview']}')" if entry else match.group(0)
        content = re.sub(r"url\(['\"]?\.\./(assets/images/cards/heroes/hero-(?:frame|background)\.png)['\"]?\)",
                         replace_url, content)
        css.write_text(content, encoding='utf-8')
    manifest = {'version': 1, 'entries': entries}
    # A single exact literal replacement, all names escaped by JSON. No
    # dynamic script injection or manifest fetch during browser startup.
    js.write_text(source_js.replace(MARKER, json.dumps(manifest, ensure_ascii=True,
                    separators=(',', ':'))), encoding='utf-8')
    totals['encodedFiles'] = len(list(generated.glob('*.webp')))
    (generated/'report.json').write_text(json.dumps({'totals': totals,'images': summaries},
        ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(totals, ensure_ascii=False, indent=2))
    for conflict in totals['caseConflicts']:
        print('WARNING: distinct .png/.PNG originals; exact path preserved:', conflict)
    if not sources:
        print('WARNING: no card artwork found; existing PNG paths remain in use')
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary,'a',encoding='utf-8') as f:
            f.write('## Card artwork build\n\n')
            f.write(f"Originals: {len(sources)}; unique WebP outputs: {totals['encodedFiles']}; cached encodes: {totals['cacheHits']}\n\n")
            for k in ['sourceBytes','cardBytes','hudBytes','previewBytes']:
                f.write(f'- {k}: {totals[k]:,} bytes\n')
            f.write('\nCase conflicts (both originals preserved):\n')
            for path in totals['caseConflicts']:
                f.write(f'- `{path}`\n')
    return totals

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', type=Path, required=True, help='Clean staged copy, not main')
    parser.add_argument('--cache', type=Path, help='Optional persistent encoding cache')
    args = parser.parse_args()
    build(args.site, args.cache)

if __name__ == '__main__':
    main()
