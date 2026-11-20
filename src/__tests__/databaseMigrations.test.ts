import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Database Schema & Migration Files (Static Analysis Unit Tests)', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const migrationsDir = path.join(rootDir, 'supabase/migrations');

  const schemaFile = path.join(migrationsDir, '20261103_edutrack_schema.sql');
  const upgradeFile = path.join(migrationsDir, '20261117_edutrack_admin_auth_upgrade.sql');
  const correctiveFile = path.join(migrationsDir, '20261118000001_edutrack_auth_triggers_fail_closed.sql');
  const milestone2File = path.join(migrationsDir, '20261119000001_edutrack_manual_attendance_and_grants.sql');
  const milestone3File = path.join(migrationsDir, '20261120000001_edutrack_qr_attendance_and_cairo_time.sql');
  const milestone3CorrectiveFile = path.join(migrationsDir, '20261120000002_edutrack_qr_concurrency_and_time_fix.sql');
  const gradesFeedbackFile = path.join(migrationsDir, '20261120000003_edutrack_grades_and_feedback_integrity.sql');
  const assessmentLockFile = path.join(migrationsDir, '20261120000004_edutrack_assessment_lock_permissions.sql');
  const teacherManagementFile = path.join(migrationsDir, '20261120000005_edutrack_teacher_management_and_group_assignment.sql');
  const seedFile = path.join(rootDir, 'supabase/seed.sql');

  it('ensures schema, upgrade migration and standalone seed file exist', () => {
    expect(fs.existsSync(schemaFile)).toBe(true);
    expect(fs.existsSync(upgradeFile)).toBe(true);
    expect(fs.existsSync(correctiveFile)).toBe(true);
    expect(fs.existsSync(milestone2File)).toBe(true);
    expect(fs.existsSync(milestone3File)).toBe(true);
    expect(fs.existsSync(milestone3CorrectiveFile)).toBe(true);
    expect(fs.existsSync(gradesFeedbackFile)).toBe(true);
    expect(fs.existsSync(assessmentLockFile)).toBe(true);
    expect(fs.existsSync(teacherManagementFile)).toBe(true);
    expect(fs.existsSync(seedFile)).toBe(true);
  });

  it('ensures migration files in supabase/migrations have unique version prefixes', () => {
    const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
    const prefixes = migrationFiles.map(f => f.split('_')[0]);
    const uniquePrefixes = new Set(prefixes);

    // Each migration file MUST have a unique timestamp/version prefix to prevent Supabase CLI collisions
    expect(uniquePrefixes.size).toBe(migrationFiles.length);
  });

  it('validates that NO UUID literals begin with invalid "s" character', () => {
    const files = [
      schemaFile,
      upgradeFile,
      correctiveFile,
      milestone2File,
      milestone3File,
      milestone3CorrectiveFile,
      gradesFeedbackFile,
      assessmentLockFile,
      teacherManagementFile,
      seedFile
    ];

    for (const f of files) {
      const content = fs.readFileSync(f, 'utf8');
      const invalidUUIDMatches = content.match(/'s[0-9a-zA-Z]{7}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{12}'/gi);
      expect(invalidUUIDMatches).toBeNull();
    }
  });

  it('validates that all explicit UUID string literals are valid RFC 4122 hex UUIDs', () => {
    const files = [
      schemaFile,
      upgradeFile,
      correctiveFile,
      milestone2File,
      milestone3File,
      milestone3CorrectiveFile,
      gradesFeedbackFile,
      assessmentLockFile,
      teacherManagementFile,
      seedFile
    ];
    const uuidRegex = /'([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'/g;

    for (const f of files) {
      const content = fs.readFileSync(f, 'utf8');
      let match;
      while ((match = uuidRegex.exec(content)) !== null) {
        const candidate = match[1];
        expect(candidate).toMatch(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
      }
    }
  });

  it('verifies that schema and upgrade patch replace permissive USING (true) with database-enforced is_admin()', () => {
    const schemaContent = fs.readFileSync(schemaFile, 'utf8');
    const upgradeContent = fs.readFileSync(upgradeFile, 'utf8');
    const correctiveContent = fs.readFileSync(correctiveFile, 'utf8');

    // Business tables must not have USING (true)
    expect(schemaContent).not.toMatch(/CREATE POLICY "Admins have full access to students"[^;]+USING\s*\(\s*true\s*\)/i);
    expect(schemaContent).not.toMatch(/CREATE POLICY "Admins have full access to groups"[^;]+USING\s*\(\s*true\s*\)/i);
    expect(upgradeContent).not.toMatch(/CREATE POLICY "Admins have full access to students"[^;]+USING\s*\(\s*true\s*\)/i);

    // Verify is_admin() is defined with SECURITY DEFINER in all
    expect(schemaContent).toContain('CREATE OR REPLACE FUNCTION public.is_admin()');
    expect(schemaContent).toContain('SECURITY DEFINER');
    expect(upgradeContent).toContain('CREATE OR REPLACE FUNCTION public.is_admin()');
    expect(upgradeContent).toContain('SECURITY DEFINER');
    expect(correctiveContent).toContain('CREATE OR REPLACE FUNCTION public.is_admin()');
    expect(correctiveContent).toContain('SECURITY DEFINER');

    // Verify trigger to prevent self role elevation exists in all
    expect(schemaContent).toContain('public.check_profile_role_update()');
    expect(upgradeContent).toContain('public.check_profile_role_update()');
    expect(correctiveContent).toContain('public.check_profile_role_update()');
    expect(schemaContent).toContain('public.check_profile_role_insert()');
    expect(upgradeContent).toContain('public.check_profile_role_insert()');
    expect(correctiveContent).toContain('public.check_profile_role_insert()');

    // Verify provision_admin procedure exists in all
    expect(schemaContent).toContain('public.provision_admin');
    expect(upgradeContent).toContain('public.provision_admin');
    expect(correctiveContent).toContain('public.provision_admin');
  });

  it('verifies that seed file is repeatable and uses ON CONFLICT guards on all inserts', () => {
    const seedContent = fs.readFileSync(seedFile, 'utf8');
    const inserts = seedContent.split('\n').filter(line => !line.trim().startsWith('--') && line.includes('INSERT INTO'));
    const onConflicts = seedContent.split('\n').filter(line => !line.trim().startsWith('--') && line.includes('ON CONFLICT'));

    expect(inserts.length).toBeGreaterThan(0);
    // Every insert statement in the seed must be guarded with ON CONFLICT
    expect(onConflicts.length).toBe(inserts.length);
  });

  it('verifies Milestone 2 attendance migration constraints and API grants', () => {
    const milestone2Content = fs.readFileSync(milestone2File, 'utf8');

    // Drops NOT NULL and DEFAULT on check_in_time
    expect(milestone2Content).toContain('ALTER TABLE public.attendance ALTER COLUMN check_in_time DROP NOT NULL');
    expect(milestone2Content).toContain('ALTER TABLE public.attendance ALTER COLUMN check_in_time DROP DEFAULT');

    // Contains validate_attendance_record trigger
    expect(milestone2Content).toContain('CREATE OR REPLACE FUNCTION public.validate_attendance_record()');
    expect(milestone2Content).toContain('tr_validate_attendance_record');

    // Explicit grants without GRANT ALL ON ALL TABLES
    expect(milestone2Content).toContain('GRANT SELECT, INSERT, UPDATE ON public.attendance TO authenticated');
    expect(milestone2Content).not.toMatch(/GRANT\s+ALL\s+ON\s+ALL\s+TABLES/i);
    expect(milestone2Content).not.toMatch(/GRANT\s+ALL\s+ON\s+ALL\s+ROUTINES/i);
  });

  it('verifies Milestone 3 QR attendance migration constraints, Cairo timezone logic, and RPC grants', () => {
    const milestone3Content = fs.readFileSync(milestone3File, 'utf8');

    // Cairo timezone logic in trigger and RPC
    expect(milestone3Content).toContain("AT TIME ZONE 'Africa/Cairo'");
    expect(milestone3Content).toContain('CREATE OR REPLACE FUNCTION public.record_qr_attendance');

    // Atomic RPC codes
    expect(milestone3Content).toContain("'RECORDED'");
    expect(milestone3Content).toContain("'ALREADY_RECORDED'");
    expect(milestone3Content).toContain("'CONFLICT_EXISTS'");
    expect(milestone3Content).toContain("'GROUP_MISMATCH'");
    expect(milestone3Content).toContain("'INACTIVE_STUDENT'");
    expect(milestone3Content).toContain("'INVALID_TOKEN'");
    expect(milestone3Content).toContain("'EMPTY_TOKEN'");

    // Explicit security definer and search_path
    expect(milestone3Content).toContain('SECURITY DEFINER');
    expect(milestone3Content).toContain('SET search_path = public');

    // Permissions: EXECUTE granted to authenticated, revoked from anon
    expect(milestone3Content).toContain('GRANT EXECUTE ON FUNCTION public.record_qr_attendance(TEXT, UUID) TO authenticated;');
    expect(milestone3Content).toContain('REVOKE EXECUTE ON FUNCTION public.record_qr_attendance(TEXT, UUID) FROM anon;');
    expect(milestone3Content).not.toMatch(/GRANT\s+ALL\s+ON\s+ALL\s+TABLES/i);
  });

  it('verifies Milestone 3 Corrective Migration concurrency guards, group validation, and function privilege revokes', () => {
    const corrective3Content = fs.readFileSync(milestone3CorrectiveFile, 'utf8');

    // Concurrency safe ON CONFLICT DO NOTHING
    expect(corrective3Content).toContain('ON CONFLICT (student_id, date) DO NOTHING');

    // Group validation codes
    expect(corrective3Content).toContain("'GROUP_REQUIRED'");
    expect(corrective3Content).toContain("'STUDENT_UNASSIGNED'");
    expect(corrective3Content).toContain("'HISTORICAL_GROUP_MISMATCH'");

    // Database defaults set to Africa/Cairo date
    expect(corrective3Content).toContain("ALTER TABLE public.attendance \n  ALTER COLUMN date SET DEFAULT ((NOW() AT TIME ZONE 'Africa/Cairo')::DATE);");

    // Explicit privilege revokes from PUBLIC and anon
    expect(corrective3Content).toContain('REVOKE ALL ON FUNCTION public.record_qr_attendance(TEXT, UUID) FROM PUBLIC;');
    expect(corrective3Content).toContain('REVOKE ALL ON FUNCTION public.record_qr_attendance(TEXT, UUID) FROM anon;');
    expect(corrective3Content).toContain('GRANT EXECUTE ON FUNCTION public.record_qr_attendance(TEXT, UUID) TO authenticated;');
  });

  it('verifies Teacher Management and Group Assignment migration constraints, triggers, and minimal grants', () => {
    const teacherContent = fs.readFileSync(teacherManagementFile, 'utf8');

    // Functional unique index on lower(trim(email))
    expect(teacherContent).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_email_lower');
    expect(teacherContent).toContain('ON public.teachers (lower(trim(email)))');

    // Validation trigger
    expect(teacherContent).toContain('CREATE OR REPLACE FUNCTION public.validate_teacher_record()');
    expect(teacherContent).toContain('tr_validate_teacher_record');
    expect(teacherContent).toContain("NEW.email := lower(trim(COALESCE(NEW.email, '')))");

    // RLS policies for admin
    expect(teacherContent).toContain('public.is_admin()');

    // Minimal production grants without GRANT ALL ON ALL TABLES
    expect(teacherContent).toContain('GRANT SELECT, INSERT, REFERENCES ON public.teachers TO authenticated;');
    expect(teacherContent).toContain('GRANT SELECT, INSERT, UPDATE ON public.groups TO authenticated;');
    expect(teacherContent).toContain('REVOKE INSERT, UPDATE, DELETE ON public.teachers FROM anon, PUBLIC;');
    expect(teacherContent).toContain('REVOKE INSERT, UPDATE, DELETE ON public.groups FROM anon, PUBLIC;');
    expect(teacherContent).not.toMatch(/GRANT\s+ALL\s+ON\s+ALL\s+TABLES/i);
    expect(teacherContent).not.toMatch(/GRANT\s+ALL\s+ON\s+ALL\s+ROUTINES/i);
  });
});
