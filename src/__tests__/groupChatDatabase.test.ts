import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

describe('Group Discussion Chat Migration 20261124000013 (PGlite)', () => {
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
      DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE PUBLICATION supabase_realtime;
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

  async function seedFixture(db: PGlite) {
    const ids = {
      adminUid: 'a0000000-0000-4000-8000-000000000001',
      teacher1Uid: 'b0000000-0000-4000-8000-000000000001',
      teacher2Uid: 'b0000000-0000-4000-8000-000000000002',
      student1Uid: 'c0000000-0000-4000-8000-000000000001',
      student2Uid: 'c0000000-0000-4000-8000-000000000002',
      parentUid: 'd0000000-0000-4000-8000-000000000001',
      teacher1Id: 'e0000000-0000-4000-8000-000000000001',
      teacher2Id: 'e0000000-0000-4000-8000-000000000002',
      group1Id: 'f0000000-0000-4000-8000-000000000001',
      group2Id: 'f0000000-0000-4000-8000-000000000002',
      student1Id: '10000000-0000-4000-8000-000000000001',
      student2Id: '10000000-0000-4000-8000-000000000002',
    };

    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${ids.adminUid}', 'admin@edutrack.local'),
        ('${ids.teacher1Uid}', 't1@edutrack.local'),
        ('${ids.teacher2Uid}', 't2@edutrack.local'),
        ('${ids.student1Uid}', 's1@edutrack.local'),
        ('${ids.student2Uid}', 's2@edutrack.local'),
        ('${ids.parentUid}', 'p1@edutrack.local');

      INSERT INTO public.profiles (id, email, full_name, role) VALUES
        ('${ids.adminUid}', 'admin@edutrack.local', 'Admin User', 'admin'),
        ('${ids.teacher1Uid}', 't1@edutrack.local', 'Mr. Rami', 'teacher'),
        ('${ids.teacher2Uid}', 't2@edutrack.local', 'Ms. Salma', 'teacher'),
        ('${ids.student1Uid}', 's1@edutrack.local', 'Youssef Tariq', 'student'),
        ('${ids.student2Uid}', 's2@edutrack.local', 'Nour Hassan', 'student'),
        ('${ids.parentUid}', 'p1@edutrack.local', 'Tariq Guardian', 'parent');

      INSERT INTO public.teachers (id, full_name, subject, email) VALUES
        ('${ids.teacher1Id}', 'Mr. Rami', 'Physics', 't1@edutrack.local'),
        ('${ids.teacher2Id}', 'Ms. Salma', 'Math', 't2@edutrack.local');

      INSERT INTO public.groups (id, name, grade_level, teacher_id, capacity) VALUES
        ('${ids.group1Id}', 'Physics A', 'Grade 10', '${ids.teacher1Id}', 30),
        ('${ids.group2Id}', 'Math B', 'Grade 10', '${ids.teacher2Id}', 30);

      INSERT INTO public.students (id, full_name, student_code, grade_level, group_id, qr_code_hash, status) VALUES
        ('${ids.student1Id}', 'Youssef Tariq', 'ET-1001', 'Grade 10', '${ids.group1Id}', 'QR-1001', 'active'),
        ('${ids.student2Id}', 'Nour Hassan', 'ET-1002', 'Grade 10', '${ids.group2Id}', 'QR-1002', 'active');
    `);

    await setSessionUser(db, ids.adminUid);
    await db.query(`SELECT public.link_teacher_account($1::uuid, $2::uuid);`, [ids.teacher1Id, ids.teacher1Uid]);
    await db.query(`SELECT public.link_teacher_account($1::uuid, $2::uuid);`, [ids.teacher2Id, ids.teacher2Uid]);
    await db.query(`SELECT public.link_student_account($1::uuid, $2::uuid);`, [ids.student1Id, ids.student1Uid]);
    await db.query(`SELECT public.link_student_account($1::uuid, $2::uuid);`, [ids.student2Id, ids.student2Uid]);
    await db.query(`SELECT public.link_parent_student($1::uuid, $2::uuid);`, [ids.parentUid, ids.student1Id]);
    await db.exec(`RESET ROLE;`);

    return ids;
  }

  it('enforces role/group authorization, hides author user IDs, validates trimmed plaintext <= 1000, and revokes direct table mutations', async () => {
    const db = await createMigratedDb();
    try {
      const publication = await db.query<{ tablename: string }>(
        "SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'"
      );
      expect(publication.rows.map(({ tablename }) => tablename)).toEqual(['group_chat_markers']);
      const ids = await seedFixture(db);

      // Assigned teacher sends trimmed message
      await setSessionUser(db, ids.teacher1Uid);
      const tSend = await db.query<{
        res: {
          id: string;
          group_id: string;
          sender_display_name: string;
          sender_role: string;
          body: string;
          sender_user_id?: string;
        };
      }>(`SELECT public.send_group_chat_message($1::uuid, $2::text) AS res;`, [
        ids.group1Id,
        '  Welcome to Physics A  ',
      ]);
      expect(tSend.rows[0].res.sender_display_name).toBe('Mr. Rami');
      expect(tSend.rows[0].res.sender_role).toBe('teacher');
      expect(tSend.rows[0].res.body).toBe('Welcome to Physics A');
      expect(tSend.rows[0].res.sender_user_id).toBeUndefined();

      // Active student in Group 1 sends exact 1000-char message (with surrounding spaces)
      await setSessionUser(db, ids.student1Uid);
      const maxBody = `  ${'a'.repeat(1000)}  `;
      const sSend = await db.query<{
        res: { sender_display_name: string; sender_role: string; body: string; sender_user_id?: string };
      }>(`SELECT public.send_group_chat_message($1::uuid, $2::text) AS res;`, [ids.group1Id, maxBody]);
      expect(sSend.rows[0].res.sender_display_name).toBe('Youssef Tariq');
      expect(sSend.rows[0].res.sender_role).toBe('student');
      expect(sSend.rows[0].res.body.length).toBe(1000);
      expect(sSend.rows[0].res.sender_user_id).toBeUndefined();

      // Reject empty and >1000 char messages
      await expect(
        db.query(`SELECT public.send_group_chat_message($1::uuid, $2::text);`, [ids.group1Id, '   '])
      ).rejects.toThrow(/empty/i);
      await expect(
        db.query(`SELECT public.send_group_chat_message($1::uuid, $2::text);`, [
          ids.group1Id,
          'b'.repeat(1001),
        ])
      ).rejects.toThrow(/1000/);

      // Marker table contains only group_id & revision_at and is visible via RLS to Group 1 members only
      const markerCols = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'group_chat_markers' ORDER BY ordinal_position;`
      );
      expect(markerCols.rows.map((r) => r.column_name)).toEqual(['group_id', 'revision_at']);

      const s1Marker = await db.query<{ group_id: string }>(`SELECT group_id FROM public.group_chat_markers;`);
      expect(s1Marker.rows.map((r) => r.group_id)).toEqual([ids.group1Id]);

      // Deny parent, admin, other-group teacher, other-group student, and anon
      for (const uid of [ids.parentUid, ids.adminUid, ids.teacher2Uid, ids.student2Uid]) {
        await setSessionUser(db, uid);
        await expect(
          db.query(`SELECT public.get_group_chat_messages($1::uuid);`, [ids.group1Id])
        ).rejects.toThrow(/Access denied/i);
        await expect(
          db.query(`SELECT public.send_group_chat_message($1::uuid, $2::text);`, [ids.group1Id, 'Intrude'])
        ).rejects.toThrow(/Access denied/i);
        const otherMarkers = await db.query<{ group_id: string }>(`SELECT group_id FROM public.group_chat_markers;`);
        expect(otherMarkers.rows).toEqual([]);
      }

      // Anon denied on RPCs
      await setSessionUser(db, null);
      await expect(
        db.query(`SELECT public.get_group_chat_messages($1::uuid);`, [ids.group1Id])
      ).rejects.toThrow(/Unauthorized|permission denied/i);

      // Direct table mutations / direct message table reads revoked from authenticated
      await setSessionUser(db, ids.teacher1Uid);
      await expect(db.query(`SELECT * FROM public.group_chat_messages;`)).rejects.toThrow(/permission denied/i);
      await expect(
        db.query(
          `INSERT INTO public.group_chat_messages (group_id, sender_user_id, sender_role, sender_display_name, body) VALUES ($1::uuid, $2::uuid, 'teacher', 'Fake', 'Hi');`,
          [ids.group1Id, ids.teacher1Uid]
        )
      ).rejects.toThrow(/permission denied/i);
      await expect(
        db.query(`UPDATE public.group_chat_markers SET revision_at = NOW() WHERE group_id = $1::uuid;`, [
          ids.group1Id,
        ])
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await db.close();
    }
  });

  it('enforces group transfers, suspended/graduated student denials, and returns latest 50 chronological messages', async () => {
    const db = await createMigratedDb();
    try {
      const ids = await seedFixture(db);

      // Insert 55 messages as teacher1 in group1
      await setSessionUser(db, ids.teacher1Uid);
      for (let i = 1; i <= 55; i++) {
        await db.query(`SELECT public.send_group_chat_message($1::uuid, $2::text);`, [
          ids.group1Id,
          `Message #${i}`,
        ]);
      }

      await setSessionUser(db, ids.student1Uid);
      const read50 = await db.query<{
        res: { group_id: string; messages: Array<{ body: string; sender_user_id?: string }> };
      }>(`SELECT public.get_group_chat_messages($1::uuid) AS res;`, [ids.group1Id]);
      expect(read50.rows[0].res.messages).toHaveLength(50);
      expect(read50.rows[0].res.messages[0].body).toBe('Message #6');
      expect(read50.rows[0].res.messages[49].body).toBe('Message #55');
      expect(read50.rows[0].res.messages[0].sender_user_id).toBeUndefined();

      // Suspend student1 -> denied
      await db.exec(`RESET ROLE;`);
      await setSessionUser(db, ids.adminUid);
      await db.query(`SELECT public.update_student_enrollment_status($1::uuid, 'suspended', 'active');`, [
        ids.student1Id,
      ]);

      await setSessionUser(db, ids.student1Uid);
      await expect(
        db.query(`SELECT public.get_group_chat_messages($1::uuid);`, [ids.group1Id])
      ).rejects.toThrow(/Access denied/i);
      await expect(
        db.query(`SELECT public.send_group_chat_message($1::uuid, $2::text);`, [ids.group1Id, 'Suspended send'])
      ).rejects.toThrow(/Access denied/i);

      // Reactivate and transfer student1 from group1 to group2
      await setSessionUser(db, ids.adminUid);
      await db.query(`SELECT public.update_student_enrollment_status($1::uuid, 'active', 'suspended');`, [
        ids.student1Id,
      ]);
      await db.exec(`RESET ROLE; UPDATE public.students SET group_id = '${ids.group2Id}' WHERE id = '${ids.student1Id}';`);

      // Student1 can no longer access group1, but can read & send in group2
      await setSessionUser(db, ids.student1Uid);
      await expect(
        db.query(`SELECT public.get_group_chat_messages($1::uuid);`, [ids.group1Id])
      ).rejects.toThrow(/Access denied/i);

      const g2Send = await db.query<{ res: { group_id: string; body: string } }>(
        `SELECT public.send_group_chat_message($1::uuid, $2::text) AS res;`,
        [ids.group2Id, 'Moved to Math B']
      );
      expect(g2Send.rows[0].res.group_id).toBe(ids.group2Id);
      expect(g2Send.rows[0].res.body).toBe('Moved to Math B');
    } finally {
      await db.close();
    }
  });
});
