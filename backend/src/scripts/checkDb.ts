import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkDb() {
  const pendingPosts = await prisma.post.findMany({
    where: { status: 'pending' },
    select: { id: true, content: true, status: true, mediaUrls: true, createdAt: true, accountIds: true }
  });
  
  console.log(`Found ${pendingPosts.length} pending posts in database.`);
  if (pendingPosts.length > 0) {
     console.log('Sample:', JSON.stringify(pendingPosts.slice(0, 3), null, 2));
  }
  
  const pendingVerifyPosts = await prisma.post.findMany({
    where: { status: 'pending_verify' },
  });
  
  console.log(`Found ${pendingVerifyPosts.length} pending_verify posts in database.`);

  const staleSchedulerJobs = await prisma.post.findMany({
    where: { status: 'scheduled' }
  });
  console.log(`Found ${staleSchedulerJobs.length} scheduled posts in database.`);
  
  process.exit(0);
}

checkDb().catch(console.error);
