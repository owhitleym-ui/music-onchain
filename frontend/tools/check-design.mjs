import { readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  const manifest = JSON.parse(await readFile(new URL('../design/protected-files.json', import.meta.url), 'utf8'));
  if (manifest.version !== 1 || !manifest.files || Object.keys(manifest.files).length < 20) throw Error('Missing or invalid design baseline.');
  const changed = [];
  for (const [name, expected] of Object.entries(manifest.files)) {
    const path = resolve(root, name);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep) || !/^[0-9a-f]{64}$/.test(expected)) throw Error('Invalid protected path or checksum.');
    try {
      if ((await lstat(path)).isSymbolicLink()) throw Error('Unexpected symlink.');
      const actual = createHash('sha256').update(await readFile(path)).digest('hex');
      if (actual !== expected) changed.push(name);
    } catch { changed.push(name); }
  }
  if (changed.length) {
    console.error('Design changes modified protected integration files:\n' + changed.map(name => '- ' + name).join('\n'));
    console.error('Keep design edits in presentation files. Functional changes need a separate integration review; do not regenerate the baseline.');
    process.exitCode = 1;
  } else {
    console.log('Design guard passed: ' + Object.keys(manifest.files).length + ' login, payment, configuration and test files match the reviewed baseline.');
  }
} catch (error) {
  console.error('Design guard could not verify the baseline: ' + error.message);
  process.exitCode = 1;
}
