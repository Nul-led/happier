import { createHappierCollectionVisitMemory } from '@happier-dev/plugin-ui/presentation';

/** The agent last opened in the Agents collection during this app session; a wide collection lands on it. */
const agentVisits = createHappierCollectionVisitMemory<string>();

export const recordAgentCollectionVisit = agentVisits.record;
export const readLastVisitedAgentCollectionId = agentVisits.read;
