import * as React from 'react';
import { Pressable } from 'react-native';
import { describe, expect, it } from 'vitest';
import type { ReactTestInstance } from 'react-test-renderer';

import { renderScreen } from '@/dev/testkit';

import { SessionListRowPresentation } from './SessionListRowPresentation';

function ancestorTestIds(node: ReactTestInstance | null): string[] {
    const ids: string[] = [];
    for (let current = node?.parent ?? null; current; current = current.parent) {
        const id = current.props?.testID;
        if (typeof id === 'string') ids.push(id);
    }
    return ids;
}

/**
 * On the web a `button` role renders a `<button>`, and a `<button>` may not contain another one.
 * The row's own press target and its trailing actions (tag, pin, ⋯) are therefore siblings, the
 * way `Item` places a right accessory that has controls of its own.
 */
describe('SessionListRowPresentation', () => {
    it('keeps trailing actions outside the row press target', async () => {
        const screen = await renderScreen(
            <SessionListRowPresentation
                density="default"
                identity={React.createElement('Identity')}
                title={React.createElement('Title')}
                trailing={<Pressable testID="row-action" accessibilityRole="button" accessibilityLabel="Pin" onPress={() => {}} />}
                renderContainer={(content, style) => (
                    <Pressable testID="row-press-target" accessibilityRole="button" style={style} onPress={() => {}}>
                        {content}
                    </Pressable>
                )}
            />,
        );

        const action = screen.findHostByTestId('row-action');
        expect(action).toBeTruthy();
        expect(ancestorTestIds(action)).not.toContain('row-press-target');
        const title = screen.root.findAllByType('Title' as never)[0] ?? null;
        expect(ancestorTestIds(title)).toContain('row-press-target');
    });
});
