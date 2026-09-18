import { describe, expect, it } from 'vitest';

import { localSettingsParse } from '../../localSettings';
import { LOCAL_SETTING_ARTIFACTS } from './localSettingDefinitions';

describe('viewer-local executable UI surface approvals', () => {
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
