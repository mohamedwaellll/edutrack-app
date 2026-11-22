import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const require = createRequire(path.join(repoRoot, 'package.json'));
const { PGlite } = require('@electric-sql/pglite');

const DEMO_HOST = '127.0.0.1';
const DEMO_BRIDGE_PORT = Number(process.env.DEMO_BRIDGE_PORT || 54399);
const DEMO_PASSWORD = process.env.DEMO_USER_PASSWORD || 'demo-password';

const MIGRATIONS = [
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

export const DEMO_USERS = {
  'admin.demo@edutrack.local': {
    id: '90000000-0000-4000-8000-000000000001',
    email: 'admin.demo@edutrack.local',
    password: DEMO_PASSWORD,
    role: 'admin',
    name: 'Demo Admin',
  },
  'teacher.demo@edutrack.local': {
    id: '90000000-0000-4000-8000-000000000002',
    email: 'teacher.demo@edutrack.local',
    password: DEMO_PASSWORD,
    role: 'teacher',
    name: 'Mr. Rami Physics',
  },
  'student.demo@edutrack.local': {
    id: '90000000-0000-4000-8000-000000000003',
    email: 'student.demo@edutrack.local',
    password: DEMO_PASSWORD,
    role: 'student',
    name: 'Youssef Tariq',
  },
  'parent.demo@edutrack.local': {
    id: '90000000-0000-4000-8000-000000000004',
    email: 'parent.demo@edutrack.local',
    password: DEMO_PASSWORD,
    role: 'parent',
    name: 'Tariq Guardian',
  },
};

const TEACHER_REC_ID = '80000000-0000-4000-8000-000000000011';
const GROUP_ID = '70000000-0000-4000-8000-000000000011';
const STUDENT_REC_ID = '60000000-0000-4000-8000-000000000011';

function makeJwt(user) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: user.id,
    email: user.email,
    role: 'authenticated',
    iat: now,
    exp: now + 3600,
  })}.local-demo-sig`;
}

function decodeJwtUid(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const tok = authHeader.slice(7).trim();
  const parts = tok.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload.sub || null;
  } catch {
    return null;
  }
}

const db = new PGlite();

async function initDemoDatabase() {
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

  for (const file of MIGRATIONS) {
    const fullPath = path.join(repoRoot, 'supabase', 'migrations', file);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Missing migration file: ${fullPath}`);
    }
    await db.exec(fs.readFileSync(fullPath, 'utf8'));
  }

  const adminId = DEMO_USERS['admin.demo@edutrack.local'].id;
  const teacherUserId = DEMO_USERS['teacher.demo@edutrack.local'].id;
  const studentUserId = DEMO_USERS['student.demo@edutrack.local'].id;
  const parentUserId = DEMO_USERS['parent.demo@edutrack.local'].id;

  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${adminId}', 'admin.demo@edutrack.local'),
      ('${teacherUserId}', 'teacher.demo@edutrack.local'),
      ('${studentUserId}', 'student.demo@edutrack.local'),
      ('${parentUserId}', 'parent.demo@edutrack.local');

    INSERT INTO public.profiles (id, email, full_name, role) VALUES
      ('${adminId}', 'admin.demo@edutrack.local', 'Demo Admin', 'admin'),
      ('${teacherUserId}', 'teacher.demo@edutrack.local', 'Mr. Rami Physics', 'teacher'),
      ('${studentUserId}', 'student.demo@edutrack.local', 'Youssef Tariq', 'student'),
      ('${parentUserId}', 'parent.demo@edutrack.local', 'Tariq Guardian', 'parent');

    SET ROLE authenticated;
    SET request.jwt.claim.role = 'authenticated';
    SET request.jwt.claim.sub = '${adminId}';

    INSERT INTO public.teachers (id, full_name, subject, email)
      VALUES ('${TEACHER_REC_ID}', 'Mr. Rami Physics', 'Physics', 'rami.demo@edutrack.local');

    INSERT INTO public.groups (id, name, grade_level, teacher_id, capacity)
      VALUES ('${GROUP_ID}', 'Physics Group F1', 'Grade 10', '${TEACHER_REC_ID}', 30);

    INSERT INTO public.students (id, full_name, student_code, group_id, grade_level, qr_code_hash, parent_name, parent_phone, status)
      VALUES ('${STUDENT_REC_ID}', 'Youssef Tariq', 'ET-F-101', '${GROUP_ID}', 'Grade 10', 'QR-STAGEF-101', 'Tariq Guardian', '+201001234567', 'active');

    SELECT public.link_teacher_account('${TEACHER_REC_ID}'::uuid, '${teacherUserId}'::uuid);
    SELECT public.link_student_account('${STUDENT_REC_ID}'::uuid, '${studentUserId}'::uuid);
    SELECT public.link_parent_student('${parentUserId}'::uuid, '${STUDENT_REC_ID}'::uuid);

    RESET ROLE;
  `);
}

let lock = Promise.resolve();
const withLock = (fn) => {
  const next = lock.then(fn, fn);
  lock = next.catch(() => undefined);
  return next;
};

async function setAuth(uid) {
  if (!uid) {
    await db.exec(`SET ROLE anon; SET request.jwt.claim.role = 'anon'; SET request.jwt.claim.sub = '';`);
  } else {
    await db.exec(
      `SET ROLE authenticated; SET request.jwt.claim.role = 'authenticated'; SET request.jwt.claim.sub = '${uid}';`
    );
  }
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res, status, obj, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Expose-Headers': 'Content-Range',
    ...extraHeaders,
  });
  res.end(obj === undefined ? '' : JSON.stringify(obj));
}

function sanitizeIdent(ident) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ident)) {
    throw new Error(`Invalid SQL identifier: ${ident}`);
  }
  return ident;
}

function buildOrderSql(orderParam) {
  if (!orderParam) return '';
  const parts = orderParam.split(',').map((raw) => {
    const tokens = raw.trim().split('.');
    const col = sanitizeIdent(tokens[0]);
    const dir = tokens[1] === 'desc' ? 'DESC' : 'ASC';
    return `t.${col} ${dir}`;
  });
  return parts.length ? `ORDER BY ${parts.join(', ')}` : '';
}

function sessionPayloadForUser(user) {
  const token = makeJwt(user);
  return {
    access_token: token,
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: `ref-${user.id}`,
    user: {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      user_metadata: { full_name: user.name },
    },
  };
}

try {
  await initDemoDatabase();
} catch (err) {
  console.error('DEMO_BRIDGE_INIT_ERROR:', err?.message || err);
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${DEMO_HOST}:${DEMO_BRIDGE_PORT}`);
  const uid = decodeJwtUid(req.headers.authorization);
  const body = req.method === 'GET' || req.method === 'HEAD' ? {} : await parseBody(req);

  try {
    if (url.pathname === '/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, mode: 'pglite-demo' });
    }

    // AUTH ENDPOINTS
    if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
      const grantType = url.searchParams.get('grant_type') || 'password';
      if (grantType === 'refresh_token') {
        const refToken = String(body.refresh_token || '');
        const userId = refToken.startsWith('ref-') ? refToken.slice(4) : '';
        const user = Object.values(DEMO_USERS).find((u) => u.id === userId);
        if (!user) {
          return sendJson(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
        }
        return sendJson(res, 200, sessionPayloadForUser(user));
      }

      const email = String(body.email || '').trim().toLowerCase();
      const user = DEMO_USERS[email];
      if (!user || body.password !== user.password) {
        return sendJson(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      }
      return sendJson(res, 200, sessionPayloadForUser(user));
    }

    if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
      const user = Object.values(DEMO_USERS).find((u) => u.id === uid);
      if (!user) return sendJson(res, 401, { message: 'Invalid JWT' });
      return sendJson(res, 200, {
        id: user.id,
        aud: 'authenticated',
        role: 'authenticated',
        email: user.email,
        user_metadata: { full_name: user.name },
      });
    }

    if (url.pathname === '/auth/v1/logout' && req.method === 'POST') {
      return sendJson(res, 204, undefined);
    }

    // RPC ENDPOINTS
    if (url.pathname.startsWith('/rest/v1/rpc/') && req.method === 'POST') {
      const fn = url.pathname.replace('/rest/v1/rpc/', '');
      const result = await withLock(async () => {
        await setAuth(uid);
        let q;
        switch (fn) {
          case 'link_teacher_account':
            q = await db.query(`SELECT public.link_teacher_account($1::uuid, $2::uuid) AS res;`, [
              body.p_teacher_id,
              body.p_user_id,
            ]);
            break;
          case 'unlink_teacher_account':
            q = await db.query(`SELECT public.unlink_teacher_account($1::uuid, $2::uuid) AS res;`, [
              body.p_teacher_id,
              body.p_expected_user_id ?? null,
            ]);
            break;
          case 'link_student_account':
            q = await db.query(`SELECT public.link_student_account($1::uuid, $2::uuid) AS res;`, [
              body.p_student_id,
              body.p_user_id,
            ]);
            break;
          case 'unlink_student_account':
            q = await db.query(`SELECT public.unlink_student_account($1::uuid, $2::uuid) AS res;`, [
              body.p_student_id,
              body.p_expected_user_id ?? null,
            ]);
            break;
          case 'link_parent_student':
            q = await db.query(`SELECT public.link_parent_student($1::uuid, $2::uuid) AS res;`, [
              body.p_parent_id,
              body.p_student_id,
            ]);
            break;
          case 'unlink_parent_student':
            q = await db.query(`SELECT public.unlink_parent_student($1::uuid, $2::uuid) AS res;`, [
              body.p_parent_id,
              body.p_student_id,
            ]);
            break;
          case 'record_qr_attendance':
            q = await db.query(`SELECT public.record_qr_attendance($1::text, $2::uuid) AS res;`, [
              body.p_qr_hash,
              body.p_group_id,
            ]);
            break;
          case 'get_teacher_portal_context':
            q = await db.query(`SELECT public.get_teacher_portal_context() AS res;`);
            break;
          case 'get_teacher_group_students':
            q = await db.query(`SELECT public.get_teacher_group_students($1::uuid) AS res;`, [body.p_group_id]);
            break;
          case 'get_teacher_student_records':
            q = await db.query(`SELECT public.get_teacher_student_records($1::uuid, $2::uuid) AS res;`, [
              body.p_group_id,
              body.p_student_id,
            ]);
            break;
          case 'save_teacher_student_grade':
            q = await db.query(
              `SELECT public.save_teacher_student_grade($1::uuid, $2::uuid, $3::text, $4::public.grade_category, $5::numeric, $6::numeric, $7::date, $8::text) AS res;`,
              [
                body.p_group_id,
                body.p_student_id,
                body.p_assessment_title,
                body.p_grade_type,
                body.p_score,
                body.p_max_score,
                body.p_assessment_date,
                body.p_notes ?? body.p_remarks ?? null,
              ]
            );
            break;
          case 'save_teacher_student_note':
            q = await db.query(
              `SELECT public.save_teacher_student_note($1::uuid, $2::uuid, $3::text, $4::boolean) AS res;`,
              [body.p_group_id, body.p_student_id, body.p_feedback_text, body.p_is_parent_visible]
            );
            break;
          case 'get_student_portal_data':
            q = await db.query(`SELECT public.get_student_portal_data() AS res;`);
            break;
          case 'get_parent_portal_children':
            q = await db.query(`SELECT public.get_parent_portal_children() AS res;`);
            break;
          case 'get_parent_child_details':
            q = await db.query(`SELECT public.get_parent_child_details($1::uuid) AS res;`, [body.p_student_id]);
            break;
          default:
            return { err: { status: 404, message: `Unknown RPC ${fn}` } };
        }
        const raw = q.rows[0]?.res;
        return { data: typeof raw === 'string' ? JSON.parse(raw) : raw };
      });
      if (result.err) return sendJson(res, result.err.status, result.err);
      return sendJson(res, 200, result.data);
    }

    // TABLE REST ENDPOINTS
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = sanitizeIdent(url.pathname.replace('/rest/v1/', ''));
      const selectParam = url.searchParams.get('select') || '*';
      const accept = String(req.headers.accept || '');
      const prefer = String(req.headers.prefer || '');
      const isSingleObj = accept.includes('application/vnd.pgrst.object+json');
      const isHead = req.method === 'HEAD';

      const whereClauses = [];
      const args = [];
      for (const [k, v] of url.searchParams.entries()) {
        if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
        const col = sanitizeIdent(k);
        const dotIdx = v.indexOf('.');
        const op = v.slice(0, dotIdx);
        const rawVal = v.slice(dotIdx + 1);
        if (op === 'eq') {
          args.push(rawVal);
          whereClauses.push(`t.${col}::text = $${args.length}::text`);
        } else if (op === 'neq') {
          args.push(rawVal);
          whereClauses.push(`t.${col}::text <> $${args.length}::text`);
        } else if (op === 'gte') {
          args.push(rawVal);
          whereClauses.push(`t.${col}::text >= $${args.length}::text`);
        } else if (op === 'lte') {
          args.push(rawVal);
          whereClauses.push(`t.${col}::text <= $${args.length}::text`);
        } else if (op === 'is') {
          if (rawVal === 'null') {
            whereClauses.push(`t.${col} IS NULL`);
          } else if (rawVal === 'true' || rawVal === 'false') {
            whereClauses.push(`t.${col} IS ${rawVal.toUpperCase()}`);
          }
        } else if (op === 'in') {
          const items = rawVal
            .replace(/^\(|\)$/g, '')
            .split(',')
            .filter(Boolean);
          args.push(items);
          whereClauses.push(`t.${col}::text = ANY($${args.length}::text[])`);
        }
      }
      const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

      if (req.method === 'GET' || isHead) {
        const orderSql = buildOrderSql(url.searchParams.get('order'));
        const limitParam = url.searchParams.get('limit');
        const limitSql = limitParam && /^\d+$/.test(limitParam) ? `LIMIT ${Number(limitParam)}` : '';

        const out = await withLock(async () => {
          await setAuth(uid);
          if (isHead && prefer.includes('count=exact')) {
            const c = await db.query(`SELECT count(*)::int AS cnt FROM public.${table} t ${whereSql};`, args);
            return { headCount: c.rows[0].cnt };
          }
          let sql = `SELECT t.* FROM public.${table} t ${whereSql} ${orderSql} ${limitSql};`;
          if (table === 'groups' && selectParam.includes('teachers')) {
            sql = `SELECT t.*, CASE WHEN tr.id IS NULL THEN NULL ELSE jsonb_build_object('full_name', tr.full_name) END AS teachers FROM public.groups t LEFT JOIN public.teachers tr ON tr.id = t.teacher_id ${whereSql} ${orderSql} ${limitSql};`;
          } else if (table === 'students' && selectParam.includes('groups')) {
            sql = `SELECT t.*, CASE WHEN gp.id IS NULL THEN NULL ELSE jsonb_build_object('name', gp.name) END AS groups FROM public.students t LEFT JOIN public.groups gp ON gp.id = t.group_id ${whereSql} ${orderSql} ${limitSql};`;
          } else if (table === 'attendance' && (selectParam.includes('students') || selectParam.includes('groups'))) {
            sql = `SELECT t.*, jsonb_build_object('full_name', st.full_name, 'student_code', st.student_code) AS students, CASE WHEN gp.id IS NULL THEN NULL ELSE jsonb_build_object('name', gp.name) END AS groups FROM public.attendance t LEFT JOIN public.students st ON st.id = t.student_id LEFT JOIN public.groups gp ON gp.id = t.group_id ${whereSql} ${orderSql} ${limitSql};`;
          } else if (
            table === 'parent_student_links' &&
            (selectParam.includes('profiles') || selectParam.includes('students'))
          ) {
            sql = `SELECT t.*, jsonb_build_object('full_name', pr.full_name, 'email', pr.email) AS parent, jsonb_build_object('full_name', st.full_name, 'student_code', st.student_code) AS student FROM public.parent_student_links t LEFT JOIN public.profiles pr ON pr.id = t.parent_id LEFT JOIN public.students st ON st.id = t.student_id ${whereSql} ${orderSql} ${limitSql};`;
          }
          const q = await db.query(sql, args);
          const normalized = q.rows.map((r) => ({
            ...r,
            date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date,
            assessment_date:
              r.assessment_date instanceof Date ? r.assessment_date.toISOString().slice(0, 10) : r.assessment_date,
            check_in_time:
              typeof r.check_in_time === 'string' && r.check_in_time.length >= 5
                ? r.check_in_time.slice(0, 5)
                : r.check_in_time,
          }));
          return { rows: normalized };
        });

        if (isHead) {
          return sendJson(res, 200, undefined, { 'Content-Range': `0-0/${out.headCount}` });
        }
        if (isSingleObj) {
          if (out.rows.length === 0) return sendJson(res, 406, { code: 'PGRST116', message: '0 rows' });
          return sendJson(res, 200, out.rows[0]);
        }
        return sendJson(res, 200, out.rows);
      }

      if (req.method === 'PATCH') {
        const out = await withLock(async () => {
          await setAuth(uid);
          const keys = Object.keys(body).map(sanitizeIdent);
          const sets = keys
            .map((k, i) => (k.endsWith('_id') ? `${k} = $${i + 1}::uuid` : `${k} = $${i + 1}`))
            .join(', ');
          const allArgs = [...keys.map((k) => body[k]), ...args];
          const shiftedWhere = whereSql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + keys.length}`);
          const q = await db.query(`UPDATE public.${table} t SET ${sets} ${shiftedWhere} RETURNING t.*;`, allArgs);
          let rows = q.rows;
          if (table === 'groups' && selectParam.includes('teachers') && rows.length > 0) {
            const en = await db.query(
              `SELECT g.*, CASE WHEN tr.id IS NULL THEN NULL ELSE jsonb_build_object('full_name', tr.full_name) END AS teachers FROM public.groups g LEFT JOIN public.teachers tr ON tr.id = g.teacher_id WHERE g.id = $1::uuid;`,
              [rows[0].id]
            );
            rows = en.rows;
          }
          return rows;
        });
        return sendJson(res, 200, isSingleObj ? out[0] ?? null : out);
      }

      if (req.method === 'POST') {
        const rowsIn = Array.isArray(body) ? body : [body];
        if (table === 'activity_logs') {
          try {
            const r = rowsIn[0];
            if (r) {
              const keys = Object.keys(r).map(sanitizeIdent);
              await withLock(async () => {
                await setAuth(uid);
                await db.query(
                  `INSERT INTO public.activity_logs (${keys.join(',')}) VALUES (${keys
                    .map((_, i) => `$${i + 1}`)
                    .join(',')});`,
                  keys.map((k) => r[k])
                );
              });
            }
          } catch {
            // Activity logs must never block primary operations
          }
          return sendJson(res, 201, rowsIn);
        }
        const out = await withLock(async () => {
          await setAuth(uid);
          const r = rowsIn[0];
          const keys = Object.keys(r).map(sanitizeIdent);
          let conflictSql = '';
          if (
            table === 'attendance' &&
            url.searchParams.get('on_conflict') === 'student_id,date' &&
            prefer.split(',').some((option) => option.trim() === 'resolution=merge-duplicates')
          ) {
            const updates = keys
              .filter((key) => key !== 'student_id' && key !== 'date')
              .map((key) => `${key} = EXCLUDED.${key}`);
            conflictSql = ` ON CONFLICT (student_id, date) DO UPDATE SET ${updates.join(', ')}`;
          }
          const q = await db.query(
            `INSERT INTO public.${table} (${keys.join(',')}) VALUES (${keys
              .map((_, i) => `$${i + 1}`)
              .join(',')})${conflictSql} RETURNING *;`,
            keys.map((k) => r[k])
          );
          return q.rows;
        });
        return sendJson(res, 201, isSingleObj ? out[0] : out);
      }

      if (req.method === 'DELETE') {
        const out = await withLock(async () => {
          await setAuth(uid);
          const q = await db.query(`DELETE FROM public.${table} t ${whereSql} RETURNING *;`, args);
          return q.rows;
        });
        return sendJson(res, 200, out);
      }
    }

    return sendJson(res, 404, { message: `Unhandled route ${req.method} ${url.pathname}` });
  } catch (err) {
    return sendJson(res, 400, { message: err?.message || 'SQL error', code: err?.code });
  }
});

server.on('error', (err) => {
  console.error(`DEMO_BRIDGE_LISTEN_ERROR (${DEMO_HOST}:${DEMO_BRIDGE_PORT}): ${err?.message || err}`);
  process.exit(1);
});

server.listen(DEMO_BRIDGE_PORT, DEMO_HOST, () => {
  console.log(`DEMO_BRIDGE_READY http://${DEMO_HOST}:${DEMO_BRIDGE_PORT}`);
});
