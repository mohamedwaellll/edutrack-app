# Handoff & Project Status — 22 November 2026

## Working Model Update: Sole Developer Model
- **Sole Developer:** Mohamed now owns the entire project and executes all milestones sequentially.
- **Superseded Model:** Previous distributed assignments across five team members are superseded. No teammate coordination or multi-agent handoff is required.
- **Team Testing:** Follow the README for the current local demo and acceptance checklist.
- **Current Milestone:** **Stage F (LOCAL REHEARSAL COMPLETE — ENVIRONMENT BLOCKERS DOCUMENTED):** Aligns `portalPayloadValidation.ts` grade bounds (`0 <= score <= max_score`, `0 < max_score < 1000`), adds end-to-end 4-role Stage F rehearsal (`stageFRehearsal.test.tsx`) plus a Chrome 157 headless rehearsal against an isolated local Vite + PGlite HTTP bridge (`20261103` -> `20261122000001`), verifies Upload Image QR card PNG scanning and simulated camera stream handling, and documents exact local Supabase CLI / Docker / multi-session PostgreSQL / physical camera readiness boundaries.

## Verification Baseline & Current Results
- **Automated Tests:** 187 tests passed across 18 test files (`npm.cmd test -- --run`).
- **Production Build:** Passes cleanly without errors (`tsc && vite build`).
- **Browser Verification:** Executed an isolated Chrome 157 rehearsal against a temporary local Vite server (`127.0.0.1:4179`) wired to an ephemeral local PGlite HTTP bridge (`127.0.0.1:54399`) running all 17 ordered migrations (0 console/page errors), including real PNG capture/upload of the rendered `StudentIdCard` QR and a fake media stream camera check (`--use-fake-device-for-media-stream`). Genuine `supabase start` browser verification did NOT run because Supabase CLI and Docker are not installed on this workstation. No hosted Supabase database was touched or reset.
- **Known Test Warnings:** React `act(...)` in AuthProvider tests, JSDOM chart dimensions, Node experimental localStorage, and Vite bundle chunk size notice (>500 kB).
- **Environment Scope & Limitations:** Local automated tests (JSDOM, Vitest, isolated single-session `@electric-sql/pglite` WASM PostgreSQL) verify application logic, component states, production grants, and database constraints locally. Native PostgreSQL / Docker is unavailable in this environment, so genuine two-session simultaneous transaction interleaving was NOT executed against two independent backend connections (see PGlite concurrency note below). Automated checks do NOT replace manual browser validation against hosted Supabase infrastructure, multi-session PostgreSQL concurrency verification, live network latency, or physical camera QR scanning.

## Stage B.1 Secure Account Linking Foundation (Fully Implemented)

### 1. Database Migration: `20261121000002_edutrack_secure_account_linking.sql`
- **Pre-execution Data Integrity Checks:** Inspects `public.teachers` and `public.students` before altering schema; aborts with descriptive exception if duplicate `user_id` or cross-role link mismatches exist, ensuring zero data corruption or silent loss.
- **Partial Unique Indexes:**
  - `idx_teachers_user_id`: Enforces that non-null `teachers.user_id` is unique across all teachers.
  - `idx_students_user_id`: Enforces that non-null `students.user_id` is unique across all students.
- **Parent-Student Links Table:**
  - `public.parent_student_links (id UUID PK, parent_id UUID FK profiles, student_id UUID FK students, created_at, created_by)`.
  - Unique constraint `CONSTRAINT uq_parent_student_link UNIQUE (parent_id, student_id)`.
  - Allows 1:N (one parent to multiple children) and N:1 (one child to multiple guardians/parents) with explicit UUID links only (no implicit string matching).
- **Anti-Self-Promotion & Role Elevation Guards:**
  - Hardened `tr_check_profile_role_insert`: Non-admin callers cannot create profiles with any role other than `'student'`.
  - Hardened `tr_check_profile_role_update`: Non-admin callers cannot modify roles; in addition, active links freeze user roles so that an account linked to a teacher, student, or parent record cannot have its role changed until explicitly unlinked.
- **Direct Table Mutation Guards:**
  - `validate_teacher_record()`: Rejects `user_id` update if target profile lacks `role = 'teacher'` or is linked elsewhere.
  - `validate_student_user_id()`: Rejects `user_id` assignment if target profile lacks `role = 'student'` or is linked elsewhere.
  - `validate_parent_student_link()`: Enforces that `parent_id` points to a profile with `role = 'parent'`.
