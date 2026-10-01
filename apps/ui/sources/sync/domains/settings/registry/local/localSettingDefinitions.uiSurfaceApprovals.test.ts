import { describe, expect, it } from 'vitest';
import {
    buildUiSurfaceExecutableApprovalKeyStringV1,
    createUiSurfaceRequestedCapabilitiesDigestV1,
    normalizeUiSurfaceCapabilityRequestV1,
} from '@happier-dev/protocol/plugins/ui';

import { localSettingsParse } from '../../localSettings';
import { LOCAL_SETTING_ARTIFACTS } from './localSettingDefinitions';

describe('viewer-local executable UI surface approvals', () => {
    it('round-trips the reviewed scope and capabilities in the existing map and refuses malformed or mismatched approval records', () => {
        const capabilities = normalizeUiSurfaceCapabilityRequestV1({ hostMethods: ['context', 'watchContext'] })!;
        const approval = {
            serverIdentityId: 'home-a', accountId: 'account-a', approvalSubject: 'item-a',
            executableSecurityFingerprint: 'fingerprint-a',
            requestedCapabilitiesDigest: createUiSurfaceRequestedCapabilitiesDigestV1(capabilities),
        };
        const key = buildUiSurfaceExecutableApprovalKeyStringV1(approval);
        const entry = { approval, capabilities };
        const saved = { [key]: entry, 'legacy-exact-key': true };
        expect(localSettingsParse({ uiSurfaceExecutableApprovalsV1: saved }).uiSurfaceExecutableApprovalsV1).toEqual(saved);
        for (const invalid of [
            { ...entry, unexpectedAuthority: true },
            { approval: { ...approval, requestedCapabilitiesDigest: 'different' }, capabilities },
            { approval, capabilities: { ...capabilities, hostMethods: ['context', 'notify'] } },
            { approval, capabilities: { ...capabilities, unknownCapability: true } },
        ]) expect(localSettingsParse({ uiSurfaceExecutableApprovalsV1: { [key]: invalid } }).uiSurfaceExecutableApprovalsV1).toEqual({});
        expect(localSettingsParse({ uiSurfaceExecutableApprovalsV1: { wrongKey: entry } }).uiSurfaceExecutableApprovalsV1).toEqual({});
    });

    it('uses the device-local owner and retains only exact canonical approval keys allowed by the viewer', () => {
        expect(LOCAL_SETTING_ARTIFACTS.definitions).toHaveProperty('uiSurfaceExecutableApprovalsV1');
        expect(localSettingsParse({
            uiSurfaceExecutableApprovalsV1: {
                'happier:ui-surface:executable-approval-key:v1:one': true,
                denied: false,
            },
        }).uiSurfaceExecutableApprovalsV1).toEqual({});
        expect(localSettingsParse({
            uiSurfaceExecutableApprovalsV1: {
                'happier:ui-surface:executable-approval-key:v1:one': true,
            },
        }).uiSurfaceExecutableApprovalsV1).toEqual({
            'happier:ui-surface:executable-approval-key:v1:one': true,
        });
    });
});
