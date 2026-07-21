import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

export async function resetStagingAdmin(
  prisma: Pick<PrismaClient, 'user'>,
  email: string | undefined = process.env.STAGING_ADMIN_EMAIL,
  password: string | undefined = process.env.STAGING_ADMIN_PASSWORD,
) {
  if (!email?.trim() || !password) throw new Error('STAGING_ADMIN_EMAIL and STAGING_ADMIN_PASSWORD are required');
  const targetEmail = email.trim().toLowerCase();
  const admins = await prisma.user.findMany({ where: { role: 'Admin' }, select: { id: true, email: true } });
  if (admins.length !== 1) throw new Error(`Expected exactly one Admin user; found ${admins.length}`);
  const conflict = await prisma.user.findFirst({ where: { email: targetEmail, NOT: { id: admins[0].id } }, select: { id: true } });
  if (conflict) throw new Error('STAGING_ADMIN_EMAIL is already used by another user');
  const passwordHash = await bcrypt.hash(password, 12);
  return prisma.user.update({ where: { id: admins[0].id }, data: { email: targetEmail, password: passwordHash }, select: { id: true, email: true, role: true } });
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const updated = await resetStagingAdmin(prisma);
    console.log(`Staging admin updated: ${updated.email}`);
  } catch (error: any) {
    console.error(error.message || 'Staging admin update failed');
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
if (require.main === module) void main();
