import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { assertLocalUrl, redactSensitive } from '../recovery-e2e/recoveryHelpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const ASSIGNMENT_BUCKET = 'assignment-attachments';
const SUBMISSION_BUCKET = 'assignment-submissions';
const MAX_REDIRECT_HOPS = 3;
export const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

function withTimeoutSignal(existingSignal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms.`));
  }, timeoutMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  const onAbort = () => {
    controller.abort(existingSignal?.reason);
  };
  if (existingSignal) {
    if (existingSignal.aborted) {
      controller.abort(existingSignal.reason);
    } else {
      existingSignal.addEventListener('abort', onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (existingSignal) {
        existingSignal.removeEventListener('abort', onAbort);
      }
    },
  };
}

export function createLoopbackNoRedirectFetch({
  fetchImpl = fetch,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  return async (input, init = {}) => {
    const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    assertLocalUrl(rawUrl, 'Supabase SDK request URL');

    const { signal, cleanup } = withTimeoutSignal(init?.signal, timeoutMs);
    try {
      return await fetchImpl(input, {
        ...init,
        redirect: 'error',
        signal,
      });
    } finally {
      cleanup();
    }
  };
}

export function resolveLocalSupabaseStorageEnv(env = process.env) {
  const overrideUrl = (env.LOCAL_SUPABASE_URL || '').trim();
  const overrideAnon = (env.LOCAL_SUPABASE_ANON_KEY || '').trim();
  const overrideService = (env.LOCAL_SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (overrideUrl || overrideAnon || overrideService) {
    if (!overrideUrl || !overrideAnon || !overrideService) {
      throw new Error(
        'When using explicit env overrides, LOCAL_SUPABASE_URL, LOCAL_SUPABASE_ANON_KEY, and LOCAL_SUPABASE_SERVICE_ROLE_KEY are all required.'
      );
    }
    return {
      supabaseUrl: assertLocalUrl(overrideUrl, 'LOCAL_SUPABASE_URL'),
      anonKey: overrideAnon,
      serviceRoleKey: overrideService,
    };
  }

  let statusRaw = '';
  const commands =
    process.platform === 'win32'
      ? ['supabase.cmd status -o json', 'npx.cmd supabase status -o json']
      : ['supabase status -o json', 'npx supabase status -o json'];

  for (const cmd of commands) {
    try {
      statusRaw = execSync(cmd, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (statusRaw && statusRaw.trim().startsWith('{')) break;
    } catch {
      // Try next CLI command
    }
  }

  if (!statusRaw || !statusRaw.trim().startsWith('{')) {
    throw new Error(
      'Local Supabase CLI status is unavailable. Start Docker and run "supabase start" (or set LOCAL_SUPABASE_URL, LOCAL_SUPABASE_ANON_KEY, LOCAL_SUPABASE_SERVICE_ROLE_KEY).'
    );
  }

  const statusJson = JSON.parse(statusRaw);
  const rawUrl = statusJson.API_URL || statusJson.api_url || 'http://127.0.0.1:54321';
  const anonKey = statusJson.ANON_KEY || statusJson.anon_key || '';
  const serviceRoleKey = statusJson.SERVICE_ROLE_KEY || statusJson.service_role_key || '';

  if (!anonKey || !serviceRoleKey) {
    throw new Error('Local Supabase status did not return ANON_KEY and SERVICE_ROLE_KEY.');
  }

  return {
    supabaseUrl: assertLocalUrl(rawUrl, 'Local Supabase API_URL'),
    anonKey,
    serviceRoleKey,
  };
}

export async function downloadSignedPdfWithLoopbackGuard(
  signedUrl,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
) {
  assertLocalUrl(signedUrl, 'Signed download URL');
  let currentUrl = signedUrl;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const { signal, cleanup } = withTimeoutSignal(undefined, timeoutMs);
    try {
      const res = await fetchImpl(currentUrl, { method: 'GET', redirect: 'manual', signal });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await res.body?.cancel();
        if (!location) {
          throw new Error(`Signed download returned ${res.status} redirect without Location header.`);
        }
        const nextUrl = new URL(location, currentUrl).toString();
        assertLocalUrl(nextUrl, 'Signed download redirect URL');
        currentUrl = nextUrl;
        continue;
      }

      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`Signed download failed with HTTP ${res.status}.`);
      }
      return Buffer.from(await res.arrayBuffer());
    } finally {
      cleanup();
    }
  }

  throw new Error(`Signed download exceeded ${MAX_REDIRECT_HOPS} loopback redirects.`);
}

function buildSyntheticPdfBytes(label, runId) {
  const safeLabel = String(label).replace(/[^a-zA-Z0-9_-]/g, '');
  const contents = `BT /F1 14 Tf 24 96 Td (EduTrack ${safeLabel} ${runId}) Tj ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 140] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(contents)} >>\nstream\n${contents}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(pdf);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const crossReferenceOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${crossReferenceOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

function createAuthClient(supabaseUrl, anonKey, customFetch = createLoopbackNoRedirectFetch()) {
  return createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: customFetch,
    },
  });
}

