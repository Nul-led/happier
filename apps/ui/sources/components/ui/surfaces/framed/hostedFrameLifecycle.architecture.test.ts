import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('hosted frame lifecycle ownership', () => {
    it('keeps hosted HTML and static hosted web on the shared lifecycle owner', async () => {
        const [hostedHtmlAdapter, hostedWebPane] = await Promise.all([
            readFile(new URL('../hostedHtml/HostedHtmlSurfaceAdapter.tsx', import.meta.url), 'utf8'),
            readFile(new URL('../../../plugins/hostedWeb/PluginHostedWebPane.tsx', import.meta.url), 'utf8'),
        ]);

        expect(hostedHtmlAdapter).toContain('useHostedFrameLifecycle({');
        expect(hostedWebPane).toContain('useHostedFrameLifecycle({');
        expect(hostedWebPane).not.toContain('scheduleHostedFrameReadyTimeout');
        expect(hostedWebPane).not.toContain('setReadyTimedOut');
    });
});
