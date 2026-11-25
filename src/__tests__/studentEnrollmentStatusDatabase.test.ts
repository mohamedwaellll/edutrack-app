import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

describe('Admin Student Enrollment Status Migration 20261124000012 (PGlite)', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const migrationFiles = fs
    .readdirSync(path.join(rootDir, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  async function createMigratedDb(): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
      $$ LANGUAGE sql STABLE;
      CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
        SELECT COALESCE(current_setting('request.jwt.claim.role', true), 'anon');
      $$ LANGUAGE sql STABLE;
      DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(rootDir, 'supabase/migrations', file), 'utf8');
      await db.exec(sql);
    }
    return db;
  }

  async function setSessionUser(db: PGlite, uid: string | null) {
    if (!uid) {
      await db.exec(`RESET ROLE; SET request.jwt.claim.role = 'anon'; SET request.jwt.claim.sub = '';`);
    } else {
      await db.exec(
        `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${uid}';`
      );
    }
  }

  it('allows admin updates with atomic expected-status compare, denies non-admins, preserves records, and enforces suspended write guards', async () => {
    const db = await createMigratedDb();
    try {
      const adminUid = 'a0000000-0000-4000-8000-000000000001';
      const teacherUid = 'b0000000-0000-4000-8000-000000000001';
      const studentUid = 'c0000000-0000-4000-8000-000000000001';
      const teacherId = 'd0000000-0000-4000-8000-000000000001';
      const groupId = 'e0000000-0000-4000-8000-000000000001';
      const studentId = 'f0000000-0000-4000-8000-000000000001';
      const assignmentId = '10000000-0000-4000-8000-000000000001';

      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES
          ('${adminUid}', 'admin@edutrack.local'),
          ('${teacherUid}', 'teacher@edutrack.local'),
          ('${studentUid}', 'student@edutrack.local');
        INSERT INTO public.profiles (id, email, full_name, role) VALUES
          ('${adminUid}', 'admin@edutrack.local', 'Admin', 'admin'),
          ('${teacherUid}', 'teacher@edutrack.local', 'Teacher', 'teacher'),
          ('${studentUid}', 'student@edutrack.local', 'Student', 'student');
        INSERT INTO public.teachers (id, full_name, subject, email) VALUES
          ('${teacherId}', 'Mr. Rami', 'Physics', 'teacher@edutrack.local');
        INSERT INTO public.groups (id, name, grade_level, teacher_id, capacity) VALUES
          ('${groupId}', 'Physics A', 'Grade 10', '${teacherId}', 30);
        INSERT INTO public.students (id, full_name, student_code, grade_level, group_id, qr_code_hash, status) VALUES
          ('${studentId}', 'Youssef Tariq', 'ET-9001', 'Grade 10', '${groupId}', 'QR-9001', 'active');
        INSERT INTO public.attendance (student_id, group_id, status, date) VALUES
          ('${studentId}', '${groupId}', 'Present', '2026-11-20');
        INSERT INTO public.grades (student_id, group_id, teacher_id, assessment_title, grade_type, score, max_score, assessment_date) VALUES
          ('${studentId}', '${groupId}', '${teacherId}', 'Quiz 1', 'quiz', 18, 20, '2026-11-20');
        INSERT INTO public.assignments (id, group_id, teacher_id, title, instructions, due_at) VALUES
          ('${assignmentId}', '${groupId}', '${teacherId}', 'HW 1', 'Solve Q1', NOW() + INTERVAL '2 days');
      `);

      await setSessionUser(db, adminUid);
      await db.query(`SELECT public.link_teacher_account($1::uuid, $2::uuid);`, [teacherId, teacherUid]);
      await db.query(`SELECT public.link_student_account($1::uuid, $2::uuid);`, [studentId, studentUid]);

      // Non-admins (teacher, student, anon) must be denied
      for (const uid of [teacherUid, studentUid, null]) {
        await setSessionUser(db, uid);
        await expect(
          db.query(
            `SELECT public.update_student_enrollment_status($1::uuid, $2::text, $3::text);`,
            [studentId, 'suspended', 'active']
          )
        ).rejects.toThrow(/Unauthorized|permission denied/i);
      }

      // Admin updates active -> suspended
      await setSessionUser(db, adminUid);
      const suspendedRes = await db.query<{ res: { id: string; status: string } }>(
        `SELECT public.update_student_enrollment_status($1::uuid, $2::text, $3::text) AS res;`,
        [studentId, 'suspended', 'active']
      );
      expect(suspendedRes.rows[0].res).toEqual({ id: studentId, status: 'suspended' });

      // Stale expected_status ('active') must fail with Conflict
      await expect(
        db.query(
          `SELECT public.update_student_enrollment_status($1::uuid, $2::text, $3::text);`,
          [studentId, 'graduated', 'active']
        )
      ).rejects.toThrow(/Conflict/i);

      // Historical attendance, grades, user_id, group_id, and auth.users are preserved
      await db.exec(`RESET ROLE;`);
      const checkRow = await db.query<{
        user_id: string;
        group_id: string;
        att_count: number;
        grade_count: number;
        auth_count: number;
      }>(`
        SELECT
          s.user_id,
          s.group_id,
          (SELECT COUNT(*)::int FROM public.attendance a WHERE a.student_id = s.id) AS att_count,
          (SELECT COUNT(*)::int FROM public.grades g WHERE g.student_id = s.id) AS grade_count,
          (SELECT COUNT(*)::int FROM auth.users u WHERE u.id = '${studentUid}') AS auth_count
        FROM public.students s WHERE s.id = '${studentId}';
      `);
      expect(checkRow.rows[0]).toEqual({
        user_id: studentUid,
        group_id: groupId,
        att_count: 1,
        grade_count: 1,
        auth_count: 1,
      });

      // Suspended write guards: QR attendance and assignment submission reject suspended student
      await setSessionUser(db, adminUid);
      const qrRes = await db.query<{ res: { success: boolean; code: string } }>(
        `SELECT public.record_qr_attendance($1::text, $2::uuid) AS res;`,
        ['QR-9001', groupId]
      );
      expect(qrRes.rows[0].res.success).toBe(false);
      expect(qrRes.rows[0].res.code).toBe('INACTIVE_STUDENT');

      await setSessionUser(db, studentUid);
      await expect(
        db.query(
          `SELECT public.submit_student_assignment($1::uuid, $2::text, NULL, NULL, NULL, NULL, 1);`,
          [assignmentId, 'My answer']
        )
      ).rejects.toThrow(/active/i);

      // Admin can transition suspended -> graduated -> active
      await setSessionUser(db, adminUid);
      const gradRes = await db.query<{ res: { id: string; status: string } }>(
        `SELECT public.update_student_enrollment_status($1::uuid, $2::text, $3::text) AS res;`,
        [studentId, 'graduated', 'suspended']
      );
      expect(gradRes.rows[0].res).toEqual({ id: studentId, status: 'graduated' });

      // Older rows may predate the UI workflow and have a NULL status.
      await db.exec('RESET ROLE');
      await db.query('UPDATE public.students SET status = NULL WHERE id = $1::uuid', [studentId]);
      await setSessionUser(db, adminUid);
      const recovered = await db.query<{ res: { id: string; status: string } }>(
        'SELECT public.update_student_enrollment_status($1::uuid, $2::text, $3::text) AS res',
        [studentId, 'active', null]
      );
      expect(recovered.rows[0].res).toEqual({ id: studentId, status: 'active' });
    } finally {
      await db.close();
    }
  });
});
