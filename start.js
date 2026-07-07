/**
 * ROCK BASE — Single-command launcher
 * =====================================
 * Runs backend + frontend in parallel.
 * Cross-platform: Windows, Mac, Linux.
 *
 * Usage:
 *   node start.js
 *
 * No Docker required. No extra installs.
 * Press Ctrl+C to stop everything.
 */

const { spawn } = require('child_process');
const path = require('path');

const ROOT = __dirname;

// ── Colors ──────────────────────────────────────────────────────
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function prefix(tag, color) {
  return `${color}[${tag}]${colors.reset}`;
}

// ── Check Redis ─────────────────────────────────────────────────
async function checkRedis() {
  return new Promise((resolve) => {
    const proc = spawn('redis-cli', ['ping'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
    });
    let output = '';
    proc.stdout.on('data', (d) => (output += d.toString()));
    proc.on('close', (code) => {
      resolve(code === 0 && output.trim() === 'PONG');
    });
    proc.on('error', () => resolve(false));
  });
}

// ── Spawn helper ────────────────────────────────────────────────
function run(name, cwd, command, args, color) {
  const proc = spawn(command, args, {
    cwd: path.join(ROOT, cwd),
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
    env: {
      ...process.env,
      PORT: name === 'backend' ? '3010' : process.env.PORT,
      FRONTEND_URL: 'http://localhost:5173',
      BACKEND_URL: 'http://localhost:3010',
      RUN_WORKERS_SEPARATELY: 'false',
      NODE_ENV: 'development',
    },
  });

  proc.stdout.on('data', (data) => {
    data
      .toString()
      .split('\n')
      .filter(Boolean)
      .forEach((line) => console.log(`${prefix(name, color)} ${line}`));
  });

  proc.stderr.on('data', (data) => {
    data
      .toString()
      .split('\n')
      .filter(Boolean)
      .forEach((line) =>
        console.error(`${prefix(name, colors.red)} ${line}`)
      );
  });

  proc.on('close', (code) => {
    console.log(
      `${prefix(name, color)} ${colors.dim}exited with code ${code}${colors.reset}`
    );
  });

  return proc;
}

// ── Main ────────────────────────────────────────────────────────
(async () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║        🪨  ROCK BASE Launcher        ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');

  // Check Redis
  const redisAvailable = await checkRedis();
  if (redisAvailable) {
    console.log(`${prefix('redis', colors.green)} Redis is running ✓`);
  } else {
    console.log(
      `${prefix('redis', colors.yellow)} Redis not found — queue jobs will fail`
    );
    console.log(
      `  ${colors.dim}Install Redis or start it: redis-server${colors.reset}`
    );
  }
  console.log('');

  // Start processes
  const backend = run('backend', 'backend', 'npm', ['run', 'dev'], colors.cyan);
  const frontend = run(
    'frontend',
    'frontend',
    'npm',
    ['run', 'dev'],
    colors.magenta
  );

  console.log(`${prefix('info', colors.blue)} Backend  → http://localhost:3010`);
  console.log(`${prefix('info', colors.blue)} Frontend → http://localhost:5173`);
  console.log(`${prefix('info', colors.blue)} Login    → admin@rockbase.com / Admin@123`);
  console.log(
    `${prefix('info', colors.dim)} Press Ctrl+C to stop all processes${colors.reset}`
  );
  console.log('');

  // Graceful shutdown
  function shutdown() {
    console.log(`\n${prefix('info', colors.yellow)} Shutting down...`);
    backend.kill('SIGTERM');
    frontend.kill('SIGTERM');
    setTimeout(() => process.exit(0), 2000);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();
