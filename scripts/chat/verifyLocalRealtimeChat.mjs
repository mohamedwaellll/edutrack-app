import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { assertLocalUrl, redactSensitive } from '../recovery-e2e/recoveryHelpers.mjs';
import {
  createLoopbackNoRedirectFetch,
  resolveLocalSupabaseStorageEnv,
} from '../assignments/verifyLocalStoragePdf.mjs';

const __filename = fileURLToPath(import.meta.url);

const SUBSCRIBE_TIMEOUT_MS = 10_000;
const EVENT_TIMEOUT_MS = 10_000;
const NON_MEMBER_SILENCE_MS = 1_500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

function assertLoopbackRealtimeEndpoint(client) {
  const endpoint = client?.realtime?.endPoint;
  if (!endpoint) return;
  const httpEquivalent = String(endpoint).replace(/^ws(s?):\/\//i, 'http$1://');
  assertLocalUrl(httpEquivalent, 'Supabase Realtime WebSocket URL');
}

function createRealtimeClient(supabaseUrl, anonKey, customFetch = createLoopbackNoRedirectFetch()) {
  const client = createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: customFetch,
    },
  });
  assertLoopbackRealtimeEndpoint(client);
  return client;
}

async function createAndSignInUser({ serviceClient, supabaseUrl, anonKey, email, password, fullName, role, runState }) {
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

  const client = createRealtimeClient(supabaseUrl, anonKey);
  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError || !signInData?.session?.access_token) {
    throw new Error(`Failed to sign in synthetic ${role}: ${signInError?.message || 'missing session'}`);
  }
  await client.realtime.setAuth(signInData.session.access_token);
  runState.clients.push(client);
  return { userId, client };
}

function subscribeMarkerChannel(client, channelName, groupId) {
  const events = [];
  const waiters = [];

  const dispatch = (eventType, payload) => {
    const entry = { eventType, payload };
    const idx = waiters.findIndex((w) => w.eventType === eventType);
    if (idx >= 0) {
      const [waiter] = waiters.splice(idx, 1);
      waiter.resolve(entry);
      return;
    }
    events.push(entry);
  };

  let channel;
  const subscribed = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      fn(arg);
    };

    const filter = `group_id=eq.${groupId}`;
    channel = client
      .channel(channelName)
      // The WebSocket can join before the Postgres Changes listener is ready.
      .on('system', {}, (payload) => {
        if (payload.extension === 'postgres_changes' && payload.status === 'ok') {
          finish(resolve);
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_chat_markers', filter }, (payload) =>
        dispatch('INSERT', payload)
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'group_chat_markers', filter }, (payload) =>
        dispatch('UPDATE', payload)
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          finish(reject, new Error(`Realtime subscription ${channelName} failed with status ${status}: ${err?.message || ''}`));
        }
      });
  });

  const waitForEvent = (eventType, timeoutMs = EVENT_TIMEOUT_MS) => {
    const existingIdx = events.findIndex((e) => e.eventType === eventType);
    if (existingIdx >= 0) {
      return Promise.resolve(events.splice(existingIdx, 1)[0]);
    }
    return withTimeout(
      new Promise((resolve) => {
        waiters.push({ eventType, resolve });
      }),
      timeoutMs,
      `${channelName} ${eventType} marker event`
    );
  };

  return {
    channel,
    events,
    ready: withTimeout(subscribed, SUBSCRIBE_TIMEOUT_MS, `${channelName} subscription`),
    waitForEvent,
  };
}

