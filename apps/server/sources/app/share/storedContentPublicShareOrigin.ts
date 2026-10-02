import { readLocalServicesFeatureEnv } from "@/app/features/catalog/readFeatureEnv";
import { resolveLocalServiceHostOrigin } from "@/app/local/services/preview/origin";
import { resolveConfiguredPublicServerUrl } from "@/app/serverUrls/effectiveServerUrls";

export function resolveStoredContentPublicShareOrigin(shareId: string, env: NodeJS.ProcessEnv = process.env): string | null {
    const result = resolveLocalServiceHostOrigin({
        publicBaseUrl: resolveConfiguredPublicServerUrl(env) ?? "",
        hostOriginBaseDomain: readLocalServicesFeatureEnv(env).previewHostOriginBaseDomain,
        resourceId: shareId,
    });
    return result.ok ? result.origin : null;
}
