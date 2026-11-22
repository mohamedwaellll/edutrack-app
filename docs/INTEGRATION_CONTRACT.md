# Integration Contract & Architectural Specification

> **Status Notice:**
> **Sole Developer Model:** Mohamed owns all components, contracts, and migrations.
> This document distinguishes **currently implemented functionality** from **proposed future stage architecture**.
> Work progresses sequentially: Stage A (Milestone 5.1 - Completed) -> Stage B (B.1, B.2 & B.3 Completed) -> Stage C (C.1 & C.2 Completed) -> Stage D (Completed) -> Stage E (Completed) -> Stage F (Planned).

Canonical stack: React 18 / Vite / TypeScript / Supabase PostgreSQL.

---

## 1. Implemented Architecture (Active Baseline)

### Schema & Data Model
- `profiles`: `id` references `auth.users(id)`; role is one of `admin`, `teacher`, `student`, `parent`.
  - Non-admins cannot insert profiles with roles other than `'student'`.
  - Profile role cannot be changed while an active teacher, student, or parent link exists, enforced by both `tr_check_profile_role` (`BEFORE UPDATE`) and `tr_enforce_profile_role_link_consistency` (`AFTER UPDATE` + `FOR SHARE` locking on link creation).
- `teachers`: directory table (`id`, `full_name`, `subject`, `email`, `phone`, `user_id`).
  - `email` is strictly unique case-insensitively via `idx_teachers_email_lower`.
  - `user_id` has partial unique index `idx_teachers_user_id` (enforces 1:1 account linking).
  - Direct `user_id` assignment on insert is blocked at the database trigger layer.
  - Updates to `user_id` must reference a profile with `role = 'teacher'` (locked `FOR SHARE`).
- `groups`: `id`, `name`, `grade_level`, `teacher_id` (foreign key to `teachers.id`, nullable). Column-level `GRANT UPDATE (teacher_id, updated_at)` restricts authenticated group mutation.
- `students`: `id`, `student_code`, `group_id`, `grade_level`, `qr_code_hash`, `parent_name`, `parent_phone`, `status`, `user_id`.
  - `user_id` has partial unique index `idx_students_user_id` (enforces 1:1 account linking).
  - Direct `user_id` assignment during student creation (`INSERT`) is blocked by both column-level `GRANT INSERT (...)` (omitting `user_id`) and trigger `tr_validate_student_user_id`.
  - Account linking is managed exclusively via `link_student_account` / `unlink_student_account`, which require `role = 'student'` and coordinate `FOR SHARE` on `profiles`.
- `parent_student_links`: explicit link table (`id`, `parent_id`, `student_id`, `created_at`, `created_by`).
  - Unique constraint `uq_parent_student_link (parent_id, student_id)` prevents duplicate links.
  - Supports 1:N (one parent to multiple children) and N:1 (one child to multiple guardians).
  - Direct mutations are revoked from `authenticated`; read access enforced via RLS (`parent_id = auth.uid()` or admin).
- `attendance`: `student_id`, `group_id`, `status`, `check_in_time`, `date`, `scan_method`. Cairo timezone logic enforced.
- `grades`: `student_id`, `group_id`, `teacher_id`, `assessment_title`, `grade_type`, `score`, `max_score`, `assessment_date`, `remarks`.
- `teacher_notes`: `student_id`, `teacher_id`, `feedback_text`, `is_parent_visible`, `created_at`.

### Trusted Administrative RPC Operations (`SECURITY DEFINER`, `search_path = public`)
All administrative linking routines enforce `public.is_admin()`, lock target `profiles` rows `FOR SHARE`, execute atomic conditional mutations (`UPDATE ... WHERE user_id IS NULL RETURNING`), verify the actually modified row before returning success, return accurate `previous_user_id` via `FOR UPDATE` on unlinks, and return JSONB:
1. `public.link_teacher_account(p_teacher_id UUID, p_user_id UUID)`
2. `public.unlink_teacher_account(p_teacher_id UUID, p_expected_user_id UUID DEFAULT NULL)`
3. `public.link_student_account(p_student_id UUID, p_user_id UUID)`
4. `public.unlink_student_account(p_student_id UUID, p_expected_user_id UUID DEFAULT NULL)`
5. `public.link_parent_student(p_parent_id UUID, p_student_id UUID)`
6. `public.unlink_parent_student(p_parent_id UUID, p_student_id UUID)`

