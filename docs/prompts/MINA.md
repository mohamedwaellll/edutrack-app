# مينا — بوابة الطالب الحقيقية

Branch: `feature/student-portal`

Owned files: src/components/StudentDashboard.tsx; src/services/studentService.ts; src/types/student.ts عند الحاجة; src/__tests__/student/*

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
Implement StudentDashboard.tsx and studentService.ts according to the approved contract. Resolve identity from the authenticated profile mapping; an arbitrary route/student ID is not authorization.
Show own profile/group, attendance and grades. Reuse StudentIdCard through agreed props. No academic, role or identity-link writes.
Implement loading, no records, errors and missing-link states with mobile usability. No runtime mock fallback.
Ali owns routing/auth/RLS/shared database types. Before those contracts are implemented, test with isolated mocks and mark live integration blocked. Test two students, forbidden IDs, refresh and error cases.
```