- **Trusted Administrative RPC Routines (`SECURITY DEFINER`, `search_path = public`):**
  - `public.link_teacher_account(p_teacher_id UUID, p_user_id UUID)`
  - `public.unlink_teacher_account(p_teacher_id UUID)`
  - `public.link_student_account(p_student_id UUID, p_user_id UUID)`
  - `public.unlink_student_account(p_student_id UUID)`
  - `public.link_parent_student(p_parent_id UUID, p_student_id UUID)`
  - `public.unlink_parent_student(p_parent_id UUID, p_student_id UUID)`
  - All routines require `public.is_admin()`, reject silent overwrites, enforce role match, and return standard JSONB payloads.
- **Privilege Hardening & RLS:**
  - `parent_student_links` table mutations revoked from `authenticated`; read access granted.
  - RLS policies on `parent_student_links`: Admins have full access (`public.is_admin()`); parents have scoped `SELECT` access (`parent_id = auth.uid()`).
  - RPC execution revoked from `PUBLIC` and `anon`; granted exclusively to `authenticated`.

### 2. TypeScript Service: `src/services/accountLinkingService.ts`
- Fully typed administrative methods returning standard `ServiceResult<T>`:
  - `linkTeacherAccount`, `unlinkTeacherAccount`
  - `linkStudentAccount`, `unlinkStudentAccount`
  - `linkParentStudent`, `unlinkParentStudent`
  - `getParentStudentLinks(parentId?: string)`
  - `getProfilesByRole(role: UserRole)`
- Explicit error codes: `PERMISSION_DENIED`, `ROLE_MISMATCH`, `NOT_FOUND`, `ALREADY_LINKED`, `CONFLICT`, `INVALID_INPUT`, `CONFIG_ERROR`.
- RPC wrapper `executeLinkingRpc` verifies explicit `{ success: true }` confirmation before returning success.

### 3. Stage B.1 Corrective Hardening (`20261121000003_edutrack_stage_b1_corrective_hardening.sql`)
- **Student Creation `user_id` Lockdown:** Revokes broad `INSERT` on `public.students` and grants column-level `INSERT` omitting `user_id` to `authenticated`, paired with trigger `validate_student_user_id()` rejecting `TG_OP = 'INSERT' AND NEW.user_id IS NOT NULL`. Normal unlinked student creation by authenticated admins and post-creation `link_student_account` RPC linking continue working under production grants.
- **Atomic Link / Unlink RPCs:**
  - `link_teacher_account` / `link_student_account` execute atomic conditional `UPDATE ... WHERE id = ... AND user_id IS NULL RETURNING id, user_id` and validate the actually modified row before returning success, converting racing link conflicts and `unique_violation` errors into explicit conflict failures.
  - `unlink_teacher_account` / `unlink_student_account` acquire `FOR UPDATE` on the target row, conditionally update `WHERE id = ... AND user_id = v_previous_user_id RETURNING`, and verify the cleared row so `previous_user_id` always matches the account actually unlinked (or `null` when already unlinked).
- **Profile Role Change & Link Coordination:** Link RPCs and validation triggers (`validate_teacher_record`, `validate_student_user_id`, `validate_parent_student_link`) acquire `FOR SHARE` on target `public.profiles` rows; added `AFTER UPDATE` trigger `tr_enforce_profile_role_link_consistency` on `public.profiles` so role-link consistency is enforced strictly after PostgreSQL acquires `LockTupleNoKeyExclusive` on the profile row, preserving `provision_admin` and unlink-then-role-change paths.
- **Concurrency Testing Boundary:** Because this local environment runs single-session `@electric-sql/pglite` (no local PostgreSQL server or Docker), `Promise.allSettled` calls in Test 15 execute sequentially on one WASM connection; two-session lock interleaving was not executed locally and relies on PostgreSQL `READ COMMITTED` predicate re-evaluation (`WHERE user_id IS NULL`), `FOR UPDATE`, `FOR SHARE`, and `AFTER UPDATE` lock ordering.

