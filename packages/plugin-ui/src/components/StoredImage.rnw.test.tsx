import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { PluginUiReadStoredImageResultV1 } from '@happier-dev/plugin-sdk/ui';
import { mountThroughReactNativeWebAsync } from '../rnwMount.testSupport.js';
import { createHostApiStub, createSurfaceContext } from '../surfaceFixture.testSupport.js';
import { PluginUiProvider } from './PluginUiProvider.js';
import { StoredImage } from './StoredImage.js';
import { PluginUiPresentationHostProviderInternal } from '../presentationHost/context.js';

describe('authorized StoredImage reference presentation', () => {
  it('renders admitted image data and cancels the reference read when the viewer unmounts', async () => {
    const context = createSurfaceContext();
    let signal: AbortSignal | undefined;
    let complete: ((image: PluginUiReadStoredImageResultV1) => void) | undefined;
    const hostApi = createHostApiStub(context, {
      // The host API/decoder are external boundaries of this author component.
      readStoredImage: (_ref, options) => { signal = options?.signal; return new Promise((resolve) => { complete = resolve; }); },
    });
    const mount = await mountThroughReactNativeWebAsync(<PluginUiProvider hostApi={hostApi} context={context}>
      <PluginUiPresentationHostProviderInternal host={{ renderMarkdown: () => null, renderCodeBlock: () => null,
        renderPopover: () => null, renderIcon: () => null,
        storedImageHost: { renderImage: ({ uri }) => <img src={uri} alt="Admitted image" /> } }}>
        <StoredImage image={{ sessionId: 'session-1', mediaId: 'media-1' }} accessibilityLabel="Capture" />
      </PluginUiPresentationHostProviderInternal>
    </PluginUiProvider>);
    expect(mount.container.querySelector('img')).toBeNull();
    await act(async () => { complete?.({ bytesBase64: 'cG5n', mimeType: 'image/png', width: 100, height: 60 }); });
    expect(mount.container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,cG5n');
    expect(mount.container.querySelector('[aria-label="Capture"]')).not.toBeNull();
    mount.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
