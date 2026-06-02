const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const failedPosts = await prisma.post.findMany({
    where: { status: 'failed' },
    orderBy: { createdAt: 'desc' },
    take: 5
  });

  console.log('--- Latest Failed Posts ---');
  failedPosts.forEach(post => {
    console.log(`ID: ${post.id}`);
    console.log(`Status: ${post.status}`);
    console.log(`Results: ${post.results}`);
    console.log(`Created At: ${post.createdAt}`);
    console.log('---------------------------');
  });
  process.exit(0);
}

main();
