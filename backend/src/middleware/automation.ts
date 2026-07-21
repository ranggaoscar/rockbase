import type { NextFunction, Request, Response } from 'express';

export const AUTOMATION_DISABLED_MESSAGE =
  'Automation is disabled. Set AUTOMATION_ENABLED=true only in an approved environment.';

export function isAutomationEnabled(): boolean {
  return process.env.AUTOMATION_ENABLED === 'true';
}

export class AutomationDisabledError extends Error {
  constructor() {
    super(AUTOMATION_DISABLED_MESSAGE);
    this.name = 'AutomationDisabledError';
  }
}

export function assertAutomationEnabled(): void {
  if (!isAutomationEnabled()) {
    throw new AutomationDisabledError();
  }
}

export function automationGuard(_req: Request, res: Response, next: NextFunction): void {
  if (!isAutomationEnabled()) {
    res.status(503).json({
      error: 'AUTOMATION_DISABLED',
      message: AUTOMATION_DISABLED_MESSAGE,
    });
    return;
  }

  next();
}

if (require.main === module) {
  const original = process.env.AUTOMATION_ENABLED;

  delete process.env.AUTOMATION_ENABLED;
  if (isAutomationEnabled()) throw new Error('Missing flag must disable automation');

  process.env.AUTOMATION_ENABLED = 'false';
  if (isAutomationEnabled()) throw new Error('false must disable automation');

  process.env.AUTOMATION_ENABLED = 'true';
  if (!isAutomationEnabled()) throw new Error('true must enable automation');

  if (original === undefined) delete process.env.AUTOMATION_ENABLED;
  else process.env.AUTOMATION_ENABLED = original;

  console.log('Automation switch self-check passed');
}
