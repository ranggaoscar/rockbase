import { instagramWarmingService } from '../services/InstagramWarmingService';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ACCOUNT_ID = '46311187-bc92-4290-898e-d14554aa8c68'; // @anditeknologi

async function main() {
  console.log('--- Starting Instagram Warming Fix Test ---');
  console.log(`Target Account ID: ${ACCOUNT_ID}`);

  try {
    // We only run a subset for the test to avoid taking too long, 
    // but the user wants "Day 1 automation".
    // Day 1 usually runs follow(5), like(10), watch_reel(10).
    
    const result = await instagramWarmingService.runDaySession(ACCOUNT_ID);
    
    console.log('--- Test Session Complete ---');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

main();
