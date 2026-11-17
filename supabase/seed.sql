-- =========================================================================
-- EduTrack Optional Demo Seed Data
-- Standard Supabase Seed (supabase/seed.sql)
--
-- Features:
-- 1. Repeatable execution with deterministic identities
-- 2. Conflict targets on natural keys or deterministic primary keys
-- 3. Dynamic foreign-key resolution to preserve existing records
-- 4. Kept outside the automatic migration chain
-- =========================================================================

-- 1. Teachers
INSERT INTO public.teachers (id, full_name, subject, email, phone, room_number)
VALUES 
  ('11111111-1111-4111-8111-111111111111', 'Dr. Salma Farid', 'Science', 'salma.farid@edutrack.com', '+20 100 111 2233', 'Room 204'),
  ('22222222-2222-4222-8222-222222222222', 'Omar Adel', 'Mathematics', 'omar.adel@edutrack.com', '+20 101 222 3344', 'Room 105'),
  ('33333333-3333-4333-8333-333333333333', 'Mina Ayman', 'UI/UX & Computing', 'mina.ayman@edutrack.com', '+20 102 333 4455', 'Lab 3')
ON CONFLICT (email) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  subject = EXCLUDED.subject,
  phone = EXCLUDED.phone,
  room_number = EXCLUDED.room_number;

-- 2. Groups / Classes (Resolves teacher_id dynamically by email)
INSERT INTO public.groups (id, name, grade_level, teacher_id, subject, room, capacity, enrolled_count)
VALUES
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Grade 8A',
    'Grade 8',
    (SELECT id FROM public.teachers WHERE email = 'salma.farid@edutrack.com' LIMIT 1),
    'Science',
    'Room 204',
    30,
    2
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'Grade 7B',
    'Grade 7',
    (SELECT id FROM public.teachers WHERE email = 'omar.adel@edutrack.com' LIMIT 1),
    'Mathematics',
    'Room 105',
    30,
    1
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'Grade 9C',
    'Grade 9',
    (SELECT id FROM public.teachers WHERE email = 'salma.farid@edutrack.com' LIMIT 1),
    'Science',
    'Room 206',
    25,
    1
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  grade_level = EXCLUDED.grade_level,
  teacher_id = EXCLUDED.teacher_id,
  subject = EXCLUDED.subject,
  room = EXCLUDED.room;

-- 3. Students (Resolves group_id dynamically by name, conflict target on student_code)
INSERT INTO public.students (id, full_name, student_code, group_id, grade_level, qr_code_hash, parent_name, parent_phone, status)
VALUES
  (
    'd1111111-1111-4111-8111-111111111111',
    'Lara Hassan',
    'ET-2048',
    (SELECT id FROM public.groups WHERE name = 'Grade 8A' LIMIT 1),
    'Grade 8',
    'QR_LARA_2048',
    'Hassan Mahmoud',
    '+20 120 123 4567',
    'active'
  ),
  (
    'd2222222-2222-4222-8222-222222222222',
    'Adam Nabil',
    'ET-2049',
    (SELECT id FROM public.groups WHERE name = 'Grade 7B' LIMIT 1),
    'Grade 7',
    'QR_ADAM_2049',
    'Nabil Farouk',
    '+20 121 234 5678',
    'active'
  ),
  (
    'd3333333-3333-4333-8333-333333333333',
    'Youssef Ali',
    'ET-2050',
    (SELECT id FROM public.groups WHERE name = 'Grade 9C' LIMIT 1),
    'Grade 9',
    'QR_YOUSSEF_2050',
    'Ali Salem',
    '+20 122 345 6789',
    'active'
  ),
  (
    'd4444444-4444-4444-4444-444444444444',
    'Mariam Samir',
    'ET-2051',
    (SELECT id FROM public.groups WHERE name = 'Grade 8A' LIMIT 1),
    'Grade 8',
    'QR_MARIAM_2051',
    'Samir Ezzat',
    '+20 123 456 7890',
    'active'
  )
ON CONFLICT (student_code) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  group_id = EXCLUDED.group_id,
  grade_level = EXCLUDED.grade_level,
  qr_code_hash = EXCLUDED.qr_code_hash,
  parent_name = EXCLUDED.parent_name,
  parent_phone = EXCLUDED.parent_phone,
  status = EXCLUDED.status;

