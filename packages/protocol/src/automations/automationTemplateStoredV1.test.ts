import { describe, expect, it } from 'vitest';
import { openAutomationTemplateStoredV1 } from './automationTemplateStoredV1.js';
import { AUTOMATION_TEMPLATE_V02_PLAIN, AUTOMATION_TEMPLATE_V02_ENCRYPTED,
  AUTOMATION_TEMPLATE_V02_EXISTING_PLAIN, AUTOMATION_TEMPLATE_V02_EXISTING_ENCRYPTED,
  AUTOMATION_TEMPLATE_V02_RAW_ENCRYPTED, AUTOMATION_TEMPLATE_V02_EXISTING_RAW_ENCRYPTED } from './automationTemplateV02.testFixtures.js';

const material = { type: 'legacy' as const, secret: new Uint8Array(32).fill(7) };
describe('the Protocol-owned 0.2 stored template codec', () => {
  it.each([AUTOMATION_TEMPLATE_V02_PLAIN, AUTOMATION_TEMPLATE_V02_EXISTING_PLAIN])('reads the exact plain predecessor writer', (templateCiphertext) => {
    expect(openAutomationTemplateStoredV1({ templateCiphertext, accountMode: 'plain' }))
      .toMatchObject({ ok: true, template: { directory: '/repo', agent: 'claude', prompt: 'Review the release' } });
  });
  it.each([AUTOMATION_TEMPLATE_V02_ENCRYPTED, AUTOMATION_TEMPLATE_V02_EXISTING_ENCRYPTED,
    AUTOMATION_TEMPLATE_V02_RAW_ENCRYPTED, AUTOMATION_TEMPLATE_V02_EXISTING_RAW_ENCRYPTED])('reads the exact scoped and raw encrypted predecessor writers', (templateCiphertext) => {
    expect(openAutomationTemplateStoredV1({ templateCiphertext, accountMode: 'e2ee', material }))
      .toMatchObject({ ok: true, template: { directory: '/repo', prompt: 'Review the release' } });
  });
  it('does not reinterpret unavailable or wrong E2EE material as plain', () => {
    expect(openAutomationTemplateStoredV1({ templateCiphertext: AUTOMATION_TEMPLATE_V02_ENCRYPTED, accountMode: 'e2ee' }))
      .toEqual({ ok: false, code: 'encryption_material_unavailable' });
    expect(openAutomationTemplateStoredV1({ templateCiphertext: AUTOMATION_TEMPLATE_V02_ENCRYPTED, accountMode: 'e2ee',
      material: { type: 'legacy', secret: new Uint8Array(32).fill(8) } })).toEqual({ ok: false, code: 'invalid_template' });
  });
  it.each([AUTOMATION_TEMPLATE_V02_EXISTING_PLAIN, AUTOMATION_TEMPLATE_V02_EXISTING_ENCRYPTED,
    AUTOMATION_TEMPLATE_V02_EXISTING_RAW_ENCRYPTED])('rejects a substituted predecessor outer Session id', (bytes) => {
    const envelope = JSON.parse(bytes);
    envelope.existingSessionId = 'another-session';
    expect(openAutomationTemplateStoredV1({ templateCiphertext: JSON.stringify(envelope),
      accountMode: bytes === AUTOMATION_TEMPLATE_V02_EXISTING_PLAIN ? 'plain' : 'e2ee', material }))
      .toEqual({ ok: false, code: 'invalid_template' });
  });
});
