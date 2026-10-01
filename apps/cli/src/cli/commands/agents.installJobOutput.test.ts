import { describe, expect, it } from 'vitest';
import { formatAgentInstallJobCompletion } from './agents';

describe('agent job completion output', () => {
  it('reports observed completion/version rather than claiming the requested mutation occurred', () => {
    // Start may adopt another already-running job for this agent. Its terminal
    // version is observed; which operation ran cannot be inferred from argv.
    const output = formatAgentInstallJobCompletion({ title: 'Codex', version: '1.2.3' });
    expect(output).toContain('Codex');
    expect(output).toContain('1.2.3');
    expect(output).not.toMatch(/\b(?:installed|updated)\b/i);
  });
  it('does not invent a version when the terminal outcome has none', () => {
    const output = formatAgentInstallJobCompletion({ title: 'Codex', version: null });
    expect(output).toContain('Codex');
    expect(output).not.toMatch(/\b(?:null|undefined|installed|updated)\b/i);
  });
});
