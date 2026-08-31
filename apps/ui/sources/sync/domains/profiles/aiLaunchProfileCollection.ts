import {
    AIBackendProfileSchema,
    isLaunchProfileV2,
    readAiLaunchProfileCollection,
    type AIBackendProfile,
    type AiLaunchProfile,
} from '@happier-dev/protocol';

export function projectAiLaunchProfileForLegacyUi(profile: AiLaunchProfile): AIBackendProfile {
    if (!isLaunchProfileV2(profile)) return profile;
    return AIBackendProfileSchema.parse({
        id: profile.id,
        name: profile.name,
        ...(profile.description !== undefined ? { description: profile.description } : {}),
        environmentVariables: profile.extraEnvironmentVariables,
        envVarRequirements: [],
        defaultPermissionModeByTargetKey: profile.defaultPermissionModeByTargetKey,
        defaultPersistenceModeByTargetKey: profile.defaultPersistenceModeByTargetKey,
        compatibilityByTargetKey: profile.compatibilityByTargetKey,
        compatibility: {},
        isBuiltIn: false,
        defaultEnabled: true,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        version: '2.0.0',
    });
}

export type UiAiLaunchProfileSnapshot = Readonly<{
    profiles: readonly AiLaunchProfile[];
    unreadableCount: number;
}>;

export function readUiAiLaunchProfileSnapshot(raw: unknown): UiAiLaunchProfileSnapshot {
    const profiles: AiLaunchProfile[] = [];
    let unreadableCount = 0;
    for (const entry of readAiLaunchProfileCollection(raw).entries) {
        if (entry.kind === 'opaque') {
            unreadableCount += 1;
        } else {
            profiles.push(entry.profile);
        }
    }
    return { profiles, unreadableCount };
}

export function readUiAiLaunchProfiles(raw: unknown): readonly AiLaunchProfile[] {
    return readUiAiLaunchProfileSnapshot(raw).profiles;
}

/**
 * The existing profile UI still consumes the legacy compatibility shape. Keep
 * conversion beside the Protocol-owned collection reader so opaque retained
 * rows never reach a legacy UI consumer as executable profile data.
 */
export function readUiAiLaunchProfilesForLegacyUi(raw: unknown): AIBackendProfile[] {
    return readUiAiLaunchProfiles(raw).map(projectAiLaunchProfileForLegacyUi);
}

function asRawCollection(raw: unknown): readonly unknown[] {
    return Array.isArray(raw) ? raw : [];
}

export function appendAiLaunchProfile(raw: unknown, profile: AiLaunchProfile): readonly unknown[] {
    if (readUiAiLaunchProfiles(raw).some((entry) => entry.id === profile.id)) {
        throw new Error(`AI launch profile '${profile.id}' already exists`);
    }
    return [...asRawCollection(raw), profile];
}

export function replaceAiLaunchProfile(
    raw: unknown,
    profileId: string,
    replacement: AiLaunchProfile,
): readonly unknown[] {
    let replaced = false;
    const entries = readAiLaunchProfileCollection(raw).entries;
    const next = entries.map((entry) => {
        if (entry.kind === 'opaque' || entry.profile.id !== profileId) return entry.raw;
        replaced = true;
        return replacement;
    });
    if (!replaced) throw new Error(`AI launch profile '${profileId}' does not exist`);
    return next;
}

export function removeAiLaunchProfile(raw: unknown, profileId: string): readonly unknown[] {
    return readAiLaunchProfileCollection(raw).entries.flatMap((entry) => (
        entry.kind !== 'opaque' && entry.profile.id === profileId ? [] : [entry.raw]
    ));
}

function removeRecordKey(value: unknown, key: string): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    if (!Object.prototype.hasOwnProperty.call(value, key)) return value;
    const next = { ...(value as Readonly<Record<string, unknown>>) };
    delete next[key];
    return next;
}

/**
 * The single Account Settings mutation for deleting a Launch Profile.
 *
 * Profile rows and their preference/binding residue are one user-visible
 * entity. Apply the deletion against the current CAS winner so Settings and
 * New Session cannot leave different subsets behind or overwrite concurrent
 * sibling settings.
 */
export function removeAiLaunchProfileFromAccountSettings(
    raw: Readonly<Record<string, unknown>>,
    profileId: string,
): Record<string, unknown> {
    return {
        ...raw,
        profiles: removeAiLaunchProfile(raw.profiles, profileId),
        ...(raw.lastUsedProfile === profileId ? { lastUsedProfile: null } : {}),
        ...(Array.isArray(raw.favoriteProfiles)
            ? { favoriteProfiles: raw.favoriteProfiles.filter((entry) => entry !== profileId) }
            : {}),
        ...(Object.prototype.hasOwnProperty.call(raw, 'profileEnabledById')
            ? { profileEnabledById: removeRecordKey(raw.profileEnabledById, profileId) }
            : {}),
        ...(Object.prototype.hasOwnProperty.call(raw, 'secretBindingsByProfileId')
            ? { secretBindingsByProfileId: removeRecordKey(raw.secretBindingsByProfileId, profileId) }
            : {}),
    };
}
