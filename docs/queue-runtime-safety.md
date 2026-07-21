# Queue runtime safety

RockBase has two exclusive worker modes: internal (`RUN_WORKERS_SEPARATELY=false`) and separate (`true`). The separate worker exits unless explicitly configured for that mode. With `AUTOMATION_ENABLED=false`, no social worker starts.

Startup never deletes BullMQ jobs. Run reconciliation manually:

```powershell
cd backend
npm run queue:reconcile
```

It reports only: `MISSING_QUEUE_JOB`, `ORPHAN_QUEUE_JOB`, `STRANDED_EXECUTION`, `FAILED_WITH_RECORD`, `STALE_ACTIVE_JOB`, and `NEEDS_VERIFICATION`. It does not retry, enqueue, delete, or alter database state. Unknown and pending verification results require manual review.

Hermes prepares and submits campaigns; RockBase remains the execution engine for queueing, scheduling, human behavior, browser/session work, posting, and retry.