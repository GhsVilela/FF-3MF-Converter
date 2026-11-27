#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [process.env.PYTHON, 'python3', 'python'].filter(Boolean);
let python = null;
for (const candidate of candidates) {
  const probe = spawnSync(candidate, ['-c', 'import sys; print(sys.version_info[0])'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (probe.status === 0) {
    python = candidate;
    break;
  }
}
if (!python) {
  console.error('Python 3 is required to run the OrcaSlicer plugin tests.');
  process.exit(1);
}

const testsDir = path.join(root, 'integrations', 'orcaslicer-plugin', 'tests');
const result = spawnSync(
  python,
  ['-m', 'unittest', 'discover', '-s', testsDir, '-t', testsDir, '-v'],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  },
);
process.exit(result.status ?? 1);
