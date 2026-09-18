/**
 * An operational backend target is not proof that a Runner can install and
 * start it. The exact creator producer composes managed installation with
 * Provider and broker readiness; without that mounted producer this decision
 * deliberately fails closed.
 */
export function resolveTemporaryComputerAgentCompatibility(input: Readonly<{
    catalogEntryPresent: boolean;
    canonicalAgentTargetPresent: boolean;
    creatorReadinessProducerPresent: boolean;
}>): boolean {
    return input.catalogEntryPresent
        && input.canonicalAgentTargetPresent
        && input.creatorReadinessProducerPresent;
}
