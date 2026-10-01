import { describe, expect, it } from 'vitest';

import { createPluginReactNativeWatchdog } from './watchdog';

const digestA = `sha256:${'a'.repeat(64)}` as const;
const digestB = `sha256:${'b'.repeat(64)}` as const;

describe('plugin React Native local watchdog', () => {
    it('deduplicates repeated failures into one containment fact per digest', () => {
        const watchdog = createPluginReactNativeWatchdog();

        watchdog.recordFailure({ artifactDigest: digestA });
        watchdog.recordFailure({ artifactDigest: digestA });

        expect(watchdog.isContained({ artifactDigest: digestA })).toBe(true);
    });

    it('Retry clears only the requested digest and a new digest starts uncontained', () => {
        const watchdog = createPluginReactNativeWatchdog();
        watchdog.recordFailure({ artifactDigest: digestA });
        watchdog.recordFailure({ artifactDigest: digestB });

        watchdog.clear({ artifactDigest: digestA });

        expect(watchdog.isContained({ artifactDigest: digestA })).toBe(false);
        expect(watchdog.isContained({ artifactDigest: digestB })).toBe(true);
        expect(watchdog.isContained({
            artifactDigest: `sha256:${'c'.repeat(64)}`,
        })).toBe(false);
    });

    it('does not restore crash authority into a fresh watchdog instance', () => {
        const first = createPluginReactNativeWatchdog();
        first.recordFailure({ artifactDigest: digestA });

        const fresh = createPluginReactNativeWatchdog();

        expect(first.isContained({ artifactDigest: digestA })).toBe(true);
        expect(fresh.isContained({ artifactDigest: digestA })).toBe(false);
    });
});