async function createSyntheticUser({ serviceClient, email, password, fullName, role, runState }) {
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data?.user?.id) {
    throw new Error(`Failed to create synthetic ${role} user: ${error?.message || 'missing user id'}`);
  }
  const userId = data.user.id;
  runState.userIds.push(userId);

  const { error: profileError } = await serviceClient.from('profiles').upsert({
    id: userId,
    email,
    full_name: fullName,
    role,
  });
  if (profileError) {
    throw new Error(`Failed to upsert ${role} profile: ${profileError.message}`);
  }

  const client = createAuthClient(runState.supabaseUrl, runState.anonKey);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) {
    throw new Error(`Failed to sign in synthetic ${role}: ${signInError.message}`);
  }

  return { userId, client };
}

async function authorizeAndDownloadBytes({ client, rpcName, attachmentId, secrets }) {
  const { data, error } = await client.rpc(rpcName, { p_attachment_id: attachmentId });
  if (error) {
    throw new Error(`${rpcName} failed: ${error.message}`);
  }
  const att = data?.attachment;
  if (!att?.bucket_id || !att?.object_path) {
    throw new Error(`${rpcName} returned incomplete attachment metadata.`);
  }

  const { data: signedData, error: signError } = await client.storage
    .from(att.bucket_id)
    .createSignedUrl(att.object_path, 60);

  if (signError || !signedData?.signedUrl) {
    throw new Error(`createSignedUrl failed: ${signError?.message || 'missing signedUrl'}`);
  }
  secrets.push(signedData.signedUrl);

  return downloadSignedPdfWithLoopbackGuard(signedData.signedUrl);
}

async function assertDenied({ label, client, rpcName, attachmentId, bucketId, objectPath, secrets }) {
  const { error: rpcError } = await client.rpc(rpcName, {
    p_attachment_id: attachmentId,
  });
  if (rpcError?.code !== '42501') {
    throw new Error(`Expected ${rpcName} access denial for ${label}: ${rpcError?.message || 'RPC did not deny access'}.`);
  }

  const { data: signData, error: signError } = await client.storage
    .from(bucketId)
    .createSignedUrl(objectPath, 60);

  if (signData?.signedUrl) secrets.push(signData.signedUrl);
  if (signData?.signedUrl || signError?.name !== 'StorageApiError' || ![400, 403, 404].includes(Number(signError.status))) {
    throw new Error(`Expected Storage signing denial for ${label}: ${signError?.message || 'Storage did not deny access'}.`);
  }
}

