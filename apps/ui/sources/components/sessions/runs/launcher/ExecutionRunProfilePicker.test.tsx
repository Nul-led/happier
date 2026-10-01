import React from 'react';
import { Platform } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { flattenTestStyle, renderScreen, standardCleanup } from '@/dev/testkit';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { ExecutionRunProfilePicker } from './ExecutionRunProfilePicker';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/components/ui/text/Text', async () => {
    const ReactModule = await import('react');
    return { Text: (props: any) => ReactModule.createElement('Text', props, props.children) };
});

describe('ExecutionRunProfilePicker', () => {
    it('exposes selected and unavailable profiles through accessibility state', async () => {
        const screen = await renderScreen(<ExecutionRunProfilePicker
            choices={[
                { id: 'review.coderabbit/review', intent: 'review', title: 'CodeRabbit', compatibleAgentIds: ['coderabbit'], compatibleAgentId: 'coderabbit', sourceCustody: { kind: 'managed', immutableGenerationId: 'g1', installSource: 'archive' }, available: true, disabled: false, defaults: { retention: 'resumable', runClass: 'bounded', io: 'streaming' } },
                { id: 'review.deepsec/audit', intent: 'review', title: 'DeepSec Audit', compatibleAgentIds: ['deepsec'], compatibleAgentId: null, sourceCustody: { kind: 'managed', immutableGenerationId: 'g1', installSource: 'archive' }, available: false, unavailableCode: 'missing_tool', disabled: true, defaults: { retention: 'resumable', runClass: 'bounded', io: 'streaming' } },
            ]}
            selectedId="review.coderabbit/review"
            sectionLabel="Profiles"
            resolveAccessibilityLabel={(title) => `Select profile ${title}`}
            onSelect={vi.fn()}
        />);

        expect(screen.findByTestId('execution-run-launcher-profile:review.coderabbit/review')?.props.accessibilityState)
            .toEqual({ selected: true, disabled: false });
        expect(screen.findByTestId('execution-run-launcher-profile:review.deepsec/audit')?.props.accessibilityState)
            .toEqual({ selected: false, disabled: true });
        standardCleanup();
    });

    it('meets the shared platform interactive target for every profile choice', async () => {
        const originalPlatform = Platform.OS;

        try {
            for (const platform of ['android', 'ios', 'web'] as const) {
                Object.defineProperty(Platform, 'OS', { configurable: true, value: platform });
                const screen = await renderScreen(<ExecutionRunProfilePicker
                    choices={[
                        { id: 'review.coderabbit/review', intent: 'review', title: 'CodeRabbit', compatibleAgentIds: ['coderabbit'], compatibleAgentId: 'coderabbit', sourceCustody: { kind: 'managed', immutableGenerationId: 'g1', installSource: 'archive' }, available: true, disabled: false, defaults: { retention: 'resumable', runClass: 'bounded', io: 'streaming' } },
                    ]}
                    selectedId="review.coderabbit/review"
                    sectionLabel="Profiles"
                    resolveAccessibilityLabel={(title) => `Select profile ${title}`}
                    onSelect={vi.fn()}
                />);
                const targetSize = resolveMinimumInteractiveTargetSize(platform);

                const style = flattenTestStyle(
                    screen.findByTestId('execution-run-launcher-profile:review.coderabbit/review')?.props.style,
                );
                expect(style.minWidth).toBe(targetSize);
                expect(style.minHeight).toBe(targetSize);

                await screen.unmount();
            }
        } finally {
            Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
        }
        standardCleanup();
    });
});
