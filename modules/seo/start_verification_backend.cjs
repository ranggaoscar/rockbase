// Operator verification only: uses existing DB read paths; social automation stays disabled.
const path = require('path');
const backend = path.resolve(__dirname, '../../backend');
process.chdir(backend);
require(path.join(backend, 'node_modules/dotenv')).config({ quiet: true });
Object.assign(process.env, {
  ROCKBASE_MODE: 'local', PORT: '3010', FRONTEND_URL: 'http://127.0.0.1:5173',
  RUN_WORKERS_SEPARATELY: 'true', AUTOMATION_ENABLED: 'false',
  REDIS_HOST: '127.0.0.1', REDIS_PORT: '16379',
  // Prevent existing startup retention from deleting operator diagnostic evidence during QA.
  LOG_RETENTION_DAYS: '36500', LOG_MAX_SIZE_MB: '100000',
});
require(path.join(backend, 'node_modules/ts-node')).register({ transpileOnly: true, project: path.join(backend, 'tsconfig.json') });
require(path.join(backend, 'src/server.ts'));
