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
    } catch (err: any) {
      missingClaimUpdateFailed = true;
      expect(err.message).toContain('Unauthorized: Only administrators can modify user roles');
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
    } catch (err: any) {
      emptyClaimUpdateFailed = true;
      expect(err.message).toContain('Unauthorized: Only administrators can modify user roles');
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
    } catch (err: any) {
      jsonClaimsStudentFailed = true;
      expect(err.message).toContain('Unauthorized: Only administrators can modify user roles');
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
    } catch (err: any) {
      upsertFailed = true;
      expect(err.message).toMatch(/Unauthorized: Only administrators can (assign the admin role|modify user roles)/);
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
    } catch (err: any) {
      anonExecuteFailed = true;
      expect(err.message).toMatch(/(permission denied|Unauthorized)/i);
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
    } catch (err: any) {
      studentExecuteFailed = true;
      expect(err.message).toMatch(/(permission denied|Unauthorized)/i);
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
    } catch (err: any) {
      adminUserExecuteFailed = true;
      expect(err.message).toMatch(/(permission denied|Unauthorized)/i);
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
    } catch (err: any) {
      studentUpgradeSelfPromoteFailed = true;
      expect(err.message).toContain('Unauthorized: Only administrators can modify user roles');
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
    } catch (err: any) {
      invalidGroupFailed = true;
      expect(err.message).toContain('Student does not belong to the specified group');
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
    let anonReadBlocked = false;
    try {
      const anonAttendanceRead = await db.query(`SELECT * FROM public.attendance;`);
      expect(anonAttendanceRead.rows.length).toBe(0);
      anonReadBlocked = true;
    } catch (err: any) {
      anonReadBlocked = true;
      expect(err.message).toMatch(/(permission denied|violates row-level security)/i);
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

    const cJson1 = concurrentRes1.rows[0].res as any;
    const cJson2 = concurrentRes2.rows[0].res as any;

    // One must be RECORDED, the other must be ALREADY_RECORDED (no unhandled unique_violation!)
    const codes = [cJson1.code, cJson2.code].sort();
    expect(codes).toEqual(['ALREADY_RECORDED', 'RECORDED']);
    expect(cJson1.success).toBe(true);
    expect(cJson2.success).toBe(true);

    // Verify arrival times agree and exactly 1 attendance row was written
    const arrivalTime1 = cJson1.attendance.check_in_time;
    const arrivalTime2 = cJson2.attendance.check_in_time;
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
    expect((nullGroupRes.rows[0].res as any).code).toBe('GROUP_REQUIRED');

    // Rejects unassigned student
    const unassignedRes = await db.query(`
      SELECT public.record_qr_attendance('QR-UNASSIGNED-004', '${groupIdA}') as res;
    `);
    expect((unassignedRes.rows[0].res as any).code).toBe('STUDENT_UNASSIGNED');

    // Rejects group mismatch
    const mismatchRes = await db.query(`
      SELECT public.record_qr_attendance('QR-KAREEM-002', '${groupIdA}') as res;
    `);
    expect((mismatchRes.rows[0].res as any).code).toBe('GROUP_MISMATCH');

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
    expect((histMismatchRes.rows[0].res as any).code).toMatch(/(GROUP_MISMATCH|HISTORICAL_GROUP_MISMATCH)/);

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
    } catch (err: any) {
      anonCallBlocked = true;
      expect(err.message).toMatch(/(permission denied|privilege)/i);
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
    } catch (err: any) {
      nonAdminCallBlocked = true;
      expect(err.message).toContain('Unauthorized');
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

    // 1. Apply full migration chain
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
    ]) {
      await db.exec(sql);
    }

    // Test idempotency: re-applying teacherManagementSql must not fail
    await db.exec(teacherManagementSql);

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

    // --- A. Privilege Verification on Minimal Production Grants ---
    const authTeachersSelect = await db.query(`SELECT has_table_privilege('authenticated', 'public.teachers', 'SELECT') as priv;`);
    const authTeachersInsert = await db.query(`SELECT has_table_privilege('authenticated', 'public.teachers', 'INSERT') as priv;`);
    const authTeachersReferences = await db.query(`SELECT has_table_privilege('authenticated', 'public.teachers', 'REFERENCES') as priv;`);
    const authGroupsUpdate = await db.query(`SELECT has_table_privilege('authenticated', 'public.groups', 'UPDATE') as priv;`);

    expect(authTeachersSelect.rows[0].priv).toBe(true);
    expect(authTeachersInsert.rows[0].priv).toBe(true);
    expect(authTeachersReferences.rows[0].priv).toBe(true);
    expect(authGroupsUpdate.rows[0].priv).toBe(true);

    const anonTeachersInsert = await db.query(`SELECT has_table_privilege('anon', 'public.teachers', 'INSERT') as priv;`);
    const anonGroupsUpdate = await db.query(`SELECT has_table_privilege('anon', 'public.groups', 'UPDATE') as priv;`);
    expect(anonTeachersInsert.rows[0].priv).toBe(false);
    expect(anonGroupsUpdate.rows[0].priv).toBe(false);

    // --- B. Admin Teacher Creation ---
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
    // Email forced to lower and trim by trigger
    expect(newTeacher.email).toBe('tamer.samir@edutrack.edu');
    expect(newTeacher.phone).toBe('+201012345678');
    expect(newTeacher.user_id).toBeNull();

    // 2. Enforces case-insensitive email uniqueness (functional unique index)
    await expect(db.query(`
      INSERT INTO public.teachers (full_name, subject, email)
      VALUES ('Another Teacher', 'Physics', 'tamer.samir@edutrack.edu');
    `)).rejects.toThrow();

    await expect(db.query(`
      INSERT INTO public.teachers (full_name, subject, email)
      VALUES ('Another Teacher', 'Physics', '  TAMER.SAMIR@EDUTRACK.EDU  ');
    `)).rejects.toThrow();

    // 3. Validation trigger rejects missing or invalid fields
    await expect(db.query(`
      INSERT INTO public.teachers (full_name, subject, email)
      VALUES ('', 'Physics', 'valid@edutrack.edu');
    `)).rejects.toThrow('Teacher full name is required');

    await expect(db.query(`
      INSERT INTO public.teachers (full_name, subject, email)
      VALUES ('Valid Name', '', 'valid@edutrack.edu');
    `)).rejects.toThrow('Teacher subject is required');

    await expect(db.query(`
      INSERT INTO public.teachers (full_name, subject, email)
      VALUES ('Valid Name', 'Physics', 'invalid-email');
    `)).rejects.toThrow('valid email');

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

    // --- D. Group Assignment by Admin ---
    await setRole('authenticated', adminUserId);

    const targetGroupId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const targetTeacherId = newTeacher.id;

    // 1. Assign teacher to group
    const assignRes = await db.query(`
      UPDATE public.groups
      SET teacher_id = '${targetTeacherId}'
      WHERE id = '${targetGroupId}'
      RETURNING id, name, teacher_id;
    `);
    expect(assignRes.rows.length).toBe(1);
    expect(assignRes.rows[0].teacher_id).toBe(targetTeacherId);

    // Verify relation and teacher's assigned groups
    const teacherGroupsRes = await db.query(`
      SELECT g.id, g.name, t.full_name as teacher_name
      FROM public.groups g
      JOIN public.teachers t ON g.teacher_id = t.id
      WHERE t.id = '${targetTeacherId}';
    `);
    expect(teacherGroupsRes.rows.length).toBe(1);
    expect(teacherGroupsRes.rows[0].teacher_name).toBe('Dr. Tamer Samir');

    // 2. Change assigned teacher to an existing seed teacher
    const seedTeacherId = '11111111-1111-4111-8111-111111111111';
    const changeRes = await db.query(`
      UPDATE public.groups
      SET teacher_id = '${seedTeacherId}'
      WHERE id = '${targetGroupId}'
      RETURNING id, teacher_id;
    `);
    expect(changeRes.rows[0].teacher_id).toBe(seedTeacherId);

    // 3. Unassign teacher (set teacher_id to NULL)
    const unassignRes = await db.query(`
      UPDATE public.groups
      SET teacher_id = NULL
      WHERE id = '${targetGroupId}'
      RETURNING id, teacher_id;
    `);
    expect(unassignRes.rows[0].teacher_id).toBeNull();

    // 4. Reject invalid foreign key UUID
    const fakeTeacherId = '00000000-0000-4000-8000-000000000000';
    await expect(db.query(`
      UPDATE public.groups
      SET teacher_id = '${fakeTeacherId}'
      WHERE id = '${targetGroupId}';
    `)).rejects.toThrow();

    // --- E. Verify Group Assignment Modification Does NOT Mutate Attendance, Grades, or Roster ---
    const studentCheck = await db.query(`
      SELECT count(*) as count FROM public.students WHERE group_id = '${targetGroupId}';
    `);
    expect(Number(studentCheck.rows[0].count)).toBeGreaterThan(0);

    // Reassign teacher to seedTeacherId
    await db.query(`
      UPDATE public.groups SET teacher_id = '${seedTeacherId}' WHERE id = '${targetGroupId}';
    `);

    const gradesCheck = await db.query(`
      SELECT count(*) as count FROM public.grades WHERE group_id = '${targetGroupId}';
    `);
    expect(Number(gradesCheck.rows[0].count)).toBeGreaterThan(0);

    const notesCheck = await db.query(`
      SELECT teacher_id FROM public.teacher_notes LIMIT 1;
    `);
    expect(notesCheck.rows[0].teacher_id).toBe(seedTeacherId);

    // --- F. Non-Admin Blocked From Updating Group Teacher ---
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
});
