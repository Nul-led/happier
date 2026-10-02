import { useEffect, useState, type ReactElement } from 'react';
import type { StoredImageRefV1, PluginUiReadStoredImageResultV1 } from '@happier-dev/plugin-sdk/ui';
import { usePluginHostApi } from '../hostApi/context.js';
import { useOptionalPluginUiPresentationHost } from '../presentationHost/context.js';
import { HappierStoredImage } from '../presentation/content/StoredImage.js';
import { usePluginTheme } from './PluginUiProvider.js';
import { Icon } from './Icon.js';

export type StoredImageProps = Readonly<{
  /** Native Session-image artifact reference from a successfully delivered Action result. */
  image: StoredImageRefV1;
  accessibilityLabel: string;
  testID?: string;
}>;

/** Read one mount-retained Session image under the plugin's declared Sessions READ scope. */
export function StoredImage({ image, accessibilityLabel, testID }: StoredImageProps): ReactElement {
  const hostApi = usePluginHostApi();
  const presentationHost = useOptionalPluginUiPresentationHost();
  const theme = usePluginTheme();
  const identity = JSON.stringify([image.sessionId, image.mediaId]);
  const [preview, setPreview] = useState<Readonly<{
    identity: string;
    status: 'loading' | 'loaded' | 'error';
    image?: PluginUiReadStoredImageResultV1;
    uri?: string;
  }>>({ identity, status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setPreview({ identity, status: 'loading' });
    void hostApi.readStoredImage({ sessionId: image.sessionId, mediaId: image.mediaId }, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setPreview({ identity, status: 'loaded', image: result,
          uri: `data:${result.mimeType};base64,${result.bytesBase64}` });
      }, () => { if (!controller.signal.aborted) setPreview({ identity, status: 'error' }); });
    return () => controller.abort();
  }, [hostApi, identity, image.sessionId, image.mediaId]);
  const current: typeof preview = preview.identity === identity ? preview : { identity, status: 'loading' };
  return <HappierStoredImage identity={identity} status={current.status} uri={current.uri}
    dimensions={current.image} accessibilityLabel={accessibilityLabel} testID={testID}
    borderColor={theme.colors.border} backgroundColor={theme.colors.control}
    host={presentationHost?.storedImageHost}
    placeholder={<Icon name={current.status === 'error' ? 'warning' : 'preview'} />} />;
}
