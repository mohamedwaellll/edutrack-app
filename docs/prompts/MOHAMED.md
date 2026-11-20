# محمد — الأدمن والمدرس والتجميع النهائي

Branch: `feature/admin-teacher-workflows`

Owned files: AdminDashboard.tsx; TeacherDashboard.tsx; adminService.ts; teacherService.ts; package.json; package-lock.json; .github/*; docs/*

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
First close the outstanding Milestone 5 review. Fix ignored groupsRes.error in getTeachers and swallowed teacher/group load errors in the dashboard; distinguish successful save plus refresh failure from failed save.
Omit user_id from createTeacher and enforce allowed creation fields in PostgreSQL. Replace broad groups UPDATE grants with needed columns or a narrow authorized RPC. Remove the unnecessary REFERENCES grant and false documentation claiming it is required for normal FK updates. Remove unnecessary SECURITY DEFINER from the pure sanitizer.
Unify JS/SQL email validation, including a@b.co, whitespace, multiple @, missing suffix and case-insensitive duplicates. Add synchronous submission guards and real component tests.
Compare historical student/attendance/grade/note rows before and after each reassignment, not count > 0 or only after restoring the original teacher. Test historical email conflicts and direct client user_id injection.
Use a new migration after ...000005 coordinated with Ali. This correction must merge before role expansion.
Then adapt TeacherDashboard/teacherService for scoped teacher sessions. The current adminService-based screen must not simply be exposed unchanged. Coordinate server authorization and identity-derived note authors with Ali.
Own packages, lockfile, CI and one-at-a-time integration. Preserve existing features. Keep UI and API roles consistent.
```
