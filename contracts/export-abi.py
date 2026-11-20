#!/usr/bin/env python3
"""Export the public interface from the compiled artifact, never hand-maintain it."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent
artifact = json.loads((root / 'out/MusicPredictionContest.sol/MusicPredictionContest.json').read_text())
target = root / 'abi/MusicPredictionContest.json'
target.parent.mkdir(exist_ok=True)
target.write_text(json.dumps(artifact['abi'], indent=2) + '\n')
print(f'Exported {len(artifact["abi"])} ABI entries to {target.name}')
