# عبدالرحمن — الحضور والـQR وكروت الطلاب

Branch: `feature/attendance-qr`

Owned files: AttendanceQRScanner.tsx; StudentIdCard.tsx; StudentCardsPrintPage.tsx; src/services/attendanceService.ts; اختبارات الحضور والكاميرا

```text
Project: EduTrack, React 18 + Vite + TypeScript + Supabase.
Read AGENTS.md and docs/TEAM_START_HERE.md, HANDOFF_STATUS.md, TEAM_OWNERSHIP.md and INTEGRATION_CONTRACT.md first.
Start from the shared team-start-20261120 baseline on your assigned branch. Preserve existing work.
The legacy ali branch is a separate Next.js implementation: do not merge it wholesale or migrate this app to Next.js.
Respect file ownership. Coordinate shared files, dependencies and SQL with their owners.
Do not change historical migrations. Mohamed's Milestone 5 correction precedes Ali's role-expansion migrations.
Never hide query errors with mock data or claim save success before database confirmation.
Do not expose secrets, force-push, reset destructively, execute hosted SQL, or deploy without explicit authorization.
Test with the actual migration grants, not broad test-only privileges. Run relevant tests and npm run build.
Return an Arabic report: changed files; migrations/order; actual commands, results and warnings; browser/hosted/hardware verification separately; blockers and manual steps.
Target develop in the PR. Only publish/send through authorized repository operations.

ASSIGNMENT:
Stabilize existing QR/manual attendance and cards. Preserve group-required validation, Cairo time, duplicate behavior, inactive-student rejection and manual-absence conflicts.
Test camera permission denial, late permission, stopping/unmounting, image decoding and printed cards. Mark real hardware tests BLOCKED when no hardware is available.
Independent database connections are required before claiming true concurrent-scan acceptance; Promise.all on a single engine connection is insufficient.
Agree StudentIdCard props with Mina. Do not edit App.tsx or AdminDashboard.tsx; send integration requirements to their owners. Coordinate SQL changes with Ali.
```
