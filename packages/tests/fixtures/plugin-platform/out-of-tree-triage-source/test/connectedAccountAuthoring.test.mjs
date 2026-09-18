/**
 * The Connected Account half of `qa/QA-PROTOCOL.md` QB-01 and QB-59.
 *
 * `listInstances` reads its accounts through the host's purpose-bound Connected
 * Accounts service. A source that declares no account service still passes every
 * schema, admission and conformance check in the sibling suites — and then
 * returns zero candidates on a real install, because the host refuses an
 * undeclared purpose. That is precisely the "source presence substituted for
 * loaded third-party use" failure QB-01 names, and it is invisible to any test
 * that hands the source an account through a service double.
 *
 * So this suite decides two facts that a double cannot:
 *
 *  1. the declaration a human needs in order to create this connection and bind
 *    it to this source's purpose through ordinary Happier surfaces exists, is
 *    internally consistent, and is expressible in the dialect an Action may
 *    actually name; and
 *  2. the runtime the host would drive is really registered through the public
 *    activation path, and settles the connection deterministically with no
 *    network, no provider exchange, and no credential this fixture invents.
 *
 * Every census below is a pure function over the shape it judges and is
 * exercised twice: once against the shipped artifact, and once against a
 * deliberately wrong shape naming the implementation the check exists to reject.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createPluginTestkit } from '@happier-dev/plugin-sdk/testing';
import { TRIAGE_SOURCES_TARGET_PLUGIN_ID_V1 } from '@happier-dev/triage-protocol/v1';

import { activate } from '../src/index.mjs';

const fixtureRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** The shipped artifact, not the live module projection. See `sourceAbiConformance`. */
const shippedManifest = JSON.parse(
    readFileSync(join(fixtureRoot, '.happier-plugin', 'plugin.json'), 'utf8'),
);

/**
 * The shipped public identities, written as literals on purpose.
 *
 * A census that imported the module's own constants would agree with any
 * rename, including one that breaks every human who already connected this
 * account. These are the bytes an outside reader sees.
 */
const LEDGER_ACCOUNT_PURPOSE = 'acme-ledger-api';
const LEDGER_CONNECTED_ACCOUNT_ID = 'acme-ledger-account';
const LEDGER_CONNECTION_MODE_ID = 'fixture-key';
const LEDGER_CONNECTION_FIELD_ID = 'fixture-key';
const LEDGER_FIXTURE_KEY = 'acme-ledger-fixture-key';

/**
 * The id dialect an Action's `hostAccess` list may name.
 *
 * This is the trap the fixture fell into: a Triage descriptor `purpose` is a
 * bounded identifier that happily accepts `acme.ledger.api`, while the Action to
 * HostAccess reference it has to travel through does not. A purpose only the
 * descriptor can spell is a purpose no Action can read through.
 */
const ACTION_HOST_ACCESS_ID_PATTERN = /^[a-z0-9]+(?:[-/][a-z0-9]+)*$/u;

/** The source roles whose published input carries the account it reads through. */
const ACCOUNT_BEARING_ROLES = Object.freeze(['scan', 'get']);
const ACCOUNT_INPUT_PATH = 'instance.binding.account';

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function readTriageContribution(manifest) {
    return (manifest.contributes?.targetedPluginContributions ?? []).find(
        (contribution) => contribution.target?.pluginId === TRIAGE_SOURCES_TARGET_PLUGIN_ID_V1,
    );
}

function readAction(manifest, actionId) {
    return (manifest.contributes?.actions ?? []).find((action) => action.id === actionId);
}

/**
 * Judges whether the account purpose this source reads through is one a loaded
 * host can bind, list, and dispatch — not merely one the Triage descriptor is
 * willing to spell.
 *
 * Returns the findings that hold; an empty array is conformance.
 */
