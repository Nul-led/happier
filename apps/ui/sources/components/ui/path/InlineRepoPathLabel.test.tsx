import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
}));

function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) {
        return Object.assign({}, ...style.map((entry) => flattenStyle(entry)));
    }
    if (style && typeof style === 'object') {
        return style as Record<string, unknown>;
    }
    return {};
}

describe('InlineRepoPathLabel', () => {
    it('uses the web start-ellipsis path wrapper so filenames keep priority', async () => {
        const { InlineRepoPathLabel } = await import('./InlineRepoPathLabel');

        const screen = await renderScreen(
            <InlineRepoPathLabel
                fullPath="src/middleware/rateLimit.ts"
                pathTextStyle={{ color: 'path' }}
                nameTextStyle={{ color: 'name' }}
                nameMaxWidth="70%"
            />,
        );

        const labels = screen.tree.root.findAllByType('Text' as never);
        expect(labels).toHaveLength(3);

        expect(labels[0]!.props.ellipsizeMode).toBeUndefined();
        expect(flattenStyle(labels[0]!.props.style)).toMatchObject({
            color: 'path',
            writingDirection: 'rtl',
            textAlign: 'right',
        });
        expect(flattenStyle(labels[1]!.props.style)).toMatchObject({
            writingDirection: 'ltr',
            unicodeBidi: 'isolate',
        });
        expect(labels[1]!.props.children).toBe('src/middleware/');
        expect(labels[2]!.props.children).toBe('rateLimit.ts');
        expect(labels[2]!.props.ellipsizeMode).toBe('middle');
    });

    it('keeps root-level filenames aligned with nested filenames by default', async () => {
        const { InlineRepoPathLabel } = await import('./InlineRepoPathLabel');

        const screen = await renderScreen(
            <InlineRepoPathLabel fullPath="README.md" />,
        );

        const labels = screen.tree.root.findAllByType('Text' as never);
        const spacers = screen.tree.root.findAllByType('View' as never).filter((node) => {
            const style = node.props.style;
            return style?.flex === 1 && style?.minWidth === 0;
        });

        expect(labels).toHaveLength(1);
        expect(labels[0]!.props.children).toBe('README.md');
        expect(spacers).toHaveLength(1);
    });

    it('lets the filename win the row when preferNameOverPath is set', async () => {
        const { InlineRepoPathLabel } = await import('./InlineRepoPathLabel');

        const screen = await renderScreen(
            <InlineRepoPathLabel
                fullPath="src/middleware/rateLimit.ts"
                nameMaxWidth="70%"
                preferNameOverPath
            />,
        );

        const labels = screen.tree.root.findAllByType('Text' as never);
        const nameLabel = labels[labels.length - 1]!;
        expect(nameLabel.props.children).toBe('rateLimit.ts');
        expect(nameLabel.props.ellipsizeMode).toBe('middle');
        // preferNameOverPath lifts the basename cap so the path yields first.
        expect(flattenStyle(nameLabel.props.style)).toMatchObject({ maxWidth: '100%' });
    });

    // Session-tabs lab G1: the Git change row reads name first with its folder beneath, and two files
    // with the same name are told apart by their nearest distinguishing folder, the way editor tabs do.
    function textOf(node: { props: { children?: unknown } }): string {
        const children = node.props.children;
        if (typeof children === 'string') return children;
        if (Array.isArray(children)) return children.map((child) => (typeof child === 'string' ? child : child?.props ? textOf(child) : '')).join('');
        if (children && typeof children === 'object' && 'props' in (children as object)) return textOf(children as never);
        return '';
    }

    it('stacks the name over its folder and prefixes duplicate names with their nearest distinguishing folder', async () => {
        const { InlineRepoPathLabel } = await import('./InlineRepoPathLabel');

        const screen = await renderScreen(
            <InlineRepoPathLabel
                layout="stacked"
                fullPath=".agents/skills/attack-conclusion/SKILL.md"
                siblingPaths={['.agents/skills/happier-testing/SKILL.md', 'docs/attack-conclusion/SKILL.md']}
            />,
        );

        const name = screen.findByTestId('repo-path-label-name');
        const folder = screen.findByTestId('repo-path-label-folder');
        // "attack-conclusion" alone would not tell it from docs/attack-conclusion: one more folder is needed.
        expect(textOf(name as never)).toBe('skills/attack-conclusion/SKILL.md');
        expect(textOf(folder as never)).toBe('.agents/skills/attack-conclusion');
    });

    it('keeps a unique name bare, and names the repository for a root file', async () => {
        const { InlineRepoPathLabel } = await import('./InlineRepoPathLabel');

        const unique = await renderScreen(
            <InlineRepoPathLabel layout="stacked" fullPath="apps/ui/settings.tsx" siblingPaths={[]} />,
        );
        expect(textOf(unique.findByTestId('repo-path-label-name') as never)).toBe('settings.tsx');

        const root = await renderScreen(
            <InlineRepoPathLabel layout="stacked" fullPath="AGENTS.md" rootLabel="happier" siblingPaths={['docs/AGENTS.md']} />,
        );
        expect(textOf(root.findByTestId('repo-path-label-name') as never)).toBe('AGENTS.md');
        expect(textOf(root.findByTestId('repo-path-label-folder') as never)).toBe('happier');
    });
});
