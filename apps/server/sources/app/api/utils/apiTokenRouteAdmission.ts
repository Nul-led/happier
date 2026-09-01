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
): boolean {
    switch (kind) {
        case "account":
        case "terminal":
            return false;
        case "api_token":
        case "account_directory":
        default:
            return true;
    }
}

/**
 * Restricted credentials are opt-in at the HTTP route boundary. Keeping this
 * decision in one helper prevents a route from accidentally becoming a
 * second authority merely by forgetting a local guard.
 */
export function isRestrictedAuthTokenDeniedForRoute(
    request: AuthenticatedRouteRequest,
): boolean {
    switch (request.authTokenKind) {
        case "account":
            return false;
        case "terminal":
            return request.routeOptions?.config?.allowAccountDirectoryToken === true;
        case "api_token":
            return request.routeOptions?.config?.allowApiToken !== true;
        case "account_directory":
            return request.routeOptions?.config?.allowAccountDirectoryToken !== true;
        default:
            return true;
    }
}
