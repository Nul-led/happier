import { WaitActionResultV1Schema } from '@happier-dev/protocol';
import type { ActionCliPresentation } from './commandPresentation';

export const WAIT_PRESENTATION: ActionCliPresentation = {
  presentSuccess: async (payload, context) => {
    if (context.json) return false;
    const result = WaitActionResultV1Schema.parse(payload);
    console.log(`Observation: ${result.disposition}.`);
    if (result.disposition === 'cancelled' || result.disposition === 'observation_timeout') console.log('Only observation ended; work was not cancelled. Reuse the same target handle.');
    return false;
  },
};