export function censusPurposeBoundAccountAuthoring(manifest) {
    const findings = [];
    const contribution = readTriageContribution(manifest);
    if (contribution === undefined) return ['the manifest declares no Triage source contribution'];

    const purpose = contribution.descriptor?.purpose;
    if (typeof purpose !== 'string' || purpose.length === 0) {
        return ['the source descriptor declares no Connected Account purpose'];
    }
    if (!ACTION_HOST_ACCESS_ID_PATTERN.test(purpose)) {
        findings.push(`purpose '${purpose}' cannot be named by an Action's hostAccess list`);
    }

    const declaredServices = new Set(
        (manifest.contributes?.connectedAccountDescriptors ?? []).map((service) => service.id),
    );
    const request = (manifest.hostAccess?.required ?? []).find(
        (candidate) => candidate.capability === 'connectedAccounts' && candidate.id === purpose,
    );
    if (request === undefined) {
        findings.push(
            `purpose '${purpose}' has no connectedAccounts HostAccess request,`
            + ' so the host refuses listAccounts as undeclared',
        );
    } else {
        if (!(request.scope?.operations ?? []).includes('use')) {
            findings.push(`purpose '${purpose}' does not authorize 'use', so it cannot list accounts`);
        }
        for (const serviceRef of request.scope?.serviceRefs ?? []) {
            const localId = typeof serviceRef === 'string' ? serviceRef : serviceRef?.localId;
            if (!declaredServices.has(localId)) {
                findings.push(`purpose '${purpose}' names service '${localId}', which this manifest never declares`);
            }
        }
    }

    for (const [role, actionId] of Object.entries(contribution.operations ?? {})) {
        const action = readAction(manifest, actionId);
        if (action === undefined) {
            findings.push(`${role}: '${actionId}' is bound to no declared Action`);
            continue;
        }
        if (!(action.hostAccess ?? []).includes(purpose)) {
            findings.push(`${role}: '${actionId}' reads accounts but declares no '${purpose}' hostAccess`);
        }
        if (!ACCOUNT_BEARING_ROLES.includes(role)) continue;
        const bound = (action.connectedAccountPurposeBindings ?? []).some(
            (binding) => binding.path === ACCOUNT_INPUT_PATH && binding.purpose === purpose,
        );
        if (!bound) {
            findings.push(
                `${role}: '${actionId}' carries an account at ${ACCOUNT_INPUT_PATH}`
                + ' but declares no purpose binding for it',
            );
        }
    }
    return findings;
}

test('QB-01: the shipped source declares an account purpose a loaded host can bind and dispatch', () => {
    assert.deepEqual(censusPurposeBoundAccountAuthoring(shippedManifest), []);

    // The census is judging the real identities, not an empty manifest that
    // trivially satisfies every rule it skipped.
    const contribution = readTriageContribution(shippedManifest);
    assert.equal(contribution.descriptor.purpose, LEDGER_ACCOUNT_PURPOSE);
    assert.deepEqual(
        shippedManifest.contributes.connectedAccountDescriptors.map((service) => service.id),
        [LEDGER_CONNECTED_ACCOUNT_ID],
    );
});

test('QB-01: the census rejects each way a declared purpose becomes unreachable', () => {
    // Wrong implementation 1: the descriptor names a purpose the manifest never
    // requests. This is the shape that yields zero candidates on a real install
    // while every schema and conformance check stays green.
    const undeclared = clone(shippedManifest);
    undeclared.hostAccess.required = undeclared.hostAccess.required.filter(
        (request) => request.capability !== 'connectedAccounts',
    );
    assert.ok(censusPurposeBoundAccountAuthoring(undeclared)
        .some((finding) => finding.includes('refuses listAccounts as undeclared')));

    // Wrong implementation 2: a dotted purpose. The Triage identifier accepts
    // it; the Action to HostAccess reference cannot spell it.
    const dotted = clone(shippedManifest);
    const dottedPurpose = 'acme.ledger.api';
    dotted.contributes.targetedPluginContributions[0].descriptor.purpose = dottedPurpose;
    assert.ok(censusPurposeBoundAccountAuthoring(dotted)
        .some((finding) => finding.includes(`purpose '${dottedPurpose}' cannot be named`)));

    // Wrong implementation 3: the request points at a service nobody ships, so
    // there is no connection a human could ever create for it.
    const danglingService = clone(shippedManifest);
    danglingService.hostAccess.required.find(
        (request) => request.capability === 'connectedAccounts',
    ).scope.serviceRefs = ['acme-ledgr'];
    assert.ok(censusPurposeBoundAccountAuthoring(danglingService)
        .some((finding) => finding.includes('never declares')));

    // Wrong implementation 4: the walk carries an account in its input that the
    // host was never told to resolve.
    const unboundScan = clone(shippedManifest);
    const scanActionId = readTriageContribution(unboundScan).operations.scan;
    delete readAction(unboundScan, scanActionId).connectedAccountPurposeBindings;
    assert.ok(censusPurposeBoundAccountAuthoring(unboundScan)
        .some((finding) => finding.includes('declares no purpose binding for it')));
});

