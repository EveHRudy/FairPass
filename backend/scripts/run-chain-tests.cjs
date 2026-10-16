const { spawnSync } = require('node:child_process');
const path = require('node:path');
const cli = path.join(__dirname, '..', 'node_modules', 'vitest', 'vitest.mjs');
const result = spawnSync(process.execPath, [cli, 'run', 'test/chain.integration.test.ts'], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, CHAIN_TESTS: '1' },
  stdio: 'inherit',
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
