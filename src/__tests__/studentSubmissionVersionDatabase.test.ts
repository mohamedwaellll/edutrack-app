import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

describe('Assignments Stage F.8 Student Submission Version Conflict Tests (PGlite)', () => {
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

  it('rejects stale assignment_version without saving, returns latest details, and accepts normal & reviewed submissions', async () => {
    const db = await createMigratedDb();
    try {
      const adminUid = 'a0000000-0000-4000-8000-000000000001';
      const teacherUid = 'b0000000-0000-4000-8000-000000000001';
      const studentUid = 'c0000000-0000-4000-8000-000000000001';

      const teacherId = 'd0000000-0000-4000-8000-000000000001';
      const f1Id = 'e0000000-0000-4000-8000-000000000001';
      const studentId = 'f0000000-0000-4000-8000-000000000001';

      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES
          ('${adminUid}', 'admin@edutrack.local'),
          ('${teacherUid}', 'teacher@edutrack.local'),
          ('${studentUid}', 'student@edutrack.local');

        INSERT INTO public.profiles (id, email, full_name, role) VALUES
          ('${adminUid}', 'admin@edutrack.local', 'Admin', 'admin'),
          ('${teacherUid}', 'teacher@edutrack.local', 'Mr. Kareem', 'teacher'),
          ('${studentUid}', 'student@edutrack.local', 'Youssef Tariq', 'student');

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

      const due1 = '2099-12-01T16:00:00.000Z';
      const due2 = '2099-12-05T18:30:00.000Z';

      await setSessionUser(db, teacherUid);
      const a1Res = await db.query<{ res: { assignment: { id: string } } }>(
        `SELECT public.create_teacher_assignment($1::uuid, $2::text, $3::text, $4::timestamptz) AS res;`,
        [f1Id, 'واجب الحركة', 'حل صفحة 14', due1]
      );
      const a1Id = a1Res.rows[0].res.assignment.id;

      const a2Res = await db.query<{ res: { assignment: { id: string } } }>(
        `SELECT public.create_teacher_assignment($1::uuid, $2::text, $3::text, $4::timestamptz) AS res;`,
        [f1Id, 'واجب عادي', 'حل صفحة 10', due1]
      );
      const a2Id = a2Res.rows[0].res.assignment.id;

      // Student reads assignments (sees version 1)
      await setSessionUser(db, studentUid);
      const stuRead = await db.query<{ res: { assignments: Array<{ id: string; assignment_version: number }> } }>(
        `SELECT public.get_student_assignments() AS res;`
      );
      expect(stuRead.rows[0].res.assignments.find((x) => x.id === a1Id)?.assignment_version).toBe(1);

      // Normal submission when version has NOT changed (a2: expected_version = 1) -> succeeds
      const normalSub = await db.query<{ res: { saved: boolean; conflict: boolean; submission: { id: string } } }>(
        `SELECT public.submit_student_assignment($1::uuid, $2::text, NULL, NULL, NULL, NULL, $3::integer) AS res;`,
        [a2Id, 'إجابة عادية', 1]
      );
      expect(normalSub.rows[0].res.saved).toBe(true);
      expect(normalSub.rows[0].res.conflict).toBe(false);

      // Teacher edits a1 from "حل صفحة 14" -> "حل صفحة 41" (version becomes 2)
      await setSessionUser(db, teacherUid);
      await db.query(
        `SELECT public.update_teacher_assignment($1::uuid, $2::text, $3::text, $4::timestamptz, $5::integer);`,
        [a1Id, 'واجب الحركة', 'حل صفحة 41', due2, 1]
      );

      // Student submits a1 with stale version 1 -> returns conflict: true, 0 submissions saved
      await setSessionUser(db, studentUid);
      const pdfPath = `${studentId}/${a1Id}/11111111-1111-4111-8111-111111111111.pdf`;
      const staleSub = await db.query<{
        res: {
          saved: boolean;
          conflict: boolean;
          assignment: { instructions: string; due_at: string; assignment_version: number };
        };
      }>(
        `SELECT public.submit_student_assignment($1::uuid, $2::text, $3::text, $4::text, $5::integer, $6::text, $7::integer) AS res;`,
        [a1Id, 'إجابة يوسف', pdfPath, 'youssef.pdf', 1024, 'application/pdf', 1]
      );
      expect(staleSub.rows[0].res.saved).toBe(false);
      expect(staleSub.rows[0].res.conflict).toBe(true);
      expect(staleSub.rows[0].res.assignment.instructions).toBe('حل صفحة 41');
      expect(staleSub.rows[0].res.assignment.assignment_version).toBe(2);

      // Submission count for a1 must still be 0!
      await setSessionUser(db, teacherUid);
      const beforeReviewSubs = await db.query<{ res: { submissions: unknown[] } }>(
        `SELECT public.get_teacher_assignment_submissions($1::uuid) AS res;`,
        [a1Id]
      );
      expect(beforeReviewSubs.rows[0].res.submissions).toHaveLength(0);

      // Student reviews and submits with updated version 2 -> 1 submission + 1 PDF attachment
      await setSessionUser(db, studentUid);
      const reviewedSub = await db.query<{
        res: { saved: boolean; conflict: boolean; submission: { id: string; attachment: { file_name: string } } };
      }>(
        `SELECT public.submit_student_assignment($1::uuid, $2::text, $3::text, $4::text, $5::integer, $6::text, $7::integer) AS res;`,
        [a1Id, 'إجابة يوسف', pdfPath, 'youssef.pdf', 1024, 'application/pdf', 2]
      );
      expect(reviewedSub.rows[0].res.saved).toBe(true);
      expect(reviewedSub.rows[0].res.conflict).toBe(false);
      expect(reviewedSub.rows[0].res.submission.attachment.file_name).toBe('youssef.pdf');

      await setSessionUser(db, teacherUid);
      const afterReviewSubs = await db.query<{
        res: { submissions: Array<{ answer_text: string; attachment: { file_name: string } }> };
      }>(`SELECT public.get_teacher_assignment_submissions($1::uuid) AS res;`, [a1Id]);
      expect(afterReviewSubs.rows[0].res.submissions).toHaveLength(1);
      expect(afterReviewSubs.rows[0].res.submissions[0].answer_text).toBe('إجابة يوسف');
      expect(afterReviewSubs.rows[0].res.submissions[0].attachment.file_name).toBe('youssef.pdf');
    } finally {
      await db.close();
    }
  });
});
