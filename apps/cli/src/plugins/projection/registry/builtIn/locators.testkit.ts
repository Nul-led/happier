import {
    BUNDLED_PLUGIN_PUBLICATION_FAILURES_RELATIVE_PATH,
    parseBundledPluginPublicationFailures,
} from '@happier-dev/cli-common/bundledPluginPublicationPolicy';

import type { BundledPluginPublicationFailure } from '@/plugins/validation/diagnostics/types';

/** Filesystem boundary only: keep bundled ingestion and contribution projection real. */
export function createBundledPluginPublicationFsFixture(
    actual: typeof import('node:fs'),
    failures: readonly BundledPluginPublicationFailure[] = [],
) {
    const bytes = JSON.stringify(failures);
    parseBundledPluginPublicationFailures(bytes);
    return {
        ...actual,
        readFileSync: (...args: Parameters<typeof actual.readFileSync>) => (
            String(args[0]).replaceAll('\\', '/').endsWith(`/${BUNDLED_PLUGIN_PUBLICATION_FAILURES_RELATIVE_PATH}`)
                ? bytes
                : actual.readFileSync(...args)
        ),
    };
}
