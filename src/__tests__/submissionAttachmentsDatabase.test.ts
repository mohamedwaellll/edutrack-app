import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

describe('Assignments Stage F.5 Student Submission PDF Attachments & Storage RLS Tests (PGlite)', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const migrationFiles = fs
    .readdirSync(path.join(rootDir, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  async function createMigratedDbWithStorage(): Promise<PGlite> {
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

      CREATE SCHEMA IF NOT EXISTS storage;
      CREATE TABLE IF NOT EXISTS storage.buckets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        public BOOLEAN DEFAULT FALSE,
        file_size_limit BIGINT,
        allowed_mime_types TEXT[]
      );
      CREATE TABLE IF NOT EXISTS storage.objects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_id TEXT NOT NULL REFERENCES storage.buckets(id),
        name TEXT NOT NULL,
        owner UUID,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (bucket_id, name)
      );
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

      CREATE OR REPLACE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[] AS $$
        SELECT string_to_array(regexp_replace(name, '/[^/]+$', ''), '/');
      $$ LANGUAGE sql IMMUTABLE;

      CREATE OR REPLACE FUNCTION storage.extension(name TEXT) RETURNS TEXT AS $$
        SELECT COALESCE(substring(name FROM E'\\\\.([^.]+)$'), '');
      $$ LANGUAGE sql IMMUTABLE;

      DO $$ BEGIN
        CREATE ROLE anon NOLOGIN;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE ROLE authenticated NOLOGIN;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE ROLE service_role NOLOGIN;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      GRANT USAGE ON SCHEMA storage TO authenticated;
      GRANT SELECT, INSERT, DELETE ON storage.objects TO authenticated;
      GRANT SELECT ON storage.buckets TO authenticated;
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

  it('supports PDF-only/text+PDF, v1->v2 replacement, Storage RLS isolation against same-group peers & parents, server validation, and post-due grading', async () => {
    const db = await createMigratedDbWithStorage();
    try {
      const adminUid = 'a0000000-0000-4000-8000-000000000001';
      const teacherUid = 'b0000000-0000-4000-8000-000000000001';
      const youssefUid = 'c0000000-0000-4000-8000-000000000001';
      const peerUid = 'c0000000-0000-4000-8000-000000000002';
      const parentUid = 'd0000000-0000-4000-8000-000000000099';

      const teacherId = 'd0000000-0000-4000-8000-000000000001';
      const f1Id = 'e0000000-0000-4000-8000-000000000001';
      const youssefId = 'f0000000-0000-4000-8000-000000000001';
      const peerId = 'f0000000-0000-4000-8000-000000000002';

      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES
          ('${adminUid}', 'admin@edutrack.local'),
          ('${teacherUid}', 'teacher@edutrack.local'),
          ('${youssefUid}', 'youssef@edutrack.local'),
          ('${peerUid}', 'peer@edutrack.local'),
          ('${parentUid}', 'parent@edutrack.local');

        INSERT INTO public.profiles (id, email, full_name, role) VALUES
          ('${adminUid}', 'admin@edutrack.local', 'Admin', 'admin'),
          ('${teacherUid}', 'teacher@edutrack.local', 'Mr. Kareem', 'teacher'),
          ('${youssefUid}', 'youssef@edutrack.local', 'Youssef Tariq', 'student'),
          ('${peerUid}', 'peer@edutrack.local', 'Same Group Peer', 'student'),
          ('${parentUid}', 'parent@edutrack.local', 'Tariq Guardian', 'parent');

        INSERT INTO public.teachers (id, full_name, subject, email) VALUES
          ('${teacherId}', 'Mr. Kareem', 'Physics', 'teacher@edutrack.local');

        INSERT INTO public.groups (id, name, grade_level, teacher_id, capacity) VALUES
          ('${f1Id}', 'Physics Group F1', 'Grade 10', '${teacherId}', 30);

        INSERT INTO public.students (id, full_name, student_code, grade_level, group_id, qr_code_hash, status) VALUES
          ('${youssefId}', 'Youssef Tariq', 'ET-F-101', 'Grade 10', '${f1Id}', 'QR-ET-F-101', 'active'),
          ('${peerId}', 'Same Group Peer', 'ET-F-102', 'Grade 10', '${f1Id}', 'QR-ET-F-102', 'active');
      `);

      await setSessionUser(db, adminUid);
      await db.query(`SELECT public.link_teacher_account($1::uuid, $2::uuid);`, [teacherId, teacherUid]);
      await db.query(`SELECT public.link_student_account($1::uuid, $2::uuid);`, [youssefId, youssefUid]);
      await db.query(`SELECT public.link_student_account($1::uuid, $2::uuid);`, [peerId, peerUid]);
      await db.query(`SELECT public.link_parent_student($1::uuid, $2::uuid);`, [parentUid, youssefId]);

      const futureDue = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      await setSessionUser(db, teacherUid);
      const assignRes = await db.query<{ res: { assignment: { id: string } } }>(
        `SELECT public.create_teacher_assignment($1::uuid, $2::text, $3::text, $4::timestamptz) AS res;`,
        [f1Id, 'واجب الحركة', 'أرفق الحل PDF أو نصًا.', futureDue]
      );
      const assignmentId = assignRes.rows[0].res.assignment.id;

      // 1. Youssef uploads solution-v1.pdf to storage.objects and submits PDF-only
      const v1Path = `${youssefId}/${assignmentId}/11111111-1111-4111-8111-111111111111.pdf`;
      await setSessionUser(db, youssefUid);

      // Server-side Storage policy rejects non-PDF or >5MB
      await expect(
        db.query(
          `INSERT INTO storage.objects (bucket_id, name, owner, metadata)
           VALUES ('assignment-submissions', $1::text, $2::uuid, '{"mimetype":"text/plain","size":1024}'::jsonb);`,
          [`${youssefId}/${assignmentId}/bad.txt`, youssefUid]
        )
      ).rejects.toThrow();

      await expect(
        db.query(
          `INSERT INTO storage.objects (bucket_id, name, owner, metadata)
           VALUES ('assignment-submissions', $1::text, $2::uuid, $3::jsonb);`,
          [
            `${youssefId}/${assignmentId}/too-big.pdf`,
            youssefUid,
            JSON.stringify({ mimetype: 'application/pdf', size: 5 * 1024 * 1024 + 1 }),
          ]
        )
      ).rejects.toThrow();

      // Valid v1 upload & PDF-only submission
      await db.query(
        `INSERT INTO storage.objects (bucket_id, name, owner, metadata)
         VALUES ('assignment-submissions', $1::text, $2::uuid, '{"mimetype":"application/pdf","size":1024}'::jsonb);`,
        [v1Path, youssefUid]
      );
      const subV1 = await db.query<{
        res: { submission: { id: string; answer_text: string | null; attachment: { id: string; file_name: string } } };
      }>(
        `SELECT public.submit_student_assignment($1::uuid, NULL, $2::text, $3::text, $4::integer, $5::text) AS res;`,
        [assignmentId, v1Path, 'solution-v1.pdf', 1024, 'application/pdf']
      );
      expect(subV1.rows[0].res.submission.answer_text).toBeNull();
      expect(subV1.rows[0].res.submission.attachment.file_name).toBe('solution-v1.pdf');

      // 2. Replace with solution-v2.pdf + text before deadline
      const v2Path = `${youssefId}/${assignmentId}/22222222-2222-4222-8222-222222222222.pdf`;
      await db.query(
        `INSERT INTO storage.objects (bucket_id, name, owner, metadata)
         VALUES ('assignment-submissions', $1::text, $2::uuid, '{"mimetype":"application/pdf","size":2048}'::jsonb);`,
        [v2Path, youssefUid]
      );
      const subV2 = await db.query<{
        res: {
          submission: { id: string; answer_text: string | null; attachment: { id: string; file_name: string } };
          previous_object_path: string | null;
        };
      }>(
        `SELECT public.submit_student_assignment($1::uuid, $2::text, $3::text, $4::text, $5::integer, $6::text) AS res;`,
        [assignmentId, 'تم تحديث الحل النهائي', v2Path, 'solution-v2.pdf', 2048, 'application/pdf']
      );
      expect(subV2.rows[0].res.submission.attachment.file_name).toBe('solution-v2.pdf');
      expect(subV2.rows[0].res.previous_object_path).toBe(v1Path);
      const v2AttId = subV2.rows[0].res.submission.attachment.id;

      // Owner Youssef can read directly from storage.objects and authorize download
      const youssefStorage = await db.query(
        `SELECT name FROM storage.objects WHERE bucket_id = 'assignment-submissions' AND name = $1::text;`,
        [v2Path]
      );
      expect(youssefStorage.rows).toHaveLength(1);

      // 3. Same-group peer is DENIED on storage.objects AND authorize_submission_attachment_download
      await setSessionUser(db, peerUid);
      const peerStorage = await db.query(
        `SELECT name FROM storage.objects WHERE bucket_id = 'assignment-submissions' AND name = $1::text;`,
        [v2Path]
      );
      expect(peerStorage.rows).toHaveLength(0);
      await expect(
        db.query(`SELECT public.authorize_submission_attachment_download($1::uuid);`, [v2AttId])
      ).rejects.toThrow(/Access denied/i);

      // 4. Parent is DENIED on storage.objects AND authorize_submission_attachment_download
      await setSessionUser(db, parentUid);
      const parentStorage = await db.query(
        `SELECT name FROM storage.objects WHERE bucket_id = 'assignment-submissions' AND name = $1::text;`,
        [v2Path]
      );
      expect(parentStorage.rows).toHaveLength(0);
      await expect(
        db.query(`SELECT public.authorize_submission_attachment_download($1::uuid);`, [v2AttId])
      ).rejects.toThrow(/Access denied/i);

      // 5. Assigned teacher reads from storage.objects, sees single submission with solution-v2.pdf
      await setSessionUser(db, teacherUid);
      const teacherStorage = await db.query(
        `SELECT name FROM storage.objects WHERE bucket_id = 'assignment-submissions' AND name = $1::text;`,
        [v2Path]
      );
      expect(teacherStorage.rows).toHaveLength(1);
      const teacherSubs = await db.query<{
        res: { submissions: Array<{ id: string; attachment: { id: string; file_name: string } | null }> };
      }>(`SELECT public.get_teacher_assignment_submissions($1::uuid) AS res;`, [assignmentId]);
      expect(teacherSubs.rows[0].res.submissions).toHaveLength(1);
      expect(teacherSubs.rows[0].res.submissions[0].attachment?.file_name).toBe('solution-v2.pdf');

      // 6. After due_at: replacement is rejected by DB clock, and v2 remains intact & gradeable
      await setSessionUser(db, null);
      await db.exec(`UPDATE public.assignments SET due_at = NOW() - INTERVAL '1 minute' WHERE id = '${assignmentId}';`);

      await setSessionUser(db, youssefUid);
      const v3Path = `${youssefId}/${assignmentId}/33333333-3333-4333-8333-333333333333.pdf`;
      await expect(
        db.query(
          `SELECT public.submit_student_assignment($1::uuid, NULL, $2::text, $3::text, $4::integer, $5::text) AS res;`,
          [assignmentId, v3Path, 'solution-v3.pdf', 1024, 'application/pdf']
        )
      ).rejects.toThrow(/deadline has passed/i);

      await setSessionUser(db, teacherUid);
      const gradeRes = await db.query<{ res: { saved: boolean; grade: { score: number } } }>(
        `SELECT public.grade_assignment_submission($1::uuid, 18, 20, NULL) AS res;`,
        [subV2.rows[0].res.submission.id]
      );
      expect(gradeRes.rows[0].res.saved).toBe(true);
      expect(Number(gradeRes.rows[0].res.grade.score)).toBe(18);
    } finally {
      await db.close();
    }
  });
});
