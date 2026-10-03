import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { dirname, join as joinPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSessionChangedWakeV1, resolveActivityRemoteAlertEventIdentity } from '@happier-dev/protocol';

const testsDir = dirname(fileURLToPath(import.meta.url));
const moduleRoot = dirname(testsDir);
const kotlinAlertSource = joinPath(
  moduleRoot, 'android', 'src', 'main', 'java', 'dev', 'happier', 'activitynotifications', 'ActivityRemoteAlert.kt',
);

const SERVER_ID = 'srv-1';
const SESSION_ID = 'sess-1';
const ACCOUNT_ID = 'acc-1';

function alertPayload(version, event) {
  return {
    type: 'activity_alert',
    v: version,
    serverId: SERVER_ID,
    sessionId: SESSION_ID,
    accountId: ACCOUNT_ID,
    event,
    previewBehavior: 'title_only',
  };
}

function wireBody(version, event) {
  return JSON.stringify(alertPayload(version, event));
}

// One committed Home/Session observed through materially distinct terminal
// turns plus the neighboring sequence/category references whose identities
// this lane must not change.
const scenarios = [
  { id: 'v2_failed_turnA', body: wireBody(2, { type: 'failed', turnId: 'turn-AAA' }) },
  { id: 'v2_failed_turnB', body: wireBody(2, { type: 'failed', turnId: 'turn-BBB' }) },
  { id: 'v2_cancelled_turnC', body: wireBody(2, { type: 'cancelled', turnId: 'turn-CCC' }) },
  { id: 'v1_failed_turnA', body: wireBody(1, { type: 'failed', turnId: 'turn-AAA' }) },
  { id: 'v2_ready_seq42', body: wireBody(2, { type: 'ready', sequenceDomain: 'session_transcript', messageSeq: 42 }) },
  {
    id: 'v2_discussion_mention_seq7',
    body: wireBody(2, { type: 'discussion_mention', sequenceDomain: 'discussion', discussionId: 'disc-1', messageSeq: 7 }),
  },
  { id: 'v1_human_message_seq9', body: wireBody(1, { type: 'human_message', messageSeq: 9 }) },
  { id: 'v2_failed_without_turn', body: wireBody(2, { type: 'failed' }) },
];

const UNPARSED_SCENARIO = 'v2_failed_without_turn';
// Released V1 sequenced references retain the category-grouping fallback on
// the native Android leg; this lane freezes that behavior unchanged. Protocol
// still derives `legacy-message-seq:` for them, so no canonical identity is
// asserted for this scenario's tag.
const FROZEN_V1_SEQUENCED_SCENARIO = 'v1_human_message_seq9';

function canonicalIdentity(scenarioId) {
  const scenario = scenarios.find((candidate) => candidate.id === scenarioId);
  return resolveActivityRemoteAlertEventIdentity(JSON.parse(scenario.body)) ?? null;
}

function firstFileByPrefix(directory, prefix) {
  const found = readdirSync(directory).find((name) => name.startsWith(prefix) && name.endsWith('.jar'));
  return found ? join(directory, found) : null;
}

/** Local Gradle distribution toolchain used to execute the real Kotlin parser on the JVM. */
function discoverKotlinToolchain() {
  const distsRoot = join(process.env.HOME ?? '', '.gradle', 'wrapper', 'dists');
  if (!existsSync(distsRoot)) return null;
  for (const dist of readdirSync(distsRoot)) {
    if (!dist.startsWith('gradle-')) continue;
    const distPath = join(distsRoot, dist);
    for (const hash of readdirSync(distPath)) {
      const hashPath = join(distPath, hash);
      for (const gradle of readdirSync(hashPath)) {
        if (!gradle.startsWith('gradle-')) continue;
        const lib = join(hashPath, gradle, 'lib');
        if (!existsSync(lib)) continue;
        const compiler = firstFileByPrefix(lib, 'kotlin-compiler-embeddable-');
        const stdlib = firstFileByPrefix(lib, 'kotlin-stdlib-');
        const serializationCore = firstFileByPrefix(lib, 'kotlinx-serialization-core-jvm-');
        const serializationJson = firstFileByPrefix(lib, 'kotlinx-serialization-json-jvm-');
        if (compiler && stdlib && serializationCore && serializationJson) {
          // The compiler JVM launches with the distribution's full lib
          // classpath, exactly like the Gradle launcher does.
          const compilerJars = readdirSync(lib).filter((name) => name.endsWith('.jar')).map((name) => join(lib, name));
          return { compilerJars, runtimeJars: [stdlib, serializationCore, serializationJson] };
        }
      }
    }
  }
  return null;
}

