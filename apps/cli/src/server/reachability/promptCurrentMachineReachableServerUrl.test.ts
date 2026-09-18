import { describe, expect, it, vi } from 'vitest';

import { promptForCurrentMachineReachableServerUrl } from './promptCurrentMachineReachableServerUrl';

describe('promptForCurrentMachineReachableServerUrl', () => {
  it('describes the selected endpoint as a Home throughout the custom-address flow', async () => {
    const prompts: string[] = [];
    const answers = ['custom', 'https://home.example.test'];
    const promptInput = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      return answers.shift() ?? '';
    });

    await expect(promptForCurrentMachineReachableServerUrl({
      localServerUrl: 'http://127.0.0.1:3005',
      remoteDescription: 'your phone',
      candidates: [{
        url: 'https://home.tailnet.test',
        source: 'tailscale-serve',
        label: 'Tailscale Serve (HTTPS)',
        detail: null,
        verified: true,
      }],
    }, { promptInput })).resolves.toBe('https://home.example.test');

    expect(prompts.join('\n')).toContain('The selected Home is only reachable from this computer:');
    expect(prompts.join('\n')).toContain("reach this computer's Home");
    expect(prompts.join('\n')).not.toMatch(/selected relay|computer's relay/i);
  });
});
