import bcrypt from 'bcryptjs';

export class PrismaClient {
  private inMemoryAccounts: any[] = [];
  private inMemoryUsers: any[] = [];
  private inMemoryProxies: any[] = [];
  private inMemoryScheduledPosts: any[] = [];
  private inMemoryWarmingLogs: any[] = [];

  constructor() {
    this.seed();
  }

  public seed() {
    if (this.inMemoryUsers.length === 0) {
      const hash = bcrypt.hashSync('Admin@123', 10);
      this.inMemoryUsers = [
        { id: 'user-1', email: 'admin@rockbase.com', password: hash, name: 'Admin', role: 'Admin', createdAt: new Date(), updatedAt: new Date() },
      ];
    }

    if (this.inMemoryProxies.length === 0) {
      this.inMemoryProxies = [
        { id: 'proxy-1', host: '103.108.177.12', port: 8080, username: 'proxyuser1', password: 'proxypass1', isActive: true, status: 'working', location: 'ID - Jakarta', lastChecked: new Date() },
        { id: 'proxy-2', host: '45.77.142.98',   port: 3128, username: 'proxyuser2', password: 'proxypass2', isActive: true, status: 'working', location: 'ID - Surabaya', lastChecked: new Date() },
        { id: 'proxy-3', host: '202.149.54.111', port: 8000, username: 'proxyuser3', password: 'proxypass3', isActive: true, status: 'slow',    location: 'ID - Bandung',  lastChecked: new Date(Date.now() - 3600000) },
        { id: 'proxy-4', host: '180.250.40.55',  port: 8080, username: 'proxyuser4', password: 'proxypass4', isActive: false, status: 'dead',   location: 'ID - Medan',    lastChecked: new Date(Date.now() - 86400000) },
        { id: 'proxy-5', host: '118.96.193.84',  port: 3128, username: 'proxyuser5', password: 'proxypass5', isActive: true, status: 'working', location: 'ID - Jakarta', lastChecked: new Date() },
      ];
    }

    if (this.inMemoryAccounts.length === 0) {
      this.inMemoryAccounts = [
        { id: '1',  username: 'marmer_jakarta_1', platform: 'Instagram', status: 'active',     warmingDay: 14, brandTag: 'brand_marmer',   email: 'marmer1@gmail.com', proxyId: 'proxy-1', lastActive: new Date(Date.now() - 7200000),   notes: null, createdAt: new Date(Date.now() - 30*86400000) },
        { id: '2',  username: 'granit_indo_1',    platform: 'TikTok',    status: 'active',     warmingDay: 14, brandTag: 'brand_granit',   email: 'granit1@gmail.com', proxyId: 'proxy-2', lastActive: new Date(Date.now() - 18000000),  notes: null, createdAt: new Date(Date.now() - 25*86400000) },
        { id: '3',  username: 'marmer_premium',   platform: 'Instagram', status: 'warming_up', warmingDay: 7,  brandTag: 'brand_marmer',   email: 'marmer2@gmail.com', proxyId: 'proxy-3', lastActive: new Date(Date.now() - 86400000),  notes: null, createdAt: new Date(Date.now() - 7*86400000) },
        { id: '4',  username: 'batu_alam_id',     platform: 'TikTok',    status: 'warming_up', warmingDay: 3,  brandTag: 'brand_batu_alam', email: null,               proxyId: null,      lastActive: new Date(Date.now() - 172800000), notes: null, createdAt: new Date(Date.now() - 3*86400000) },
        { id: '5',  username: 'granit_tiles_ig',  platform: 'Instagram', status: 'idle',       warmingDay: 14, brandTag: 'brand_granit',   email: 'granit2@gmail.com', proxyId: 'proxy-5', lastActive: new Date(Date.now() - 259200000), notes: null, createdAt: new Date(Date.now() - 20*86400000) },
        { id: '6',  username: 'marmer_mewah',     platform: 'Instagram', status: 'error',      warmingDay: 14, brandTag: 'brand_marmer',   email: 'marmer3@gmail.com', proxyId: null,      lastActive: new Date(Date.now() - 604800000), notes: 'Account flagged after bulk follow', createdAt: new Date(Date.now() - 45*86400000) },
        { id: '7',  username: 'batu_alam_official', platform: 'TikTok', status: 'active',      warmingDay: 14, brandTag: 'brand_batu_alam', email: 'batu1@gmail.com',  proxyId: 'proxy-1', lastActive: new Date(Date.now() - 3600000),  notes: null, createdAt: new Date(Date.now() - 28*86400000) },
        { id: '8',  username: 'granit_premium_id', platform: 'Instagram', status: 'warming_up', warmingDay: 11, brandTag: 'brand_granit',  email: 'granit3@gmail.com', proxyId: 'proxy-2', lastActive: new Date(Date.now() - 43200000), notes: null, createdAt: new Date(Date.now() - 11*86400000) },
        { id: '9',  username: 'marmer_id_official', platform: 'TikTok', status: 'active',      warmingDay: 14, brandTag: 'brand_marmer',   email: 'marmer4@gmail.com', proxyId: 'proxy-5', lastActive: new Date(Date.now() - 5400000),  notes: null, createdAt: new Date(Date.now() - 35*86400000) },
        { id: '10', username: 'batu_alam_premium', platform: 'Instagram', status: 'warming_up', warmingDay: 5, brandTag: 'brand_batu_alam', email: null,               proxyId: null,      lastActive: new Date(Date.now() - 108000000), notes: null, createdAt: new Date(Date.now() - 5*86400000) },
      ];
    }
  }

