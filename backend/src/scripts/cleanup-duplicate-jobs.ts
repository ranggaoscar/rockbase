import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

const args = new Set(process.argv.slice(2));
const confirmed = args.has('--confirm');

function getSha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function main() {
  console.log('=== ROCK BASE Duplicate Post Jobs Audit & Cleanup ===');
  console.log(`Mode: ${confirmed ? '\x1b[31mEXECUTE CLEANUP\x1b[0m' : '\x1b[32mPREVIEW (DRY RUN)\x1b[0m'}`);
  if (!confirmed) {
    console.log('To apply deletions, re-run this script with the \x1b[33m--confirm\x1b[0m flag.\n');
  }

  // 1. Fetch all posts and social accounts (to map username for logging)
  console.log('Retrieving post and account records from database...');
  const posts = await prisma.post.findMany({
    orderBy: { createdAt: 'asc' },
  });

  const accounts = await prisma.socialAccount.findMany({
    select: { id: true, username: true },
  });
  const usernameMap = new Map(accounts.map((a) => [a.id, a.username]));

  console.log(`Found ${posts.length} total posts in database.`);

  // 2. Group posts by duplicate signature: accountId + mediaFilename + contentHash
  const groups = new Map<string, typeof posts>();

  for (const post of posts) {
    let accountId = 'unknown';
    try {
      const parsedAccounts = JSON.parse(post.accountIds);
      accountId = parsedAccounts[0] || 'unknown';
    } catch {
      // Fallback if not JSON format
      accountId = post.accountIds || 'unknown';
    }

    let mediaFilename = 'none';
    try {
      const parsedMedia = JSON.parse(post.mediaUrls);
      mediaFilename = parsedMedia[0] || 'none';
    } catch {
      mediaFilename = post.mediaUrls || 'none';
    }

    const normContent = post.content.replace(/\r\n/g, '\n').trim();
    const contentHash = getSha256(normContent);

    // Signature formula
    const signature = [accountId, mediaFilename, contentHash].join('|');

    if (!groups.has(signature)) {
      groups.set(signature, []);
    }
    groups.get(signature)!.push(post);
  }

  // 3. Analyze groups and identify duplicates to delete
  let totalDuplicateGroups = 0;
  let totalPostsToDelete: string[] = [];

  console.log('\n--- Analyzing Duplicate Groups ---');

  for (const [signature, groupPosts] of groups.entries()) {
    if (groupPosts.length <= 1) continue;

    totalDuplicateGroups++;
    const [accountId, mediaFilename] = signature.split('|');
    const username = usernameMap.get(accountId) || accountId;

    console.log(`\n[Group #${totalDuplicateGroups}] Account: @${username} | Media: ${mediaFilename}`);
    console.log(`Signature Hash: ${getSha256(signature).slice(0, 10)}... (Caption character count: ${groupPosts[0].content.length})`);

    // Prioritize keeping the successful (published) post, else the oldest pending/scheduled, else the first created post
    let masterPost = groupPosts.find(p => p.status === 'published');
    
    if (!masterPost) {
      // Find oldest pending/scheduled
      masterPost = groupPosts.find(p => p.status === 'pending' || p.status === 'scheduled');
    }

    if (!masterPost) {
      // Fallback to the first created post
      masterPost = groupPosts[0];
    }

    console.log(`  \x1b[32mKEEP MASTER:\x1b[0m ID: ${masterPost.id} | Status: ${masterPost.status} | Created: ${masterPost.createdAt.toISOString()} | Scheduled: ${masterPost.scheduleAt?.toISOString() || 'direct'}`);

    const duplicates = groupPosts.filter((p) => p.id !== masterPost!.id);
    for (const dup of duplicates) {
      console.log(`  \x1b[31mDUPLICATE (TO DELETE):\x1b[0m ID: ${dup.id} | Status: ${dup.status} | Created: ${dup.createdAt.toISOString()} | Scheduled: ${dup.scheduleAt?.toISOString() || 'direct'}`);
      totalPostsToDelete.push(dup.id);
    }
  }

  console.log('\n----------------------------------------');
  console.log(`Summary:`);
  console.log(`- Duplicate Groups Found: ${totalDuplicateGroups}`);
  console.log(`- Total Duplicate Posts Identified for Deletion: ${totalPostsToDelete.length}`);

  if (totalPostsToDelete.length === 0) {
    console.log('\n✅ No duplicate post records found. Database is completely clean!');
    return;
  }

  // 4. Perform actual deletion if --confirm is passed
  if (confirmed) {
    console.log(`\nApplying deletions of ${totalPostsToDelete.length} duplicate post(s) from database...`);
    const deleteResult = await prisma.post.deleteMany({
      where: {
        id: { in: totalPostsToDelete },
      },
    });
    console.log(`\x1b[32mSuccessfully deleted ${deleteResult.count} duplicate post records from the database!\x1b[0m`);
  } else {
    console.log('\n\x1b[33m[Dry Run Complete] No database changes were made. Run with --confirm to delete duplicate post records.\x1b[0m');
  }
}

main()
  .catch((e) => {
    console.error('Error running duplicate posts cleanup:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