// JVM stand-in for the Android platform JSON runtime boundary (org.json is an
// OS-provided runtime class, not repo-internal logic). Backed by the real
// kotlinx JSON parser so payload shapes are parsed, not assumed.
const jsonRuntimeStub = `
package org.json

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.math.BigDecimal

class JSONException(message: String) : Exception(message)

class JSONObject(raw: String) {
  private val values: MutableMap<String, Any?> = LinkedHashMap()

  init {
    val element = try {
      Json.parseToJsonElement(raw)
    } catch (failure: Throwable) {
      throw JSONException("malformed JSON: \${failure.message}")
    }
    if (element !is JsonObject) throw JSONException("payload is not a JSON object")
    for ((key, value) in element) values[key] = convert(value)
  }

  fun opt(key: String): Any? = values[key]

  fun getString(key: String): String = values[key] as? String
    ?: throw JSONException("expected string value for key")

  fun has(key: String): Boolean = values.containsKey(key)

  fun keys(): Iterator<String> = values.keys.iterator()

  private fun convert(value: JsonElement): Any? = when (value) {
    is JsonNull -> null
    is JsonObject -> JSONObject(value.toString())
    is JsonArray -> value.map { convert(it) }
    is JsonPrimitive -> if (value.isString) value.content else scalar(value.content)
  }

  private fun scalar(content: String): Any = when {
    content == "true" -> true
    content == "false" -> false
    content.contains('.') || content.contains('e') || content.contains('E') -> content.toDouble()
    else -> try {
      content.toLong()
    } catch (failure: NumberFormatException) {
      BigDecimal(content)
    }
  }
}
`;

// JVM stand-in for the Firebase messaging transport boundary.
const firebaseStub = `
package com.google.firebase.messaging

class RemoteMessage(val data: Map<String, String>)
`;

// Executes the real [ActivityRemoteAlert.parse] entry point against canonical
// wire payloads and prints one result line per scenario:
// "<body>|<parsed|unparsed>|<replacementTag|->|<eventIdentity|->".
// The node:test owner compares these against the canonical Protocol identity.
const probeSource = `
package dev.happier.activitynotifications

import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

fun main() {
  val input = JSONObject(readlnOrNull() ?: error("missing scenario input"))
  for (key in sortedScenarioKeys(input)) {
    val body = input.getString(key)
    val parsed = ActivityRemoteAlert.parse(RemoteMessage(mapOf("body" to body)))
    println(
      listOf(
        body,
        if (parsed == null) "unparsed" else "parsed",
        parsed?.replacementTag ?: "-",
        parsed?.eventIdentity ?: "-",
      ).joinToString("|"),
    )
  }
}

private fun sortedScenarioKeys(input: JSONObject): List<String> =
  buildList {
    val keys = input.keys()
    while (keys.hasNext()) add(keys.next())
  }.sorted()
`;

