import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function inspectLogs() {
  console.log('--- LATEST 20 ENGAGEMENT LOGS ---');
  const logs = await prisma.engagementLog.findMany({
    orderBy: { executedAt: 'desc' },
    take: 20,
  });

  if (logs.length === 0) {
    console.log('No engagement logs found.');
  } else {
    logs.forEach(log => {
      console.log(`[${log.executedAt.toISOString ? log.executedAt.toISOString() : log.executedAt}] Acc: ${log.accountId} | Action: ${log.actionType} | Status: ${log.status} | Details: ${log.details}`);
    });
  }

  console.log('\n--- LATEST 20 ACTIVITY LOGS ---');
  const activityLogs = await prisma.activityLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  if (activityLogs.length === 0) {
    console.log('No activity logs found.');
  } else {
    activityLogs.forEach(log => {
      console.log(`[${log.createdAt.toISOString ? log.createdAt.toISOString() : log.createdAt}] Type: ${log.type} | Action: ${log.action} | Status: ${log.status} | Message: ${log.message}`);
    });
  }

  await prisma.$disconnect();
  process.exit(0);
}

inspectLogs().catch(console.error);
