import { describe, expect, it } from 'vitest';

const ui = await import('../../plugins/contributions/ui/v2.js');
const actions = await import('../../actions/actionSpecs.js');

describe('Session Board Protocol module initialization', () => {
  it('loads the canonical UI contribution graph before Board-backed Action specs', () => {
    expect(ui.PluginDeclarativeNodeV2Schema).toBeDefined();
    expect(actions.getActionSpec('session.board.item.upsert').id).toBe('session.board.item.upsert');
  });
});
