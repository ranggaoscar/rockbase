/**
 * Restore data from dev.db.backup into the newly migrated dev.db
 * Copies: User, Workspace, WorkspaceUser, SocialAccount, Proxy, WarmingLog
 */
import { PrismaClient } from '@prisma/client';
import Database from 'better-sqlite3';
import * as path from 'path';

const prisma = new PrismaClient();
const backupPath = path.join(process.cwd(), 'dev.db.backup');

async function main() {
  console.log('Opening backup database...');
  const backup = new Database(backupPath, { readonly: true });

  // 1. Restore Workspaces
  const workspaces = backup.prepare('SELECT * FROM Workspace').all() as any[];
  console.log(`Found ${workspaces.length} workspaces`);
  for (const w of workspaces) {
    await prisma.workspace.create({
      data: { id: w.id, name: w.name, createdAt: new Date(w.createdAt), updatedAt: new Date(w.updatedAt) },
    }).catch(() => console.log(`  Workspace ${w.id} already exists`));
  }

  // 2. Restore Users
  const users = backup.prepare('SELECT * FROM User').all() as any[];
  console.log(`Found ${users.length} users`);
  for (const u of users) {
    await prisma.user.create({
      data: {
        id: u.id, email: u.email, password: u.password, name: u.name,
        role: u.role, createdAt: new Date(u.createdAt), updatedAt: new Date(u.updatedAt),
      },
    }).catch(() => console.log(`  User ${u.email} already exists`));
  }

  // 3. Restore WorkspaceUser
  const wUsers = backup.prepare('SELECT * FROM WorkspaceUser').all() as any[];
  console.log(`Found ${wUsers.length} workspace-user links`);
  for (const wu of wUsers) {
    await prisma.workspaceUser.create({
      data: { id: wu.id, userId: wu.userId, workspaceId: wu.workspaceId },
    }).catch(() => console.log(`  WorkspaceUser ${wu.id} already exists`));
  }

  // 4. Restore Proxies
  const proxies = backup.prepare('SELECT * FROM Proxy').all() as any[];
  console.log(`Found ${proxies.length} proxies`);
  for (const p of proxies) {
    await prisma.proxy.create({
      data: {
        id: p.id, host: p.host, port: p.port, username: p.username, password: p.password,
        isActive: !!p.isActive, status: p.status, lastChecked: p.lastChecked ? new Date(p.lastChecked) : null,
        location: p.location,
      },
    }).catch(() => console.log(`  Proxy ${p.id} already exists`));
  }

  // 5. Restore SocialAccounts (THE CRITICAL DATA with cookies!)
  const accounts = backup.prepare('SELECT * FROM SocialAccount').all() as any[];
  console.log(`Found ${accounts.length} social accounts`);
  for (const a of accounts) {
    await prisma.socialAccount.create({
      data: {
        id: a.id, workspaceId: a.workspaceId, platform: a.platform, username: a.username,
        accountPassword: a.accountPassword, email: a.email, status: a.status,
        cookies: a.cookies, proxyId: a.proxyId, brandTag: a.brandTag, notes: a.notes,
        warmingDay: a.warmingDay ?? 0, warmingStartDate: a.warmingStartDate ? new Date(a.warmingStartDate) : null,
        lastActive: a.lastActive ? new Date(a.lastActive) : null,
        autoReplyEnabled: !!a.autoReplyEnabled, autoDmEnabled: !!a.autoDmEnabled,
        replyTemplate: a.replyTemplate, dmTemplate: a.dmTemplate,
        createdAt: new Date(a.createdAt), updatedAt: new Date(a.updatedAt),
      },
    }).catch((e: any) => console.log(`  Account @${a.username} error: ${e.message}`));
  }

  // 6. Restore WarmingLogs
  const logs = backup.prepare('SELECT * FROM WarmingLog').all() as any[];
  console.log(`Found ${logs.length} warming logs`);
  for (const l of logs) {
    await prisma.warmingLog.create({
      data: {
        id: l.id, accountId: l.accountId, day: l.day, action: l.action,
        status: l.status, details: l.details, executedAt: new Date(l.executedAt),
      },
    }).catch(() => {});
  }

  backup.close();

  // Verify
  const restoredAccounts = await prisma.socialAccount.findMany();
  const withCookies = restoredAccounts.filter(a => a.cookies);
  console.log(`\n✅ Restore complete!`);
  console.log(`   Accounts: ${restoredAccounts.length}`);
  console.log(`   With saved cookies: ${withCookies.length}`);
  console.log(`   Usernames: ${restoredAccounts.map(a => '@' + a.username).join(', ')}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
