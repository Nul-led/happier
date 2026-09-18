import React from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { LocalSettings } from '../domains/settings/localSettings';
import type {
  AccountSettingsWriteDelta,
  Settings,
  SettingsWriteDelta,
} from '../domains/settings/settings';
import { settingsDefaults } from '../domains/settings/settings';
import {
  mergeCurrentSecretBindingsIntoRawBindings,
  readRetainedSecretBindingsByProfileId,
  type RetainedSecretBindingsByProfileId,
} from '../domains/settings/secretBindings';
import type {
  CurrentSessionAuthoringSelectionsRuntimeProjection,
} from '../domains/settings/sessionAuthoringSelectionPersistence';
import {
  replayFavoriteModelSelectionReplacementIntent,
  replayRememberedEngineSelectionReplacementIntent,
} from '../domains/settings/sessionAuthoringSelectionPersistence';
import { removeAiLaunchProfileFromAccountSettings } from '../domains/profiles/aiLaunchProfileCollection';
import { getSyncSingleton } from '@/sync/runtime/getSyncSingleton';
import type { SettingsAnalyticsSource } from '@/track/settingsAnalytics/types';
import { getStorage } from '@/sync/domains/state/storageStore';
import { requireOneShotAccountSettingsMutationApplied } from '@/sync/engine/settings/syncSettings';
import type { AccountSettingsScope } from '@/sync/domains/settings/scope/accountSettingsScope';

function requireSettingsVersion(settingsVersion: number | null): number {
  if (settingsVersion === null) throw new Error('Account settings version is unavailable');
  return settingsVersion;
}

async function persistAccountSettingsOnce(
  expectedSettingsScope: AccountSettingsScope | null,
  expectedSettingsVersion: number,
  mutate: (raw: Readonly<Record<string, unknown>>) => Record<string, unknown>,
): Promise<void> {
  requireOneShotAccountSettingsMutationApplied(
    await getSyncSingleton().mutateAccountSettingsOnce({
      expectedSettingsScope,
      expectedSettingsVersion,
      mutate: (raw) => ({ settings: mutate(raw), value: undefined }),
    }),
  );
}

function applyLocalSettingsFromStore(delta: Partial<LocalSettings>, source: SettingsAnalyticsSource): void {
  getStorage().getState().applyLocalSettings(delta, { source });
}

export function applyLocalSettingsFromDesktopMcpBridge(delta: Partial<LocalSettings>): void {
  applyLocalSettingsFromStore(delta, 'ui');
}

export function useAccountSettingsScope(): AccountSettingsScope | null {
  return getStorage()((state) => state.settingsScope);
}

function useAccountSettingsMutationSnapshot(): Readonly<{
  scope: AccountSettingsScope | null;
  version: number | null;
}> {
  return getStorage()(useShallow((state) => ({
    scope: state.settingsScope,
    version: state.settingsVersion,
  })));
}

export function useApplySettings(): (delta: SettingsWriteDelta) => void {
  const expectedSettingsScope = useAccountSettingsScope();
  return React.useCallback((delta: SettingsWriteDelta) => {
    getSyncSingleton().applySettings(delta, {
      expectedSettingsScope,
      source: 'ui' satisfies SettingsAnalyticsSource,
    });
  }, [expectedSettingsScope]);
}

export function useApplyProfileSave(): (input: Readonly<{
  profiles: Settings['profiles'];
  profileId: string;
  secretBindings?: Readonly<Record<string, string>>;
}>) => void {
  const applySettings = useApplySettings();
  return React.useCallback((input) => {
    const settings = getStorage().getState().settings ?? settingsDefaults;
    const delta: AccountSettingsWriteDelta = input.secretBindings === undefined
      ? { profiles: input.profiles }
      : {
        profiles: input.profiles,
        secretBindingsByProfileId: mergeProfileSecretBindings({
          settings,
          profileId: input.profileId,
          secretBindings: input.secretBindings,
        }),
      };
    applySettings(delta);
  }, [applySettings]);
}

