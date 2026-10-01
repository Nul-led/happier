import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { loadIrohNodeNative } from '@happier-dev/iroh-native/node';
import { createEphemeralPeerRouteProofHandleV2, type LocalServicePreviewResourceV1 } from '@happier-dev/protocol';
import { LocalServicePreviewNativeDirectAccessV1Schema } from '@happier-dev/protocol/local/services/preview/nativeDirect';
import { startNativePreviewHomeIntegrationFixture } from '@happier-tests/server-machine-carrier-grant';
import { createPeerMediationLoopbackApp } from '../../../../apps/cli/src/daemon/peer/mediation/loopback/server';
import { createLocalServicePreviewRoutes } from '../../../../apps/cli/src/daemon/local/services/preview/routes';
import { createLocalServicePreviewRegistry, registerLocalServicePreview } from '../../../../apps/cli/src/daemon/local/services/preview/registry';

// Account/Machine persistence is the only mocked boundary; all auth policy,
// registration, signing, native admission, mux and HTTP/WS adapters are real.
const machineBoundary = vi.hoisted(() => ({ endpointId: '' }));
vi.mock('../../../../apps/server/sources/storage/db', () => ({ db: { machine: {
    findFirst: async (query: Readonly<{ where: Readonly<{ id: string; accountId: string }> }>) => (
        query.where.id === 'machine_1' && query.where.accountId === 'account_1'
            ? { id: 'machine_1', revokedAt: null, replacedByMachineId: null,
                operationProtocolCapabilitiesRevision: 1,
                operationProtocolCapabilities: {
                    irohMachineEndpoint: { protocolVersions: [1], endpointId: machineBoundary.endpointId },
                    localServicePreviewNativeAccess: { protocolVersions: [1] },
                } }
            : null
    ),
} } }));

const packageRoot = process.env.HAPPIER_IROH_TEST_PACKAGE_ROOT;

