import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

describe('Assignments Stage F.2 Submissions Database Execution & RLS/RPC Tests (PGlite)', () => {
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

  it('enforces single submission per student, same-name peer isolation, deadline lock, unlink/move lock, and teacher reassignment guard', async () => {
    const db = await createMigratedDb();

    const adminId = '00000000-0000-0000-0000-000000000001';
    const teacher1UserId = '00000000-0000-0000-0000-000000000011';
    const teacher2UserId = '00000000-0000-0000-0000-000000000012';
    const youssefUserId = '00000000-0000-0000-0000-000000000021';
    const peerSameNameUserId = '00000000-0000-0000-0000-000000000022';

    await db.query(
      `INSERT INTO auth.users (id, email) VALUES
        ($1, 'admin@edutrack.local'),
        ($2, 'teacher1@edutrack.local'),
        ($3, 'teacher2@edutrack.local'),
        ($4, 'youssef@edutrack.local'),
        ($5, 'peer@edutrack.local')`,
      [adminId, teacher1UserId, teacher2UserId, youssefUserId, peerSameNameUserId]
    );

    await db.query(
      `INSERT INTO public.profiles (id, email, full_name, role) VALUES
        ($1, 'admin@edutrack.local', 'Admin User', 'admin'),
        ($2, 'teacher1@edutrack.local', 'Mr. Rami Physics', 'teacher'),
        ($3, 'teacher2@edutrack.local', 'Ms. Nora Math', 'teacher'),
        ($4, 'youssef@edutrack.local', 'Youssef Tariq', 'student'),
        ($5, 'peer@edutrack.local', 'Youssef Tariq', 'student')`,
      [adminId, teacher1UserId, teacher2UserId, youssefUserId, peerSameNameUserId]
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
    const g2Res = await db.query<{ id: string }>(
      `INSERT INTO public.groups (name, grade_level, teacher_id, capacity) VALUES ('Math Group M1', 'Grade 10', $1, 30) RETURNING id`,
      [teacher2Id]
    );
    const group1Id = g1Res.rows[0].id;
    const group2Id = g2Res.rows[0].id;

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
    });

    // Teacher 1 publishes Assignment 1 ("واجب الحركة") and Assignment 2 (for deadline expiry test)
    const futureDue = '2026-12-20T16:30:00.000Z';
    const a1Res = await asUser(db, teacher1UserId, 'authenticated', () =>
      db.query<{ res: { assignment: { id: string } } }>(
        `SELECT public.create_teacher_assignment($1::uuid, 'واجب الحركة', 'حل التمارين', $2::timestamptz) AS res`,
        [group1Id, futureDue]
      )
    );
    const a2Res = await asUser(db, teacher1UserId, 'authenticated', () =>
      db.query<{ res: { assignment: { id: string } } }>(
        `SELECT public.create_teacher_assignment($1::uuid, 'واجب التسارع', 'مسائل إضافية', $2::timestamptz) AS res`,
        [group1Id, futureDue]
      )
    );
    const assignment1Id = a1Res.rows[0].res.assignment.id;
    const assignment2Id = a2Res.rows[0].res.assignment.id;

    // 1. Empty answer is rejected
    await expect(
      asUser(db, youssefUserId, 'authenticated', () =>
        db.query(`SELECT public.submit_student_assignment($1::uuid, '   ')`, [assignment1Id])
      )
    ).rejects.toThrow(/Answer text is required/i);

    // 2. Youssef submits then edits his answer -> remains 1 row
    await asUser(db, youssefUserId, 'authenticated', () =>
      db.query(`SELECT public.submit_student_assignment($1::uuid, 'السرعة = المسافة ÷ الزمن')`, [assignment1Id])
    );
    await asUser(db, youssefUserId, 'authenticated', () =>
      db.query(
        `SELECT public.submit_student_assignment($1::uuid, 'السرعة = المسافة ÷ الزمن، مثال: 100م في 10ث = 10م/ث')`,
        [assignment1Id]
      )
    );

    const rowCount = await db.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM public.assignment_submissions WHERE assignment_id = $1 AND student_id = $2`,
      [assignment1Id, youssefStudentId]
    );
    expect(Number(rowCount.rows[0].cnt)).toBe(1);

    // 3. Same-name peer in the SAME group cannot read Youssef's submission (via RPC or direct SELECT)
    const peerView = await asUser(db, peerSameNameUserId, 'authenticated', () =>
      db.query<{ res: { assignments: Array<{ id: string; submission: unknown }> } }>(
        `SELECT public.get_student_assignments() AS res`
      )
    );
    const peerA1 = peerView.rows[0].res.assignments.find((a) => a.id === assignment1Id);
    expect(peerA1?.submission).toBeNull();

    const peerDirect = await asUser(db, peerSameNameUserId, 'authenticated', () =>
      db.query(`SELECT id FROM public.assignment_submissions`)
    );
    expect(peerDirect.rows).toHaveLength(0);

    // 4. Separate assignment deadline expiry test: submit before deadline, expire due_at, late edit is rejected and keeps previous text
    await asUser(db, youssefUserId, 'authenticated', () =>
      db.query(`SELECT public.submit_student_assignment($1::uuid, 'إجابة قبل الموعد')`, [assignment2Id])
    );
    await db.query(`UPDATE public.assignments SET due_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [assignment2Id]);

    await expect(
      asUser(db, youssefUserId, 'authenticated', () =>
        db.query(`SELECT public.submit_student_assignment($1::uuid, 'محاولة تعديل متأخرة')`, [assignment2Id])
      )
    ).rejects.toThrow(/deadline has passed/i);

    const savedAfterLate = await db.query<{ answer_text: string }>(
      `SELECT answer_text FROM public.assignment_submissions WHERE assignment_id = $1 AND student_id = $2`,
      [assignment2Id, youssefStudentId]
    );
    expect(savedAfterLate.rows[0].answer_text).toBe('إجابة قبل الموعد');

    // 5. Teacher reads submissions -> sees Youssef's edited answer once next to ET-F-101
    const teacherSubs = await asUser(db, teacher1UserId, 'authenticated', () =>
      db.query<{
        res: {
          submissions: Array<{ student_code: string; answer_text: string }>;
        };
      }>(`SELECT public.get_teacher_assignment_submissions($1::uuid) AS res`, [assignment1Id])
    );
    expect(teacherSubs.rows[0].res.submissions).toHaveLength(1);
    expect(teacherSubs.rows[0].res.submissions[0].student_code).toBe('ET-F-101');
    expect(teacherSubs.rows[0].res.submissions[0].answer_text).toContain('مثال: 100م في 10ث');

    // 6. Moving student to Group 2 prevents submitting to Group 1 assignment
    await db.query(`UPDATE public.students SET group_id = $1 WHERE id = $2`, [group2Id, youssefStudentId]);
    await expect(
      asUser(db, youssefUserId, 'authenticated', () =>
        db.query(`SELECT public.submit_student_assignment($1::uuid, 'محاولة بعد النقل')`, [assignment1Id])
      )
    ).rejects.toThrow(/Access denied/i);

    // Move back, then unlink student -> prevents submitting
    await db.query(`UPDATE public.students SET group_id = $1 WHERE id = $2`, [group1Id, youssefStudentId]);
    await asUser(db, adminId, 'authenticated', () =>
      db.query(`SELECT public.unlink_student_account($1::uuid, $2::uuid)`, [youssefStudentId, youssefUserId])
    );
    await expect(
      asUser(db, youssefUserId, 'authenticated', () =>
        db.query(`SELECT public.submit_student_assignment($1::uuid, 'محاولة بعد فك الربط')`, [assignment1Id])
      )
    ).rejects.toThrow(/Access denied/i);

    // 7. Reassigning group to Teacher 2 revokes Teacher 1's access to read submissions
    await db.query(`UPDATE public.groups SET teacher_id = $1 WHERE id = $2`, [teacher2Id, group1Id]);
    await expect(
      asUser(db, teacher1UserId, 'authenticated', () =>
        db.query(`SELECT public.get_teacher_assignment_submissions($1::uuid) AS res`, [assignment1Id])
      )
    ).rejects.toThrow(/Access denied/i);
  }, 20000);
});
