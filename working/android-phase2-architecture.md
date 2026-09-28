# Android engine Phase 2 — scheduler and leases

Scope: infrastructure only. No Instagram UI automation, credentials, login, or Meta API.

## Control plane

- `SocialAccount.executionEngine=chromium` stays the default. Android accounts need an enabled registered `homeDeviceId`, Instagram platform, and `androidHealth=HEALTHY` before `ANDROID_SMOKE` submission. Switching engines does not clear browser cookies; active browser contexts and queued Android jobs block reassignment.
- `AndroidJob` records the durable request (`QUEUED → RUNNING → COMPLETED/FAILED/INTERRUPTED/SKIPPED`), result, timestamps, attempt count and reason. `androidDeviceQueue` is a dedicated BullMQ queue **on RockBase's existing Redis**, separate from the Chromium posting worker's single-concurrency queue so Android infrastructure checks cannot consume posting slots. SQLite remains source of truth; BullMQ is delivery/wakeup. A 30-second reconciliation sweep redelivers orphan QUEUED rows.
- `AndroidDeviceLeaseService` atomically claims a device row with `updateMany` conditional on `leaseOwner=null`; stores UUID owner, job ID, heartbeat and 5-minute expiry. Heartbeats extend conditionally. Release is owner-checked. Expired leases become `ATTENTION` and RUNNING jobs `INTERRUPTED`—no automatic replay of an uncertain action. Operator health/stop resolves attention. No second account job can claim that device concurrently.
- `AndroidDeviceService.start` enforces max active devices using a SQLite transaction over BOOTING/READY/BUSY/ATTENTION, plus actual ADB connected serials and local pre-ADB boot reservations. A queued job on a running home device reuses it; on an offline home device it boots only that AVD. If slots are full, job stays QUEUED and BullMQ retries after 5 seconds. The scheduler never provisions devices.
- After job completion the device returns READY. `idleSince` is durable; a 30-second sweep applies `ANDROID_IDLE_GRACE_MINUTES` (default 30). New same-device work clears the idle timestamp. The sweep acquires a device lease and checks queued jobs before stopping, records shutdown reason and idle duration. No in-memory grace timers are required.
- Device list/API exposes queue count, lease owner/job/expiry, last boot and health, error, running/max, and device/account health. Activity logs record boot/job/shutdown metadata. Windows Local Mode only; Server Mode returns 501. Operator start/stop/restart does not override active leases.

## Verified with isolated data

- Fresh scratch SQLite migrations applied. `android-scheduler-test.ts` uses mocked runtime: lease exclusion and stale recovery, missing/disabled home, account attention, ADB/boot failure, Chromium default, same-device reuse, pending job canceling idle shutdown, max=1 two-device contention, and four devices with max=3.
- Real AVD `Medium_Phone_API_36.1`, 2 CPU/2048 MB: synthetic account without credentials, two screenshot jobs on the same AVD, one boot, durable job results, then idle sweep shutdown. A separate integration uses a temporary Redis container on port 16379 to POST two smoke jobs via authenticated Local Mode API, dispatch through BullMQ and worker, confirm reuse, then shut down; test container removed afterward. No existing social account was used.

## Boundaries and operational risks

- Leases are durable in SQLite, but worker and scheduler require Local Mode + Redis. A lost Redis connection can leave QUEUED work until delivery recovers. The lease expires after 5 minutes; reconciliation flags uncertain work for operator review instead of blindly replaying it.
- ADB serials are resolved by AVD name, not assumed port numbers. Unmanaged attached emulators count toward the physical concurrency cap. Status can be ATTENTION if ADB/device health requires operator intervention; manual health check clears attention only when boot reports complete.
- Observed resource values on this particular host are samples, not guaranteed capacity. Default 3 concurrent devices is a planning limit, not a guarantee that 20–25 AVDs can be provisioned without disk and host-resource planning.