### TypeScript Service Contracts: `src/services/accountLinkingService.ts`
- `linkTeacherAccount(teacherId: string, userId: string): Promise<ServiceResult<LinkTeacherResult>>`
- `unlinkTeacherAccount(teacherId: string, expectedUserId?: string): Promise<ServiceResult<UnlinkTeacherResult>>`
- `linkStudentAccount(studentId: string, userId: string): Promise<ServiceResult<LinkStudentResult>>`
- `unlinkStudentAccount(studentId: string, expectedUserId?: string): Promise<ServiceResult<UnlinkStudentResult>>`
- `linkParentStudent(parentId: string, studentId: string): Promise<ServiceResult<LinkParentStudentResult>>`
- `unlinkParentStudent(parentId: string, studentId: string): Promise<ServiceResult<UnlinkParentStudentResult>>`
- `getParentStudentLinks(parentId?: string): Promise<ServiceResult<ParentStudentLink[]>>`
- `getProfilesByRole(role: UserRole): Promise<ServiceResult<UserProfile[]>>`

### Admin UI Contract (`src/components/AdminDashboard.tsx` & `src/components/AccountLinkingPanel.tsx`)
- `Account Linking` tab loads fresh records on open and surfaces Teachers, Students (with `student_code`), and Parents & Children workflows using explicit UUID selection (zero auto-linking), synchronous visible-option validation across search/reload/Enter submits (clearing child selection if parent selection is lost), two-sided unlink confirmation modals passing `expectedUserId`, double-click guards, and pathway-isolated post-save / post-conflict refresh states where Retry/Reload List only re-fetches without re-saving.

### Role-Based Routing & Session Gates (`src/contexts/AuthContext.tsx`, `src/App.tsx`, `src/components/RolePortalLanding.tsx`, `src/components/AccessDenied.tsx`, `src/components/AuthPage.tsx`)
- `AuthPortalStatus` explicitly separates `authenticated_admin`, `authenticated_teacher`, `authenticated_student`, and `authenticated_parent`, alongside fail-closed `missing_profile`, `profile_error`, and `unknown_role` states.
- `resolveAuthAccessDecision` unifies access evaluation across session restore, auth events, interactive login (`AuthPage`), and `refreshProfile` (`Recheck Access`), rejecting profile ID mismatches (`profile.id !== session.user.id`).
- `AuthProvider` tracks a monotonic request epoch covering `getSession()`, `onAuthStateChange`, `signIn`, `signOut`, and `refreshProfile`. Identity changes immediately switch to `'loading'` and clear `profile`; same-user `TOKEN_REFRESHED` / duplicate `SIGNED_IN` re-verifies role permissions via `isRevalidating` (blocking protected mutations across `AdminDashboard`, `AccountLinkingPanel`, `TeacherDashboard`, and `AttendanceQRScanner` until confirmed without queueing writes, while preserving active tabs/drafts unless role changes or verification fails); and failed/in-flight `signOut()` retains the outgoing user ID (`signingOutUserIdRef`) across `'signing_out'` and `'signout_error'` so duplicate `SIGNED_IN` events cannot restore the portal prior to `Retry Sign Out` completion.
- `App.tsx` gates `<AdminDashboard key={user.id} />` and teammate UI previews exclusively behind verified admin sessions (`status === 'authenticated_admin' && profile.role === 'admin' && profile.id === user.id`), clears `isolatedPreview` on session/role changes, routes verified `'authenticated_teacher'` sessions to `<TeacherPortal key={user.id} />`, routes verified `'authenticated_student'` sessions to `<StudentPortal key={user.id} />`, and routes verified `'authenticated_parent'` sessions (`profile.id === user.id && profile.role === 'parent'`) to `<ParentPortal key={user.id} />`.

