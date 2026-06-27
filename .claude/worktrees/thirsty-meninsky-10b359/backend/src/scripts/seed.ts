import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@socialcommand.com';
  const password = process.env.SEED_ADMIN_PASSWORD || 'Admin@123';

  console.log('=== SocialCommand Seed ===');

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

  // 2. Upsert admin user
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`✔ Admin user already exists: ${email}`);
  } else {
    const hash = await bcrypt.hash(password, 10);
    await prisma.user.create({
      data: { email, password: hash, name: 'Admin', role: 'Admin' },
    });
    console.log(`✔ Admin user created: ${email} / ${password}`);
  }

  console.log('\n✅ Database seeded successfully!');
  console.log(`\nLogin credentials:\n  Email:    ${email}\n  Password: ${password}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
