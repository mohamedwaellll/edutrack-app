-- =========================================================================
-- EduTrack Database Schema (PostgreSQL / Supabase)
-- Author: Mohamed Wael (GitHub & Admin / Lead Database Architect)
-- Module: Admin Dashboard, Groups, Attendance, Grades & Teacher Feedback
-- =========================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. ENUMS
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('admin', 'teacher', 'student', 'parent');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE attendance_status AS ENUM ('Present', 'Late', 'Absent', 'Excused');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE grade_category AS ENUM ('exam', 'quiz', 'assignment', 'participation');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. USERS / PROFILES (Shared with Ali Abdelkader's Auth module)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'student',
    phone TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TEACHERS TABLE
CREATE TABLE IF NOT EXISTS public.teachers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    full_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT,
    room_number TEXT,
    hire_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. GROUPS / CLASSES TABLE
CREATE TABLE IF NOT EXISTS public.groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL, -- e.g. "Grade 8A", "Grade 7B"
    grade_level TEXT NOT NULL, -- e.g. "Grade 8"
    teacher_id UUID REFERENCES public.teachers(id) ON DELETE SET NULL,
    subject TEXT, -- e.g. "Science", "Mathematics"
    room TEXT DEFAULT 'Room 204',
    capacity INT DEFAULT 30,
    enrolled_count INT DEFAULT 0,
    schedule TEXT DEFAULT 'Sun - Thu: 08:00 AM - 02:00 PM',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. STUDENTS TABLE
CREATE TABLE IF NOT EXISTS public.students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    full_name TEXT NOT NULL,
    student_code TEXT UNIQUE NOT NULL, -- e.g. "ET-2048"
    group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL,
    grade_level TEXT NOT NULL,
    qr_code_hash TEXT UNIQUE NOT NULL, -- Scanned by Abdelrahman Khodary's scanner
    parent_name TEXT,
    parent_phone TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'graduated')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. ATTENDANCE TABLE (Realtime enabled for Youssef & Abdelrahman)
CREATE TABLE IF NOT EXISTS public.attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL,
    status attendance_status NOT NULL DEFAULT 'Present',
    check_in_time TIME NOT NULL DEFAULT CURRENT_TIME,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    scan_method TEXT DEFAULT 'qr' CHECK (scan_method IN ('qr', 'manual')),
    scanned_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_daily_attendance UNIQUE(student_id, date)
);

-- 7. GRADES TABLE (Managed via TeacherDashboard)
CREATE TABLE IF NOT EXISTS public.grades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    teacher_id UUID REFERENCES public.teachers(id) ON DELETE SET NULL,
    assessment_title TEXT NOT NULL, -- e.g. "Chapter 06 Exam"
    grade_type grade_category NOT NULL DEFAULT 'exam',
    score NUMERIC(5,2) NOT NULL,
    max_score NUMERIC(5,2) NOT NULL DEFAULT 100,
    assessment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. TEACHER NOTES & FEEDBACK TABLE (Feeds ParentDashboard & Student progress)
CREATE TABLE IF NOT EXISTS public.teacher_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    feedback_text TEXT NOT NULL,
    is_parent_visible BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. RECENT ACTIVITY LOGS
CREATE TABLE IF NOT EXISTS public.activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    type TEXT NOT NULL, -- 'student' | 'schedule' | 'report' | 'teacher'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =========================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Admins full access
CREATE POLICY "Admins have full access" ON public.groups FOR ALL USING (true);
CREATE POLICY "Admins have full access" ON public.teachers FOR ALL USING (true);
CREATE POLICY "Admins have full access" ON public.students FOR ALL USING (true);
CREATE POLICY "Admins have full access" ON public.attendance FOR ALL USING (true);
CREATE POLICY "Admins have full access" ON public.grades FOR ALL USING (true);
CREATE POLICY "Admins have full access" ON public.teacher_notes FOR ALL USING (true);
CREATE POLICY "Admins have full access" ON public.activity_logs FOR ALL USING (true);

-- =========================================================================
-- SEED DATA (Matches EduTrack UI Mockups Exactly)
-- =========================================================================

-- Teachers
INSERT INTO public.teachers (id, full_name, subject, email, phone, room_number)
VALUES 
  ('11111111-1111-1111-1111-111111111111', 'Dr. Salma Farid', 'Science', 'salma.farid@edutrack.com', '+20 100 111 2233', 'Room 204'),
  ('22222222-2222-2222-2222-222222222222', 'Omar Adel', 'Mathematics', 'omar.adel@edutrack.com', '+20 101 222 3344', 'Room 105'),
  ('33333333-3333-3333-3333-333333333333', 'Mina Ayman', 'UI/UX & Computing', 'mina.ayman@edutrack.com', '+20 102 333 4455', 'Lab 3')
