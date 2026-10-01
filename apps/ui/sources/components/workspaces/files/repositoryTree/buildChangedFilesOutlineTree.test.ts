import { describe, expect, it } from 'vitest';

import { buildChangedFilesOutlineTree, buildChangedOnlyTreeNodes } from '@/components/workspaces/files/repositoryTree/buildChangedFilesOutlineTree';

describe('buildChangedFilesOutlineTree', () => {
    it('builds a directory-first, case-insensitive sorted outline tree', () => {
        const files = [
            { fullPath: 'src/zeta.ts', fileName: 'zeta.ts' },
            { fullPath: 'src/alpha.ts', fileName: 'alpha.ts' },
            { fullPath: 'README.md', fileName: 'README.md' },
            { fullPath: 'src/components/Button.tsx', fileName: 'Button.tsx' },
            { fullPath: 'src/components/Alert.tsx', fileName: 'Alert.tsx' },
            { fullPath: 'src/Components/Case.tsx', fileName: 'Case.tsx' },
            { fullPath: 'src\\win\\a.ts', fileName: 'a.ts' },
        ] as any[];

        const tree = buildChangedFilesOutlineTree(files as any);

        expect(tree.map((n) => `${n.kind}:${n.name}`)).toEqual(['dir:src', 'file:README.md']);

        const src = tree[0]!;
        expect(src.kind).toBe('dir');
        if (src.kind !== 'dir') return;

        expect(src.children.map((n) => `${n.kind}:${n.name}`)).toEqual([
            'dir:components',
            'dir:Components',
            'dir:win',
            'file:alpha.ts',
            'file:zeta.ts',
        ]);

        const components = src.children[0]!;
        expect(components.kind).toBe('dir');
        if (components.kind !== 'dir') return;
        expect(components.children.map((n) => `${n.kind}:${n.name}`)).toEqual(['file:Alert.tsx', 'file:Button.tsx']);
    });

    describe('buildChangedOnlyTreeNodes (Changed only: the tree pruned to the changed files)', () => {
        const files = [
            'apps/ui/sources/app/(app)/settings.tsx',
            'apps/ui/sources/components/settings/modal/SettingsModal.tsx',
            'apps/ui/sources/components/settings/modal/useSettingsRouteKey.ts',
            '.agents/skills/attack-conclusion/SKILL.md',
            '.agents/skills/verify-claims/SKILL.md',
            'AGENTS.md',
        ].map((fullPath) => ({ fullPath, fileName: fullPath.split('/').pop() })) as any[];
        const rows = (nodes: ReturnType<typeof buildChangedOnlyTreeNodes>) =>
            nodes.map((node) => `${'  '.repeat(node.depth)}${node.type === 'directory' ? (node.isExpanded ? 'v ' : '> ') : ''}${node.name}`);

        it('opens every folder and collapses single-child folder chains into one row', () => {
            const nodes = buildChangedOnlyTreeNodes(files, new Set());
            expect(rows(nodes)).toEqual([
                'v .agents/skills',
                '  v attack-conclusion',
                '    SKILL.md',
                '  v verify-claims',
                '    SKILL.md',
                'v apps/ui/sources',
                '  v app/(app)',
                '    settings.tsx',
                '  v components/settings/modal',
                '    SettingsModal.tsx',
                '    useSettingsRouteKey.ts',
                'AGENTS.md',
            ]);
            // A collapsed chain row stands for its deepest folder, so opening, badges and reveal use that path.
            expect(nodes.find((node) => node.name === 'components/settings/modal')?.path).toBe('apps/ui/sources/components/settings/modal');
            expect(nodes.find((node) => node.name === 'settings.tsx')?.path).toBe('apps/ui/sources/app/(app)/settings.tsx');
        });

        it('hides the files under a folder the person closed, keeping the rest open', () => {
            const nodes = buildChangedOnlyTreeNodes(files, new Set(['apps/ui/sources/components/settings/modal']));
            expect(rows(nodes).slice(5)).toEqual([
                'v apps/ui/sources',
                '  v app/(app)',
                '    settings.tsx',
                '  > components/settings/modal',
                'AGENTS.md',
            ]);
        });
    });
});
