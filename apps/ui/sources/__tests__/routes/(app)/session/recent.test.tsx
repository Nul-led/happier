import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LegacyRecentSessionsRoute from '../../../../app/(app)/session/recent';
import { useSessionListLayoutChoice } from '@/hooks/session/sessionListLayoutIntent';

const { applySettings, replace, observedLayoutChoices } = vi.hoisted(() => ({
    applySettings: vi.fn(),
    replace: vi.fn(),
    observedLayoutChoices: [] as string[],
}));

vi.mock('expo-router', () => ({
    useRouter: () => ({ replace }),
}));

vi.mock('@react-navigation/native', () => ({
    useIsFocused: () => true,
}));

vi.mock('react-native', () => ({
    View: 'View',
}));

vi.mock('react-native-unistyles', () => ({
    StyleSheet: { create: (factory: () => unknown) => (typeof factory === 'function' ? factory() : factory) },
}));

vi.mock('@/sync/domains/state/storage', () => ({
    useSetting: (key: string) => {
        // The Account's saved layout is Projects; the deep link must not change it.
        if (key === 'sessionListSectionModeV1') return 'single';
        if (key === 'sessionListActiveGroupingV1') return 'project';
        return undefined;
    },
}));

vi.mock('@/sync/store/settingsWriters', () => ({
    useApplySettings: () => applySettings,
}));

vi.mock('@/components/sessions/shell/SessionsList', () => ({
    SessionsList: function SessionsListProbe() {
        observedLayoutChoices.push(useSessionListLayoutChoice());
        return null;
    },
}));

describe('legacy Recent Sessions route', () => {
    beforeEach(() => {
        applySettings.mockClear();
        replace.mockClear();
        observedLayoutChoices.length = 0;
    });

    it('hosts the canonical list in Recent activity without writing the Account preference', () => {
        act(() => {
            create(<LegacyRecentSessionsRoute />);
        });

        expect(observedLayoutChoices).toEqual(['recent_activity']);
        expect(applySettings).not.toHaveBeenCalled();
        expect(replace).not.toHaveBeenCalled();
    });

    it('leaves the stored layout authoritative outside the hosted route', () => {
        let outsideChoice: string | null = null;
        function OutsideProbe() {
            outsideChoice = useSessionListLayoutChoice();
            return null;
        }

        act(() => {
            create(<OutsideProbe />);
        });

        expect(outsideChoice).toBe('projects');
    });
});
