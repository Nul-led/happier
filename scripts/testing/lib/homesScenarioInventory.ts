/**
 * Lane 09 requirement map: the stable acceptance requirement IDs from
 * `.project/plans/new-architecture/implementation/lane-09-integration-validation.md` §7,
 * grouped by the product lane that owns each family's behavior, with the ordinary executable
 * test files that exist for that family today.
 *
 * This is routing metadata only. It owns no run status (`verified|failed|blocked|not-run`), no
 * evidence prose, no implementation diagnosis, no target identity, and no history: the sole
 * Lane 09 release report owns certification status. A green run of a mapped file is supporting
 * evidence and never completes an acceptance requirement by itself; a family with no entry in
 * `executableTestPaths` has no ordinary executable test yet.
 */
export type HomesScenarioId =
  | `F-PH-${number} ${string}`
  | `F-MH-${number} ${string}`
  | `F-AD-${number} ${string}`
  | `F-QR-${number} ${string}`
  | `F-IR-${number} ${string}`
  | `F-OP-${number} ${string}`
  | `F-MU-${number} ${string}`;

export interface HomesScenarioFamilyMapEntry {
  familyId: string;
  requirementIds: readonly HomesScenarioId[];
  productOwner: string;
  executableTestPaths: readonly string[];
}

export const HOMES_SCENARIO_FAMILY_MAP: readonly HomesScenarioFamilyMapEntry[] = Object.freeze([
  {
    familyId: 'personalHome',
    requirementIds: [
      'F-PH-01 freshDesktopPersonalHome',
      'F-PH-02 bootstrapRecovery',
      'F-PH-03 signupClosure',
      'F-PH-04 personalHomeNoIngress',
      'F-PH-05 daemonSetupNonBlocking',
    ],
    productOwner: 'Lane 03 — Personal Home runtime and shell-first bootstrap',
    executableTestPaths: [
      'packages/tests/suites/contracts/personalHome.scenario.test.ts',
    ],
  },
  {
    familyId: 'personalHomeOperations',
    requirementIds: [
      'F-OP-01 uninstallPreservesData',
      'F-OP-02 backupRestore',
      'F-OP-03 plaintextSearch',
      'F-OP-04 relocation',
    ],
    productOwner: 'Lane 07 — Personal Home data operations',
    executableTestPaths: [
      'packages/tests/suites/contracts/personalHomeOperations.scenario.test.ts',
      'apps/server/sources/app/search/homeSearchLifecycle.spec.ts',
    ],
  },
  {
    familyId: 'multiHome',
    requirementIds: [
      'F-MH-01 concurrentHomes',
      'F-MH-02 focusDoesNotDisable',
      'F-MH-03 oneHomeOffline',
      'F-MH-04 explicitCreationTarget',
      'F-MH-05 logoutIsolation',
      'F-MH-06 pushAttribution',
    ],
    productOwner: 'Lane 04 — Multi-Home client runtime, selection, and notifications',
    executableTestPaths: [
      'packages/tests/suites/core-e2e/multiServer.switch.authAndSockets.slow.e2e.test.ts',
      'packages/tests/suites/core-e2e/multiServer.groupTarget.sessionListProjection.slow.e2e.test.ts',
      'packages/tests/suites/core-e2e/multiServer.serverScopedOperationRouting.slow.e2e.test.ts',
    ],
  },
  {
    familyId: 'accountDirectory',
    requirementIds: [
      'F-AD-01 registerDiscoverEnroll',
      'F-AD-02 directoryIndependentSteadyState',
      'F-AD-03 directoryAuthIsolation',
      'F-AD-04 assertionFailures',
      'F-AD-05 directoryMutations',
      'F-AD-06 homeOwnedDeviceApproval',
    ],
    productOwner: 'Lane 01/Lane 02 — Auth foundations and Account Directory enrollment',
    executableTestPaths: [
      'packages/tests/suites/contracts/accountDirectory.scenario.test.ts',
      'packages/tests/suites/core-e2e/accountDirectory.homeEnrollment.composedCaller.slow.e2e.test.ts',
      'packages/tests/suites/core-e2e/accountDirectory.enrollmentOutage.slow.e2e.test.ts',
    ],
  },
  {
    familyId: 'qr',
    requirementIds: [
      'F-QR-01 directQrNoDirectory',
      'F-QR-02 typedCredentialMatrix',
      'F-QR-03 qrFailures',
      'F-QR-04 v1Compatibility',
      'F-QR-05 reversePhoneApproval',
      'F-QR-06 directQrIrohOnly',
    ],
    productOwner: 'Lane 05 — QR enrollment and existing-device approval',
    executableTestPaths: [
      'packages/tests/suites/ui-e2e/auth.pairing.addPhone.desktopQrMobileScan.spec.ts',
    ],
  },
  {
    familyId: 'iroh',
    requirementIds: [
      'F-IR-01 forcedDirect',
      'F-IR-02 forcedRelay',
      'F-IR-03 standardOnly',
      'F-IR-04 networkChange',
      'F-IR-05 integrityFailure',
      'F-IR-06 streamAndPolling',
      'F-IR-07 canonicalOrigin',
      'F-IR-08 clientMachineTransfers',
    ],
    productOwner: 'Lane 06 — Iroh native connectivity',
    executableTestPaths: [
      'packages/tests/src/testkit/scenarios/iroh.scenario.test.ts',
      'apps/server/sources/app/iroh/homeIrohEndpoint.real.integration.test.ts',
    ],
  },
  {
    familyId: 'workspaceSync',
    requirementIds: [
      'F-MU-01 newEngineOneWay',
      'F-MU-02 crashRecovery',
      'F-MU-03 conflicts',
      'F-MU-04 oldEngineRetired',
      'F-MU-05 handoffFeatures',
      'F-MU-06 machineCarrier',
    ],
    productOwner: 'Lane 08 — Mutagen handoff replacement',
    executableTestPaths: [
      'apps/cli/src/daemon/startup/createDaemonWorkspaceSyncRuntime.real.integration.test.ts',
      'apps/cli/src/daemon/startup/createProductionDaemonWorkspaceSyncRuntime.test.ts',
      'apps/cli/src/daemon/peer/iroh/workspaceMachineCarrierLane08.real.integration.test.ts',
    ],
  },
]);
