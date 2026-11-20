# Team ownership

Coordination agreement; not an enabled GitHub access restriction.

## علي — feature/auth-role-access

src/App.tsx; src/contexts/AuthContext.tsx; AuthPage.tsx; AccessDenied.tsx; src/lib/*; src/types/database.ts; supabase/migrations/* بالتنسيق

## عبدالرحمن — feature/attendance-qr

AttendanceQRScanner.tsx; StudentIdCard.tsx; StudentCardsPrintPage.tsx; src/services/attendanceService.ts; اختبارات الحضور والكاميرا

## مينا — feature/student-portal

src/components/StudentDashboard.tsx; src/services/studentService.ts; src/types/student.ts عند الحاجة; src/__tests__/student/*

## يوسف — feature/parent-portal

src/components/ParentDashboard.tsx; src/services/parentService.ts; src/types/parent.ts عند الحاجة; src/__tests__/parent/*

## محمد — feature/admin-teacher-workflows

AdminDashboard.tsx; TeacherDashboard.tsx; adminService.ts; teacherService.ts; package.json; package-lock.json; .github/*; docs/*

Ali owns final migrations/shared database types. Mohamed's first correction is a coordinated exception and must land before role migrations.
Mohamed owns packages/lockfile/CI and coordinates edits to shared databaseExecution.test.ts. Prefer separate domain test files.
Ali owns App.tsx routing; other owners supply component exports, not competing routing code.
Abdelrahman owns StudentIdCard; Mina consumes agreed props.
Only Ali/Mohamed allocate migration versions. Never rewrite shared migration history.
Request cross-owner changes and dependency additions before implementing them.