ON CONFLICT (email) DO NOTHING;

-- Groups / Classes
INSERT INTO public.groups (id, name, grade_level, teacher_id, subject, room, capacity, enrolled_count)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Grade 8A', 'Grade 8', '11111111-1111-1111-1111-111111111111', 'Science', 'Room 204', 30, 28),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Grade 7B', 'Grade 7', '22222222-2222-2222-2222-222222222222', 'Mathematics', 'Room 105', 30, 27),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Grade 9C', 'Grade 9', '11111111-1111-1111-1111-111111111111', 'Science', 'Room 206', 25, 24)
ON CONFLICT DO NOTHING;

-- Students
INSERT INTO public.students (id, full_name, student_code, group_id, grade_level, qr_code_hash, parent_name, parent_phone, status)
VALUES
  ('s1111111-1111-1111-1111-111111111111', 'Lara Hassan', 'ET-2048', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Grade 8A', 'QR_LARA_2048', 'Hassan Mahmoud', '+20 120 123 4567', 'active'),
  ('s2222222-2222-2222-2222-222222222222', 'Adam Nabil', 'ET-2049', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Grade 7B', 'QR_ADAM_2049', 'Nabil Farouk', '+20 121 234 5678', 'active'),
  ('s3333333-3333-3333-3333-333333333333', 'Youssef Ali', 'ET-2050', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Grade 9C', 'QR_YOUSSEF_2050', 'Ali Salem', '+20 122 345 6789', 'active'),
  ('s4444444-4444-4444-4444-444444444444', 'Mariam Samir', 'ET-2051', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Grade 8A', 'QR_MARIAM_2051', 'Samir Ezzat', '+20 123 456 7890', 'active')
ON CONFLICT (student_code) DO NOTHING;

-- Attendance (Today)
INSERT INTO public.attendance (student_id, group_id, status, check_in_time, date, scan_method)
VALUES
  ('s1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Present', '08:02:00', CURRENT_DATE, 'qr'),
  ('s2222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Present', '08:05:00', CURRENT_DATE, 'qr'),
  ('s3333333-3333-3333-3333-333333333333', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Late',    '08:27:00', CURRENT_DATE, 'qr'),
  ('s4444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Present', '08:00:00', CURRENT_DATE, 'qr')
ON CONFLICT (student_id, date) DO UPDATE 
SET status = EXCLUDED.status, check_in_time = EXCLUDED.check_in_time;

-- Grades
INSERT INTO public.grades (student_id, group_id, teacher_id, assessment_title, grade_type, score, max_score, remarks)
VALUES
  ('s1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Midterm Science Exam', 'exam', 96.0, 100.0, 'Exceptional mastery of solar system physics'),
  ('s1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Lab Experiment #3', 'assignment', 94.0, 100.0, 'Excellent lab notes and accuracy'),
  ('s2222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Algebra Quiz 2', 'quiz', 88.5, 100.0, 'Good logic, minor arithmetic slip'),
  ('s3333333-3333-3333-3333-333333333333', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'Chemistry Lab Report', 'assignment', 82.0, 100.0, 'Needs closer attention to safety guidelines'),
  ('s4444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Midterm Science Exam', 'exam', 92.0, 100.0, 'Strong problem solving skills')
ON CONFLICT DO NOTHING;

-- Teacher Notes (Feedback)
INSERT INTO public.teacher_notes (teacher_id, student_id, feedback_text, is_parent_visible)
VALUES
  ('11111111-1111-1111-1111-111111111111', 's1111111-1111-1111-1111-111111111111', 'Lara is showing wonderful curiosity and steady progress in science. Her class participation has improved significantly.', true)
ON CONFLICT DO NOTHING;

-- Activity Logs
INSERT INTO public.activity_logs (title, description, type, created_at)
VALUES
  ('New student enrolled', 'Lara Hassan • Grade 8', 'student', NOW() - INTERVAL '10 minutes'),
  ('Class schedule updated', 'Science • Room 204', 'schedule', NOW() - INTERVAL '42 minutes'),
  ('Report published', 'Term 1 progress report', 'report', NOW() - INTERVAL '2 hours'),
  ('Teacher added', 'Omar Adel • Mathematics', 'teacher', NOW() - INTERVAL '1 day')
ON CONFLICT DO NOTHING;
