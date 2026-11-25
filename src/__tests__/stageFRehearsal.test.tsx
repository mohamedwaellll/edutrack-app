// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import type { AuthChangeEvent, AuthError, Session, Subscription, User } from '@supabase/supabase-js';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import App from '../App';
import { supabase } from '../lib/supabaseClient';
import * as supabaseClientModule from '../lib/supabaseClient';

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const MIGRATIONS_IN_ORDER = [
  '20261103_edutrack_schema.sql',
  '20261117_edutrack_admin_auth_upgrade.sql',
  '20261118000001_edutrack_auth_triggers_fail_closed.sql',
  '20261119000001_edutrack_manual_attendance_and_grants.sql',
  '20261120000001_edutrack_qr_attendance_and_cairo_time.sql',
  '20261120000002_edutrack_qr_concurrency_and_time_fix.sql',
  '20261120000003_edutrack_grades_and_feedback_integrity.sql',
  '20261120000004_edutrack_assessment_lock_permissions.sql',
  '20261120000005_edutrack_teacher_management_and_group_assignment.sql',
  '20261121000001_edutrack_teacher_management_corrections.sql',
  '20261121000002_edutrack_secure_account_linking.sql',
  '20261121000003_edutrack_stage_b1_corrective_hardening.sql',
  '20261121000004_edutrack_stage_b2_expected_unlink_guards.sql',
  '20261121000005_edutrack_stage_c1_teacher_read_only_scope.sql',
  '20261121000006_edutrack_stage_c2_teacher_grade_and_note_writes.sql',
  '20261121000007_edutrack_stage_d_student_read_only_portal.sql',
  '20261122000001_edutrack_stage_e_parent_read_only_portal.sql',
];

