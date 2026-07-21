import assert from 'assert';
import bcrypt from 'bcryptjs';
import { resetStagingAdmin } from './reset-staging-admin';

async function main() {
  const calls: any[] = [];
  const prisma: any = { user: {
    findMany: async () => [{ id: 'admin-1', email: 'old@example.invalid' }],
    findFirst: async () => null,
    update: async (args: any) => { calls.push(args); return { id: 'admin-1', email: args.data.email, role: 'Admin' }; },
  } };
  const result = await resetStagingAdmin(prisma, ' New@Example.Invalid ', 'new-password');
  assert.strictEqual(result.email, 'new@example.invalid');
  assert.strictEqual(calls[0].data.email, 'new@example.invalid');
  assert.strictEqual(calls[0].data.role, undefined);
  assert(await bcrypt.compare('new-password', calls[0].data.password));
  await assert.rejects(() => resetStagingAdmin({ user: { findMany: async () => [{ id: '1' }, { id: '2' }] } } as any, 'a@b.invalid', 'x'), /exactly one/);
  await assert.rejects(() => resetStagingAdmin({ user: { findMany: async () => [{ id: '1' }], findFirst: async () => ({ id: '2' }) } } as any, 'a@b.invalid', 'x'), /already used/);
  console.log('Staging admin reset targeted tests passed');
}
main().catch((error) => { console.error(error); process.exit(1); });
