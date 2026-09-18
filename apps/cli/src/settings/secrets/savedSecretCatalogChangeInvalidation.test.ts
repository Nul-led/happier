import { describe, expect, it } from 'vitest';

import { changesRequireSavedSecretCatalogRefresh } from './savedSecretCatalogChangeInvalidation';

describe('changesRequireSavedSecretCatalogRefresh', () => {
  it.each([
    [{ kind: 'savedSecretResource', entityId: 'resource-a' }],
    [{ kind: 'account', entityId: 'teams' }],
    [{ kind: 'account', entityId: 'self', hint: { accountEncryptionTransitionId: 'transition-a' } }],
  ])('refreshes for material or Team/Group authorization changes', (change) => {
    expect(changesRequireSavedSecretCatalogRefresh([change])).toBe(true);
  });

  it('does not turn an unrelated live change into a material refresh', () => {
    expect(changesRequireSavedSecretCatalogRefresh([
      { kind: 'machine', entityId: 'machine-a' },
    ])).toBe(false);
    expect(changesRequireSavedSecretCatalogRefresh([
      { kind: 'account', entityId: 'self', hint: { settingsVersion: 8 } },
    ])).toBe(false);
  });
});
