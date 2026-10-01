import { describe, expect, it } from 'vitest';

import {
    readAppHomeSessionCount,
    readSessionsAStopWouldEnd,
    sessionVisibilityCoversManagedServices,
    type AppHomeView,
} from './thisComputerSessionVisibility';

const managed = (relayUrl: string, actions: Array<'start' | 'restart' | 'stop'> = ['stop']) => ({
    relayUrl, state: 'connected' as const, appManaged: true, serviceTargetMode: 'pinned' as const, actions,
});

const view = (overrides: Partial<AppHomeView> = {}, status: Record<string, unknown> = {}): AppHomeView => ({
    status: {
        serviceInstalled: true,
        daemonRunning: true,
        needsAuth: false,
        machineId: 'machine_here',
        daemonServerUrl: 'https://home.example.test',
        daemonAccountId: 'acct_app',
        serviceRows: [managed('https://home.example.test')],
        serviceRowsComplete: true,
        runningManagedServiceCount: 1,
        ...status,
    },
    isDataReady: true,
    appAccountId: 'acct_app',
    activeRelayUrl: 'https://home.example.test',
    activeLocalRelayUrl: null,
    sessions: {},
    ...overrides,
});

describe('this computer\'s session visibility (A13-01, A13-07)', () => {
    it('knows the app Home\'s sessions only for its own daemon, signed in to the app\'s account, once sessions loaded', () => {
        expect(readAppHomeSessionCount(view())).toBe(0);
        expect(readAppHomeSessionCount(view({ isDataReady: false }))).toBeNull();
        expect(readAppHomeSessionCount(view({}, { daemonAccountId: 'acct_other' }))).toBeNull();
        expect(readAppHomeSessionCount(view({}, { daemonServerUrl: 'https://work.example.test' }))).toBeNull();
        expect(readAppHomeSessionCount(view({ status: null }))).toBeNull();
    });

    it('covers the managed services only when the producer\'s running count equals the running ones on the app\'s Home', () => {
        expect(sessionVisibilityCoversManagedServices(view())).toBe(true);
        // Another Home's managed service that is not running ends no session.
        expect(sessionVisibilityCoversManagedServices(view({}, { serviceRows: [managed('https://home.example.test'), managed('https://work.example.test', ['start'])] }))).toBe(true);
        expect(sessionVisibilityCoversManagedServices(view({}, {
            serviceRows: [managed('https://home.example.test'), managed('https://work.example.test')], runningManagedServiceCount: 2,
        }))).toBe(false);
        // A default and a pin serve the app's Home: one row, two running services.
        expect(sessionVisibilityCoversManagedServices(view({}, { runningManagedServiceCount: 2 }))).toBe(false);
        expect(sessionVisibilityCoversManagedServices(view({}, { runningManagedServiceCount: null }))).toBe(false);
        expect(sessionVisibilityCoversManagedServices(view({}, { serviceRowsComplete: false }))).toBe(false);
        expect(sessionVisibilityCoversManagedServices(view({}, { serviceRows: null }))).toBe(false);
    });

    it('knows a stop ends no session when the complete inventory has nothing managed running, even unseen (N-15)', () => {
        const nothingRunning = { runningManagedServiceCount: 0, serviceRows: [managed('https://home.example.test', ['start'])], daemonRunning: false };
        expect(readSessionsAStopWouldEnd(view({ isDataReady: false, appAccountId: null }, nothingRunning))).toBe(0);
        expect(readSessionsAStopWouldEnd(view({ isDataReady: false }, { ...nothingRunning, serviceRowsComplete: false }))).toBeNull();
        expect(readSessionsAStopWouldEnd(view())).toBe(0);
        expect(readSessionsAStopWouldEnd(view({}, { runningManagedServiceCount: 2 }))).toBeNull();
    });
});
