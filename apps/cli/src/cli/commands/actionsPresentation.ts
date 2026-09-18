import { definitionList, sectionTitle } from '@happier-dev/cli-common/output';
import type { PublicActionResultById } from '@happier-dev/protocol';

import type { ActionCliPresentation } from '@/cli/actions/commandPresentation';
import { writeJsonStdout } from '@/cli/output/jsonEnvelope';

export const ACTION_SPEC_SEARCH_PRESENTATION: ActionCliPresentation = {
  presentSuccess: (payload, context) => {
    if (context.json) return false;
    const rows = (payload as PublicActionResultById['action.spec.search']).actionSpecs;
    console.log(rows.length
      ? definitionList(rows.map((row) => ({
          label: row.id,
          value: [row.title, row.description].filter(Boolean).join(' — '),
        })))
      : '(no matching Actions)');
    return true;
  },
};

export const ACTION_SPEC_GET_PRESENTATION: ActionCliPresentation = {
  presentSuccess: async (payload, context) => {
    if (context.json) return false;
    const spec = (payload as PublicActionResultById['action.spec.get']).actionSpec;
    console.log(sectionTitle('Action'));
    console.log(definitionList([
      { label: 'ID', value: spec.id },
      { label: 'Title', value: spec.title },
      { label: 'Description', value: spec.description ?? '' },
      { label: 'Safety', value: spec.safety },
    ].filter((row) => row.value)));
    console.log(sectionTitle('Input schema'));
    await writeJsonStdout(spec.inputSchema, { pretty: true });
    return true;
  },
};
