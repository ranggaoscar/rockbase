import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkCookies() {
  const accounts = await prisma.socialAccount.findMany({
    select: { id: true, username: true, cookies: true }
  });

  console.log('--- Account Cookie Status ---');
  for (const acc of accounts) {
    console.log(`User: ${acc.username} | ID: ${acc.id}`);
    if (acc.cookies) {
      console.log(`  [OK] Cookies found (Length: ${acc.cookies.length})`);
      console.log(`  [Data] Starts with: ${acc.cookies.substring(0, 50)}...`);
    } else {
      console.log('  [MISSING] No cookies in database');
    }
  }
  await prisma.$disconnect();
}

checkCookies();