export async function runLocalStoragePdfSmoke() {
  const { supabaseUrl, anonKey, serviceRoleKey } = resolveLocalSupabaseStorageEnv();
  const runId = crypto.randomBytes(6).toString('hex');
  const password = `Smoke-${crypto.randomBytes(8).toString('hex')}!1`;
  const secrets = [anonKey, serviceRoleKey, password];

  const serviceClient = createAuthClient(supabaseUrl, serviceRoleKey);

  // Preflight actual Supabase Storage before creating any fixtures
  const { data: buckets, error: bucketsError } = await serviceClient.storage.listBuckets();
  if (bucketsError || !Array.isArray(buckets)) {
    throw new Error(
      `Supabase Storage preflight failed at ${supabaseUrl}: ${bucketsError?.message || 'unavailable'}`
    );
  }
  for (const requiredBucket of [ASSIGNMENT_BUCKET, SUBMISSION_BUCKET]) {
    const found = buckets.find((b) => b.id === requiredBucket);
    if (!found) {
      throw new Error(
        `Storage preflight failed: bucket "${requiredBucket}" not found. Apply Stage F4/F5 migrations first.`
      );
    }
    if (found.public !== false) {
      throw new Error(`Storage preflight failed: bucket "${requiredBucket}" must be private.`);
    }
  }

  const runState = {
    supabaseUrl,
    anonKey,
    userIds: [],
    storageObjects: [],
    assignmentIds: [],
    studentIds: [],
    groupIds: [],
    teacherIds: [],
    parentLinkIds: [],
  };
  const cleanupErrors = [];
  let primaryError = null;
  let assignmentPdfBytesLength = 0;
  let submissionPdfBytesLength = 0;

  try {
    const makeEmail = (roleTag) => `storage.${roleTag}.${runId}@edutrack.local`;

    // Provision a unique admin via service-role provision_admin, then sign in as that admin
    // so account linking runs through the real authenticated admin RPCs.
    const adminEmail = makeEmail('admin');
    const adminFullName = `Storage Smoke Admin ${runId}`;
    const { data: adminAuthData, error: adminAuthErr } = await serviceClient.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: adminFullName },
    });
    if (adminAuthErr || !adminAuthData?.user?.id) {
      throw new Error(
        `Failed to create synthetic admin user: ${adminAuthErr?.message || 'missing user id'}`
      );
    }
    const adminUserId = adminAuthData.user.id;
    runState.userIds.push(adminUserId);

    const { error: provisionErr } = await serviceClient.rpc('provision_admin', {
      target_user_id: adminUserId,
      target_email: adminEmail,
      target_full_name: adminFullName,
    });
    if (provisionErr) {
      throw new Error(`provision_admin failed: ${provisionErr.message}`);
    }

    const adminClient = createAuthClient(runState.supabaseUrl, runState.anonKey);
    const { error: adminSignInErr } = await adminClient.auth.signInWithPassword({
      email: adminEmail,
      password,
    });
    if (adminSignInErr) {
      throw new Error(`Failed to sign in synthetic admin: ${adminSignInErr.message}`);
    }

    const teacherUser = await createSyntheticUser({
      serviceClient,
      email: makeEmail('teacher'),
      password,
      fullName: `Storage Smoke Teacher ${runId}`,
      role: 'teacher',
      runState,
    });
    const studentA1User = await createSyntheticUser({
      serviceClient,
      email: makeEmail('student-a1'),
      password,
      fullName: `Storage Smoke Student A1 ${runId}`,
      role: 'student',
      runState,
    });
    const studentA2User = await createSyntheticUser({
      serviceClient,
      email: makeEmail('student-a2'),
      password,
      fullName: `Storage Smoke Student A2 ${runId}`,
      role: 'student',
      runState,
    });
    const studentB1User = await createSyntheticUser({
      serviceClient,
      email: makeEmail('student-b1'),
      password,
      fullName: `Storage Smoke Student B1 ${runId}`,
      role: 'student',
      runState,
    });
    const parentA1User = await createSyntheticUser({
      serviceClient,
      email: makeEmail('parent-a1'),
      password,
      fullName: `Storage Smoke Parent A1 ${runId}`,
      role: 'parent',
      runState,
    });

    // B.1 triggers prohibit inserting user_id during teacher/student creation; create unlinked first.
    const { data: teacherRow, error: teacherErr } = await serviceClient
      .from('teachers')
      .insert({
        full_name: `Storage Smoke Teacher ${runId}`,
        subject: 'Computer Science',
        email: makeEmail('teacher'),
      })
      .select('id')
      .single();
    if (teacherErr || !teacherRow?.id) {
      throw new Error(`Failed to insert synthetic teacher: ${teacherErr?.message}`);
    }
    runState.teacherIds.push(teacherRow.id);

    const { data: linkTeacherData, error: linkTeacherErr } = await adminClient.rpc(
      'link_teacher_account',
      {
        p_teacher_id: teacherRow.id,
        p_user_id: teacherUser.userId,
      }
    );
    if (linkTeacherErr || linkTeacherData?.success !== true) {
      throw new Error(
        `link_teacher_account failed: ${linkTeacherErr?.message || 'missing success'}`
      );
    }

    const { data: groupARow, error: groupAErr } = await serviceClient
      .from('groups')
      .insert({
        name: `Smoke Group A ${runId}`,
        grade_level: 'Grade 10',
        teacher_id: teacherRow.id,
      })
      .select('id')
      .single();
    if (groupAErr || !groupARow?.id) {
      throw new Error(`Failed to insert group A: ${groupAErr?.message}`);
    }
    runState.groupIds.push(groupARow.id);

    const { data: groupBRow, error: groupBErr } = await serviceClient
      .from('groups')
      .insert({
        name: `Smoke Group B ${runId}`,
        grade_level: 'Grade 10',
        teacher_id: null,
      })
      .select('id')
      .single();
    if (groupBErr || !groupBRow?.id) {
      throw new Error(`Failed to insert group B: ${groupBErr?.message}`);
    }
    runState.groupIds.push(groupBRow.id);

    const insertAndLinkStudent = async (userId, tag, groupId) => {
      const { data, error } = await serviceClient
        .from('students')
        .insert({
          full_name: `Storage Smoke ${tag} ${runId}`,
          student_code: `SMK-${tag}-${runId}`,
          group_id: groupId,
          grade_level: 'Grade 10',
          qr_code_hash: `qr-smoke-${tag}-${runId}`,
          status: 'active',
        })
        .select('id')
        .single();
      if (error || !data?.id) {
        throw new Error(`Failed to insert student ${tag}: ${error?.message}`);
      }
      runState.studentIds.push(data.id);

      const { data: linkStudentData, error: linkStudentErr } = await adminClient.rpc(
        'link_student_account',
        {
          p_student_id: data.id,
          p_user_id: userId,
        }
      );
      if (linkStudentErr || linkStudentData?.success !== true) {
        throw new Error(
          `link_student_account failed for ${tag}: ${linkStudentErr?.message || 'missing success'}`
        );
      }
      return data.id;
    };

    const studentA1Id = await insertAndLinkStudent(studentA1User.userId, 'A1', groupARow.id);
    await insertAndLinkStudent(studentA2User.userId, 'A2', groupARow.id);
    await insertAndLinkStudent(studentB1User.userId, 'B1', groupBRow.id);

    const { data: linkParentData, error: linkParentErr } = await adminClient.rpc(
      'link_parent_student',
      {
        p_parent_id: parentA1User.userId,
        p_student_id: studentA1Id,
      }
    );
    if (linkParentErr || linkParentData?.success !== true || !linkParentData?.link_id) {
      throw new Error(
        `link_parent_student failed: ${linkParentErr?.message || 'missing link_id'}`
      );
    }
    runState.parentLinkIds.push(linkParentData.link_id);

    // 1. Assignment PDF: authenticated teacher upload + RPC + signed download byte equality
    const assignmentPdfBytes = buildSyntheticPdfBytes('assignment', runId);
    const assignmentPath = `${groupARow.id}/${crypto.randomUUID()}.pdf`;
    runState.storageObjects.push({ bucket: ASSIGNMENT_BUCKET, path: assignmentPath });

    const { error: assignUploadErr } = await teacherUser.client.storage
      .from(ASSIGNMENT_BUCKET)
      .upload(assignmentPath, assignmentPdfBytes, {
        contentType: 'application/pdf',
        upsert: false,
      });
    if (assignUploadErr) {
      throw new Error(`Teacher assignment PDF upload failed: ${assignUploadErr.message}`);
    }

    const dueAtIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { data: createdAssign, error: createAssignErr } = await teacherUser.client.rpc(
      'create_teacher_assignment',
      {
        p_group_id: groupARow.id,
        p_title: `Storage Smoke Assignment ${runId}`,
        p_instructions: 'Verify local Storage PDF upload and signed download.',
        p_due_at: dueAtIso,
        p_attachment_path: assignmentPath,
        p_attachment_name: 'assignment-smoke.pdf',
        p_attachment_size: assignmentPdfBytes.length,
        p_attachment_mime_type: 'application/pdf',
      }
    );
    if (createAssignErr) {
      throw new Error(`create_teacher_assignment failed: ${createAssignErr.message}`);
    }

    const assignmentId = createdAssign?.assignment?.id;
    const assignmentAttachmentId = createdAssign?.assignment?.attachment?.id;
    if (!assignmentId || !assignmentAttachmentId) {
      throw new Error('create_teacher_assignment did not return assignment or attachment id.');
    }
    runState.assignmentIds.push(assignmentId);

    const teacherDownloadedAssignment = await authorizeAndDownloadBytes({
      client: teacherUser.client,
      rpcName: 'authorize_assignment_attachment_download',
      attachmentId: assignmentAttachmentId,
      secrets,
    });
    if (Buffer.compare(teacherDownloadedAssignment, assignmentPdfBytes) !== 0) {
      throw new Error('Teacher downloaded assignment PDF bytes did not match uploaded bytes.');
    }

    const studentDownloadedAssignment = await authorizeAndDownloadBytes({
      client: studentA1User.client,
      rpcName: 'authorize_assignment_attachment_download',
      attachmentId: assignmentAttachmentId,
      secrets,
    });
    if (Buffer.compare(studentDownloadedAssignment, assignmentPdfBytes) !== 0) {
      throw new Error('Enrolled student downloaded assignment PDF bytes did not match uploaded bytes.');
    }

    await assertDenied({
      label: 'different-group student (assignment PDF)',
      client: studentB1User.client,
      rpcName: 'authorize_assignment_attachment_download',
      attachmentId: assignmentAttachmentId,
      bucketId: ASSIGNMENT_BUCKET,
      objectPath: assignmentPath,
      secrets,
    });

    // 2. Submission PDF: authenticated student upload + RPC + signed download byte equality
    const submissionPdfBytes = buildSyntheticPdfBytes('submission', runId);
    const submissionPath = `${studentA1Id}/${assignmentId}/${crypto.randomUUID()}.pdf`;
    runState.storageObjects.push({ bucket: SUBMISSION_BUCKET, path: submissionPath });

    const { error: subUploadErr } = await studentA1User.client.storage
      .from(SUBMISSION_BUCKET)
      .upload(submissionPath, submissionPdfBytes, {
        contentType: 'application/pdf',
        upsert: false,
      });
    if (subUploadErr) {
      throw new Error(`Student submission PDF upload failed: ${subUploadErr.message}`);
    }

    const { data: submitted, error: submitErr } = await studentA1User.client.rpc(
      'submit_student_assignment',
      {
        p_assignment_id: assignmentId,
        p_answer_text: `Storage smoke submission ${runId}`,
        p_attachment_path: submissionPath,
        p_attachment_name: 'submission-smoke.pdf',
        p_attachment_size: submissionPdfBytes.length,
        p_attachment_mime_type: 'application/pdf',
      }
    );
    if (submitErr) {
      throw new Error(`submit_student_assignment failed: ${submitErr.message}`);
    }

    const submissionAttachmentId = submitted?.submission?.attachment?.id;
    if (!submissionAttachmentId) {
      throw new Error('submit_student_assignment did not return submission attachment id.');
    }

    const ownerDownloadedSubmission = await authorizeAndDownloadBytes({
      client: studentA1User.client,
      rpcName: 'authorize_submission_attachment_download',
      attachmentId: submissionAttachmentId,
      secrets,
    });
    if (Buffer.compare(ownerDownloadedSubmission, submissionPdfBytes) !== 0) {
      throw new Error('Owner student downloaded submission PDF bytes did not match uploaded bytes.');
    }

    const teacherDownloadedSubmission = await authorizeAndDownloadBytes({
      client: teacherUser.client,
      rpcName: 'authorize_submission_attachment_download',
      attachmentId: submissionAttachmentId,
      secrets,
    });
    if (Buffer.compare(teacherDownloadedSubmission, submissionPdfBytes) !== 0) {
      throw new Error('Teacher downloaded submission PDF bytes did not match uploaded bytes.');
    }

    await assertDenied({
      label: 'same-group peer (submission PDF)',
      client: studentA2User.client,
      rpcName: 'authorize_submission_attachment_download',
      attachmentId: submissionAttachmentId,
      bucketId: SUBMISSION_BUCKET,
      objectPath: submissionPath,
      secrets,
    });

    await assertDenied({
      label: 'linked parent (submission PDF)',
      client: parentA1User.client,
      rpcName: 'authorize_submission_attachment_download',
      attachmentId: submissionAttachmentId,
      bucketId: SUBMISSION_BUCKET,
      objectPath: submissionPath,
      secrets,
    });

    assignmentPdfBytesLength = assignmentPdfBytes.length;
    submissionPdfBytesLength = submissionPdfBytes.length;
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    primaryError = new Error(redactSensitive(rawMsg, secrets), { cause: err });
  } finally {
    const clean = async (step, request) => {
      try {
        const { error } = await request();
        if (error) throw new Error(error.message || String(error));
      } catch (error) {
        cleanupErrors.push(step + ': ' + redactSensitive(error?.message || String(error), secrets));
      }
    };

    for (const { bucket, path: objectPath } of runState.storageObjects) {
      await clean('remove ' + bucket + '/' + objectPath, () =>
        serviceClient.storage.from(bucket).remove([objectPath])
      );
    }
    const fixtureTables = {
      parent_student_links: runState.parentLinkIds,
      assignments: runState.assignmentIds,
      students: runState.studentIds,
      groups: runState.groupIds,
      teachers: runState.teacherIds,
      profiles: runState.userIds,
    };
    for (const [table, ids] of Object.entries(fixtureTables)) {
      if (ids.length) {
        await clean('delete ' + table, () => serviceClient.from(table).delete().in('id', ids));
      }
    }
    for (const userId of runState.userIds) {
      await clean('delete test Auth user', () => serviceClient.auth.admin.deleteUser(userId));
    }
  }

  if (cleanupErrors.length) {
    const message = 'Smoke cleanup failed: ' + cleanupErrors.join(', ');
    throw new Error(primaryError ? primaryError.message + ' (' + message + ')' : message, {
      cause: primaryError,
    });
  }
  if (primaryError) throw primaryError;

  console.log(
    `PASS: Local Storage PDF smoke test succeeded (runId=${runId}, assignmentBytes=${assignmentPdfBytesLength}, submissionBytes=${submissionPdfBytesLength}).`
  );
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  runLocalStoragePdfSmoke().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`FAIL: ${redactSensitive(msg)}`);
    process.exit(1);
  });
}