### 4. Stage B.2 Admin Account Linking UI & Expected Unlink Guards
- **Migration `20261121000004_edutrack_stage_b2_expected_unlink_guards.sql`:** Replaces 1-arg `unlink_teacher_account(UUID)` / `unlink_student_account(UUID)` with backwards-compatible `(UUID, p_expected_user_id UUID DEFAULT NULL)` signatures using `FOR UPDATE`; rejects stale confirmations with `Conflict:` while preserving any newly linked user account untouched.
- **Typed Service Updates (`src/services/accountLinkingService.ts`):** `unlinkTeacherAccount(teacherId, expectedUserId?)` and `unlinkStudentAccount(studentId, expectedUserId?)` forward `p_expected_user_id` when supplied; `getParentStudentLinks` includes `student_code`.
- **Admin UI (`AdminDashboard.tsx` & `AccountLinkingPanel.tsx`):**
  - Added **Account Linking** navigation tab loading fresh teachers, students, role-filtered profiles, and parent-student links upon opening.
  - Three explicit pathways (`Teachers`, `Students` with `student_code` disambiguation for identical names, `Parents & Children` supporting 1:N and N:1) with search filters, explicit UUID selection (zero auto-linking), and two-sided unlink confirmation modals passing `expectedUserId`.
  - Synchronizes selected account/parent/child UUIDs with currently visible eligible options: if search filtering or directory reload hides a selection, it is cleared immediately (clearing selected parent also clears selected child), confirmation controls disable, and submit handlers verify visibility/eligibility synchronously before calling any RPC (including Enter submissions).
  - Isolates post-save and post-conflict refresh failures per pathway dependency (`teachers` -> teachers + teacher accounts; `students` -> students + student accounts; `parents` -> parent accounts + links + students): unrelated pathways stay usable and successful saves still report success if an unrelated pathway fails; conflict refresh displays explicit completion status once resolved, and Retry/Reload List only re-reads data without re-saving.

### 5. Stage B.3 Explicit Role Routing & Access Revocation
- **Unified Auth Decision & Race Protection (`src/contexts/AuthContext.tsx`):**
  - Expanded `AuthPortalStatus` with explicit role states (`authenticated_admin`, `authenticated_teacher`, `authenticated_student`, `authenticated_parent`) plus fail-closed `missing_profile`, `profile_error`, and `unknown_role`.
  - Extracted pure exported `resolveAuthAccessDecision()` shared identically by initial session restore, `onAuthStateChange`, `signIn`, and `refreshProfile`, verifying `profile.id === session.user.id` and checking supported roles.
  - Monotonic request/epoch tracking (`activeRequestId`) captures the epoch before initial `getSession()` so delayed `getSession()` or delayed profile fetches arriving after newer logins, account switches, or `signOut()` are discarded.
  - Distinguishes same-user session refresh (`TOKEN_REFRESHED` / duplicate `SIGNED_IN` for the currently verified `user.id`) from identity changes: re-verifies the role via `isRevalidating` while keeping active portals, tabs, modals, and unsaved drafts intact if the role holds, blocking protected mutation submits/buttons (`AdminDashboard.tsx`, `AccountLinkingPanel.tsx`, `TeacherDashboard.tsx`, `AttendanceQRScanner.tsx` across camera frames, late camera permission streams, async image decodes, and manual token entry without queueing) during verification, and immediately revoking access on role change, read failure, or account switch.
  - Hardens `signOut()` across both `{ error }` return values and rejected Promises: immediately clears protected profile/UI into `'signing_out'`, retains `signingOutUserIdRef` throughout `'signing_out'` and `'signout_error'` so duplicate `SIGNED_IN` events for the outgoing account never restore the portal or cancel sign-out, preserves `Retry Sign Out` recovery, and restores normal sign-in once sign-out completes (`'unauthenticated'`).
- **Explicit Role Routing & Non-Admin Starter Portals (`src/App.tsx`, `src/components/RolePortalLanding.tsx`, `src/components/AccessDenied.tsx`, `src/components/AuthPage.tsx`):**
  - `App.tsx` switches explicitly on `status` and keys `<AdminDashboard key={user.id} />`, resetting `isolatedPreview` whenever `status` or `user?.id` changes and blocking all admin/teammate previews unless `status === 'authenticated_admin' && profile.role === 'admin' && profile.id === user.id`.
  - Added `RolePortalLanding.tsx` for `'teacher'`, `'student'`, and `'parent'` displaying only verified identity fields (full name, verified role, email, account ID), deferred Stage C/D/E scope notes, and a `Sign Out` button, without mounting `ParentDashboard`/`TeacherDashboard`/`AdminDashboard` or invoking `adminService`/`accountLinkingService`.
  - Updated `AccessDenied.tsx` to render distinct states for `profile_error`, `missing_profile`, and `unknown_role` with `Recheck Access` (`Retry`) and `Sign Out`.
  - Updated `AuthPage.tsx` copy for all four EduTrack portal roles (`Admin`, `Teacher`, `Student`, `Parent`).

