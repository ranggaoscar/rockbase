import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..', '..', '..');
const setup = fs.readFileSync(path.join(root, 'setup-rockbase.ps1'), 'utf8');
const preflight = fs.readFileSync(path.join(root, 'scripts', 'preflight-upgrade.ps1'), 'utf8');
const envExample = fs.readFileSync(path.join(root, 'backend', '.env.example'), 'utf8');
const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
const upgrade = fs.readFileSync(path.join(root, 'docs', 'UPGRADE.md'), 'utf8');

assert.match(setup, /if \(-not \(Test-Path \$EnvPath\)\)/);
assert.match(setup, /New-HexSecret 32/);
assert.match(setup, /docker compose up -d --build/);
assert.match(setup, /readyz/);
assert.doesNotMatch(setup, /down -v|volume prune|migrate reset|db push/i);
assert.match(preflight, /ENCRYPTION_KEY/);
assert.match(preflight, /\^\[a-fA-F0-9\]\{64\}\$/);
assert.doesNotMatch(preflight, /docker\s+compose\s+up|docker\s+compose\s+down\s+-v|docker\s+volume\s+prune|prisma\s+migrate|Set-Content\s+-Path/i);
assert.match(envExample, /ENCRYPTION_KEY="REPLACE_WITH_64_RANDOM_HEXADECIMAL_CHARACTERS"/);
assert.match(envExample, /DO NOT rotate or replace this key/i);
for (const volume of ['backend-db', 'backend-uploads', 'backend-backups', 'backend-logs', 'redis-data']) {
  assert.match(compose, new RegExp(`^\\s*${volume}:\\s*$`, 'm'));
}
assert.match(compose, /prisma migrate deploy/);
assert.doesNotMatch(compose, /down -v|volume prune|migrate reset|db push/i);
assert.match(upgrade, /Database backup plus the correct [`]?ENCRYPTION_KEY[`]? are both required/i);
assert.match(upgrade, /docker compose down -v/);

console.log('[SelfHostedReleaseReadinessTest] PASS: setup preserves existing env, generated key format is valid, preflight is inspect-only, and normal flows contain no destructive commands.');
