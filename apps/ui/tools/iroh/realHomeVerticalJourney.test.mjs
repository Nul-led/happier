// Contract for the A7.3 REAL Home vertical mode of the one Chromium proof
// harness.
//
// The journey itself needs a Rust-built addon, a live relay, a real Home
// acceptor and a real Chromium, so it cannot run here. These are the checks that
// decide whether a run's verdict can be believed at all:
//
//   1. the one harness exposes the real-journey mode as its own opt-in, and the
//      cheaper loaded-seam-only mode stays available and separately named;
//   2. the journey declares exactly the A7.3 observations the amendment
//      requires, so the list cannot silently shrink; and
//   3. a verdict is PASS only when every one of those observations was actually
//      recorded true — a missing or false observation, or any failure, must
//      never print PASS. This is the false-PASS discriminator: an implementation
//      that reports success because "nothing threw" fails it.
//
// Plus the vacuity guard the graph check needs: every page command the journey
// drives must really exist on the production seam page.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const toolsIrohDir = dirname(fileURLToPath(import.meta.url));

/** The exact A7.3 completion observations, in the amendment's own terms. */
const REQUIRED_OBSERVATIONS = [
    'exactRelayToIngresslessHome',
    'authenticatedHttpThroughCarrier',
    'liveSocketIoEventThroughCarrier',
    'reconnectAfterCarrierAcceptorRestartWithoutDuplicateEvent',
    'mismatchedEndpointIdSendsNoApplicationBytes',
    'browserReportsRelayOrUnknownOnly',
    'abortedHttpCancelsPromptlyAndNeverCompletesLate',
    'releaseClosesHomeStreamsAndConnections',
];

test('the one harness opts into the real journey without losing the loaded-seam-only mode', async () => {
    const harness = await import(resolve(toolsIrohDir, 'runBrowserIrohSharedEndpointProof.mjs'));

    assert.deepEqual(harness.parseProofModes([]), {
        productionPageSeam: false,
        realHomeVertical: false,
        machineTransferVertical: false,
    });
    assert.deepEqual(
        harness.parseProofModes(['--production-page-seam']),
        { productionPageSeam: true, realHomeVertical: false, machineTransferVertical: false },
        'the loaded-seam-only mode must remain available under its own name',
    );
    assert.deepEqual(
        harness.parseProofModes(['--real-home-vertical']),
        { productionPageSeam: false, realHomeVertical: true, machineTransferVertical: false },
        'the real Home vertical must be its own opt-in, not a rename of the loaded seam',
    );
});

test('the one browser journey keeps Chromium as the default while allowing explicit cross-engine QA', async () => {
    const harness = await import(resolve(toolsIrohDir, 'runBrowserIrohSharedEndpointProof.mjs'));

    assert.equal(harness.resolveProofBrowserEngine(undefined), 'chromium');
    assert.equal(harness.resolveProofBrowserEngine('firefox'), 'firefox');
    assert.equal(harness.resolveProofBrowserEngine('webkit'), 'webkit');
    assert.throws(
        () => harness.resolveProofBrowserEngine('safari'),
        /unsupported Playwright browser engine/u,
    );
});

test('the journey declares exactly the A7.3 observations the amendment requires', async () => {
    const journey = await import(resolve(toolsIrohDir, 'runRealHomeVerticalJourney.mjs'));
    assert.deepEqual([...journey.REQUIRED_A73_OBSERVATIONS].sort(), [...REQUIRED_OBSERVATIONS].sort());
});

test('a verdict is PASS only when every required observation was really recorded', async () => {
    const { REQUIRED_A73_OBSERVATIONS, evaluateRealHomeVerticalJourney } = await import(
        resolve(toolsIrohDir, 'runRealHomeVerticalJourney.mjs')
    );
    const complete = Object.fromEntries(REQUIRED_A73_OBSERVATIONS.map((name) => [name, true]));

    assert.equal(evaluateRealHomeVerticalJourney({ observations: complete, failures: [] }).verdict, 'PASS');

    // A run that simply never reached an observation must not pass.
    const { [REQUIRED_A73_OBSERVATIONS[0]]: _dropped, ...missingOne } = complete;
    const missing = evaluateRealHomeVerticalJourney({ observations: missingOne, failures: [] });
    assert.equal(missing.verdict, 'FAIL');
    assert.ok(
        missing.reasons.some((reason) => reason.includes(REQUIRED_A73_OBSERVATIONS[0])),
        'the verdict must name the observation that never ran',
    );

    // An observation that ran and was false is not a pass either.
    const falsified = evaluateRealHomeVerticalJourney({
        observations: { ...complete, [REQUIRED_A73_OBSERVATIONS[1]]: false },
        failures: [],
    });
    assert.equal(falsified.verdict, 'FAIL');

    // Nor is a complete observation set that also collected a failure.
    assert.equal(
        evaluateRealHomeVerticalJourney({ observations: complete, failures: ['home saw no request'] }).verdict,
        'FAIL',
    );

    // An empty run is the most important case: nothing observed, nothing passed.
    assert.equal(evaluateRealHomeVerticalJourney({ observations: {}, failures: [] }).verdict, 'FAIL');
});

test('every page command the journey drives really exists on the production seam page', async () => {
    const { REQUIRED_JOURNEY_PAGE_COMMANDS } = await import(resolve(toolsIrohDir, 'runRealHomeVerticalJourney.mjs'));
    const pageSource = readFileSync(resolve(toolsIrohDir, 'productionCarrierSeamPage.ts'), 'utf8');
    for (const name of REQUIRED_JOURNEY_PAGE_COMMANDS) {
        assert.match(
            pageSource,
            new RegExp(`^\\s{4}${name}:`, 'mu'),
            `the seam page must expose the ${name} command the journey drives`,
        );
    }
});

test('Home journey evidence records authentication outcomes without logging bearer material', async () => {
    const { summarizeHomeAuthenticationEvidence } = await import(
        resolve(toolsIrohDir, 'runRealHomeVerticalJourney.mjs')
    );

    const summary = summarizeHomeAuthenticationEvidence({
        authorizations: ['Bearer home-secret'],
        handshakePackets: [
            '0{"token":"socket-secret","clientType":"user-scoped"}',
            '2["ping-me",{}]',
        ],
    });

    assert.deepEqual(summary, {
        authenticatedHttpRequestCount: 1,
        socketHandshakePacketCount: 2,
        socketConnectPacketCount: 1,
        socketEventPacketCount: 1,
    });
    assert.doesNotMatch(JSON.stringify(summary), /home-secret|socket-secret|Bearer/u);
});
