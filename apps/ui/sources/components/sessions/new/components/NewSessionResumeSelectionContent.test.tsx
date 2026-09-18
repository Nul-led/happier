import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPassThroughComponent, createPassThroughModule } from '@/dev/testkit/mocks/components';
import { createTextModuleMock } from '@/dev/testkit/mocks/text';
import { createUnistylesMock } from '@/dev/testkit/mocks/unistyles';
import { renderScreen } from '@/dev/testkit';
import { installNewSessionComponentsCommonModuleMocks } from './newSessionComponentsTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockState = vi.hoisted(() => ({
    platformOS: 'ios' as 'ios' | 'web',
    focusSpy: vi.fn(),
}));

installNewSessionComponentsCommonModuleMocks({
    icons: () => ({
        Ionicons: createPassThroughComponent('Ionicons'),
    }),
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: createPassThroughComponent('View'),
            Pressable: createPassThroughComponent('Pressable'),
            Platform: {
                get OS() {
                    return mockState.platformOS;
                },
                select: <T,>(values: { ios?: T; web?: T; default?: T }) =>
                    values[mockState.platformOS] ?? values.default,
            },
            InteractionManager: {
                runAfterInteractions: (cb: () => void) => {
                    cb();
                    return { cancel: () => undefined };
                },
            },
        });
    },
    text: () => createTextModuleMock({
        translate: (key, params) => {
            if (params && typeof params === 'object' && 'agent' in params) {
                return `${key}:${String((params as { agent?: unknown }).agent ?? '')}`;
            }
            return key;
        },
    }),
    unistyles: async () => await createUnistylesMock({
        theme: {
            colors: {
                groupped: { background: '#f5f5f5' },
                surface: '#fff',
                divider: '#ddd',
                text: '#111',
                textSecondary: '#666',
                textDestructive: '#d00',
                input: {
                    background: '#fafafa',
                    text: '#111',
                    placeholder: '#999',
                },
                button: {
                    primary: {
                        background: '#00f',
                        tint: '#fff',
                    },
                },
            },
        },
    }),
});

vi.mock('@react-navigation/native', () => ({
    useIsFocused: () => true,
    useFocusEffect: () => undefined,
}));

vi.mock('@/components/ui/lists/ItemGroup', () => createPassThroughModule(['ItemGroup']));
vi.mock('@/components/ui/lists/ItemList', () => createPassThroughModule(['ItemList']));
vi.mock('@/components/ui/text/Text', () => ({
    Text: createPassThroughComponent('Text'),
    TextInput: React.forwardRef((props: Record<string, unknown>, ref) => {
        React.useImperativeHandle(ref, () => ({
            focus: mockState.focusSpy,
        }));
        return React.createElement('TextInput', props, null);
    }),
}));

// `@/dev/testkit` pulls the real agent-catalog projection, which also reads
// `AGENT_IDS` from this module. The stub stays a stub (importing the real
// catalog would drag the whole bundled-agent fact graph into this component
// suite) and just declares that export.
vi.mock('@/agents/catalog/catalog', () => ({
    AGENT_IDS: ['claude', 'codex'],
    DEFAULT_AGENT_ID: 'claude',
    getAgentCore: (agentId: string) => ({
        displayNameKey: `agents.${agentId}.displayName`,
    }),
    isBundledAgentId: (value: unknown): value is string => typeof value === 'string' && value !== 'not-a-real-agent',
}));

const clipboardMockState = vi.hoisted(() => ({
    value: 'resume-id' as string | null,
}));

vi.mock('@/utils/ui/clipboard', () => ({
    getClipboardStringSafe: vi.fn(async () => clipboardMockState.value),
    getClipboardStringTrimmedSafe: vi.fn(async () => clipboardMockState.value?.trim() ?? ''),
}));

