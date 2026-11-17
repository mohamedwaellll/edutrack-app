import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

describe('Real PostgreSQL Database Execution Tests (Isolated Engine)', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const schemaSql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261103_edutrack_schema.sql'), 'utf8');
  const upgradeSql = fs.readFileSync(path.join(rootDir, 'supabase/migrations/20261117_edutrack_admin_auth_upgrade.sql'), 'utf8');
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

  async function grantStandardPermissions(db: PGlite) {
    await db.exec(`
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
      GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
      GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;
    `);
  }

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

  it('4. Ordinary users cannot assign themselves a privileged role (Anti-Self-Elevation)', async () => {
    const db = await createTestDatabase();
    await db.exec(schemaSql);
    await grantStandardPermissions(db);

    const studentId = '77777777-7777-4777-8777-777777777777';
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES ('${studentId}', 'attacker@edutrack.com');
      INSERT INTO public.profiles (id, email, full_name, role) VALUES ('${studentId}', 'attacker@edutrack.com', 'Attacker', 'student');
    `);

    // Authenticated non-admin context
    await db.exec(`
      SET ROLE authenticated;
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${studentId}';
    `);

    // Attempt 1: UPDATE own profile to 'admin'
    let updateFailed = false;
    try {
      await db.exec(`UPDATE public.profiles SET role = 'admin' WHERE id = '${studentId}';`);
    } catch (err: any) {
      updateFailed = true;
      expect(err.message).toContain('Unauthorized: Only administrators can modify user roles');
    }
    expect(updateFailed).toBe(true);

    // Attempt 2: INSERT a new profile directly as 'admin'
    let insertAdminFailed = false;
    try {
      await db.exec(`
        INSERT INTO public.profiles (id, email, full_name, role)
        VALUES ('${studentId}', 'attacker@edutrack.com', 'Fake Admin', 'admin');
      `);
    } catch (err: any) {
      insertAdminFailed = true;
    }
    expect(insertAdminFailed).toBe(true);

    // Attempt 3: Call provision_admin directly
    let callProcFailed = false;
    try {
      await db.query(`SELECT * FROM public.provision_admin('${studentId}');`);
    } catch (err: any) {
      callProcFailed = true;
      expect(err.message).toMatch(/(permission denied|Unauthorized)/i);
    }
    expect(callProcFailed).toBe(true);
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

  it('6. Non-destructive upgrade path: preserves existing records and replaces permissive USING (true)', async () => {
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
    await grantStandardPermissions(db);

    // 4. Verify pre-existing data is preserved
    const preservedGroup = await db.query(`SELECT name FROM public.groups WHERE id = '99999999-0000-4000-8000-000000000000';`);
    expect(preservedGroup.rows.length).toBe(1);
    expect(preservedGroup.rows[0].name).toBe('Pre-existing Group');

    // 5. Verify permissive access was removed and strict RLS is enforced
    await db.exec(`
      SET ROLE authenticated;
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${legacyStudentId}';
    `);

    // Student should now be BLOCKED from reading groups (previously allowed under USING true)
    const groupsBlocked = await db.query(`SELECT * FROM public.groups;`);
    expect(groupsBlocked.rows.length).toBe(0);

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
});
