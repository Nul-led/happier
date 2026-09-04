import { describe, expect, it } from 'vitest';

import { AutomationApiError } from '../../sync/api/automations/apiAutomations';
import { formatAutomationError } from './automationErrorFormatting';

describe('formatAutomationError', () => {
    it('maps typed API codes to safe user text and recovery action', () => {
        const result = formatAutomationError(
            new AutomationApiError({ code: 'sourceTurnNotCurrent', status: 409, message: 'secret server detail' }),
            'Fallback',
        );
        expect(result.action).toBe('automations.exactTurn.useCurrentTurn');
        expect(result.message).toBe('automations.exactTurn.staleBody');
    });

    it('does not expose unknown server messages', () => {
        expect(formatAutomationError(
            new AutomationApiError({ code: 'unknown', status: 500, message: 'internal secret' }),
            'Fallback',
        )).toEqual({ message: 'Fallback', action: 'Try again.' });
    });
});
