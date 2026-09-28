export type ExecutionEngineType = 'chromium' | 'android';

export function resolveExecutionEngine(account: { executionEngine?: string | null }): ExecutionEngineType {
  const engine = account.executionEngine ?? 'chromium';
  if (engine !== 'chromium' && engine !== 'android') throw new Error(`Unknown execution engine: ${engine}`);
  return engine;
}

export function requireChromiumEngine(account: { executionEngine?: string | null }): void {
  if (resolveExecutionEngine(account) !== 'chromium') {
    throw new Error('ANDROID_EXECUTION_NOT_IMPLEMENTED: Android account jobs require a future Android worker');
  }
}
