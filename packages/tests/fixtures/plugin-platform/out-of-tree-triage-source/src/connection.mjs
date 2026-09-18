/**
 * The `acme-ledger` Connected Account runtime.
 *
 * `listInstances` reads its accounts through the host's purpose-bound Connected
 * Accounts service, and the host only answers for a purpose the manifest
 * declares and an account a human actually connected. Without a service to
 * connect, this source is authorable on paper and unusable in a real install:
 * `qa/QA-PROTOCOL.md` QB-01's "loaded third-party activation and use" has
 * nothing to run against, and a harness account double proves only that the
 * double works.
 *
 * So the fixture ships a connection a human can create through the ordinary
 * Connected Accounts surfaces — and, because the provider it stands for is
 * in-process, that connection is synthetic all the way down. It reaches no
 * network, performs no provider exchange, and materializes no credential; the
 * manifest declares no `materializationKinds`, so the host authorizes none.
 *
 * The published fixture key is the whole secret. It authenticates nothing
 * outside this fixture, and requiring the exact value keeps `complete` a real
 * decision instead of a rubber stamp that would accept any input.
 */

export const LEDGER_CONNECTION_MODE_ID = 'fixture-key';
export const LEDGER_CONNECTION_FIELD_ID = 'fixture-key';

/** Published on purpose: see this fixture's README. */
export const LEDGER_FIXTURE_KEY = 'acme-ledger-fixture-key';

export const LEDGER_CONNECTION_DISPLAY_NAME = 'Acme Ledger fixture';

export const LEDGER_CONNECTION_DIAGNOSTIC_CODES = Object.freeze({
    keyRejected: 'acme/fixture-key-rejected',
    keyUnavailable: 'acme/fixture-key-unavailable',
});

function diagnostic(code, message) {
    return { code, severity: 'error', message };
}

async function completeFixtureConnection(input, context, options) {
    const offered = input.fields[LEDGER_CONNECTION_FIELD_ID]?.trim() ?? '';
    if (offered !== LEDGER_FIXTURE_KEY) {
        // Nothing is written on the way out: a refused attempt must not leave
        // the host holding a credential it would later report as connected.
        return {
            status: 'rejected',
            diagnostic: diagnostic(
                LEDGER_CONNECTION_DIAGNOSTIC_CODES.keyRejected,
                'Acme Ledger expects the published fixture key for this connection.',
            ),
        };
    }
    await context.attemptCredentials.set(LEDGER_CONNECTION_FIELD_ID, offered, options);
    return {
        status: 'connected',
        displayName: LEDGER_CONNECTION_DISPLAY_NAME,
        // The fixture grants no provider scope, and claiming one would be a
        // capability assertion this connection cannot honour.
        scopes: [],
    };
}

async function readFixtureHealth(context, options) {
    const stored = (await context.credentials.get(LEDGER_CONNECTION_FIELD_ID, options))?.trim() ?? '';
    if (stored === '') {
        return {
            status: 'unavailable',
            diagnostic: diagnostic(
                LEDGER_CONNECTION_DIAGNOSTIC_CODES.keyUnavailable,
                'The Acme Ledger fixture key is unavailable; reconnect the account.',
            ),
        };
    }
    return stored === LEDGER_FIXTURE_KEY
        ? { status: 'connected', displayName: LEDGER_CONNECTION_DISPLAY_NAME }
        : {
            status: 'reconnectRequired',
            diagnostic: diagnostic(
                LEDGER_CONNECTION_DIAGNOSTIC_CODES.keyRejected,
                'The stored Acme Ledger key is not the published fixture key.',
            ),
        };
}

const ledgerConnectedAccountRuntimeDefinition = {
    authentication: {
        modes: {
            [LEDGER_CONNECTION_MODE_ID]: {
                kind: 'manual',
                complete: completeFixtureConnection,
            },
        },
    },
    async refresh(context, options) {
        // A pasted fixture key has no refresh exchange. Reporting current health
        // is the honest answer rather than a rotation this credential never has.
        return readFixtureHealth(context, options);
    },
    async revoke() {
        return { status: 'remoteUnsupported' };
    },
    async status(context, options) {
        return readFixtureHealth(context, options);
    },
    async materialize() {
        // This source reads an in-process provider, so it declares no
        // materialization kind and the host authorizes none. Refusing here keeps
        // the declaration and the runtime one fact rather than two.
        throw new Error('acme_ledger_materializes_no_credential');
    },
};

export const ledgerConnectedAccountRuntime = Object.freeze(
    ledgerConnectedAccountRuntimeDefinition,
);