export function useDeleteAiLaunchProfile(): (profileId: string) => Promise<void> {
  const settingsSnapshot = useAccountSettingsMutationSnapshot();
  return React.useCallback(async (profileId: string) => {
    await persistAccountSettingsOnce(settingsSnapshot.scope, requireSettingsVersion(settingsSnapshot.version), (raw) => (
      removeAiLaunchProfileFromAccountSettings(raw, profileId)
    ));
  }, [settingsSnapshot]);
}

/**
 * Merge one profile's edited current bindings back into the retained Protocol
 * carrier. Clearing every entry removes the profile from the current map so
 * the merge drops it, while opaque entries this UI never rendered survive.
 */
function mergeProfileSecretBindings(input: Readonly<{
  settings: Settings;
  profileId: string;
  secretBindings: Readonly<Record<string, string>>;
}>): RetainedSecretBindingsByProfileId {
  const currentBindings = input.settings.currentSecretBindingsByProfileId;
  const nextBindings = { ...currentBindings };
  if (Object.keys(input.secretBindings).length === 0) {
    delete nextBindings[input.profileId];
  } else {
    nextBindings[input.profileId] = { ...input.secretBindings };
  }
  return mergeCurrentSecretBindingsIntoRawBindings({
    rawBindings: readRetainedSecretBindingsByProfileId(input.settings),
    currentBindings,
    nextBindings,
  });
}

/**
 * The public Settings facade deliberately omits the raw Protocol carrier.
 * This is the single persistence-facing writer that can submit it after the
 * current-map editor merged its update with retained opaque entries.
 */
export function useApplyRetainedSecretBindingsByProfileId(): (
  bindings: RetainedSecretBindingsByProfileId,
) => void {
  const applySettings = useApplySettings();
  return React.useCallback((secretBindingsByProfileId: RetainedSecretBindingsByProfileId) => {
    const delta: AccountSettingsWriteDelta = { secretBindingsByProfileId };
    applySettings(delta);
  }, [applySettings]);
}

/**
 * Apply a typed Favorite replacement once against the explicitly observed
 * Account Settings version. The reducer preserves opaque entries in that
 * observed carrier; a concurrent winner is reported rather than replayed.
 */
export function useApplyFavoriteModelSelectionReplacementIntent(): (
  input: Readonly<{
    base: CurrentSessionAuthoringSelectionsRuntimeProjection['currentFavoriteModelSelectionsV1'];
    proposed: CurrentSessionAuthoringSelectionsRuntimeProjection['currentFavoriteModelSelectionsV1'];
  }>,
) => Promise<void> {
  const settingsSnapshot = useAccountSettingsMutationSnapshot();
  return React.useCallback(async (input) => {
    await persistAccountSettingsOnce(settingsSnapshot.scope, requireSettingsVersion(settingsSnapshot.version), (raw) => (
      replayFavoriteModelSelectionReplacementIntent({ raw, ...input })
    ));
  }, [settingsSnapshot]);
}

/**
 * Apply a typed remembered-selection replacement through the same one-shot
 * owner. An opaque scope in the observed carrier remains unowned by this UI.
 */
export function useApplyRememberedEngineSelectionReplacementIntent(): (
  input: Readonly<{
    base: CurrentSessionAuthoringSelectionsRuntimeProjection['currentRememberedEngineSelectionsByScopeV1'];
    proposed: CurrentSessionAuthoringSelectionsRuntimeProjection['currentRememberedEngineSelectionsByScopeV1'];
  }>,
) => Promise<void> {
  const settingsSnapshot = useAccountSettingsMutationSnapshot();
  return React.useCallback(async (input) => {
    await persistAccountSettingsOnce(settingsSnapshot.scope, requireSettingsVersion(settingsSnapshot.version), (raw) => (
      replayRememberedEngineSelectionReplacementIntent({ raw, ...input })
    ));
  }, [settingsSnapshot]);
}

export function useApplyLocalSettings(): (delta: Partial<LocalSettings>) => void {
  return React.useCallback((delta: Partial<LocalSettings>) => {
    applyLocalSettingsFromStore(delta, 'ui');
  }, []);
}
