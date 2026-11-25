import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

describe('Assignments Stage F.6 Parent Child Assignments Database & Privacy Tests (PGlite)', () => {
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

  it('returns privacy-safe follow-up for same-name siblings (PDF-only 0/20 vs unlinked-login unsubmitted), checks DB clock deadline, and revokes on unlink', async () => {
    const db = await createMigratedDb();
    try {
      const adminUid = 'a0000000-0000-4000-8000-000000000001';
      const teacherUid = 'b0000000-0000-4000-8000-000000000001';
      const child1Uid = 'c0000000-0000-4000-8000-000000000001';
      const parentUid = 'd0000000-0000-4000-8000-000000000099';

      const teacherId = 'd0000000-0000-4000-8000-000000000001';
      const f1Id = 'e0000000-0000-4000-8000-000000000001';
      const child1Id = 'f0000000-0000-4000-8000-000000000001';
      const child2Id = 'f0000000-0000-4000-8000-000000000002';

      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES
          ('${adminUid}', 'admin@edutrack.local'),
          ('${teacherUid}', 'teacher@edutrack.local'),
          ('${child1Uid}', 'child1@edutrack.local'),
          ('${parentUid}', 'parent@edutrack.local');

        INSERT INTO public.profiles (id, email, full_name, role) VALUES
          ('${adminUid}', 'admin@edutrack.local', 'Admin', 'admin'),
          ('${teacherUid}', 'teacher@edutrack.local', 'Mr. Kareem', 'teacher'),
          ('${child1Uid}', 'child1@edutrack.local', 'يوسف طارق', 'student'),
          ('${parentUid}', 'parent@edutrack.local', 'Tariq Guardian', 'parent');

        INSERT INTO public.teachers (id, full_name, subject, email) VALUES
          ('${teacherId}', 'Mr. Kareem', 'Physics', 'teacher@edutrack.local');

        INSERT INTO public.groups (id, name, grade_level, teacher_id, capacity) VALUES
          ('${f1Id}', 'Physics Group F1', 'Grade 10', '${teacherId}', 30);

        -- Both siblings share the exact same name in the same group; child2 has NO login account (user_id IS NULL)
        INSERT INTO public.students (id, full_name, student_code, grade_level, group_id, qr_code_hash, status) VALUES
          ('${child1Id}', 'يوسف طارق', 'ET-F-101', 'Grade 10', '${f1Id}', 'QR-ET-F-101', 'active'),
          ('${child2Id}', 'يوسف طارق', 'ET-F-102', 'Grade 10', '${f1Id}', 'QR-ET-F-102', 'active');
      `);

      await setSessionUser(db, adminUid);
      await db.query(`SELECT public.link_teacher_account($1::uuid, $2::uuid);`, [teacherId, teacherUid]);
      await db.query(`SELECT public.link_student_account($1::uuid, $2::uuid);`, [child1Id, child1Uid]);
      await db.query(`SELECT public.link_parent_student($1::uuid, $2::uuid);`, [parentUid, child1Id]);
      await db.query(`SELECT public.link_parent_student($1::uuid, $2::uuid);`, [parentUid, child2Id]);

      const futureDue = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      await setSessionUser(db, teacherUid);
      const assignRes = await db.query<{ res: { assignment: { id: string } } }>(
        `SELECT public.create_teacher_assignment($1::uuid, $2::text, $3::text, $4::timestamptz) AS res;`,
        [f1Id, 'واجب الحركة', 'حل المسائل.', futureDue]
      );
      const assignmentId = assignRes.rows[0].res.assignment.id;

      // Child 1 submits PDF-only
      await setSessionUser(db, child1Uid);
      const subRes = await db.query<{ res: { submission: { id: string } } }>(
        `SELECT public.submit_student_assignment($1::uuid, NULL, $2::text, $3::text, $4::integer, $5::text) AS res;`,
        [assignmentId, `${child1Id}/${assignmentId}/sol.pdf`, 'sol.pdf', 1024, 'application/pdf']
      );
      const subId = subRes.rows[0].res.submission.id;

      // Move due_at into the past so teacher grades 0/20 AND child 2 becomes 'missed'
      await setSessionUser(db, null);
      await db.exec(`UPDATE public.assignments SET due_at = NOW() - INTERVAL '1 minute' WHERE id = '${assignmentId}';`);

      await setSessionUser(db, teacherUid);
      await db.query(`SELECT public.grade_assignment_submission($1::uuid, 0, 20, NULL);`, [subId]);

      // Parent reads Child 1 -> graded 0/20, NO answer_text / attachment / storage paths in JSON
      await setSessionUser(db, parentUid);
      const p1 = await db.query<{
        res: {
          assignments: Array<{
            id: string;
            title: string;
            status: string;
            grade: { score: number; max_score: number } | null;
          }>;
        };
      }>(`SELECT public.get_parent_child_assignments($1::uuid) AS res;`, [child1Id]);

      expect(p1.rows[0].res.assignments).toHaveLength(1);
      expect(p1.rows[0].res.assignments[0].status).toBe('graded');
      expect(Number(p1.rows[0].res.assignments[0].grade?.score)).toBe(0);
      expect(Number(p1.rows[0].res.assignments[0].grade?.max_score)).toBe(20);

      const rawJson = JSON.stringify(p1.rows[0].res);
      expect(rawJson).not.toContain('answer_text');
      expect(rawJson).not.toContain('object_path');
      expect(rawJson).not.toContain('signedUrl');
      expect(rawJson).not.toContain('sol.pdf');

      // Parent reads Child 2 (no login account) -> missed after DB deadline
      const p2 = await db.query<{
        res: { assignments: Array<{ status: string; grade: null }> };
      }>(`SELECT public.get_parent_child_assignments($1::uuid) AS res;`, [child2Id]);
      expect(p2.rows[0].res.assignments[0].status).toBe('missed');
      expect(p2.rows[0].res.assignments[0].grade).toBeNull();

      // Unlink Child 1 -> Child 1 rejected, Child 2 remains accessible
      await setSessionUser(db, adminUid);
      await db.query(`SELECT public.unlink_parent_student($1::uuid, $2::uuid);`, [parentUid, child1Id]);

      await setSessionUser(db, parentUid);
      await expect(
        db.query(`SELECT public.get_parent_child_assignments($1::uuid) AS res;`, [child1Id])
      ).rejects.toThrow(/not linked/i);

      const p2After = await db.query<{ res: { assignments: Array<{ status: string }> } }>(
        `SELECT public.get_parent_child_assignments($1::uuid) AS res;`,
        [child2Id]
      );
      expect(p2After.rows[0].res.assignments[0].status).toBe('missed');
    } finally {
      await db.close();
    }
  });
});
