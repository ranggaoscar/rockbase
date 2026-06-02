const Database = require('better-sqlite3');
const db = new Database('./dev.db.backup', { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map((t: any) => t.name));
for (const t of tables) {
  if (t.name.startsWith('_')) continue;
  const count = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get() as any;
  console.log(`${t.name}: ${count.c} rows`);
}
db.close();