test('QB-01: the connection a human creates needs one manual mode and no provider credential', () => {
    const [service] = shippedManifest.contributes.connectedAccountDescriptors;
    const { authentication } = service;

    assert.equal(authentication.defaultModeId, LEDGER_CONNECTION_MODE_ID);
    assert.deepEqual(
        authentication.modes.map((mode) => [mode.id, mode.kind, mode.outcomeReconciliation]),
        [[LEDGER_CONNECTION_MODE_ID, 'manual', 'none']],
    );
    assert.deepEqual(
        authentication.modes[0].fields.map((field) => [field.id, field.secret]),
        [[LEDGER_CONNECTION_FIELD_ID, true]],
    );

    // The provider is in-process, so no credential is ever materialized. An
    // authorized materialization kind here would be a claim this fixture cannot
    // honour, and would let a review believe real credential traffic was proven.
    const request = shippedManifest.hostAccess.required.find(
        (candidate) => candidate.capability === 'connectedAccounts',
    );
    assert.equal(Object.hasOwn(request.scope, 'materializationKinds'), false);
    assert.deepEqual(request.scope.operations, ['use']);
});

// ---------------------------------------------------------------------------
// The registered runtime — reached only through the public activation path
// ---------------------------------------------------------------------------

async function installSource() {
    return await createPluginTestkit({
        manifest: shippedManifest,
        module: { activate },
        services: {
            connectedAccounts: {
                listAccounts: async () => ({ status: 'complete', accounts: [] }),
            },
        },
    });
}

/**
 * The one genuine system boundary this runtime touches.
 *
 * Credential custody belongs to the host, so it is doubled; nothing else is.
 * The double records what was written, which is what makes "rejected" provable
 * rather than merely returned.
 */
function connectionContext(stored) {
    const credentials = new Map(stored === undefined ? [] : [[LEDGER_CONNECTION_FIELD_ID, stored]]);
    const store = {
        get: async (fieldId) => credentials.get(fieldId) ?? null,
        set: async (fieldId, value) => {
            credentials.set(fieldId, value);
        },
    };
    return {
        credentials: store,
        attemptCredentials: store,
        configuration: { values: {} },
        stored: () => Object.fromEntries(credentials),
    };
}

async function withRegisteredRuntime(run) {
    const source = await installSource();
    try {
        const runtime = source.registration(
            'connectedAccountDescriptors',
            LEDGER_CONNECTED_ACCOUNT_ID,
        );
        assert.ok(runtime, 'the source registered no connected-account runtime');
        await run(runtime);
    } finally {
        await source.dispose();
    }
}

test('QB-59: activation registers the runtime the declared mode promises', async () => {
    await withRegisteredRuntime((runtime) => {
        assert.deepEqual(Object.keys(runtime.authentication.modes), [LEDGER_CONNECTION_MODE_ID]);
        assert.equal(runtime.authentication.modes[LEDGER_CONNECTION_MODE_ID].kind, 'manual');
    });
});

test('QB-59: the fixture connection settles deterministically and stores only what it was given', async () => {
    await withRegisteredRuntime(async (runtime) => {
        const mode = runtime.authentication.modes[LEDGER_CONNECTION_MODE_ID];

        const accepted = connectionContext();
        const connected = await mode.complete(
            { fields: { [LEDGER_CONNECTION_FIELD_ID]: LEDGER_FIXTURE_KEY } },
            accepted,
        );
        assert.equal(connected.status, 'connected');
        assert.deepEqual(accepted.stored(), { [LEDGER_CONNECTION_FIELD_ID]: LEDGER_FIXTURE_KEY });

        // A completion that accepted anything would pass the case above too.
        // This is the case that separates a real decision from a rubber stamp,
        // and it must leave the host's credential store untouched.
        const refused = connectionContext();
        const rejected = await mode.complete(
            { fields: { [LEDGER_CONNECTION_FIELD_ID]: 'not-the-published-key' } },
            refused,
        );
        assert.equal(rejected.status, 'rejected');
        assert.equal(typeof rejected.diagnostic.code, 'string');
        assert.deepEqual(refused.stored(), {});
    });
});

test('QB-59: health reports the connection the host stored, not the one it wishes for', async () => {
    await withRegisteredRuntime(async (runtime) => {
        assert.equal(
            (await runtime.status(connectionContext(LEDGER_FIXTURE_KEY))).status,
            'connected',
        );
        assert.equal(
            (await runtime.status(connectionContext('stale-key'))).status,
            'reconnectRequired',
        );
        assert.equal((await runtime.status(connectionContext())).status, 'unavailable');

        // A pasted fixture key has no rotation exchange, so refresh is health.
        assert.equal(
            (await runtime.refresh(connectionContext(LEDGER_FIXTURE_KEY))).status,
            'connected',
        );
        assert.equal((await runtime.revoke(connectionContext())).status, 'remoteUnsupported');
    });
});

test('QB-59: the connection materializes no credential, matching what it declared', async () => {
    await withRegisteredRuntime(async (runtime) => {
        await assert.rejects(async () => runtime.materialize(
            { kind: 'httpHeaders', origin: 'https://ledger.invalid', headerNames: ['authorization'] },
            connectionContext(LEDGER_FIXTURE_KEY),
        ));
    });
});
