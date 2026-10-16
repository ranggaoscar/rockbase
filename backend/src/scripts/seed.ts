import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 16 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Set SEED_ADMIN_EMAIL and a unique SEED_ADMIN_PASSWORD of at least 16 characters. No default credentials are provided.');
  }

  console.log('=== ROCK BASE Seed ===');

  // 1. Ensure a default workspace exists (required FK for SocialAccount)
  let workspace = await (prisma as any).workspace.findUnique({ where: { id: 'workspace-default' } });
  if (!workspace) {
    workspace = await (prisma as any).workspace.create({
      data: { id: 'workspace-default', name: 'Default Workspace' },
    });
    console.log(`✔ Workspace created: ${workspace.name}`);
  } else {
    console.log(`✔ Workspace already exists: ${workspace.name}`);
  }

  // 2. Create only; never overwrite an existing operator's credential.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('✔ Existing admin preserved; no password changed.');
  } else {
    const hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, password: hash, name: 'Admin', role: 'Admin' },
    });
    await prisma.workspaceUser.create({ data: { userId: user.id, workspaceId: workspace.id } });
    console.log('✔ Administrator created with the operator-supplied credential.');
  }

  console.log('\n✅ Database seeded successfully!');
  console.log('Use your operator-supplied credentials; passwords are never printed.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
