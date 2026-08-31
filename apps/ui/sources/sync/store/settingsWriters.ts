import React from 'react';

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

function requireCurrentSettingsVersion(): number {
  const settingsVersion = getStorage().getState().settingsVersion;
  if (settingsVersion === null) throw new Error('Account settings version is unavailable');
  return settingsVersion;
}

async function persistAccountSettingsOnce(
  expectedSettingsVersion: number,
  mutate: (raw: Readonly<Record<string, unknown>>) => Record<string, unknown>,
): Promise<void> {
  requireOneShotAccountSettingsMutationApplied(
    await getSyncSingleton().mutateAccountSettingsOnce({
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

export function useApplySettings(): (delta: SettingsWriteDelta) => void {
  return React.useCallback((delta: SettingsWriteDelta) => {
    getSyncSingleton().applySettings(delta, { source: 'ui' satisfies SettingsAnalyticsSource });
  }, []);
}

export function useApplyProfileSave(): (input: Readonly<{
  profiles: Settings['profiles'];
  profileId: string;
  secretBindings?: Readonly<Record<string, string>>;
}>) => void {
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
    getSyncSingleton().applySettings(delta, { source: 'ui' satisfies SettingsAnalyticsSource });
  }, []);
}

export function useDeleteAiLaunchProfile(): (profileId: string) => Promise<void> {
  return React.useCallback(async (profileId: string) => {
    await persistAccountSettingsOnce(requireCurrentSettingsVersion(), (raw) => (
      removeAiLaunchProfileFromAccountSettings(raw, profileId)
    ));
  }, []);
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
  return React.useCallback((secretBindingsByProfileId: RetainedSecretBindingsByProfileId) => {
    const delta: AccountSettingsWriteDelta = { secretBindingsByProfileId };
    getSyncSingleton().applySettings(
      delta,
      { source: 'ui' satisfies SettingsAnalyticsSource },
    );
  }, []);
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
  return React.useCallback(async (input) => {
    await persistAccountSettingsOnce(requireCurrentSettingsVersion(), (raw) => (
      replayFavoriteModelSelectionReplacementIntent({ raw, ...input })
    ));
  }, []);
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
  return React.useCallback(async (input) => {
    await persistAccountSettingsOnce(requireCurrentSettingsVersion(), (raw) => (
      replayRememberedEngineSelectionReplacementIntent({ raw, ...input })
    ));
  }, []);
}

export function useApplyLocalSettings(): (delta: Partial<LocalSettings>) => void {
  return React.useCallback((delta: Partial<LocalSettings>) => {
    applyLocalSettingsFromStore(delta, 'ui');
  }, []);
}
