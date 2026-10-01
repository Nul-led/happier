import { describe, expect, it } from 'vitest';

import type { Machine } from '@/sync/domains/state/storageTypes';
import { t } from '@/text';

import { describeBindingTarget } from './McpBindingTargetFields';

describe('describeBindingTarget', () => {
    it('names an unnamed machine as unnamed, never by its id', () => {
        const machines = [{ id: 'f98b860d-63e0', metadata: {} }] as unknown as Machine[];
        const label = describeBindingTarget({ t: 'machine', machineId: 'f98b860d-63e0' }, machines);
        expect(label).toContain(t('machine.unnamedMachine'));
        expect(label).not.toContain('f98b860d');
    });
});