-- 4. Attendance (Resolves student_id & group_id dynamically)
INSERT INTO public.attendance (student_id, group_id, status, check_in_time, date, scan_method)
VALUES
  (
    (SELECT id FROM public.students WHERE student_code = 'ET-2048' LIMIT 1),
    (SELECT id FROM public.groups WHERE name = 'Grade 8A' LIMIT 1),
    'Present',
    '08:02:00',
    CURRENT_DATE,
    'qr'
  ),
  (
    (SELECT id FROM public.students WHERE student_code = 'ET-2049' LIMIT 1),
    (SELECT id FROM public.groups WHERE name = 'Grade 7B' LIMIT 1),
    'Present',
    '08:05:00',
    CURRENT_DATE,
    'qr'
  ),
  (
    (SELECT id FROM public.students WHERE student_code = 'ET-2050' LIMIT 1),
    (SELECT id FROM public.groups WHERE name = 'Grade 9C' LIMIT 1),
    'Late',
    '08:27:00',
    CURRENT_DATE,
    'qr'
  ),
  (
    (SELECT id FROM public.students WHERE student_code = 'ET-2051' LIMIT 1),
    (SELECT id FROM public.groups WHERE name = 'Grade 8A' LIMIT 1),
    'Present',
    '08:00:00',
    CURRENT_DATE,
    'qr'
  )
ON CONFLICT (student_id, date) DO UPDATE SET
  status = EXCLUDED.status,
  check_in_time = EXCLUDED.check_in_time,
  group_id = EXCLUDED.group_id;

-- 5. Grades (Deterministic Seed UUIDs with dynamic foreign key resolution)
INSERT INTO public.grades (id, student_id, group_id, teacher_id, assessment_title, grade_type, score, max_score, remarks)
SELECT
  'e1111111-1111-4111-8111-111111111111'::uuid,
  s.id,
  g.id,
  t.id,
  'Midterm Science Exam',
  'exam'::grade_category,
  96.0,
  100.0,
  'Exceptional mastery of solar system physics'
FROM (SELECT id FROM public.students WHERE student_code = 'ET-2048' LIMIT 1) s
CROSS JOIN (SELECT id FROM public.groups WHERE name = 'Grade 8A' LIMIT 1) g
CROSS JOIN (SELECT id FROM public.teachers WHERE email = 'salma.farid@edutrack.com' LIMIT 1) t
ON CONFLICT (id) DO UPDATE SET
  student_id = EXCLUDED.student_id,
  group_id = EXCLUDED.group_id,
  teacher_id = EXCLUDED.teacher_id,
  assessment_title = EXCLUDED.assessment_title,
  grade_type = EXCLUDED.grade_type,
  score = EXCLUDED.score,
  max_score = EXCLUDED.max_score,
  remarks = EXCLUDED.remarks;

INSERT INTO public.grades (id, student_id, group_id, teacher_id, assessment_title, grade_type, score, max_score, remarks)
SELECT
  'e2222222-2222-4222-8222-222222222222'::uuid,
  s.id,
  g.id,
  t.id,
  'Lab Experiment #3',
  'assignment'::grade_category,
  94.0,
  100.0,
  'Excellent lab notes and accuracy'
FROM (SELECT id FROM public.students WHERE student_code = 'ET-2048' LIMIT 1) s
CROSS JOIN (SELECT id FROM public.groups WHERE name = 'Grade 8A' LIMIT 1) g
CROSS JOIN (SELECT id FROM public.teachers WHERE email = 'salma.farid@edutrack.com' LIMIT 1) t
ON CONFLICT (id) DO UPDATE SET
  student_id = EXCLUDED.student_id,
  group_id = EXCLUDED.group_id,
  teacher_id = EXCLUDED.teacher_id,
  score = EXCLUDED.score,
  max_score = EXCLUDED.max_score,
  remarks = EXCLUDED.remarks;

INSERT INTO public.grades (id, student_id, group_id, teacher_id, assessment_title, grade_type, score, max_score, remarks)
SELECT
  'e3333333-3333-4333-8333-333333333333'::uuid,
  s.id,
  g.id,
  t.id,
  'Algebra Quiz 2',
  'quiz'::grade_category,
  88.5,
  100.0,
  'Good logic, minor arithmetic slip'
