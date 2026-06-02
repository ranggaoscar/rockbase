# ROCK BASE Dashboard

A powerful web-based dashboard for managing multiple social media "satellite" accounts with real-time phone farm mirroring and AI-powered mass posting.

## 🚀 How to Start

### Prerequisites
1. **Node.js** (v18+)
2. **Redis** (Required for background posting queue)
3. **SQLite** (Bundled, no setup needed)

### Automatic Startup (Windows)
Double-click the `start.bat` file in the root directory. It will launch both the backend and frontend in separate windows.

### Manual Startup
**Backend:**
```bash
cd backend
npm install
npm run dev
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

---

## 🔑 Default Credentials

- **URL:** http://localhost:5173
- **Email:** `admin@rockbase.com`
- **Password:** `Admin@123`

---

## ✨ Features & Status

| Feature | Status | Description |
|:---|:---|:---|
| **Farm View** | ✅ Working | Real-time monitoring of all accounts via Playwright screenshots. |
| **Remote Control** | ✅ Working | Manually control any browser session to handle logins or 2FA. |
| **Save Session** | ✅ Working | Persists cookies to SQLite (encrypted) so you stay logged in. |
| **Instagram Warming** | ✅ Working | 14-day automated "human" behavior (Follow, Like, Reels, Explore). |
| **Mass Auto Posting** | ✅ Working | Bulk post to multiple IG accounts with AI caption variations. |
| **Caption Spinner** | ✅ Working | Uses Gemini AI to spin captions and hashtags per account. |
| **Direct Fallback** | ✅ Working | Posting works even if Redis is down (using background promises). |
| **TikTok Automation** | ⏳ Planned | Currently manual control only; automation coming soon. |

---

## 🛠️ Tech Stack
- **Frontend:** React + Vite + Tailwind CSS + Shadcn UI
- **Backend:** Node.js + Express + Prisma (SQLite)
- **Automation:** Playwright + Stealth Plugin
- **Task Queue:** BullMQ + Redis
- **AI:** Google Gemini (Generative AI)

---

## ⚠️ Developer Notes

**CRITICAL: Do not delete these files/folders during development, as they contain your work:**

- `backend/dev.db` - The main database containing all accounts, posts, and **encrypted sessions**.
- `backend/uploads/` - Contains all media uploaded for posts.
- `backend/backups/` - Contains all backups. If you have an issue, you may need this.

Losing these files will result in the loss of all your accounts and their logged-in sessions.
