import {
    encodePosthogConfiguration,
    type PosthogConfigurationEncoding,
    type PosthogConfigurationToken,
    type PosthogConfiguredEnvironment,
} from '../source/instance.js';

export type PosthogConfigurationSelectionInput = Readonly<{
    organizationUuid: string;
    scanWindowPolicy: PosthogConfigurationToken['scanWindowPolicy'];
    detailWindowPolicy: PosthogConfigurationToken['detailWindowPolicy'];
}>;

export type PosthogEnvironmentSelectionPreflight = Readonly<{
    environments: readonly PosthogConfiguredEnvironment[];
    encoding: PosthogConfigurationEncoding;
    accepted: boolean;
}>;

export type PosthogDiscoveredEnvironmentFit = Readonly<{
    /** The environments the returned token actually carries, in discovery order. */
    environments: readonly PosthogConfiguredEnvironment[];
    token: string;
    /** `true` when the discovered set did not fit and this draft carries a prefix. */
    bounded: boolean;
}>;

/**
 * Fits a discovered environment set into one draft configuration token.
 *
 * The token bound is real and is not raised here. What changes is what an organization
 * whose environments exceed it produces: a draft carrying as many of them as fit, rather
 * than nothing at all. A candidate with no draft has no editor to open, so a first-time
 * reader whose organization is too large could never reach the selection UI to choose
 * the smaller subset that would have fit — the bound became an onboarding dead end
 * instead of a boundary.
 *
 * This is a starting selection for that editor and never a save: the editor re-reads the
 * organization's environments itself, and `preflightPosthogEnvironmentSelection` still
 * measures every prospective user selection through the same canonical codec.
 * `null` means not even one environment encodes, which is a configuration failure rather
 * than a capacity one.
 */
export function fitPosthogDiscoveredEnvironments(
    discovered: readonly PosthogConfiguredEnvironment[],
    input: PosthogConfigurationSelectionInput,
): PosthogDiscoveredEnvironmentFit | null {
    const encode = (environments: readonly PosthogConfiguredEnvironment[]) => encodePosthogConfiguration({
        v: 1,
        organizationUuid: input.organizationUuid,
        environments,
        scanWindowPolicy: input.scanWindowPolicy,
        detailWindowPolicy: input.detailWindowPolicy,
    });

    const whole = encode(discovered);
    if (whole.ok) {
        return { environments: discovered, token: whole.token, bounded: false };
    }
    if (whole.reason !== 'tokenTooLarge') return null;

    let fitted: PosthogDiscoveredEnvironmentFit | null = null;
    for (let count = 1; count < discovered.length; count += 1) {
        const prefix = discovered.slice(0, count);
        const encoding = encode(prefix);
        if (!encoding.ok) break;
        fitted = { environments: prefix, token: encoding.token, bounded: true };
    }
    return fitted;
}

/**
 * Measures a proposed subset through the canonical token encoder before UI state moves.
 * A rejected proposal returns the previous subset verbatim, so a capacity failure can
 * never silently turn a working selection into a configuration that the target rejects.
 */
export function preflightPosthogEnvironmentSelection(
    current: readonly PosthogConfiguredEnvironment[],
    proposed: readonly PosthogConfiguredEnvironment[],
    input: PosthogConfigurationSelectionInput,
): PosthogEnvironmentSelectionPreflight {
    const encoding = encodePosthogConfiguration({
        v: 1,
        organizationUuid: input.organizationUuid,
        environments: proposed,
        scanWindowPolicy: input.scanWindowPolicy,
        detailWindowPolicy: input.detailWindowPolicy,
    });
    return encoding.ok
        ? { environments: proposed, encoding, accepted: true }
        : { environments: current, encoding, accepted: false };
}
