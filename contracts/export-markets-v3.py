#!/usr/bin/env python3
"""Export V3 ABI, reviewed compiler artifact and self-contained Remix source."""
import hashlib,json,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent
subprocess.run(['forge','build','--offline','--use','.tools/solc-0.8.28'],cwd=root,check=True,stdout=subprocess.DEVNULL)
artifact=json.loads((root/'out/MusicPredictionMarketsV3.sol/MusicPredictionMarketsV3.json').read_text())
metadata=json.loads(artifact['rawMetadata']);settings=metadata['settings']
assert metadata['compiler']['version']=='0.8.28+commit.7893614a'
assert settings['optimizer']=={'enabled':True,'runs':200} and settings['evmVersion']=='cancun' and not settings.get('viaIR',False)
assert not settings.get('libraries') and not artifact['deployedBytecode'].get('linkReferences')
assert len(artifact['deployedBytecode']['object'].removeprefix('0x'))//2<=24576
abi=json.dumps(artifact['abi'],indent=2)+'\n'
(root/'abi/MusicPredictionMarketsV3.json').write_text(abi)
sha=lambda data:hashlib.sha256(data).hexdigest()
output={'marketModelVersion':3,'chainId':5042002,'compiler':'0.8.28','optimizer':{'enabled':True,'runs':200},'evmVersion':'cancun','viaIR':False,'runtimeBytes':len(artifact['deployedBytecode']['object'].removeprefix('0x'))//2,'abiSha256':sha(abi.encode()),'sourceSha256':{name:sha((root/name).read_bytes()) for name in ['src/MusicPredictionMarketsV3.sol','src/RewardCurve.sol']},'abi':artifact['abi'],'bytecode':artifact['bytecode'],'deployedBytecode':artifact['deployedBytecode']}
(root/'deployments/arc-testnet-markets-v3-artifact.json').write_text(json.dumps(output,indent=2)+'\n')
flattened=subprocess.check_output(['forge','flatten','src/MusicPredictionMarketsV3.sol'],cwd=root,text=True)
remix=root.parent/'remix';remix.mkdir(exist_ok=True)
(remix/'MusicPredictionMarketsV3.sol').write_text(flattened)
print(f'Exported V3: {output["runtimeBytes"]} runtime bytes, {len(artifact["abi"])} ABI items.')
