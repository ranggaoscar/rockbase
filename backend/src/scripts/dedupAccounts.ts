/**
 * Fix #2: Deduplicate SocialAccount entries before applying UNIQUE constraint.
 *
 * For each (username, platform) pair that has duplicate UUIDs:
 *   - Keep the account with the most recent lastActive timestamp
 *   - If tied, keep the one with cookies/session data
 *   - If still tied, keep the one with lower creation index
 *
 * Run: npx ts-node src/scripts/dedupAccounts.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AccountInfo {
  id: string;
  username: string;
  platform: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  lastActive: Date | null;
  cookies: string | null;
}

async function main() {
  console.log('[Dedup] Scanning duplicate accounts...\n');

  // Find all accounts
  const allAccounts = await prisma.socialAccount.findMany({
    orderBy: [{ username: 'asc' }, { platform: 'asc' }, { createdAt: 'asc' }],
  });

  // Group by (username, platform)
  const groups = new Map<string, AccountInfo[]>();
  const indexed = allAccounts.map((a, i) => ({
    ...a,
    idIndex: i,
  }));

  for (const acc of indexed) {
    const key = `${acc.username}::${acc.platform}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(acc);
  }

  const duplicates = [...groups.entries()].filter(([, v]) => v.length > 1);

  if (duplicates.length === 0) {
    console.log('[Dedup] ✅ No duplicates found. Safe to apply UNIQUE constraint.');
    await prisma.$disconnect();
    return;
  }

  console.log(`[Dedup] Found ${duplicates.length} duplicate username+platform groups:\n`);

  const toDelete: string[] = [];

  for (const [key, accounts] of duplicates) {
    console.log(`  @${key}`);
    for (const a of accounts) {
      console.log(`    ID: ${a.id} | status: ${a.status} | lastActive: ${a.lastActive?.toISOString() || 'never'} | updated: ${a.updatedAt.toISOString()}`);
    }

    // Sort by: has cookies > lastActive recency > updatedAt recency
    const sorted = [...accounts].sort((a, b) => {
      // Prefer accounts with cookies
      const aHasCookies = !!(a.cookies);
      const bHasCookies = !!(b.cookies);
      if (aHasCookies !== bHasCookies) return bHasCookies ? 1 : -1;

      // Prefer more recent lastActive
      if (a.lastActive && b.lastActive) {
        const diff = b.lastActive.getTime() - a.lastActive.getTime();
        if (diff !== 0) return diff > 0 ? 1 : -1;
      }
      if (a.lastActive && !b.lastActive) return -1;
      if (!a.lastActive && b.lastActive) return 1;

      // Prefer more recent update
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });

    const keeper = sorted[0];
    const deletables = sorted.slice(1);
    console.log(`    ➤ KEEP: ${keeper.id} (has cookies: ${!!keeper.cookies}, lastActive: ${keeper.lastActive?.toISOString() || 'N/A'})`);

    for (const d of deletables) {
      console.log(`    ✗ DELETE: ${d.id}`);
      toDelete.push(d.id);
    }
    console.log();
  }

  console.log(`[Dedup] Will delete ${toDelete.length} duplicate account(s).`);
  console.log('[Dedup] Run with --confirm to apply changes.\n');

  // Only delete if --confirm flag is passed
  if (process.argv.includes('--confirm')) {
    console.log('[Dedup] Deleting duplicates...');
    for (const id of toDelete) {
      await prisma.socialAccount.delete({ where: { id } });
      console.log(`  Deleted: ${id}`);
    }
    console.log(`[Dedup] ✅ Done. ${toDelete.length} duplicates removed.`);
    console.log('[Dedup] Now run: npx prisma migrate dev --name add-username-platform-unique');
  } else {
    console.log('[Dedup] Dry run complete. No changes made.');
    console.log('[Dedup] To apply: npx ts-node src/scripts/dedupAccounts.ts --confirm');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
