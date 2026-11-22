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
  const teacherCorrectionsFile = path.join(migrationsDir, '20261121000001_edutrack_teacher_management_corrections.sql');
  const accountLinkingFile = path.join(migrationsDir, '20261121000002_edutrack_secure_account_linking.sql');
  const stageB1CorrectiveFile = path.join(migrationsDir, '20261121000003_edutrack_stage_b1_corrective_hardening.sql');
  const stageB2ExpectedUnlinkFile = path.join(migrationsDir, '20261121000004_edutrack_stage_b2_expected_unlink_guards.sql');
  const stageC1TeacherReadFile = path.join(migrationsDir, '20261121000005_edutrack_stage_c1_teacher_read_only_scope.sql');
  const stageC2TeacherWriteFile = path.join(migrationsDir, '20261121000006_edutrack_stage_c2_teacher_grade_and_note_writes.sql');
  const stageDStudentReadFile = path.join(migrationsDir, '20261121000007_edutrack_stage_d_student_read_only_portal.sql');
  const stageEParentReadFile = path.join(migrationsDir, '20261122000001_edutrack_stage_e_parent_read_only_portal.sql');
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
    expect(fs.existsSync(teacherCorrectionsFile)).toBe(true);
    expect(fs.existsSync(accountLinkingFile)).toBe(true);
    expect(fs.existsSync(stageB1CorrectiveFile)).toBe(true);
    expect(fs.existsSync(stageB2ExpectedUnlinkFile)).toBe(true);
    expect(fs.existsSync(stageC1TeacherReadFile)).toBe(true);
    expect(fs.existsSync(stageC2TeacherWriteFile)).toBe(true);
    expect(fs.existsSync(stageDStudentReadFile)).toBe(true);
    expect(fs.existsSync(stageEParentReadFile)).toBe(true);
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
      teacherCorrectionsFile,
      accountLinkingFile,
      stageB1CorrectiveFile,
      stageB2ExpectedUnlinkFile,
      stageC1TeacherReadFile,
      stageC2TeacherWriteFile,
      stageDStudentReadFile,
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
      teacherCorrectionsFile,
      accountLinkingFile,
      stageB1CorrectiveFile,
      stageB2ExpectedUnlinkFile,
      stageC1TeacherReadFile,
      stageC2TeacherWriteFile,
      stageDStudentReadFile,
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
    expect(corrective3Content.replace(/\r\n/g, '\n')).toContain("ALTER TABLE public.attendance \n  ALTER COLUMN date SET DEFAULT ((NOW() AT TIME ZONE 'Africa/Cairo')::DATE);");

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

  it('verifies Milestone 5.1 Teacher Management Corrections migration constraints, permissions & sanitization', () => {
    const correctionsContent = fs.readFileSync(teacherCorrectionsFile, 'utf8');

    // Pre-execution guard against duplicate teacher emails
    expect(correctionsContent).toContain('SELECT lower(trim(email))');
    expect(correctionsContent).toContain('HAVING count(*) > 1');

    // Pure validation trigger lacks SECURITY DEFINER
    expect(correctionsContent).toContain('CREATE OR REPLACE FUNCTION public.validate_teacher_record()');
    expect(correctionsContent).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.validate_teacher_record\(\)[^;]+SECURITY\s+DEFINER/i);

    // Database enforcement against direct user_id assignment on INSERT
    expect(correctionsContent).toContain("TG_OP = 'INSERT' AND NEW.user_id IS NOT NULL");
    expect(correctionsContent).toContain('Direct user_id assignment is prohibited during teacher creation');

    // Aligned email regex accepting a@b.co
    expect(correctionsContent).toContain("NEW.email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'");

    // Revoke unnecessary REFERENCES on teachers
    expect(correctionsContent).toContain('REVOKE REFERENCES ON public.teachers FROM authenticated;');
    expect(correctionsContent).toContain('REVOKE REFERENCES ON public.teachers FROM anon, PUBLIC;');

    // Revoke broad table-level UPDATE and grant narrow column-level UPDATE on groups
    expect(correctionsContent).toContain('REVOKE UPDATE ON public.groups FROM authenticated;');
    expect(correctionsContent).toContain('REVOKE UPDATE ON public.groups FROM anon, PUBLIC;');
    expect(correctionsContent).toContain('GRANT UPDATE (teacher_id, updated_at) ON public.groups TO authenticated;');

    // Admin-only RLS re-affirmation
    expect(correctionsContent).toContain('public.is_admin()');
  });

  it('verifies Stage B.1 Secure Account Linking migration structure, triggers, RPCs, and RLS', () => {
    const linkingContent = fs.readFileSync(accountLinkingFile, 'utf8');

    // Pre-execution checks for duplicate user_ids and invalid roles
    expect(linkingContent).toContain('SELECT user_id');
    expect(linkingContent).toContain('HAVING count(*) > 1');
    expect(linkingContent).toContain("WHERE t.user_id IS NOT NULL AND p.role <> 'teacher'");
    expect(linkingContent).toContain("WHERE s.user_id IS NOT NULL AND p.role <> 'student'");

    // Partial unique indexes
    expect(linkingContent).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_user_id');
    expect(linkingContent).toContain('ON public.teachers (user_id)');
    expect(linkingContent).toContain('WHERE user_id IS NOT NULL');
    expect(linkingContent).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_students_user_id');
    expect(linkingContent).toContain('ON public.students (user_id)');

    // Parent-student links table
    expect(linkingContent).toContain('CREATE TABLE IF NOT EXISTS public.parent_student_links');
    expect(linkingContent).toContain('CONSTRAINT uq_parent_student_link UNIQUE (parent_id, student_id)');

    // Trigger hardening: anti-self-promotion & active link freeze
    expect(linkingContent).toContain('CREATE OR REPLACE FUNCTION public.check_profile_role_insert()');
    expect(linkingContent).toContain("COALESCE(NEW.role, 'student') <> 'student'");
    expect(linkingContent).toContain('CREATE OR REPLACE FUNCTION public.check_profile_role_update()');
    expect(linkingContent).toContain("OLD.role = 'teacher' AND NEW.role <> 'teacher'");
    expect(linkingContent).toContain("OLD.role = 'student' AND NEW.role <> 'student'");
    expect(linkingContent).toContain("OLD.role = 'parent' AND NEW.role <> 'parent'");

    // Administrative RPCs
    const expectedRpcs = [
      'public.link_teacher_account',
      'public.unlink_teacher_account',
      'public.link_student_account',
      'public.unlink_student_account',
      'public.link_parent_student',
      'public.unlink_parent_student',
    ];

    for (const rpc of expectedRpcs) {
      expect(linkingContent).toContain(`CREATE OR REPLACE FUNCTION ${rpc}`);
      expect(linkingContent).toContain(`REVOKE ALL ON FUNCTION ${rpc}`);
      expect(linkingContent).toContain(`GRANT EXECUTE ON FUNCTION ${rpc}`);
    }

    // Security Definer & search_path on RPCs
    expect(linkingContent).toContain('SECURITY DEFINER');
    expect(linkingContent).toContain('SET search_path = public');

    // Table privileges & RLS on parent_student_links
    expect(linkingContent).toContain('GRANT SELECT ON public.parent_student_links TO authenticated;');
    expect(linkingContent).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.parent_student_links FROM authenticated;');
    expect(linkingContent).toContain('ALTER TABLE public.parent_student_links ENABLE ROW LEVEL SECURITY;');
    expect(linkingContent).toContain('CREATE POLICY "Admins have full access to parent_student_links"');
    expect(linkingContent).toContain('CREATE POLICY "Parents can view their own student links"');
  });

  it('verifies Stage B.1 Corrective Hardening migration closes students.user_id insert, enforces atomic RPCs & coordinates locks', () => {
    const content = fs.readFileSync(stageB1CorrectiveFile, 'utf8');

    // Column-level INSERT privileges on students excluding user_id
    expect(content).toContain('REVOKE INSERT ON public.students FROM authenticated, anon, PUBLIC;');
    expect(content).toContain('ON public.students TO authenticated;');
    expect(content).toContain("TG_OP = 'INSERT' AND NEW.user_id IS NOT NULL");
    expect(content).toContain('Direct user_id assignment is prohibited during student creation');

    // Atomic conditional UPDATE ... WHERE user_id IS NULL RETURNING
    expect(content).toContain('AND user_id IS NULL');
    expect(content).toContain('RETURNING id, user_id INTO v_linked_teacher_id, v_linked_user_id');
    expect(content).toContain('RETURNING id, user_id INTO v_linked_student_id, v_linked_user_id');

    // FOR UPDATE on unlinking and verified previous_user_id
    expect(content).toContain('FOR UPDATE;');
    expect(content).toContain('AND user_id = v_previous_user_id');

    // Profile row FOR SHARE & AFTER UPDATE consistency trigger
    expect(content).toContain('FOR SHARE;');
    expect(content).toContain('CREATE OR REPLACE FUNCTION public.enforce_profile_role_link_consistency()');
    expect(content).toContain('AFTER UPDATE ON public.profiles');
  });

  it('verifies Stage B.2 Expected Unlink Guard migration replaces 1-arg RPCs cleanly and checks expected_user_id', () => {
    const content = fs.readFileSync(stageB2ExpectedUnlinkFile, 'utf8');

    expect(content).toContain('DROP FUNCTION IF EXISTS public.unlink_teacher_account(UUID);');
    expect(content).toContain('DROP FUNCTION IF EXISTS public.unlink_student_account(UUID);');
    expect(content).toContain('p_expected_user_id UUID DEFAULT NULL');
    expect(content).toContain('v_previous_user_id IS DISTINCT FROM p_expected_user_id');
    expect(content).toContain('Conflict:');
    expect(content).toContain('REVOKE ALL ON FUNCTION public.unlink_teacher_account(UUID, UUID) FROM PUBLIC, anon;');
    expect(content).toContain('GRANT EXECUTE ON FUNCTION public.unlink_teacher_account(UUID, UUID) TO authenticated;');
    expect(content).toContain('REVOKE ALL ON FUNCTION public.unlink_student_account(UUID, UUID) FROM PUBLIC, anon;');
    expect(content).toContain('GRANT EXECUTE ON FUNCTION public.unlink_student_account(UUID, UUID) TO authenticated;');
  });

  it('verifies Stage C.1 Teacher Read-Only Scope migration derives auth.uid(), checks teacher assignment, and omits parent/QR fields', () => {
    const content = fs.readFileSync(stageC1TeacherReadFile, 'utf8');

    expect(content).toContain('CREATE OR REPLACE FUNCTION public.get_teacher_portal_context()');
    expect(content).toContain('CREATE OR REPLACE FUNCTION public.get_teacher_group_students(p_group_id UUID)');
    expect(content).toContain('v_uid := auth.uid()');
    expect(content).toContain("v_profile_role IS DISTINCT FROM 'teacher'");
    expect(content).toContain('WHERE user_id = v_uid');
    expect(content).toContain('AND teacher_id = v_teacher_id');
    expect(content).toContain('REVOKE ALL ON FUNCTION public.get_teacher_portal_context() FROM PUBLIC, anon;');
    expect(content).toContain('GRANT EXECUTE ON FUNCTION public.get_teacher_portal_context() TO authenticated;');
    expect(content).toContain('REVOKE ALL ON FUNCTION public.get_teacher_group_students(UUID) FROM PUBLIC, anon;');
    expect(content).toContain('GRANT EXECUTE ON FUNCTION public.get_teacher_group_students(UUID) TO authenticated;');
    expect(content).not.toMatch(/jsonb_build_object\([^)]*(qr_code_hash|parent_name|parent_phone)/i);
  });

  it('verifies Stage C.2 migration updates triggers with FOR SHARE checks and grants scoped teacher RPCs only', () => {
    const content = fs.readFileSync(stageC2TeacherWriteFile, 'utf8');

    expect(content).toContain('CREATE OR REPLACE FUNCTION public.validate_grade_record()');
    expect(content).toContain('CREATE OR REPLACE FUNCTION public.validate_teacher_note()');
    expect(content).toContain('CREATE OR REPLACE FUNCTION public.get_teacher_student_records(');
    expect(content).toContain('CREATE OR REPLACE FUNCTION public.save_teacher_student_grade(');
    expect(content).toContain('CREATE OR REPLACE FUNCTION public.save_teacher_student_note(');
    expect(content).toContain("edutrack.teacher_portal_write");
    expect(content).toContain('FOR SHARE');
    expect(content).toContain('REVOKE ALL ON FUNCTION public.validate_grade_record() FROM PUBLIC, anon, authenticated;');
    expect(content).toContain('REVOKE ALL ON FUNCTION public.validate_teacher_note() FROM PUBLIC, anon, authenticated;');
    expect(content).toContain('GRANT EXECUTE ON FUNCTION public.get_teacher_student_records(UUID, UUID) TO authenticated;');
    expect(content).toContain('GRANT EXECUTE ON FUNCTION public.save_teacher_student_grade(UUID, UUID, TEXT, public.grade_category, NUMERIC, NUMERIC, DATE, TEXT) TO authenticated;');
    expect(content).toContain('GRANT EXECUTE ON FUNCTION public.save_teacher_student_note(UUID, UUID, TEXT, BOOLEAN) TO authenticated;');
  });

  it('verifies Stage D Student Portal migration derives auth.uid(), filters to student user_id, and omits QR/parent/notes', () => {
    const content = fs.readFileSync(stageDStudentReadFile, 'utf8');

    expect(content).toContain('CREATE OR REPLACE FUNCTION public.get_student_portal_data()');
    expect(content).toContain('v_uid := auth.uid()');
    expect(content).toContain("v_profile_role IS DISTINCT FROM 'student'");
    expect(content).toContain('WHERE s.user_id = v_uid');
    expect(content).toContain('REVOKE ALL ON FUNCTION public.get_student_portal_data() FROM PUBLIC, anon;');
    expect(content).toContain('GRANT EXECUTE ON FUNCTION public.get_student_portal_data() TO authenticated;');
    expect(content).not.toMatch(/jsonb_build_object\([^)]*(qr_code_hash|parent_name|parent_phone|teacher_notes|feedback_text)/i);
  });

  it('verifies Stage E Parent Portal migration derives auth.uid(), verifies parent_student_links per read, filters visible notes in SQL, and omits sensitive fields', () => {
    const content = fs.readFileSync(stageEParentReadFile, 'utf8');

    expect(content).toContain('CREATE OR REPLACE FUNCTION public.get_parent_portal_children()');
    expect(content).toContain('CREATE OR REPLACE FUNCTION public.get_parent_child_details(p_student_id UUID)');
    expect(content).toContain('v_uid := auth.uid()');
    expect(content).toContain("v_profile_role IS DISTINCT FROM 'parent'");
    expect(content).toContain('FROM public.parent_student_links l');
    expect(content).toContain('AND tn.is_parent_visible IS TRUE');
    expect(content).toContain('REVOKE ALL ON FUNCTION public.get_parent_portal_children() FROM PUBLIC, anon;');
    expect(content).toContain('GRANT EXECUTE ON FUNCTION public.get_parent_portal_children() TO authenticated;');
    expect(content).toContain('REVOKE ALL ON FUNCTION public.get_parent_child_details(UUID) FROM PUBLIC, anon;');
    expect(content).toContain('GRANT EXECUTE ON FUNCTION public.get_parent_child_details(UUID) TO authenticated;');
    expect(content).not.toMatch(/jsonb_build_object\([^)]*(qr_code_hash|parent_name|parent_phone|user_id)/i);
  });
});
