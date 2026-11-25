import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

describe('Real PostgreSQL Database Execution Tests (Isolated Engine)', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const schemaSql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261103_edutrack_schema.sql'), 'utf8');
  const upgradeSql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261117_edutrack_admin_auth_upgrade.sql'), 'utf8');
  const correctiveSql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261118000001_edutrack_auth_triggers_fail_closed.sql'), 'utf8');
  const milestone2Sql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261119000001_edutrack_manual_attendance_and_grants.sql'), 'utf8');
  const milestone3Sql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261120000001_edutrack_qr_attendance_and_cairo_time.sql'), 'utf8');
  const milestone3CorrectiveSql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261120000002_edutrack_qr_concurrency_and_time_fix.sql'), 'utf8');
  const gradesFeedbackSql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261120000003_edutrack_grades_and_feedback_integrity.sql'), 'utf8');
  const assessmentLockSql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261120000004_edutrack_assessment_lock_permissions.sql'), 'utf8');
  const teacherManagementSql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261120000005_edutrack_teacher_management_and_group_assignment.sql'), 'utf8');
  const teacherCorrectionsSql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261121000001_edutrack_teacher_management_corrections.sql'), 'utf8');
  const accountLinkingSql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261121000002_edutrack_secure_account_linking.sql'), 'utf8');
  const stageB1CorrectiveSql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261121000003_edutrack_stage_b1_corrective_hardening.sql'), 'utf8');
  const stageB2ExpectedUnlinkSql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261121000004_edutrack_stage_b2_expected_unlink_guards.sql'), 'utf8');
  const stageC1TeacherReadSql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261121000005_edutrack_stage_c1_teacher_read_only_scope.sql'), 'utf8');
  const stageC2TeacherWriteSql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261121000006_edutrack_stage_c2_teacher_grade_and_note_writes.sql'), 'utf8');
  const stageDStudentReadSql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261121000007_edutrack_stage_d_student_read_only_portal.sql'), 'utf8');
  const stageEParentReadSql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261122000001_edutrack_stage_e_parent_read_only_portal.sql'), 'utf8');
  const seedSql = fs.readFileSync(path.join(rootDir, 'supabase/seed.sql'), 'utf8');

  async function createTestDatabase(): Promise<PGlite> {
    const db = new PGlite();

    // Emulate Supabase built-in schema, roles, and auth functions
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

    return db;
  }

  // Broad-grant fixture for legacy RLS tests only; not the minimum production grants.
  // NEVER granting ALL ON ALL ROUTINES (which would overwrite explicit EXECUTE revocations)
  async function grantStandardPermissions(db: PGlite) {
    await db.exec(`
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
      GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
    `);
  }

  it('10. Assessment row locks work with deployed SELECT/INSERT student grants, without granting UPDATE', async () => {
    const db = await createTestDatabase();
    try {
      // Deliberately do NOT call grantStandardPermissions: it masks missing privileges.
      for (const sql of [schemaSql, upgradeSql, correctiveSql, milestone2Sql, milestone3Sql, milestone3CorrectiveSql]) await db.exec(sql);
      await db.exec(seedSql);
      const admin = '99999999-9999-4999-8999-999999999999';
      const parent = '88888888-8888-4888-8888-888888888888';
      const student = 'd1111111-1111-4111-8111-111111111111';
      const group = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const teacher = '11111111-1111-4111-8111-111111111111';
      await db.exec(`
        INSERT INTO auth.users(id, email) VALUES ('${admin}', 'lock-admin@test.local'), ('${parent}', 'lock-parent@test.local');
        INSERT INTO public.profiles(id, email, full_name, role) VALUES
          ('${admin}', 'lock-admin@test.local', 'Admin', 'admin'), ('${parent}', 'lock-parent@test.local', 'Parent', 'parent');
      `);
      await db.exec(fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261120000003_edutrack_grades_and_feedback_integrity.sql'), 'utf8'));
      const setUser = (id: string) => db.exec(`SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${id}';`);
      await setUser(admin);
      expect((await db.query(`SELECT has_table_privilege('authenticated', 'public.students', 'UPDATE') AS allowed`)).rows[0].allowed).toBe(false);
      const gradeSql = `INSERT INTO public.grades(student_id, group_id, assessment_title, score, max_score)
        VALUES ('${student}', '${group}', 'Permission regression', 60, 100) RETURNING id, score`;
      const noteSql = `INSERT INTO public.teacher_notes(student_id, teacher_id, feedback_text, is_parent_visible)
        VALUES ('${student}', '${teacher}', 'Permission regression', false) RETURNING id, is_parent_visible`;
      await expect(db.query(gradeSql)).rejects.toThrow('permission denied for table students');
      await expect(db.query(noteSql)).rejects.toThrow('permission denied for table students');
      await db.exec('RESET ROLE');
      const fix = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261120000004_edutrack_assessment_lock_permissions.sql'), 'utf8');
      await db.exec(fix);
      await db.exec(fix);
      await setUser(admin);
      const saved = await db.query(gradeSql);
      expect(Number(saved.rows[0].score)).toBe(60);
      expect((await db.query(noteSql)).rows[0].is_parent_visible).toBe(false);
      await db.exec(`UPDATE public.grades SET score = 70 WHERE id = '${saved.rows[0].id}'`);
      expect(Number((await db.query(`SELECT score FROM public.grades WHERE id = '${saved.rows[0].id}'`)).rows[0].score)).toBe(70);
      await expect(db.exec(`UPDATE public.students SET full_name = 'Unauthorized edit' WHERE id = '${student}'`)).rejects.toThrow('permission denied');
      await expect(db.query(gradeSql.replace('60, 100', '101, 100'))).rejects.toThrow('Invalid score');
      await expect(db.query(gradeSql.replace(group, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'))).rejects.toThrow('selected group');
      for (const identity of [parent, '']) {
        await setUser(identity);
        expect((await db.query('SELECT * FROM public.grades')).rows).toHaveLength(0);
        expect((await db.query('SELECT * FROM public.teacher_notes')).rows).toHaveLength(0);
        await expect(db.query(gradeSql)).rejects.toThrow('Unauthorized');
        await expect(db.query(noteSql)).rejects.toThrow('Unauthorized');
      }
      await db.exec(`RESET ROLE; SET ROLE anon; SET request.jwt.claim.sub = ''; SET request.jwt.claim.role = 'anon';`);
      await expect(db.query(gradeSql)).rejects.toThrow();
      await expect(db.query(noteSql)).rejects.toThrow();
      for (const role of ['anon', 'authenticated']) {
        for (const func of ['validate_grade_record', 'validate_teacher_note']) {
          expect((await db.query(`SELECT has_function_privilege('${role}', 'public.${func}()', 'EXECUTE') AS allowed`)).rows[0].allowed).toBe(false);
        }
      }
      await db.exec(`RESET ROLE; SET request.jwt.claim.role = ''; SET request.jwt.claim.sub = '';`);
      // Trusted SQL maintenance remains possible without an end-user session.
      expect((await db.query(gradeSql)).rows).toHaveLength(1);
      expect((await db.query(`SELECT has_table_privilege('authenticated', 'public.students', 'UPDATE') AS allowed`)).rows[0].allowed).toBe(false);
    } finally { await db.close(); }
  });

  it('9. Grades and feedback migration preserves records, validates real writes, and retains admin-only RLS', async () => {
    const db = await createTestDatabase();
    try {
      for (const migration of [schemaSql, upgradeSql, correctiveSql, milestone2Sql, milestone3Sql, milestone3CorrectiveSql]) await db.exec(migration);
      await grantStandardPermissions(db);
      await db.exec(seedSql);
      const student = 'd1111111-1111-4111-8111-111111111111';
      const group = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const otherGroup = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const teacher = '11111111-1111-4111-8111-111111111111';
      const admin = '99999999-9999-4999-8999-999999999999';
      const parent = '88888888-8888-4888-8888-888888888888';
      await db.exec(`
        INSERT INTO auth.users(id, email) VALUES ('${admin}', 'grades-admin@test.local'), ('${parent}', 'grades-parent@test.local');
        INSERT INTO public.profiles(id, email, full_name, role) VALUES
          ('${admin}', 'grades-admin@test.local', 'Admin', 'admin'), ('${parent}', 'grades-parent@test.local', 'Parent', 'parent');
        INSERT INTO public.grades(student_id, group_id, assessment_title, score, max_score)
          VALUES ('${student}', '${group}', 'Legacy record', 5, 0);
      `);
      const before = await db.query('SELECT * FROM public.grades ORDER BY id');
      const migration = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261120000003_edutrack_grades_and_feedback_integrity.sql'), 'utf8');
      await db.exec(migration);
      await db.exec(migration);
      await db.exec(fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261120000004_edutrack_assessment_lock_permissions.sql'), 'utf8'));
      expect((await db.query('SELECT * FROM public.grades ORDER BY id')).rows).toEqual(before.rows);
      await db.exec(`SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${admin}';`);
      const insertGrade = (score: string, maximum: string, targetGroup = group, title = 'Quiz', date = "(NOW() AT TIME ZONE 'Africa/Cairo')::DATE") =>
        `INSERT INTO public.grades(student_id, group_id, assessment_title, score, max_score, assessment_date)
        VALUES ('${student}', '${targetGroup}', '${title}', ${score}, ${maximum}, ${date}) RETURNING *`;
      const saved = await db.query(insertGrade('0', '10'));
      expect(Number(saved.rows[0].score)).toBe(0);
      expect(saved.rows[0].group_id).toBe(group);
      for (const sql of [insertGrade('-1', '10'), insertGrade('11', '10'), insertGrade('0', '0'), insertGrade("'NaN'", '10'), insertGrade('1', "'NaN'"), insertGrade('1', '10', otherGroup), insertGrade('1', '10', group, ' '), insertGrade('1', '10', group, 'Quiz', "(NOW() AT TIME ZONE 'Africa/Cairo')::DATE + 1")]) {
        await expect(db.query(sql)).rejects.toThrow();
      }
      await expect(db.exec(`UPDATE public.grades SET score = 11 WHERE id = '${saved.rows[0].id}'`)).rejects.toThrow('Invalid score');
      const insertNote = (text = ' Private feedback ', visibility = 'false', author = teacher) =>
        `INSERT INTO public.teacher_notes(student_id, teacher_id, feedback_text, is_parent_visible) VALUES ('${student}', '${author}', '${text}', ${visibility}) RETURNING *`;
      const note = await db.query(insertNote());
      expect(note.rows[0].feedback_text).toBe('Private feedback');
      expect(note.rows[0].is_parent_visible).toBe(false);
      await expect(db.query(insertNote(' '))).rejects.toThrow('Feedback text');
      await expect(db.query(insertNote('Text', 'NULL'))).rejects.toThrow('visibility');
      await expect(db.query(insertNote('Text', 'false', otherGroup))).rejects.toThrow();
      await db.exec(`UPDATE public.students SET status = 'suspended' WHERE id = '${student}'`);
      await expect(db.query(insertGrade('1', '10'))).rejects.toThrow('active');
      await expect(db.query(insertNote())).rejects.toThrow('active');
      await db.exec(`UPDATE public.students SET status = 'active', group_id = NULL WHERE id = '${student}'`);
      await expect(db.query(insertGrade('1', '10'))).rejects.toThrow('group');
      await expect(db.query(insertNote())).rejects.toThrow('group');
      await db.exec(`UPDATE public.students SET group_id = '${group}' WHERE id = '${student}'`);
      for (const role of ['authenticated', 'anon']) {
        await db.exec(`RESET ROLE; SET ROLE ${role}; SET request.jwt.claim.role = '${role}'; SET request.jwt.claim.sub = '${parent}';`);
        expect((await db.query('SELECT * FROM public.grades')).rows).toHaveLength(0);
        expect((await db.query('SELECT * FROM public.teacher_notes')).rows).toHaveLength(0);
        await expect(db.query(insertGrade('1', '10'))).rejects.toThrow();
        await expect(db.query(insertNote())).rejects.toThrow();
        await db.exec(`UPDATE public.teacher_notes SET is_parent_visible = true WHERE id = '${note.rows[0].id}'`);
      }
      await db.exec('RESET ROLE');
      expect((await db.query(`SELECT is_parent_visible FROM public.teacher_notes WHERE id = '${note.rows[0].id}'`)).rows[0].is_parent_visible).toBe(false);
      expect((await db.query(`SELECT score FROM public.grades WHERE id = '${saved.rows[0].id}'`)).rows[0].score).toBe('0.00');
    } finally { await db.close(); }
  });

  it('1. Fresh setup & Admin provisioning (both for new user and existing non-admin profile)', async () => {
    const db = await createTestDatabase();

    // Execute fresh schema migration
    await db.exec(schemaSql);
    await grantStandardPermissions(db);

    const newAuthUserId = '11111111-2222-4333-8444-555555555555';
    const existingStudentUserId = '22222222-3333-4444-8555-666666666666';

    // Insert mock auth.users records
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES 
        ('${newAuthUserId}', 'newadmin@edutrack.com'),
        ('${existingStudentUserId}', 'student@edutrack.com');
    `);

    // Case A: Provision admin for an Auth user WITHOUT an existing profile
    const resA = await db.query(`
      SELECT * FROM public.provision_admin('${newAuthUserId}', 'newadmin@edutrack.com', 'Fresh Admin');
    `);
    expect(resA.rows.length).toBe(1);

    const checkA = await db.query(`SELECT * FROM public.profiles WHERE id = '${newAuthUserId}';`);
    expect(checkA.rows[0].role).toBe('admin');
    expect(checkA.rows[0].email).toBe('newadmin@edutrack.com');

    // Case B: Provision admin for an Auth user with an EXISTING non-admin profile
    await db.exec(`
      INSERT INTO public.profiles (id, email, full_name, role)
      VALUES ('${existingStudentUserId}', 'student@edutrack.com', 'Existing Student', 'student');
    `);

    const checkBeforeB = await db.query(`SELECT role FROM public.profiles WHERE id = '${existingStudentUserId}';`);
    expect(checkBeforeB.rows[0].role).toBe('student');

    // Upgrade existing profile to admin via provision_admin
    await db.query(`
      SELECT * FROM public.provision_admin('${existingStudentUserId}');
    `);

    const checkAfterB = await db.query(`SELECT role, full_name FROM public.profiles WHERE id = '${existingStudentUserId}';`);
    expect(checkAfterB.rows[0].role).toBe('admin');

    // Also verify direct SQL Editor upsert succeeds as postgres superuser
    const directUpsertId = '33333333-4444-4555-8666-777777777777';
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES ('${directUpsertId}', 'editor@edutrack.com');
      INSERT INTO public.profiles (id, email, full_name, role)
      VALUES ('${directUpsertId}', 'editor@edutrack.com', 'Editor Admin', 'admin')
      ON CONFLICT (id) DO UPDATE SET role = 'admin';
    `);
    const checkDirect = await db.query(`SELECT role FROM public.profiles WHERE id = '${directUpsertId}';`);
    expect(checkDirect.rows[0].role).toBe('admin');
  });

  it('2. Authenticated Admin can create a group and a student assigned to it', async () => {
    const db = await createTestDatabase();
    await db.exec(schemaSql);
    await grantStandardPermissions(db);

    const adminId = '99999999-9999-4999-8999-999999999999';
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'admin@edutrack.com');
      INSERT INTO public.profiles (id, email, full_name, role) VALUES ('${adminId}', 'admin@edutrack.com', 'Admin User', 'admin');
    `);

    // Switch session to Authenticated Admin
    await db.exec(`
      SET ROLE authenticated;
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${adminId}';
    `);

    const groupId = 'aaaaaaaa-1111-4111-8111-111111111111';
    await db.exec(`
      INSERT INTO public.groups (id, name, grade_level, capacity)
      VALUES ('${groupId}', 'Grade 10 Advanced', 'Grade 10', 30);
    `);

    const studentId = 'bbbbbbbb-2222-4222-8222-222222222222';
    await db.exec(`
      INSERT INTO public.students (id, full_name, student_code, group_id, grade_level, qr_code_hash, status)
      VALUES ('${studentId}', 'Kareem Tarek', 'ET-9001', '${groupId}', 'Grade 10', 'QR_KAREEM_9001', 'active');
    `);

    // Verify persistence and group count trigger
    const studentRes = await db.query(`SELECT full_name, student_code, group_id FROM public.students WHERE id = '${studentId}';`);
    expect(studentRes.rows.length).toBe(1);
    expect(studentRes.rows[0].full_name).toBe('Kareem Tarek');
    expect(studentRes.rows[0].group_id).toBe(groupId);

    const groupRes = await db.query(`SELECT enrolled_count FROM public.groups WHERE id = '${groupId}';`);
    expect(groupRes.rows[0].enrolled_count).toBe(1);
  });

  it('3. Anonymous and non-admin clients cannot read or mutate protected data (RLS enforcement)', async () => {
    const db = await createTestDatabase();
    await db.exec(schemaSql);
    await grantStandardPermissions(db);

    const adminId = '99999999-9999-4999-8999-999999999999';
    const studentId = '88888888-8888-4888-8888-888888888888';
    const groupId = 'aaaaaaaa-1111-4111-8111-111111111111';

    // Seed admin, student, and group
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES ('${adminId}', 'admin@edutrack.com'), ('${studentId}', 'student@edutrack.com');
      INSERT INTO public.profiles (id, email, full_name, role) VALUES 
        ('${adminId}', 'admin@edutrack.com', 'Admin User', 'admin'),
        ('${studentId}', 'student@edutrack.com', 'Student User', 'student');
      INSERT INTO public.groups (id, name, grade_level, capacity) VALUES ('${groupId}', 'Protected Group', 'Grade 9', 25);
    `);

    // A. Anonymous client checks
    await db.exec(`
      SET ROLE anon;
      SET request.jwt.claim.role = 'anon';
      RESET request.jwt.claim.sub;
    `);

    const anonGroups = await db.query(`SELECT * FROM public.groups;`);
    expect(anonGroups.rows.length).toBe(0); // Blocked by RLS

    let anonInsertFailed = false;
    try {
      await db.exec(`INSERT INTO public.groups (name, grade_level) VALUES ('Hacked Group', 'Grade 1');`);
    } catch {
      anonInsertFailed = true;
    }
    expect(anonInsertFailed).toBe(true);

    // B. Authenticated Non-Admin (student) client checks
    await db.exec(`
      SET ROLE authenticated;
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${studentId}';
    `);

    const studentGroups = await db.query(`SELECT * FROM public.groups;`);
    expect(studentGroups.rows.length).toBe(0); // Blocked from business data for milestone

    let studentInsertFailed = false;
    try {
      await db.exec(`INSERT INTO public.groups (name, grade_level) VALUES ('Student Group', 'Grade 1');`);
    } catch {
      studentInsertFailed = true;
    }
    expect(studentInsertFailed).toBe(true);
  });

  it('4. Fail-closed role authorization regression suite: missing claim, empty claim, JSON claims, anti-self-promotion & routine permissions', async () => {
    const db = await createTestDatabase();
    await db.exec(schemaSql);
    await grantStandardPermissions(db);

    const studentId = '77777777-7777-4777-8777-777777777777';
    const adminId = '99999999-8888-4888-8888-777777777777';

    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES 
        ('${studentId}', 'student_target@edutrack.com'),
        ('${adminId}', 'admin_user@edutrack.com');
      INSERT INTO public.profiles (id, email, full_name, role) VALUES 
        ('${studentId}', 'student_target@edutrack.com', 'Student Target', 'student'),
        ('${adminId}', 'admin_user@edutrack.com', 'Admin User', 'admin');
    `);

    // 4A: Missing request.jwt.claim.role setting (NULL setting)
    await db.exec(`
      SET ROLE authenticated;
      RESET request.jwt.claim.role;
      RESET request.jwt.claims;
      SET request.jwt.claim.sub = '${studentId}';
    `);

    let missingClaimUpdateFailed = false;
    try {
      await db.exec(`UPDATE public.profiles SET role = 'admin' WHERE id = '${studentId}';`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      missingClaimUpdateFailed = true;
      expect(message).toContain('Unauthorized: Only administrators can modify user roles');
    }
    expect(missingClaimUpdateFailed).toBe(true);

    // Assert stored role remains unchanged after failed attempt
    const checkRoleMissing = await db.query(`SELECT role FROM public.profiles WHERE id = '${studentId}';`);
    expect(checkRoleMissing.rows[0].role).toBe('student');

    // 4B: Empty setting ('')
    await db.exec(`
      SET ROLE authenticated;
      SET request.jwt.claim.role = '';
      SET request.jwt.claims = '';
      SET request.jwt.claim.sub = '${studentId}';
    `);

    let emptyClaimUpdateFailed = false;
    try {
      await db.exec(`UPDATE public.profiles SET role = 'admin' WHERE id = '${studentId}';`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      emptyClaimUpdateFailed = true;
      expect(message).toContain('Unauthorized: Only administrators can modify user roles');
    }
    expect(emptyClaimUpdateFailed).toBe(true);

    const checkRoleEmpty = await db.query(`SELECT role FROM public.profiles WHERE id = '${studentId}';`);
    expect(checkRoleEmpty.rows[0].role).toBe('student');

    // 4C: Supported JSON claims representation without legacy setting
    // Authenticated non-admin claims in JSON format
    await db.exec(`
      SET ROLE authenticated;
      RESET request.jwt.claim.role;
      SET request.jwt.claims = '{"role": "authenticated", "sub": "${studentId}"}';
      SET request.jwt.claim.sub = '${studentId}';
    `);

    let jsonClaimsStudentFailed = false;
    try {
      await db.exec(`UPDATE public.profiles SET role = 'admin' WHERE id = '${studentId}';`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      jsonClaimsStudentFailed = true;
      expect(message).toContain('Unauthorized: Only administrators can modify user roles');
    }
    expect(jsonClaimsStudentFailed).toBe(true);

    const checkRoleJson = await db.query(`SELECT role FROM public.profiles WHERE id = '${studentId}';`);
    expect(checkRoleJson.rows[0].role).toBe('student');

    // 4D: Self-promotion via INSERT
    let insertFailed = false;
    try {
      await db.exec(`
        INSERT INTO public.profiles (id, email, full_name, role)
        VALUES ('${studentId}', 'student_target@edutrack.com', 'Fake Admin', 'admin');
      `);
    } catch {
      insertFailed = true;
    }
    expect(insertFailed).toBe(true);

    // 4E: Self-promotion via UPSERT
    let upsertFailed = false;
    try {
      await db.exec(`
        INSERT INTO public.profiles (id, email, full_name, role)
        VALUES ('${studentId}', 'student_target@edutrack.com', 'Fake Admin', 'admin')
        ON CONFLICT (id) DO UPDATE SET role = 'admin';
      `);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      upsertFailed = true;
      expect(message).toMatch(/Unauthorized: Only administrators can (assign the admin role|modify user roles)/);
    }
    expect(upsertFailed).toBe(true);

    const checkRoleUpsert = await db.query(`SELECT role FROM public.profiles WHERE id = '${studentId}';`);
    expect(checkRoleUpsert.rows[0].role).toBe('student');

    // 4F: Verify that anon and authenticated lack EXECUTE on provision_admin
    // Under anon role
    await db.exec(`
      SET ROLE anon;
      RESET request.jwt.claim.role;
      RESET request.jwt.claims;
      RESET request.jwt.claim.sub;
    `);

    let anonExecuteFailed = false;
    try {
      await db.query(`SELECT * FROM public.provision_admin('${studentId}');`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      anonExecuteFailed = true;
      expect(message).toMatch(/(permission denied|Unauthorized)/i);
    }
    expect(anonExecuteFailed).toBe(true);

    // Under authenticated student role
    await db.exec(`
      SET ROLE authenticated;
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${studentId}';
    `);

    let studentExecuteFailed = false;
    try {
      await db.query(`SELECT * FROM public.provision_admin('${studentId}');`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      studentExecuteFailed = true;
      expect(message).toMatch(/(permission denied|Unauthorized)/i);
    }
    expect(studentExecuteFailed).toBe(true);

    // Even under an authenticated user whose profile role is 'admin',
    // provision_admin is maintenance-only (revoked from authenticated role)
    await db.exec(`
      SET ROLE authenticated;
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${adminId}';
    `);

    let adminUserExecuteFailed = false;
    try {
      await db.query(`SELECT * FROM public.provision_admin('${studentId}');`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      adminUserExecuteFailed = true;
      expect(message).toMatch(/(permission denied|Unauthorized)/i);
    }
    expect(adminUserExecuteFailed).toBe(true);

    // Verify stored student role is STILL strictly 'student' after all rejected attempts
    await db.exec(`RESET ROLE;`);
    const finalStoredRole = await db.query(`SELECT role FROM public.profiles WHERE id = '${studentId}';`);
    expect(finalStoredRole.rows[0].role).toBe('student');
  });

  it('5. Running optional seed twice does not duplicate records (repeatable execution)', async () => {
    const db = await createTestDatabase();
    await db.exec(schemaSql);
    await grantStandardPermissions(db);

    // First execution of seed
    await db.exec(seedSql);

    const teachersCount1 = (await db.query(`SELECT COUNT(*) as c FROM public.teachers;`)).rows[0].c;
    const groupsCount1 = (await db.query(`SELECT COUNT(*) as c FROM public.groups;`)).rows[0].c;
    const studentsCount1 = (await db.query(`SELECT COUNT(*) as c FROM public.students;`)).rows[0].c;
    const gradesCount1 = (await db.query(`SELECT COUNT(*) as c FROM public.grades;`)).rows[0].c;
    const notesCount1 = (await db.query(`SELECT COUNT(*) as c FROM public.teacher_notes;`)).rows[0].c;
    const logsCount1 = (await db.query(`SELECT COUNT(*) as c FROM public.activity_logs;`)).rows[0].c;

    expect(Number(teachersCount1)).toBe(3);
    expect(Number(groupsCount1)).toBe(3);
    expect(Number(studentsCount1)).toBe(4);
    expect(Number(gradesCount1)).toBe(5);
    expect(Number(notesCount1)).toBe(1);
    expect(Number(logsCount1)).toBe(4);

    // Second execution of seed (simulating re-run)
    await db.exec(seedSql);

    const teachersCount2 = (await db.query(`SELECT COUNT(*) as c FROM public.teachers;`)).rows[0].c;
    const groupsCount2 = (await db.query(`SELECT COUNT(*) as c FROM public.groups;`)).rows[0].c;
    const studentsCount2 = (await db.query(`SELECT COUNT(*) as c FROM public.students;`)).rows[0].c;
    const gradesCount2 = (await db.query(`SELECT COUNT(*) as c FROM public.grades;`)).rows[0].c;
    const notesCount2 = (await db.query(`SELECT COUNT(*) as c FROM public.teacher_notes;`)).rows[0].c;
    const logsCount2 = (await db.query(`SELECT COUNT(*) as c FROM public.activity_logs;`)).rows[0].c;

    // Zero duplicate records created
    expect(teachersCount2).toBe(teachersCount1);
    expect(groupsCount2).toBe(groupsCount1);
    expect(studentsCount2).toBe(studentsCount1);
    expect(gradesCount2).toBe(gradesCount1);
    expect(notesCount2).toBe(notesCount1);
    expect(logsCount2).toBe(logsCount1);
  });

  it('6. Non-destructive upgrade path: applies legacy -> upgrade -> corrective migration with fail-closed security', async () => {
    const db = await createTestDatabase();

    // 1. Simulate existing legacy schema with permissive policies (USING true)
    await db.exec(`
      CREATE TABLE public.profiles (
        id UUID PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE public.groups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        grade_level TEXT NOT NULL,
        teacher_id UUID,
        capacity INT DEFAULT 30,
        enrolled_count INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE public.students (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        full_name TEXT NOT NULL,
        student_code TEXT UNIQUE NOT NULL,
        group_id UUID REFERENCES public.groups(id),
        grade_level TEXT NOT NULL,
        qr_code_hash TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE public.teachers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        full_name TEXT NOT NULL,
        subject TEXT,
        email TEXT UNIQUE,
        phone TEXT
      );

      CREATE TABLE public.attendance (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id UUID REFERENCES public.students(id),
        date DATE DEFAULT CURRENT_DATE,
        status TEXT DEFAULT 'Present'
      );

      CREATE TABLE public.grades (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id UUID REFERENCES public.students(id),
        group_id UUID REFERENCES public.groups(id),
        score NUMERIC(5,2)
      );

      CREATE TABLE public.teacher_notes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id UUID REFERENCES public.students(id),
        feedback_text TEXT
      );

      CREATE TABLE public.activity_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT,
        description TEXT,
        type TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

      -- Legacy permissive policies
      CREATE POLICY "Admins have full access to groups" ON public.groups FOR ALL USING (true);
      CREATE POLICY "Admins have full access to students" ON public.students FOR ALL USING (true);
    `);

    // 2. Insert pre-existing business records
    const legacyAdminId = '44444444-4444-4444-8444-444444444444';
    const legacyStudentId = '55555555-5555-4555-8555-555555555555';
    await db.exec(`
      INSERT INTO public.profiles (id, email, full_name, role) VALUES 
        ('${legacyAdminId}', 'admin@legacy.com', 'Legacy Admin', 'admin'),
        ('${legacyStudentId}', 'student@legacy.com', 'Legacy Student', 'student');

      INSERT INTO public.groups (id, name, grade_level) VALUES ('99999999-0000-4000-8000-000000000000', 'Pre-existing Group', 'Grade 6');
    `);

    // 3. Apply the upgrade migration
    await db.exec(upgradeSql);

    // 4. Apply the corrective migration
    await db.exec(correctiveSql);

    // 5. Apply the Milestone 2 attendance migration
    await db.exec(milestone2Sql);
    await grantStandardPermissions(db);

    // 6. Verify pre-existing data is preserved
    const preservedGroup = await db.query(`SELECT name FROM public.groups WHERE id = '99999999-0000-4000-8000-000000000000';`);
    expect(preservedGroup.rows.length).toBe(1);
    expect(preservedGroup.rows[0].name).toBe('Pre-existing Group');

    // 7. Verify permissive access was removed and strict RLS is enforced
    await db.exec(`
      SET ROLE authenticated;
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${legacyStudentId}';
    `);

    // Student should now be BLOCKED from reading groups (previously allowed under USING true)
    const groupsBlocked = await db.query(`SELECT * FROM public.groups;`);
    expect(groupsBlocked.rows.length).toBe(0);

    // 8. Verify fail-closed self-promotion rejection on upgraded instance
    let studentUpgradeSelfPromoteFailed = false;
    try {
      await db.exec(`UPDATE public.profiles SET role = 'admin' WHERE id = '${legacyStudentId}';`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      studentUpgradeSelfPromoteFailed = true;
      expect(message).toContain('Unauthorized: Only administrators can modify user roles');
    }
    expect(studentUpgradeSelfPromoteFailed).toBe(true);

    const checkStudentRoleUnchanged = await db.query(`SELECT role FROM public.profiles WHERE id = '${legacyStudentId}';`);
    expect(checkStudentRoleUnchanged.rows[0].role).toBe('student');

    // Reset role to test admin access
    await db.exec(`
      SET ROLE authenticated;
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${legacyAdminId}';
    `);

    const adminGroups = await db.query(`SELECT * FROM public.groups;`);
    expect(adminGroups.rows.length).toBe(1);
    expect(adminGroups.rows[0].name).toBe('Pre-existing Group');
  });

  it('7. Milestone 2: Persistent Manual Attendance, RLS, Integrity Trigger & Identity Enforcement', async () => {
    const db = await createTestDatabase();

    // 1. Fresh setup using full schema (which incorporates Milestone 2 constraints)
    await db.exec(schemaSql);
    await db.exec(milestone2Sql);

    const adminUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const studentUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const otherStudentUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    // Insert auth users & profiles
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${adminUserId}', 'admin@edutrack.com'),
        ('${studentUserId}', 'student@edutrack.com'),
        ('${otherStudentUserId}', 'other_student@edutrack.com');

      INSERT INTO public.profiles (id, email, full_name, role) VALUES
        ('${adminUserId}', 'admin@edutrack.com', 'Admin User', 'admin'),
        ('${studentUserId}', 'student@edutrack.com', 'Student User', 'student'),
        ('${otherStudentUserId}', 'other_student@edutrack.com', 'Other Student', 'student');
    `);

    // Create groups and students
    const groupIdA = '11111111-1111-4111-8111-111111111111';
    const groupIdB = '22222222-2222-4222-8222-222222222222';
    const studentIdA = '33333333-3333-4333-8333-333333333333';
    const studentIdB = '44444444-4444-4444-8444-444444444444';

    await db.exec(`
      INSERT INTO public.groups (id, name, grade_level) VALUES
        ('${groupIdA}', 'Grade 8A', 'Grade 8'),
        ('${groupIdB}', 'Grade 8B', 'Grade 8');

      INSERT INTO public.students (id, user_id, full_name, student_code, group_id, grade_level, qr_code_hash) VALUES
        ('${studentIdA}', '${studentUserId}', 'Student In Group A', 'ET-8001', '${groupIdA}', 'Grade 8', 'QR-8001'),
        ('${studentIdB}', '${otherStudentUserId}', 'Student In Group B', 'ET-8002', '${groupIdB}', 'Grade 8', 'QR-8002');
    `);

    // 7A: Authenticated Admin records student attendance (Present)
    await db.exec(`
      SET ROLE authenticated;
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${adminUserId}';
    `);

    // Attempt to forge scanned_by with another user id
    const forgedScannerId = '99999999-9999-4999-8999-999999999999';
    await db.exec(`
      INSERT INTO public.attendance (student_id, group_id, date, status, scan_method, scanned_by)
      VALUES ('${studentIdA}', '${groupIdA}', '2026-11-19', 'Present', 'manual', '${forgedScannerId}');
    `);

    // Verify record was created and scanned_by was derived from auth.uid() (cannot be forged!)
    const savedRec = await db.query(`SELECT * FROM public.attendance WHERE student_id = '${studentIdA}' AND date = '2026-11-19';`);
    expect(savedRec.rows.length).toBe(1);
    expect(savedRec.rows[0].status).toBe('Present');
    expect(savedRec.rows[0].scanned_by).toBe(adminUserId); // Forgery overwritten by trigger!
    expect(savedRec.rows[0].check_in_time).not.toBeNull(); // Present has check_in_time

    // 7B: Correcting status without duplicate rows (Present -> Late)
    await db.exec(`
      INSERT INTO public.attendance (student_id, group_id, date, status, scan_method)
      VALUES ('${studentIdA}', '${groupIdA}', '2026-11-19', 'Late', 'manual')
      ON CONFLICT (student_id, date) DO UPDATE SET status = 'Late';
    `);

    const updatedRec = await db.query(`SELECT * FROM public.attendance WHERE student_id = '${studentIdA}' AND date = '2026-11-19';`);
    expect(updatedRec.rows.length).toBe(1); // EXACTLY ONE ROW, NO DUPLICATE
    expect(updatedRec.rows[0].status).toBe('Late');

    // 7C: Correcting status to Absent -> check_in_time must become NULL (no fabricated time)
    await db.exec(`
      INSERT INTO public.attendance (student_id, group_id, date, status, scan_method)
      VALUES ('${studentIdA}', '${groupIdA}', '2026-11-19', 'Absent', 'manual')
      ON CONFLICT (student_id, date) DO UPDATE SET status = 'Absent';
    `);

    const absentRec = await db.query(`SELECT * FROM public.attendance WHERE student_id = '${studentIdA}' AND date = '2026-11-19';`);
    expect(absentRec.rows.length).toBe(1);
    expect(absentRec.rows[0].status).toBe('Absent');
    expect(absentRec.rows[0].check_in_time).toBeNull(); // Strict NULL enforcement

    // 7D: Database rejection of invalid student/group combinations
    let invalidGroupFailed = false;
    try {
      // studentIdA belongs to groupIdA, attempting to record for groupIdB
      await db.exec(`
        INSERT INTO public.attendance (student_id, group_id, date, status, scan_method)
        VALUES ('${studentIdA}', '${groupIdB}', '2026-11-20', 'Present', 'manual');
      `);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      invalidGroupFailed = true;
      expect(message).toContain('Student does not belong to the specified group');
    }
    expect(invalidGroupFailed).toBe(true);

    // 7E: Direct non-admin and anonymous access remaining BLOCKED (RLS & Table Grants)
    // Anonymous user attempt
    await db.exec(`
      SET ROLE anon;
      RESET request.jwt.claim.role;
      RESET request.jwt.claim.sub;
    `);

    // Anon read is blocked either by lack of table grant or RLS returning 0 rows
    let anonReadBlocked: boolean;
    try {
      const anonAttendanceRead = await db.query(`SELECT * FROM public.attendance;`);
      expect(anonAttendanceRead.rows.length).toBe(0);
      anonReadBlocked = true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      anonReadBlocked = true;
      expect(message).toMatch(/(permission denied|violates row-level security)/i);
    }
    expect(anonReadBlocked).toBe(true);

    let anonInsertFailed = false;
    try {
      await db.exec(`
        INSERT INTO public.attendance (student_id, group_id, date, status)
        VALUES ('${studentIdB}', '${groupIdB}', '2026-11-19', 'Present');
      `);
    } catch {
      anonInsertFailed = true;
    }
    expect(anonInsertFailed).toBe(true);

    // Non-admin (student) authenticated user attempt
    await db.exec(`
      SET ROLE authenticated;
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${studentUserId}';
    `);

    const studentAttendanceRead = await db.query(`SELECT * FROM public.attendance;`);
    expect(studentAttendanceRead.rows.length).toBe(0); // Blocked by RLS

    let studentInsertFailed = false;
    try {
      await db.exec(`
        INSERT INTO public.attendance (student_id, group_id, date, status)
        VALUES ('${studentIdB}', '${groupIdB}', '2026-11-19', 'Present');
      `);
    } catch {
      studentInsertFailed = true;
    }
    expect(studentInsertFailed).toBe(true);
  });

  it('8. Milestone 3 QR Attendance & Student Cards Verification', async () => {
    const db = await createTestDatabase();

    // 1. Apply full migration chain through Milestone 3 and corrective migration
    await db.exec(schemaSql);
    await db.exec(upgradeSql);
    await db.exec(correctiveSql);
    await db.exec(milestone2Sql);
    await db.exec(milestone3Sql);
    await db.exec(milestone3CorrectiveSql);
    await grantStandardPermissions(db);

    const adminUserId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const studentUserId = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

    // Provision admin and student in auth.users & profiles
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${adminUserId}', 'admin3@edutrack.com'),
        ('${studentUserId}', 'student3@edutrack.com');

      SELECT public.provision_admin('${adminUserId}', 'admin3@edutrack.com', 'Admin Milestone3');

      INSERT INTO public.profiles (id, email, full_name, role)
      VALUES ('${studentUserId}', 'student3@edutrack.com', 'Student NonAdmin', 'student');
    `);

    // Create groups and students
    const groupIdA = '11111111-0000-4000-8000-000000000001';
    const groupIdB = '11111111-0000-4000-8000-000000000002';
    const studentId1 = '22222222-0000-4000-8000-000000000001';
    const studentId2 = '22222222-0000-4000-8000-000000000002';
    const studentId3 = '22222222-0000-4000-8000-000000000003';
    const studentIdUnassigned = '22222222-0000-4000-8000-000000000004';
    const studentIdConcurrent = '22222222-0000-4000-8000-000000000005';

    await db.exec(`
      INSERT INTO public.groups (id, name, grade_level) VALUES
        ('${groupIdA}', 'Physics 101', 'Grade 10'),
        ('${groupIdB}', 'Chemistry 101', 'Grade 11');

      INSERT INTO public.students (id, full_name, student_code, group_id, grade_level, qr_code_hash, status) VALUES
        ('${studentId1}', 'Sara Adel', 'ET-3001', '${groupIdA}', 'Grade 10', 'QR-SARA-001', 'active'),
        ('${studentId2}', 'Kareem Tarek', 'ET-3002', '${groupIdB}', 'Grade 11', 'QR-KAREEM-002', 'active'),
        ('${studentId3}', 'Inactive User', 'ET-3003', '${groupIdA}', 'Grade 10', 'QR-INACT-003', 'suspended'),
        ('${studentIdUnassigned}', 'Unassigned User', 'ET-3004', NULL, 'Grade 10', 'QR-UNASSIGNED-004', 'active'),
        ('${studentIdConcurrent}', 'Concurrent User', 'ET-3005', '${groupIdA}', 'Grade 10', 'QR-CONCURRENT-005', 'active');
    `);

    // Switch to authenticated admin
    await db.exec(`
      SET ROLE authenticated;
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${adminUserId}';
    `);

    // 8A: Concurrency-Safe QR Scans (Promise.all concurrent execution)
    // Both requests fire concurrently without serial pre-check gating
    const [concurrentRes1, concurrentRes2] = await Promise.all([
      db.query(`SELECT public.record_qr_attendance('QR-CONCURRENT-005', '${groupIdA}') as res;`),
      db.query(`SELECT public.record_qr_attendance('QR-CONCURRENT-005', '${groupIdA}') as res;`)
    ]);

    type QrRpcPayload = {
      code?: string;
      success?: boolean;
      attendance?: { check_in_time?: string };
    };
    const cJson1 = concurrentRes1.rows[0].res as QrRpcPayload;
    const cJson2 = concurrentRes2.rows[0].res as QrRpcPayload;

    // One must be RECORDED, the other must be ALREADY_RECORDED (no unhandled unique_violation!)
    const codes = [cJson1.code, cJson2.code].sort();
    expect(codes).toEqual(['ALREADY_RECORDED', 'RECORDED']);
    expect(cJson1.success).toBe(true);
    expect(cJson2.success).toBe(true);

    // Verify arrival times agree and exactly 1 attendance row was written
    const arrivalTime1 = cJson1.attendance?.check_in_time;
    const arrivalTime2 = cJson2.attendance?.check_in_time;
    expect(arrivalTime1).toBe(arrivalTime2);

    const concurrentCount = await db.query(`
      SELECT COUNT(*) as count FROM public.attendance WHERE student_id = '${studentIdConcurrent}';
    `);
    expect(Number(concurrentCount.rows[0].count)).toBe(1);

    // 8B: Group Validation
    // Rejects null group
    const nullGroupRes = await db.query(`
      SELECT public.record_qr_attendance('QR-SARA-001', NULL) as res;
    `);
    expect((nullGroupRes.rows[0].res as QrRpcPayload).code).toBe('GROUP_REQUIRED');

    // Rejects unassigned student
    const unassignedRes = await db.query(`
      SELECT public.record_qr_attendance('QR-UNASSIGNED-004', '${groupIdA}') as res;
    `);
    expect((unassignedRes.rows[0].res as QrRpcPayload).code).toBe('STUDENT_UNASSIGNED');

    // Rejects group mismatch
    const mismatchRes = await db.query(`
      SELECT public.record_qr_attendance('QR-KAREEM-002', '${groupIdA}') as res;
    `);
    expect((mismatchRes.rows[0].res as QrRpcPayload).code).toBe('GROUP_MISMATCH');

    // Rejects historical attendance under another group
    // Mark Sara for group B on another date, then attempt group A
    await db.exec(`
      INSERT INTO public.attendance (student_id, group_id, date, status, scan_method)
      VALUES ('${studentId1}', '${groupIdA}', (NOW() AT TIME ZONE 'Africa/Cairo')::DATE, 'Present', 'manual');
    `);
    const histMismatchRes = await db.query(`
      SELECT public.record_qr_attendance('QR-SARA-001', '${groupIdB}') as res;
    `);
    // First hits student's assigned group mismatch or historical group mismatch
    expect((histMismatchRes.rows[0].res as QrRpcPayload).code).toMatch(/(GROUP_MISMATCH|HISTORICAL_GROUP_MISMATCH)/);

    // 8C: Attendance Time Correctness & Preservation
    // 1. Present <-> Late corrections retain original arrival time
    const initialAtt = (await db.query(`
      SELECT check_in_time FROM public.attendance WHERE student_id = '${studentId1}';
    `)).rows[0].check_in_time;
    expect(initialAtt).toBeDefined();

    // UPDATE to Late without check_in_time
    await db.exec(`
      UPDATE public.attendance SET status = 'Late', check_in_time = NULL WHERE student_id = '${studentId1}';
    `);
    const afterLateAtt = (await db.query(`
      SELECT status, check_in_time FROM public.attendance WHERE student_id = '${studentId1}';
    `)).rows[0];
    expect(afterLateAtt.status).toBe('Late');
    expect(afterLateAtt.check_in_time).toBe(initialAtt); // Strictly retained!

    // UPDATE back to Present
    await db.exec(`
      UPDATE public.attendance SET status = 'Present', check_in_time = NULL WHERE student_id = '${studentId1}';
    `);
    const afterPresentAtt = (await db.query(`
      SELECT status, check_in_time FROM public.attendance WHERE student_id = '${studentId1}';
    `)).rows[0];
    expect(afterPresentAtt.status).toBe('Present');
    expect(afterPresentAtt.check_in_time).toBe(initialAtt); // Strictly retained!

    // 2. Backdated manual entries do NOT fabricate current time
    await db.exec(`
      INSERT INTO public.attendance (student_id, group_id, date, status, check_in_time)
      VALUES ('${studentId2}', '${groupIdB}', '2026-10-15', 'Present', NULL);
    `);
    const backdatedAtt = (await db.query(`
      SELECT check_in_time FROM public.attendance WHERE student_id = '${studentId2}' AND date = '2026-10-15';
    `)).rows[0];
    expect(backdatedAtt.check_in_time).toBeNull();

    // 3. Future attendance do NOT fabricate current time
    await db.exec(`
      INSERT INTO public.attendance (student_id, group_id, date, status, check_in_time)
      VALUES ('${studentId2}', '${groupIdB}', '2026-12-25', 'Late', NULL);
    `);
    const futureAtt = (await db.query(`
      SELECT check_in_time FROM public.attendance WHERE student_id = '${studentId2}' AND date = '2026-12-25';
    `)).rows[0];
    expect(futureAtt.check_in_time).toBeNull();

    // 4. Absent and Excused records strictly receive NULL check_in_time
    await db.exec(`
      INSERT INTO public.attendance (student_id, group_id, date, status, check_in_time)
      VALUES ('${studentId2}', '${groupIdB}', '2026-10-16', 'Absent', '08:30:00');
    `);
    const absentAtt = (await db.query(`
      SELECT check_in_time FROM public.attendance WHERE student_id = '${studentId2}' AND date = '2026-10-16';
    `)).rows[0];
    expect(absentAtt.check_in_time).toBeNull();

    // 5. Database default for attendance.date uses Africa/Cairo
    const defaultCheck = await db.query(`
      SELECT column_default FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'attendance' AND column_name = 'date';
    `);
    expect(defaultCheck.rows[0].column_default).toContain('Africa/Cairo');

    // 8D: Function Privileges Verification
    // Anonymous role must NOT have execute privilege
    const anonPrivCheck = await db.query(`
      SELECT has_function_privilege('anon', 'public.record_qr_attendance(TEXT, UUID)', 'EXECUTE') as priv;
    `);
    expect(anonPrivCheck.rows[0].priv).toBe(false);

    // Authenticated role has execute privilege
    const authPrivCheck = await db.query(`
      SELECT has_function_privilege('authenticated', 'public.record_qr_attendance(TEXT, UUID)', 'EXECUTE') as priv;
    `);
    expect(authPrivCheck.rows[0].priv).toBe(true);

    // Direct anonymous call fails
    await db.exec(`
      SET ROLE anon;
      RESET request.jwt.claim.role;
      RESET request.jwt.claim.sub;
    `);
    let anonCallBlocked = false;
    try {
      await db.query(`SELECT public.record_qr_attendance('QR-SARA-001', '${groupIdA}');`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      anonCallBlocked = true;
      expect(message).toMatch(/(permission denied|privilege)/i);
    }
    expect(anonCallBlocked).toBe(true);

    // Non-admin authenticated user call fails closed via internal check
    await db.exec(`
      SET ROLE authenticated;
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${studentUserId}';
    `);
    let nonAdminCallBlocked = false;
    try {
      await db.query(`SELECT public.record_qr_attendance('QR-SARA-001', '${groupIdA}');`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      nonAdminCallBlocked = true;
      expect(message).toContain('Unauthorized');
    }
    expect(nonAdminCallBlocked).toBe(true);

    // 8E: Verify student cards query uses only real schema columns
    await db.exec(`
      SET ROLE authenticated;
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${adminUserId}';
    `);
    const cardsQueryRes = await db.query(`
      SELECT s.id, s.full_name, s.student_code, s.group_id, s.grade_level, s.qr_code_hash, s.status, g.name as group_name
      FROM public.students s
      LEFT JOIN public.groups g ON s.group_id = g.id
      ORDER BY s.full_name;
    `);
    expect(cardsQueryRes.rows.length).toBe(5);
    expect(cardsQueryRes.rows[0]).toHaveProperty('qr_code_hash');
    expect(cardsQueryRes.rows[0]).toHaveProperty('grade_level');
    expect(cardsQueryRes.rows[0]).not.toHaveProperty('photo_url');
    expect(cardsQueryRes.rows[0]).not.toHaveProperty('qr_token');
  });

  it('11. Admin Teacher Management & Group Assignment (Isolated Engine)', async () => {
    const db = await createTestDatabase();

    // 1. Apply full migration chain including Milestone 5.1 corrections
    for (const sql of [
      schemaSql,
      upgradeSql,
      correctiveSql,
      milestone2Sql,
      milestone3Sql,
      milestone3CorrectiveSql,
      gradesFeedbackSql,
      assessmentLockSql,
      teacherManagementSql,
      teacherCorrectionsSql,
    ]) {
      await db.exec(sql);
    }

    // Test idempotency: re-applying teacherCorrectionsSql must not fail
    await db.exec(teacherCorrectionsSql);

    // Apply seed data
    await db.exec(seedSql);

    const adminUserId = '99999999-9999-4999-8999-999999999999';
    const parentUserId = '88888888-8888-4888-8888-888888888888';

    await db.exec(`
      INSERT INTO auth.users(id, email) VALUES
        ('${adminUserId}', 'admin-teacher-test@test.local'),
        ('${parentUserId}', 'parent-teacher-test@test.local');
      INSERT INTO public.profiles(id, email, full_name, role) VALUES
        ('${adminUserId}', 'admin-teacher-test@test.local', 'Admin User', 'admin'),
        ('${parentUserId}', 'parent-teacher-test@test.local', 'Parent User', 'parent');
    `);

    // Helper to switch DB session role and auth claims
    const setRole = (role: string, sub?: string) => {
      if (role === 'anon') {
        return db.exec(`
          SET ROLE anon;
          RESET request.jwt.claim.role;
          RESET request.jwt.claim.sub;
        `);
      }
      return db.exec(`
        SET ROLE ${role};
        SET request.jwt.claim.role = '${role}';
        SET request.jwt.claim.sub = '${sub || ''}';
      `);
    };

    // --- A. Privilege Verification on Hardened Production Grants ---
    // Authenticated role has SELECT and INSERT on teachers, but REFERENCES is revoked
    const authTeachersSelect = await db.query(`SELECT has_table_privilege('authenticated', 'public.teachers', 'SELECT') as priv;`);
    const authTeachersInsert = await db.query(`SELECT has_table_privilege('authenticated', 'public.teachers', 'INSERT') as priv;`);
    const authTeachersReferences = await db.query(`SELECT has_table_privilege('authenticated', 'public.teachers', 'REFERENCES') as priv;`);
    expect(authTeachersSelect.rows[0].priv).toBe(true);
    expect(authTeachersInsert.rows[0].priv).toBe(true);
    expect(authTeachersReferences.rows[0].priv).toBe(false); // Verified: unnecessary REFERENCES revoked

    // Authenticated role has table-level UPDATE revoked on groups, but has column-level UPDATE on teacher_id & updated_at
    const authGroupsTableUpdate = await db.query(`SELECT has_table_privilege('authenticated', 'public.groups', 'UPDATE') as priv;`);
    const authGroupsTeacherIdUpdate = await db.query(`SELECT has_column_privilege('authenticated', 'public.groups', 'teacher_id', 'UPDATE') as priv;`);
    const authGroupsUpdatedAtUpdate = await db.query(`SELECT has_column_privilege('authenticated', 'public.groups', 'updated_at', 'UPDATE') as priv;`);
    const authGroupsNameUpdate = await db.query(`SELECT has_column_privilege('authenticated', 'public.groups', 'name', 'UPDATE') as priv;`);
    const authGroupsCapacityUpdate = await db.query(`SELECT has_column_privilege('authenticated', 'public.groups', 'capacity', 'UPDATE') as priv;`);

    expect(authGroupsTableUpdate.rows[0].priv).toBe(false); // Verified: broad table UPDATE revoked
    expect(authGroupsTeacherIdUpdate.rows[0].priv).toBe(true); // Column update granted
    expect(authGroupsUpdatedAtUpdate.rows[0].priv).toBe(true); // Column update granted
    expect(authGroupsNameUpdate.rows[0].priv).toBe(false); // Protected column
    expect(authGroupsCapacityUpdate.rows[0].priv).toBe(false); // Protected column

    const anonTeachersInsert = await db.query(`SELECT has_table_privilege('anon', 'public.teachers', 'INSERT') as priv;`);
    const anonGroupsUpdate = await db.query(`SELECT has_table_privilege('anon', 'public.groups', 'UPDATE') as priv;`);
    expect(anonTeachersInsert.rows[0].priv).toBe(false);
    expect(anonGroupsUpdate.rows[0].priv).toBe(false);

    // --- B. Admin Teacher Creation & Security Boundaries ---
    await setRole('authenticated', adminUserId);

    // 1. Successfully create a real teacher record
    const newTeacherRes = await db.query(`
      INSERT INTO public.teachers (full_name, subject, email, phone)
      VALUES ('  Dr. Tamer Samir  ', '  Physics  ', '  TAMER.SAMIR@EduTrack.EDU  ', '  +201012345678  ')
      RETURNING id, full_name, subject, email, phone, user_id;
    `);
    expect(newTeacherRes.rows.length).toBe(1);
    const newTeacher = newTeacherRes.rows[0];
    expect(newTeacher.full_name).toBe('Dr. Tamer Samir');
    expect(newTeacher.subject).toBe('Physics');
    expect(newTeacher.email).toBe('tamer.samir@edutrack.edu');
    expect(newTeacher.phone).toBe('+201012345678');
    expect(newTeacher.user_id).toBeNull();

    // 2. Direct user_id injection is blocked at the database trigger layer
    await expect(db.query(`
      INSERT INTO public.teachers (full_name, subject, email, user_id)
      VALUES ('Hacker Teacher', 'Math', 'hacker@edutrack.edu', '${adminUserId}');
    `)).rejects.toThrow(/Direct user_id assignment is prohibited/i);

    // 3. Email format validation (accepts a@b.co; rejects internal space, multiple @, missing suffix)
    const shortDomainRes = await db.query(`
      INSERT INTO public.teachers (full_name, subject, email)
      VALUES ('Short Domain', 'Math', 'a@b.co')
      RETURNING id, email;
    `);
    expect(shortDomainRes.rows[0].email).toBe('a@b.co');

    await expect(db.query(`
      INSERT INTO public.teachers (full_name, subject, email)
      VALUES ('Bad Email', 'Math', 'internal space@edutrack.edu');
    `)).rejects.toThrow(/Invalid email address format/i);

    await expect(db.query(`
      INSERT INTO public.teachers (full_name, subject, email)
      VALUES ('Bad Email', 'Math', 'multiple@@edutrack.edu');
    `)).rejects.toThrow(/Invalid email address format/i);

    await expect(db.query(`
      INSERT INTO public.teachers (full_name, subject, email)
      VALUES ('Bad Email', 'Math', 'missing_suffix@edutrack.');
    `)).rejects.toThrow(/Invalid email address format/i);

    // 4. Empty phone is sanitized to NULL
    const emptyPhoneRes = await db.query(`
      INSERT INTO public.teachers (full_name, subject, email, phone)
      VALUES ('Empty Phone Teacher', 'History', 'empty.phone@edutrack.edu', '   ')
      RETURNING id, phone;
    `);
    expect(emptyPhoneRes.rows[0].phone).toBeNull();

    // 5. Enforces case-insensitive email uniqueness (functional unique index)
    await expect(db.query(`
      INSERT INTO public.teachers (full_name, subject, email)
      VALUES ('Another Teacher', 'Physics', 'tamer.samir@edutrack.edu');
    `)).rejects.toThrow();

    await expect(db.query(`
      INSERT INTO public.teachers (full_name, subject, email)
      VALUES ('Another Teacher', 'Physics', '  TAMER.SAMIR@EDUTRACK.EDU  ');
    `)).rejects.toThrow();

    // 6. Validation trigger rejects missing or invalid fields
    await expect(db.query(`
      INSERT INTO public.teachers (full_name, subject, email)
      VALUES ('', 'Physics', 'valid@edutrack.edu');
    `)).rejects.toThrow('Teacher full name is required');

    await expect(db.query(`
      INSERT INTO public.teachers (full_name, subject, email)
      VALUES ('Valid Name', '', 'valid@edutrack.edu');
    `)).rejects.toThrow('Teacher subject is required');

    // --- C. Non-Admin / Anonymous Blocked From Creating Teachers ---
    await setRole('authenticated', parentUserId);
    await expect(db.query(`
      INSERT INTO public.teachers (full_name, subject, email)
      VALUES ('Unauthorized Teacher', 'History', 'unauth@edutrack.edu');
    `)).rejects.toThrow();

    await setRole('anon');
    await expect(db.query(`
      INSERT INTO public.teachers (full_name, subject, email)
      VALUES ('Anon Teacher', 'History', 'anon@edutrack.edu');
    `)).rejects.toThrow(/permission denied/i);

    // --- D. Group Assignment & Column Permission Enforcement by Admin ---
    await setRole('authenticated', adminUserId);

    const targetGroupId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const targetTeacherId = newTeacher.id;

    // 1. Column privilege test: attempting to update forbidden column (e.g. name or capacity) fails
    await expect(db.query(`
      UPDATE public.groups SET name = 'Unauthorized Rename' WHERE id = '${targetGroupId}';
    `)).rejects.toThrow(/permission denied for (column "name"|table groups)/i);

    await expect(db.query(`
      UPDATE public.groups SET capacity = 999 WHERE id = '${targetGroupId}';
    `)).rejects.toThrow(/permission denied for (column "capacity"|table groups)/i);

    // 2. Capture complete historical rows BEFORE any assignment
    const beforeStudents = (await db.query(`SELECT * FROM public.students ORDER BY id;`)).rows;
    const beforeAttendance = (await db.query(`SELECT * FROM public.attendance ORDER BY id;`)).rows;
    const beforeGrades = (await db.query(`SELECT * FROM public.grades ORDER BY id;`)).rows;
    const beforeNotes = (await db.query(`SELECT * FROM public.teacher_notes ORDER BY id;`)).rows;

    expect(beforeStudents.length).toBeGreaterThan(0);
    expect(beforeAttendance.length).toBeGreaterThan(0);
    expect(beforeGrades.length).toBeGreaterThan(0);
    expect(beforeNotes.length).toBeGreaterThan(0);

    // 3. Action 1: Assign teacher to group
    const assignRes = await db.query(`
      UPDATE public.groups
      SET teacher_id = '${targetTeacherId}'
      WHERE id = '${targetGroupId}'
      RETURNING id, name, teacher_id;
    `);
    expect(assignRes.rows.length).toBe(1);
    expect(assignRes.rows[0].teacher_id).toBe(targetTeacherId);

    // Row-by-row deep equality check after assignment
    const afterAssignStudents = (await db.query(`SELECT * FROM public.students ORDER BY id;`)).rows;
    const afterAssignAttendance = (await db.query(`SELECT * FROM public.attendance ORDER BY id;`)).rows;
    const afterAssignGrades = (await db.query(`SELECT * FROM public.grades ORDER BY id;`)).rows;
    const afterAssignNotes = (await db.query(`SELECT * FROM public.teacher_notes ORDER BY id;`)).rows;
    expect(afterAssignStudents).toEqual(beforeStudents);
    expect(afterAssignAttendance).toEqual(beforeAttendance);
    expect(afterAssignGrades).toEqual(beforeGrades);
    expect(afterAssignNotes).toEqual(beforeNotes);

    // 4. Action 2: Change assigned teacher to seedTeacherId
    const seedTeacherId = '11111111-1111-4111-8111-111111111111';
    const changeRes = await db.query(`
      UPDATE public.groups
      SET teacher_id = '${seedTeacherId}'
      WHERE id = '${targetGroupId}'
      RETURNING id, teacher_id;
    `);
    expect(changeRes.rows[0].teacher_id).toBe(seedTeacherId);

    // Row-by-row deep equality check after reassignment
    const afterChangeStudents = (await db.query(`SELECT * FROM public.students ORDER BY id;`)).rows;
    const afterChangeAttendance = (await db.query(`SELECT * FROM public.attendance ORDER BY id;`)).rows;
    const afterChangeGrades = (await db.query(`SELECT * FROM public.grades ORDER BY id;`)).rows;
    const afterChangeNotes = (await db.query(`SELECT * FROM public.teacher_notes ORDER BY id;`)).rows;
    expect(afterChangeStudents).toEqual(beforeStudents);
    expect(afterChangeAttendance).toEqual(beforeAttendance);
    expect(afterChangeGrades).toEqual(beforeGrades);
    expect(afterChangeNotes).toEqual(beforeNotes);

    // 5. Action 3: Unassign teacher (set teacher_id to NULL)
    const unassignRes = await db.query(`
      UPDATE public.groups
      SET teacher_id = NULL
      WHERE id = '${targetGroupId}'
      RETURNING id, teacher_id;
    `);
    expect(unassignRes.rows[0].teacher_id).toBeNull();

    // Row-by-row deep equality check after unassignment
    const afterUnassignStudents = (await db.query(`SELECT * FROM public.students ORDER BY id;`)).rows;
    const afterUnassignAttendance = (await db.query(`SELECT * FROM public.attendance ORDER BY id;`)).rows;
    const afterUnassignGrades = (await db.query(`SELECT * FROM public.grades ORDER BY id;`)).rows;
    const afterUnassignNotes = (await db.query(`SELECT * FROM public.teacher_notes ORDER BY id;`)).rows;
    expect(afterUnassignStudents).toEqual(beforeStudents);
    expect(afterUnassignAttendance).toEqual(beforeAttendance);
    expect(afterUnassignGrades).toEqual(beforeGrades);
    expect(afterUnassignNotes).toEqual(beforeNotes);

    // 6. Reject invalid foreign key UUID
    const fakeTeacherId = '00000000-0000-4000-8000-000000000000';
    await expect(db.query(`
      UPDATE public.groups
      SET teacher_id = '${fakeTeacherId}'
      WHERE id = '${targetGroupId}';
    `)).rejects.toThrow();

    // --- E. Non-Admin Blocked From Updating Group Teacher ---
    await setRole('authenticated', parentUserId);
    const nonAdminUpdateRes = await db.query(`
      UPDATE public.groups SET teacher_id = NULL WHERE id = '${targetGroupId}' RETURNING id;
    `);
    expect(nonAdminUpdateRes.rows.length).toBe(0); // RLS prevents non-admin from updating rows

    await setRole('anon');
    await expect(db.query(`
      UPDATE public.groups SET teacher_id = NULL WHERE id = '${targetGroupId}';
    `)).rejects.toThrow(/permission denied/i);
  });

  it('12. Migration 20261121000001 rejects pre-existing duplicate teacher emails without mutating data', async () => {
    const db = await createTestDatabase();

    // Apply baseline schema without the unique email index
    await db.exec(schemaSql);
    await db.exec(upgradeSql);
    await db.exec(correctiveSql);

    // Insert two teacher records with case-differing emails directly
    await db.exec(`
      INSERT INTO public.teachers (id, full_name, subject, email)
      VALUES
        ('22222222-1111-4111-8111-111111111111', 'Teacher Lower', 'Math', 'duplicate@test.local'),
        ('33333333-1111-4111-8111-111111111111', 'Teacher Upper', 'Math', 'DUPLICATE@TEST.LOCAL');
    `);

    // Verify both records exist prior to check
    const countBefore = await db.query(`SELECT count(*) as count FROM public.teachers WHERE lower(email) = 'duplicate@test.local';`);
    expect(Number(countBefore.rows[0].count)).toBe(2);

    // Attempting to apply teacherCorrectionsSql MUST fail on the pre-execution conflict check
    await expect(db.exec(teacherCorrectionsSql)).rejects.toThrow(/duplicate teacher email cluster\(s\) detected/i);

    // Verify neither record was deleted or merged automatically
    const countAfter = await db.query(`SELECT count(*) as count FROM public.teachers WHERE lower(email) = 'duplicate@test.local';`);
    expect(Number(countAfter.rows[0].count)).toBe(2);
  });

  it('13. Stage B.1: Secure Account Linking, RLS, Integrity Triggers, Role Freeze & Administrative RPCs', async () => {
    const db = await createTestDatabase();

    // Apply entire migration stack in chronological sequence
    for (const migration of [
      schemaSql,
      upgradeSql,
      correctiveSql,
      milestone2Sql,
      milestone3Sql,
      milestone3CorrectiveSql,
      gradesFeedbackSql,
      assessmentLockSql,
      teacherManagementSql,
      teacherCorrectionsSql,
      accountLinkingSql,
      stageB1CorrectiveSql,
    ]) {
      await db.exec(migration);
    }

    const setRole = async (role: 'anon' | 'authenticated', sub?: string) => {
      await db.exec(`
        RESET ROLE;
        SET ROLE ${role};
        SET request.jwt.claim.role = '${role}';
        SET request.jwt.claim.sub = '${sub || ''}';
      `);
    };

    // --- A. Privilege Verification on Hardened Stage B.1 Grants ---
    const authParentLinksSelect = await db.query(`SELECT has_table_privilege('authenticated', 'public.parent_student_links', 'SELECT') as priv;`);
    const authParentLinksInsert = await db.query(`SELECT has_table_privilege('authenticated', 'public.parent_student_links', 'INSERT') as priv;`);
    const authParentLinksUpdate = await db.query(`SELECT has_table_privilege('authenticated', 'public.parent_student_links', 'UPDATE') as priv;`);
    const authParentLinksDelete = await db.query(`SELECT has_table_privilege('authenticated', 'public.parent_student_links', 'DELETE') as priv;`);
    expect(authParentLinksSelect.rows[0].priv).toBe(true);
    expect(authParentLinksInsert.rows[0].priv).toBe(false);
    expect(authParentLinksUpdate.rows[0].priv).toBe(false);
    expect(authParentLinksDelete.rows[0].priv).toBe(false);

    const anonParentLinksSelect = await db.query(`SELECT has_table_privilege('anon', 'public.parent_student_links', 'SELECT') as priv;`);
    expect(anonParentLinksSelect.rows[0].priv).toBe(false);

    // RPC Execute privileges
    const rpcs = [
      'link_teacher_account(uuid,uuid)',
      'unlink_teacher_account(uuid)',
      'link_student_account(uuid,uuid)',
      'unlink_student_account(uuid)',
      'link_parent_student(uuid,uuid)',
      'unlink_parent_student(uuid,uuid)',
    ];

    for (const rpc of rpcs) {
      const authExec = await db.query(`SELECT has_function_privilege('authenticated', 'public.${rpc}', 'EXECUTE') as priv;`);
      const anonExec = await db.query(`SELECT has_function_privilege('anon', 'public.${rpc}', 'EXECUTE') as priv;`);
      expect(authExec.rows[0].priv).toBe(true);
      expect(anonExec.rows[0].priv).toBe(false);
    }

    // --- B. User & Test Data Setup ---
    const adminUserId = '99999999-9999-4999-8999-999999999999';
    const teacherUserId = '11111111-2222-4333-8444-555555555555';
    const studentUserId = '22222222-3333-4444-8555-666666666666';
    const otherStudentUserId = '33333333-4444-4555-8666-777777777777';
    const parentUserId = '44444444-5555-4666-8777-888888888888';
    const parentUserId2 = '55555555-6666-4777-8888-999999999999';
    const attackerUserId = '66666666-7777-4888-8999-000000000000';
    const newAttackerTeacherId = '77777777-8888-4999-8000-111111111111';
    const newAttackerParentId = '77777777-8888-4999-8000-222222222222';
    const newLegitStudentId = '77777777-8888-4999-8000-333333333333';

    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${adminUserId}', 'admin@edutrack.com'),
        ('${teacherUserId}', 'teacher@edutrack.com'),
        ('${studentUserId}', 'student1@edutrack.com'),
        ('${otherStudentUserId}', 'student2@edutrack.com'),
        ('${parentUserId}', 'parent1@edutrack.com'),
        ('${parentUserId2}', 'parent2@edutrack.com'),
        ('${attackerUserId}', 'attacker@edutrack.com'),
        ('${newAttackerTeacherId}', 'fake_teacher@test.local'),
        ('${newAttackerParentId}', 'fake_parent@test.local'),
        ('${newLegitStudentId}', 'legit_student@test.local');

      INSERT INTO public.profiles (id, email, full_name, role) VALUES
        ('${adminUserId}', 'admin@edutrack.com', 'Admin User', 'admin'),
        ('${teacherUserId}', 'teacher@edutrack.com', 'Teacher Profile', 'teacher'),
        ('${studentUserId}', 'student1@edutrack.com', 'Student Profile 1', 'student'),
        ('${otherStudentUserId}', 'student2@edutrack.com', 'Student Profile 2', 'student'),
        ('${parentUserId}', 'parent1@edutrack.com', 'Parent Profile 1', 'parent'),
        ('${parentUserId2}', 'parent2@edutrack.com', 'Parent Profile 2', 'parent'),
        ('${attackerUserId}', 'attacker@edutrack.com', 'Attacker Profile', 'student');
    `);

    // Create a group, two students, and two teachers
    const groupId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const teacherId1 = 'a1111111-1111-4111-8111-111111111111';
    const teacherId2 = 'a2222222-2222-4222-8222-222222222222';
    const studentId1 = 'b1111111-1111-4111-8111-111111111111';
    const studentId2 = 'b2222222-2222-4222-8222-222222222222';

    await setRole('authenticated', adminUserId);
    await db.exec(`
      INSERT INTO public.groups (id, name, grade_level, capacity)
      VALUES ('${groupId}', 'Grade 10A', 'Grade 10', 30);

      INSERT INTO public.teachers (id, full_name, subject, email) VALUES
        ('${teacherId1}', 'Teacher One', 'Math', 'teacher1@school.edu'),
        ('${teacherId2}', 'Teacher Two', 'Science', 'teacher2@school.edu');

      INSERT INTO public.students (id, full_name, student_code, group_id, grade_level, qr_code_hash) VALUES
        ('${studentId1}', 'Student One', 'ET-1001', '${groupId}', 'Grade 10', 'qr_hash_1001'),
        ('${studentId2}', 'Student Two', 'ET-1002', '${groupId}', 'Grade 10', 'qr_hash_1002');
    `);

    // --- C. Teacher Account Linking & Unlinking Workflows ---
    // 1. Non-admin execution fails
    await setRole('authenticated', attackerUserId);
    await expect(db.query(`
      SELECT public.link_teacher_account('${teacherId1}', '${teacherUserId}');
    `)).rejects.toThrow(/unauthorized/i);

    // 2. Admin successfully links teacher
    await setRole('authenticated', adminUserId);
    const linkTeacherRes = await db.query(`
      SELECT public.link_teacher_account('${teacherId1}', '${teacherUserId}') as res;
    `);
    const parsedTeacherRes = typeof linkTeacherRes.rows[0].res === 'string'
      ? JSON.parse(linkTeacherRes.rows[0].res)
      : linkTeacherRes.rows[0].res;
    expect(parsedTeacherRes.success).toBe(true);
    expect(parsedTeacherRes.teacher_id).toBe(teacherId1);
    expect(parsedTeacherRes.user_id).toBe(teacherUserId);

    // Verify teacher record has user_id set
    const teacherCheck = await db.query(`SELECT user_id FROM public.teachers WHERE id = '${teacherId1}';`);
    expect(teacherCheck.rows[0].user_id).toBe(teacherUserId);

    // 3. Re-linking already linked teacher fails (rejects silent overwrite)
    await expect(db.query(`
      SELECT public.link_teacher_account('${teacherId1}', '${teacherUserId}');
    `)).rejects.toThrow(/already linked/i);

    // 4. Linking another teacher to the same teacher user account fails (prevented by unique index)
    await expect(db.query(`
      SELECT public.link_teacher_account('${teacherId2}', '${teacherUserId}');
    `)).rejects.toThrow(/already linked/i);

    // 5. Role mismatch: linking student profile to teacher record fails
    await expect(db.query(`
      SELECT public.link_teacher_account('${teacherId2}', '${studentUserId}');
    `)).rejects.toThrow(/must have role teacher/i);

    // 6. Role Freeze: attempting to change teacher's profile role while actively linked fails
    await expect(db.query(`
      UPDATE public.profiles SET role = 'student' WHERE id = '${teacherUserId}';
    `)).rejects.toThrow(/currently linked to an active teacher record/i);

    // 7. Unlink teacher
    const unlinkTeacherRes = await db.query(`
      SELECT public.unlink_teacher_account('${teacherId1}') as res;
    `);
    const parsedUnlinkRes = typeof unlinkTeacherRes.rows[0].res === 'string'
      ? JSON.parse(unlinkTeacherRes.rows[0].res)
      : unlinkTeacherRes.rows[0].res;
    expect(parsedUnlinkRes.success).toBe(true);

    const teacherUnlinkedCheck = await db.query(`SELECT user_id FROM public.teachers WHERE id = '${teacherId1}';`);
    expect(teacherUnlinkedCheck.rows[0].user_id).toBeNull();

    // 8. Re-link teacher for subsequent tests
    await db.query(`SELECT public.link_teacher_account('${teacherId1}', '${teacherUserId}');`);

    // --- D. Student Account Linking & Unlinking Workflows ---
    // 1. Admin successfully links student
    const linkStudentRes = await db.query(`
      SELECT public.link_student_account('${studentId1}', '${studentUserId}') as res;
    `);
    const parsedStudentRes = typeof linkStudentRes.rows[0].res === 'string'
      ? JSON.parse(linkStudentRes.rows[0].res)
      : linkStudentRes.rows[0].res;
    expect(parsedStudentRes.success).toBe(true);

    const studentCheck = await db.query(`SELECT user_id FROM public.students WHERE id = '${studentId1}';`);
    expect(studentCheck.rows[0].user_id).toBe(studentUserId);

    // 2. Re-linking already linked student fails
    await expect(db.query(`
      SELECT public.link_student_account('${studentId1}', '${otherStudentUserId}');
    `)).rejects.toThrow(/already linked/i);

    // 3. Linking another student to the same user fails
    await expect(db.query(`
      SELECT public.link_student_account('${studentId2}', '${studentUserId}');
    `)).rejects.toThrow(/already linked/i);

    // 4. Role mismatch check: linking parent to student record fails
    await expect(db.query(`
      SELECT public.link_student_account('${studentId2}', '${parentUserId}');
    `)).rejects.toThrow(/must have role student/i);

    // 5. Role Freeze: attempting to change student's profile role while actively linked fails
    await expect(db.query(`
      UPDATE public.profiles SET role = 'teacher' WHERE id = '${studentUserId}';
    `)).rejects.toThrow(/currently linked to an active student record/i);

    // 6. Direct table UPDATE to user_id on students is blocked for authenticated non-admin
    await setRole('authenticated', attackerUserId);
    await expect(db.query(`
      UPDATE public.students SET user_id = '${attackerUserId}' WHERE id = '${studentId2}';
    `)).rejects.toThrow(/permission denied/i);

    // 7. Unlink student
    await setRole('authenticated', adminUserId);
    const unlinkStudentRes = await db.query(`
      SELECT public.unlink_student_account('${studentId1}') as res;
    `);
    const parsedUnlinkStudent = typeof unlinkStudentRes.rows[0].res === 'string'
      ? JSON.parse(unlinkStudentRes.rows[0].res)
      : unlinkStudentRes.rows[0].res;
    expect(parsedUnlinkStudent.success).toBe(true);

    // Re-link student1 to studentUserId for link integrity
    await db.query(`SELECT public.link_student_account('${studentId1}', '${studentUserId}');`);

    // --- E. Parent-Student Links Workflows & RLS ---
    // 1. Admin links parentUserId to studentId1
    const linkParentRes = await db.query(`
      SELECT public.link_parent_student('${parentUserId}', '${studentId1}') as res;
    `);
    const parsedParentRes = typeof linkParentRes.rows[0].res === 'string'
      ? JSON.parse(linkParentRes.rows[0].res)
      : linkParentRes.rows[0].res;
    expect(parsedParentRes.success).toBe(true);
    expect(parsedParentRes.parent_id).toBe(parentUserId);
    expect(parsedParentRes.student_id).toBe(studentId1);

    // 2. Duplicate linking rejected
    await expect(db.query(`
      SELECT public.link_parent_student('${parentUserId}', '${studentId1}');
    `)).rejects.toThrow(/already exists/i);

    // 3. Role mismatch: profile must have role parent
    await expect(db.query(`
      SELECT public.link_parent_student('${teacherUserId}', '${studentId2}');
    `)).rejects.toThrow(/must have role parent/i);

    // 4. One parent can link to multiple students (1:N)
    const linkSecondStudent = await db.query(`
      SELECT public.link_parent_student('${parentUserId}', '${studentId2}') as res;
    `);
    const parsedSecondStudent = typeof linkSecondStudent.rows[0].res === 'string'
      ? JSON.parse(linkSecondStudent.rows[0].res)
      : linkSecondStudent.rows[0].res;
    expect(parsedSecondStudent.success).toBe(true);

    // 5. One student can link to multiple parents (N:1)
    const linkSecondParent = await db.query(`
      SELECT public.link_parent_student('${parentUserId2}', '${studentId1}') as res;
    `);
    const parsedSecondParent = typeof linkSecondParent.rows[0].res === 'string'
      ? JSON.parse(linkSecondParent.rows[0].res)
      : linkSecondParent.rows[0].res;
    expect(parsedSecondParent.success).toBe(true);

    // 6. Role freeze: parent profile role cannot be modified while linked
    await expect(db.query(`
      UPDATE public.profiles SET role = 'student' WHERE id = '${parentUserId}';
    `)).rejects.toThrow(/currently linked to active parent-student links/i);

    // 7. Direct mutation by authenticated non-admin rejected by table permissions
    await setRole('authenticated', attackerUserId);
    await expect(db.query(`
      INSERT INTO public.parent_student_links (parent_id, student_id)
      VALUES ('${parentUserId}', '${studentId1}');
    `)).rejects.toThrow(/permission denied/i);

    // 8. RLS Read enforcement: Parent 1 only sees their own linked students
    await setRole('authenticated', parentUserId);
    const parentLinks = await db.query(`SELECT parent_id, student_id FROM public.parent_student_links;`);
    expect(parentLinks.rows.length).toBe(2);
    for (const row of parentLinks.rows) {
      expect(row.parent_id).toBe(parentUserId);
    }

    // Parent 2 only sees their own single link
    await setRole('authenticated', parentUserId2);
    const parent2Links = await db.query(`SELECT parent_id, student_id FROM public.parent_student_links;`);
    expect(parent2Links.rows.length).toBe(1);
    expect(parent2Links.rows[0].parent_id).toBe(parentUserId2);
    expect(parent2Links.rows[0].student_id).toBe(studentId1);

    // 9. Admin unlinks parent-student
    await setRole('authenticated', adminUserId);
    const unlinkParentRes = await db.query(`
      SELECT public.unlink_parent_student('${parentUserId}', '${studentId1}') as res;
    `);
    const parsedUnlinkParent = typeof unlinkParentRes.rows[0].res === 'string'
      ? JSON.parse(unlinkParentRes.rows[0].res)
      : unlinkParentRes.rows[0].res;
    expect(parsedUnlinkParent.success).toBe(true);

    // --- F. Anti-Self-Promotion Trigger Hardening ---
    // Attacker cannot insert a profile with role = 'teacher'
    await setRole('authenticated', newAttackerTeacherId);
    await expect(db.query(`
      INSERT INTO public.profiles (id, email, full_name, role)
      VALUES ('${newAttackerTeacherId}', 'fake_teacher@test.local', 'Fake Teacher', 'teacher');
    `)).rejects.toThrow(/unauthorized.*elevated user roles/i);

    // Attacker cannot insert a profile with role = 'parent'
    await setRole('authenticated', newAttackerParentId);
    await expect(db.query(`
      INSERT INTO public.profiles (id, email, full_name, role)
      VALUES ('${newAttackerParentId}', 'fake_parent@test.local', 'Fake Parent', 'parent');
    `)).rejects.toThrow(/unauthorized.*elevated user roles/i);

    // Attacker can insert their own profile with default role = 'student'
    await setRole('authenticated', newLegitStudentId);
    await db.query(`
      INSERT INTO public.profiles (id, email, full_name, role)
      VALUES ('${newLegitStudentId}', 'legit_student@test.local', 'Legit Student', 'student');
    `);
    const checkLegit = await db.query(`SELECT role FROM public.profiles WHERE id = '${newLegitStudentId}';`);
    expect(checkLegit.rows[0].role).toBe('student');
  }, 30000);

  it('14. Migration 20261121000002 pre-execution conflict checks reject duplicate user_ids and invalid roles', async () => {
    // Case A: Reject duplicate user_id in teachers
    const dbA = await createTestDatabase();
    for (const sql of [
      schemaSql, upgradeSql, correctiveSql, milestone2Sql, milestone3Sql,
      milestone3CorrectiveSql, gradesFeedbackSql, assessmentLockSql,
      teacherManagementSql, teacherCorrectionsSql
    ]) {
      await dbA.exec(sql);
    }

    const testUserId = '11111111-2222-4333-8444-555555555555';
    await dbA.exec(`
      INSERT INTO auth.users (id, email) VALUES ('${testUserId}', 'teacher_dup@test.local');
      INSERT INTO public.profiles (id, email, full_name, role) VALUES ('${testUserId}', 'teacher_dup@test.local', 'Teacher Dup', 'teacher');
      INSERT INTO public.teachers (id, full_name, subject, email) VALUES
        ('a1111111-1111-4111-8111-111111111111', 'Teacher 1', 'Math', 't1@dup.local'),
        ('a2222222-2222-4222-8222-222222222222', 'Teacher 2', 'Science', 't2@dup.local');
      UPDATE public.teachers SET user_id = '${testUserId}';
    `);

    // Applying migration 20261121000002 must abort with error
    await expect(dbA.exec(accountLinkingSql)).rejects.toThrow(/duplicate teacher user_id link\(s\) detected/i);

    // Verify neither teacher record was altered or removed
    const checkA = await dbA.query(`SELECT count(*) as count FROM public.teachers WHERE user_id = '${testUserId}';`);
    expect(Number(checkA.rows[0].count)).toBe(2);

    // Case B: Reject teacher linked to non-teacher role (e.g. role = student)
    const dbB = await createTestDatabase();
    for (const sql of [
      schemaSql, upgradeSql, correctiveSql, milestone2Sql, milestone3Sql,
      milestone3CorrectiveSql, gradesFeedbackSql, assessmentLockSql,
      teacherManagementSql, teacherCorrectionsSql
    ]) {
      await dbB.exec(sql);
    }

    const studentUserId = '22222222-3333-4444-8555-666666666666';
    await dbB.exec(`
      INSERT INTO auth.users (id, email) VALUES ('${studentUserId}', 'student_role@test.local');
      INSERT INTO public.profiles (id, email, full_name, role) VALUES ('${studentUserId}', 'student_role@test.local', 'Student Profile', 'student');
      INSERT INTO public.teachers (id, full_name, subject, email) VALUES
        ('a3333333-3333-4333-8333-333333333333', 'Teacher Mismatch', 'History', 'tmismatch@test.local');
      UPDATE public.teachers SET user_id = '${studentUserId}';
    `);

    await expect(dbB.exec(accountLinkingSql)).rejects.toThrow(/profile\(s\) without role teacher/i);

    // Case C: Reject duplicate user_id in students
    const dbC = await createTestDatabase();
    for (const sql of [
      schemaSql, upgradeSql, correctiveSql, milestone2Sql, milestone3Sql,
      milestone3CorrectiveSql, gradesFeedbackSql, assessmentLockSql,
      teacherManagementSql, teacherCorrectionsSql
    ]) {
      await dbC.exec(sql);
    }

    const dupStudentUser = '33333333-4444-4555-8666-777777777777';
    await dbC.exec(`
      INSERT INTO auth.users (id, email) VALUES ('${dupStudentUser}', 'student_dup@test.local');
      INSERT INTO public.profiles (id, email, full_name, role) VALUES ('${dupStudentUser}', 'student_dup@test.local', 'Student Dup', 'student');
      INSERT INTO public.groups (id, name, grade_level) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Grade 8', 'Grade 8');
      INSERT INTO public.students (id, full_name, student_code, group_id, grade_level, qr_code_hash, user_id) VALUES
        ('b1111111-1111-4111-8111-111111111111', 'Student Dup 1', 'ET-D1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Grade 8', 'qr_d1', '${dupStudentUser}'),
        ('b2222222-2222-4222-8222-222222222222', 'Student Dup 2', 'ET-D2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Grade 8', 'qr_d2', '${dupStudentUser}');
    `);

    await expect(dbC.exec(accountLinkingSql)).rejects.toThrow(/duplicate student user_id link\(s\) detected/i);

    // Case D: Reject student linked to non-student role
    const dbD = await createTestDatabase();
    for (const sql of [
      schemaSql, upgradeSql, correctiveSql, milestone2Sql, milestone3Sql,
      milestone3CorrectiveSql, gradesFeedbackSql, assessmentLockSql,
      teacherManagementSql, teacherCorrectionsSql
    ]) {
      await dbD.exec(sql);
    }

    const teacherAsStudentUser = '44444444-5555-4666-8777-888888888888';
    await dbD.exec(`
      INSERT INTO auth.users (id, email) VALUES ('${teacherAsStudentUser}', 'teacher_as_student@test.local');
      INSERT INTO public.profiles (id, email, full_name, role) VALUES ('${teacherAsStudentUser}', 'teacher_as_student@test.local', 'Teacher Profile', 'teacher');
      INSERT INTO public.groups (id, name, grade_level) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Grade 8', 'Grade 8');
      INSERT INTO public.students (id, full_name, student_code, group_id, grade_level, qr_code_hash, user_id) VALUES
        ('b3333333-3333-4333-8333-333333333333', 'Student Mismatch', 'ET-D3', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Grade 8', 'qr_d3', '${teacherAsStudentUser}');
    `);

    await expect(dbD.exec(accountLinkingSql)).rejects.toThrow(/profile\(s\) without role student/i);
  }, 30000);

  it('15. Stage B.1 Corrective Hardening: student user_id lockdown, atomic linking/unlinking, role-link coordination & privilege bounds', async () => {
    /**
     * Concurrency Testing Boundary Note:
     * This suite runs on @electric-sql/pglite (single-session in-process WASM PostgreSQL),
     * which serializes queries rather than executing two independent backend sessions holding
     * simultaneous uncommitted locks. True two-session lock interleaving was NOT exercised here
     * (no native PostgreSQL/Docker service is installed in this environment). The database
     * guarantees relied upon for multi-session PostgreSQL are:
     *   1) Atomic conditional UPDATE ... WHERE id = ... AND user_id IS NULL RETURNING ...
     *   2) Row-level FOR UPDATE serialization in unlink RPCs verifying previous_user_id
     *   3) Row-level FOR SHARE on public.profiles + AFTER UPDATE trigger tr_enforce_profile_role_link_consistency
     */
    const db = await createTestDatabase();
    try {
      for (const migration of [
        schemaSql,
        upgradeSql,
        correctiveSql,
        milestone2Sql,
        milestone3Sql,
        milestone3CorrectiveSql,
        gradesFeedbackSql,
        assessmentLockSql,
        teacherManagementSql,
        teacherCorrectionsSql,
        accountLinkingSql,
        stageB1CorrectiveSql,
      ]) {
        await db.exec(migration);
      }

      const setRole = async (role: 'postgres' | 'anon' | 'authenticated', sub?: string) => {
        if (role === 'postgres') {
          await db.exec(`RESET ROLE; RESET request.jwt.claim.role; RESET request.jwt.claim.sub;`);
          return;
        }
        await db.exec(`
          RESET ROLE;
          SET ROLE ${role};
          SET request.jwt.claim.role = '${role}';
          SET request.jwt.claim.sub = '${sub || ''}';
        `);
      };

      // --- 1. Production Privilege Verification for students.user_id lockdown ---
      expect((await db.query(`SELECT has_table_privilege('authenticated', 'public.students', 'INSERT') AS allowed;`)).rows[0].allowed).toBe(false);
      expect((await db.query(`SELECT has_column_privilege('authenticated', 'public.students', 'user_id', 'INSERT') AS allowed;`)).rows[0].allowed).toBe(false);
      expect((await db.query(`SELECT has_column_privilege('authenticated', 'public.students', 'full_name', 'INSERT') AS allowed;`)).rows[0].allowed).toBe(true);
      expect((await db.query(`SELECT has_column_privilege('authenticated', 'public.students', 'student_code', 'INSERT') AS allowed;`)).rows[0].allowed).toBe(true);

      // Verify AFTER UPDATE trigger tr_enforce_profile_role_link_consistency is active on public.profiles
      const triggerCheck = await db.query(`
        SELECT tgname, tgtype
        FROM pg_trigger
        WHERE tgrelid = 'public.profiles'::regclass
          AND tgname = 'tr_enforce_profile_role_link_consistency';
      `);
      expect(triggerCheck.rows.length).toBe(1);
      // In PostgreSQL pg_trigger.tgtype: bit 1 (value 2) = BEFORE (so bit 1 = 0 means AFTER), bit 4 (value 16) = UPDATE
      expect(Number(triggerCheck.rows[0].tgtype) & 2).toBe(0);
      expect(Number(triggerCheck.rows[0].tgtype) & 16).toBe(16);

      // --- Seed test identities & groups ---
      const adminId = '99999999-9999-4999-8999-999999999999';
      const teacherUserA = '11111111-0000-4000-8000-000000000001';
      const teacherUserB = '11111111-0000-4000-8000-000000000002';
      const teacherUserPromote = '11111111-0000-4000-8000-000000000003';
      const studentUserA = '22222222-0000-4000-8000-000000000001';
      const studentUserB = '22222222-0000-4000-8000-000000000002';
      const studentUserPromote = '22222222-0000-4000-8000-000000000003';
      const parentUserA = '33333333-0000-4000-8000-000000000001';
      const parentUserPromote = '33333333-0000-4000-8000-000000000002';

      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES
          ('${adminId}', 'admin_b1c@test.local'),
          ('${teacherUserA}', 'ta@test.local'),
          ('${teacherUserB}', 'tb@test.local'),
          ('${teacherUserPromote}', 'tp@test.local'),
          ('${studentUserA}', 'sa@test.local'),
          ('${studentUserB}', 'sb@test.local'),
          ('${studentUserPromote}', 'sp@test.local'),
          ('${parentUserA}', 'pa@test.local'),
          ('${parentUserPromote}', 'pp@test.local');

        INSERT INTO public.profiles (id, email, full_name, role) VALUES
          ('${adminId}', 'admin_b1c@test.local', 'Admin', 'admin'),
          ('${teacherUserA}', 'ta@test.local', 'Teacher A', 'teacher'),
          ('${teacherUserB}', 'tb@test.local', 'Teacher B', 'teacher'),
          ('${teacherUserPromote}', 'tp@test.local', 'Teacher Promote', 'teacher'),
          ('${studentUserA}', 'sa@test.local', 'Student A', 'student'),
          ('${studentUserB}', 'sb@test.local', 'Student B', 'student'),
          ('${studentUserPromote}', 'sp@test.local', 'Student Promote', 'student'),
          ('${parentUserA}', 'pa@test.local', 'Parent A', 'parent'),
          ('${parentUserPromote}', 'pp@test.local', 'Parent Promote', 'parent');
      `);

      const groupId = 'aaaaaaaa-0000-4000-8000-000000000001';
      const teacherId = 'bbbbbbbb-0000-4000-8000-000000000001';
      const otherTeacherId = 'bbbbbbbb-0000-4000-8000-000000000002';

      await setRole('authenticated', adminId);
      await db.exec(`
        INSERT INTO public.groups (id, name, grade_level, capacity)
        VALUES ('${groupId}', 'Grade 11A', 'Grade 11', 30);

        INSERT INTO public.teachers (id, full_name, subject, email) VALUES
          ('${teacherId}', 'Mr. Ahmed', 'Physics', 'ahmed.b1c@test.local'),
          ('${otherTeacherId}', 'Ms. Mona', 'Chemistry', 'mona.b1c@test.local');
      `);

      // --- 2. Student Creation Without user_id vs Direct user_id Injection ---
      // A. Direct user_id insertion as authenticated admin is blocked by column-level privilege (both non-null and null)
      await expect(db.query(`
        INSERT INTO public.students (full_name, student_code, group_id, grade_level, qr_code_hash, user_id)
        VALUES ('Injected Student', 'ET-INJ-1', '${groupId}', 'Grade 11', 'QR-INJ-1', '${studentUserA}');
      `)).rejects.toThrow(/permission denied/i);

      await expect(db.query(`
        INSERT INTO public.students (full_name, student_code, group_id, grade_level, qr_code_hash, user_id)
        VALUES ('Injected Null Student', 'ET-INJ-2', '${groupId}', 'Grade 11', 'QR-INJ-2', NULL);
      `)).rejects.toThrow(/permission denied/i);

      // B. Even as postgres superuser bypassing column privileges, trigger rejects non-null user_id on INSERT
      await setRole('postgres');
      await expect(db.query(`
        INSERT INTO public.students (full_name, student_code, group_id, grade_level, qr_code_hash, user_id)
        VALUES ('Superuser Direct Student', 'ET-INJ-3', '${groupId}', 'Grade 11', 'QR-INJ-3', '${studentUserA}');
      `)).rejects.toThrow(/direct user_id assignment is prohibited during student creation/i);

      // C. Normal unlinked student creation as authenticated admin (using actual migration grants) succeeds
      await setRole('authenticated', adminId);
      const createdStudentRes = await db.query(`
        INSERT INTO public.students (full_name, student_code, group_id, grade_level, qr_code_hash, status)
        VALUES ('Legit New Student', 'ET-NEW-1', '${groupId}', 'Grade 11', 'QR-NEW-1', 'active')
        RETURNING id, user_id;
      `);
      expect(createdStudentRes.rows.length).toBe(1);
      const createdStudentId = createdStudentRes.rows[0].id as string;
      expect(createdStudentRes.rows[0].user_id).toBeNull();

      // Verify enrolled_count trigger still worked under production grants
      const groupCountRes = await db.query(`SELECT enrolled_count FROM public.groups WHERE id = '${groupId}';`);
      expect(Number(groupCountRes.rows[0].enrolled_count)).toBe(1);

      // --- 3. Atomic Teacher & Student Link/Unlink & Previous User Accuracy ---
      const parseRpc = (row: Record<string, unknown>) =>
        typeof row.res === 'string' ? JSON.parse(row.res) : row.res;

      // A. Competing teacher link calls for the same unlinked teacher (Promise.all in PGlite)
      const teacherRaceResults = await Promise.allSettled([
        db.query(`SELECT public.link_teacher_account('${teacherId}', '${teacherUserA}') AS res;`),
        db.query(`SELECT public.link_teacher_account('${teacherId}', '${teacherUserB}') AS res;`),
      ]);
      const fulfilledTeacher = teacherRaceResults.filter(
        (r): r is PromiseFulfilledResult<{ rows: Array<Record<string, unknown>> }> => r.status === 'fulfilled'
      );
      const rejectedTeacher = teacherRaceResults.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(fulfilledTeacher.length).toBe(1);
      expect(rejectedTeacher.length).toBe(1);
      expect(String(rejectedTeacher[0].reason)).toMatch(/conflict.*already linked/i);

      const wonTeacherUserId = parseRpc(fulfilledTeacher[0].value.rows[0]).user_id;
      const persistedTeacher = await db.query(`SELECT user_id FROM public.teachers WHERE id = '${teacherId}';`);
      expect(persistedTeacher.rows[0].user_id).toBe(wonTeacherUserId);

      // Second teacher linking the same winning user account returns Conflict
      await expect(db.query(`
        SELECT public.link_teacher_account('${otherTeacherId}', '${wonTeacherUserId}');
      `)).rejects.toThrow(/already linked/i);

      // Unlinking returns exact previous_user_id; repeated unlink returns previous_user_id: null
      const unlinkTeacher1 = parseRpc((await db.query(`SELECT public.unlink_teacher_account('${teacherId}') AS res;`)).rows[0]);
      expect(unlinkTeacher1.success).toBe(true);
      expect(unlinkTeacher1.previous_user_id).toBe(wonTeacherUserId);

      const unlinkTeacher2 = parseRpc((await db.query(`SELECT public.unlink_teacher_account('${teacherId}') AS res;`)).rows[0]);
      expect(unlinkTeacher2.success).toBe(true);
      expect(unlinkTeacher2.previous_user_id).toBeNull();

      // Re-link teacher with teacherUserB and verify unlink returns teacherUserB
      await db.query(`SELECT public.link_teacher_account('${teacherId}', '${teacherUserB}') AS res;`);
      const unlinkTeacher3 = parseRpc((await db.query(`SELECT public.unlink_teacher_account('${teacherId}') AS res;`)).rows[0]);
      expect(unlinkTeacher3.previous_user_id).toBe(teacherUserB);

      // B. Competing student link calls for the newly created student
      const studentRaceResults = await Promise.allSettled([
        db.query(`SELECT public.link_student_account('${createdStudentId}', '${studentUserA}') AS res;`),
        db.query(`SELECT public.link_student_account('${createdStudentId}', '${studentUserB}') AS res;`),
      ]);
      const fulfilledStudent = studentRaceResults.filter(
        (r): r is PromiseFulfilledResult<{ rows: Array<Record<string, unknown>> }> => r.status === 'fulfilled'
      );
      const rejectedStudent = studentRaceResults.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(fulfilledStudent.length).toBe(1);
      expect(rejectedStudent.length).toBe(1);
      expect(String(rejectedStudent[0].reason)).toMatch(/conflict.*already linked/i);

      const wonStudentUserId = parseRpc(fulfilledStudent[0].value.rows[0]).user_id;
      const persistedStudent = await db.query(`SELECT user_id FROM public.students WHERE id = '${createdStudentId}';`);
      expect(persistedStudent.rows[0].user_id).toBe(wonStudentUserId);

      // Unlink student returns wonStudentUserId; repeated unlink returns null
      const unlinkStudent1 = parseRpc((await db.query(`SELECT public.unlink_student_account('${createdStudentId}') AS res;`)).rows[0]);
      expect(unlinkStudent1.previous_user_id).toBe(wonStudentUserId);
      const unlinkStudent2 = parseRpc((await db.query(`SELECT public.unlink_student_account('${createdStudentId}') AS res;`)).rows[0]);
      expect(unlinkStudent2.previous_user_id).toBeNull();

      // --- 4. Role Change, provision_admin & Linking Order Coordination ---
      // Order 1 (Teacher): provision_admin first on unlinked teacherUserPromote -> then link fails
      await setRole('postgres');
      await db.query(`SELECT * FROM public.provision_admin('${teacherUserPromote}');`);
      await setRole('authenticated', adminId);
      await expect(db.query(`
        SELECT public.link_teacher_account('${teacherId}', '${teacherUserPromote}');
      `)).rejects.toThrow(/must have role teacher/i);

      // Order 2 (Teacher): link teacherUserA first -> provision_admin & role update fail -> unlink -> then provision_admin succeeds
      await db.query(`SELECT public.link_teacher_account('${teacherId}', '${teacherUserA}');`);
      await setRole('postgres');
      await expect(db.query(`SELECT * FROM public.provision_admin('${teacherUserA}');`)).rejects.toThrow(/currently linked to an active teacher record/i);
      await setRole('authenticated', adminId);
      await expect(db.query(`UPDATE public.profiles SET role = 'student' WHERE id = '${teacherUserA}';`)).rejects.toThrow(/currently linked to an active teacher record/i);
      await db.query(`SELECT public.unlink_teacher_account('${teacherId}');`);
      await setRole('postgres');
      const promotedTeacher = await db.query(`SELECT * FROM public.provision_admin('${teacherUserA}');`);
      expect(promotedTeacher.rows[0].role).toBe('admin');

      // Order 1 & 2 (Student): provision_admin on unlinked studentUserPromote -> link fails; linked student blocks provision_admin until unlinked
      await db.query(`SELECT * FROM public.provision_admin('${studentUserPromote}');`);
      await setRole('authenticated', adminId);
      await expect(db.query(`
        SELECT public.link_student_account('${createdStudentId}', '${studentUserPromote}');
      `)).rejects.toThrow(/must have role student/i);

      await db.query(`SELECT public.link_student_account('${createdStudentId}', '${studentUserA}');`);
      await setRole('postgres');
      await expect(db.query(`SELECT * FROM public.provision_admin('${studentUserA}');`)).rejects.toThrow(/currently linked to an active student record/i);
      await setRole('authenticated', adminId);
      await db.query(`SELECT public.unlink_student_account('${createdStudentId}');`);
      await setRole('postgres');
      const promotedStudent = await db.query(`SELECT * FROM public.provision_admin('${studentUserA}');`);
      expect(promotedStudent.rows[0].role).toBe('admin');

      // Order 1 & 2 (Parent): provision_admin on unlinked parentUserPromote -> parent link fails; linked parent blocks provision_admin until unlinked
      await db.query(`SELECT * FROM public.provision_admin('${parentUserPromote}');`);
      await setRole('authenticated', adminId);
      await expect(db.query(`
        SELECT public.link_parent_student('${parentUserPromote}', '${createdStudentId}');
      `)).rejects.toThrow(/must have role parent/i);

      await db.query(`SELECT public.link_parent_student('${parentUserA}', '${createdStudentId}');`);
      await setRole('postgres');
      await expect(db.query(`SELECT * FROM public.provision_admin('${parentUserA}');`)).rejects.toThrow(/currently linked to active parent-student links/i);
      await setRole('authenticated', adminId);
      await db.query(`SELECT public.unlink_parent_student('${parentUserA}', '${createdStudentId}');`);
      await setRole('postgres');
      const promotedParent = await db.query(`SELECT * FROM public.provision_admin('${parentUserA}');`);
      expect(promotedParent.rows[0].role).toBe('admin');
    } finally {
      await db.close();
    }
  }, 30000);

  it('16. Stage B.2: Stale unlink confirmation guard preserves newly linked teacher/student accounts and returns Conflict', async () => {
    const db = await createTestDatabase();
    try {
      for (const migration of [
        schemaSql,
        upgradeSql,
        correctiveSql,
        milestone2Sql,
        milestone3Sql,
        milestone3CorrectiveSql,
        gradesFeedbackSql,
        assessmentLockSql,
        teacherManagementSql,
        teacherCorrectionsSql,
        accountLinkingSql,
        stageB1CorrectiveSql,
        stageB2ExpectedUnlinkSql,
      ]) {
        await db.exec(migration);
      }

      // Verify privileges on 2-arg unlink functions
      expect((await db.query(`SELECT has_function_privilege('authenticated', 'public.unlink_teacher_account(uuid,uuid)', 'EXECUTE') AS allowed;`)).rows[0].allowed).toBe(true);
      expect((await db.query(`SELECT has_function_privilege('anon', 'public.unlink_teacher_account(uuid,uuid)', 'EXECUTE') AS allowed;`)).rows[0].allowed).toBe(false);
      expect((await db.query(`SELECT has_function_privilege('authenticated', 'public.unlink_student_account(uuid,uuid)', 'EXECUTE') AS allowed;`)).rows[0].allowed).toBe(true);
      expect((await db.query(`SELECT has_function_privilege('anon', 'public.unlink_student_account(uuid,uuid)', 'EXECUTE') AS allowed;`)).rows[0].allowed).toBe(false);

      const adminId = '99999999-9999-4999-8999-999999999999';
      const teacherUserA = '11111111-1111-4111-8111-000000000001';
      const teacherUserB = '11111111-1111-4111-8111-000000000002';
      const studentUserA = '22222222-2222-4222-8222-000000000001';
      const studentUserB = '22222222-2222-4222-8222-000000000002';

      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES
          ('${adminId}', 'admin_b2@test.local'),
          ('${teacherUserA}', 't_old@test.local'),
          ('${teacherUserB}', 't_new@test.local'),
          ('${studentUserA}', 's_old@test.local'),
          ('${studentUserB}', 's_new@test.local');

        INSERT INTO public.profiles (id, email, full_name, role) VALUES
          ('${adminId}', 'admin_b2@test.local', 'Admin B2', 'admin'),
          ('${teacherUserA}', 't_old@test.local', 'Old Teacher User', 'teacher'),
          ('${teacherUserB}', 't_new@test.local', 'New Teacher User', 'teacher'),
          ('${studentUserA}', 's_old@test.local', 'Old Student User', 'student'),
          ('${studentUserB}', 's_new@test.local', 'New Student User', 'student');
      `);

      const groupId = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
      const teacherId = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
      const studentId = 'cccccccc-cccc-4ccc-8ccc-000000000001';

      await db.exec(`
        SET ROLE authenticated;
        SET request.jwt.claim.role = 'authenticated';
        SET request.jwt.claim.sub = '${adminId}';

        INSERT INTO public.groups (id, name, grade_level, capacity)
        VALUES ('${groupId}', 'Grade 12A', 'Grade 12', 30);

        INSERT INTO public.teachers (id, full_name, subject, email)
        VALUES ('${teacherId}', 'Dr. Hassan', 'Biology', 'hassan.b2@test.local');

        INSERT INTO public.students (full_name, student_code, group_id, grade_level, qr_code_hash, status, id)
        VALUES ('Salma Noor', 'ET-B2-01', '${groupId}', 'Grade 12', 'QR-B2-01', 'active', '${studentId}');
      `);

      // --- A. Teacher Stale Confirmation Guard ---
      // 1. Link teacher to Account A (UI renders Account A in confirmation modal)
      await db.query(`SELECT public.link_teacher_account('${teacherId}', '${teacherUserA}');`);

      // 2. Concurrent admin/session replaces link with Account B before stale confirmation fires
      await db.query(`SELECT public.unlink_teacher_account('${teacherId}', '${teacherUserA}');`);
      await db.query(`SELECT public.link_teacher_account('${teacherId}', '${teacherUserB}');`);

      // 3. Stale confirmation submits expectedUserId = Account A -> MUST raise Conflict and preserve Account B
      await expect(db.query(`
        SELECT public.unlink_teacher_account('${teacherId}', '${teacherUserA}');
      `)).rejects.toThrow(/conflict.*changed to another user account/i);

      const persistedTeacher = await db.query(`SELECT user_id FROM public.teachers WHERE id = '${teacherId}';`);
      expect(persistedTeacher.rows[0].user_id).toBe(teacherUserB);

      // 4. Refresh & confirm with actual Account B succeeds, and subsequent stale confirm fails as already removed
      await db.query(`SELECT public.unlink_teacher_account('${teacherId}', '${teacherUserB}');`);
      const unlinkedTeacher = await db.query(`SELECT user_id FROM public.teachers WHERE id = '${teacherId}';`);
      expect(unlinkedTeacher.rows[0].user_id).toBeNull();

      await expect(db.query(`
        SELECT public.unlink_teacher_account('${teacherId}', '${teacherUserB}');
      `)).rejects.toThrow(/conflict.*already removed/i);

      // --- B. Student Stale Confirmation Guard ---
      await db.query(`SELECT public.link_student_account('${studentId}', '${studentUserA}');`);
      await db.query(`SELECT public.unlink_student_account('${studentId}', '${studentUserA}');`);
      await db.query(`SELECT public.link_student_account('${studentId}', '${studentUserB}');`);

      // Stale confirmation with Account A fails with Conflict and preserves Account B
      await expect(db.query(`
        SELECT public.unlink_student_account('${studentId}', '${studentUserA}');
      `)).rejects.toThrow(/conflict.*changed to another user account/i);

      const persistedStudent = await db.query(`SELECT user_id FROM public.students WHERE id = '${studentId}';`);
      expect(persistedStudent.rows[0].user_id).toBe(studentUserB);

      // Valid confirmation with Account B succeeds
      const unlinkStudentRes = await db.query(`SELECT public.unlink_student_account('${studentId}', '${studentUserB}') AS res;`);
      const parsedStudentUnlink = typeof unlinkStudentRes.rows[0].res === 'string'
        ? JSON.parse(unlinkStudentRes.rows[0].res)
        : unlinkStudentRes.rows[0].res;
      expect(parsedStudentUnlink.success).toBe(true);
      expect(parsedStudentUnlink.previous_user_id).toBe(studentUserB);

      // --- C. Backwards-compatible 1-arg calls remain operational after Stage B.2 migration ---
      await db.query(`SELECT public.link_teacher_account('${teacherId}', '${teacherUserA}');`);
      const legacyTeacherUnlink = await db.query(`SELECT public.unlink_teacher_account('${teacherId}') AS res;`);
      const parsedLegacyT = typeof legacyTeacherUnlink.rows[0].res === 'string'
        ? JSON.parse(legacyTeacherUnlink.rows[0].res)
        : legacyTeacherUnlink.rows[0].res;
      expect(parsedLegacyT.previous_user_id).toBe(teacherUserA);

      await db.query(`SELECT public.link_student_account('${studentId}', '${studentUserA}');`);
      const legacyStudentUnlink = await db.query(`SELECT public.unlink_student_account('${studentId}') AS res;`);
      const parsedLegacyS = typeof legacyStudentUnlink.rows[0].res === 'string'
        ? JSON.parse(legacyStudentUnlink.rows[0].res)
        : legacyStudentUnlink.rows[0].res;
      expect(parsedLegacyS.previous_user_id).toBe(studentUserA);
    } finally {
      await db.close();
    }
  }, 30000);

  it('17. Stage C.1: Teacher read-only isolation, server auth.uid() derivation, privacy omissions, assignment revocation/transfer, and non-teacher rejection', async () => {
    const db = await createTestDatabase();
    try {
      for (const migration of [
        schemaSql,
        upgradeSql,
        correctiveSql,
        milestone2Sql,
        milestone3Sql,
        milestone3CorrectiveSql,
        gradesFeedbackSql,
        assessmentLockSql,
        teacherManagementSql,
        teacherCorrectionsSql,
        accountLinkingSql,
        stageB1CorrectiveSql,
        stageB2ExpectedUnlinkSql,
        stageC1TeacherReadSql,
      ]) {
        await db.exec(migration);
      }

      // Production execute privilege bounds
      expect((await db.query(`SELECT has_function_privilege('authenticated', 'public.get_teacher_portal_context()', 'EXECUTE') AS allowed;`)).rows[0].allowed).toBe(true);
      expect((await db.query(`SELECT has_function_privilege('anon', 'public.get_teacher_portal_context()', 'EXECUTE') AS allowed;`)).rows[0].allowed).toBe(false);
      expect((await db.query(`SELECT has_function_privilege('authenticated', 'public.get_teacher_group_students(uuid)', 'EXECUTE') AS allowed;`)).rows[0].allowed).toBe(true);
      expect((await db.query(`SELECT has_function_privilege('anon', 'public.get_teacher_group_students(uuid)', 'EXECUTE') AS allowed;`)).rows[0].allowed).toBe(false);

      const adminId = '99999999-9999-4999-8999-000000000099';
      const teacherUser1 = '11111111-1111-4111-8111-000000000011';
      const teacherUser2 = '11111111-1111-4111-8111-000000000012';
      const unlinkedTeacherUser = '11111111-1111-4111-8111-000000000013';
      const studentUser = '22222222-2222-4222-8222-000000000021';
      const parentUser = '33333333-3333-4333-8333-000000000031';

      const teacherRec1 = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000011';
      const teacherRec2 = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000012';
      const groupA = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000011';
      const groupB = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000012';
      const groupEmpty = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000013';
      const groupUnassigned = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000014';

      const setAuth = (uid: string | null) => {
        if (!uid) {
          return db.exec(`SET ROLE anon; SET request.jwt.claim.role = 'anon'; SET request.jwt.claim.sub = '';`);
        }
        return db.exec(`SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${uid}';`);
      };

      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES
          ('${adminId}', 'admin_c1@test.local'),
          ('${teacherUser1}', 't1_c1@test.local'),
          ('${teacherUser2}', 't2_c1@test.local'),
          ('${unlinkedTeacherUser}', 't_unlinked@test.local'),
          ('${studentUser}', 's_c1@test.local'),
          ('${parentUser}', 'p_c1@test.local');

        INSERT INTO public.profiles (id, email, full_name, role) VALUES
          ('${adminId}', 'admin_c1@test.local', 'Admin C1', 'admin'),
          ('${teacherUser1}', 't1_c1@test.local', 'Teacher One', 'teacher'),
          ('${teacherUser2}', 't2_c1@test.local', 'Teacher Two', 'teacher'),
          ('${unlinkedTeacherUser}', 't_unlinked@test.local', 'Unlinked Teacher', 'teacher'),
          ('${studentUser}', 's_c1@test.local', 'Student C1', 'student'),
          ('${parentUser}', 'p_c1@test.local', 'Parent C1', 'parent');
      `);

      await setAuth(adminId);
      await db.exec(`
        INSERT INTO public.teachers (id, full_name, subject, email) VALUES
          ('${teacherRec1}', 'Teacher One', 'Physics', 't1_dir@test.local'),
          ('${teacherRec2}', 'Teacher Two', 'Chemistry', 't2_dir@test.local');

        SELECT public.link_teacher_account('${teacherRec1}', '${teacherUser1}');
        SELECT public.link_teacher_account('${teacherRec2}', '${teacherUser2}');

        INSERT INTO public.groups (id, name, grade_level, teacher_id, capacity) VALUES
          ('${groupA}', 'Group A Physics', 'Grade 10', '${teacherRec1}', 30),
          ('${groupB}', 'Group B Chem', 'Grade 11', '${teacherRec2}', 30),
          ('${groupEmpty}', 'Group Empty', 'Grade 10', '${teacherRec1}', 20),
          ('${groupUnassigned}', 'Group Unassigned', 'Grade 12', NULL, 25);

        INSERT INTO public.students (full_name, student_code, group_id, grade_level, qr_code_hash, parent_name, parent_phone, status) VALUES
          ('Amina Khaled', 'ET-C1-01', '${groupA}', 'Grade 10', 'SECRET-QR-A1', 'Mr Khaled', '+201001112233', 'active'),
          ('Youssef Adel', 'ET-C1-02', '${groupA}', 'Grade 10', 'SECRET-QR-A2', 'Mrs Adel', '+201004445566', 'suspended'),
          ('Nour Tarek', 'ET-C1-03', '${groupB}', 'Grade 11', 'SECRET-QR-B1', 'Mr Tarek', '+201007778899', 'active'),
          ('Zainab Sami', 'ET-C1-04', '${groupUnassigned}', 'Grade 12', 'SECRET-QR-U1', 'Mrs Sami', '+201009990011', 'active');
      `);

      const parseJson = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);

      // 1. Teacher 1 only sees Group A and Group Empty (never Group B or Unassigned)
      await setAuth(teacherUser1);
      const ctx1 = parseJson((await db.query(`SELECT public.get_teacher_portal_context() AS res;`)).rows[0].res);
      expect(ctx1.linked).toBe(true);
      expect(ctx1.teacher.id).toBe(teacherRec1);
      expect(ctx1.groups.map((g: { id: string }) => g.id).sort()).toEqual([groupA, groupEmpty].sort());

      // Direct SELECT on students/groups/teachers returns 0 rows (table RLS stays admin-only, protecting PII/QR)
      expect((await db.query(`SELECT * FROM public.students;`)).rows).toHaveLength(0);
      expect((await db.query(`SELECT * FROM public.groups;`)).rows).toHaveLength(0);
      expect((await db.query(`SELECT * FROM public.teachers;`)).rows).toHaveLength(0);

      // Teacher 1 group A students omit parent PII, QR hash, and user_id
      const rosterA = parseJson((await db.query(`SELECT public.get_teacher_group_students('${groupA}') AS res;`)).rows[0].res);
      expect(rosterA.group).toEqual({ id: groupA, name: 'Group A Physics', grade_level: 'Grade 10' });
      expect(rosterA.students).toHaveLength(2);
      for (const s of rosterA.students) {
        expect(Object.keys(s).sort()).toEqual(['full_name', 'group_id', 'id', 'status', 'student_code']);
        expect(s).not.toHaveProperty('qr_code_hash');
        expect(s).not.toHaveProperty('parent_name');
        expect(s).not.toHaveProperty('parent_phone');
        expect(s).not.toHaveProperty('user_id');
      }

      // Empty assigned group returns clean empty student array
      const rosterEmpty = parseJson((await db.query(`SELECT public.get_teacher_group_students('${groupEmpty}') AS res;`)).rows[0].res);
      expect(rosterEmpty.group.id).toBe(groupEmpty);
      expect(rosterEmpty.students).toEqual([]);

      // Teacher 1 cannot read Group B (Teacher 2) or Group Unassigned
      await expect(db.query(`SELECT public.get_teacher_group_students('${groupB}');`)).rejects.toThrow(/access denied/i);
      await expect(db.query(`SELECT public.get_teacher_group_students('${groupUnassigned}');`)).rejects.toThrow(/access denied/i);

      // 2. Teacher 2 only sees Group B and its student
      await setAuth(teacherUser2);
      const ctx2 = parseJson((await db.query(`SELECT public.get_teacher_portal_context() AS res;`)).rows[0].res);
      expect(ctx2.linked).toBe(true);
      expect(ctx2.groups.map((g: { id: string }) => g.id)).toEqual([groupB]);
      const rosterB = parseJson((await db.query(`SELECT public.get_teacher_group_students('${groupB}') AS res;`)).rows[0].res);
      expect(rosterB.students.map((s: { student_code: string }) => s.student_code)).toEqual(['ET-C1-03']);
      await expect(db.query(`SELECT public.get_teacher_group_students('${groupA}');`)).rejects.toThrow(/access denied/i);

      // 3. Unlinked teacher sees linked: false and cannot read any group roster
      await setAuth(unlinkedTeacherUser);
      const ctxUnlinked = parseJson((await db.query(`SELECT public.get_teacher_portal_context() AS res;`)).rows[0].res);
      expect(ctxUnlinked).toEqual({ linked: false, teacher: null, groups: [] });
      await expect(db.query(`SELECT public.get_teacher_group_students('${groupA}');`)).rejects.toThrow(/not linked/i);

      // 4. Non-teacher accounts (student, parent, admin) and anon are rejected by teacher RPCs
      for (const nonTeacher of [studentUser, parentUser, adminId]) {
        await setAuth(nonTeacher);
        await expect(db.query(`SELECT public.get_teacher_portal_context();`)).rejects.toThrow(/access denied/i);
        await expect(db.query(`SELECT public.get_teacher_group_students('${groupA}');`)).rejects.toThrow(/access denied/i);
      }
      await setAuth(null);
      await expect(db.query(`SELECT public.get_teacher_portal_context();`)).rejects.toThrow(/permission denied/i);

      // 5. Revocation / Transfer: Admin moves Group A from Teacher 1 to Teacher 2; Admin retains full access
      await setAuth(adminId);
      const adminStudents = await db.query(`SELECT student_code, qr_code_hash, parent_phone FROM public.students WHERE group_id = '${groupA}';`);
      expect(adminStudents.rows).toHaveLength(2);
      expect(adminStudents.rows[0].qr_code_hash).toBeTruthy();

      await db.query(`UPDATE public.groups SET teacher_id = '${teacherRec2}' WHERE id = '${groupA}';`);

      // Teacher 1 immediately loses access to Group A on every read
      await setAuth(teacherUser1);
      const ctx1After = parseJson((await db.query(`SELECT public.get_teacher_portal_context() AS res;`)).rows[0].res);
      expect(ctx1After.groups.map((g: { id: string }) => g.id)).toEqual([groupEmpty]);
      await expect(db.query(`SELECT public.get_teacher_group_students('${groupA}');`)).rejects.toThrow(/access denied/i);

      // Teacher 2 gains scoped access to Group A
      await setAuth(teacherUser2);
      const ctx2After = parseJson((await db.query(`SELECT public.get_teacher_portal_context() AS res;`)).rows[0].res);
      expect(ctx2After.groups.map((g: { id: string }) => g.id).sort()).toEqual([groupA, groupB].sort());
      const rosterAAfter = parseJson((await db.query(`SELECT public.get_teacher_group_students('${groupA}') AS res;`)).rows[0].res);
      expect(rosterAAfter.students).toHaveLength(2);
    } finally {
      await db.close();
    }
  }, 30000);

  it('18. Stage C.2: Scoped teacher grade & note creation, server author derivation, lock checks on move/revoke/status, and author isolation on transfer', async () => {
    const db = await createTestDatabase();
    try {
      for (const migration of [
        schemaSql,
        upgradeSql,
        correctiveSql,
        milestone2Sql,
        milestone3Sql,
        milestone3CorrectiveSql,
        gradesFeedbackSql,
        assessmentLockSql,
        teacherManagementSql,
        teacherCorrectionsSql,
        accountLinkingSql,
        stageB1CorrectiveSql,
        stageB2ExpectedUnlinkSql,
        stageC1TeacherReadSql,
        stageC2TeacherWriteSql,
      ]) {
        await db.exec(migration);
      }

      // Privilege verification
      expect((await db.query(`SELECT has_function_privilege('authenticated', 'public.get_teacher_student_records(uuid,uuid)', 'EXECUTE') AS allowed;`)).rows[0].allowed).toBe(true);
      expect((await db.query(`SELECT has_function_privilege('anon', 'public.get_teacher_student_records(uuid,uuid)', 'EXECUTE') AS allowed;`)).rows[0].allowed).toBe(false);
      expect((await db.query(`SELECT has_function_privilege('authenticated', 'public.save_teacher_student_grade(uuid,uuid,text,public.grade_category,numeric,numeric,date,text)', 'EXECUTE') AS allowed;`)).rows[0].allowed).toBe(true);
      expect((await db.query(`SELECT has_function_privilege('anon', 'public.save_teacher_student_grade(uuid,uuid,text,public.grade_category,numeric,numeric,date,text)', 'EXECUTE') AS allowed;`)).rows[0].allowed).toBe(false);
      expect((await db.query(`SELECT has_function_privilege('authenticated', 'public.save_teacher_student_note(uuid,uuid,text,boolean)', 'EXECUTE') AS allowed;`)).rows[0].allowed).toBe(true);
      expect((await db.query(`SELECT has_function_privilege('anon', 'public.save_teacher_student_note(uuid,uuid,text,boolean)', 'EXECUTE') AS allowed;`)).rows[0].allowed).toBe(false);
      expect((await db.query(`SELECT has_function_privilege('authenticated', 'public.validate_grade_record()', 'EXECUTE') AS allowed;`)).rows[0].allowed).toBe(false);
      expect((await db.query(`SELECT has_function_privilege('authenticated', 'public.validate_teacher_note()', 'EXECUTE') AS allowed;`)).rows[0].allowed).toBe(false);

      const adminId = '99999999-9999-4999-8999-000000000199';
      const teacherUser1 = '11111111-1111-4111-8111-000000000111';
      const teacherUser2 = '11111111-1111-4111-8111-000000000112';
      const unlinkedTeacherUser = '11111111-1111-4111-8111-000000000113';
      const studentUser = '22222222-2222-4222-8222-000000000121';

      const teacherRec1 = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000111';
      const teacherRec2 = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000112';
      const groupA = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000111';
      const groupB = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000112';
      const stuActiveId = 'cccccccc-cccc-4ccc-8ccc-000000000101';
      const stuSuspendedId = 'cccccccc-cccc-4ccc-8ccc-000000000102';
      const stuGroupBId = 'cccccccc-cccc-4ccc-8ccc-000000000103';

      const setAuth = (uid: string | null) => {
        if (!uid) {
          return db.exec(`SET ROLE anon; SET request.jwt.claim.role = 'anon'; SET request.jwt.claim.sub = '';`);
        }
        return db.exec(`SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${uid}';`);
      };

      const getCounts = async () => {
        await setAuth(adminId);
        const g = await db.query(`SELECT count(*)::int AS cnt FROM public.grades;`);
        const n = await db.query(`SELECT count(*)::int AS cnt FROM public.teacher_notes;`);
        return { grades: g.rows[0].cnt, notes: n.rows[0].cnt };
      };

      const parseJson = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);

      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES
          ('${adminId}', 'admin_c2@test.local'),
          ('${teacherUser1}', 't1_c2@test.local'),
          ('${teacherUser2}', 't2_c2@test.local'),
          ('${unlinkedTeacherUser}', 'tu_c2@test.local'),
          ('${studentUser}', 's_c2@test.local');

        INSERT INTO public.profiles (id, email, full_name, role) VALUES
          ('${adminId}', 'admin_c2@test.local', 'Admin C2', 'admin'),
          ('${teacherUser1}', 't1_c2@test.local', 'Teacher One', 'teacher'),
          ('${teacherUser2}', 't2_c2@test.local', 'Teacher Two', 'teacher'),
          ('${unlinkedTeacherUser}', 'tu_c2@test.local', 'Unlinked Teacher', 'teacher'),
          ('${studentUser}', 's_c2@test.local', 'Student C2', 'student');
      `);

      await setAuth(adminId);
      await db.exec(`
        INSERT INTO public.teachers (id, full_name, subject, email) VALUES
          ('${teacherRec1}', 'Teacher One Author', 'Physics', 't1_c2_dir@test.local'),
          ('${teacherRec2}', 'Teacher Two Author', 'Chemistry', 't2_c2_dir@test.local');

        SELECT public.link_teacher_account('${teacherRec1}', '${teacherUser1}');
        SELECT public.link_teacher_account('${teacherRec2}', '${teacherUser2}');

        INSERT INTO public.groups (id, name, grade_level, teacher_id, capacity) VALUES
          ('${groupA}', 'Group Alpha', 'Grade 10', '${teacherRec1}', 30),
          ('${groupB}', 'Group Beta', 'Grade 11', '${teacherRec2}', 30);

        INSERT INTO public.students (id, full_name, student_code, group_id, grade_level, qr_code_hash, status) VALUES
          ('${stuActiveId}', 'Active Student', 'C2-001', '${groupA}', 'Grade 10', 'QR-C2-001', 'active'),
          ('${stuSuspendedId}', 'Suspended Student', 'C2-002', '${groupA}', 'Grade 10', 'QR-C2-002', 'suspended'),
          ('${stuGroupBId}', 'Group B Student', 'C2-003', '${groupB}', 'Grade 11', 'QR-C2-003', 'active');
      `);

      const todayCairoRes = await db.query(`SELECT ((NOW() AT TIME ZONE 'Africa/Cairo')::DATE)::TEXT AS today;`);
      const todayCairo = todayCairoRes.rows[0].today;

      // 1. Teacher 1 saves a grade and a note for active student in assigned Group A
      await setAuth(teacherUser1);
      const savedGradeRes = parseJson(
        (
          await db.query(
            `SELECT public.save_teacher_student_grade($1, $2, $3, 'quiz'::public.grade_category, 18.5, 20, $4::date, $5) AS res;`,
            [groupA, stuActiveId, 'Chapter 2 Quiz', todayCairo, 'Great work']
          )
        ).rows[0].res
      );
      expect(savedGradeRes.grade.teacher_id).toBe(teacherRec1);
      expect(savedGradeRes.grade.author_name).toBe('Teacher One Author');
      expect(Number(savedGradeRes.grade.score)).toBe(18.5);
      expect(Number(savedGradeRes.grade.max_score)).toBe(20);
      expect(savedGradeRes.grade.remarks).toBe('Great work');

      const savedNoteRes = parseJson(
        (
          await db.query(
            `SELECT public.save_teacher_student_note($1, $2, $3, false) AS res;`,
            [groupA, stuActiveId, 'Needs extra review on vectors']
          )
        ).rows[0].res
      );
      expect(savedNoteRes.note.teacher_id).toBe(teacherRec1);
      expect(savedNoteRes.note.is_parent_visible).toBe(false);
      expect(savedNoteRes.note.feedback_text).toBe('Needs extra review on vectors');

      // Re-reading returns teacher1's saved grade & note
      const readBack1 = parseJson(
        (await db.query(`SELECT public.get_teacher_student_records('${groupA}', '${stuActiveId}') AS res;`)).rows[0].res
      );
      expect(readBack1.grades).toHaveLength(1);
      expect(readBack1.notes).toHaveLength(1);
      expect(readBack1.grades[0].assessment_title).toBe('Chapter 2 Quiz');

      // Direct table inserts/updates remain blocked by trigger & RLS for teachers
      await expect(
        db.query(`INSERT INTO public.grades (student_id, group_id, teacher_id, assessment_title, score, max_score) VALUES ('${stuActiveId}', '${groupA}', '${teacherRec1}', 'Bypass', 10, 10);`)
      ).rejects.toThrow(/unauthorized|row-level security|permission denied/i);
      await expect(
        db.query(`INSERT INTO public.teacher_notes (teacher_id, student_id, feedback_text, is_parent_visible) VALUES ('${teacherRec1}', '${stuActiveId}', 'Bypass note', false);`)
      ).rejects.toThrow(/unauthorized|row-level security|permission denied/i);
      const updGrades = await db.query(`UPDATE public.grades SET score = 0 WHERE id = '${savedGradeRes.grade.id}' RETURNING id;`);
      expect(updGrades.rows).toHaveLength(0);
      const updNotes = await db.query(`UPDATE public.teacher_notes SET feedback_text = 'tampered' WHERE id = '${savedNoteRes.note.id}' RETURNING id;`);
      expect(updNotes.rows).toHaveLength(0);

      const baselineCounts = await getCounts();
      expect(baselineCounts).toEqual({ grades: 1, notes: 1 });

      // 2. Rejections leave row counts untouched:
      // a) Teacher 2 targeting Teacher 1's Group A
      await setAuth(teacherUser2);
      await expect(
        db.query(`SELECT public.save_teacher_student_grade('${groupA}', '${stuActiveId}', 'Wrong T', 'exam', 10, 10, '${todayCairo}');`)
      ).rejects.toThrow(/access denied/i);
      await expect(
        db.query(`SELECT public.save_teacher_student_note('${groupA}', '${stuActiveId}', 'Wrong T note', false);`)
      ).rejects.toThrow(/access denied/i);

      // b) Unlinked teacher
      await setAuth(unlinkedTeacherUser);
      await expect(
        db.query(`SELECT public.save_teacher_student_grade('${groupA}', '${stuActiveId}', 'Unlinked', 'exam', 10, 10, '${todayCairo}');`)
      ).rejects.toThrow(/not linked/i);

      // c) Student / non-teacher
      await setAuth(studentUser);
      await expect(
        db.query(`SELECT public.save_teacher_student_note('${groupA}', '${stuActiveId}', 'Student note', false);`)
      ).rejects.toThrow(/access denied/i);

      // d) Suspended student & wrong-group student & validation bounds
      await setAuth(teacherUser1);
      await expect(
        db.query(`SELECT public.save_teacher_student_grade('${groupA}', '${stuSuspendedId}', 'Suspended', 'exam', 10, 20, '${todayCairo}');`)
      ).rejects.toThrow(/active students/i);
      await expect(
        db.query(`SELECT public.save_teacher_student_note('${groupA}', '${stuSuspendedId}', 'Suspended note', false);`)
      ).rejects.toThrow(/active student/i);
      await expect(
        db.query(`SELECT public.save_teacher_student_grade('${groupA}', '${stuGroupBId}', 'Moved student', 'exam', 10, 20, '${todayCairo}');`)
      ).rejects.toThrow(/does not currently belong/i);
      await expect(
        db.query(`SELECT public.save_teacher_student_grade('${groupA}', '${stuActiveId}', 'Over score', 'exam', 25, 20, '${todayCairo}');`)
      ).rejects.toThrow(/Invalid score/i);
      await expect(
        db.query(`SELECT public.save_teacher_student_grade('${groupA}', '${stuActiveId}', 'Future', 'exam', 10, 20, (('${todayCairo}'::date) + 5));`)
      ).rejects.toThrow(/future/i);

      expect(await getCounts()).toEqual({ grades: 1, notes: 1 });

      // 3. Admin flow continues working cleanly
      await setAuth(adminId);
      await db.query(
        `INSERT INTO public.grades (student_id, group_id, assessment_title, score, max_score, assessment_date) VALUES ('${stuGroupBId}', '${groupB}', 'Admin Exam', 90, 100, '${todayCairo}');`
      );
      await db.query(
        `INSERT INTO public.teacher_notes (teacher_id, student_id, feedback_text, is_parent_visible) VALUES ('${teacherRec2}', '${stuGroupBId}', 'Admin note', true);`
      );
      expect(await getCounts()).toEqual({ grades: 2, notes: 2 });

      // 4. Transfer Group A to Teacher 2 before Teacher 1 tries another save:
      await setAuth(adminId);
      await db.query(`UPDATE public.groups SET teacher_id = '${teacherRec2}' WHERE id = '${groupA}';`);

      // Teacher 1 can no longer write OR read Group A
      await setAuth(teacherUser1);
      await expect(
        db.query(`SELECT public.save_teacher_student_grade('${groupA}', '${stuActiveId}', 'Stale write', 'exam', 10, 20, '${todayCairo}');`)
      ).rejects.toThrow(/not currently assigned/i);
      await expect(
        db.query(`SELECT public.save_teacher_student_note('${groupA}', '${stuActiveId}', 'Stale note', false);`)
      ).rejects.toThrow(/not currently assigned/i);
      await expect(
        db.query(`SELECT public.get_teacher_student_records('${groupA}', '${stuActiveId}');`)
      ).rejects.toThrow(/not assigned/i);
      expect(await getCounts()).toEqual({ grades: 2, notes: 2 });

      // Teacher 2 writes to Group A, reads ONLY Teacher 2's records, while Teacher 1's historical records stay attributed to Teacher 1
      await setAuth(teacherUser2);
      await db.query(
        `SELECT public.save_teacher_student_grade('${groupA}', '${stuActiveId}', 'T2 Quiz', 'quiz', 15, 20, '${todayCairo}');`
      );
      const t2Records = parseJson(
        (await db.query(`SELECT public.get_teacher_student_records('${groupA}', '${stuActiveId}') AS res;`)).rows[0].res
      );
      expect(t2Records.grades).toHaveLength(1);
      expect(t2Records.grades[0].assessment_title).toBe('T2 Quiz');
      expect(t2Records.grades[0].teacher_id).toBe(teacherRec2);
      expect(t2Records.notes).toHaveLength(0);

      // Verify historical rows in DB still carry original author teacherRec1
      await setAuth(adminId);
      const origGrade = await db.query(`SELECT teacher_id FROM public.grades WHERE assessment_title = 'Chapter 2 Quiz';`);
      const origNote = await db.query(`SELECT teacher_id FROM public.teacher_notes WHERE feedback_text = 'Needs extra review on vectors';`);
      expect(origGrade.rows[0].teacher_id).toBe(teacherRec1);
      expect(origNote.rows[0].teacher_id).toBe(teacherRec1);
    } finally {
      await db.close();
    }
  }, 30000);

  it('19. Stage D: Student portal isolation (same-name 18/20 scenario), unlinked/unlink handling, historical grade survival across moves, role rejection, and field privacy', async () => {
    const db = await createTestDatabase();
    try {
      for (const migration of [
        schemaSql,
        upgradeSql,
        correctiveSql,
        milestone2Sql,
        milestone3Sql,
        milestone3CorrectiveSql,
        gradesFeedbackSql,
        assessmentLockSql,
        teacherManagementSql,
        teacherCorrectionsSql,
        accountLinkingSql,
        stageB1CorrectiveSql,
        stageB2ExpectedUnlinkSql,
        stageC1TeacherReadSql,
        stageC2TeacherWriteSql,
        stageDStudentReadSql,
      ]) {
        await db.exec(migration);
      }

      // Verify execute bounds
      expect((await db.query(`SELECT has_function_privilege('authenticated', 'public.get_student_portal_data()', 'EXECUTE') AS allowed;`)).rows[0].allowed).toBe(true);
      expect((await db.query(`SELECT has_function_privilege('anon', 'public.get_student_portal_data()', 'EXECUTE') AS allowed;`)).rows[0].allowed).toBe(false);

      const adminId = '99999999-9999-4999-8999-000000000299';
      const teacherUserId = '11111111-1111-4111-8111-000000000211';
      const studentUser1 = '22222222-2222-4222-8222-000000000201';
      const studentUser2 = '22222222-2222-4222-8222-000000000202';
      const unlinkedStudentUser = '22222222-2222-4222-8222-000000000203';
      const parentUserId = '33333333-3333-4333-8333-000000000231';

      const teacherRec1 = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000211';
      const teacherRec2 = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000212';
      const groupA = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000211';
      const groupB = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000212';
      const student1Id = 'cccccccc-cccc-4ccc-8ccc-000000000201';
      const student2Id = 'cccccccc-cccc-4ccc-8ccc-000000000202';

      const setAuth = (uid: string | null) => {
        if (!uid) {
          return db.exec(`SET ROLE anon; SET request.jwt.claim.role = 'anon'; SET request.jwt.claim.sub = '';`);
        }
        return db.exec(`SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${uid}';`);
      };
      const parseJson = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);

      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES
          ('${adminId}', 'admin_d@test.local'),
          ('${teacherUserId}', 't1_d@test.local'),
          ('${studentUser1}', 'stu1_d@test.local'),
          ('${studentUser2}', 'stu2_d@test.local'),
          ('${unlinkedStudentUser}', 'stu_unlinked_d@test.local'),
          ('${parentUserId}', 'p_d@test.local');

        INSERT INTO public.profiles (id, email, full_name, role) VALUES
          ('${adminId}', 'admin_d@test.local', 'Admin D', 'admin'),
          ('${teacherUserId}', 't1_d@test.local', 'Teacher D', 'teacher'),
          ('${studentUser1}', 'stu1_d@test.local', 'Mohamed Ali Account 1', 'student'),
          ('${studentUser2}', 'stu2_d@test.local', 'Mohamed Ali Account 2', 'student'),
          ('${unlinkedStudentUser}', 'stu_unlinked_d@test.local', 'Unlinked Student', 'student'),
          ('${parentUserId}', 'p_d@test.local', 'Parent D', 'parent');
      `);

      await setAuth(adminId);
      await db.exec(`
        INSERT INTO public.teachers (id, full_name, subject, email) VALUES
          ('${teacherRec1}', 'Teacher D1', 'Math', 't1_d_dir@test.local'),
          ('${teacherRec2}', 'Teacher D2', 'Science', 't2_d_dir@test.local');

        SELECT public.link_teacher_account('${teacherRec1}', '${teacherUserId}');

        INSERT INTO public.groups (id, name, grade_level, teacher_id, capacity) VALUES
          ('${groupA}', 'Group D-Alpha', 'Grade 9', '${teacherRec1}', 30),
          ('${groupB}', 'Group D-Beta', 'Grade 9', '${teacherRec2}', 30);

        -- Two students in the SAME group with identical full_name and distinct codes
        INSERT INTO public.students (id, full_name, student_code, group_id, grade_level, qr_code_hash, parent_name, parent_phone, status) VALUES
          ('${student1Id}', 'Mohamed Ali', 'ET-D-101', '${groupA}', 'Grade 9', 'SECRET-QR-D101', 'Mr Ali Senior', '+201001112200', 'active'),
          ('${student2Id}', 'Mohamed Ali', 'ET-D-102', '${groupA}', 'Grade 9', 'SECRET-QR-D102', 'Mrs Ali Twin', '+201003334400', 'active');

        SELECT public.link_student_account('${student1Id}', '${studentUser1}');
        SELECT public.link_student_account('${student2Id}', '${studentUser2}');
      `);

      const todayCairo = (await db.query(`SELECT ((NOW() AT TIME ZONE 'Africa/Cairo')::DATE)::TEXT AS today;`)).rows[0].today;

      // Record attendance for Student 1 via existing QR attendance RPC
      await setAuth(adminId);
      const qrScan = parseJson(
        (await db.query(`SELECT public.record_qr_attendance('SECRET-QR-D101', '${groupA}') AS res;`)).rows[0].res
      );
      expect(qrScan.code).toBe('RECORDED');

      // Record 18/20 grade AND teacher notes (both internal and parent-visible) for Student 1 via existing Teacher Stage C.2 RPCs
      await setAuth(teacherUserId);
      await db.query(
        `SELECT public.save_teacher_student_grade('${groupA}', '${student1Id}', 'Algebra Midterm', 'exam', 18, 20, '${todayCairo}', 'Private remark');`
      );
      await db.query(
        `SELECT public.save_teacher_student_note('${groupA}', '${student1Id}', 'Internal note hidden from student', false);`
      );
      await db.query(
        `SELECT public.save_teacher_student_note('${groupA}', '${student1Id}', 'Parent note reserved for Stage E', true);`
      );

      // 1. Student 1 reads own portal -> sees card ET-D-101, attendance, 18/20 grade, and ZERO sensitive fields/notes
      await setAuth(studentUser1);
      const s1Data = parseJson((await db.query(`SELECT public.get_student_portal_data() AS res;`)).rows[0].res);
      expect(Object.keys(s1Data).sort()).toEqual(['attendance', 'grades', 'linked', 'student']);
      expect(s1Data.linked).toBe(true);
      expect(s1Data.student.full_name).toBe('Mohamed Ali');
      expect(s1Data.student.student_code).toBe('ET-D-101');
      expect(s1Data.student.group.name).toBe('Group D-Alpha');
      expect(Object.keys(s1Data.student).sort()).toEqual(['full_name', 'grade_level', 'group', 'id', 'status', 'student_code']);
      expect(s1Data.student).not.toHaveProperty('qr_code_hash');
      expect(s1Data.student).not.toHaveProperty('parent_name');
      expect(s1Data.student).not.toHaveProperty('parent_phone');
      expect(s1Data.student).not.toHaveProperty('user_id');

      expect(s1Data.attendance).toHaveLength(1);
      expect(s1Data.attendance[0].status).toBe('Present');
      expect(s1Data.attendance[0].check_in_time).toBeTruthy();
      expect(s1Data.grades).toHaveLength(1);
      expect(Number(s1Data.grades[0].score)).toBe(18);
      expect(Number(s1Data.grades[0].max_score)).toBe(20);
      expect(s1Data.grades[0].assessment_title).toBe('Algebra Midterm');
      expect(Object.keys(s1Data.grades[0]).sort()).toEqual([
        'assessment_date',
        'assessment_title',
        'grade_type',
        'id',
        'max_score',
        'score',
      ]);
      expect(JSON.stringify(s1Data)).not.toContain('SECRET-QR-D101');
      expect(JSON.stringify(s1Data)).not.toContain('Mr Ali Senior');
      expect(JSON.stringify(s1Data)).not.toContain('+201001112200');
      expect(JSON.stringify(s1Data)).not.toContain('Internal note hidden');
      expect(JSON.stringify(s1Data)).not.toContain('Parent note reserved');

      // Direct table SELECT remains locked for students (0 rows)
      expect((await db.query(`SELECT * FROM public.students;`)).rows).toHaveLength(0);
      expect((await db.query(`SELECT * FROM public.attendance;`)).rows).toHaveLength(0);
      expect((await db.query(`SELECT * FROM public.grades;`)).rows).toHaveLength(0);
      expect((await db.query(`SELECT * FROM public.teacher_notes;`)).rows).toHaveLength(0);

      // 2. Student 2 (same name "Mohamed Ali", code ET-D-102 in same Group A) sees ONLY ET-D-102 with empty records
      await setAuth(studentUser2);
      const s2Data = parseJson((await db.query(`SELECT public.get_student_portal_data() AS res;`)).rows[0].res);
      expect(s2Data.linked).toBe(true);
      expect(s2Data.student.student_code).toBe('ET-D-102');
      expect(s2Data.attendance).toEqual([]);
      expect(s2Data.grades).toEqual([]);

      // 3. Unlinked student returns linked: false
      await setAuth(unlinkedStudentUser);
      const unlinkedData = parseJson((await db.query(`SELECT public.get_student_portal_data() AS res;`)).rows[0].res);
      expect(unlinkedData).toEqual({ linked: false, student: null, attendance: [], grades: [] });

      // 4. Rejects non-student roles (teacher, admin, parent) and anon
      for (const nonStu of [teacherUserId, adminId, parentUserId]) {
        await setAuth(nonStu);
        await expect(db.query(`SELECT public.get_student_portal_data();`)).rejects.toThrow(/access denied/i);
      }
      await setAuth(null);
      await expect(db.query(`SELECT public.get_student_portal_data();`)).rejects.toThrow(/permission denied/i);

      // 5. Move Student 1 to Group B (different teacher) and then remove group -> historical 18/20 grade stays visible
      await db.exec(`RESET ROLE;`);
      await db.query(`UPDATE public.students SET group_id = '${groupB}' WHERE id = '${student1Id}';`);
      await setAuth(studentUser1);
      const afterMove = parseJson((await db.query(`SELECT public.get_student_portal_data() AS res;`)).rows[0].res);
      expect(afterMove.student.group.name).toBe('Group D-Beta');
      expect(afterMove.grades).toHaveLength(1);
      expect(Number(afterMove.grades[0].score)).toBe(18);

      await db.exec(`RESET ROLE;`);
      await db.query(`UPDATE public.students SET group_id = NULL WHERE id = '${student1Id}';`);
      await setAuth(studentUser1);
      const withoutGroup = parseJson((await db.query(`SELECT public.get_student_portal_data() AS res;`)).rows[0].res);
      expect(withoutGroup.student.group).toBeNull();
      expect(withoutGroup.grades).toHaveLength(1);

      // 6. Unlink Student 1 account -> next read returns linked: false without previous data
      await setAuth(adminId);
      await db.query(`SELECT public.unlink_student_account('${student1Id}', '${studentUser1}');`);
      await setAuth(studentUser1);
      const afterUnlink = parseJson((await db.query(`SELECT public.get_student_portal_data() AS res;`)).rows[0].res);
      expect(afterUnlink).toEqual({ linked: false, student: null, attendance: [], grades: [] });

      // 7. Admin & Teacher access preserved
      await setAuth(adminId);
      expect((await db.query(`SELECT student_code, qr_code_hash FROM public.students WHERE id = '${student1Id}';`)).rows[0].qr_code_hash).toBe('SECRET-QR-D101');
    } finally {
      await db.close();
    }
  }, 30000);

  it('20. Stage E: Parent portal multi-child shared link, SQL-level parent-visible notes filter, unlinked/revoked link enforcement, child-without-login access, and role isolation', async () => {
    const db = await createTestDatabase();
    try {
      for (const migration of [
        schemaSql,
        upgradeSql,
        correctiveSql,
        milestone2Sql,
        milestone3Sql,
        milestone3CorrectiveSql,
        gradesFeedbackSql,
        assessmentLockSql,
        teacherManagementSql,
        teacherCorrectionsSql,
        accountLinkingSql,
        stageB1CorrectiveSql,
        stageB2ExpectedUnlinkSql,
        stageC1TeacherReadSql,
        stageC2TeacherWriteSql,
        stageDStudentReadSql,
        stageEParentReadSql,
      ]) {
        await db.exec(migration);
      }

      // Verify execute grants & anon revocation on Stage E RPCs
      expect((await db.query(`SELECT has_function_privilege('authenticated', 'public.get_parent_portal_children()', 'EXECUTE') AS allowed;`)).rows[0].allowed).toBe(true);
      expect((await db.query(`SELECT has_function_privilege('anon', 'public.get_parent_portal_children()', 'EXECUTE') AS allowed;`)).rows[0].allowed).toBe(false);
      expect((await db.query(`SELECT has_function_privilege('authenticated', 'public.get_parent_child_details(uuid)', 'EXECUTE') AS allowed;`)).rows[0].allowed).toBe(true);
      expect((await db.query(`SELECT has_function_privilege('anon', 'public.get_parent_child_details(uuid)', 'EXECUTE') AS allowed;`)).rows[0].allowed).toBe(false);

      const adminId = '99999999-9999-4999-8999-000000000399';
      const teacherUserId = '11111111-1111-4111-8111-000000000311';
      const studentUser1 = '22222222-2222-4222-8222-000000000301';
      const parentUser1 = '33333333-3333-4333-8333-000000000301';
      const parentUser2 = '33333333-3333-4333-8333-000000000302';
      const unlinkedParentUser = '33333333-3333-4333-8333-000000000303';

      const teacherRec = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000311';
      const groupA = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000311';
      const student1Id = 'cccccccc-cccc-4ccc-8ccc-000000000301';
      const student2Id = 'cccccccc-cccc-4ccc-8ccc-000000000302'; // NO student user account (user_id NULL)

      const setAuth = (uid: string | null) => {
        if (!uid) {
          return db.exec(`SET ROLE anon; SET request.jwt.claim.role = 'anon'; SET request.jwt.claim.sub = '';`);
        }
        return db.exec(`SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${uid}';`);
      };
      const parseJson = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);

      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES
          ('${adminId}', 'admin_e@test.local'),
          ('${teacherUserId}', 't1_e@test.local'),
          ('${studentUser1}', 'stu1_e@test.local'),
          ('${parentUser1}', 'p1_e@test.local'),
          ('${parentUser2}', 'p2_e@test.local'),
          ('${unlinkedParentUser}', 'p3_e@test.local');

        INSERT INTO public.profiles (id, email, full_name, role) VALUES
          ('${adminId}', 'admin_e@test.local', 'Admin E', 'admin'),
          ('${teacherUserId}', 't1_e@test.local', 'Teacher Author E', 'teacher'),
          ('${studentUser1}', 'stu1_e@test.local', 'Sara Ali Account', 'student'),
          ('${parentUser1}', 'p1_e@test.local', 'Parent One', 'parent'),
          ('${parentUser2}', 'p2_e@test.local', 'Parent Two', 'parent'),
          ('${unlinkedParentUser}', 'p3_e@test.local', 'Unlinked Parent', 'parent');
      `);

      await setAuth(adminId);
      await db.exec(`
        INSERT INTO public.teachers (id, full_name, subject, email) VALUES
          ('${teacherRec}', 'Ms. Nadia', 'Mathematics', 'nadia_e@test.local');
        SELECT public.link_teacher_account('${teacherRec}', '${teacherUserId}');

        INSERT INTO public.groups (id, name, grade_level, teacher_id, capacity) VALUES
          ('${groupA}', 'Group E-Math', 'Grade 10', '${teacherRec}', 30);

        -- Two children sharing identical full_name "Sara Ali" with distinct student_codes; student2 has NO student login account
        INSERT INTO public.students (id, full_name, student_code, group_id, grade_level, qr_code_hash, parent_name, parent_phone, status) VALUES
          ('${student1Id}', 'Sara Ali', 'ET-E-101', '${groupA}', 'Grade 10', 'SECRET-QR-E101', 'Mr Ali Guardian', '+201009998888', 'active'),
          ('${student2Id}', 'Sara Ali', 'ET-E-102', '${groupA}', 'Grade 10', 'SECRET-QR-E102', 'Mr Ali Guardian', '+201009998889', 'active');

        SELECT public.link_student_account('${student1Id}', '${studentUser1}');
        -- Parent 1 linked to BOTH children; Parent 2 linked ONLY to shared student1Id
        SELECT public.link_parent_student('${parentUser1}', '${student1Id}');
        SELECT public.link_parent_student('${parentUser1}', '${student2Id}');
        SELECT public.link_parent_student('${parentUser2}', '${student1Id}');
      `);

      const todayCairo = (await db.query(`SELECT ((NOW() AT TIME ZONE 'Africa/Cairo')::DATE)::TEXT AS today;`)).rows[0].today;

      // Record attendance via QR scan, 18/20 grade, and TWO notes (one parent-visible, one internal)
      await setAuth(adminId);
      const qrScan = parseJson(
        (await db.query(`SELECT public.record_qr_attendance('SECRET-QR-E101', '${groupA}') AS res;`)).rows[0].res
      );
      expect(qrScan.code).toBe('RECORDED');

      await setAuth(teacherUserId);
      await db.query(
        `SELECT public.save_teacher_student_grade('${groupA}', '${student1Id}', 'Linear Algebra Quiz', 'quiz', 18, 20, '${todayCairo}', 'Internal teacher remark');`
      );
      await db.query(
        `SELECT public.save_teacher_student_note('${groupA}', '${student1Id}', 'Visible praise: Great progress in Algebra', true);`
      );
      await db.query(
        `SELECT public.save_teacher_student_note('${groupA}', '${student1Id}', 'Internal warning: Confidential staff observation', false);`
      );

      // 1. Parent 1 lists linked children (both same-name children including student2 without user account)
      await setAuth(parentUser1);
      const p1Children = parseJson((await db.query(`SELECT public.get_parent_portal_children() AS res;`)).rows[0].res);
      expect(p1Children.children).toHaveLength(2);
      expect(p1Children.children.map((c: { student_code: string }) => c.student_code)).toEqual(['ET-E-101', 'ET-E-102']);
      for (const child of p1Children.children) {
        expect(Object.keys(child).sort()).toEqual(['full_name', 'grade_level', 'group', 'id', 'status', 'student_code']);
      }
      expect(JSON.stringify(p1Children)).not.toContain('SECRET-QR-E101');
      expect(JSON.stringify(p1Children)).not.toContain('Mr Ali Guardian');
      expect(JSON.stringify(p1Children)).not.toContain('+201009998888');

      // Parent 1 reads shared child ET-E-101 -> sees attendance, 18/20 grade, ONLY parent-visible note
      const p1DetailsS1 = parseJson((await db.query(`SELECT public.get_parent_child_details('${student1Id}') AS res;`)).rows[0].res);
      expect(Object.keys(p1DetailsS1).sort()).toEqual(['attendance', 'child', 'grades', 'notes']);
      expect(p1DetailsS1.attendance).toHaveLength(1);
      expect(p1DetailsS1.attendance[0].status).toBe('Present');
      expect(Number(p1DetailsS1.grades[0].score)).toBe(18);
      expect(Number(p1DetailsS1.grades[0].max_score)).toBe(20);
      expect(p1DetailsS1.notes).toHaveLength(1);
      expect(p1DetailsS1.notes[0].author_name).toBe('Ms. Nadia');
      expect(p1DetailsS1.notes[0].feedback_text).toBe('Visible praise: Great progress in Algebra');
      expect(Object.keys(p1DetailsS1.notes[0]).sort()).toEqual(['author_name', 'created_at', 'feedback_text', 'id', 'note_date']);

      // Internal note, QR hash, and contact PII must NEVER appear in the raw database payload
      const p1RawJson = JSON.stringify(p1DetailsS1);
      expect(p1RawJson).not.toContain('Internal warning: Confidential staff observation');
      expect(p1RawJson).not.toContain('Internal teacher remark');
      expect(p1RawJson).not.toContain('SECRET-QR-E101');
      expect(p1RawJson).not.toContain('Mr Ali Guardian');
      expect(p1RawJson).not.toContain('+201009998888');

      // Parent 1 reads child ET-E-102 (which has NO students.user_id account) -> succeeds cleanly with []
      const p1DetailsS2 = parseJson((await db.query(`SELECT public.get_parent_child_details('${student2Id}') AS res;`)).rows[0].res);
      expect(p1DetailsS2.child.student_code).toBe('ET-E-102');
      expect(p1DetailsS2.attendance).toEqual([]);
      expect(p1DetailsS2.grades).toEqual([]);
      expect(p1DetailsS2.notes).toEqual([]);

      // 2. Parent 2 sees ONLY shared child ET-E-101 and CANNOT query unlinked child ET-E-102 even by exact UUID
      await setAuth(parentUser2);
      const p2Children = parseJson((await db.query(`SELECT public.get_parent_portal_children() AS res;`)).rows[0].res);
      expect(p2Children.children.map((c: { student_code: string }) => c.student_code)).toEqual(['ET-E-101']);

      const p2DetailsS1 = parseJson((await db.query(`SELECT public.get_parent_child_details('${student1Id}') AS res;`)).rows[0].res);
      expect(Number(p2DetailsS1.grades[0].score)).toBe(18);
      expect(p2DetailsS1.notes).toHaveLength(1);
      expect(JSON.stringify(p2DetailsS1)).not.toContain('Internal warning: Confidential staff observation');

      await expect(db.query(`SELECT public.get_parent_child_details('${student2Id}');`)).rejects.toThrow(/access denied/i);

      // 3. Unlinked parent returns empty children array cleanly and cannot query any child details
      await setAuth(unlinkedParentUser);
      const p3Children = parseJson((await db.query(`SELECT public.get_parent_portal_children() AS res;`)).rows[0].res);
      expect(p3Children).toEqual({ children: [] });
      await expect(db.query(`SELECT public.get_parent_child_details('${student1Id}');`)).rejects.toThrow(/access denied/i);

      // Direct table SELECT remains locked for parents (except their own links)
      expect((await db.query(`SELECT * FROM public.students;`)).rows).toHaveLength(0);
      expect((await db.query(`SELECT * FROM public.attendance;`)).rows).toHaveLength(0);
      expect((await db.query(`SELECT * FROM public.grades;`)).rows).toHaveLength(0);
      expect((await db.query(`SELECT * FROM public.teacher_notes;`)).rows).toHaveLength(0);

      // 4. Revoke shared link from Parent 1 -> Parent 1 loses access immediately while Parent 2 keeps access
      await setAuth(adminId);
      await db.query(`SELECT public.unlink_parent_student('${parentUser1}', '${student1Id}');`);

      await setAuth(parentUser1);
      await expect(db.query(`SELECT public.get_parent_child_details('${student1Id}');`)).rejects.toThrow(/not linked/i);
      const p1AfterUnlink = parseJson((await db.query(`SELECT public.get_parent_portal_children() AS res;`)).rows[0].res);
      expect(p1AfterUnlink.children.map((c: { student_code: string }) => c.student_code)).toEqual(['ET-E-102']);

      await setAuth(parentUser2);
      const p2AfterP1Unlink = parseJson((await db.query(`SELECT public.get_parent_child_details('${student1Id}') AS res;`)).rows[0].res);
      expect(p2AfterP1Unlink.child.student_code).toBe('ET-E-101');
      expect(p2AfterP1Unlink.notes).toHaveLength(1);

      // 5. Rejects non-parent roles (student, teacher, admin) and anon; Stage D Student Portal continues hiding ALL teacher notes
      for (const nonParent of [studentUser1, teacherUserId, adminId]) {
        await setAuth(nonParent);
        await expect(db.query(`SELECT public.get_parent_portal_children();`)).rejects.toThrow(/access denied/i);
        await expect(db.query(`SELECT public.get_parent_child_details('${student1Id}');`)).rejects.toThrow(/access denied/i);
      }
      await setAuth(null);
      await expect(db.query(`SELECT public.get_parent_portal_children();`)).rejects.toThrow(/permission denied/i);
      await expect(db.query(`SELECT public.get_parent_child_details('${student1Id}');`)).rejects.toThrow(/permission denied/i);

      // Student 1 sees 18/20 grade in Student Portal with zero notes (neither internal nor parent-visible)
      await setAuth(studentUser1);
      const studentOwnData = parseJson((await db.query(`SELECT public.get_student_portal_data() AS res;`)).rows[0].res);
      expect(Number(studentOwnData.grades[0].score)).toBe(18);
      expect(studentOwnData).not.toHaveProperty('notes');
      expect(JSON.stringify(studentOwnData)).not.toContain('Visible praise');
      expect(JSON.stringify(studentOwnData)).not.toContain('Internal warning');
    } finally {
      await db.close();
    }
  }, 30000);
});
