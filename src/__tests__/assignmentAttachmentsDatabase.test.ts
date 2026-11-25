import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

describe('Assignments Stage F.4 PDF Attachments Database Execution & Authorization Tests (PGlite)', () => {
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

  it('enforces PDF attachment type/size, teacher/current-student access, other-group rejection, post-transfer denial, and text-only compatibility', async () => {
    const db = await createMigratedDb();
    try {
      const adminUid = 'a0000000-0000-4000-8000-000000000001';
      const teacherUid = 'b0000000-0000-4000-8000-000000000001';
      const youssefUid = 'c0000000-0000-4000-8000-000000000001';
      const otherStudentUid = 'c0000000-0000-4000-8000-000000000002';

      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES
          ('${adminUid}', 'admin@edutrack.local'),
          ('${teacherUid}', 'teacher@edutrack.local'),
          ('${youssefUid}', 'youssef@edutrack.local'),
          ('${otherStudentUid}', 'other@edutrack.local');

        INSERT INTO public.profiles (id, email, full_name, role) VALUES
          ('${adminUid}', 'admin@edutrack.local', 'Admin', 'admin'),
          ('${teacherUid}', 'teacher@edutrack.local', 'Mr. Kareem', 'teacher'),
          ('${youssefUid}', 'youssef@edutrack.local', 'Youssef Tariq', 'student'),
          ('${otherStudentUid}', 'other@edutrack.local', 'Other Student', 'student');

        INSERT INTO public.teachers (id, full_name, subject, email) VALUES
          ('d0000000-0000-4000-8000-000000000001', 'Mr. Kareem', 'Physics', 'teacher@edutrack.local');

        INSERT INTO public.groups (id, name, grade_level, teacher_id, capacity) VALUES
          ('e0000000-0000-4000-8000-000000000001', 'Physics Group F1', 'Grade 10', 'd0000000-0000-4000-8000-000000000001', 30),
          ('e0000000-0000-4000-8000-000000000002', 'Chemistry Group C1', 'Grade 10', 'd0000000-0000-4000-8000-000000000001', 30);

        INSERT INTO public.students (id, full_name, student_code, grade_level, group_id, qr_code_hash, status) VALUES
          ('f0000000-0000-4000-8000-000000000001', 'Youssef Tariq', 'ET-F-101', 'Grade 10', 'e0000000-0000-4000-8000-000000000001', 'QR-ET-F-101', 'active'),
          ('f0000000-0000-4000-8000-000000000002', 'Other Student', 'ET-C-201', 'Grade 10', 'e0000000-0000-4000-8000-000000000002', 'QR-ET-C-201', 'active');
      `);

      await setSessionUser(db, adminUid);
      await db.query(`SELECT public.link_teacher_account($1::uuid, $2::uuid);`, [
        'd0000000-0000-4000-8000-000000000001',
        teacherUid,
      ]);
      await db.query(`SELECT public.link_student_account($1::uuid, $2::uuid);`, [
        'f0000000-0000-4000-8000-000000000001',
        youssefUid,
      ]);
      await db.query(`SELECT public.link_student_account($1::uuid, $2::uuid);`, [
        'f0000000-0000-4000-8000-000000000002',
        otherStudentUid,
      ]);

      const futureDue = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      const f1Id = 'e0000000-0000-4000-8000-000000000001';
      const c1Id = 'e0000000-0000-4000-8000-000000000002';

      await setSessionUser(db, teacherUid);

      // 1. Server-side rejection of non-PDF & > 5 MB
      await expect(
        db.query(
          `SELECT public.create_teacher_assignment($1::uuid, $2::text, $3::text, $4::timestamptz, $5::text, $6::text, $7::integer, $8::text) AS res;`,
          [f1Id, 'Invalid Type', 'Test', futureDue, `${f1Id}/bad.exe`, 'bad.exe', 1024, 'application/octet-stream']
        )
      ).rejects.toThrow(/Invalid attachment storage path|Only PDF/i);

      await expect(
        db.query(
          `SELECT public.create_teacher_assignment($1::uuid, $2::text, $3::text, $4::timestamptz, $5::text, $6::text, $7::integer, $8::text) AS res;`,
          [f1Id, 'Too Large', 'Test', futureDue, `${f1Id}/huge.pdf`, 'huge.pdf', 5 * 1024 * 1024 + 1, 'application/pdf']
        )
      ).rejects.toThrow(/5 MB/i);

      // 2. Publish text-only assignment (no attachment)
      const textOnlyRes = await db.query<{ res: { assignment: { id: string; attachment: null } } }>(
        `SELECT public.create_teacher_assignment($1::uuid, $2::text, $3::text, $4::timestamptz) AS res;`,
        [f1Id, 'واجب نصي فقط', 'أجب نصيًا بدون مرفق.', futureDue]
      );
      expect(textOnlyRes.rows[0].res.assignment.attachment).toBeNull();

      // 3. Publish "واجب الحركة" with PDF attachment
      const pdfPath = `${f1Id}/11111111-1111-4111-8111-111111111111.pdf`;
      const withPdfRes = await db.query<{
        res: { assignment: { id: string; title: string; attachment: { id: string; file_name: string; size_bytes: number } } };
      }>(
        `SELECT public.create_teacher_assignment($1::uuid, $2::text, $3::text, $4::timestamptz, $5::text, $6::text, $7::integer, $8::text) AS res;`,
        [f1Id, 'واجب الحركة', 'حل مسائل الحركة المرفقة.', futureDue, pdfPath, 'motion-sheet.pdf', 2048, 'application/pdf']
      );
      const attachmentId = withPdfRes.rows[0].res.assignment.attachment.id;
      expect(withPdfRes.rows[0].res.assignment.attachment.file_name).toBe('motion-sheet.pdf');

      // Teacher can authorize opening it
      const teacherAuth = await db.query<{ res: { attachment: { object_path: string } } }>(
        `SELECT public.authorize_assignment_attachment_download($1::uuid) AS res;`,
        [attachmentId]
      );
      expect(teacherAuth.rows[0].res.attachment.object_path).toBe(pdfPath);

      // 4. Youssef ET-F-101 in F1 sees and can authorize download
      await setSessionUser(db, youssefUid);
      const studentAssignments = await db.query<{ res: { assignments: Array<{ title: string; attachment: { id: string } | null }> } }>(
        `SELECT public.get_student_assignments() AS res;`
      );
      const motion = studentAssignments.rows[0].res.assignments.find((a) => a.title === 'واجب الحركة');
      expect(motion?.attachment?.id).toBe(attachmentId);

      const youssefAuth = await db.query<{ res: { attachment: { object_path: string; file_name: string } } }>(
        `SELECT public.authorize_assignment_attachment_download($1::uuid) AS res;`,
        [attachmentId]
      );
      expect(youssefAuth.rows[0].res.attachment.file_name).toBe('motion-sheet.pdf');

      // 5. Student from another group is rejected even with the exact attachment_id
      await setSessionUser(db, otherStudentUid);
      await expect(
        db.query(`SELECT public.authorize_assignment_attachment_download($1::uuid) AS res;`, [attachmentId])
      ).rejects.toThrow(/Access denied/i);

      // 6. Transfer Youssef to Chemistry Group C1 -> any new download authorization fails
      await setSessionUser(db, null);
      await db.exec(`UPDATE public.students SET group_id = '${c1Id}' WHERE user_id = '${youssefUid}';`);

      await setSessionUser(db, youssefUid);
      await expect(
        db.query(`SELECT public.authorize_assignment_attachment_download($1::uuid) AS res;`, [attachmentId])
      ).rejects.toThrow(/Access denied/i);
    } finally {
      await db.close();
    }
  });
});