### Stage C.1 Scoped Read-Only Teacher Portal (`get_teacher_portal_context`, `get_teacher_group_students`, `src/services/teacherPortalService.ts`, `src/components/TeacherPortal.tsx`)
- `public.get_teacher_portal_context()` and `public.get_teacher_group_students(p_group_id UUID)` (`SECURITY DEFINER`, `SET search_path = public`, executable only by `authenticated`) derive identity solely from `auth.uid()`, require `profiles.role = 'teacher'`, resolve `teachers.user_id = auth.uid()`, verify `groups.teacher_id = v_teacher_id` on every roster read, and expose ONLY `{ id, full_name, student_code, status, group_id }` while excluding `parent_name`, `parent_phone`, `qr_code_hash`, and `user_id` (with direct table `SELECT` on `students`, `groups`, and `teachers` kept strictly admin-only).
- `TeacherPortal` renders assigned groups and minimal student rosters read-only, clearly distinguishes unlinked teacher accounts, zero assigned groups, empty groups, and load failures with `Retry`, and discards stale group-switch or account-switch responses.

### Stage C.2 Scoped Teacher Grade & Note Writes (`save_teacher_student_grade`, `save_teacher_student_note`, `get_teacher_student_records`)
- `validate_grade_record()` and `validate_teacher_note()` support an `INSERT`-only scoped teacher portal path (`edutrack.teacher_portal_write = '1'`) alongside existing admin/maintenance writes, while direct table writes on `grades` and `teacher_notes` remain blocked by `public.is_admin()` RLS and triggers.
- Write RPCs lock `profiles -> teachers -> groups -> students` `FOR SHARE` in the same transaction, derive `teacher_id` exclusively from `auth.uid()` / `teachers.user_id`, verify active student membership and group assignment, enforce score bounds (`0 <= score <= max_score`, `0 < max_score < 1000`) and Cairo date bounds (`<= Africa/Cairo today`), and return only the authenticated teacher's own records via `get_teacher_student_records`.
- `TeacherPortal` + `teacherPortalService` treat unknown student statuses as `'unknown'` (active-only writes), default notes to internal only (`isParentVisible = false`), block submits during `isRevalidating` while preserving drafts, close modals & refresh groups on revocation errors, and allow read-only `Retry` if post-save refresh fails.

### Stage D Scoped Read-Only Student Portal (`get_student_portal_data`, `src/services/studentPortalService.ts`, `src/components/StudentPortal.tsx`)
- `public.get_student_portal_data()` (`SECURITY DEFINER`, `SET search_path = pg_catalog, public`, executable only by `authenticated`) derives student identity exclusively from `auth.uid()` -> `profiles.role = 'student'` -> `students.user_id`, returns `{ linked: false }` cleanly when unlinked, and returns strictly allow-listed fields: student card (`id`, `full_name`, `student_code`, `grade_level`, `status`, optional current `group`), recorded attendance (`id`, `date`, `status`, `check_in_time` newest first), and student grades (`id`, `assessment_title`, `grade_type`, `score`, `max_score`, `assessment_date` newest first, retained even if group or teacher changes). `qr_code_hash`, `parent_name`, `parent_phone`, `user_id`, `remarks`, `teacher_id`, and all `teacher_notes` are omitted, and direct table `SELECT` policies remain admin-only.
- `StudentPortal` handles loading, unlinked state, unassigned group state, empty attendance/grades (with unlisted-day non-absence policy note), and read errors with `Retry` (including strict Stage E payload validation via `src/services/portalPayloadValidation.ts` enforcing non-empty arrays, known status/grade enums, and valid numeric scores while keeping `score === 0`, `check_in_time === null`, and `[]`), wipes data immediately on sign-out or identity switch, and ignores stale responses.

