# يوسف — بوابة ولي الأمر والمتابعة

Branch: `feature/parent-portal`

Owned files: src/components/ParentDashboard.tsx; src/services/parentService.ts; src/types/parent.ts عند الحاجة; src/__tests__/parent/*

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
Replace ParentDashboard's static content using parentService.ts and Ali's approved link model. Only show explicitly linked children; verify selected child authorization server-side.
Parent-invisible notes must never be returned by the API, not merely hidden by React. Calculate charts with explicit date ranges and denominators. Distinguish no records from failures and zero values.
Implement child selection, loading/empty/error/no-link states and responsive layout. No unsolicited notifications or messaging.
Ali owns routing/auth/RLS/shared types. Test two parents, multiple children, unrelated IDs, internal notes, refresh and failed requests.
```
