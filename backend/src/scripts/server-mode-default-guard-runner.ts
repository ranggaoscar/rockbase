/**
 * Runner used by server-default-guard-test.ts. Executes the Server Mode
 * default-credential guard exactly as server.ts/worker.ts would and exits
 * 0 only when the guard passes. On refusal the guard itself exits 1.
 */
import { assertServerModeDefaultCredentialGuard } from '../utils/serverDefaultCredentialGuard';

void assertServerModeDefaultCredentialGuard().then(() => process.exit(0)).catch((error) => {
  console.error('[ServerModeGuard] Preflight crashed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
