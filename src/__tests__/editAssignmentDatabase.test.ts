import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

describe('Assignments Stage F.7 Edit Assignment Database & Concurrency Tests (PGlite)', () => {
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

      DO $$ BEGIN
        CREATE ROLE anon NOLOGIN;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE ROLE authenticated NOLOGIN;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE ROLE service_role NOLOGIN;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
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

  it('edits page 14 -> page 41 + due date while preserving ID & PDF, handles version conflict, and rejects edit after first submission', async () => {
    const db = await createMigratedDb();
    try {
      const adminUid = 'a0000000-0000-4000-8000-000000000001';
      const teacherUid = 'b0000000-0000-4000-8000-000000000001';
      const studentUid = 'c0000000-0000-4000-8000-000000000001';
      const parentUid = 'd0000000-0000-4000-8000-000000000099';

      const teacherId = 'd0000000-0000-4000-8000-000000000001';
      const f1Id = 'e0000000-0000-4000-8000-000000000001';
      const studentId = 'f0000000-0000-4000-8000-000000000001';

      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES
          ('${adminUid}', 'admin@edutrack.local'),
          ('${teacherUid}', 'teacher@edutrack.local'),
          ('${studentUid}', 'student@edutrack.local'),
          ('${parentUid}', 'parent@edutrack.local');

        INSERT INTO public.profiles (id, email, full_name, role) VALUES
          ('${adminUid}', 'admin@edutrack.local', 'Admin', 'admin'),
          ('${teacherUid}', 'teacher@edutrack.local', 'Mr. Kareem', 'teacher'),
          ('${studentUid}', 'student@edutrack.local', 'Youssef Tariq', 'student'),
          ('${parentUid}', 'parent@edutrack.local', 'Tariq Guardian', 'parent');

        INSERT INTO public.teachers (id, full_name, subject, email) VALUES
          ('${teacherId}', 'Mr. Kareem', 'Physics', 'teacher@edutrack.local');

        INSERT INTO public.groups (id, name, grade_level, teacher_id, capacity) VALUES
          ('${f1Id}', 'Physics Group F1', 'Grade 10', '${teacherId}', 30);

        INSERT INTO public.students (id, full_name, student_code, grade_level, group_id, qr_code_hash, status) VALUES
          ('${studentId}', 'Youssef Tariq', 'ET-F-101', 'Grade 10', '${f1Id}', 'QR-ET-F-101', 'active');
      `);

      await setSessionUser(db, adminUid);
      await db.query(`SELECT public.link_teacher_account($1::uuid, $2::uuid);`, [teacherId, teacherUid]);
      await db.query(`SELECT public.link_student_account($1::uuid, $2::uuid);`, [studentId, studentUid]);
      await db.query(`SELECT public.link_parent_student($1::uuid, $2::uuid);`, [parentUid, studentId]);

      const initialDue = '2099-12-01T16:00:00.000Z';
      const updatedDue = '2099-12-05T18:30:00.000Z';
      const pdfPath = `${f1Id}/11111111-1111-4111-8111-111111111111.pdf`;

      // 1. Publish assignment with "صفحة 14" and PDF attachment
      await setSessionUser(db, teacherUid);
      const createdRes = await db.query<{
        res: { assignment: { id: string; assignment_version: number; attachment: { id: string; file_name: string } } };
      }>(
        `SELECT public.create_teacher_assignment($1::uuid, $2::text, $3::text, $4::timestamptz, $5::text, $6::text, $7::integer, $8::text) AS res;`,
        [f1Id, 'واجب الحركة', 'حل تمارين صفحة 14', initialDue, pdfPath, 'motion.pdf', 2048, 'application/pdf']
      );
      const assignmentId = createdRes.rows[0].res.assignment.id;
      const attachmentId = createdRes.rows[0].res.assignment.attachment.id;
      expect(createdRes.rows[0].res.assignment.assignment_version).toBe(1);

      // 2. Teacher edits "صفحة 14" -> "صفحة 41" and updates due_at
      const editRes = await db.query<{
        res: {
          saved: boolean;
          conflict: boolean;
          assignment: { id: string; instructions: string; due_at: string; assignment_version: number; attachment: { id: string } };
        };
      }>(
        `SELECT public.update_teacher_assignment($1::uuid, $2::text, $3::text, $4::timestamptz, $5::integer) AS res;`,
        [assignmentId, 'واجب الحركة', 'حل تمارين صفحة 41', updatedDue, 1]
      );
      expect(editRes.rows[0].res.saved).toBe(true);
      expect(editRes.rows[0].res.conflict).toBe(false);
      expect(editRes.rows[0].res.assignment.id).toBe(assignmentId);
      expect(editRes.rows[0].res.assignment.attachment.id).toBe(attachmentId);
      expect(editRes.rows[0].res.assignment.assignment_version).toBe(2);

      // 3. Second stale window sends expected_version = 1 -> returns conflict: true with latest values
      const staleRes = await db.query<{
        res: { saved: boolean; conflict: boolean; assignment: { instructions: string; assignment_version: number } };
      }>(
        `SELECT public.update_teacher_assignment($1::uuid, $2::text, $3::text, $4::timestamptz, $5::integer) AS res;`,
        [assignmentId, 'واجب الحركة', 'مسودة نافذة قديمة', updatedDue, 1]
      );
      expect(staleRes.rows[0].res.saved).toBe(false);
      expect(staleRes.rows[0].res.conflict).toBe(true);
      expect(staleRes.rows[0].res.assignment.instructions).toBe('حل تمارين صفحة 41');
      expect(staleRes.rows[0].res.assignment.assignment_version).toBe(2);

      // 4. Student sees updated instructions, due_at, and same PDF attachment
      await setSessionUser(db, studentUid);
      const stuView = await db.query<{
        res: { assignments: Array<{ id: string; instructions: string; due_at: string; attachment: { id: string; file_name: string } }> };
      }>(`SELECT public.get_student_assignments() AS res;`);
      expect(stuView.rows[0].res.assignments).toHaveLength(1);
      expect(stuView.rows[0].res.assignments[0].instructions).toBe('حل تمارين صفحة 41');
      expect(new Date(stuView.rows[0].res.assignments[0].due_at).toISOString()).toBe(updatedDue);
      expect(stuView.rows[0].res.assignments[0].attachment.id).toBe(attachmentId);

      // 5. Parent sees updated due_at
      await setSessionUser(db, parentUid);
      const parentView = await db.query<{
        res: { assignments: Array<{ id: string; due_at: string }> };
      }>(`SELECT public.get_parent_child_assignments($1::uuid) AS res;`, [studentId]);
      expect(new Date(parentView.rows[0].res.assignments[0].due_at).toISOString()).toBe(updatedDue);

      // 6. Student submits -> subsequent teacher edit from an already-open modal is rejected
      await setSessionUser(db, studentUid);
      await db.query(`SELECT public.submit_student_assignment($1::uuid, $2::text);`, [
        assignmentId,
        'إجابة الطالب صفحة 41',
      ]);

      await setSessionUser(db, teacherUid);
      await expect(
        db.query(
          `SELECT public.update_teacher_assignment($1::uuid, $2::text, $3::text, $4::timestamptz, $5::integer) AS res;`,
          [assignmentId, 'واجب الحركة', 'تعديل مرفوض بعد التسليم', updatedDue, 2]
        )
      ).rejects.toThrow(/already submitted/i);

      // Verify exactly 1 assignment and 1 submission with intact values
      await setSessionUser(db, null);
      const counts = await db.query<{ a_cnt: number; s_cnt: number; instructions: string }>(
        `SELECT
           (SELECT COUNT(*)::int FROM public.assignments WHERE id = $1::uuid) AS a_cnt,
           (SELECT COUNT(*)::int FROM public.assignment_submissions WHERE assignment_id = $1::uuid) AS s_cnt,
           (SELECT instructions FROM public.assignments WHERE id = $1::uuid) AS instructions;`,
        [assignmentId]
      );
      expect(counts.rows[0].a_cnt).toBe(1);
      expect(counts.rows[0].s_cnt).toBe(1);
      expect(counts.rows[0].instructions).toBe('حل تمارين صفحة 41');
    } finally {
      await db.close();
    }
  });
});
