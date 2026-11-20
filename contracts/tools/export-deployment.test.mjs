import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const files = [
  'contracts/export-deployment.py',
  'contracts/abi/build-manifest.json',
  'contracts/abi/MusicPredictionContest.json',
  'contracts/src/MusicPredictionContest.sol',
  'contracts/src/RewardCurve.sol',
  'contracts/out/MusicPredictionContest.sol/MusicPredictionContest.json',
];
const hash = value => createHash('sha256').update(value).digest('hex');

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'music-deployment-export-'));
  try {
    for (const file of files) {
      const destination = join(root, file);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(project, file), destination);
    }
    const read = name => JSON.parse(readFileSync(join(root, name), 'utf8'));
    const write = (name, value) => writeFileSync(join(root, name), JSON.stringify(value, null, 2) + '\n');
    const execute = () => spawnSync('python3', [join(root, 'contracts/export-deployment.py')], { encoding: 'utf8', timeout: 30000 });
    return run({ root, read, write, execute });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function changedArtifact(env, modify) {
  const file = 'contracts/out/MusicPredictionContest.sol/MusicPredictionContest.json';
  const artifact = env.read(file);
  modify(artifact);
  env.write(file, artifact);
}

test('deployment export is reproducible and binds the tested native-USDC contract', () => fixture(env => {
  const first = env.execute();
  assert.equal(first.status, 0, first.stderr);
  const contents = readFileSync(join(env.root, 'frontend/deploy-contract.json'), 'utf8');
  const output = JSON.parse(contents);
  assert.equal(output.artifactVersion, 1);
  assert.equal(output.contractName, 'MusicPredictionContest');
  assert.equal(output.chainId, '0x4cef52');
  assert.equal(output.compiler, '0.8.28+commit.7893614a');
  assert.deepEqual(output.compilerSettings, { evmVersion: 'cancun', optimizer: { enabled: true, runs: 200 }, viaIR: false });
  assert.equal(output.bytecodeSha256, hash(Buffer.from(output.bytecode.slice(2), 'hex')));
  assert.equal(output.creationBytecodeBytes, 22046);
  assert.equal(output.runtimeBytecodeBytes, 21603);
  const constructor = output.abi.find(item => item.type === 'constructor');
  assert.equal(constructor.stateMutability, 'nonpayable');
  assert.deepEqual(constructor.inputs.map(input => [input.name, input.type]), [['initialOwner', 'address'], ['initialOracle', 'address'], ['appRecipient', 'address']]);
  assert.equal(output.immutableArgument, 'appRecipient');
  assert.deepEqual(output.immutableReferences, Object.values(env.read('contracts/out/MusicPredictionContest.sol/MusicPredictionContest.json').deployedBytecode.immutableReferences).flat().sort((a,b)=>a.start-b.start));
  assert.equal(env.execute().status, 0);
  assert.equal(readFileSync(join(env.root, 'frontend/deploy-contract.json'), 'utf8'), contents);
}));

test('deployment export rejects changed source and preserves the last valid artifact', () => fixture(env => {
  assert.equal(env.execute().status, 0);
  const outputPath = join(env.root, 'frontend/deploy-contract.json');
  const original = readFileSync(outputPath, 'utf8');
  writeFileSync(join(env.root, 'contracts/src/RewardCurve.sol'), readFileSync(join(env.root, 'contracts/src/RewardCurve.sol'), 'utf8') + '\n// unreviewed\n');
  const result = env.execute();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Source changed since review/);
  assert.equal(readFileSync(outputPath, 'utf8'), original);
}));

test('deployment export rejects modified public ABI', () => fixture(env => {
  const abi = env.read('contracts/abi/MusicPredictionContest.json');
  abi.pop();
  env.write('contracts/abi/MusicPredictionContest.json', abi);
  assert.match(env.execute().stderr, /ABI does not match/);
  assert.equal(existsSync(join(env.root, 'frontend/deploy-contract.json')), false);
}));

test('deployment export rejects stale compiler source metadata even with matching manifest SHA', () => fixture(env => {
  changedArtifact(env, artifact => {
    const metadata = JSON.parse(artifact.rawMetadata);
    metadata.sources['src/RewardCurve.sol'].keccak256 = '0x' + '0'.repeat(64);
    artifact.rawMetadata = JSON.stringify(metadata);
  });
  const result = env.execute();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /artifact is stale/);
}));

test('deployment export rejects different compiler settings', () => fixture(env => {
  changedArtifact(env, artifact => {
    const metadata = JSON.parse(artifact.rawMetadata);
    metadata.settings.optimizer.runs = 1;
    artifact.rawMetadata = JSON.stringify(metadata);
  });
  assert.match(env.execute().stderr, /Optimizer settings differ/);
}));

test('deployment export refuses unresolved library links and malformed bytecode', () => fixture(env => {
  changedArtifact(env, artifact => { artifact.bytecode.object = '0x60__unlinked__'; });
  const malformed = env.execute();
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /not deployable hexadecimal/);
  copyFileSync(join(project, files.at(-1)), join(env.root, files.at(-1)));
  changedArtifact(env, artifact => { artifact.bytecode.linkReferences = { external: { Library: [{ start: 0, length: 20 }] } }; });
  assert.match(env.execute().stderr, /unresolved library links/);
}));

test('deployment export rejects unsafe immutable offsets', () => fixture(env => {
  changedArtifact(env, artifact => {
    const references = artifact.deployedBytecode.immutableReferences;
    references[Object.keys(references)[0]][0].start = 1000000;
  });
  const result = env.execute();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid immutable reference range/);
}));
