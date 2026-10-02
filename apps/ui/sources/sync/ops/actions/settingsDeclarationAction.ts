import { z } from 'zod';
import {
    SettingsDeclarationActionInputSchemasV1,
    SettingsDeclarationValueV1Schema,
    ACCOUNT_SETTING_DEFINITIONS,
    type FeatureId,
    type SettingsDeclarationActionIdV1,
    type SettingsDeclarationDescriptorV1,
    type ActionExecutorContext,
} from '@happier-dev/protocol';

import { SETTINGS_PAGE_DECLARATIONS } from '@/components/settings/catalog/settingsPageDeclarations';
import { settingRendersOnHost, type SettingRef, type SettingsHost } from '@/components/settings/catalog/settingDeclarations';
import type { SettingsPageGate } from '@/components/settings/catalog/types';
import { resolveSettingsPageGateUnavailableReason } from '@/components/settings/catalog/settingsPageGateAvailability';
import { t } from '@/text';
import type { Settings, SettingsWriteDelta } from '@/sync/domains/settings/settings';
import type { LocalSettings } from '@/sync/domains/settings/localSettings';
import { LOCAL_SETTING_ARTIFACTS } from '@/sync/domains/settings/registry/local/localSettingDefinitions';

type SettingsDeclarationOwner = Readonly<{
    host: SettingsHost;
    tauriDesktop: boolean;
    readPageGate: (pageId: string) => SettingsPageGate | undefined;
    isFeatureEnabled: (featureId: FeatureId) => Promise<boolean>;
    readAccountSettings: () => Promise<Settings>;
    writeAccountSettings: (delta: SettingsWriteDelta) => Promise<void>;
    readLocalSettings: () => LocalSettings;
    writeLocalSettings: (delta: Partial<LocalSettings>) => void;
}>;

function refuse(errorCode: string) {
    return { ok: false as const, errorCode, error: errorCode };
}

/** Storage readers recover malformed persisted values. Action writes must reject them, never save a fallback. */
function writeSchema(schema: z.core.$ZodType): z.core.$ZodType {
    return schema instanceof z.ZodCatch ? writeSchema(schema.removeCatch()) : schema;
}

/** U4 declarations own discovery; the existing Account/local writers own every mutation. */
export function createSettingsDeclarationAction(owner: SettingsDeclarationOwner) {
    async function descriptor(pageId: string, ref: SettingRef): Promise<SettingsDeclarationDescriptorV1> {
        const sensitive = ref.sensitive === true || ref.storage?.access === 'sensitive';
        const pageGate = owner.readPageGate(pageId);
        const pageUnavailableReason = pageGate ? resolveSettingsPageGateUnavailableReason(pageGate, {
            useProfiles: pageGate.requiresProfiles ? (await owner.readAccountSettings()).useProfiles : false,
            devModeEnabled: pageGate.requiresDevMode ? owner.readLocalSettings().devModeEnabled : false,
            tauriDesktop: owner.tauriDesktop,
            features: pageGate.featureId ? { [pageGate.featureId]: await owner.isFeatureEnabled(pageGate.featureId) } : {},
        }) : undefined;
        const unavailableReason = !settingRendersOnHost(ref, owner.host) ? 'unsupported_host'
            : pageUnavailableReason ? pageUnavailableReason
            : ref.featureId && !await owner.isFeatureEnabled(ref.featureId) ? 'feature_disabled'
            : sensitive ? 'sensitive'
            : !ref.storage ? 'not_bound'
            : ref.storage.access === 'read_only' ? 'read_only'
            : undefined;
        const readable = unavailableReason === undefined || unavailableReason === 'read_only';
        return {
            anchor: ref.anchor,
            pageId,
            title: String(t(ref.titleKey)),
            ...(ref.descriptionKey ? { description: String(t(ref.descriptionKey)) } : {}),
            sensitive,
            readable,
            writable: unavailableReason === undefined,
            ...(ref.storage ? { storageScope: ref.storage.scope } : {}),
            ...(readable && ref.storage?.allowedValues ? { allowedValues: [...ref.storage.allowedValues] } : {}),
            ...(unavailableReason ? { unavailableReason } : {}),
        };
    }

    return async ({ actionId, input, context }: Readonly<{ actionId: SettingsDeclarationActionIdV1; input: unknown; context?: ActionExecutorContext }>) => {
        context?.signal?.throwIfAborted();
        if (actionId === 'settings.list') {
            const parsed = SettingsDeclarationActionInputSchemasV1[actionId].parse(input);
            const items = await Promise.all(SETTINGS_PAGE_DECLARATIONS
                .filter((page) => !parsed.pageId || page.pageId === parsed.pageId)
                .flatMap((page) => Object.values(page.settings).map((ref) => descriptor(page.pageId, ref))));
            return { items };
        }
        const parsed = SettingsDeclarationActionInputSchemasV1[actionId].parse(input);
        const page = SETTINGS_PAGE_DECLARATIONS.find((candidate) => Object.values(candidate.settings).some((ref) => ref.anchor === parsed.anchor));
        const ref = page && Object.values(page.settings).find((candidate) => candidate.anchor === parsed.anchor);
        if (!page || !ref) return refuse('setting_not_found');
        const access = await descriptor(page.pageId, ref);
        context?.signal?.throwIfAborted();
        if (!access.readable || !ref.storage) return refuse(`setting_${access.unavailableReason ?? 'not_bound'}`);
        const binding = ref.storage;
        if (actionId === 'settings.set') {
            if (!access.writable) return refuse('setting_read_only');
            const requested = SettingsDeclarationActionInputSchemasV1['settings.set'].parse(input);
            if (binding.allowedValues && !binding.allowedValues.includes(requested.value)) return refuse('invalid_setting_value');
            if (binding.invertBoolean && typeof requested.value !== 'boolean') return refuse('invalid_setting_value');
            const storedValue = binding.invertBoolean ? !requested.value : requested.value;
            const value = binding.scope === 'account'
                ? ACCOUNT_SETTING_DEFINITIONS[binding.key].parseMutationValue(storedValue)
                : z.safeParse(writeSchema(LOCAL_SETTING_ARTIFACTS.shape[binding.key]), storedValue);
            if (!value.success) return refuse('invalid_setting_value');
            const scalarValue = SettingsDeclarationValueV1Schema.parse(value.data);
            if (binding.scope === 'account') {
                // The key and scalar value were admitted by the typed declaration and its exact canonical schema.
                await owner.writeAccountSettings({ [binding.key]: scalarValue } as SettingsWriteDelta);
            } else {
                owner.writeLocalSettings({ [binding.key]: scalarValue } as Partial<LocalSettings>);
            }
            return { anchor: ref.anchor, value: binding.invertBoolean ? !scalarValue : scalarValue };
        }
        const current = binding.scope === 'account'
            ? (await owner.readAccountSettings())[binding.key]
            : owner.readLocalSettings()[binding.key];
        if (current === undefined) return { anchor: ref.anchor, unset: true as const };
        const value = SettingsDeclarationValueV1Schema.safeParse(binding.invertBoolean ? !current : current);
        return value.success ? { anchor: ref.anchor, value: value.data } : refuse('setting_value_unavailable');
    };
}
