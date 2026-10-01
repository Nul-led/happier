import { createDeleteManyRetentionRule } from './createDeleteManyRetentionRule';

/** This Home's administration audit trail (plan §3.9): kept forever unless the owner sets an age. */
export function createHomeAdministrationEventRetentionRule() {
    return createDeleteManyRetentionRule({
        id: 'homeAdministrationEvents',
        modelName: 'homeAdministrationEvent',
        primaryField: 'id',
        cutoffField: 'at',
    });
}
