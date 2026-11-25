import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

describe('Storage RLS Policy Regression Tests (F4 & F5 Preflight, Scope, Privacy, Delete Guard)', () => {
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

  it('allows Storage preflight metadata without size, enforces role/scope/privacy, and blocks DELETE of committed attachments even when RLS hides the reference', async () => {
    const db = await createMigratedDbWithStorage();
    try {
      const adminUid = 'a0000000-0000-4000-8000-000000000001';
      const teacher1Uid = 'b0000000-0000-4000-8000-000000000001';
      const teacher2Uid = 'b0000000-0000-4000-8000-000000000002';
      const student1Uid = 'c0000000-0000-4000-8000-000000000001';
      const peerUid = 'c0000000-0000-4000-8000-000000000002';
      const parentUid = 'd0000000-0000-4000-8000-000000000099';

      const teacher1Id = 'd0000000-0000-4000-8000-000000000001';
      const teacher2Id = 'd0000000-0000-4000-8000-000000000002';
      const group1Id = 'e0000000-0000-4000-8000-000000000001';
      const group2Id = 'e0000000-0000-4000-8000-000000000002';
      const student1Id = 'f0000000-0000-4000-8000-000000000001';
      const peerId = 'f0000000-0000-4000-8000-000000000002';

      await db.exec(`
        INSERT INTO auth.users (id, email) VALUES
          ('${adminUid}', 'admin@edutrack.local'),
          ('${teacher1Uid}', 'teacher1@edutrack.local'),
          ('${teacher2Uid}', 'teacher2@edutrack.local'),
          ('${student1Uid}', 'student1@edutrack.local'),
          ('${peerUid}', 'peer@edutrack.local'),
          ('${parentUid}', 'parent@edutrack.local');

        INSERT INTO public.profiles (id, email, full_name, role) VALUES
          ('${adminUid}', 'admin@edutrack.local', 'Admin', 'admin'),
          ('${teacher1Uid}', 'teacher1@edutrack.local', 'Teacher 1', 'teacher'),
          ('${teacher2Uid}', 'teacher2@edutrack.local', 'Teacher 2', 'teacher'),
          ('${student1Uid}', 'student1@edutrack.local', 'Student 1', 'student'),
          ('${peerUid}', 'peer@edutrack.local', 'Peer Student', 'student'),
          ('${parentUid}', 'parent@edutrack.local', 'Parent', 'parent');

        INSERT INTO public.teachers (id, full_name, subject, email) VALUES
          ('${teacher1Id}', 'Teacher 1', 'Physics', 'teacher1@edutrack.local'),
          ('${teacher2Id}', 'Teacher 2', 'Chemistry', 'teacher2@edutrack.local');

        INSERT INTO public.groups (id, name, grade_level, teacher_id, capacity) VALUES
          ('${group1Id}', 'Group 1', 'Grade 10', '${teacher1Id}', 30),
          ('${group2Id}', 'Group 2', 'Grade 10', '${teacher2Id}', 30);

        INSERT INTO public.students (id, full_name, student_code, grade_level, group_id, qr_code_hash, status) VALUES
          ('${student1Id}', 'Student 1', 'ET-S-101', 'Grade 10', '${group1Id}', 'QR-ET-S-101', 'active'),
          ('${peerId}', 'Peer Student', 'ET-S-102', 'Grade 10', '${group1Id}', 'QR-ET-S-102', 'active');
      `);

      await setSessionUser(db, adminUid);
      await db.query(`SELECT public.link_teacher_account($1::uuid, $2::uuid);`, [teacher1Id, teacher1Uid]);
      await db.query(`SELECT public.link_teacher_account($1::uuid, $2::uuid);`, [teacher2Id, teacher2Uid]);
      await db.query(`SELECT public.link_student_account($1::uuid, $2::uuid);`, [student1Id, student1Uid]);
      await db.query(`SELECT public.link_student_account($1::uuid, $2::uuid);`, [peerId, peerUid]);
      await db.query(`SELECT public.link_parent_student($1::uuid, $2::uuid);`, [parentUid, student1Id]);

      // 1. F4 Preflight INSERT without metadata.size (Storage v1.98.7 shape: {mimetype, contentLength?, contentEncoding})
      const teacherPreflightPath = `${group1Id}/preflight-sheet.pdf`;
      const teacherOrphanPath = `${group1Id}/orphan-sheet.pdf`;
      await setSessionUser(db, teacher1Uid);

      await db.query(
        `INSERT INTO storage.objects (bucket_id, name, owner, metadata)
         VALUES ('assignment-attachments', $1::text, $2::uuid, '{"mimetype":"application/pdf","contentLength":2048,"contentEncoding":"identity"}'::jsonb);`,
        [teacherPreflightPath, teacher1Uid]
      );

      // Also test minimal preflight shape with only mimetype (no size, no contentLength)
      await db.query(
        `INSERT INTO storage.objects (bucket_id, name, owner, metadata)
         VALUES ('assignment-attachments', $1::text, $2::uuid, '{"mimetype":"application/pdf"}'::jsonb);`,
        [teacherOrphanPath, teacher1Uid]
      );

      // Unauthorized roles & wrong group denied on assignment-attachments INSERT
      await expect(
        db.query(
          `INSERT INTO storage.objects (bucket_id, name, owner, metadata)
           VALUES ('assignment-attachments', $1::text, $2::uuid, '{"mimetype":"application/pdf"}'::jsonb);`,
          [`${group2Id}/wrong-group.pdf`, teacher1Uid]
        )
      ).rejects.toThrow();

      for (const badUid of [student1Uid, parentUid, adminUid]) {
        await setSessionUser(db, badUid);
        await expect(
          db.query(
            `INSERT INTO storage.objects (bucket_id, name, owner, metadata)
             VALUES ('assignment-attachments', $1::text, $2::uuid, '{"mimetype":"application/pdf"}'::jsonb);`,
            [`${group1Id}/unauth-${badUid}.pdf`, badUid]
          )
        ).rejects.toThrow();
      }

      // Teacher1 updates metadata.size (simulating Storage finalization) and commits assignment
      await setSessionUser(db, null);
      await db.query(
        `UPDATE storage.objects SET metadata = '{"mimetype":"application/pdf","size":2048}'::jsonb WHERE bucket_id = 'assignment-attachments' AND name = $1::text;`,
        [teacherPreflightPath]
      );

      const futureDue = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      await setSessionUser(db, teacher1Uid);
      const assignRes = await db.query<{ res: { assignment: { id: string } } }>(
        `SELECT public.create_teacher_assignment($1::uuid, $2::text, $3::text, $4::timestamptz, $5::text, $6::text, $7::integer, $8::text) AS res;`,
        [group1Id, 'Physics HW', 'Solve Q1', futureDue, teacherPreflightPath, 'preflight-sheet.pdf', 2048, 'application/pdf']
      );
      const assignmentId = assignRes.rows[0].res.assignment.id;

      // F4 SELECT: teacher1 and active student1 can read committed attachment; teacher2 and parent cannot
      const t1Select = await db.query(
        `SELECT name FROM storage.objects WHERE bucket_id = 'assignment-attachments' AND name = $1::text;`,
        [teacherPreflightPath]
      );
      expect(t1Select.rows).toHaveLength(1);

      await setSessionUser(db, student1Uid);
      const s1Select = await db.query(
        `SELECT name FROM storage.objects WHERE bucket_id = 'assignment-attachments' AND name = $1::text;`,
        [teacherPreflightPath]
      );
      expect(s1Select.rows).toHaveLength(1);

      for (const deniedUid of [teacher2Uid, parentUid]) {
        await setSessionUser(db, deniedUid);
        const deniedSelect = await db.query(
          `SELECT name FROM storage.objects WHERE bucket_id = 'assignment-attachments' AND name = $1::text;`,
          [teacherPreflightPath]
        );
        expect(deniedSelect.rows).toHaveLength(0);
      }

      // Teacher1 CAN delete their own unreferenced orphan upload, but CANNOT delete committed attachment
      await setSessionUser(db, teacher1Uid);
      const delOrphan = await db.query(
        `DELETE FROM storage.objects WHERE bucket_id = 'assignment-attachments' AND name = $1::text RETURNING name;`,
        [teacherOrphanPath]
      );
      expect(delOrphan.rows).toHaveLength(1);

      const delCommittedAsOwner = await db.query(
        `DELETE FROM storage.objects WHERE bucket_id = 'assignment-attachments' AND name = $1::text RETURNING name;`,
        [teacherPreflightPath]
      );
      expect(delCommittedAsOwner.rows).toHaveLength(0);

      // Even if group1 is reassigned to teacher2 (so RLS on assignment_attachments hides the row from teacher1),
      // teacher1 STILL cannot delete the committed attachment!
      await setSessionUser(db, null);
      await db.query(`UPDATE public.groups SET teacher_id = $1::uuid WHERE id = $2::uuid;`, [teacher2Id, group1Id]);

      await setSessionUser(db, teacher1Uid);
      const delCommittedHiddenByRls = await db.query(
        `DELETE FROM storage.objects WHERE bucket_id = 'assignment-attachments' AND name = $1::text RETURNING name;`,
        [teacherPreflightPath]
      );
      expect(delCommittedHiddenByRls.rows).toHaveLength(0);

      // Restore group1 to teacher1 for F5 checks
      await setSessionUser(db, null);
      await db.query(`UPDATE public.groups SET teacher_id = $1::uuid WHERE id = $2::uuid;`, [teacher1Id, group1Id]);

      // 2. F5 Preflight INSERT without metadata.size
      const subPreflightPath = `${student1Id}/${assignmentId}/sub-preflight.pdf`;
      const subOrphanPath = `${student1Id}/${assignmentId}/sub-orphan.pdf`;
      await setSessionUser(db, student1Uid);

      await db.query(
        `INSERT INTO storage.objects (bucket_id, name, owner, metadata)
         VALUES ('assignment-submissions', $1::text, $2::uuid, '{"mimetype":"application/pdf","contentLength":1500}'::jsonb);`,
        [subPreflightPath, student1Uid]
      );

      await db.query(
        `INSERT INTO storage.objects (bucket_id, name, owner, metadata)
         VALUES ('assignment-submissions', $1::text, $2::uuid, '{"mimetype":"application/pdf"}'::jsonb);`,
        [subOrphanPath, student1Uid]
      );

      // Unauthorized roles denied on assignment-submissions INSERT
      for (const badUid of [teacher1Uid, parentUid, peerUid, adminUid]) {
        await setSessionUser(db, badUid);
        await expect(
          db.query(
            `INSERT INTO storage.objects (bucket_id, name, owner, metadata)
             VALUES ('assignment-submissions', $1::text, $2::uuid, '{"mimetype":"application/pdf"}'::jsonb);`,
            [`${student1Id}/${assignmentId}/unauth-${badUid}.pdf`, badUid]
          )
        ).rejects.toThrow();
      }

      // Finalize submission
      await setSessionUser(db, null);
      await db.query(
        `UPDATE storage.objects SET metadata = '{"mimetype":"application/pdf","size":1500}'::jsonb WHERE bucket_id = 'assignment-submissions' AND name = $1::text;`,
        [subPreflightPath]
      );
      await setSessionUser(db, student1Uid);
      await db.query(
        `SELECT public.submit_student_assignment($1::uuid, NULL, $2::text, $3::text, $4::integer, $5::text) AS res;`,
        [assignmentId, subPreflightPath, 'sub-preflight.pdf', 1500, 'application/pdf']
      );

      // Student1 can delete own unreferenced upload, but cannot delete committed submission attachment
      const delSubOrphan = await db.query(
        `DELETE FROM storage.objects WHERE bucket_id = 'assignment-submissions' AND name = $1::text RETURNING name;`,
        [subOrphanPath]
      );
      expect(delSubOrphan.rows).toHaveLength(1);

      const delSubCommitted = await db.query(
        `DELETE FROM storage.objects WHERE bucket_id = 'assignment-submissions' AND name = $1::text RETURNING name;`,
        [subPreflightPath]
      );
      expect(delSubCommitted.rows).toHaveLength(0);

      // Even if student1 is moved to group2 (RLS hides submission attachment), student1 STILL cannot delete committed submission file
      await setSessionUser(db, null);
      await db.query(`UPDATE public.students SET group_id = $1::uuid WHERE id = $2::uuid;`, [group2Id, student1Id]);

      await setSessionUser(db, student1Uid);
      const delSubAfterMove = await db.query(
        `DELETE FROM storage.objects WHERE bucket_id = 'assignment-submissions' AND name = $1::text RETURNING name;`,
        [subPreflightPath]
      );
      expect(delSubAfterMove.rows).toHaveLength(0);

      // F5 read privacy: peer, parent, and teacher2 remain denied on SELECT
      for (const deniedUid of [peerUid, parentUid, teacher2Uid]) {
        await setSessionUser(db, deniedUid);
        const deniedSubSelect = await db.query(
          `SELECT name FROM storage.objects WHERE bucket_id = 'assignment-submissions' AND name = $1::text;`,
          [subPreflightPath]
        );
        expect(deniedSubSelect.rows).toHaveLength(0);
      }
    } finally {
      await db.close();
    }
  });
});