### Stage E Scoped Read-Only Parent Portal (`get_parent_portal_children`, `get_parent_child_details`, `src/services/parentPortalService.ts`, `src/components/ParentPortal.tsx`)
- `public.get_parent_portal_children()` and `public.get_parent_child_details(p_student_id UUID)` (`SECURITY DEFINER`, `SET search_path = pg_catalog, public`, executable only by `authenticated`) derive parent identity exclusively from `auth.uid()` -> `profiles.role = 'parent'` and verify active `public.parent_student_links` membership on EVERY read (supporting linked children with `students.user_id IS NULL`).
- Child responses expose strictly allow-listed fields (`id`, `full_name`, `student_code`, `grade_level`, `status`, optional `group`), recorded attendance, saved grades, and teacher notes filtered strictly in SQL (`WHERE tn.is_parent_visible IS TRUE`, returning `id`, `author_name` from `teachers.full_name`, `feedback_text`, `note_date`, `created_at`). Internal notes, `qr_code_hash`, `parent_name`, `parent_phone`, `user_id`, `remarks`, and unlinked children are omitted, and direct table `SELECT` policies remain unchanged.
- `ParentPortal` disambiguates same-name linked children via `full_name` + `student_code`, immediately wipes prior child state and rejects stale delayed RPCs on child switch, reloads the children list and clears child details upon link revocation errors, distinguishes zero linked children vs empty child records vs read errors with `Retry`, and clears all state immediately on sign-out or account switch.

---

## 2. Proposed Future Stage Architecture (Planned, Not Yet Implemented)

### Stage F: Live Browser QA, Camera Hardware & Release Preparation
- Physical webcam / mobile QR scanning validation and deployment verification against hosted Supabase infrastructure.

---

## 3. Migration Sequence & Dependencies
1. `20261103_edutrack_schema.sql` (Initial schema)
2. `20261117_edutrack_admin_auth_upgrade.sql` (Admin role upgrade)
3. `20261118000001_edutrack_auth_triggers_fail_closed.sql` (Fail-closed triggers)
4. `20261119000001_edutrack_manual_attendance_and_grants.sql` (Manual attendance)
5. `20261120000001_edutrack_qr_attendance_and_cairo_time.sql` (QR attendance)
6. `20261120000002_edutrack_qr_concurrency_and_time_fix.sql` (Concurrency fix)
7. `20261120000003_edutrack_grades_and_feedback_integrity.sql` (Grades integrity)
8. `20261120000004_edutrack_assessment_lock_permissions.sql` (Assessment locks)
9. `20261120000005_edutrack_teacher_management_and_group_assignment.sql` (Teacher management)
10. `20261121000001_edutrack_teacher_management_corrections.sql` (Milestone 5.1 — Stage A Corrections)
11. `20261121000002_edutrack_secure_account_linking.sql` (Stage B.1 — Secure Account Linking Foundation)
12. `20261121000003_edutrack_stage_b1_corrective_hardening.sql` (Stage B.1 Corrective Hardening — Atomic RPCs, Student Column INSERT Privileges & Profile-Link Lock Coordination)
13. `20261121000004_edutrack_stage_b2_expected_unlink_guards.sql` (Stage B.2 — Expected User ID Verification on Unlink Confirmation)
14. `20261121000005_edutrack_stage_c1_teacher_read_only_scope.sql` (Stage C.1 — Scoped Read-Only Teacher Portal RPCs)
15. `20261121000006_edutrack_stage_c2_teacher_grade_and_note_writes.sql` (Stage C.2 — Scoped Teacher Grade & Note Writes + Scoped Record Reads)
16. `20261121000007_edutrack_stage_d_student_read_only_portal.sql` (Stage D — Scoped Read-Only Student Portal RPC)
17. `20261122000001_edutrack_stage_e_parent_read_only_portal.sql` (**Stage E — Scoped Read-Only Parent Portal RPCs**)
18. Future Stage F migrations (if needed) will follow chronologically.
