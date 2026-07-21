export type WorkerMode = 'internal' | 'separate';

export function getWorkerMode(environment = process.env): WorkerMode {
  const value = environment.RUN_WORKERS_SEPARATELY;
  if (value === 'false') return 'internal';
  if (value === 'true') return 'separate';
  throw new Error('RUN_WORKERS_SEPARATELY must be explicitly set to true or false.');
}

export function assertSeparateWorkerMode(environment = process.env): void {
  if (getWorkerMode(environment) !== 'separate') {
    throw new Error('Separate worker requires RUN_WORKERS_SEPARATELY=true.');
  }
}

export function getWorkerStartupPlan(automationEnabled: boolean, mode: WorkerMode): 'disabled' | WorkerMode {
  return automationEnabled ? mode : 'disabled';
}