async function createStageFDemoDb(): Promise<PGlite> {
  const db = new PGlite();
  const rootDir = path.resolve(__dirname, '../../');

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
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
  `);

  for (const file of MIGRATIONS_IN_ORDER) {
    const sql = fs.readFileSync(path.join(rootDir, 'supabase/migrations', file), 'utf8');
    await db.exec(sql);
  }

  return db;
}

function rasterizeQrSvg(svgEl: SVGElement): { data: Uint8ClampedArray; width: number; height: number } {
  const vb = svgEl.getAttribute('viewBox') || '0 0 29 29';
  const gridSize = parseInt(vb.split(/\s+/)[2], 10);
  const scale = 8;
  const width = gridSize * scale;
  const height = gridSize * scale;
  const pixelBuffer = new Uint8ClampedArray(width * height * 4);
  pixelBuffer.fill(255);

  const paths = Array.from(svgEl.querySelectorAll('path'));
  const darkPath =
    paths.find((p) => (p.getAttribute('fill') || '').toLowerCase() === '#0f172a') ||
    paths.find((p) => (p.getAttribute('fill') || '').toLowerCase() === '#000000') ||
    paths[1];
  const dAttr = darkPath?.getAttribute('d') || '';
  const rectRegex = /M\s*(\d+)[,\s]+(\d+)\s*h\s*(\d+)\s*v\s*(\d+)\s*H\s*(\d+)\s*z/gi;
  let match: RegExpExecArray | null;
  while ((match = rectRegex.exec(dAttr)) !== null) {
    const x = parseInt(match[1], 10);
    const y = parseInt(match[2], 10);
    const w = parseInt(match[3], 10);
    const h = parseInt(match[4], 10);
    for (let py = y * scale; py < (y + h) * scale; py++) {
      for (let px = x * scale; px < (x + w) * scale; px++) {
        const idx = (py * width + px) * 4;
        pixelBuffer[idx] = 0;
        pixelBuffer[idx + 1] = 0;
        pixelBuffer[idx + 2] = 0;
        pixelBuffer[idx + 3] = 255;
      }
    }
  }
  return { data: pixelBuffer, width, height };
}

function wirePgliteSupabaseBridge(
  db: PGlite,
  credentials: Record<string, { uid: string; email: string; password: string }>
) {
  let currentSession: Session | null = null;
  const authListeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();

  let dbLock: Promise<unknown> = Promise.resolve();
  const withDb = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = dbLock.then(fn, fn);
    dbLock = next.catch(() => undefined);
    return next;
  };

  const getPgError = (err: unknown, fallback: string) => ({
    message: err instanceof Error && err.message ? err.message : fallback,
    code:
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code ?? '')
        : undefined,
  });

  const setDbRole = async () => {
    if (!currentSession) {
      await db.exec(`SET ROLE anon; SET request.jwt.claim.role = 'anon'; SET request.jwt.claim.sub = '';`);
    } else {
      await db.exec(
        `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${currentSession.user.id}';`
      );
    }
  };

  vi.spyOn(supabase.auth, 'getSession').mockImplementation(async () => ({
    data: { session: currentSession },
    error: null,
  }));

  vi.spyOn(supabase.auth, 'onAuthStateChange').mockImplementation((cb) => {
    authListeners.add(cb);
    return {
      data: {
        subscription: {
          unsubscribe: () => {
            authListeners.delete(cb);
          },
        } as unknown as Subscription,
      },
    };
  });

  vi.spyOn(supabase.auth, 'signInWithPassword').mockImplementation(async (creds) => {
    const email = 'email' in creds ? String(creds.email || '').trim().toLowerCase() : '';
    const password = 'password' in creds ? creds.password : '';
    const match = credentials[email];
    if (!match || match.password !== password) {
      return {
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials' } as AuthError,
      };
    }
    const fakeUser = { id: match.uid, email: match.email } as unknown as User;
    currentSession = {
      user: fakeUser,
      access_token: `pglite-jwt-${match.uid}`,
      refresh_token: `pglite-ref-${match.uid}`,
      expires_in: 3600,
      token_type: 'bearer',
    };
    for (const listener of Array.from(authListeners)) {
      listener('SIGNED_IN', currentSession);
    }
    return { data: { user: fakeUser, session: currentSession }, error: null };
  });

  vi.spyOn(supabase.auth, 'signOut').mockImplementation(async () => {
    currentSession = null;
    for (const listener of Array.from(authListeners)) {
      listener('SIGNED_OUT', null);
    }
    return { error: null };
  });

  vi.spyOn(supabase, 'rpc').mockImplementation(((fnName: string, params: Record<string, unknown> = {}) =>
    withDb(async () => {
      try {
        await setDbRole();
        let res: { rows: Array<Record<string, unknown>> };
        switch (fnName) {
          case 'link_teacher_account':
            res = await db.query(
              `SELECT public.link_teacher_account($1::uuid, $2::uuid) AS res;`,
              [params.p_teacher_id, params.p_user_id]
            );
            break;
          case 'link_student_account':
            res = await db.query(
              `SELECT public.link_student_account($1::uuid, $2::uuid) AS res;`,
              [params.p_student_id, params.p_user_id]
            );
            break;
          case 'link_parent_student':
            res = await db.query(
              `SELECT public.link_parent_student($1::uuid, $2::uuid) AS res;`,
              [params.p_parent_id, params.p_student_id]
            );
            break;
          case 'record_qr_attendance':
            res = await db.query(
              `SELECT public.record_qr_attendance($1::text, $2::uuid) AS res;`,
              [params.p_qr_hash, params.p_group_id]
            );
            break;
          case 'get_teacher_portal_context':
            res = await db.query(`SELECT public.get_teacher_portal_context() AS res;`);
            break;
          case 'get_teacher_group_students':
            res = await db.query(
              `SELECT public.get_teacher_group_students($1::uuid) AS res;`,
              [params.p_group_id]
            );
            break;
          case 'get_teacher_student_records':
            res = await db.query(
              `SELECT public.get_teacher_student_records($1::uuid, $2::uuid) AS res;`,
              [params.p_group_id, params.p_student_id]
            );
            break;
          case 'save_teacher_student_grade':
            res = await db.query(
              `SELECT public.save_teacher_student_grade($1::uuid, $2::uuid, $3::text, $4::public.grade_category, $5::numeric, $6::numeric, $7::date, $8::text) AS res;`,
              [
                params.p_group_id,
                params.p_student_id,
                params.p_assessment_title,
                params.p_grade_type,
                params.p_score,
                params.p_max_score,
                params.p_assessment_date,
                params.p_notes ?? params.p_remarks ?? null,
              ]
            );
            break;
          case 'save_teacher_student_note':
            res = await db.query(
              `SELECT public.save_teacher_student_note($1::uuid, $2::uuid, $3::text, $4::boolean) AS res;`,
              [params.p_group_id, params.p_student_id, params.p_feedback_text, params.p_is_parent_visible]
            );
            break;
          case 'get_student_portal_data':
            res = await db.query(`SELECT public.get_student_portal_data() AS res;`);
            break;
          case 'get_parent_portal_children':
            res = await db.query(`SELECT public.get_parent_portal_children() AS res;`);
            break;
          case 'get_parent_child_details':
            res = await db.query(
              `SELECT public.get_parent_child_details($1::uuid) AS res;`,
              [params.p_student_id]
            );
            break;
          default:
            return { data: null, error: { message: `Unhandled RPC ${fnName}` } };
        }
        const raw = res.rows[0]?.res;
        return { data: typeof raw === 'string' ? JSON.parse(raw) : raw, error: null };
      } catch (err: unknown) {
        return { data: null, error: getPgError(err, 'Database RPC error') };
      }
    })) as unknown as typeof supabase.rpc);

  vi.spyOn(supabase, 'from').mockImplementation(((table: string) => {
    const filters: Array<{ col: string; op: string; val: unknown }> = [];
    let selectCols = '*';
    let orderCol: string | null = null;
    let orderAsc = true;
    let limitNum: number | null = null;
    let headMode = false;
    let countMode = false;

    const buildWhere = () => {
      const args: unknown[] = [];
      const clauses = filters.map((f) => {
        if (f.op === 'in') {
          args.push((Array.isArray(f.val) ? f.val : []).map((v) => String(v)));
          return `${tableAlias}.${f.col}::text = ANY($${args.length}::text[])`;
        }
        args.push(String(f.val));
        const idx = `$${args.length}::text`;
        if (f.op === 'eq') return `${tableAlias}.${f.col}::text = ${idx}`;
        if (f.op === 'gte') return `${tableAlias}.${f.col}::text >= ${idx}`;
        if (f.op === 'lte') return `${tableAlias}.${f.col}::text <= ${idx}`;
        return 'TRUE';
      });
      return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', args };
    };
    const tableAlias = 't';

    const executeSelect = () =>
      withDb(async () => {
        try {
          await setDbRole();
          const { sql: whereSql, args } = buildWhere();
          const orderSql = orderCol ? `ORDER BY ${tableAlias}.${orderCol} ${orderAsc ? 'ASC' : 'DESC'}` : '';
          const limitSql = limitNum !== null ? `LIMIT ${limitNum}` : '';

          if (countMode && headMode) {
            const res = await db.query<{ cnt: number }>(
              `SELECT count(*)::int AS cnt FROM public.${table} ${tableAlias} ${whereSql};`,
              args
            );
            return { data: null, count: res.rows[0].cnt, error: null };
          }

          let sql = `SELECT ${tableAlias}.* FROM public.${table} ${tableAlias} ${whereSql} ${orderSql} ${limitSql};`;
          if (table === 'groups' && selectCols.includes('teachers')) {
            sql = `SELECT ${tableAlias}.*, CASE WHEN tr.id IS NULL THEN NULL ELSE jsonb_build_object('full_name', tr.full_name) END AS teachers FROM public.groups ${tableAlias} LEFT JOIN public.teachers tr ON tr.id = ${tableAlias}.teacher_id ${whereSql} ${orderSql} ${limitSql};`;
          } else if (table === 'students' && selectCols.includes('groups')) {
            sql = `SELECT ${tableAlias}.*, CASE WHEN gp.id IS NULL THEN NULL ELSE jsonb_build_object('name', gp.name) END AS groups FROM public.students ${tableAlias} LEFT JOIN public.groups gp ON gp.id = ${tableAlias}.group_id ${whereSql} ${orderSql} ${limitSql};`;
          } else if (table === 'attendance' && selectCols.includes('students')) {
            sql = `SELECT ${tableAlias}.*, jsonb_build_object('full_name', st.full_name, 'student_code', st.student_code) AS students FROM public.attendance ${tableAlias} LEFT JOIN public.students st ON st.id = ${tableAlias}.student_id ${whereSql} ${orderSql} ${limitSql};`;
          } else if (table === 'parent_student_links' && (selectCols.includes('profiles') || selectCols.includes('students'))) {
            sql = `SELECT ${tableAlias}.*, jsonb_build_object('full_name', pr.full_name, 'email', pr.email) AS parent, jsonb_build_object('full_name', st.full_name, 'student_code', st.student_code) AS student FROM public.parent_student_links ${tableAlias} LEFT JOIN public.profiles pr ON pr.id = ${tableAlias}.parent_id LEFT JOIN public.students st ON st.id = ${tableAlias}.student_id ${whereSql} ${orderSql} ${limitSql};`;
          }

          const res = await db.query<Record<string, unknown>>(sql, args);
          const normalized = res.rows.map((r) => ({
            ...r,
            date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date,
            assessment_date: r.assessment_date instanceof Date ? r.assessment_date.toISOString().slice(0, 10) : r.assessment_date,
            check_in_time: typeof r.check_in_time === 'string' && r.check_in_time.length >= 5 ? r.check_in_time.slice(0, 5) : r.check_in_time,
          }));
          return { data: normalized, count: countMode ? normalized.length : null, error: null };
        } catch (err: unknown) {
          const pgErr = getPgError(err, 'Select error');
          console.error('BRIDGE SELECT ERR', table, pgErr.message);
          return { data: null, count: null, error: pgErr };
        }
      });

    type SelectResult = Awaited<ReturnType<typeof executeSelect>>;
    type QueryCallback<T> = ((value: T) => unknown) | null | undefined;
    type RejectCallback = ((reason: unknown) => unknown) | null | undefined;

    const builder = {
      select(cols = '*', opts?: { count?: string; head?: boolean }) {
        selectCols = cols;
        countMode = opts?.count === 'exact';
        headMode = Boolean(opts?.head);
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push({ col, op: 'eq', val });
        return builder;
      },
      gte(col: string, val: unknown) {
        filters.push({ col, op: 'gte', val });
        return builder;
      },
      lte(col: string, val: unknown) {
        filters.push({ col, op: 'lte', val });
        return builder;
      },
      in(col: string, vals: unknown[]) {
        filters.push({ col, op: 'in', val: vals });
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderCol = col;
        orderAsc = opts?.ascending !== false;
        return builder;
      },
      limit(n: number) {
        limitNum = n;
        return builder;
      },
      async maybeSingle() {
        const res = await executeSelect();
        return { data: res.data?.[0] ?? null, error: res.error };
      },
      async single() {
        const res = await executeSelect();
        return { data: res.data?.[0] ?? null, error: res.data?.[0] ? null : { message: 'Row not found' } };
      },
      then(onFulfilled: QueryCallback<SelectResult>, onRejected: RejectCallback) {
        return executeSelect().then(onFulfilled, onRejected);
      },
      update(patch: Record<string, unknown>) {
        return {
          eq(col: string, val: unknown) {
            const runUpdate = (cols = '*') =>
              withDb(async () => {
                try {
                  await setDbRole();
                  const keys = Object.keys(patch);
                  const sets = keys
                    .map((k, i) => (k === 'teacher_id' ? `${k} = $${i + 1}::uuid` : `${k} = $${i + 1}`))
                    .join(', ');
                  const args = [...keys.map((k) => patch[k]), val];
                  const res = await db.query<Record<string, unknown>>(
                    `UPDATE public.${table} SET ${sets} WHERE ${col}::text = $${args.length}::text RETURNING *;`,
                    args
                  );
                  let rows = res.rows;
                  if (table === 'groups' && cols.includes('teachers') && rows.length > 0) {
                    const enriched = await db.query<Record<string, unknown>>(
                      `SELECT g.*, CASE WHEN tr.id IS NULL THEN NULL ELSE jsonb_build_object('full_name', tr.full_name) END AS teachers FROM public.groups g LEFT JOIN public.teachers tr ON tr.id = g.teacher_id WHERE g.id = $1::uuid;`,
                      [rows[0].id]
                    );
                    rows = enriched.rows;
                  }
                  return { data: rows, error: null };
                } catch (err: unknown) {
                  const pgErr = getPgError(err, 'Update error');
                  console.error('BRIDGE UPDATE ERR', table, pgErr.message);
                  return { data: null, error: pgErr };
                }
              });
            type UpdateResult = Awaited<ReturnType<typeof runUpdate>>;
            return {
              select(cols = '*') {
                return {
                  async maybeSingle() {
                    const res = await runUpdate(cols);
                    return { data: res.data?.[0] ?? null, error: res.error };
                  },
                  async single() {
                    const res = await runUpdate(cols);
                    return { data: res.data?.[0] ?? null, error: res.error || (res.data?.[0] ? null : { message: 'Row not found' }) };
                  },
                  then: (ok: QueryCallback<UpdateResult>, err: RejectCallback) => runUpdate(cols).then(ok, err),
                };
              },
              then: (ok: QueryCallback<UpdateResult>, err: RejectCallback) => runUpdate().then(ok, err),
            };
          },
        };
      },
      insert(rows: Record<string, unknown> | Array<Record<string, unknown>>) {
        const list = Array.isArray(rows) ? rows : [rows];
        const execInsert = () =>
          withDb(async () => {
            await setDbRole();
            if (table === 'activity_logs') {
              return { data: list, error: null };
            }
            const row = list[0];
            const keys = Object.keys(row);
            const colsSql = keys.join(', ');
            const valsSql = keys.map((_, i) => `$${i + 1}`).join(', ');
            const res = await db.query<Record<string, unknown>>(
              `INSERT INTO public.${table} (${colsSql}) VALUES (${valsSql}) RETURNING *;`,
              keys.map((k) => row[k])
            );
            return { data: res.rows, error: null };
          });
        type InsertResult = Awaited<ReturnType<typeof execInsert>>;
        return {
          select() {
            return {
              single: async () => {
                const res = await execInsert();
                return { data: res.data[0], error: null };
              },
              then: (ok: QueryCallback<InsertResult>, err: RejectCallback) => execInsert().then(ok, err),
            };
          },
          then: (ok: QueryCallback<InsertResult>, err: RejectCallback) => execInsert().then(ok, err),
        };
      },
    };
    return builder;
  }) as unknown as typeof supabase.from);
}