  user = {
    findUnique: async (args: any): Promise<any> => {
      const { where } = args || {};
      if (where?.email) return this.inMemoryUsers.find(u => u.email === where.email) || null;
      if (where?.id)    return this.inMemoryUsers.find(u => u.id === where.id) || null;
      return null;
    },
    findFirst: async (): Promise<any> => this.inMemoryUsers[0] || null,
    create: async (args: any) => {
      const u = { id: `user-${Date.now()}`, ...args.data, createdAt: new Date(), updatedAt: new Date() };
      this.inMemoryUsers.push(u);
      return u;
    },
    findMany: async () => this.inMemoryUsers,
  };

  socialAccount = {
    findMany: async (args?: any): Promise<any[]> => {
      let list = [...this.inMemoryAccounts];
      if (args?.take) list = list.slice(0, args.take);
      return list;
    },
    findUnique: async (args?: any): Promise<any> => {
      const id = args?.where?.id;
      return this.inMemoryAccounts.find(a => a.id === id) || null;
    },
    update: async (args: any) => {
      const id = args?.where?.id;
      const idx = this.inMemoryAccounts.findIndex(a => a.id === id);
      if (idx > -1) this.inMemoryAccounts[idx] = { ...this.inMemoryAccounts[idx], ...args.data };
      return this.inMemoryAccounts[idx];
    },
    create: async (args: any) => {
      const a = { id: `acc-${Date.now()}`, ...args.data, createdAt: new Date(), updatedAt: new Date() };
      this.inMemoryAccounts.push(a);
      return a;
    },
    delete: async (args: any) => {
      const id = args?.where?.id;
      this.inMemoryAccounts = this.inMemoryAccounts.filter(a => a.id !== id);
    },
    count: async () => this.inMemoryAccounts.length,
  };

  proxy = {
    findMany: async (): Promise<any[]> => [...this.inMemoryProxies],
    findUnique: async (args: any): Promise<any> => {
      const id = args?.where?.id;
      return this.inMemoryProxies.find(p => p.id === id) || null;
    },
    create: async (args: any) => {
      const p = { id: `proxy-${Date.now()}`, ...args.data };
      this.inMemoryProxies.push(p);
      return p;
    },
    update: async (args: any) => {
      const id = args?.where?.id;
      const idx = this.inMemoryProxies.findIndex(p => p.id === id);
      if (idx > -1) this.inMemoryProxies[idx] = { ...this.inMemoryProxies[idx], ...args.data };
      return this.inMemoryProxies[idx];
    },
    delete: async (args: any) => {
      const id = args?.where?.id;
      this.inMemoryProxies = this.inMemoryProxies.filter(p => p.id !== id);
    },
    count: async () => this.inMemoryProxies.length,
  };

  analytics = {
    create: async (data: any) => ({ id: `analytics-${Date.now()}` }),
    findMany: async () => [],
  };

  post = {
    create: async (data: any) => ({ id: `post-${Date.now()}` }),
    update: async (args?: any) => {},
    findMany: async (args?: any) => [],
    findUnique: async (): Promise<any> => ({ content: 'mock', mediaUrls: [] }),
    count: async () => 0,
  };

  warmingLog = {
    create: async (args: any) => {
      const log = { id: `wl-${Date.now()}`, ...args.data, createdAt: new Date() };
      this.inMemoryWarmingLogs.push(log);
      return log;
    },
    findMany: async (args?: any) => {
      if (args?.where?.accountId) {
        return this.inMemoryWarmingLogs.filter(l => l.accountId === args.where.accountId);
      }
      return [...this.inMemoryWarmingLogs];
    },
    count: async () => this.inMemoryWarmingLogs.length,
  };

  scheduledPost = {
    findMany: async (args?: any): Promise<any[]> => {
      let list = [...this.inMemoryScheduledPosts];
      if (args?.where?.status) list = list.filter(p => p.status === args.where.status);
      // Sort by scheduledAt ascending
      list.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
      return list;
    },
    findUnique: async (args: any): Promise<any> => {
      const id = args?.where?.id;
      return this.inMemoryScheduledPosts.find(p => p.id === id) || null;
    },
    create: async (args: any) => {
      const p = {
        id: `sched-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ...args.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.inMemoryScheduledPosts.push(p);
      return p;
    },
    update: async (args: any) => {
      const id = args?.where?.id;
      const idx = this.inMemoryScheduledPosts.findIndex(p => p.id === id);
      if (idx > -1) {
        this.inMemoryScheduledPosts[idx] = {
          ...this.inMemoryScheduledPosts[idx],
          ...args.data,
          updatedAt: new Date(),
        };
        return this.inMemoryScheduledPosts[idx];
      }
      return null;
    },
    delete: async (args: any) => {
      const id = args?.where?.id;
      this.inMemoryScheduledPosts = this.inMemoryScheduledPosts.filter(p => p.id !== id);
    },
    count: async (args?: any) => {
      if (args?.where?.status) {
        return this.inMemoryScheduledPosts.filter(p => p.status === args.where.status).length;
      }
      return this.inMemoryScheduledPosts.length;
    },
  };
}
