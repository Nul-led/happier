import { describe, expect, it } from 'vitest';

import { buildSessionRouteScreenOptions } from './sessionRouteScreenOptions';

/**
 * `session/[id]` is one screen of the root stack (its `_layout` is a Slot), so every Session
 * sub-route shares that screen's options. The Session view and its cockpit surfaces draw their own
 * header — with the back affordance inline on phones — so the stack must not add a second header
 * row (the big back arrow above the Session header).
 */
describe('Session route screen options', () => {
    it.each([
        ['the Session view', 'index'],
        ['the initial render, before the nested route resolves', undefined],
        ['the files surface', 'files'],
        ['the git surface', 'git'],
        ['the details surface', 'details'],
        ['the terminal surface', 'terminal'],
    ] as const)('draws no stack header over %s', (_name, childRouteName) => {
        expect(buildSessionRouteScreenOptions({ childRouteName })).toMatchObject({ headerShown: false });
    });

    it('leaves a Session sub-page that declares its own stack header alone', () => {
        expect(buildSessionRouteScreenOptions({ childRouteName: 'runs' })).toEqual({});
        expect(buildSessionRouteScreenOptions({ childRouteName: 'info' })).toEqual({});
    });
});
