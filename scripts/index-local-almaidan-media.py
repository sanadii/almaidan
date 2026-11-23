"""Offline capture media resolver. Reads repository bytes; writes only a new local report."""
import hashlib
import json
from pathlib import Path
import os

ROOT = Path('D:/projects/huroof_wa_oloof')
WORKTREE = Path(__file__).resolve().parents[1]
CAPTURE = ROOT / 'output/t44-current-question-compare-20261002/CAPTURE-v4.json'
OUTPUT = ROOT / 'local/almaidan/media-index.json'

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def main():
    if OUTPUT.exists():
        raise SystemExit('Output exists; preserve it and choose a new explicit report path.')
    capture = json.loads(CAPTURE.read_text(encoding='utf-8-sig'))
    media = [x['data'] for x in capture['children'] if x['path'].split('/')[-2] == 'media']
    wanted = {x['assetSha256'] for x in media}
    sizes = {int(x['byteSize']) for x in media if x.get('byteSize') is not None}
    roots = [base / name for base in (ROOT, WORKTREE) for name in ('content', 'public', 'data', 'resources', 'output', 'outputs')]
    found = {}
    checked = 0
    for root in roots:
        if not root.is_dir():
            continue
        for directory, dirs, names in os.walk(root, followlinks=False):
            dirs[:] = [d for d in dirs if d not in ('node_modules', '.git') and not Path(directory, d).is_symlink()]
            for name in names:
                path = Path(directory, name)
                if path.is_symlink() or path.suffix.lower() not in {'.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.svg', '.mp4', '.webm', '.mp3', '.wav', '.ogg', '.m4a'}:
                    continue
                if path.stat().st_size not in sizes:
                    continue
                sha = digest(path)
                checked += 1
                if sha in wanted and sha not in found:
                    found[sha] = str(path.resolve())
    entries = [{**{k: x.get(k) for k in ('mediaId', 'assetSha256', 'byteSize', 'contentType')}, 'path': found.get(x['assetSha256']), 'verified': x['assetSha256'] in found} for x in media]
    report = {'schemaVersion': 1, 'sourceCapture': str(CAPTURE), 'captureSha256': digest(CAPTURE), 'networkAccess': False, 'checkedFiles': checked, 'total': len(entries), 'verified': sum(x['verified'] for x in entries), 'missing': sum(not x['verified'] for x in entries), 'entries': entries}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open('x', encoding='utf-8') as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
    print(json.dumps({k: report[k] for k in ('total', 'verified', 'missing', 'checkedFiles')}))

if __name__ == '__main__':
    main()
