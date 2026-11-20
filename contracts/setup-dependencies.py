#!/usr/bin/env python3
"""Install pinned public source archives in an unsynced cache; link them locally."""
import io
import json
import shutil
import tarfile
import tempfile
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LIB = ROOT / 'lib'
CACHE = Path(tempfile.gettempdir()) / 'music-contest-dependencies'
LIB.mkdir(exist_ok=True)
CACHE.mkdir(exist_ok=True)
for name, dependency in json.loads((ROOT / 'dependencies.lock.json').read_text()).items():
    revision = dependency['revision']
    cached = CACHE / f'{name}-{revision}'
    marker = cached / '.dependency-revision'
    if not marker.exists() or marker.read_text().strip() != revision:
        repository = dependency['repository'].removeprefix('https://github.com/').removesuffix('.git')
        url = f'https://codeload.github.com/{repository}/tar.gz/{revision}'
        print(f'Downloading pinned {name} source…', flush=True)
        archive = subprocess.run(['curl', '--fail', '--location', '--silent', '--show-error', '--max-time', '120', url], check=True, capture_output=True).stdout
        with tempfile.TemporaryDirectory(dir=CACHE, prefix='download-') as temporary:
            with tarfile.open(fileobj=io.BytesIO(archive)) as contents:
                for member in contents.getmembers():
                    if member.name.startswith('/') or '..' in Path(member.name).parts:
                        raise RuntimeError('Unsafe dependency archive')
                contents.extractall(temporary, filter='data')
            source, = Path(temporary).iterdir()
            if cached.exists(): raise RuntimeError(f'Unexpected incomplete cache: {cached}')
            shutil.move(str(source), cached)
        marker.write_text(revision + '\n')
    destination = LIB / name
    if destination.is_symlink():
        if destination.resolve() != cached.resolve(): destination.unlink()
    elif destination.exists():
        # Only replace a previously installed, marked public dependency cache.
        if not (destination / '.dependency-revision').exists():
            raise SystemExit(f'Unrecognized dependency directory: {destination}; move it aside first.')
        shutil.rmtree(destination)
    if not destination.is_symlink(): destination.symlink_to(cached, target_is_directory=True)
    print(f'{name}: {revision}', flush=True)