async function acceptsGuestConnection(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = connect({ host: '127.0.0.1', port });
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => { socket.destroy(); resolve(false); });
    });
}
describe.skipIf(!packageRoot)('native preview composed with the actual daemon mux', () => {
    it('streams HTTP/WS through registration policy and closes live viewers on server revoke', async () => {
        const cleanup: Array<() => void | Promise<unknown>> = [];
        onTestFinished(async () => {
            const failures: unknown[] = [];
            for (const close of cleanup.reverse()) {
                try { await close(); } catch (error) { failures.push(error); }
            }
            if (failures.length) throw new AggregateError(failures, 'Native preview test cleanup failed');
        });
        const loaded = loadIrohNodeNative(packageRoot);
        if (!loaded.available) throw new Error('W14 requires the real native addon');
        const native = loaded.native;
        const target = createServer((_request, response) => { response.end('registered-preview'); });
        cleanup.push(async () => {
            target.closeAllConnections();
            await new Promise<void>((resolve) => target.close(() => resolve()));
        });
        const wsServer = new WebSocketServer({ server: target });
        cleanup.push(() => { for (const socket of wsServer.clients) socket.terminate(); wsServer.close(); });
        wsServer.on('connection', (socket) => socket.on('message', (bytes, binary) => socket.send(bytes, { binary })));
        target.listen(0, '127.0.0.1');
        await once(target, 'listening');
        const targetAddress = target.address();
        if (!targetAddress || typeof targetAddress === 'string') throw new Error('target unavailable');
        const machine = await native.createEndpoint({ relayPolicy: 'disabled', capProfile: 'machineBulk' });
        cleanup.push(() => native.shutdownEndpoint({ endpointHandle: machine.endpointHandle }));
        const viewer = await native.createEndpoint({ relayPolicy: 'disabled', capProfile: 'machineBulk' });
        cleanup.push(() => native.shutdownEndpoint({ endpointHandle: viewer.endpointHandle }));
        machineBoundary.endpointId = machine.endpointId;
        const home = await startNativePreviewHomeIntegrationFixture({ accountId: 'account_1' });
        cleanup.push(() => home.close());
        const homeOrigin = home.serverUrl;
        const registry = createLocalServicePreviewRegistry();
        const preview: LocalServicePreviewResourceV1 = {
            previewId: 'preview_1', machineId: 'machine_1', owner: { kind: 'user', id: 'account_1' },
            target: { scheme: 'http', host: '127.0.0.1', port: targetAddress.port },
            initialPath: { pathname: '/', search: '' }, display: { title: 'Preview', addressLabel: 'loopback' }, originMode: 'host',
            policy: { allowedMethods: ['GET'], cookiePolicy: 'drop', compressionPolicy: 'identity', redirectPolicy: 'preserve_host_origin',
                maxRequestBodyBytes: 1_048_576, maxResponseBodyBytes: 1_048_576 },
        };
        expect(registerLocalServicePreview(registry, preview).ok).toBe(true);
        const routes = createLocalServicePreviewRoutes({ machineId: 'machine_1', accountId: 'account_1', registry,
            server: { token: home.token, serverBaseUrl: homeOrigin } });
        // Use the real authenticated registration route, not a manually populated server row.
        const registration = await fetch(`${homeOrigin}/v1/local-services/preview`, { method: 'POST',
            headers: { authorization: `Bearer ${home.token}`, 'content-type': 'application/json' }, body: JSON.stringify(preview) });
        expect(registration.status).toBe(201);
        const trustRoots = home.trustRoots;
        let daemonPort = 0;
        const daemon = createPeerMediationLoopbackApp({ nowMs: Date.now,
            expected: { accountId: 'account_1', machineId: 'machine_1', flowKind: 'tcp_tunnel', routeKind: 'loopback_direct', endpointFingerprint: machine.endpointId },
            trustRoots, tunnel: { acquirePreviewApplication: routes.acquireNativeApplication },
            irohMachineAdmission: { localEndpointId: machine.endpointId, role: 'acceptor', allowedFlows: ['tcp_tunnel'],
                resolveTrustRoots: () => trustRoots, resolveApplicationTarget: () => ({ port: daemonPort }) },
        });
        cleanup.push(() => daemon.close());
        const daemonOrigin = await daemon.listen({ host: '127.0.0.1', port: 0 });
        daemonPort = Number(new URL(daemonOrigin).port);
        await native.startMachineAcceptor({ endpointHandle: machine.endpointHandle, admissionPort: daemonPort });
        cleanup.push(() => native.stopMachineAcceptor({ endpointHandle: machine.endpointHandle }));
        const proof = createEphemeralPeerRouteProofHandleV2({ randomBytes });
        let leaseId: string | undefined;
        let socket: WebSocket | undefined;
        try {
            const accessResponse = await fetch(`${homeOrigin}/v1/local-services/preview/preview_1/access`, { method: 'POST',
                headers: { authorization: `Bearer ${home.token}`, 'content-type': 'application/json' },
                body: JSON.stringify({ v: 1, initiator: { kind: 'account_client', endpointId: viewer.endpointId }, ephemeralPublicKeyBase64Url: proof.publicKeyBase64Url }) });
            expect(accessResponse.status).toBe(200);
            const access = LocalServicePreviewNativeDirectAccessV1Schema.parse(await accessResponse.json());
            expect(access.grant.payload.exp).toBeNull();
            const signedProof = proof.sign(access.grant);
            const scope = access.grant.payload.scope;
            if (scope.kind !== 'tcp_tunnel') throw new Error('wrong scope');
            const open = { v: 2, kind: 'open', tunnelId: scope.tunnelId, targetMachineId: 'machine_1', routeKind: 'iroh_peer',
                destination: access.destination, grant: access.grant, proof: signedProof };
            const handshake = { v: 1, flow: 'tcp_tunnel', accountId: access.grant.payload.accountId,
                initiator: access.grant.payload.iroh!.initiator, target: access.grant.payload.iroh!.target, grant: access.grant, proof: signedProof };
            const status = await native.getEndpointStatus(machine.endpointHandle);
            const lease = await native.startMachineTunnel({ endpointHandle: viewer.endpointHandle, endpointId: machine.endpointId,
                directAddresses: status?.directAddresses, handshakeJson: JSON.stringify(handshake),
                nativeHttpLease: { openJson: JSON.stringify(open) }, capProfile: 'machineBulk' });
            leaseId = lease.machineTunnelId;
            expect(lease.localCapability).toBeUndefined();
            const origin = `http://127.0.0.1:${lease.localPort}`;
            expect(await (await fetch(origin)).text()).toBe('registered-preview');
            expect((await fetch(origin, { method: 'POST', body: 'denied-by-registration-policy' })).status).toBe(405);
            socket = new WebSocket(origin.replace('http:', 'ws:') + '/hmr');
            await once(socket, 'open');
            const echoed = once(socket, 'message');
            const bytes = Buffer.alloc(128 * 1024, 0xa5);
            socket.send(bytes);
            const [actual] = await echoed;
            expect(actual).toEqual(bytes);
            const closed = once(socket, 'close');
            // Revocation goes directly to server; the stale local row is deliberately retained.
            const revoked = await fetch(`${homeOrigin}/v1/local-services/preview/preview_1`, { method: 'DELETE', headers: { authorization: `Bearer ${home.token}` } });
            expect(revoked.status).toBe(200);
            await closed;
            await vi.waitFor(async () => expect(await acceptsGuestConnection(lease.localPort)).toBe(false));
            expect(registry.previewsById.has('preview_1')).toBe(true);
            await expect(fetch(origin)).rejects.toThrow();
            await expect(routes.acquireNativeApplication(scope.preview!, access.grant.payload.grantId)).rejects.toThrow();
        } finally {
            socket?.terminate();
            proof.dispose();
            if (leaseId) await native.stopMachineTunnel(leaseId);
        }
    }, 60_000);
});
