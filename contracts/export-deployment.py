#!/usr/bin/env python3
"""Export verified, public deployment data for the local MetaMask page.

This prepares data only. It never reads a private key or submits a transaction.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

CONTRACT = 'MusicPredictionContest'
COMPILER = '0.8.28+commit.7893614a'
ROOT = Path(__file__).resolve().parent


def require(condition, message):
    if not condition:
        raise ValueError(message)


def normalize_bytecode(value, name):
    require(isinstance(value, dict) and not value.get('linkReferences'), f'{name} has unresolved library links.')
    code = value.get('object', '')
    code = code.removeprefix('0x') if isinstance(code, str) else ''
    require(bool(code) and len(code) % 2 == 0 and re.fullmatch(r'[0-9a-fA-F]+', code), f'{name} is not deployable hexadecimal bytecode.')
    return '0x' + code.lower()


def cast_binary():
    installed = shutil.which('cast')
    if installed:
        return installed, os.environ.copy()
    local = ROOT / '.tools/arc-foundry/cast'
    require(local.is_file(), 'Install Foundry cast or run contracts/setup-tools.py before exporting.')
    environment = os.environ.copy()
    library = str(ROOT / '.tools/libusb-local/lib')
    environment['DYLD_LIBRARY_PATH'] = library + (':' + environment['DYLD_LIBRARY_PATH'] if environment.get('DYLD_LIBRARY_PATH') else '')
    return str(local), environment


def export():
    manifest = json.loads((ROOT / 'abi/build-manifest.json').read_text())
    artifact = json.loads((ROOT / f'out/{CONTRACT}.sol/{CONTRACT}.json').read_text())
    abi_file = ROOT / f'abi/{CONTRACT}.json'
    abi = json.loads(abi_file.read_text())
    require(hashlib.sha256(abi_file.read_bytes()).hexdigest() == manifest.get('abiSha256'), 'Public ABI does not match the reviewed build manifest.')
    require(abi == artifact.get('abi'), 'Compiled ABI differs from the reviewed public ABI.')

    metadata = json.loads(artifact.get('rawMetadata', '{}'))
    require(isinstance(metadata, dict) and metadata, 'Missing compiler metadata.')
    # Foundry's parsed view omits empty ABI arrays and normalizes remappings.
    # Compare ABI semantics; use the raw compiler metadata as the authority.
    def canonical_abi(items):
        normalized = [{key: value for key, value in item.items() if not (key in ('inputs', 'outputs') and value == [])} for item in items]
        return sorted(json.dumps(item, sort_keys=True) for item in normalized)
    require(canonical_abi(metadata.get('output', {}).get('abi', [])) == canonical_abi(abi), 'Raw compiler ABI differs from the public ABI.')
    require(metadata.get('compiler', {}).get('version') == COMPILER == manifest.get('compiler'), 'Compiler version differs from the reviewed build.')
    settings = metadata.get('settings', {})
    require(settings.get('compilationTarget') == {'src/MusicPredictionContest.sol': CONTRACT}, 'Unexpected compilation target.')
    require(settings.get('evmVersion') == 'cancun' == manifest.get('evmVersion'), 'EVM target must be Cancun.')
    require(settings.get('optimizer') == {'enabled': True, 'runs': 200} == manifest.get('optimizer'), 'Optimizer settings differ from the reviewed build.')
    require(settings.get('viaIR', False) is False and manifest.get('viaIR') is False, 'Reviewed non-IR compilation is required.')
    require(manifest.get('chainTarget') == 5042002, 'Only the Arc Testnet build can be exported.')
    require(not settings.get('libraries'), 'Unexpected external library configuration.')

    expected_sources = manifest.get('sourceSha256', {})
    require(set(expected_sources) == {'src/MusicPredictionContest.sol', 'src/RewardCurve.sol'}, 'Unexpected source set in build manifest.')
    cast, environment = cast_binary()
    for name, expected in expected_sources.items():
        content = (ROOT / name).read_bytes()
        require(hashlib.sha256(content).hexdigest() == expected, f'Source changed since review: {name}; rebuild and review it before exporting.')
        # Compiler metadata records Keccak-256, which differs from Python SHA3-256.
        actual_keccak = subprocess.run([cast, 'keccak', '0x' + content.hex()], capture_output=True, text=True, check=True, env=environment, timeout=15).stdout.strip().lower()
        require(actual_keccak == metadata.get('sources', {}).get(name, {}).get('keccak256'), f'Compiled artifact is stale for {name}.')

    constructors = [item for item in abi if item.get('type') == 'constructor']
    require(len(constructors) == 1, 'Expected one constructor.')
    require(constructors[0].get('stateMutability') == 'nonpayable', 'Constructor must not receive an entry payment.')
    require([(item.get('name'), item.get('type')) for item in constructors[0].get('inputs', [])] == [('initialOwner', 'address'), ('initialOracle', 'address'), ('appRecipient', 'address')], 'Unexpected constructor arguments.')

    creation = normalize_bytecode(artifact.get('bytecode'), 'Creation bytecode')
    runtime = normalize_bytecode(artifact.get('deployedBytecode'), 'Runtime bytecode')
    creation_size = (len(creation) - 2) // 2
    runtime_size = (len(runtime) - 2) // 2
    require(creation_size == manifest.get('creationBytecodeBytes'), 'Creation bytecode size differs from reviewed build.')
    require(runtime_size == manifest.get('runtimeBytecodeBytes') and runtime_size <= 24576, 'Runtime bytecode size differs from reviewed build or exceeds deployment limit.')

    references = artifact['deployedBytecode'].get('immutableReferences', {})
    require(isinstance(references, dict) and len(references) == 1, 'Expected only the platform-recipient immutable.')
    immutable_id, ranges = next(iter(references.items()))
    require(isinstance(ranges, list) and len(ranges) > 0, 'Missing immutable offsets.')
    normalized_ranges = []
    for item in ranges:
        start, length = item.get('start'), item.get('length')
        require(isinstance(start, int) and start >= 0 and length == 32 and start + length <= runtime_size, 'Invalid immutable reference range.')
        require(runtime[2 + 2 * start:2 + 2 * (start + length)] == '00' * length, 'Unexpected immutable placeholder contents.')
        normalized_ranges.append({'start': start, 'length': length})
    normalized_ranges.sort(key=lambda item: item['start'])
    require(all(a['start'] + a['length'] <= b['start'] for a, b in zip(normalized_ranges, normalized_ranges[1:])), 'Overlapping immutable reference ranges.')

    output = {
        'artifactVersion': 1,
        'contractName': CONTRACT,
        'chainId': '0x4cef52',
        'chainName': 'Arc Testnet',
        'compiler': COMPILER,
        'compilerSettings': {'evmVersion': 'cancun', 'optimizer': {'enabled': True, 'runs': 200}, 'viaIR': False},
        'bytecode': creation,
        'deployedBytecode': runtime,
        'abi': abi,
        'sourceSha256': expected_sources,
        'abiSha256': manifest['abiSha256'],
        'bytecodeSha256': hashlib.sha256(bytes.fromhex(creation[2:])).hexdigest(),
        'creationBytecodeBytes': creation_size,
        'runtimeBytecodeBytes': runtime_size,
        'immutableArgument': 'appRecipient',
        'immutableIdentifier': immutable_id,
        'immutableReferences': normalized_ranges,
    }
    destination = ROOT.parent / 'frontend/deploy-contract.json'
    destination.parent.mkdir(exist_ok=True)
    temporary = destination.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(output, indent=2) + '\n')
    temporary.replace(destination)
    print(f'Exported reviewed {CONTRACT} deployment artifact ({creation_size} creation bytes). No transaction was sent.')


if __name__ == '__main__':
    try:
        export()
    except (ValueError, OSError, json.JSONDecodeError, subprocess.SubprocessError) as error:
        print(f'Deployment export refused: {error}', file=sys.stderr)
        sys.exit(1)
