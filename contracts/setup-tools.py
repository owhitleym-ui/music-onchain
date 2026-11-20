#!/usr/bin/env python3
"""Install the verified macOS ARM development tools inside this project only."""
import hashlib
import json
import os
import platform
import subprocess
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TOOLS = ROOT / '.tools'
LOCK = json.loads((ROOT / 'tools.lock.json').read_text())


def download(url, name, checksum):
    target = TOOLS / name
    if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != checksum:
        temporary = target.with_suffix(target.suffix + '.partial')
        subprocess.run(['curl', '--fail', '--location', '--silent', '--show-error', '--max-time', '120', url, '--output', str(temporary)], check=True)
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != checksum:
            raise RuntimeError(f'Checksum mismatch: {name}')
        temporary.replace(target)
    return target


def extract(archive, destination):
    with tarfile.open(archive) as contents:
        for member in contents.getmembers():
            if member.name.startswith('/') or '..' in Path(member.name).parts:
                raise RuntimeError('Unsafe archive path')
        contents.extractall(destination, filter='data')


if platform.system() != 'Darwin' or platform.machine() != 'arm64':
    raise SystemExit('This local tool installer targets macOS Apple Silicon. Install Solidity 0.8.28 and Arc Foundry for your platform using the official docs; forge test also accepts --use /path/to/solc.')

TOOLS.mkdir(exist_ok=True)
compiler = download('https://binaries.soliditylang.org/macosx-amd64/solc-macosx-amd64-v0.8.28+commit.7893614a', 'solc-0.8.28', LOCK['solc']['sha256'])
compiler.chmod(0o755)
arc = download('https://github.com/circlefin/arc-foundry/releases/download/v0.8.0-4/arc-foundry-v0.8.0-4-aarch64-apple-darwin.tar.gz', 'arc-foundry.tar.gz', LOCK['arc-foundry']['sha256'])
if not (TOOLS / 'arc-foundry' / 'forge').exists():
    extract(arc, TOOLS / 'arc-foundry')

# The official macOS Arc binaries link libusb. Build it locally instead of
# modifying Homebrew or the user's shell/profile settings.
if not (TOOLS / 'libusb-local/lib/libusb-1.0.0.dylib').exists():
    archive = download('https://github.com/libusb/libusb/releases/download/v1.0.29/libusb-1.0.29.tar.bz2', 'libusb.tar.bz2', LOCK['libusb']['sha256'])
    extract(archive, TOOLS)
    source = TOOLS / 'libusb-1.0.29'
    environment = {**os.environ, 'lt_cv_sys_max_cmd_len': '262144'}
    log_path = TOOLS / 'libusb-build.log'
    with log_path.open('w') as log:
        for command in [['./configure', f'--prefix={TOOLS / "libusb-local"}', '--disable-static'], ['make', '-j4'], ['make', 'install']]:
            subprocess.run(command, cwd=source, env=environment, stdout=log, stderr=subprocess.STDOUT, check=True)

print('Project-local compiler and Arc Foundry are ready. Run ./check.sh or ./check.sh arc.')
