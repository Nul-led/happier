export type BundledPackagedRuntimeEligibility = Readonly<{
  hasDaemonEntrypoint: boolean;
  hasResources: boolean;
  requiresSessionRunnerFactory: boolean;
  hasManagedProviderRuntime: boolean;
  hasConnectedAccountDescriptors: boolean;
}>;

export function requiresBundledPackagedRuntime(
  eligibility: BundledPackagedRuntimeEligibility,
): boolean {
  return eligibility.hasDaemonEntrypoint
    || eligibility.hasResources
    || eligibility.requiresSessionRunnerFactory
    || eligibility.hasManagedProviderRuntime
    || eligibility.hasConnectedAccountDescriptors;
}