test('Android remote alert requests keep distinct terminal turns distinct exactly like Protocol', async (t) => {
  const toolchain = discoverKotlinToolchain();
  if (!toolchain) {
    t.skip('local Kotlin toolchain (Gradle distribution) unavailable; the behavioral native identity gate needs it');
    return;
  }

  // Canonical Protocol identities are computed at test time by the owner;
  // they are never re-declared here.
  const expected = new Map(scenarios.map((scenario) => [scenario.id, {
    identity: canonicalIdentity(scenario.id),
    status: scenario.id === UNPARSED_SCENARIO ? 'unparsed' : 'parsed',
  }]));
  assert.ok(
    [...expected.values()].filter((expectation) => expectation.identity).length >= 6,
    'the canonical Protocol owner must derive identities for the committed references under test',
  );

  const work = mkdtempSync(join(tmpdir(), 'activity-alert-turn-identity-'));
  let stdout;
  try {
    const jsonStub = join(work, 'OrgJsonStub.kt');
    const firebaseStubFile = join(work, 'FirebaseStub.kt');
    const probeFile = join(work, 'TurnIdentityProbe.kt');
    writeFileSync(jsonStub, jsonRuntimeStub);
    writeFileSync(firebaseStubFile, firebaseStub);
    writeFileSync(probeFile, probeSource);
    const classes = join(work, 'classes');
    execFileSync(
      'java',
      [
        '-cp', toolchain.compilerJars.join(delimiter),
        'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
        '-classpath', toolchain.runtimeJars.join(delimiter),
        '-no-stdlib',
        '-d', classes,
        '-nowarn',
        kotlinAlertSource, jsonStub, firebaseStubFile, probeFile,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const scenarioInput = {};
    for (const scenario of scenarios) scenarioInput[scenario.id] = scenario.body;
    stdout = execFileSync(
      'java',
      ['-cp', [classes, ...toolchain.runtimeJars].join(delimiter), 'dev.happier.activitynotifications.TurnIdentityProbeKt'],
      { input: JSON.stringify(scenarioInput), encoding: 'utf8' },
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const observed = new Map(
    stdout.trim().split('\n').filter(Boolean).map((line) => {
      const [body, status, tag, identity] = line.split('|');
      const scenario = scenarios.find((candidate) => candidate.body === body);
      assert.ok(scenario, `probe returned an unknown scenario body: ${body}`);
      return [scenario.id, { status, tag, identity }];
    }),
  );

  for (const scenario of scenarios) {
    const row = observed.get(scenario.id);
    assert.ok(row, `missing probe result for ${scenario.id}`);
    assert.equal(row.status, expected.get(scenario.id).status, `${scenario.id} strict admission`);
  }

  const tag = (id) => observed.get(id).tag;
  const identityOf = (id) => {
    const identity = observed.get(id).identity;
    assert.notEqual(identity, undefined, `${id} probe output`);
    return identity === '-' ? null : identity;
  };

  // The canonical Protocol owner decides every expected identity; native
  // replacement tags must embed exactly that identity.
  for (const scenario of scenarios) {
    if (scenario.id === UNPARSED_SCENARIO) continue;
    const expectation = expected.get(scenario.id);
    if (scenario.id === FROZEN_V1_SEQUENCED_SCENARIO) {
      assert.equal(identityOf(scenario.id), null, `${scenario.id} native identity stays frozen`);
      assert.equal(tag(scenario.id), `activity_alert:${SERVER_ID}:${SESSION_ID}:human_message`);
      continue;
    }
    assert.ok(expectation.identity, `${scenario.id} has no canonical Protocol identity`);
    assert.equal(identityOf(scenario.id), expectation.identity,
      `${scenario.id} native identity must equal Protocol`);
    assert.equal(tag(scenario.id), `activity_alert:${SERVER_ID}:${SESSION_ID}:${expectation.identity}`,
      `${scenario.id} replacement tag must embed the canonical Protocol identity`);
  }

  // Distinct terminal turns on the same Home/Session are distinct Android
  // notification requests: neither the failed nor the cancelled category
  // collapses them.
  assert.notEqual(tag('v2_failed_turnA'), tag('v2_failed_turnB'));
  assert.notEqual(tag('v2_failed_turnA'), tag('v2_cancelled_turnC'));
  assert.notEqual(tag('v2_failed_turnB'), tag('v2_cancelled_turnC'));
  // Canonical turn identity is version-independent, exactly like Protocol.
  assert.equal(tag('v1_failed_turnA'), tag('v2_failed_turnA'));
  // Message/discussion neighbors stay distinguishable and distinct from
  // terminal turns.
  assert.notEqual(tag('v2_ready_seq42'), tag('v2_discussion_mention_seq7'));
  assert.notEqual(tag('v2_ready_seq42'), tag('v2_failed_turnA'));
});

const kotlinWakeSource = joinPath(
  moduleRoot, 'android', 'src', 'main', 'java', 'dev', 'happier', 'activitynotifications', 'SessionChangedWake.kt',
);

// The Home's content-free closed-app wake exactly as it is submitted, beside
// the neighbors the Android entry point must never hand to the wake consumer.
const wakeScenarios = [
  { id: 'wake_muted', payload: { type: 'session_changed', serverId: SERVER_ID, sessionId: SESSION_ID, alert: 'muted' } },
  { id: 'wake_unknown_alert', payload: { type: 'session_changed', serverId: SERVER_ID, sessionId: SESSION_ID, alert: 'loud' } },
  { id: 'wake_with_home', payload: { type: 'session_changed', serverId: SERVER_ID, sessionId: SESSION_ID } },
  { id: 'wake_without_home', payload: { type: 'session_changed', sessionId: SESSION_ID } },
  { id: 'wake_padded_ids', payload: { type: 'session_changed', serverId: ` ${SERVER_ID} `, sessionId: ` ${SESSION_ID} ` } },
  {
    id: 'wake_carrying_content',
    payload: { type: 'session_changed', serverId: SERVER_ID, sessionId: SESSION_ID, title: 'Alice mentioned you' },
  },
  { id: 'wake_blank_session', payload: { type: 'session_changed', sessionId: '   ' } },
  { id: 'wake_null_home', payload: { type: 'session_changed', serverId: null, sessionId: SESSION_ID } },
  { id: 'badge_refresh', payload: { type: 'badge_refresh' } },
  { id: 'activity_alert', payload: alertPayload(2, { type: 'ready', sequenceDomain: 'session_transcript', messageSeq: 42 }) },
];
const ALERT_SCENARIO = 'activity_alert';

// Executes both real Android admission owners against the same wire body and
// prints "<id>|<wake accepted|rejected>|<sessionId|->|<serverId|->|<alert accepted|rejected>".
const wakeProbeSource = `
package dev.happier.activitynotifications

import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

fun main() {
  val input = JSONObject(readlnOrNull() ?: error("missing scenario input"))
  for (key in sortedWakeScenarioKeys(input)) {
    val message = RemoteMessage(mapOf("body" to input.getString(key)))
    val wake = SessionChangedWake.parse(message)
    val alert = ActivityRemoteAlert.parse(message)
    println(
      listOf(
        key,
        if (wake == null) "rejected" else "accepted",
        wake?.sessionId ?: "-",
        wake?.serverId ?: "-",
        if (alert == null) "rejected" else "accepted",
      ).joinToString("|"),
    )
  }
}

private fun sortedWakeScenarioKeys(input: JSONObject): List<String> =
  buildList {
    val keys = input.keys()
    while (keys.hasNext()) add(keys.next())
  }.sorted()
`;

test('Android admits exactly the Protocol content-free wake and never an alert as one', async (t) => {
  const toolchain = discoverKotlinToolchain();
  if (!toolchain) {
    t.skip('local Kotlin toolchain (Gradle distribution) unavailable; the behavioral native admission gate needs it');
    return;
  }

  // The canonical Protocol owner decides every expectation; this test restates
  // none of the wake's admission rules.
  const expected = new Map(wakeScenarios.map((scenario) => [
    scenario.id,
    parseSessionChangedWakeV1(scenario.payload),
  ]));
  assert.ok([...expected.values()].some((wake) => wake), 'Protocol must admit at least one wake under test');
  assert.ok([...expected.values()].some((wake) => !wake), 'Protocol must reject at least one payload under test');

  const work = mkdtempSync(join(tmpdir(), 'activity-session-changed-wake-'));
  let stdout;
  try {
    const jsonStub = join(work, 'OrgJsonStub.kt');
    const firebaseStubFile = join(work, 'FirebaseStub.kt');
    const probeFile = join(work, 'SessionChangedWakeProbe.kt');
    writeFileSync(jsonStub, jsonRuntimeStub);
    writeFileSync(firebaseStubFile, firebaseStub);
    writeFileSync(probeFile, wakeProbeSource);
    const classes = join(work, 'classes');
    execFileSync(
      'java',
      [
        '-cp', toolchain.compilerJars.join(delimiter),
        'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
        '-classpath', toolchain.runtimeJars.join(delimiter),
        '-no-stdlib',
        '-d', classes,
        '-nowarn',
        kotlinWakeSource, kotlinAlertSource, jsonStub, firebaseStubFile, probeFile,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const scenarioInput = {};
    for (const scenario of wakeScenarios) scenarioInput[scenario.id] = JSON.stringify(scenario.payload);
    stdout = execFileSync(
      'java',
      [
        '-cp', [classes, ...toolchain.runtimeJars].join(delimiter),
        'dev.happier.activitynotifications.SessionChangedWakeProbeKt',
      ],
      { input: JSON.stringify(scenarioInput), encoding: 'utf8' },
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const observed = new Map(
    stdout.trim().split('\n').filter(Boolean).map((line) => {
      const [id, status, sessionId, serverId, alertStatus] = line.split('|');
      return [id, { status, sessionId, serverId, alertStatus }];
    }),
  );

  for (const scenario of wakeScenarios) {
    const row = observed.get(scenario.id);
    assert.ok(row, `missing probe result for ${scenario.id}`);
    const canonical = expected.get(scenario.id);
    assert.equal(row.status, canonical ? 'accepted' : 'rejected', `${scenario.id} native admission must equal Protocol`);
    if (canonical) {
      assert.equal(row.sessionId, canonical.sessionId, `${scenario.id} native session identity must equal Protocol`);
      assert.equal(row.serverId, canonical.serverId ?? '-', `${scenario.id} native Home identity must equal Protocol`);
    }
    // One message, one native owner: the wake consumer never sees an alert and
    // the alert consumer never sees a wake.
    assert.equal(row.alertStatus, scenario.id === ALERT_SCENARIO ? 'accepted' : 'rejected',
      `${scenario.id} must not be admitted by both native owners`);
    if (scenario.id === ALERT_SCENARIO) assert.equal(row.status, 'rejected');
  }
});
