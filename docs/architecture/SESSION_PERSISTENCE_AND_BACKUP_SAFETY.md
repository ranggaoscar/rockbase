# Session Persistence and Backup Safety

This document outlines how ROCK BASE handles session persistence for social media accounts and the safety measures in place for data backup and recovery.

## 1. Session Persistence Mechanism

### Where are sessions stored?

Unlike some applications that store session data in individual files (e.g., JSON), ROCK BASE stores all session and cookie data directly within the main application database: `backend/dev.db`.

- **Table:** `SocialAccount`
- **Column:** `cookies`

This data is **encrypted** before being written to the database, ensuring that sensitive session tokens are not stored in plain text.

### How is a session saved?

The `Save Session` functionality, whether triggered manually from the UI or automatically by certain backend processes, involves the following steps:

1.  Playwright extracts the current cookies from the active browser context for a given account.
2.  The array of cookie objects is serialized into a JSON string.
3.  This JSON string is encrypted using the application's secret key (`ENCRYPTION_KEY`).
4.  The resulting encrypted string is saved to the `cookies` column in the `SocialAccount` table for that specific account.

### How is a session restored?

When a new browser context is needed for an account, the `BrowserManager` performs the reverse process:

1.  It retrieves the encrypted `cookies` string from the database.
2.  It decrypts the string back into a JSON array of cookie objects.
3.  It adds these cookies to the newly created Playwright browser context.

This allows the browser context to start with the user already logged in, preserving the session across application restarts.

### **Potential Issue: Lack of Graceful Shutdown**

Currently, if the Node.js application is terminated abruptly (e.g., `Ctrl+C` in the terminal without a proper shutdown handler), there is no guarantee that in-memory session data from active browser contexts is saved to the database. This is a likely reason for sessions not persisting during development restarts.

A proper graceful shutdown implementation would be needed to ensure all active sessions are saved before the process exits. **This is a planned future improvement.**

## 2. Backup and Recovery

### What is backed up?

The backup process is designed to protect the most critical application data.

**Included in Backups:**
- `dev.db`: The entire SQLite database, which includes:
  - All user accounts
  - All social media accounts
  - **All encrypted session cookies**
  - All warming, posting, and campaign data
- `uploads/`: Any files uploaded via the application.

**NOT Included in Backups:**
- `logs/`: Application log files are not backed up.
- `node_modules/`: Dependencies can be reinstalled.
- `.env`: Environment configuration is machine-specific.

### How do backups work?

- **Location:** Backups are stored in the `backend/backups/` directory.
- **Format:** Each backup is a timestamped folder (e.g., `backup-2026-05-12T12-00-00`), containing a copy of `dev.db` and the `uploads` directory.
- **Automation:** Backups run automatically every 24 hours.
- **Manual Trigger:** You can trigger a backup manually by running:
  ```bash
  cd backend
  npm run migrate-safe 
  ```
  (This runs the backup before migrating)
- **Rotation:** The system automatically keeps the last 7 backups and deletes older ones.

### How to Restore?

The `restore-data.ts` script is designed for safely restoring data into a newly migrated database. It is not a full-system restore but a data-level copy. For a full restore, you would manually copy the `dev.db` file from a backup folder.

## 3. Developer Safety Rules

To ensure data and session integrity during development, follow these critical rules:

1.  **NEVER delete `dev.db` or the `uploads/` folder.** These contain all your accounts, sessions, and uploaded media. If you need to start fresh, move them to a temporary location instead of deleting.
2.  **DO NOT commit `dev.db`, `uploads/`, or `.env` to Git.** The `.gitignore` file is configured to prevent this, but do not force-add these files.
3.  **Use the `npm run migrate-safe` script.** When you need to apply database migrations, this script automatically backs up your data before applying changes, providing a safety net.
4.  **Do not run `prisma migrate reset`** unless you have a verified, recent backup and are prepared to restore it manually. This command will permanently delete your database.