### 6. Stage C.1 Scoped Read-Only Teacher Portal
- **Database Migration (`20261121000005_edutrack_stage_c1_teacher_read_only_scope.sql`):**
  - Adds `public.get_teacher_portal_context()` and `public.get_teacher_group_students(p_group_id UUID)` (`SECURITY DEFINER`, `SET search_path = public`, `EXECUTE` granted exclusively to `authenticated`, revoked from `PUBLIC`/`anon`).
  - Both RPCs derive caller identity exclusively from `auth.uid()`, require a verified `public.profiles` row with `role = 'teacher'`, resolve `public.teachers.user_id = auth.uid()` (never accepting client `teacherId`), and verify `public.groups.teacher_id = v_teacher_id` on every group roster read.
  - Direct table `SELECT` policies on `public.students`, `public.groups`, and `public.teachers` stay restricted to `public.is_admin()`; `get_teacher_group_students` returns ONLY `id`, `full_name`, `student_code`, `status`, and `group_id`, omitting `parent_name`, `parent_phone`, `qr_code_hash`, and `user_id`.
- **Service & UI (`src/services/teacherPortalService.ts`, `src/components/TeacherPortal.tsx`, `src/App.tsx`):**
  - `App.tsx` routes verified `'authenticated_teacher'` sessions to `<TeacherPortal key={user.id} />`, keeping `RolePortalLanding` for `'student'` and `'parent'`.
  - Distinguishes unlinked teacher accounts (`linked: false`), linked teachers with zero assigned groups, empty groups, and RPC load failures with `Retry`, while preserving `Sign Out` / `Retry Sign Out` and `TOKEN_REFRESHED` session protections and ignoring stale responses across group switches or account switches.

### 7. Stage C.2 Scoped Teacher Grade & Note Writes
- **Database Migration (`20261121000006_edutrack_stage_c2_teacher_grade_and_note_writes.sql`):**
  - Updates `validate_grade_record()` and `validate_teacher_note()` to preserve admin/maintenance access while adding an `INSERT`-only scoped teacher path (`edutrack.teacher_portal_write = '1'`) verified via `auth.uid()`, `profiles.role = 'teacher'`, `teachers.user_id`, `groups.teacher_id`, and active student membership. Direct table writes on `public.grades` and `public.teacher_notes` remain blocked behind `public.is_admin()` RLS and trigger guards.
  - Adds `save_teacher_student_grade(...)`, `save_teacher_student_note(...)`, and `get_teacher_student_records(p_group_id, p_student_id)` (`SECURITY DEFINER`, executable only by `authenticated`), acquiring `FOR SHARE` row locks across `profiles -> teachers -> groups -> students` inside the save transaction and returning only the authenticated teacher's own records for an authorized student in an assigned group (historical records preserve original `teacher_id` upon group transfer).
- **Service & UI (`src/services/teacherPortalService.ts`, `src/components/TeacherPortal.tsx`):**
  - Fixes `normalizeStudentStatus` so unknown statuses normalize to `'unknown'` (never `'active'`) and enables writes exclusively when `status === 'active'`.
  - Displays student full name, `student_code`, and group name before saving (disambiguating identical names), defaults notes to `"Internal Only"` (`isParentVisible = false`), enforces grade bounds (`0 <= score <= maxScore`, `0 < maxScore < 1000`, `assessment_date <= Cairo today`), blocks submits while preserving drafts during `isRevalidating`, prevents double-submit/Enter duplicates, ignores stale responses across group/account switches, closes the modal & refreshes groups on assignment revocation errors, and preserves confirmation with read-only `Retry` if post-save list reload fails.

### 8. Stage D Scoped Read-Only Student Portal
- **Database Migration (`20261121000007_edutrack_stage_d_student_read_only_portal.sql`):**
  - Adds `public.get_student_portal_data()` (`SECURITY DEFINER`, `SET search_path = pg_catalog, public`, executable only by `authenticated`), deriving identity solely from `auth.uid()`, checking `profiles.role = 'student'`, resolving `students.user_id = auth.uid()` (with optional current group summary), and returning `{ linked: false }` cleanly when unlinked.
  - Exposes ONLY student card (`id`, `full_name`, `student_code`, `grade_level`, `status`, current `group`), recorded attendance (`id`, `date`, `status`, `check_in_time` newest first), and student grades (`id`, `assessment_title`, `grade_type`, `score`, `max_score`, `assessment_date` newest first, retained across group or teacher changes). Strictly omits `qr_code_hash`, `parent_name`, `parent_phone`, `user_id`, `remarks`, `teacher_id`, and all `teacher_notes`. Direct table `SELECT` policies remain admin-only.
