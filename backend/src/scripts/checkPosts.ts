import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const posts = await prisma.post.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, status: true, results: true }
  });
  console.log(posts);
}
main().finally(() => prisma.$disconnect());
