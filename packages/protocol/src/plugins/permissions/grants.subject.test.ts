import { describe, expect, it } from 'vitest';

import {
  CredentialAccessDeclarationDigestSchema,
  CredentialAccessSelectedAuthorityDigestSchema,
  CredentialAccessSelectedRawAccessDigestSchema,
  GENERAL_PLUGIN_PERMISSION_SUBJECT_V1,
  PluginCredentialAccessSlotIdSchema,
  PluginPermissionGrantRequestActionInputV1Schema,
  PluginPermissionGrantV1Schema,
  PluginPermissionSubjectV1Schema,
  pluginPermissionSubjectsEqualV1,
  type PluginPermissionSubjectV1,
} from '../../index.js';

const digest = 'a'.repeat(64);

const credentialSubject = {
  kind: 'credential_access_disclosure',
  contribution: {
    pluginId: 'happier.voice.openai',
    localId: 'openai-realtime',
  },
  credentialSlotId: 'api-key.primary',
  purpose: 'voice-session',
  accessDeclarationDigest: digest,
  selectedAuthorityDigest: 'c'.repeat(64),
  selectedRawAccessDigest: 'd'.repeat(64),
} as const;

describe('plugin permission grant subjects', () => {
  it('compares the complete strict subject identity without depending on property order', () => {
    const left = PluginPermissionSubjectV1Schema.parse(credentialSubject);
    const reordered: PluginPermissionSubjectV1 = {
      selectedRawAccessDigest: left.selectedRawAccessDigest,
      selectedAuthorityDigest: left.selectedAuthorityDigest,
      accessDeclarationDigest: left.accessDeclarationDigest,
      purpose: left.purpose,
      credentialSlotId: left.credentialSlotId,
      contribution: {
        localId: left.contribution.localId,
        pluginId: left.contribution.pluginId,
      },
      kind: left.kind,
    };

    expect(JSON.stringify(left)).not.toBe(JSON.stringify(reordered));
    expect(pluginPermissionSubjectsEqualV1(left, reordered)).toBe(true);
    expect(pluginPermissionSubjectsEqualV1(
      GENERAL_PLUGIN_PERMISSION_SUBJECT_V1,
      { kind: 'general' },
    )).toBe(true);
    expect(pluginPermissionSubjectsEqualV1(left, GENERAL_PLUGIN_PERMISSION_SUBJECT_V1)).toBe(false);

    const distinctSubjects: PluginPermissionSubjectV1[] = [
      { ...left, contribution: { ...left.contribution, pluginId: 'other.plugin' } },
      { ...left, contribution: { ...left.contribution, localId: 'other-contribution' } },
      { ...left, credentialSlotId: PluginCredentialAccessSlotIdSchema.parse('api-key.secondary') },
      { ...left, purpose: 'other-purpose' },
      { ...left, accessDeclarationDigest: CredentialAccessDeclarationDigestSchema.parse('e'.repeat(64)) },
      {
        ...left,
        selectedAuthorityDigest: CredentialAccessSelectedAuthorityDigestSchema.parse('f'.repeat(64)),
      },
      {
        ...left,
        selectedRawAccessDigest: CredentialAccessSelectedRawAccessDigestSchema.parse('1'.repeat(64)),
      },
    ];
    for (const distinct of distinctSubjects) {
      expect(pluginPermissionSubjectsEqualV1(left, distinct)).toBe(false);
    }
  });

  it('accepts only strict general and credential-access subjects', () => {
    expect(PluginPermissionSubjectV1Schema.parse(GENERAL_PLUGIN_PERMISSION_SUBJECT_V1))
      .toEqual({ kind: 'general' });
    expect(PluginPermissionSubjectV1Schema.parse(credentialSubject)).toEqual(credentialSubject);
    expect(PluginPermissionSubjectV1Schema.safeParse({
      ...credentialSubject,
      installedGenerationId: 'generation-1',
    }).success).toBe(false);
    expect(PluginPermissionSubjectV1Schema.safeParse({
      ...credentialSubject,
      installReviewPrincipalDigest: 'b'.repeat(64),
    }).success).toBe(false);
    expect(PluginPermissionSubjectV1Schema.safeParse({ kind: 'general', credentialSlotId: 'extra' }).success)
      .toBe(false);
  });

  it('uses canonical bounded record keys and lowercase sha256 digests', () => {
    expect(PluginCredentialAccessSlotIdSchema.parse('api-key.primary')).toBe('api-key.primary');
    for (const invalid of [' api-key', 'api key', '__proto__', 'constructor', 'A'.repeat(129)]) {
      expect(PluginCredentialAccessSlotIdSchema.safeParse(invalid).success).toBe(false);
    }
    expect(CredentialAccessDeclarationDigestSchema.parse(digest)).toBe(digest);
    expect(CredentialAccessDeclarationDigestSchema.safeParse('A'.repeat(64)).success).toBe(false);
  });

  it('requires a subject on grant records and grant requests', () => {
    const grant = {
      v: 1,
      id: 'grant-1',
      accountId: 'account-1',
      pluginId: 'happier.voice.openai',
      capability: 'credentials.materialize.raw',
      targetScope: { kind: 'account' },
      authoritySource: { kind: 'bundled' },
      status: 'active',
      grantedByUserId: 'user-1',
      grantedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    expect(PluginPermissionGrantV1Schema.safeParse(grant).success).toBe(false);
    expect(PluginPermissionGrantV1Schema.parse({ ...grant, subject: credentialSubject }).subject)
      .toEqual(credentialSubject);

    const request = {
      pluginId: grant.pluginId,
      capability: grant.capability,
      targetScope: grant.targetScope,
      requester: { kind: 'plugin', pluginId: grant.pluginId },
      reason: 'Use the selected credential for this contribution.',
    };
    expect(PluginPermissionGrantRequestActionInputV1Schema.safeParse(request).success).toBe(false);
    expect(PluginPermissionGrantRequestActionInputV1Schema.parse({
      ...request,
      subject: credentialSubject,
    }).subject).toEqual(credentialSubject);
  });
});