- **Service & UI (`src/services/studentPortalService.ts`, `src/components/StudentPortal.tsx`, `src/App.tsx`):**
  - `App.tsx` routes verified `'authenticated_student'` sessions (`profile.id === user.id && profile.role === 'student'`) to `<StudentPortal key={user.id} />`, leaving `'authenticated_parent'` on `RolePortalLanding` for Stage E.
  - Explicitly distinguishes loading, unlinked account, unassigned group, empty attendance/grades (with unlisted-day policy note), and read errors with `Retry`; clears student data immediately on sign-out/switch and ignores stale RPC responses.

### 9. Stage E Scoped Read-Only Parent Portal & Stage D Payload Validation
- **Stage D Payload Hardening (`src/services/portalPayloadValidation.ts`, `src/services/studentPortalService.ts`):**
  - Strictly validates `attendance` and `grades` arrays when `linked = true`, rejecting missing arrays, unknown attendance statuses, unknown grade categories, or missing/invalid numeric scores with explicit read errors (`Retry` in UI), while preserving genuine `score === 0`, `check_in_time === null`, and `[]` empty arrays.
- **Database Migration (`20261122000001_edutrack_stage_e_parent_read_only_portal.sql`):**
  - Adds `public.get_parent_portal_children()` and `public.get_parent_child_details(p_student_id UUID)` (`SECURITY DEFINER`, `SET search_path = pg_catalog, public`, executable only by `authenticated`), verifying `auth.uid()` -> `profiles.role = 'parent'` and `public.parent_student_links` membership on every read.
  - Supports linked children without requiring a student login account (`students.user_id` may be `NULL`), filters `teacher_notes` strictly in SQL with `WHERE tn.is_parent_visible IS TRUE` before building JSON output, exposes `author_name` via `teachers.full_name`, and excludes internal notes, `qr_code_hash`, `parent_name`, `parent_phone`, `user_id`, and unlinked child records.
- **Service & UI (`src/services/parentPortalService.ts`, `src/components/ParentPortal.tsx`, `src/App.tsx`):**
  - `App.tsx` routes verified `'authenticated_parent'` sessions (`profile.id === user.id && profile.role === 'parent'`) to `<ParentPortal key={user.id} />`.
  - Disambiguates identical-name linked children via `full_name` + `student_code`, immediately wipes prior child details and discards stale RPC responses across child switches, clears stale child details + refreshes children list upon link revocation errors, distinguishes zero linked children vs empty child records vs read errors with `Retry`, and wipes state immediately on sign-out or account switch.

