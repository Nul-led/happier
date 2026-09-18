import { describe, expect, it } from 'vitest';

import {
    buildSessionOrganizationLabelKey,
    buildSessionOrganizationOrderScopeKey,
} from './keys';

describe('session organization tuple keys', () => {
    it('keeps delimiter-bearing Home and scope identities injective', () => {
        const firstOrder = buildSessionOrganizationOrderScopeKey({
            serverId: 'home',
            scopeKind: 'group',
            scopeKey: 'folder:group:planning',
        });
        const secondOrder = buildSessionOrganizationOrderScopeKey({
            serverId: 'home:group:folder',
            scopeKind: 'group',
            scopeKey: 'planning',
        });
        const firstLabel = buildSessionOrganizationLabelKey({
            serverId: 'home',
            labelKind: 'workspace',
            scopeKey: 'folder:workspace:planning',
        });
        const secondLabel = buildSessionOrganizationLabelKey({
            serverId: 'home:workspace:folder',
            labelKind: 'workspace',
            scopeKey: 'planning',
        });

        expect(firstOrder).not.toBe(secondOrder);
        expect(firstLabel).not.toBe(secondLabel);
        expect(JSON.parse(firstOrder)).toEqual(['home', 'group', 'folder:group:planning']);
        expect(JSON.parse(firstLabel)).toEqual(['home', 'workspace', 'folder:workspace:planning']);
    });
});
