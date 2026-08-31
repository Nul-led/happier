export const PRESENT_USER_REQUIRED_ERROR = "present_user_required" as const;

type AuthenticatedRouteRequest = Readonly<{
    authTokenKind?: unknown;
    routeOptions?: Readonly<{
        config?: Readonly<{
            allowApiToken?: unknown;
            allowAccountDirectoryToken?: unknown;
        }>;
    }>;
}>;

/** Restricted kinds never gain ordinary Home transport capabilities. */
export function isRestrictedAuthTokenKind(
    kind: unknown,
): kind is "api_token" | "account_directory" {
    return kind === "api_token" || kind === "account_directory";
}

/**
 * Restricted credentials are opt-in at the HTTP route boundary. Keeping this
 * decision in one helper prevents a route from accidentally becoming a
 * second authority merely by forgetting a local guard.
 */
export function isRestrictedAuthTokenDeniedForRoute(
    request: AuthenticatedRouteRequest,
): boolean {
    if (request.routeOptions?.config?.allowAccountDirectoryToken === true) {
        return request.authTokenKind !== "account"
            && request.authTokenKind !== "account_directory";
    }
    if (request.authTokenKind === "api_token") {
        return request.routeOptions?.config?.allowApiToken !== true;
    }
    if (request.authTokenKind === "account_directory") {
        return request.routeOptions?.config?.allowAccountDirectoryToken !== true;
    }
    return false;
}
