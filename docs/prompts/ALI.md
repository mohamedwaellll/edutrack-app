# علي — الحسابات والصلاحيات والعقد المشترك

Branch: `feature/auth-role-access`

Owned files: src/App.tsx; src/contexts/AuthContext.tsx; AuthPage.tsx; AccessDenied.tsx; src/lib/*; src/types/database.ts; supabase/migrations/* بالتنسيق

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
Own auth, routing, shared types/contracts and database authorization. First review and freeze the integration contract with Mohamed, including proposed parent_student_links and service contracts; proposed interfaces are not implemented APIs.
Map teachers.user_id and students.user_id securely; validate historical duplicate links without deleting data. Parent links are explicit; never infer them from phone, name or email similarity. Trusted administration owns account creation and links.
Preserve admin access. Missing links/unknown roles fail closed. Test two users per role and cross-group access, role changes and sign-out.
Coordinate TeacherDashboard/teacherService with Mohamed. Existing assessment triggers are admin-only: teacher permissions need a reviewed forward migration with assigned-group checks and server-derived author identity. Keep attendance writes admin-only for this release.
Apply role migrations only after Mohamed's teacher-management correction. Port compatible pieces of old ali work; do not merge its Next.js replacement.
```
