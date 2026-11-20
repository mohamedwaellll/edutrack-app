# Integration contract — proposed, pending Ali/Mohamed review

This file separates current schema from proposed APIs. It is not a claim that roles or new services work yet.
Canonical stack: React 18 / Vite / TypeScript / Supabase.

## Existing schema

profiles.id identifies the auth user; roles are admin/teacher/student/parent.
teachers.user_id and students.user_id are optional profile links.
students.group_id identifies their current group; groups.teacher_id identifies at most one teacher per group.
attendance includes student_id/group_id/status/check_in_time/date/scan_method. Preserve Cairo rules.
grades includes student_id/group_id/teacher_id/assessment_title/grade_type/score/max_score/assessment_date/remarks.
teacher_notes includes student_id/teacher_id/feedback_text/is_parent_visible/created_at.
ServiceResult<T> = { data: T | null; error: string | null; code?: string }.
Map DB group_id to existing UI class_id in services; do not silently rename schema fields.

## Proposed identity contract

Ali validates/implements parent_student_links(parent_user_id -> profiles.id, student_id -> students.id), unique pair, with multiple children and authorized guardians supported.
Only trusted administration manages identity links and roles. Validate parent role. Resolve historical duplicate teacher/student user_id links without deleting data automatically.
Do not infer links from names, phones or email similarity.

## Release capabilities

| Role | Read | Write |
|---|---|---|
| Admin | Administrative records | Approved admin workflows and controlled linking |
| Teacher | Own groups and authorized student records | Grades/feedback in own groups with server-derived author |
| Student | Own profile/group/card/attendance/grades | No academic or identity writes |
| Parent | Linked children and parent-visible feedback | None |

Attendance capture remains admin-only. Private notes must be excluded by RLS/API. Unknown roles/missing links fail closed.
Editing records created by other teachers needs an explicit policy decision before adding edit UI.

## Proposed services to freeze

studentService.getMyStudent/getMyAttendance/getMyGrades: derive identity from auth.
parentService.getLinkedChildren/getChildAttendance/getChildGrades/getChildFeedback: child ID must be authorized by RLS.
teacherService requires assigned-group queries for teacher sessions; current adminService-based queries cannot simply be exposed.
Ali supplies verified profile/session/link state; domain UI does not grant roles.
Empty arrays and errors are distinct. No mock fallback in real runtime.

## Dependencies

Chain currently ends at ...000005, with review corrections outstanding.
Mohamed's corrective migration uses the next available version after rechecking the queue. Ali's role expansion follows it.
Do not apply old admin-only policy migrations after role expansion. Ali applies approved files to development Supabase in order, recording outcomes.
Test with actual grants; report isolated DB/browser/hosted DB/physical camera separately.
