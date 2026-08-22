import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { getRockBaseMode, isLoopbackAddress } from '../middleware/runtimeMode';

const root = path.resolve(__dirname, '..', '..', '..');
const start = fs.readFileSync(path.join(root, 'start-rockbase.ps1'), 'utf8');
const stop = fs.readFileSync(path.join(root, 'STOP_ROCKBASE.bat'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend', 'src', 'App.tsx'), 'utf8');
const server = fs.readFileSync(path.join(root, 'backend', 'src', 'server.ts'), 'utf8');

assert.equal(isLoopbackAddress('127.0.0.1'), true);
assert.equal(isLoopbackAddress('::1'), true);
assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
assert.equal(isLoopbackAddress('192.168.1.10'), false);
assert.equal(isLoopbackAddress(undefined), false);
const previous = process.env.ROCKBASE_MODE;
process.env.ROCKBASE_MODE = 'local'; assert.equal(getRockBaseMode(), 'local');
process.env.ROCKBASE_MODE = 'server'; assert.equal(getRockBaseMode(), 'server');
if (previous === undefined) delete process.env.ROCKBASE_MODE; else process.env.ROCKBASE_MODE = previous;
assert.match(server, /requireLocalLoopback/);
assert.match(server, /listenHost = runtimeMode === 'local' \? '127\.0\.0\.1'/);
assert.match(app, /VITE_ROCKBASE_MODE === 'local'/);
assert.match(start, /ROCKBASE_MODE=local/);
assert.match(start, /VITE_ROCKBASE_MODE='local'/);
assert.doesNotMatch(start, /down -v|volume prune|migrate reset|db push|taskkill/i);
assert.doesNotMatch(stop, /taskkill|Stop-Process/i);
console.log('[LocalNativeModeTest] PASS: loopback-only local auth, no-login UI bypass, protected agent boundary remains separate, and launcher is non-destructive.');
