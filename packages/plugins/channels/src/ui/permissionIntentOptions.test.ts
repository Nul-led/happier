import { AgentPermissionIntentV1Schema } from '@happier-dev/plugin-sdk/sessions';
import { describe, expect, it } from 'vitest';

import {
  bindingPermissionIntentLabel,
  bindingPermissionIntentOptions,
  parseBindingPermissionIntent,
} from './permissionIntentOptions.js';
import { CHANNELS_UI_TRANSLATIONS } from './translations.js';

/**
 * The canonical intent vocabulary, read from the same Protocol schema the
 * surface parses with. Restating it here would make the exhaustiveness check
 * incapable of failing: a new Protocol intent would stay silently unofferable.
 */
const canonicalPermissionIntents = (AgentPermissionIntentV1Schema.jsonSchema.anyOf ?? [])
  .map((member) => member.const);

describe('Channels permission-intent presentation', () => {
  it('offers every canonical permission intent through one localized mapping', () => {
    const t = (key: string, fallback: string) => `${key}:${fallback}`;
    const options = bindingPermissionIntentOptions(t);

    expect([...options.map(({ value }) => value)].sort())
      .toEqual([...canonicalPermissionIntents].sort());
    for (const option of options) {
      expect(bindingPermissionIntentLabel(option.value, t)).toBe(option.label);
    }
  });

  it('presents the intents in the authored order', () => {
    const t = (key: string, fallback: string) => `${key}:${fallback}`;

    expect(bindingPermissionIntentOptions(t).map(({ value }) => value)).toEqual([
      'default',
      'read-only',
      'safe-yolo',
      'yolo',
      'plan',
    ]);
  });

  it('keeps English and German outcome labels attached to their matching locales', () => {
    const translate = (locale: 'en' | 'de') => (key: string, fallback: string) =>
      CHANNELS_UI_TRANSLATIONS[locale][key as keyof typeof CHANNELS_UI_TRANSLATIONS.en] ?? fallback;

    expect({
      en: {
        safeYolo: bindingPermissionIntentLabel('safe-yolo', translate('en')),
        yolo: bindingPermissionIntentLabel('yolo', translate('en')),
        plan: bindingPermissionIntentLabel('plan', translate('en')),
      },
      de: {
        safeYolo: bindingPermissionIntentLabel('safe-yolo', translate('de')),
        yolo: bindingPermissionIntentLabel('yolo', translate('de')),
        plan: bindingPermissionIntentLabel('plan', translate('de')),
      },
    }).toEqual({
      en: {
        safeYolo: 'Auto-accept safe edits',
        yolo: 'Skip approval prompts',
        plan: 'Plan mode',
      },
      de: {
        safeYolo: 'Sichere Änderungen automatisch erlauben',
        yolo: 'Ohne Genehmigungen arbeiten',
        plan: 'Planungsmodus',
      },
    });
  });

  it('never presents the internal permission vocabulary as an outcome', () => {
    // "Yolo" is an internal Agent permission-intent name. A person choosing a
    // ceiling for an external conversation must read what will happen, not the
    // vocabulary of the execution backend.
    const translate = (key: string, fallback: string) =>
      CHANNELS_UI_TRANSLATIONS.en[key as keyof typeof CHANNELS_UI_TRANSLATIONS.en] ?? fallback;

    for (const option of bindingPermissionIntentOptions(translate)) {
      expect(option.label.toLowerCase()).not.toContain('yolo');
    }
  });

  it('rejects an unknown permission intent instead of presenting a different intent', () => {
    expect(parseBindingPermissionIntent('future-intent')).toBeNull();
  });
});