### 10. Test Coverage Baseline (187 Passing Tests Across 18 Files)
- `src/__tests__/stageFRehearsal.test.tsx` (1 end-to-end 4-role PGlite + React `<App />` rehearsal test): Rehearses the full single-student flow (`ET-F-101`, `Physics Group F1`) across Admin group teacher assignment, Teacher/Student/Parent account linking, `StudentCardsPrintPage` QR SVG rasterization + `Upload Image` decoding via `jsQR`, duplicate QR scan idempotency (`ALREADY_RECORDED`, 1 DB row, `check_in_time` preserved), Teacher `18 / 20` grade + internal & parent-visible notes, Student portal (`Present` + `18 / 20` + zero notes), and Parent portal + full unmount/remount reload preserving state.
- `src/__tests__/parentPortal.test.tsx` (4 `<App />` component integration tests): Covers identical-name linked child disambiguation (`student_code`), `18 / 20` grade, attendance, and parent-visible note display with zero QR/contact/admin leaks, immediate clear & stale RPC cancellation during rapid child switching, children/details read errors (`Retry`) + empty states, link revocation banner + list reload, and immediate wipe on sign-out.
- `src/__tests__/studentPortal.test.tsx` (5 `<App />` component integration tests): Covers student card, newest-first attendance, and 18/20 grade display + portal reopen persistence without PII/QR/admin calls; distinguishes read errors (+ `Retry`), unlinked / unlinked-after-refresh, no-group, and empty attendance/grade states; clears data immediately while ignoring stale RPCs on account switch or sign-out; rejects malformed/incomplete payloads (`missing list`, unknown enum, `score: null`) while preserving `score === 0`, `check_in_time: null`, and `[]`; and enforces DB score bounds (`0 <= score <= max_score`, `0 < max_score < 1000`), rejecting `21/20` and `max_score = 1000` while rendering `0/20` and `18/20`.
- `src/__tests__/teacherPortal.test.tsx` (8 `<App />` component integration tests + `normalizeStudentStatus` checks): Covers read-only rendering without PII/QR, unlinked/empty-group/error + `Retry` states, stale group/account RPC rejection, `TOKEN_REFRESHED` + `Sign Out` protection, grade & note persistence across `App` reload, identical-name disambiguation via `student_code`, `'unknown'` status gating + `isRevalidating` write block + duplicate submit lock, assignment-revocation modal close/group reload, and post-save refresh failure read-only `Retry`.
- `src/__tests__/appRoleRouting.test.tsx` (12 component integration tests from `<App />`): Covers interactive login and session restore routing for all four roles with zero admin/linking service calls for non-admins; immediate hiding of `AdminDashboard` and active previews on `admin -> student` switch; rejection of delayed `getSession()` and post-sign-out responses; same-user `TOKEN_REFRESHED` and duplicate `SIGNED_IN` preserving active tab, modals, and unsaved drafts (`Add Teacher`, `Grades & Feedback`, `AttendanceQRScanner`) while blocking writes across Grades/Feedback, live camera frames, pending camera streams, async image decodes started pre-refresh, and manual tokens without queueing; revocation on role demotion/profile error or mid-refresh account switch; `signout_error` + `Retry Sign Out` handling for `{ error }` returns, rejected Promises, and duplicate `SIGNED_IN` events during outgoing sign-out plus normal re-login afterward; and `Recheck Access` recovery.
- `src/__tests__/authAndRoles.test.ts` (6 pure unit tests): Directly tests exported `resolveAuthAccessDecision` from `AuthContext.tsx` across all four roles, `missing_profile`, `profile_error` (DB error + user ID mismatch), `unknown_role`, `unauthenticated`, and `unconfigured`.
- `src/__tests__/authProvider.test.tsx` (7 component tests): Session restoration, logout race safety, account switch isolation, missing vs error distinction, role demotion via `refreshProfile`, fail-closed `refreshProfile`, and `App` gate recovery.
- `src/__tests__/adminDashboardAccountLinking.test.tsx` (10 component tests): End-to-end AdminDashboard `Account Linking` tab navigation, Teacher/Student/Parent link & unlink workflows, identical student name disambiguation via `student_code`, selection-visibility clearing + Enter submit guard for teacher/student/parent/child, read failure isolation & action disabling, double-click prevention, pathway-isolated conflict refresh completion & recovery, and post-save refresh failure isolating affected vs unaffected pathways without re-saving.
- `src/__tests__/accountLinkingService.test.ts` (19 unit tests): Input validation, configuration guards, RPC invocations, `expectedUserId` checks, conflict confirmation checks, and error mapping.
- `src/__tests__/databaseMigrations.test.ts` (18 tests): Static validation of migrations 11–17 structure, triggers, RPC grants, column grants, and privacy/RLS boundaries.
- `src/__tests__/databaseExecution.test.ts` (20 tests in isolated PGlite engine):
  - Test 13: Full execution lifecycle for teacher/student/parent linking, unlinking, role conflict rejections, active link freeze, RLS parent filtering, and anti-self-promotion.
  - Test 14: Pre-execution conflict detection for duplicate user IDs and invalid roles without data loss.
  - Test 15: Production-grant verification of `students.user_id` lockdown, unlinked student creation + post-create RPC linking, atomic link/unlink conflict & `previous_user_id` verification, and role-link ordering with `provision_admin`.
  - Test 16: Stale unlink confirmation guard verifying `Conflict` response and preservation of newly linked teacher/student accounts, plus backwards-compatible 1-arg calls.
  - Test 17: Stage C.1 production-grant verification of `get_teacher_portal_context()` & `get_teacher_group_students(UUID)` across two teachers, unlinked teacher, outside/unassigned groups, PII/QR omission + direct table RLS isolation, assignment transfer/revocation, non-teacher/anon rejection, and preserved admin access.
  - Test 18: Stage C.2 production-grant verification of `save_teacher_student_grade(...)`, `save_teacher_student_note(...)`, and `get_teacher_student_records(...)` including server author derivation, direct table `INSERT`/`UPDATE` rejection, row count stability on rejected writes (other teacher, unlinked, student, suspended, moved student, invalid score/date), group transfer author isolation & original author preservation, and preserved admin writes.
  - Test 19: Stage D production-grant verification of `get_student_portal_data()` with two same-name students (`18/20` grade & QR attendance isolated strictly to Student 1), field allow-list excluding QR/parent PII/teacher notes, unlinked & post-unlink `linked: false`, historical grade persistence across group transfer/unassignment, non-student/anon rejection, and preserved admin access.
  - Test 20: Stage E production-grant verification of `get_parent_portal_children()` & `get_parent_child_details(UUID)` across two parents (Parent 1 linked to two identical-name students including one without a student login account; Parent 2 linked only to shared student), verifying attendance, `18/20` grade, SQL-filtered parent-visible notes only (internal notes & QR/PII absent from raw JSON), UUID rejection for unlinked child, link revocation isolation, non-parent/anon rejection, and preserved Stage D student exclusion of all notes.

