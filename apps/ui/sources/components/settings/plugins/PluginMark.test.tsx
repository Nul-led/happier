import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { PluginMark } from './PluginMark';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());

// The Agent logo renderer draws SVG/image assets; the mark rule above it is what is under test.
vi.mock('@/agents/registry/AgentIcon', () => ({
    AgentIcon: (props: Record<string, unknown>) => React.createElement('AgentIcon', props),
}));

function render(element: React.ReactElement): ReactTestRenderer {
    let tree!: ReactTestRenderer;
    act(() => {
        tree = create(element);
    });
    return tree;
}

const agentLogos = (tree: ReactTestRenderer) => tree.root.findAll((node) => (node.type as unknown) === 'AgentIcon');
const glyphs = (tree: ReactTestRenderer) => tree.root.findAll((node) => node.props?.name === 'puzzle-piece');
const letters = (tree: ReactTestRenderer, letter: string) => tree.root.findAll((node) => (
    typeof node.type === 'string' && node.children.length === 1 && node.children[0] === letter
));

describe('PluginMark', () => {
    it('shows the contributed Agent logo when that Agent has one', () => {
        const tree = render(<PluginMark title="Some Plugin" iconAgentId="claude" />);
        expect(agentLogos(tree)).toHaveLength(1);
        expect(glyphs(tree)).toHaveLength(0);
    });

    it('falls back to the neutral plugin glyph, never a tinted letter, when there is no logo', () => {
        // The bundled review engines are Agents without an icon asset; most plugins contribute no Agent.
        for (const iconAgentId of ['coderabbit', null]) {
            const tree = render(<PluginMark title="Some Plugin" iconAgentId={iconAgentId} />);
            expect(agentLogos(tree)).toHaveLength(0);
            expect(glyphs(tree)).toHaveLength(1);
            expect(letters(tree, 'S')).toHaveLength(0);
        }
    });

    it('draws the same rule at the head of the plugin page', () => {
        expect(agentLogos(render(<PluginMark title="Claude" iconAgentId="claude" size="page" />))).toHaveLength(1);
        expect(glyphs(render(<PluginMark title="Notes" size="page" />))).toHaveLength(1);
    });
});
