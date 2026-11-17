-- =========================================================================
-- EduTrack Optional Demo Seed Data
-- Valid RFC 4122 hexadecimal UUIDs only (0-9, a-f)
-- Repeatable execution with ON CONFLICT guards
-- =========================================================================

-- 1. Teachers
INSERT INTO public.teachers (id, full_name, subject, email, phone, room_number)
VALUES 
  ('11111111-1111-4111-8111-111111111111', 'Dr. Salma Farid', 'Science', 'salma.farid@edutrack.com', '+20 100 111 2233', 'Room 204'),
  ('22222222-2222-4222-8222-222222222222', 'Omar Adel', 'Mathematics', 'omar.adel@edutrack.com', '+20 101 222 3344', 'Room 105'),
  ('33333333-3333-4333-8333-333333333333', 'Mina Ayman', 'UI/UX & Computing', 'mina.ayman@edutrack.com', '+20 102 333 4455', 'Lab 3')
ON CONFLICT (email) DO NOTHING;

-- 2. Groups / Classes
INSERT INTO public.groups (id, name, grade_level, teacher_id, subject, room, capacity, enrolled_count)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Grade 8A', 'Grade 8', '11111111-1111-4111-8111-111111111111', 'Science', 'Room 204', 30, 2),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Grade 7B', 'Grade 7', '22222222-2222-4222-8222-222222222222', 'Mathematics', 'Room 105', 30, 1),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Grade 9C', 'Grade 9', '11111111-1111-4111-8111-111111111111', 'Science', 'Room 206', 25, 1)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  grade_level = EXCLUDED.grade_level,
  teacher_id = EXCLUDED.teacher_id,
  subject = EXCLUDED.subject,
  room = EXCLUDED.room;

-- 3. Students (Valid Hexadecimal UUIDs)
INSERT INTO public.students (id, full_name, student_code, group_id, grade_level, qr_code_hash, parent_name, parent_phone, status)
VALUES
  ('d1111111-1111-4111-8111-111111111111', 'Lara Hassan', 'ET-2048', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Grade 8', 'QR_LARA_2048', 'Hassan Mahmoud', '+20 120 123 4567', 'active'),
  ('d2222222-2222-4222-8222-222222222222', 'Adam Nabil', 'ET-2049', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Grade 7', 'QR_ADAM_2049', 'Nabil Farouk', '+20 121 234 5678', 'active'),
  ('d3333333-3333-4333-8333-333333333333', 'Youssef Ali', 'ET-2050', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Grade 9', 'QR_YOUSSEF_2050', 'Ali Salem', '+20 122 345 6789', 'active'),
  ('d4444444-4444-4444-4444-444444444444', 'Mariam Samir', 'ET-2051', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Grade 8', 'QR_MARIAM_2051', 'Samir Ezzat', '+20 123 456 7890', 'active')
ON CONFLICT (student_code) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  group_id = EXCLUDED.group_id,
  grade_level = EXCLUDED.grade_level,
  qr_code_hash = EXCLUDED.qr_code_hash,
  parent_name = EXCLUDED.parent_name,
  parent_phone = EXCLUDED.parent_phone,
  status = EXCLUDED.status;

-- 4. Attendance
INSERT INTO public.attendance (student_id, group_id, status, check_in_time, date, scan_method)
VALUES
  ('d1111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Present', '08:02:00', CURRENT_DATE, 'qr'),
  ('d2222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Present', '08:05:00', CURRENT_DATE, 'qr'),
  ('d3333333-3333-4333-8333-333333333333', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Late',    '08:27:00', CURRENT_DATE, 'qr'),
  ('d4444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Present', '08:00:00', CURRENT_DATE, 'qr')
ON CONFLICT (student_id, date) DO UPDATE SET
  status = EXCLUDED.status,
  check_in_time = EXCLUDED.check_in_time;

-- 5. Grades
INSERT INTO public.grades (student_id, group_id, teacher_id, assessment_title, grade_type, score, max_score, remarks)
VALUES
  ('d1111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'Midterm Science Exam', 'exam', 96.0, 100.0, 'Exceptional mastery of solar system physics'),
  ('d1111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'Lab Experiment #3', 'assignment', 94.0, 100.0, 'Excellent lab notes and accuracy'),
  ('d2222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'Algebra Quiz 2', 'quiz', 88.5, 100.0, 'Good logic, minor arithmetic slip'),
  ('d3333333-3333-4333-8333-333333333333', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-4111-8111-111111111111', 'Chemistry Lab Report', 'assignment', 82.0, 100.0, 'Needs closer attention to safety guidelines'),
  ('d4444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'Midterm Science Exam', 'exam', 92.0, 100.0, 'Strong problem solving skills')
ON CONFLICT DO NOTHING;

-- 6. Teacher Notes (Feedback)
INSERT INTO public.teacher_notes (teacher_id, student_id, feedback_text, is_parent_visible)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111', 'Lara is showing wonderful curiosity and steady progress in science. Her class participation has improved significantly.', true)
ON CONFLICT DO NOTHING;

-- 7. Activity Logs
INSERT INTO public.activity_logs (title, description, type, created_at)
VALUES
  ('New student enrolled', 'Lara Hassan • Grade 8', 'student', NOW() - INTERVAL '10 minutes'),
  ('Class schedule updated', 'Science • Room 204', 'schedule', NOW() - INTERVAL '42 minutes'),
  ('Report published', 'Term 1 progress report', 'report', NOW() - INTERVAL '2 hours'),
  ('Teacher added', 'Omar Adel • Mathematics', 'teacher', NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;
