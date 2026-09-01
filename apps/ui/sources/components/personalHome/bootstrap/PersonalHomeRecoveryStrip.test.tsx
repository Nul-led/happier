import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import { PersonalHomeRecoveryStrip } from './PersonalHomeRecoveryStrip';

describe('PersonalHomeRecoveryStrip', () => {
    it('discloses sanitized controller detail without an active task or external callback', async () => {
        const screen = await renderScreen(
            <PersonalHomeRecoveryStrip
                kind="computer"
                onRetry={() => {}}
                detail={{
                    code: 'daemon_setup_failed',
                    message: 'token=should-not-render seed=abcdef0123456789abcdef0123456789',
                    retryable: true,
                }}
            />,
        );

        expect(screen.findByTestId('personal-home-recovery-details')).not.toBeNull();
        await screen.pressByTestIdAsync('personal-home-recovery-details');
        expect(screen.findByTestId('personal-home-recovery-details-panel')).not.toBeNull();
        expect(screen.findAllHostsByTestId('personal-home-diagnostic-code')).toHaveLength(1);
        expect(screen.root.findAll((node) => typeof node.props.children === 'string' && node.props.children.includes('should-not-render'))).toHaveLength(0);
        expect(screen.root.findAll((node) => typeof node.props.children === 'string' && node.props.children.includes('abcdef0123456789abcdef0123456789'))).toHaveLength(0);
    });
});
