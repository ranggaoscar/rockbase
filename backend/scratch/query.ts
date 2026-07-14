import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const accounts = await prisma.socialAccount.findMany({
    where: { username: { in: ['anditeknologi', 'linea.urban', 'tomsikaya', 'sketsa_struktur'] } }
  });
  console.log(JSON.stringify(accounts, null, 2));

  // Find the latest post for tomsikaya
  const tomsikayaAccount = accounts.find(a => a.username === 'tomsikaya');
  if (tomsikayaAccount) {
    const posts = await prisma.post.findMany({
      where: { accountIds: { contains: tomsikayaAccount.id } },
      orderBy: { createdAt: 'desc' },
      take: 1
    });
    console.log("TOMSIKAYA LATEST POST:", JSON.stringify(posts, null, 2));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
