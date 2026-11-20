#!/usr/bin/env python3
"""Compile the pasteable Remix file with exact pinned settings and compare runtime."""
import json,subprocess,hashlib
from pathlib import Path
root=Path(__file__).resolve().parent
artifact=json.loads((root/'deployments/arc-testnet-markets-v2-artifact.json').read_text())
for name,expected in artifact['sourceSha256'].items():
 assert hashlib.sha256((root/name).read_bytes()).hexdigest()==expected, 'Source differs from V2 artifact'
source=(root.parent/'remix/MusicPredictionMarketsV2.sol').read_text()
request={'language':'Solidity','sources':{'MusicPredictionMarketsV2.sol':{'content':source}},'settings':{'optimizer':{'enabled':True,'runs':200},'evmVersion':'cancun','viaIR':False,'outputSelection':{'*':{'MusicPredictionMarketsV2':['abi','evm.deployedBytecode']}}}}
r=subprocess.run([str(root/'.tools/solc-0.8.28'),'--standard-json'],input=json.dumps(request),capture_output=True,text=True,check=True)
result=json.loads(r.stdout);errors=[e for e in result.get('errors',[]) if e['severity']=='error'];assert not errors,errors
compiled=result['contracts']['MusicPredictionMarketsV2.sol']['MusicPredictionMarketsV2']
normalize=lambda abi:sorted(json.dumps(item,sort_keys=True) for item in abi)
assert normalize(compiled['abi'])==normalize(artifact['abi']),'Remix ABI mismatch'
def strip(code):
 code=code.removeprefix('0x');return code[:-4-int(code[-4:],16)*2]
assert strip(compiled['evm']['deployedBytecode']['object'])==strip(artifact['deployedBytecode']['object']),'Remix runtime differs from reviewed runtime'
assert artifact['runtimeBytes']<=24576
print(f"Remix verified: identical ABI/runtime, Solidity 0.8.28, optimizer 200, Cancun, {artifact['runtimeBytes']} bytes.")
