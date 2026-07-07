# 🪨 ROCK BASE — Social Media Farm Management Dashboard

ROCK BASE is a local dashboard for managing multiple social media accounts with Farm View, session saving, warming flows, AI-assisted captions, and mass posting queues.

## 🚀 Quick Start (Docker — Recommended)

```bash
# 1. Clone & enter
git clone https://github.com/ranggaoscar/rockbase.git
cd rockbase

# 2. Create environment file
cp backend/.env.example backend/.env
# Edit backend/.env — set JWT_SECRET and ENCRYPTION_KEY at minimum

# 3. Start everything
docker compose up -d
```

Dashboard: **http://localhost:5173**
Default login: `admin@rockbase.com` / `Admin@123`

### Docker Commands

| Command | Description |
|---------|-------------|
| `docker compose up -d` | Start all services |
| `docker compose down` | Stop all services |
| `docker compose logs -f` | View live logs |
| `docker compose --profile worker up -d` | Start with separate worker process |
| `docker compose exec backend npx prisma migrate dev` | Run database migrations |

---

## ✨ New: Cookie Paste — No Playwright Required!

The biggest pain point — adding accounts — is now solved. **You don't need Playwright or a browser tool to add accounts anymore.**

### How to Import Cookies

1. Go to **Account Manager** in the dashboard
2. Click the **`⋯`** menu on any account → **Import Cookies**
3. Export cookies from your browser:
   - **Chrome:** Install EditThisCookie extension → click 🍪 → Export → Copy
   - **Manual:** DevTools → Application → Storage → Cookies → right-click → Export as JSON
4. Paste cookies into ROCK BASE → click **Import Cookies**
5. ✅ Account is instantly ACTIVE and HEALTHY

### Supported Cookie Formats

| Format | Example |
|--------|---------|
| **JSON Array** | `[{"name":"sessionid","value":"abc123","domain":".instagram.com"}]` |
| **Netscape String** | `sessionid=abc123; csrftoken=xyz789;` |
| **EditThisCookie** | Native export from the Chrome extension |

### Bulk Import Cookies

You can also import cookies in bulk via API:

```bash
curl -X POST http://localhost:3010/api/accounts/import-cookies-bulk \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "accounts": [
      { "username": "akun1", "cookies": "[...]" },
      { "username": "akun2", "cookies": "[...]" }
    ]
  }'
```

---

## 📦 Traditional Setup (Without Docker)

### Requirements

- Node.js 18+
- npm
- Redis on `127.0.0.1:6379`

### Windows Quick Start

```bat
SETUP_ROCK_BASE.bat
START_ROCK_BASE.bat
```

### Manual Setup

```bash
# Backend
cd backend
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run seed
npm run dev

# Frontend (another terminal)
cd frontend
npm install
npm run dev
```

Dashboard: **http://localhost:5173**
Default login: `admin@rockbase.com` / `Admin@123`

---

## 🔧 Environment Variables

Copy `backend/.env.example` to `backend/.env` and configure:

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Backend port (default: 3010) |
| `JWT_SECRET` | **Yes** | JWT signing secret — change this |
| `ENCRYPTION_KEY` | **Yes** | AES-256 key — 64 hex characters — change this |
| `DATABASE_URL` | No | SQLite path (default: `file:./dev.db`) |
| `REDIS_HOST` | No | Redis host (default: 127.0.0.1) |
| `REDIS_PORT` | No | Redis port (default: 6379) |
| `GEMINI_API_KEY` | No | Google Gemini for AI captions |
| `OPENAI_API_KEY` | No | OpenAI fallback for AI |

---

## ✨ Features

| Feature | Status | Description |
|---------|--------|-------------|
| **Cookie Import** | ✅ **New** | Paste cookies directly — no Playwright needed |
| **Farm View** | ✅ Working | Real-time monitoring via Playwright screenshots |
| **Remote Control** | ✅ Working | Manual browser control for login & checkpoints |
| **Save Session** | ✅ Working | Encrypted cookies in SQLite |
| **Instagram Warming** | ✅ Working | Human-behavior style warming |
| **Mass Auto Posting** | ✅ Working | Bulk posting with queue & captions |
| **AI Caption Spinner** | ✅ Working | Gemini/OpenAI caption variations |
| **Campaign Engine** | ✅ Working | Automated engagement campaigns |
| **TikTok Automation** | 🚧 Planned | Manual control only for now |
| **PWA / Mobile** | 🚧 Planned | Progressive web app support |

---

## 🐳 Architecture (Docker)

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Frontend    │────▶│  Backend API │────▶│   Redis     │
│  :5173       │     │  :3010       │     │  :6379      │
│  Nginx       │     │  Express     │     │  BullMQ     │
└─────────────┘     │  Prisma      │     └─────────────┘
                    │  Playwright  │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   SQLite     │
                    │  (dev.db)    │
                    └──────────────┘

Optional: docker compose --profile worker up
          ┌──────────────┐
          │  Worker      │
          │  (separate)  │
          └──────────────┘
```

---

## 🔒 Data Safety

- Cookies are encrypted with AES-256 before storage
- Account passwords are encrypted
- `.env`, database files, and sessions are never committed to Git
- Backups are created automatically on startup

## 🛠 Useful Scripts

- `SETUP_ROCK_BASE.bat` — Windows first-time setup
- `CHECK_ROCK_BASE.bat` — System readiness check
- `START_ROCK_BASE.bat` — Start all services (Windows)
- `start.bat` — Simpler development starter

## 📝 Developer Notes

Do not delete these local runtime folders unless you intentionally want to remove local data:

- `backend/dev.db`
- `backend/prisma/dev.db`
- `backend/uploads/`
- `backend/backups/`
- `backend/logs/`

## 🆘 Troubleshooting

**Docker:**
```bash
# Check service status
docker compose ps

# View backend logs
docker compose logs -f backend

# Reset database (WARNING: deletes all data)
docker compose down -v
docker compose up -d
```

**Traditional:**
- Run `CHECK_ROCK_BASE.bat` to verify setup
- Ensure Redis is running: `redis-cli ping` → `PONG`
- Backend health: `curl http://localhost:3010/api/health`
