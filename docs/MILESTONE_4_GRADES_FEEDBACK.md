# Milestone 4 — Admin-managed grades and feedback

## Scope

The existing **Grades & Feedback** navigation entry (formerly **Go to Teacher View**)
now opens a live admin workflow. Teacher, parent and student accounts remain blocked
by the existing access gate and admin-only RLS. This is not a teacher login rollout.

- Groups are selected by UUID, so identical group names do not mix records.
- Forms offer active students belonging to the selected group.
- Grade inserts use real IDs, an explicit assessment date (default: today in Cairo),
  and the selected category. Zero is a valid score; maximum must be positive and
  no more than 999.99 (the existing numeric column limit).
- The ledger and its equal-weight assessment percentage use persisted records.
- Feedback requires a real teacher selected as its author. The author selection is
  administrative attribution, not a claim that the teacher is the signed-in user.
- No mock records or simulated saves remain in `teacherService`.
- An error preserves the form and does not append a local success row. While a save
  is pending, repeated submits are ignored. A successful save uses the returned ID.
- Private notes display **Internal only**. Parent visibility is stored as a flag;
  this milestone does not provide parent access, notifications or realtime delivery.
- Feedback filtering follows students' current groups; grades retain their recorded group.

## Database rollout

Apply only missing migrations in filename order, through:

1. `20261120000001_edutrack_qr_attendance_and_cairo_time.sql`
2. `20261120000002_edutrack_qr_concurrency_and_time_fix.sql`
3. `20261120000003_edutrack_grades_and_feedback_integrity.sql` **(new)**
4. `20261120000004_edutrack_assessment_lock_permissions.sql` **(permission fix)**

The preceding schema, admin-auth and manual-attendance migrations are prerequisites.
For an existing setup already through step 2, run steps 3 and 4 in Supabase SQL Editor.
If step 3 is already applied, run only step 4.
Do not rerun the demo seed against real records as part of this upgrade.

The new migration is transactional and repeatable. It grants specific table operations
to `authenticated` while preserving admin-only RLS. It validates grades and notes on
INSERT/UPDATE, including student group/status, score bounds, dates, nonblank content
and visibility. It locks the student row during validation. Existing historical rows
are retained without rewriting or backfilling them. Editing old records also has to
satisfy the new rules.

### Permission correction

The initial grade/note triggers used `SELECT ... FOR SHARE` as the caller. PostgreSQL
requires UPDATE privilege for this lock, but deployed clients only have SELECT/INSERT
on students. This caused `permission denied for table students` during saves. The
earlier broad-grant test fixture masked that mismatch.

Step 4 makes only these validation triggers SECURITY DEFINER, with a fixed search path,
an explicit admin/trusted-SQL-caller guard and revoked direct execution privileges.
RLS remains enabled and unchanged; clients do not receive UPDATE access to students.
A regression test uses only grants from the migration chain, reproduces both failed
inserts before the fix, then checks successful grade/note saves, denied student edits,
non-admin/missing-identity/anonymous rejection, and repeatable application of the fix.

## Acceptance checks

1. Sign in as admin and open **Grades & Feedback**.
2. Choose a group containing an active student. Record an assessment, e.g. 8 / 10.
3. Refresh the page and verify that the assessment is still present and shows 80%.
4. Choose another group: its student options, grades and summary should change.
5. Save feedback with a real teacher and parent visibility unchecked. Refresh and
   verify **Internal only**. If the teachers directory is empty, feedback is disabled;
   teacher provisioning/management must supply a record first.
6. Verify that invalid scores, future dates and empty titles/feedback are rejected.
7. Simulate a failed save: keep the form contents and show an error without a new row.
8. Non-admin and anonymous sessions must remain unable to read or write these tables.

## Verification boundaries

Automated service and React component tests cover empty/error states, group IDs,
confirmed saves, pending-submit protection and visibility. Database execution tests
run the real migration chain in isolated PGlite and exercise validation, non-destructive
reapplication, and RLS. These are not a deployment to the hosted Supabase project or
a manual browser/webcam acceptance test. Hosted deployment and the checks above must
be confirmed separately.

Remaining wider-project work includes teacher account permissions and assignments,
teacher directory management, parent/student account linking and live dashboards.
The root PDF describes a different Next.js architecture in places; the current
`edutrack-portal` is React/Vite and should not be treated as that PDF's completed app.