FROM (SELECT id FROM public.students WHERE student_code = 'ET-2049' LIMIT 1) s
CROSS JOIN (SELECT id FROM public.groups WHERE name = 'Grade 7B' LIMIT 1) g
CROSS JOIN (SELECT id FROM public.teachers WHERE email = 'omar.adel@edutrack.com' LIMIT 1) t
ON CONFLICT (id) DO UPDATE SET
  student_id = EXCLUDED.student_id,
  group_id = EXCLUDED.group_id,
  teacher_id = EXCLUDED.teacher_id,
  score = EXCLUDED.score,
  max_score = EXCLUDED.max_score,
  remarks = EXCLUDED.remarks;

INSERT INTO public.grades (id, student_id, group_id, teacher_id, assessment_title, grade_type, score, max_score, remarks)
SELECT
  'e4444444-4444-4444-4444-444444444444'::uuid,
  s.id,
  g.id,
  t.id,
  'Chemistry Lab Report',
  'assignment'::grade_category,
  82.0,
  100.0,
  'Needs closer attention to safety guidelines'
FROM (SELECT id FROM public.students WHERE student_code = 'ET-2050' LIMIT 1) s
CROSS JOIN (SELECT id FROM public.groups WHERE name = 'Grade 9C' LIMIT 1) g
CROSS JOIN (SELECT id FROM public.teachers WHERE email = 'salma.farid@edutrack.com' LIMIT 1) t
ON CONFLICT (id) DO UPDATE SET
  student_id = EXCLUDED.student_id,
  group_id = EXCLUDED.group_id,
  teacher_id = EXCLUDED.teacher_id,
  score = EXCLUDED.score,
  max_score = EXCLUDED.max_score,
  remarks = EXCLUDED.remarks;

INSERT INTO public.grades (id, student_id, group_id, teacher_id, assessment_title, grade_type, score, max_score, remarks)
SELECT
  'e5555555-5555-4555-8555-555555555555'::uuid,
  s.id,
  g.id,
  t.id,
  'Midterm Science Exam',
  'exam'::grade_category,
  92.0,
  100.0,
  'Strong problem solving skills'
FROM (SELECT id FROM public.students WHERE student_code = 'ET-2051' LIMIT 1) s
CROSS JOIN (SELECT id FROM public.groups WHERE name = 'Grade 8A' LIMIT 1) g
CROSS JOIN (SELECT id FROM public.teachers WHERE email = 'salma.farid@edutrack.com' LIMIT 1) t
ON CONFLICT (id) DO UPDATE SET
  student_id = EXCLUDED.student_id,
  group_id = EXCLUDED.group_id,
  teacher_id = EXCLUDED.teacher_id,
  score = EXCLUDED.score,
  max_score = EXCLUDED.max_score,
  remarks = EXCLUDED.remarks;

-- 6. Teacher Notes (Feedback) (Deterministic Seed UUID)
INSERT INTO public.teacher_notes (id, teacher_id, student_id, feedback_text, is_parent_visible)
SELECT
  'f1111111-1111-4111-8111-111111111111'::uuid,
  t.id,
  s.id,
  'Lara is showing wonderful curiosity and steady progress in science. Her class participation has improved significantly.',
  true
FROM (SELECT id FROM public.teachers WHERE email = 'salma.farid@edutrack.com' LIMIT 1) t
CROSS JOIN (SELECT id FROM public.students WHERE student_code = 'ET-2048' LIMIT 1) s
ON CONFLICT (id) DO UPDATE SET
  teacher_id = EXCLUDED.teacher_id,
  student_id = EXCLUDED.student_id,
  feedback_text = EXCLUDED.feedback_text,
  is_parent_visible = EXCLUDED.is_parent_visible;

-- 7. Activity Logs (Deterministic Seed UUIDs)
INSERT INTO public.activity_logs (id, title, description, type, created_at)
VALUES
  ('a1111111-1111-4111-8111-111111111111'::uuid, 'New student enrolled', 'Lara Hassan • Grade 8', 'student', NOW() - INTERVAL '10 minutes'),
  ('a2222222-2222-4222-8222-222222222222'::uuid, 'Class schedule updated', 'Science • Room 204', 'schedule', NOW() - INTERVAL '42 minutes'),
  ('a3333333-3333-4333-8333-333333333333'::uuid, 'Report published', 'Term 1 progress report', 'report', NOW() - INTERVAL '2 hours'),
  ('a4444444-4444-4444-4444-444444444444'::uuid, 'Teacher added', 'Omar Adel • Mathematics', 'teacher', NOW() - INTERVAL '1 day')
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  type = EXCLUDED.type;
