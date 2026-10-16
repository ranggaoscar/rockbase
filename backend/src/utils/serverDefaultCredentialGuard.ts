import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { getRockBaseMode } from '../middleware/runtimeMode';

/**
 * Passwords this project previously shipped publicly. They exist here only
 * as a detection denylist for the Server Mode startup preflight. They must
 * never be used for login, seeding or configuration.
 */
export const SHIPPED_DEFAULT_PASSWORDS = ['Admin@123'];

export async function findDefaultCredentialUserIds(
  users: Array<{ id: string; password: string }>,
): Promise<string[]> {
  const flagged: string[] = [];
  for (const user of users) {
    for (const candidate of SHIPPED_DEFAULT_PASSWORDS) {
      if (user.password && await bcrypt.compare(candidate, user.password)) {
        flagged.push(user.id);
        break;
      }
    }
  }
  return flagged;
}

/**
 * Server Mode must refuse to start while any dashboard account still
 * accepts a previously shipped default password (owner decision).
 * Local Mode stays passwordless and has no account prerequisite.
 * The check is read-only and never prints account details or credentials.
 */
export async function assertServerModeDefaultCredentialGuard(): Promise<void> {
  if (getRockBaseMode() !== 'server') return;
  const prisma = new PrismaClient();
  let users: Array<{ id: string; password: string }> = [];
  try {
    users = await prisma.user.findMany({ select: { id: true, password: true } });
  } catch {
    console.error('[ServerModeGuard] Database credential verification unavailable; refusing Server Mode start (fail-closed).');
    process.exit(1);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
  const flagged = await findDefaultCredentialUserIds(users);
  if (flagged.length > 0) {
    console.error('[ServerModeGuard] Server Mode cannot start while dashboard accounts still accept a previously shipped default password.');
    console.error('[ServerModeGuard] Start Local Mode instead, or change affected credentials with scripts/change-admin-password.ps1. Account details are not printed.');
    process.exit(1);
  }
  console.log(`[ServerModeGuard] Default-credential preflight passed for ${users.length} dashboard account(s).`);
}
