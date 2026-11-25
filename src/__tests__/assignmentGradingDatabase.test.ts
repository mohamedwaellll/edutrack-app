import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

describe('Assignments Stage F.3 Grading Database Execution & RLS/RPC Tests (PGlite)', () => {
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

  async function asUser<T>(
    db: PGlite,
    userId: string,
    role: 'authenticated' | 'anon',
    fn: () => Promise<T>
  ): Promise<T> {
    await db.exec('BEGIN');
    try {
      await db.query(`SELECT set_config('role', $1, true)`, [role]);
      await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
      await db.query(`SELECT set_config('request.jwt.claim.role', $1, true)`, [role]);
      const result = await fn();
      await db.exec('COMMIT');
      return result;
    } catch (err) {
      await db.exec('ROLLBACK');
      throw err;
    }
  }

  it('enforces post-due grading, 18/20->19/20 single-row update, 0 & >max bounds, two-tab conflict, transfer rejection, and student/parent isolation', async () => {
    const db = await createMigratedDb();

    const adminId = '00000000-0000-0000-0000-000000000001';
    const teacher1UserId = '00000000-0000-0000-0000-000000000011';
    const teacher2UserId = '00000000-0000-0000-0000-000000000012';
    const youssefUserId = '00000000-0000-0000-0000-000000000021';
    const peerSameNameUserId = '00000000-0000-0000-0000-000000000022';
    const linkedParentUserId = '00000000-0000-0000-0000-000000000031';
    const unlinkedParentUserId = '00000000-0000-0000-0000-000000000032';

    await db.query(
      `INSERT INTO auth.users (id, email) VALUES
        ($1, 'admin@edutrack.local'),
        ($2, 'teacher1@edutrack.local'),
        ($3, 'teacher2@edutrack.local'),
        ($4, 'youssef@edutrack.local'),
        ($5, 'peer@edutrack.local'),
        ($6, 'parent1@edutrack.local'),
        ($7, 'parent2@edutrack.local')`,
      [
        adminId,
        teacher1UserId,
        teacher2UserId,
        youssefUserId,
        peerSameNameUserId,
        linkedParentUserId,
        unlinkedParentUserId,
      ]
    );

    await db.query(
      `INSERT INTO public.profiles (id, email, full_name, role) VALUES
        ($1, 'admin@edutrack.local', 'Admin User', 'admin'),
        ($2, 'teacher1@edutrack.local', 'Mr. Rami Physics', 'teacher'),
        ($3, 'teacher2@edutrack.local', 'Ms. Nora Math', 'teacher'),
        ($4, 'youssef@edutrack.local', 'Youssef Tariq', 'student'),
        ($5, 'peer@edutrack.local', 'Youssef Tariq', 'student'),
        ($6, 'parent1@edutrack.local', 'Tariq Parent', 'parent'),
        ($7, 'parent2@edutrack.local', 'Other Parent', 'parent')`,
      [
        adminId,
        teacher1UserId,
        teacher2UserId,
        youssefUserId,
        peerSameNameUserId,
        linkedParentUserId,
        unlinkedParentUserId,
      ]
    );

    const t1Res = await db.query<{ id: string }>(
      `INSERT INTO public.teachers (full_name, subject, email) VALUES ('Mr. Rami Physics', 'Physics', 'teacher1@edutrack.local') RETURNING id`
    );
    const t2Res = await db.query<{ id: string }>(
      `INSERT INTO public.teachers (full_name, subject, email) VALUES ('Ms. Nora Math', 'Mathematics', 'teacher2@edutrack.local') RETURNING id`
    );
    const teacher1Id = t1Res.rows[0].id;
    const teacher2Id = t2Res.rows[0].id;

    await asUser(db, adminId, 'authenticated', async () => {
      await db.query(`SELECT public.link_teacher_account($1::uuid, $2::uuid)`, [teacher1Id, teacher1UserId]);
      await db.query(`SELECT public.link_teacher_account($1::uuid, $2::uuid)`, [teacher2Id, teacher2UserId]);
    });

    const g1Res = await db.query<{ id: string }>(
      `INSERT INTO public.groups (name, grade_level, teacher_id, capacity) VALUES ('Physics Group F1', 'Grade 10', $1, 30) RETURNING id`,
      [teacher1Id]
    );
    const group1Id = g1Res.rows[0].id;

    const youssefRes = await db.query<{ id: string }>(
      `INSERT INTO public.students (full_name, student_code, grade_level, group_id, qr_code_hash, status)
       VALUES ('Youssef Tariq', 'ET-F-101', 'Grade 10', $1, 'QR-STAGEF-101', 'active') RETURNING id`,
      [group1Id]
    );
    const peerRes = await db.query<{ id: string }>(
      `INSERT INTO public.students (full_name, student_code, grade_level, group_id, qr_code_hash, status)
       VALUES ('Youssef Tariq', 'ET-F-102', 'Grade 10', $1, 'QR-STAGEF-102', 'active') RETURNING id`,
      [group1Id]
    );
    const youssefStudentId = youssefRes.rows[0].id;
    const peerStudentId = peerRes.rows[0].id;

    await asUser(db, adminId, 'authenticated', async () => {
      await db.query(`SELECT public.link_student_account($1::uuid, $2::uuid)`, [youssefStudentId, youssefUserId]);
      await db.query(`SELECT public.link_student_account($1::uuid, $2::uuid)`, [peerStudentId, peerSameNameUserId]);
      await db.query(`SELECT public.link_parent_student($1::uuid, $2::uuid)`, [linkedParentUserId, youssefStudentId]);
    });

    // Preserve an existing manual grade
    await asUser(db, teacher1UserId, 'authenticated', () =>
      db.query(
        `SELECT public.save_teacher_student_grade($1::uuid, $2::uuid, 'Manual Quiz', 'quiz'::public.grade_category, 9, 10, (NOW() AT TIME ZONE 'Africa/Cairo')::date, NULL)`,
        [group1Id, youssefStudentId]
      )
    );

    // Publish assignment and submit Youssef's answer while due_at is in the future
    const futureDue = '2026-12-20T16:30:00.000Z';
    const aRes = await asUser(db, teacher1UserId, 'authenticated', () =>
      db.query<{ res: { assignment: { id: string } } }>(
        `SELECT public.create_teacher_assignment($1::uuid, 'واجب الحركة', 'حل تمارين الحركة', $2::timestamptz) AS res`,
        [group1Id, futureDue]
      )
    );
    const assignmentId = aRes.rows[0].res.assignment.id;

    const subRes = await asUser(db, youssefUserId, 'authenticated', () =>
      db.query<{ res: { submission: { id: string } } }>(
        `SELECT public.submit_student_assignment($1::uuid, 'السرعة = المسافة ÷ الزمن') AS res`,
        [assignmentId]
      )
    );
    const submissionId = subRes.rows[0].res.submission.id;

    // 1. Grading BEFORE due_at must be rejected
    await expect(
      asUser(db, teacher1UserId, 'authenticated', () =>
        db.query(`SELECT public.grade_assignment_submission($1::uuid, 18, 20, NULL)`, [submissionId])
      )
    ).rejects.toThrow(/after the assignment due date/i);

    // Move due_at into the past to unlock grading
    await db.query(`UPDATE public.assignments SET due_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [assignmentId]);

    // 2. Invalid score > max (21/20) must be rejected; zero (0/20) must succeed
    await expect(
      asUser(db, teacher1UserId, 'authenticated', () =>
        db.query(`SELECT public.grade_assignment_submission($1::uuid, 21, 20, NULL)`, [submissionId])
      )
    ).rejects.toThrow(/Invalid score/i);

    const zeroRes = await asUser(db, teacher1UserId, 'authenticated', () =>
      db.query<{ res: { saved: boolean; conflict: boolean; grade: { id: string; score: number; grade_version: number } } }>(
        `SELECT public.grade_assignment_submission($1::uuid, 0, 20, NULL) AS res`,
        [submissionId]
      )
    );
    expect(zeroRes.rows[0].res.saved).toBe(true);
    expect(zeroRes.rows[0].res.conflict).toBe(false);
    expect(Number(zeroRes.rows[0].res.grade.score)).toBe(0);
    expect(zeroRes.rows[0].res.grade.grade_version).toBe(1);
    const gradeId = zeroRes.rows[0].res.grade.id;

    // Case 1: Second window starting from "not graded" (expected_grade_version = NULL) gets conflict + latest grade
    const ungradedConflictRes = await asUser(db, teacher1UserId, 'authenticated', () =>
      db.query<{ res: { saved: boolean; conflict: boolean; grade: { id: string; score: number; grade_version: number } } }>(
        `SELECT public.grade_assignment_submission($1::uuid, 15, 20, NULL) AS res`,
        [submissionId]
      )
    );
    expect(ungradedConflictRes.rows[0].res.saved).toBe(false);
    expect(ungradedConflictRes.rows[0].res.conflict).toBe(true);
    expect(Number(ungradedConflictRes.rows[0].res.grade.score)).toBe(0);
    expect(ungradedConflictRes.rows[0].res.grade.grade_version).toBe(1);

    // 3. Two back-to-back updates without any sleep/delay: 0/20 (v1) -> 18/20 (v2) -> 19/20 (v3)
    const g18Res = await asUser(db, teacher1UserId, 'authenticated', () =>
      db.query<{ res: { saved: boolean; grade: { id: string; score: number; grade_version: number } } }>(
        `SELECT public.grade_assignment_submission($1::uuid, 18, 20, $2::integer) AS res`,
        [submissionId, zeroRes.rows[0].res.grade.grade_version]
      )
    );
    expect(g18Res.rows[0].res.grade.id).toBe(gradeId);
    expect(Number(g18Res.rows[0].res.grade.score)).toBe(18);
    expect(g18Res.rows[0].res.grade.grade_version).toBe(2);
    const versionAt18 = g18Res.rows[0].res.grade.grade_version;

    const g19Res = await asUser(db, teacher1UserId, 'authenticated', () =>
      db.query<{ res: { saved: boolean; grade: { id: string; score: number; grade_version: number } } }>(
        `SELECT public.grade_assignment_submission($1::uuid, 19, 20, $2::integer) AS res`,
        [submissionId, versionAt18]
      )
    );
    expect(g19Res.rows[0].res.grade.id).toBe(gradeId);
    expect(Number(g19Res.rows[0].res.grade.score)).toBe(19);
    expect(g19Res.rows[0].res.grade.grade_version).toBe(3);

    const gradeRowCount = await db.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM public.grades WHERE assignment_submission_id = $1`,
      [submissionId]
    );
    expect(Number(gradeRowCount.rows[0].cnt)).toBe(1);

    // Case 2: Second window starting from same 18/20 version (v2) gets conflict + latest grade (19/20, v3)
    const conflictRes = await asUser(db, teacher1UserId, 'authenticated', () =>
      db.query<{ res: { saved: boolean; conflict: boolean; grade: { score: number; grade_version: number } } }>(
        `SELECT public.grade_assignment_submission($1::uuid, 12, 20, $2::integer) AS res`,
        [submissionId, versionAt18]
      )
    );
    expect(conflictRes.rows[0].res.saved).toBe(false);
    expect(conflictRes.rows[0].res.conflict).toBe(true);
    expect(Number(conflictRes.rows[0].res.grade.score)).toBe(19);
    expect(conflictRes.rows[0].res.grade.grade_version).toBe(3);

    // 5. Student sees 19/20 under assignment AND in grades ledger (plus manual quiz)
    const studentAssign = await asUser(db, youssefUserId, 'authenticated', () =>
      db.query<{ res: { assignments: Array<{ grade: { score: number; max_score: number } | null }> } }>(
        `SELECT public.get_student_assignments() AS res`
      )
    );
    expect(Number(studentAssign.rows[0].res.assignments[0].grade?.score)).toBe(19);

    const studentLedger = await asUser(db, youssefUserId, 'authenticated', () =>
      db.query<{ res: { grades: Array<{ assessment_title: string; grade_type: string; score: number }> } }>(
        `SELECT public.get_student_portal_data() AS res`
      )
    );
    expect(studentLedger.rows[0].res.grades).toHaveLength(2);
    const assignGradeRow = studentLedger.rows[0].res.grades.find((g) => g.grade_type === 'assignment');
    expect(assignGradeRow?.assessment_title).toBe('واجب الحركة');
    expect(Number(assignGradeRow?.score)).toBe(19);

    // 6. Linked parent sees 19/20 in child's grades ledger, WITHOUT submission answer text
    const parentDetails = await asUser(db, linkedParentUserId, 'authenticated', () =>
      db.query<{ res: Record<string, unknown> }>(
        `SELECT public.get_parent_child_details($1::uuid) AS res`,
        [youssefStudentId]
      )
    );
    const parentJson = JSON.stringify(parentDetails.rows[0].res);
    expect(parentJson).toContain('واجب الحركة');
    expect(parentJson).toContain('19');
    expect(parentJson).not.toContain('السرعة = المسافة');

    // 7. Same-name peer and unlinked parent do NOT see Youssef's grade
    const peerLedger = await asUser(db, peerSameNameUserId, 'authenticated', () =>
      db.query<{ res: { grades: unknown[] } }>(`SELECT public.get_student_portal_data() AS res`)
    );
    expect(peerLedger.rows[0].res.grades).toHaveLength(0);

    await expect(
      asUser(db, unlinkedParentUserId, 'authenticated', () =>
        db.query(`SELECT public.get_parent_child_details($1::uuid)`, [youssefStudentId])
      )
    ).rejects.toThrow(/Access denied/i);

    // 8. Group reassignment rejects subsequent grading by Teacher 1
    await db.query(`UPDATE public.groups SET teacher_id = $1 WHERE id = $2`, [teacher2Id, group1Id]);
    await expect(
      asUser(db, teacher1UserId, 'authenticated', () =>
        db.query(
          `SELECT public.grade_assignment_submission($1::uuid, 15, 20, $2::integer)`,
          [submissionId, g19Res.rows[0].res.grade.grade_version]
        )
      )
    ).rejects.toThrow(/Access denied/i);
  }, 20000);
});
