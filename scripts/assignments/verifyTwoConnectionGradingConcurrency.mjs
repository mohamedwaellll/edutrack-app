import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocalUrl } from '../recovery-e2e/recoveryHelpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const SCENARIO_TIMEOUT_MS = 15_000;
const BLOCK_POLL_TIMEOUT_MS = 5_000;
const BLOCK_POLL_INTERVAL_MS = 40;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

function sqlLit(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Invalid numeric SQL literal: ${value}`);
    return String(value);
  }
  const str = String(value);
  if (str.includes('\0')) throw new Error('Null byte not allowed in SQL literal');
  return `'${str.replace(/'/g, "''")}'`;
}

function readSupabaseStatusEnv() {
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const raw = execFileSync(cmd, ['supabase', 'status', '-o', 'env'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim().replace(/^"|"$/g, '');
      env[key] = val;
    }
  }
  return env;
}

const LOCAL_LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function assertLocalPostgresUrl(rawUrl, label = 'DATABASE_URL') {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error(`Missing required ${label}. Only local loopback PostgreSQL URLs are allowed.`);
  }
  const connInfo = parsePostgresUrl(rawUrl.trim());
  if (!LOCAL_LOOPBACK_HOSTS.has(connInfo.host.toLowerCase())) {
    throw new Error(
      `REFUSING NON-LOCAL TARGET for ${label} ("${connInfo.host}"). Only local loopback PostgreSQL (127.0.0.1 / localhost / ::1) is allowed.`
    );
  }
}

function resolveLocalEnvironment() {
  const overrideDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (overrideDbUrl) {
    assertLocalPostgresUrl(overrideDbUrl, 'TEST_DATABASE_URL / DATABASE_URL');
    const apiUrl = process.env.SUPABASE_URL || null;
    if (apiUrl) assertLocalUrl(apiUrl, 'SUPABASE_URL');
    return {
      dbUrl: overrideDbUrl,
      apiUrl,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || null,
    };
  }

  let env;
  try {
    env = readSupabaseStatusEnv();
  } catch (err) {
    throw new Error(
      `Local PostgreSQL/Supabase not available. Start local Supabase (\`npx supabase start\`) or set TEST_DATABASE_URL to a local PostgreSQL database. (${err instanceof Error ? err.message : String(err)})`,
      { cause: err }
    );
  }

  const dbUrl = env.DB_URL;
  const apiUrl = env.API_URL || 'http://127.0.0.1:54321';
  const serviceRoleKey = env.SERVICE_ROLE_KEY || null;

  if (!dbUrl) {
    throw new Error('Local Supabase DB_URL not found in `npx supabase status -o env`. Run `npx supabase start` first.');
  }
  assertLocalPostgresUrl(dbUrl, 'DB_URL');
  assertLocalUrl(apiUrl, 'API_URL');

  return { dbUrl, apiUrl, serviceRoleKey };
}

