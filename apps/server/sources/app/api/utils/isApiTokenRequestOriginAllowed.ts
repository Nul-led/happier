import {
    isOriginAllowedByApiTokenGrantV1,
    type ApiTokenGrantV1,
} from "@happier-dev/protocol/auth/apiTokenGrant";

import { resolveEffectiveWebappUrl } from "@/app/serverUrls/effectiveServerUrls";

/** HTTP and socket admission share the grant plus the configured Happier origin. */
export function isApiTokenRequestOriginAllowed(grant: ApiTokenGrantV1, origin: string): boolean {
    if (isOriginAllowedByApiTokenGrantV1(grant, origin)) return true;
    const webappUrl = resolveEffectiveWebappUrl(process.env);
    return webappUrl !== undefined && new URL(webappUrl).origin === origin;
}
