import * as React from 'react';

export type UiTextModuleMockOptions = Readonly<{
    TextTag?: string;
    TextInputTag?: string;
}>;

/**
 * `forwardRef` so a test can reach the host node through `createNodeMock` — the app `Text`/`TextInput`
 * primitives forward refs, and renderer tests that assert programmatic focus need the same contract.
 */
function createHostComponent(tagName: string) {
    return React.forwardRef<unknown, { children?: React.ReactNode }>(
        function UiTextHost({ children, ...props }, ref) {
            return React.createElement(tagName, { ...props, ref }, children ?? null);
        },
    );
}

export function createUiTextModuleMock(options: UiTextModuleMockOptions = {}) {
    const TextTag = options.TextTag ?? 'Text';
    const TextInputTag = options.TextInputTag ?? 'TextInput';
    return {
        TextSelectabilityScope: ({ children }: Readonly<{ selectable: boolean; children: React.ReactNode }>) => (
            <>{children}</>
        ),
        Text: createHostComponent(TextTag),
        TextInput: createHostComponent(TextInputTag),
    };
}

export function installUiTextModuleMock(options: UiTextModuleMockOptions = {}) {
    return () => createUiTextModuleMock(options);
}