describe('NewSessionResumeSelectionContent', () => {
    beforeEach(() => {
        mockState.platformOS = 'ios';
        mockState.focusSpy.mockClear();
        clipboardMockState.value = 'resume-id';
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('does not auto-focus the resume id input on native', async () => {
        const { NewSessionResumeSelectionContent } = await import('./NewSessionResumeSelectionContent');

        const screen = await renderScreen(<NewSessionResumeSelectionContent
                    value=""
                    onChangeValue={() => {}}
                    onSave={() => {}}
                    onClear={() => {}}
                    onClose={() => {}}
                    agentType="claude"
                />);

        const input = screen.findByTestId('resume-id-input');
        expect(input).toBeTruthy();
        if (!input) {
            throw new Error('expected resume-id-input');
        }

        expect(input.props?.autoFocus).not.toBe(true);
        expect(mockState.focusSpy).not.toHaveBeenCalled();
    });

    it('does not auto-focus the resume id input on web when opened from the popover', async () => {
        mockState.platformOS = 'web';

        const { NewSessionResumeSelectionContent } = await import('./NewSessionResumeSelectionContent');

        const screen = await renderScreen(<NewSessionResumeSelectionContent
                    value=""
                    onChangeValue={() => {}}
                    onSave={() => {}}
                    onClear={() => {}}
                    onClose={() => {}}
                    agentType="claude"
                />);

        const input = screen.findByTestId('resume-id-input');
        expect(input).toBeTruthy();
        if (!input) {
            throw new Error('expected resume-id-input');
        }

        expect(input.props?.autoFocus).not.toBe(true);
        expect(mockState.focusSpy).not.toHaveBeenCalled();
    });

    it('does not schedule delayed focus retries on web when opened', async () => {
        mockState.platformOS = 'web';

        const { NewSessionResumeSelectionContent } = await import('./NewSessionResumeSelectionContent');

        await renderScreen(<NewSessionResumeSelectionContent
                    value=""
                    onChangeValue={() => {}}
                    onSave={() => {}}
                    onClear={() => {}}
                    onClose={() => {}}
                    agentType="claude"
                />);

        await vi.runAllTimersAsync();

        expect(mockState.focusSpy).not.toHaveBeenCalled();
    });

    it('does not render inline modal-style header chrome inside the popover content', async () => {
        const { NewSessionResumeSelectionContent } = await import('./NewSessionResumeSelectionContent');

        const screen = await renderScreen(<NewSessionResumeSelectionContent
                    value=""
                    onChangeValue={() => {}}
                    onSave={() => {}}
                    onClear={() => {}}
                    onClose={() => {}}
                    agentType="claude"
                    maxHeight={460}
                    showInlineHeader={true}
                />);

        const textContent = screen.getTextContent();

        expect(screen.findAllByProps({ accessibilityLabel: 'common.close' })).toHaveLength(0);
        expect(textContent).not.toContain('newSession.resume.pickerTitle');
        expect(textContent).not.toContain('newSession.resume.subtitle');
    });

    it('caps popover height', async () => {
        const { NewSessionResumeSelectionContent } = await import('./NewSessionResumeSelectionContent');

        const screen = await renderScreen(<NewSessionResumeSelectionContent
                    value=""
                    onChangeValue={() => {}}
                    onSave={() => {}}
                    onClear={() => {}}
                    onClose={() => {}}
                    agentType="claude"
                    maxHeight={460}
                />);

        const rootView = screen.find((node) => {
            const style = node.props?.style;
            const styleArray = Array.isArray(style) ? style : [style];
            return styleArray.filter(Boolean).some((entry) => (entry as { maxHeight?: number }).maxHeight === 460);
        });
        const styleArray = Array.isArray(rootView?.props.style) ? rootView.props.style : [rootView?.props.style];
        const flattenedStyle = Object.assign({}, ...styleArray.filter(Boolean));

        expect(flattenedStyle.maxHeight).toBe(460);
    });

    it('saves a typed resume id with the exact bytes the Agent issued', async () => {
        const { NewSessionResumeSelectionContent } = await import('./NewSessionResumeSelectionContent');

        // Whitespace, newlines and base64 punctuation are part of an opaque
        // Agent-issued identity. Trimming here hands the Agent an id it never
        // minted and the resume silently misses.
        const opaqueResumeId = '  provider\nses/AB+cd==  ';
        const onSave = vi.fn();

        const screen = await renderScreen(
            <NewSessionResumeSelectionContent
                value={opaqueResumeId}
                onChangeValue={() => {}}
                onSave={onSave}
                onClear={() => {}}
                onClose={() => {}}
                agentType="claude"
            />,
        );

        const saveButton = screen.findByTestId('resume-id-save-trigger');
        if (!saveButton) {
            throw new Error('expected resume-id-save-trigger');
        }

        await saveButton.props.onPress?.();

        expect(onSave).toHaveBeenCalledWith(opaqueResumeId);
    });

    it('pastes a resume id with the exact bytes on the clipboard', async () => {
        const { NewSessionResumeSelectionContent } = await import('./NewSessionResumeSelectionContent');

        const opaqueResumeId = '  provider\nses/AB+cd==  ';
        clipboardMockState.value = opaqueResumeId;
        const onChangeValue = vi.fn();

        const screen = await renderScreen(
            <NewSessionResumeSelectionContent
                value=""
                onChangeValue={onChangeValue}
                onSave={() => {}}
                onClear={() => {}}
                onClose={() => {}}
                agentType="claude"
            />,
        );

        const pasteButton = screen.findByTestId('resume-id-paste-trigger');
        if (!pasteButton) {
            throw new Error('expected resume-id-paste-trigger');
        }

        await pasteButton.props.onPress?.();

        expect(onChangeValue).toHaveBeenCalledWith(opaqueResumeId);
    });

    it('does not paste a whitespace-only clipboard value', async () => {
        const { NewSessionResumeSelectionContent } = await import('./NewSessionResumeSelectionContent');

        clipboardMockState.value = '   \n  ';
        const onChangeValue = vi.fn();

        const screen = await renderScreen(
            <NewSessionResumeSelectionContent
                value=""
                onChangeValue={onChangeValue}
                onSave={() => {}}
                onClear={() => {}}
                onClose={() => {}}
                agentType="claude"
            />,
        );

        const pasteButton = screen.findByTestId('resume-id-paste-trigger');
        if (!pasteButton) {
            throw new Error('expected resume-id-paste-trigger');
        }

        await pasteButton.props.onPress?.();

        expect(onChangeValue).not.toHaveBeenCalled();
    });

    it('renders a browse button that fills the resume id with the exact bytes the Agent issued', async () => {
        const { NewSessionResumeSelectionContent } = await import('./NewSessionResumeSelectionContent');

        // Opaque provider session ids are identity, not user input. This surface
        // only decides present-vs-absent; normalization belongs to the canonical
        // authoring-draft owner.
        const opaqueRemoteSessionId = '  sess/AB+cd==/123  ';
        const onBrowse = vi.fn(async () => opaqueRemoteSessionId);
        const onChangeValue = vi.fn();
        const onSave = vi.fn();

        const screen = await renderScreen(
            <NewSessionResumeSelectionContent
                value=""
                onChangeValue={onChangeValue}
                onSave={onSave}
                onClear={() => {}}
                onClose={() => {}}
                agentType="claude"
                resumeBrowse={{
                    enabled: true,
                    onBrowse,
                }}
            />,
        );

        const browseButton = screen.findByTestId('resume-id-browse-trigger');
        expect(browseButton).toBeTruthy();
        if (!browseButton) {
            throw new Error('expected resume-id-browse-trigger');
        }

        await browseButton.props.onPress?.();

        expect(onBrowse).toHaveBeenCalledTimes(1);
        expect(onSave).toHaveBeenCalledWith(opaqueRemoteSessionId);
    });

    it('does not save a whitespace-only browse result', async () => {
        const { NewSessionResumeSelectionContent } = await import('./NewSessionResumeSelectionContent');

        const onBrowse = vi.fn(async () => '   ');
        const onSave = vi.fn();

        const screen = await renderScreen(
            <NewSessionResumeSelectionContent
                value=""
                onChangeValue={() => {}}
                onSave={onSave}
                onClear={() => {}}
                onClose={() => {}}
                agentType="claude"
                resumeBrowse={{
                    enabled: true,
                    onBrowse,
                }}
            />,
        );

        const browseButton = screen.findByTestId('resume-id-browse-trigger');
        if (!browseButton) {
            throw new Error('expected resume-id-browse-trigger');
        }

        await browseButton.props.onPress?.();

        expect(onBrowse).toHaveBeenCalledTimes(1);
        expect(onSave).not.toHaveBeenCalled();
    });

    it('does not auto-save when browse is handled by navigation (onBrowse returns null)', async () => {
        const { NewSessionResumeSelectionContent } = await import('./NewSessionResumeSelectionContent');

        const onBrowse = vi.fn(async () => null);
        const onSave = vi.fn();

        const screen = await renderScreen(
            <NewSessionResumeSelectionContent
                value=""
                onChangeValue={() => {}}
                onSave={onSave}
                onClear={() => {}}
                onClose={() => {}}
                agentType="claude"
                resumeBrowse={{
                    enabled: true,
                    onBrowse,
                }}
            />,
        );

        const browseButton = screen.findByTestId('resume-id-browse-trigger');
        expect(browseButton).toBeTruthy();
        if (!browseButton) {
            throw new Error('expected resume-id-browse-trigger');
        }

        await browseButton.props.onPress?.();

        expect(onBrowse).toHaveBeenCalledTimes(1);
        expect(onSave).not.toHaveBeenCalled();
    });

    it('uses the resolved backend label in the placeholder when provided', async () => {
        const { NewSessionResumeSelectionContent } = await import('./NewSessionResumeSelectionContent');

        const screen = await renderScreen(
            <NewSessionResumeSelectionContent
                value=""
                onChangeValue={() => {}}
                onSave={() => {}}
                onClear={() => {}}
                onClose={() => {}}
                agentType="customAcp"
                agentLabel="Review Bot"
            />,
        );

        const input = screen.findByTestId('resume-id-input');
        expect(input?.props?.placeholder).toBe('newSession.resume.placeholder:Review Bot');
    });

    it('falls back to an unknown label when no canonical agent label is available', async () => {
        const { NewSessionResumeSelectionContent } = await import('./NewSessionResumeSelectionContent');

        const screen = await renderScreen(
            <NewSessionResumeSelectionContent
                value=""
                onChangeValue={() => {}}
                onSave={() => {}}
                onClear={() => {}}
                onClose={() => {}}
                agentType="not-a-real-agent"
            />,
        );

        const input = screen.findByTestId('resume-id-input');
        expect(input?.props?.placeholder).toBe('newSession.resume.placeholder:common.unknown');
    });
});
