import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

describe('Assignments Stage F.1 Database Execution & RLS/RPC Tests (PGlite)', () => {
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

  it('enforces teacher ownership, student group scoping, transfer rejection, and separation from grades', async () => {
    const db = await createMigratedDb();

    const adminId = '00000000-0000-0000-0000-000000000001';
    const teacher1UserId = '00000000-0000-0000-0000-000000000011';
    const teacher2UserId = '00000000-0000-0000-0000-000000000012';
    const student1UserId = '00000000-0000-0000-0000-000000000021';
    const student2UserId = '00000000-0000-0000-0000-000000000022';

    await db.query(
      `INSERT INTO auth.users (id, email) VALUES
        ($1, 'admin@edutrack.local'),
        ($2, 'teacher1@edutrack.local'),
        ($3, 'teacher2@edutrack.local'),
        ($4, 'student1@edutrack.local'),
        ($5, 'student2@edutrack.local')`,
      [adminId, teacher1UserId, teacher2UserId, student1UserId, student2UserId]
    );

    await db.query(
      `INSERT INTO public.profiles (id, email, full_name, role) VALUES
        ($1, 'admin@edutrack.local', 'Admin User', 'admin'),
        ($2, 'teacher1@edutrack.local', 'Mr. Rami Physics', 'teacher'),
        ($3, 'teacher2@edutrack.local', 'Ms. Nora Math', 'teacher'),
        ($4, 'student1@edutrack.local', 'Youssef Tariq', 'student'),
        ($5, 'student2@edutrack.local', 'Omar Other', 'student')`,
      [adminId, teacher1UserId, teacher2UserId, student1UserId, student2UserId]
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

    const s1Ins = await db.query<{ id: string }>(
      `INSERT INTO public.students (full_name, student_code, grade_level, group_id, qr_code_hash, status)
       VALUES ('Youssef Tariq', 'ET-F-101', 'Grade 10', $1, 'QR-STAGEF-101', 'active') RETURNING id`,
      [group1Id]
    );
    const s2Ins = await db.query<{ id: string }>(
      `INSERT INTO public.students (full_name, student_code, grade_level, group_id, qr_code_hash, status)
       VALUES ('Omar Other', 'ET-M-202', 'Grade 10', $1, 'QR-OTHER-202', 'active') RETURNING id`,
      [group2Id]
    );

    await asUser(db, adminId, 'authenticated', async () => {
      await db.query(`SELECT public.link_student_account($1::uuid, $2::uuid)`, [s1Ins.rows[0].id, student1UserId]);
      await db.query(`SELECT public.link_student_account($1::uuid, $2::uuid)`, [s2Ins.rows[0].id, student2UserId]);
    });

    const futureDueAt = '2026-12-15T18:30:00.000Z';

    // 1. Validation checks: empty title, empty instructions, past due_at
    await expect(
      asUser(db, teacher1UserId, 'authenticated', () =>
        db.query(
          `SELECT public.create_teacher_assignment($1::uuid, '   ', 'حل تمارين الحركة', $2::timestamptz)`,
          [group1Id, futureDueAt]
        )
      )
    ).rejects.toThrow(/title is required/i);

    await expect(
      asUser(db, teacher1UserId, 'authenticated', () =>
        db.query(
          `SELECT public.create_teacher_assignment($1::uuid, 'واجب الحركة', '  ', $2::timestamptz)`,
          [group1Id, futureDueAt]
        )
      )
    ).rejects.toThrow(/instructions are required/i);

    await expect(
      asUser(db, teacher1UserId, 'authenticated', () =>
        db.query(
          `SELECT public.create_teacher_assignment($1::uuid, 'واجب الحركة', 'حل التمارين', '2020-01-01T10:00:00Z'::timestamptz)`,
          [group1Id]
        )
      )
    ).rejects.toThrow(/future/i);

    // 2. Teacher 1 publishes "واجب الحركة" for Physics Group F1
    const publishRes = await asUser(db, teacher1UserId, 'authenticated', () =>
      db.query<{ res: { assignment: { id: string; title: string; group_name: string; due_at: string } } }>(
        `SELECT public.create_teacher_assignment($1::uuid, $2::text, $3::text, $4::timestamptz) AS res`,
        [group1Id, 'واجب الحركة', 'حل مسائل السرعة والتسارع من صفحة 14', futureDueAt]
      )
    );
    expect(publishRes.rows[0].res.assignment.title).toBe('واجب الحركة');
    expect(publishRes.rows[0].res.assignment.group_name).toBe('Physics Group F1');
    expect(new Date(publishRes.rows[0].res.assignment.due_at).toISOString()).toBe(futureDueAt);

    // 3. Separation from grades: no grade rows created
    const gradesCount = await db.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM public.grades`);
    expect(Number(gradesCount.rows[0].cnt)).toBe(0);

    // 4. Student ET-F-101 sees the assignment once
    const s1View = await asUser(db, student1UserId, 'authenticated', () =>
      db.query<{ res: { linked: boolean; assignments: Array<{ title: string; instructions: string; group_name: string }> } }>(
        `SELECT public.get_student_assignments() AS res`
      )
    );
    expect(s1View.rows[0].res.linked).toBe(true);
    expect(s1View.rows[0].res.assignments).toHaveLength(1);
    expect(s1View.rows[0].res.assignments[0].title).toBe('واجب الحركة');
    expect(s1View.rows[0].res.assignments[0].instructions).toBe('حل مسائل السرعة والتسارع من صفحة 14');
    expect(s1View.rows[0].res.assignments[0].group_name).toBe('Physics Group F1');

    // 5. Student from Group 2 does NOT see Physics Group F1 assignment (via RPC or direct SELECT)
    const s2View = await asUser(db, student2UserId, 'authenticated', () =>
      db.query<{ res: { linked: boolean; assignments: unknown[] } }>(`SELECT public.get_student_assignments() AS res`)
    );
    expect(s2View.rows[0].res.linked).toBe(true);
    expect(s2View.rows[0].res.assignments).toHaveLength(0);

    const s2Direct = await asUser(db, student2UserId, 'authenticated', () =>
      db.query(`SELECT id FROM public.assignments`)
    );
    expect(s2Direct.rows).toHaveLength(0);

    // 6. Another teacher (Teacher 2) cannot publish to or read Physics Group F1 assignments
    await expect(
      asUser(db, teacher2UserId, 'authenticated', () =>
        db.query(
          `SELECT public.create_teacher_assignment($1::uuid, 'محاولة غير مصرح بها', 'تعليمات', $2::timestamptz)`,
          [group1Id, futureDueAt]
        )
      )
    ).rejects.toThrow(/Access denied/i);

    await expect(
      asUser(db, teacher2UserId, 'authenticated', () =>
        db.query(`SELECT public.get_teacher_assignments($1::uuid)`, [group1Id])
      )
    ).rejects.toThrow(/Access denied/i);

    // 7. Reassign Physics Group F1 from Teacher 1 to Teacher 2 (simulating group transfer after modal opened)
    await db.query(`UPDATE public.groups SET teacher_id = $1 WHERE id = $2`, [teacher2Id, group1Id]);

    const countBeforeRejected = await db.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM public.assignments`);
    await expect(
      asUser(db, teacher1UserId, 'authenticated', () =>
        db.query(
          `SELECT public.create_teacher_assignment($1::uuid, 'واجب بعد النقل', 'تعليمات متأخرة', $2::timestamptz)`,
          [group1Id, futureDueAt]
        )
      )
    ).rejects.toThrow(/Access denied/i);

    const countAfterRejected = await db.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM public.assignments`);
    expect(countAfterRejected.rows[0].cnt).toBe(countBeforeRejected.rows[0].cnt);
  }, 20000);
});