### 11. Stage F Demo Execution Guide & Account Switch Sequence
*Security note: Demo credentials belong strictly in the local operator setup / Auth dashboard and are intentionally omitted from versioned documentation (never store passwords or keys here).*

#### Pre-Demo Isolated Setup
1. Provision an **isolated** local Supabase stack (`supabase init` / `supabase start`, requiring Docker Desktop + Supabase CLI) or an isolated staging Supabase project — never reset or overwrite an existing shared database.
2. Apply all 17 migrations in chronological order (`supabase/migrations/20261103_edutrack_schema.sql` through `supabase/migrations/20261122000001_edutrack_stage_e_parent_read_only_portal.sql`).
3. Provision four Auth user accounts in `public.profiles` with roles `admin`, `teacher`, `student`, and `parent`, plus sample `teachers`, `groups`, and `students` records (note the target demo student's `student_code`, e.g., `ET-F-101`), keeping links initially unlinked before Step 1 if demonstrating Admin Account Linking live.
4. Configure local runtime `.env` to target ONLY the isolated demo environment, then run `npm.cmd run dev` (or `npm.cmd run build && npm.cmd run preview`).

#### Live Walkthrough & Account-Switching Sequence
1. **Admin Session (`authenticated_admin`):**
   - Sign in with the **Admin** account on `AuthPage` -> verify `Admin dashboard` opens.
   - Under `Classes & Groups`, use `Assign / Change` -> assign the Teacher record to the target group.
   - Under `Account Linking`, explicitly link: (a) Teacher record -> Teacher user account, (b) target Student record (`ET-F-101`) -> Student user account, and (c) Parent user account -> same Student record (`ET-F-101`).
   - Open `Student ID Cards` -> locate `ET-F-101` (`QRCodeSVG` badge) and print or save a PNG screenshot for camera/upload scanning.
   - Return via `Back to Dashboard` -> `Attendance` -> `QR Attendance Scanner` -> select the target group.
   - Scan the QR card via **Live Camera** (if webcam + physical card are present) or **Upload Image** fallback -> verify `Check-In Confirmed` with recorded arrival time; repeat scan (>3s cooldown) -> verify `Already Recorded` and a single attendance row with preserved `check_in_time`.
   - Click `Sign Out` -> verify immediate return to `AuthPage`.
2. **Teacher Session (`authenticated_teacher`):**
   - Sign in with the **Teacher** account -> verify `Teacher Portal` shows only assigned groups.
   - Select the target group and target student by `student_code` (`ET-F-101`).
   - Record grade `18 / 20`, save one note marked `Internal Only`, and save a second distinct note marked `Visible to Parent`.
   - Click `Sign Out`.
3. **Student Session (`authenticated_student`):**
   - Sign in with the **Student** account -> verify `Student Portal` displays student card (`ET-F-101`), `Present` attendance with arrival time, and `18 / 20`, while **neither** teacher note appears.
   - Click `Sign Out`.
4. **Parent Session (`authenticated_parent`):**
   - Sign in with the **Parent** account -> verify `Parent Portal` displays linked children -> select `ET-F-101`.
   - Verify attendance (`Present` + arrival time), grade `18 / 20`, and **only** the `Visible to Parent` note (internal note remains completely absent).
   - Press browser reload (`F5` / reload page) and confirm `ET-F-101` attendance, `18 / 20`, and the parent-visible note remain rendered.

### 12. Presenter Quick-Start — Local One-Command Demo (`npm.cmd run demo`)
- **Launch Command (from `edutrack-portal` in PowerShell):**
  ```powershell
  npm.cmd run demo
  ```
  Starts an isolated in-memory PGlite bridge (`http://127.0.0.1:54399`) and a demo-scoped Vite server (`http://127.0.0.1:4179`) without modifying `.env`, `.env.example`, or standard `dev`/`build` settings. On bridge failure, the command prints the error and exits without starting Vite.
- **How to Sign In:** Wait until the terminal prints `Open Browser URL : http://127.0.0.1:4179` and open that URL in Chrome. Use the four demo emails printed in the terminal (`admin.demo@edutrack.local`, `teacher.demo@edutrack.local`, `student.demo@edutrack.local`, `parent.demo@edutrack.local`) along with the local demo password displayed by `npm.cmd run demo` in the console output. Each session starts pre-seeded with `Mr. Rami Physics`, `Physics Group F1`, linked `Youssef Tariq` (`ET-F-101` / `QR-STAGEF-101`), and zero attendance/grade/note rows so all entries happen live.
- **Live Demo Sequence:**
  1. **Admin (`admin.demo@edutrack.local`):** Open `Attendance -> QR Attendance Scanner`, click `Upload Image` and choose the ready card PNG at `scripts/demo/et-f-101-card.png` -> verify `Check-in confirmed` + check-in time; wait >3 seconds and re-upload the same image -> verify `Already Recorded` keeps the first check-in time unchanged. Optionally show `Student ID Cards` (or print `ET-F-101` for physical lens check) and `Sign Out`.
  2. **Teacher (`teacher.demo@edutrack.local`):** Select `Physics Group F1` -> `ET-F-101` -> `Add Grade` (`18 / 20`) -> `Add Note` twice (one `Internal Only`, one `Visible to Parent`) -> `Sign Out`.
  3. **Student (`student.demo@edutrack.local`):** Confirm `ET-F-101`, today's `Present` status + check-in time, `18 / 20`, zero teacher notes (before & after browser reload) -> `Sign Out`.
  4. **Parent (`parent.demo@edutrack.local`):** Select `ET-F-101` -> confirm today's attendance, `18 / 20`, and **only** the `Visible to Parent` note (even after pressing `F5` reload) -> `Sign Out`.
- **Printed Card Camera Check & Upload Fallback:** Keep `scripts/demo/et-f-101-card.png` ready for instant `Upload Image` scanning during the presentation. To verify live lens reading before or during the demo, open `Student ID Cards`, print/display the `ET-F-101` badge (`QR-STAGEF-101`), switch to `QR Attendance Scanner -> Start Camera`, grant browser camera permission, and hold the printed card to `USB2.0 HD UVC WebCam` until `Check-In Confirmed` appears *(not yet recorded as passing: no printed physical badge has been scanned through the lens in automated checks yet)*.
- **Stop & Restart Fresh:** Press `Ctrl+C` in the demo PowerShell terminal to terminate both the PGlite bridge and Vite and release `127.0.0.1:54399` and `127.0.0.1:4179`. Re-run `npm.cmd run demo` at any time to start a completely clean, freshly seeded session from the beginning.

## Sequential Roadmap & Status
- **Stage A (Milestone 5.1):** Teacher-management corrections & integrity guards. **[COMPLETED]**
- **Stage B (COMPLETED):**
  - **Stage B.1:** Secure account linking foundation, database triggers, parent-student links & RPC routines. **[COMPLETED]**
  - **Stage B.2:** Admin account linking UI & expected-user unlink confirmation guards. **[COMPLETED]**
  - **Stage B.3:** Application role routing, session guards, and access gates in UI. **[COMPLETED]**
- **Stage C (COMPLETED):**
  - **Stage C.1:** Scoped read-only Teacher Portal (assigned groups & minimal student roster). **[COMPLETED]**
  - **Stage C.2:** Scoped Teacher grade & feedback writes for assigned groups. **[COMPLETED]**
- **Stage D:** Student portal using real authorized data (profile card, attendance, grades). **[COMPLETED]**
- **Stage E:** Parent portal using explicit child links and permitted notes. **[COMPLETED]**
- **Stage F:** Local grade-bound alignment, repeatable one-command local demo (`npm.cmd run demo` via PGlite bridge + Chrome two-cycle verification), and pre-seeded `scripts/demo/et-f-101-card.png` Upload Image path. **[LOCAL DEMO DELIVERED — Two independent open items remain outside local demo delivery: (1) Official `supabase start` stack execution via Docker + Supabase CLI, and (2) Two-session simultaneous PostgreSQL concurrency check; plus manual physical-card webcam read]**