export async function runLocalRealtimeChatVerification() {
  const { supabaseUrl, anonKey, serviceRoleKey } = resolveLocalSupabaseStorageEnv();
  const runId = crypto.randomBytes(6).toString('hex');
  const password = `ChatRt-${crypto.randomBytes(8).toString('hex')}!1`;
  const msg1Body = `RT-MSG-1-${runId}`;
  const msg2Body = `RT-REPLY-2-${runId}`;
  const controlBody = `RT-CONTROL-${runId}`;
  const secrets = [anonKey, serviceRoleKey, password, msg1Body, msg2Body, controlBody];

  const serviceClient = createRealtimeClient(supabaseUrl, serviceRoleKey);
  const runState = {
    clients: [],
    channels: [],
    userIds: [],
    studentIds: [],
    groupIds: [],
    teacherIds: [],
  };

  const cleanupErrors = [];
  let primaryError = null;
  let verifiedGroupId = '';
  let insertRevision = '';
  let updateRevision = '';

  try {
    const makeEmail = (tag) => `chatrt.${tag}.${runId}@edutrack.local`;

    // Provision synthetic admin via service role to link teacher and students via real admin RPCs
    const adminEmail = makeEmail('admin');
    const adminName = `Chat RT Admin ${runId}`;
    const { data: adminAuth, error: adminAuthErr } = await serviceClient.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: adminName },
    });
    if (adminAuthErr || !adminAuth?.user?.id) {
      throw new Error(`Failed to create synthetic admin: ${adminAuthErr?.message || 'missing user id'}`);
    }
    runState.userIds.push(adminAuth.user.id);

    const { error: provErr } = await serviceClient.rpc('provision_admin', {
      target_user_id: adminAuth.user.id,
      target_email: adminEmail,
      target_full_name: adminName,
    });
    if (provErr) throw new Error(`provision_admin failed: ${provErr.message}`);

    const adminClient = createRealtimeClient(supabaseUrl, anonKey);
    runState.clients.push(adminClient);
    const { error: adminSignInErr } = await adminClient.auth.signInWithPassword({ email: adminEmail, password });
    if (adminSignInErr) throw new Error(`Admin sign-in failed: ${adminSignInErr.message}`);

    const teacher = await createAndSignInUser({
      serviceClient,
      supabaseUrl,
      anonKey,
      email: makeEmail('teacher'),
      password,
      fullName: `Chat RT Teacher ${runId}`,
      role: 'teacher',
      runState,
    });
    const student = await createAndSignInUser({
      serviceClient,
      supabaseUrl,
      anonKey,
      email: makeEmail('student'),
      password,
      fullName: `Chat RT Student ${runId}`,
      role: 'student',
      runState,
    });
    const nonMember = await createAndSignInUser({
      serviceClient,
      supabaseUrl,
      anonKey,
      email: makeEmail('nonmember'),
      password,
      fullName: `Chat RT NonMember ${runId}`,
      role: 'student',
      runState,
    });

    const { data: teacherRow, error: teacherErr } = await serviceClient
      .from('teachers')
      .insert({ full_name: `Chat RT Teacher ${runId}`, subject: 'Math', email: makeEmail('teacher') })
      .select('id')
      .single();
    if (teacherErr || !teacherRow?.id) throw new Error(`Insert teacher failed: ${teacherErr?.message}`);
    runState.teacherIds.push(teacherRow.id);

    const { data: linkT, error: linkTErr } = await adminClient.rpc('link_teacher_account', {
      p_teacher_id: teacherRow.id,
      p_user_id: teacher.userId,
    });
    if (linkTErr || linkT?.success !== true) throw new Error(`link_teacher_account failed: ${linkTErr?.message || 'not ok'}`);

    const { data: groupA, error: groupAErr } = await serviceClient
      .from('groups')
      .insert({ name: `Chat RT Group A ${runId}`, grade_level: 'Grade 10', teacher_id: teacherRow.id })
      .select('id')
      .single();
    if (groupAErr || !groupA?.id) throw new Error(`Insert group A failed: ${groupAErr?.message}`);
    runState.groupIds.push(groupA.id);
    verifiedGroupId = groupA.id;

    const { data: groupB, error: groupBErr } = await serviceClient
      .from('groups')
      .insert({ name: `Chat RT Group B ${runId}`, grade_level: 'Grade 10', teacher_id: null })
      .select('id')
      .single();
    if (groupBErr || !groupB?.id) throw new Error(`Insert group B failed: ${groupBErr?.message}`);
    runState.groupIds.push(groupB.id);

    for (const [tag, userId, groupId] of [
      ['member', student.userId, groupA.id],
      ['nonmember', nonMember.userId, groupB.id],
    ]) {
      const { data: sRow, error: sErr } = await serviceClient
        .from('students')
        .insert({
          full_name: `Chat RT ${tag} ${runId}`,
          student_code: `CRT-${tag}-${runId}`,
          group_id: groupId,
          grade_level: 'Grade 10',
          qr_code_hash: `qr-crt-${tag}-${runId}`,
          status: 'active',
        })
        .select('id')
        .single();
      if (sErr || !sRow?.id) throw new Error(`Insert student ${tag} failed: ${sErr?.message}`);
      runState.studentIds.push(sRow.id);

      const { data: linkS, error: linkSErr } = await adminClient.rpc('link_student_account', {
        p_student_id: sRow.id,
        p_user_id: userId,
      });
      if (linkSErr || linkS?.success !== true) throw new Error(`link_student_account failed: ${linkSErr?.message || 'not ok'}`);
    }

    // 1. Subscribe authorized student and non-member to group_chat_markers for group A
    const studentSub = subscribeMarkerChannel(student.client, `chat-rt-student-${runId}`, groupA.id);
    const nonMemberSub = subscribeMarkerChannel(nonMember.client, `chat-rt-nonmember-${runId}`, groupA.id);
    const nonMemberControl = subscribeMarkerChannel(nonMember.client, `chat-rt-control-${runId}`, groupB.id);
    runState.channels.push({ client: student.client, channel: studentSub.channel });
    runState.channels.push({ client: nonMember.client, channel: nonMemberSub.channel });
    runState.channels.push({ client: nonMember.client, channel: nonMemberControl.channel });

    await Promise.all([studentSub.ready, nonMemberSub.ready, nonMemberControl.ready]);

    // 2. Teacher sends first message -> student must receive INSERT via WebSocket
    const { data: sent1, error: send1Err } = await teacher.client.rpc('send_group_chat_message', {
      p_group_id: groupA.id,
      p_body: msg1Body,
    });
    if (send1Err || !sent1?.id) throw new Error(`Teacher send_group_chat_message failed: ${send1Err?.message || 'no id'}`);

    const insertEvent = await studentSub.waitForEvent('INSERT');
    if (insertEvent.payload?.new?.group_id !== groupA.id) {
      throw new Error('Student INSERT marker payload group_id mismatch.');
    }
    insertRevision = String(insertEvent.payload?.new?.revision_at || 'received');

    // 3. Student reads actual message via get_group_chat_messages
    const { data: list1, error: list1Err } = await student.client.rpc('get_group_chat_messages', {
      p_group_id: groupA.id,
    });
    if (list1Err || !Array.isArray(list1?.messages)) {
      throw new Error(`Student get_group_chat_messages (1) failed: ${list1Err?.message || 'invalid payload'}`);
    }
    if (!list1.messages.some((m) => m.id === sent1.id && m.body === msg1Body && m.sender_role === 'teacher')) {
      throw new Error('Student get_group_chat_messages did not return teacher first message.');
    }

    // 4. Student sends reply -> the teacher's independent client receives UPDATE
    const teacherSub = subscribeMarkerChannel(teacher.client, `chat-rt-teacher-${runId}`, groupA.id);
    runState.channels.push({ client: teacher.client, channel: teacherSub.channel });
    await teacherSub.ready;
    const { data: sent2, error: send2Err } = await student.client.rpc('send_group_chat_message', {
      p_group_id: groupA.id,
      p_body: msg2Body,
    });
    if (send2Err || !sent2?.id) throw new Error(`Student reply send_group_chat_message failed: ${send2Err?.message || 'no id'}`);

    const updateEvent = await teacherSub.waitForEvent('UPDATE');
    if (updateEvent.payload?.new?.group_id !== groupA.id) {
      throw new Error('Teacher UPDATE marker payload group_id mismatch.');
    }
    updateRevision = String(updateEvent.payload?.new?.revision_at || 'received');

    const { data: list2, error: list2Err } = await teacher.client.rpc('get_group_chat_messages', {
      p_group_id: groupA.id,
    });
    if (list2Err || !Array.isArray(list2?.messages)) {
      throw new Error(`Teacher get_group_chat_messages (2) failed: ${list2Err?.message || 'invalid payload'}`);
    }
    if (!list2.messages.some((m) => m.id === sent2.id && m.body === msg2Body && m.sender_role === 'student')) {
      throw new Error('Teacher get_group_chat_messages did not return student reply.');
    }

    // 5. A positive control confirms the outsider's socket itself can receive group events.
    const { error: controlError } = await nonMember.client.rpc('send_group_chat_message', {
      p_group_id: groupB.id,
      p_body: controlBody,
    });
    if (controlError) throw new Error(`Control send failed: ${controlError.message}`);
    const controlEvent = await nonMemberControl.waitForEvent('INSERT');
    if (controlEvent.payload?.new?.group_id !== groupB.id) {
      throw new Error('Control marker payload group_id mismatch.');
    }

    await sleep(NON_MEMBER_SILENCE_MS);
    if (nonMemberSub.events.length > 0) {
      throw new Error(`Non-member unexpectedly received ${nonMemberSub.events.length} Realtime marker event(s).`);
    }

    const { data: nmMarkerRows, error: nmMarkerErr } = await nonMember.client
      .from('group_chat_markers')
      .select('group_id')
      .eq('group_id', groupA.id);
    if (nmMarkerErr || (Array.isArray(nmMarkerRows) && nmMarkerRows.length > 0)) {
      throw new Error('Non-member was able to read group_chat_markers.');
    }

    const { error: nmRpcErr } = await nonMember.client.rpc('get_group_chat_messages', { p_group_id: groupA.id });
    if (nmRpcErr?.code !== '42501') {
      throw new Error(`Expected non-member get_group_chat_messages denial (42501), got: ${nmRpcErr?.code || 'none'}`);
    }
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    primaryError = new Error(redactSensitive(rawMsg, secrets), { cause: err });
  } finally {
    const clean = async (step, fn) => {
      try {
        const res = await fn();
        if (res?.error) throw new Error(res.error.message || String(res.error));
      } catch (err) {
        cleanupErrors.push(`${step}: ${redactSensitive(err?.message || String(err), secrets)}`);
      }
    };

    for (const { client, channel } of runState.channels) {
      await clean('removeChannel', () => client.removeChannel(channel));
    }
    for (const client of runState.clients) {
      await clean('realtime.disconnect', () => client.realtime.disconnect());
    }
    for (const [table, ids] of [
      ['students', runState.studentIds],
      ['groups', runState.groupIds],
      ['teachers', runState.teacherIds],
      ['profiles', runState.userIds],
    ]) {
      if (ids.length) {
        await clean(`delete ${table}`, () => serviceClient.from(table).delete().in('id', ids));
      }
    }
    for (const userId of runState.userIds) {
      await clean('delete auth user', () => serviceClient.auth.admin.deleteUser(userId));
    }
  }

  if (cleanupErrors.length) {
    const msg = `Realtime chat cleanup failed: ${cleanupErrors.join(', ')}`;
    throw new Error(primaryError ? `${primaryError.message} (${msg})` : msg, { cause: primaryError });
  }
  if (primaryError) throw primaryError;

  console.log(
    `PASS: Local Realtime chat verified (runId=${runId}, groupId=${verifiedGroupId}, insertRev=${insertRevision}, updateRev=${updateRevision}).`
  );
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMainModule) {
  runLocalRealtimeChatVerification().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`FAIL: ${redactSensitive(msg)}`);
    process.exit(1);
  });
}