function parsePostgresUrl(dbUrl) {
  const parsed = new URL(dbUrl);
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`Unsupported database protocol: ${parsed.protocol}`);
  }
  return {
    host: parsed.hostname.replace(/^\[(.*)\]$/, '$1'),
    port: parsed.port ? Number(parsed.port) : 5432,
    user: decodeURIComponent(parsed.username || 'postgres'),
    password: decodeURIComponent(parsed.password || ''),
    database: decodeURIComponent((parsed.pathname || '/postgres').replace(/^\//, '') || 'postgres'),
  };
}

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

function xorBuffers(a, b) {
  const out = Buffer.allocUnsafe(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

function parseScramPairs(str) {
  const map = {};
  for (const part of str.split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) map[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return map;
}

function decodePgValue(rawText, typeOid) {
  if (rawText === null) return null;
  // int2 (21), int4 (23), int8 (20), oid (26)
  if (typeOid === 20 || typeOid === 21 || typeOid === 23 || typeOid === 26) {
    return Number(rawText);
  }
  // bool (16)
  if (typeOid === 16) {
    return rawText === 't';
  }
  // json (114), jsonb (3802)
  if (typeOid === 114 || typeOid === 3802) {
    return JSON.parse(rawText);
  }
  // int4[] (1007), int8[] (1016)
  if (typeOid === 1007 || typeOid === 1016) {
    const inner = rawText.replace(/^\{|\}$/g, '').trim();
    if (!inner) return [];
    return inner.split(',').map((item) => Number(item.trim()));
  }
  return rawText;
}

/**
 * Minimal zero-dependency PostgreSQL v3 wire-protocol client for Simple Query
 * transactions (supports trust, cleartext, md5, and SCRAM-SHA-256 auth).
 */
class PgWireClient {
  constructor(connInfo, name = 'pg') {
    this.connInfo = connInfo;
    this.name = name;
    this.socket = null;
    this.recvBuffer = Buffer.alloc(0);
    this.closed = false;
    this.activeWaiter = null;
    this.scramState = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({
        host: this.connInfo.host,
        port: this.connInfo.port,
      });
      this.socket = socket;

      const onError = (err) => {
        if (this.activeWaiter) {
          const waiter = this.activeWaiter;
          this.activeWaiter = null;
          waiter.reject(err);
        } else {
          reject(err);
        }
      };

      socket.on('error', onError);
      socket.on('close', () => {
        this.closed = true;
        if (this.activeWaiter) {
          const waiter = this.activeWaiter;
          this.activeWaiter = null;
          waiter.reject(new Error(`[${this.name}] PostgreSQL connection closed unexpectedly.`));
        }
      });
      socket.on('data', (chunk) => {
        this.recvBuffer = Buffer.concat([this.recvBuffer, chunk]);
        this.drainMessages();
      });

      socket.once('connect', () => {
        this.activeWaiter = {
          mode: 'startup',
          fields: [],
          rows: [],
          commandTag: null,
          error: null,
          resolve: () => resolve(this),
          reject,
        };
        this.sendStartup();
      });
    });
  }

  sendStartup() {
    const params = Buffer.from(
      `user\0${this.connInfo.user}\0database\0${this.connInfo.database}\0client_encoding\0UTF8\0\0`,
      'utf8'
    );
    const pkt = Buffer.allocUnsafe(8 + params.length);
    pkt.writeInt32BE(8 + params.length, 0);
    pkt.writeInt32BE(196608, 4); // protocol 3.0
    params.copy(pkt, 8);
    this.socket.write(pkt);
  }

  sendPasswordMessage(payloadBuf) {
    const pkt = Buffer.allocUnsafe(5 + payloadBuf.length);
    pkt[0] = 0x70; // 'p'
    pkt.writeInt32BE(4 + payloadBuf.length, 1);
    payloadBuf.copy(pkt, 5);
    this.socket.write(pkt);
  }

  query(sql) {
    if (this.closed || !this.socket) {
      return Promise.reject(new Error(`[${this.name}] Connection is closed.`));
    }
    if (this.activeWaiter) {
      return Promise.reject(new Error(`[${this.name}] Another query is already active on this connection.`));
    }
    return new Promise((resolve, reject) => {
      this.activeWaiter = {
        mode: 'query',
        fields: [],
        rows: [],
        commandTag: null,
        error: null,
        resolve,
        reject,
      };
      const sqlBuf = Buffer.from(`${sql}\0`, 'utf8');
      const pkt = Buffer.allocUnsafe(5 + sqlBuf.length);
      pkt[0] = 0x51; // 'Q'
      pkt.writeInt32BE(4 + sqlBuf.length, 1);
      sqlBuf.copy(pkt, 5);
      this.socket.write(pkt);
    });
  }

  async close() {
    if (this.closed || !this.socket) return;
    try {
      const term = Buffer.from([0x58, 0x00, 0x00, 0x00, 0x04]); // 'X'
      this.socket.write(term);
    } catch {
      // ignore write error on close
    }
    this.socket.destroy();
    this.closed = true;
  }

  drainMessages() {
    while (this.recvBuffer.length >= 5) {
      const type = String.fromCharCode(this.recvBuffer[0]);
      const len = this.recvBuffer.readInt32BE(1);
      if (this.recvBuffer.length < 1 + len) break;
      const body = this.recvBuffer.subarray(5, 1 + len);
      this.recvBuffer = this.recvBuffer.subarray(1 + len);
      this.handleMessage(type, body);
    }
  }

  handleMessage(type, body) {
    const waiter = this.activeWaiter;
    if (!waiter) return;

    if (type === 'R') {
      const authType = body.readInt32BE(0);
      if (authType === 0) return; // AuthenticationOk
      if (authType === 3) {
        this.sendPasswordMessage(Buffer.from(`${this.connInfo.password}\0`, 'utf8'));
        return;
      }
      if (authType === 5) {
        const salt = body.subarray(4, 8);
        const inner = crypto
          .createHash('md5')
          .update(`${this.connInfo.password}${this.connInfo.user}`)
          .digest('hex');
        const outer = crypto
          .createHash('md5')
          .update(Buffer.concat([Buffer.from(inner, 'utf8'), salt]))
          .digest('hex');
        this.sendPasswordMessage(Buffer.from(`md5${outer}\0`, 'utf8'));
        return;
      }
      if (authType === 10) {
        const mechs = body.subarray(4).toString('utf8').split('\0').filter(Boolean);
        if (!mechs.includes('SCRAM-SHA-256')) {
          waiter.reject(new Error(`Unsupported SASL mechanisms: ${mechs.join(', ')}`));
          this.activeWaiter = null;
          return;
        }
        const clientNonce = crypto.randomBytes(18).toString('base64');
        const clientFirstBare = `n=,r=${clientNonce}`;
        const clientFirstMsg = `n,,${clientFirstBare}`;
        this.scramState = { clientNonce, clientFirstBare };

        const mechBuf = Buffer.from('SCRAM-SHA-256\0', 'utf8');
        const msgBuf = Buffer.from(clientFirstMsg, 'utf8');
        const payload = Buffer.allocUnsafe(mechBuf.length + 4 + msgBuf.length);
        mechBuf.copy(payload, 0);
        payload.writeInt32BE(msgBuf.length, mechBuf.length);
        msgBuf.copy(payload, mechBuf.length + 4);
        this.sendPasswordMessage(payload);
        return;
      }
      if (authType === 11) {
        const serverFirstMsg = body.subarray(4).toString('utf8');
        const parsed = parseScramPairs(serverFirstMsg);
        const { clientNonce, clientFirstBare } = this.scramState;
        if (!parsed.r || !parsed.r.startsWith(clientNonce)) {
          waiter.reject(new Error('SCRAM-SHA-256 server nonce mismatch.'));
          this.activeWaiter = null;
          return;
        }
        const salt = Buffer.from(parsed.s, 'base64');
        const iterations = Number(parsed.i);
        const saltedPassword = crypto.pbkdf2Sync(this.connInfo.password, salt, iterations, 32, 'sha256');
        const clientKey = hmacSha256(saltedPassword, 'Client Key');
        const storedKey = sha256(clientKey);
        const clientFinalWithoutProof = `c=biws,r=${parsed.r}`;
        const authMessage = `${clientFirstBare},${serverFirstMsg},${clientFinalWithoutProof}`;
        const clientSignature = hmacSha256(storedKey, authMessage);
        const clientProof = xorBuffers(clientKey, clientSignature).toString('base64');
        const serverKey = hmacSha256(saltedPassword, 'Server Key');
        this.scramState.expectedServerSig = hmacSha256(serverKey, authMessage).toString('base64');

        const clientFinalMsg = `${clientFinalWithoutProof},p=${clientProof}`;
        this.sendPasswordMessage(Buffer.from(clientFinalMsg, 'utf8'));
        return;
      }
      if (authType === 12) {
        const serverFinal = parseScramPairs(body.subarray(4).toString('utf8'));
        if (serverFinal.v !== this.scramState?.expectedServerSig) {
          waiter.reject(new Error('SCRAM-SHA-256 server signature verification failed.'));
          this.activeWaiter = null;
        }
        return;
      }
      waiter.reject(new Error(`Unsupported PostgreSQL authType: ${authType}`));
      this.activeWaiter = null;
      return;
    }

    if (type === 'T') {
      const count = body.readInt16BE(0);
      let offset = 2;
      const fields = [];
      for (let i = 0; i < count; i++) {
        const nul = body.indexOf(0, offset);
        const name = body.subarray(offset, nul).toString('utf8');
        offset = nul + 1;
        // tableOid(4), colAttr(2), typeOid(4), typeSize(2), typeMod(4), format(2)
        const typeOid = body.readInt32BE(offset + 6);
        offset += 18;
        fields.push({ name, typeOid });
      }
      waiter.fields = fields;
      return;
    }

    if (type === 'D') {
      const count = body.readInt16BE(0);
      let offset = 2;
      const row = {};
      for (let i = 0; i < count; i++) {
        const colLen = body.readInt32BE(offset);
        offset += 4;
        let val = null;
        if (colLen >= 0) {
          const text = body.subarray(offset, offset + colLen).toString('utf8');
          offset += colLen;
          val = decodePgValue(text, waiter.fields[i]?.typeOid);
        }
        const fieldName = waiter.fields[i]?.name ?? `col_${i}`;
        row[fieldName] = val;
      }
      waiter.rows.push(row);
      return;
    }

    if (type === 'C') {
      waiter.commandTag = body.subarray(0, body.length - 1).toString('utf8');
      return;
    }

    if (type === 'E') {
      let offset = 0;
      const info = {};
      while (offset < body.length) {
        const code = String.fromCharCode(body[offset]);
        offset += 1;
        if (code === '\0') break;
        const nul = body.indexOf(0, offset);
        info[code] = body.subarray(offset, nul).toString('utf8');
        offset = nul + 1;
      }
      const err = new Error(info.M || 'PostgreSQL error');
      err.code = info.C;
      err.detail = info.D;
      waiter.error = err;
      return;
    }

    if (type === 'Z') {
      this.activeWaiter = null;
      if (waiter.error) {
        waiter.reject(waiter.error);
      } else {
        waiter.resolve({
          fields: waiter.fields,
          rows: waiter.rows,
          commandTag: waiter.commandTag,
        });
      }
    }
  }
}

async function applyTeacherSession(conn, teacherUserId) {
  const claims = JSON.stringify({ sub: teacherUserId, role: 'authenticated' });
  await conn.query(
    `SET LOCAL ROLE authenticated;
     SELECT set_config('request.jwt.claim.sub', ${sqlLit(teacherUserId)}, true);
     SELECT set_config('request.jwt.claim.role', 'authenticated', true);
     SELECT set_config('request.jwt.claims', ${sqlLit(claims)}, true);`
  );
}

async function waitForBlockingPid(connMonitor, blockedPid, blockerPid) {
  const deadline = Date.now() + BLOCK_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await connMonitor.query(
      `SELECT pid, state, wait_event_type, wait_event, pg_blocking_pids(pid) AS blocking_pids
       FROM pg_stat_activity
       WHERE pid = ${Number(blockedPid)};`
    );
    const row = res.rows[0];
    if (row && Array.isArray(row.blocking_pids) && row.blocking_pids.includes(blockerPid)) {
      return row;
    }
    await sleep(BLOCK_POLL_INTERVAL_MS);
  }
  throw new Error(
    `Connection B (pid=${blockedPid}) was not observed waiting on Connection A (pid=${blockerPid}) via pg_blocking_pids() within ${BLOCK_POLL_TIMEOUT_MS}ms.`
  );
}

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

async function setupFixture({ apiUrl, serviceRoleKey, connMonitor, runId }) {
  const teacherEmail = `concurrency.teacher.${runId}@edutrack.local`;
  const password = `Conc_${crypto.randomBytes(8).toString('hex')}!1`;

  let teacherUserId;
  if (apiUrl && serviceRoleKey) {
    const adminHeaders = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    };
    const userRes = await jsonFetch(`${apiUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        email: teacherEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: 'Concurrency Teacher' },
      }),
    });
    teacherUserId = userRes.id;
  } else {
    teacherUserId = crypto.randomUUID();
    await connMonitor.query(
      `INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, aud, role)
       VALUES (${sqlLit(teacherUserId)}::uuid, ${sqlLit(teacherEmail)}, '', NOW(), '{"full_name":"Concurrency Teacher"}'::jsonb, NOW(), NOW(), 'authenticated', 'authenticated');`
    );
  }

  await connMonitor.query(
    `INSERT INTO public.profiles (id, email, full_name, role)
     VALUES (${sqlLit(teacherUserId)}::uuid, ${sqlLit(teacherEmail)}, 'Concurrency Teacher', 'teacher')
     ON CONFLICT (id) DO UPDATE SET role = 'teacher', email = EXCLUDED.email;`
  );

  const teacherRes = await connMonitor.query(
    `INSERT INTO public.teachers (full_name, subject, email)
     VALUES ('Concurrency Teacher', 'Physics', ${sqlLit(`rec.${teacherEmail}`)})
     RETURNING id;`
  );
  const teacherRecId = teacherRes.rows[0].id;

  await connMonitor.query(
    `UPDATE public.teachers SET user_id = ${sqlLit(teacherUserId)}::uuid WHERE id = ${sqlLit(teacherRecId)}::uuid;`
  );

  const groupRes = await connMonitor.query(
    `INSERT INTO public.groups (name, grade_level, teacher_id, capacity)
     VALUES (${sqlLit(`Conc Group ${runId}`)}, 'Grade 10', ${sqlLit(teacherRecId)}::uuid, 30)
     RETURNING id;`
  );
  const groupId = groupRes.rows[0].id;

  const studentRes = await connMonitor.query(
    `INSERT INTO public.students (full_name, student_code, grade_level, group_id, qr_code_hash, status)
     VALUES ('Concurrency Student', ${sqlLit(`CONC-${runId}`)}, 'Grade 10', ${sqlLit(groupId)}::uuid, ${sqlLit(`QR-CONC-${runId}`)}, 'active')
     RETURNING id;`
  );
  const studentRecId = studentRes.rows[0].id;

  const pastDueIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const assignmentRes = await connMonitor.query(
    `INSERT INTO public.assignments (group_id, teacher_id, title, instructions, due_at)
     VALUES (${sqlLit(groupId)}::uuid, ${sqlLit(teacherRecId)}::uuid, ${sqlLit(`Concurrency Assignment ${runId}`)}, 'Test instructions', ${sqlLit(pastDueIso)}::timestamptz)
     RETURNING id;`
  );
  const assignmentId = assignmentRes.rows[0].id;

  const subRes = await connMonitor.query(
    `INSERT INTO public.assignment_submissions (assignment_id, student_id, answer_text)
     VALUES (${sqlLit(assignmentId)}::uuid, ${sqlLit(studentRecId)}::uuid, 'Concurrent test answer')
     RETURNING id;`
  );
  const submissionId = subRes.rows[0].id;

  return { teacherUserId, teacherRecId, groupId, studentRecId, assignmentId, submissionId };
}

async function runLockedScenario({
  label,
  connA,
  connB,
  connMonitor,
  pidA,
  pidB,
  teacherUserId,
  submissionId,
  scoreA,
  scoreB,
  maxScore,
  expectedVersion,
  expectedWinnerVersion,
}) {
  // 1. Open transaction on Connection A and grade, leaving transaction uncommitted
  await connA.query('BEGIN;');
  await connA.query(`SET LOCAL lock_timeout = '15s'; SET LOCAL statement_timeout = '15s';`);
  await applyTeacherSession(connA, teacherUserId);

  const resA = await withTimeout(
    connA.query(
      `SELECT public.grade_assignment_submission(
         ${sqlLit(submissionId)}::uuid,
         ${Number(scoreA)},
         ${Number(maxScore)},
         ${expectedVersion === null ? 'NULL' : Number(expectedVersion)}::integer
       ) AS result;`
    ),
    SCENARIO_TIMEOUT_MS,
    `${label}: Connection A grade_assignment_submission`
  );
  const resultA = resA.rows[0]?.result;
  if (!resultA || resultA.saved !== true || Number(resultA.grade?.score) !== scoreA || Number(resultA.grade?.grade_version) !== expectedWinnerVersion) {
    throw new Error(`${label}: unexpected Connection A result before COMMIT: ${JSON.stringify(resultA)}`);
  }

  // 2. Open transaction on Connection B with the same expected version -> blocks on row lock held by A
  await connB.query('BEGIN;');
  await connB.query(`SET LOCAL lock_timeout = '15s'; SET LOCAL statement_timeout = '15s';`);
  await applyTeacherSession(connB, teacherUserId);

  const promiseB = withTimeout(
    connB.query(
      `SELECT public.grade_assignment_submission(
         ${sqlLit(submissionId)}::uuid,
         ${Number(scoreB)},
         ${Number(maxScore)},
         ${expectedVersion === null ? 'NULL' : Number(expectedVersion)}::integer
       ) AS result;`
    ),
    SCENARIO_TIMEOUT_MS,
    `${label}: Connection B grade_assignment_submission`
  );

  // 3. Before COMMIT, verify via pg_blocking_pids() that B is actively waiting on A
  const waitProof = await waitForBlockingPid(connMonitor, pidB, pidA);

  // 4. Commit Connection A so Connection B unblocks and observes the committed grade
  await connA.query('COMMIT;');

  const resB = await promiseB;
  await connB.query('COMMIT;');

  const resultB = resB.rows[0]?.result;
  if (
    !resultB ||
    resultB.saved !== false ||
    resultB.conflict !== true ||
    Number(resultB.grade?.score) !== scoreA ||
    Number(resultB.grade?.grade_version) !== expectedWinnerVersion
  ) {
    throw new Error(
      `${label}: expected Connection B conflict with score=${scoreA}, grade_version=${expectedWinnerVersion}, got ${JSON.stringify(resultB)}`
    );
  }

  // 5. Verify exactly 1 grade row exists in PostgreSQL
  const gradeCheck = await connMonitor.query(
    `SELECT id, score, max_score, grade_version
     FROM public.grades
     WHERE assignment_submission_id = ${sqlLit(submissionId)}::uuid;`
  );
  if (gradeCheck.rows.length !== 1) {
    throw new Error(`${label}: expected exactly 1 grade row, found ${gradeCheck.rows.length}`);
  }
  const finalRow = gradeCheck.rows[0];
  if (Number(finalRow.score) !== scoreA || Number(finalRow.grade_version) !== expectedWinnerVersion) {
    throw new Error(`${label}: unexpected persisted grade row: ${JSON.stringify(finalRow)}`);
  }

  const report = {
    scenario: label,
    waitProof: {
      pidA,
      pidB,
      wait_event_type: waitProof.wait_event_type,
      wait_event: waitProof.wait_event,
      pg_blocking_pids: waitProof.blocking_pids,
    },
    finalScore: Number(finalRow.score),
    finalMaxScore: Number(finalRow.max_score),
    finalGradeVersion: Number(finalRow.grade_version),
    gradeRowCount: gradeCheck.rows.length,
    connectionBConflict: resultB.conflict,
  };
  console.log(JSON.stringify(report));
  return report;
}

async function main() {
  const { dbUrl, apiUrl, serviceRoleKey } = resolveLocalEnvironment();
  const connInfo = parsePostgresUrl(dbUrl);
  const runId = crypto.randomUUID().slice(0, 8);

  const connMonitor = new PgWireClient(connInfo, 'monitor');
  const connA = new PgWireClient(connInfo, 'connA');
  const connB = new PgWireClient(connInfo, 'connB');

  let fixture = null;

  try {
    await withTimeout(
      Promise.all([connMonitor.connect(), connA.connect(), connB.connect()]),
      SCENARIO_TIMEOUT_MS,
      'Connecting to local PostgreSQL'
    );

    const [{ rows: rA }, { rows: rB }] = await Promise.all([
      connA.query('SELECT pg_backend_pid() AS pid;'),
      connB.query('SELECT pg_backend_pid() AS pid;'),
    ]);
    const pidA = rA[0].pid;
    const pidB = rB[0].pid;

    fixture = await setupFixture({ apiUrl, serviceRoleKey, connMonitor, runId });

    // Scenario 1: Initial grading (null -> 1)
    await runLockedScenario({
      label: 'Scenario 1: initial grading (null -> 1)',
      connA,
      connB,
      connMonitor,
      pidA,
      pidB,
      teacherUserId: fixture.teacherUserId,
      submissionId: fixture.submissionId,
      scoreA: 18,
      scoreB: 14,
      maxScore: 20,
      expectedVersion: null,
      expectedWinnerVersion: 1,
    });

    // Scenario 2: Updating existing grade (1 -> 2)
    await runLockedScenario({
      label: 'Scenario 2: update existing grade (v1 -> v2)',
      connA,
      connB,
      connMonitor,
      pidA,
      pidB,
      teacherUserId: fixture.teacherUserId,
      submissionId: fixture.submissionId,
      scoreA: 19,
      scoreB: 12,
      maxScore: 20,
      expectedVersion: 1,
      expectedWinnerVersion: 2,
    });
  } finally {
    await connA.query('ROLLBACK;').catch(() => {});
    await connB.query('ROLLBACK;').catch(() => {});
    await connA.close().catch(() => {});
    await connB.close().catch(() => {});

    if (fixture) {
      await connMonitor
        .query(`DELETE FROM public.grades WHERE assignment_submission_id = ${sqlLit(fixture.submissionId)}::uuid;`)
        .catch(() => {});
      await connMonitor
        .query(`DELETE FROM public.assignment_submissions WHERE id = ${sqlLit(fixture.submissionId)}::uuid;`)
        .catch(() => {});
      await connMonitor
        .query(`DELETE FROM public.assignments WHERE id = ${sqlLit(fixture.assignmentId)}::uuid;`)
        .catch(() => {});
      await connMonitor
        .query(`DELETE FROM public.students WHERE id = ${sqlLit(fixture.studentRecId)}::uuid;`)
        .catch(() => {});
      await connMonitor
        .query(`DELETE FROM public.groups WHERE id = ${sqlLit(fixture.groupId)}::uuid;`)
        .catch(() => {});
      await connMonitor
        .query(`DELETE FROM public.teachers WHERE id = ${sqlLit(fixture.teacherRecId)}::uuid;`)
        .catch(() => {});
      await connMonitor
        .query(`DELETE FROM public.profiles WHERE id = ${sqlLit(fixture.teacherUserId)}::uuid;`)
        .catch(() => {});

      if (apiUrl && serviceRoleKey) {
        await fetch(`${apiUrl}/auth/v1/admin/users/${fixture.teacherUserId}`, {
          method: 'DELETE',
          headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
          },
        }).catch(() => {});
      } else {
        await connMonitor
          .query(`DELETE FROM auth.users WHERE id = ${sqlLit(fixture.teacherUserId)}::uuid;`)
          .catch(() => {});
      }
    }

    await connMonitor.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
