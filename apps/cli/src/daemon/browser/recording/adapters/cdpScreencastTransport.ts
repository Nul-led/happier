import type { BrowserCdpScreencastProducer } from '../../capture/cdpScreencast';
import type { BrowserRecordingCdpScreencastTransport } from './cdpScreencast';

/**
 * Subscribes the recording encoder to the daemon's shared per-view screencast producer.
 * This keeps `cdpScreencast` on the same route/service/adapter path as stream-frame and native
 * recording; view resolution, CDP start/stop and ACKs have a single shared producer owner.
 */
export function createBrowserRecordingCdpScreencastTransport(
  options: Readonly<{ producer: BrowserCdpScreencastProducer }>,
): BrowserRecordingCdpScreencastTransport {
  return {
    start: (input) => options.producer.start({
      view: input.recording,
      onFrame: input.onFrame,
      onError: input.onError,
    }),
  };
}