describe('Stage F End-to-End Demo Rehearsal (Isolated PGlite DB + Full 4-Role Flow + QR Card Image Scan)', () => {
  let db: PGlite | null = null;

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(supabaseClientModule, 'isSupabaseConfigured').mockReturnValue(true);
    db = await createStageFDemoDb();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (db) {
      await db.close();
      db = null;
    }
  });

  it('Rehearses complete Admin -> QR Card & Duplicate Scan -> Teacher (18/20 + 2 notes) -> Student -> Parent (+ Reload) workflow on ET-F-101', async () => {
    const adminId = '90000000-0000-4000-8000-000000000001';
    const teacherUid = '90000000-0000-4000-8000-000000000002';
    const studentUid = '90000000-0000-4000-8000-000000000003';
    const parentUid = '90000000-0000-4000-8000-000000000004';
    const teacherRecId = '80000000-0000-4000-8000-000000000011';
    const groupId = '70000000-0000-4000-8000-000000000011';
    const studentRecId = '60000000-0000-4000-8000-000000000011';

    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${adminId}', 'admin.demo@edutrack.local'),
        ('${teacherUid}', 'teacher.demo@edutrack.local'),
        ('${studentUid}', 'student.demo@edutrack.local'),
        ('${parentUid}', 'parent.demo@edutrack.local');

      INSERT INTO public.profiles (id, email, full_name, role) VALUES
        ('${adminId}', 'admin.demo@edutrack.local', 'Demo Admin', 'admin'),
        ('${teacherUid}', 'teacher.demo@edutrack.local', 'Mr. Rami Physics', 'teacher'),
        ('${studentUid}', 'student.demo@edutrack.local', 'Youssef Tariq', 'student'),
        ('${parentUid}', 'parent.demo@edutrack.local', 'Tariq Guardian', 'parent');

      SET ROLE authenticated;
      SET request.jwt.claim.role = 'authenticated';
      SET request.jwt.claim.sub = '${adminId}';

      INSERT INTO public.teachers (id, full_name, subject, email)
      VALUES ('${teacherRecId}', 'Mr. Rami Physics', 'Physics', 'rami.demo@edutrack.local');

      INSERT INTO public.groups (id, name, grade_level, capacity)
      VALUES ('${groupId}', 'Physics Group F1', 'Grade 10', 30);

      INSERT INTO public.students (id, full_name, student_code, group_id, grade_level, qr_code_hash, parent_name, parent_phone, status)
      VALUES ('${studentRecId}', 'Youssef Tariq', 'ET-F-101', '${groupId}', 'Grade 10', 'QR-STAGEF-101', 'Tariq Guardian', '+201001234567', 'active');

      RESET ROLE;
    `);

    const credentials = {
      'admin.demo@edutrack.local': { uid: adminId, email: 'admin.demo@edutrack.local', password: 'demo-password' },
      'teacher.demo@edutrack.local': { uid: teacherUid, email: 'teacher.demo@edutrack.local', password: 'demo-password' },
      'student.demo@edutrack.local': { uid: studentUid, email: 'student.demo@edutrack.local', password: 'demo-password' },
      'parent.demo@edutrack.local': { uid: parentUid, email: 'parent.demo@edutrack.local', password: 'demo-password' },
    };

    wirePgliteSupabaseBridge(db, credentials);

    const loginViaAuthPage = async (email: string) => {
      await waitFor(() => {
        expect(screen.getByText('Sign In to EduTrack')).toBeDefined();
      });
      fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: email } });
      fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'demo-password' } });
      fireEvent.click(screen.getByRole('button', { name: /Sign In to EduTrack/i }));
    };

    const view = render(<App />);

    // -----------------------------------------------------------------------
    // STEP 1: ADMIN — Assign Teacher to Group, Link Accounts, Open Card & Scan QR TWICE
    // -----------------------------------------------------------------------
    await loginViaAuthPage('admin.demo@edutrack.local');

    await waitFor(() => {
      expect(screen.getByText('Admin dashboard')).toBeDefined();
    });

    // Assign teacher to Physics Group F1 via Classes & Groups tab
    fireEvent.click(screen.getByRole('button', { name: /Classes & Groups/i }));
    await waitFor(() => {
      expect(screen.getByText('Physics Group F1')).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: /Assign \/ Change/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Assigned Teacher/i)).toBeDefined();
    });
    fireEvent.change(screen.getByLabelText(/Assigned Teacher/i), { target: { value: teacherRecId } });
    fireEvent.click(screen.getByRole('button', { name: /Save Assignment/i }));
    await waitFor(() => {
      expect(screen.getByText(/Group "Physics Group F1" instructor set to/i)).toBeDefined();
    });

    // Open Account Linking tab -> link Teacher, Student, Parent -> Child
    fireEvent.click(screen.getByRole('button', { name: /Account Linking/i }));
    await waitFor(() => {
      expect(screen.getByText('Teacher Account Linking')).toBeDefined();
    });

    // Link Teacher
    fireEvent.click(screen.getByRole('button', { name: /Link Account/i }));
    const tModal = screen.getByText(/Link Teacher Account/i).closest('div.bg-white') as HTMLElement;
    fireEvent.change(within(tModal).getByLabelText(/Select Account by UUID/i), { target: { value: teacherUid } });
    fireEvent.click(within(tModal).getByRole('button', { name: /Confirm Link/i }));
    await waitFor(() => {
      expect(screen.getByText(`UUID: ${teacherUid}`)).toBeDefined();
    });

    // Link Student
    fireEvent.click(screen.getByRole('button', { name: /Students \(1\)/i }));
    await waitFor(() => {
      expect(screen.getByText('Student Account Linking')).toBeDefined();
      expect(screen.getByText('ET-F-101')).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: /Link Account/i }));
    const sModal = screen.getByText('Link Student Account').closest('div.bg-white') as HTMLElement;
    fireEvent.change(within(sModal).getByLabelText(/Select Account by UUID/i), { target: { value: studentUid } });
    fireEvent.click(within(sModal).getByRole('button', { name: /Confirm Link/i }));
    await waitFor(() => {
      expect(screen.getByText(`UUID: ${studentUid}`)).toBeDefined();
    });

    // Link Parent -> Child
    fireEvent.click(screen.getByRole('button', { name: /Parents & Children/i }));
    await waitFor(() => {
      expect(screen.getByText('Parent-Child Relationship Linking')).toBeDefined();
    });
    fireEvent.change(screen.getByLabelText(/Select Parent Account/i), { target: { value: parentUid } });
    fireEvent.change(screen.getByLabelText(/Select Student \(Explicit Code & UUID\)/i), { target: { value: studentRecId } });
    fireEvent.click(screen.getByRole('button', { name: /Link Child/i }));
    await waitFor(() => {
      expect(screen.getByText('1 linked student(s)')).toBeDefined();
    });

    // Open Student ID Cards & extract actual QRCodeSVG raster bitmap
    fireEvent.click(screen.getByRole('button', { name: /Student ID Cards/i }));
    await waitFor(() => {
      expect(screen.getByText('Youssef Tariq')).toBeDefined();
      expect(screen.getByText('ET-F-101')).toBeDefined();
    });
    const qrSvg = view.container.querySelector('svg[role="img"]') as SVGElement | null;
    expect(qrSvg).not.toBeNull();
    const rasterQr = rasterizeQrSvg(qrSvg!);
    expect(rasterQr.width).toBeGreaterThanOrEqual(168);

    // Return to AdminDashboard -> Attendance -> QR Attendance Scanner -> Upload Image
    fireEvent.click(screen.getByRole('button', { name: /Back to Dashboard/i }));
    await waitFor(() => {
      expect(screen.getByText('Admin dashboard')).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: /^Attendance$/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /QR Attendance Scanner/i })).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: /QR Attendance Scanner/i }));
    await waitFor(() => {
      expect(screen.getByText('QR Code Attendance Scanner')).toBeDefined();
    });

    // Switch to Upload Image mode and feed the real rasterized Student Card QR image through handleImageUpload + jsQR
    fireEvent.click(screen.getByRole('button', { name: /Upload Image/i }));

    const origFileReader = globalThis.FileReader;
    const origImage = globalThis.Image;
    const origGetContext = HTMLCanvasElement.prototype.getContext;

    class MockFileReader {
      result: string | null = 'data:image/png;base64,STAGEF_QR_CARD';
      onload: (() => void) | null = null;
      readAsDataURL() {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    class MockImage {
      width = rasterQr.width;
      height = rasterQr.height;
      onload: (() => void) | null = null;
      set src(_v: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    Object.defineProperty(globalThis, 'FileReader', { value: MockFileReader, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'Image', { value: MockImage, configurable: true, writable: true });
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({
        data: rasterQr.data,
        width: rasterQr.width,
        height: rasterQr.height,
      })),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    const nowBase = Date.now();
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowBase);

    const fileInput = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    const cardFile = new File(['qr-card-png'], 'et-f-101-card.png', { type: 'image/png' });

    // Scan #1 via Upload Image
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [cardFile] } });
      await new Promise((r) => setTimeout(r, 80));
    });

    await waitFor(() => {
      expect(screen.getAllByText(/Check-In Confirmed/i).length).toBeGreaterThanOrEqual(1);
    });

    // Scan #2 (>3s cooldown elapsed) -> DB idempotency returns ALREADY_RECORDED with single attendance row & preserved check_in_time
    dateNowSpy.mockReturnValue(nowBase + 5000);
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [cardFile] } });
      await new Promise((r) => setTimeout(r, 80));
    });

    await waitFor(() => {
      expect(screen.getAllByText(/Already Recorded/i).length).toBeGreaterThanOrEqual(1);
    });

    // Restore browser image globals
    Object.defineProperty(globalThis, 'FileReader', { value: origFileReader, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'Image', { value: origImage, configurable: true, writable: true });
    HTMLCanvasElement.prototype.getContext = origGetContext;
    dateNowSpy.mockRestore();

    // Verify in PostgreSQL (PGlite) directly: strictly 1 attendance row with saved check_in_time
    await db.exec(`RESET ROLE;`);
    const attRows = await db.query(
      `SELECT id, status, check_in_time::text AS check_in_time FROM public.attendance WHERE student_id = $1::uuid;`,
      [studentRecId]
    );
    expect(attRows.rows).toHaveLength(1);
    expect(attRows.rows[0].status).toBe('Present');
    expect(attRows.rows[0].check_in_time).toBeTruthy();
    const savedCheckIn = String(attRows.rows[0].check_in_time).slice(0, 5);

    // Admin Sign Out
    await act(async () => {
      fireEvent.click(screen.getByTitle(/Sign Out/i));
    });

    // -----------------------------------------------------------------------
    // STEP 2: TEACHER — Login, Pick ET-F-101, Record 18/20 + Internal & Parent Notes
    // -----------------------------------------------------------------------
    await loginViaAuthPage('teacher.demo@edutrack.local');
    await waitFor(() => {
      expect(screen.getByTestId('role-portal-teacher')).toBeDefined();
      expect(screen.getByTestId(`select-student-${studentRecId}`)).toBeDefined();
      expect(screen.getByText('ET-F-101')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId(`select-student-${studentRecId}`));
    await waitFor(() => {
      expect(screen.getByTestId('teacher-student-records-panel')).toBeDefined();
      expect(screen.getByRole('button', { name: /Add Grade/i })).toBeDefined();
    });

    // Record 18 / 20 grade
    fireEvent.click(screen.getByRole('button', { name: /Add Grade/i }));
    fireEvent.change(screen.getByLabelText(/Assessment Title/i), { target: { value: 'Midterm Physics Check' } });
    fireEvent.change(screen.getByLabelText(/^Score$/i), { target: { value: '18' } });
    fireEvent.change(screen.getByLabelText(/Maximum Score/i), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Grade/i }));

    await waitFor(() => {
      expect(screen.getByText('Midterm Physics Check')).toBeDefined();
      expect(screen.getByText('18 / 20')).toBeDefined();
    });

    // Record Note 1: Internal Only
    fireEvent.click(screen.getByRole('button', { name: /Add Note/i }));
    fireEvent.change(screen.getByLabelText(/Note Text/i), {
      target: { value: 'Internal staff note: needs practice on optics lab' },
    });
    fireEvent.click(screen.getByDisplayValue('internal'));
    fireEvent.click(screen.getByRole('button', { name: /Save Note/i }));

    await waitFor(() => {
      expect(screen.getByText('Internal staff note: needs practice on optics lab')).toBeDefined();
    });

    // Record Note 2: Visible to Parent
    fireEvent.click(screen.getByRole('button', { name: /Add Note/i }));
    fireEvent.change(screen.getByLabelText(/Note Text/i), {
      target: { value: 'Parent visible note: Strong mastery in mechanics' },
    });
    fireEvent.click(screen.getByDisplayValue('parent'));
    fireEvent.click(screen.getByRole('button', { name: /Save Note/i }));

    await waitFor(() => {
      expect(screen.getByText('Parent visible note: Strong mastery in mechanics')).toBeDefined();
    });

    // Teacher Sign Out
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign Out/i }));
    });

    // -----------------------------------------------------------------------
    // STEP 3: STUDENT — Login, Sees Present + saved time + 18/20, ZERO Teacher Notes
    // -----------------------------------------------------------------------
    await loginViaAuthPage('student.demo@edutrack.local');
    await waitFor(() => {
      expect(screen.getByTestId('role-portal-student')).toBeDefined();
      expect(screen.getByTestId('student-card-code').textContent).toBe('ET-F-101');
      expect(screen.getByText('Midterm Physics Check')).toBeDefined();
      expect(screen.getByText('18 / 20')).toBeDefined();
      expect(screen.getByText('Present')).toBeDefined();
      expect(screen.getByText(savedCheckIn)).toBeDefined();
    });
    expect(document.body.textContent).not.toContain('Internal staff note: needs practice on optics lab');
    expect(document.body.textContent).not.toContain('Parent visible note: Strong mastery in mechanics');

    // Student Sign Out
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sign Out/i }));
    });

    // -----------------------------------------------------------------------
    // STEP 4: PARENT — Login, Selects ET-F-101, Sees Attendance + 18/20 + Parent-Visible Note ONLY, Reload Keeps State
    // -----------------------------------------------------------------------
    await loginViaAuthPage('parent.demo@edutrack.local');
    await waitFor(() => {
      expect(screen.getByTestId('role-portal-parent')).toBeDefined();
      expect(screen.getByTestId('parent-child-option-ET-F-101')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('parent-child-option-ET-F-101'));

    await waitFor(() => {
      expect(screen.getByTestId('parent-child-code').textContent).toBe('ET-F-101');
      expect(screen.getByText('Present')).toBeDefined();
      expect(screen.getByText(`Check-in: ${savedCheckIn}`)).toBeDefined();
      expect(screen.getByText('Midterm Physics Check')).toBeDefined();
      expect(screen.getByText('18 / 20')).toBeDefined();
      expect(screen.getByText('Parent visible note: Strong mastery in mechanics')).toBeDefined();
    });
    expect(document.body.textContent).not.toContain('Internal staff note: needs practice on optics lab');

    // Simulate full browser page reload (F5 while parent session remains active)
    view.unmount();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('role-portal-parent')).toBeDefined();
      expect(screen.getByTestId('parent-child-code').textContent).toBe('ET-F-101');
      expect(screen.getByText('18 / 20')).toBeDefined();
      expect(screen.getByText('Parent visible note: Strong mastery in mechanics')).toBeDefined();
      expect(screen.getByText('Present')).toBeDefined();
    });
    expect(document.body.textContent).not.toContain('Internal staff note: needs practice on optics lab');
  }, 30000);
});
