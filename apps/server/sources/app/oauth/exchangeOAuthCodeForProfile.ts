import type { OAuthFlowProvider, OAuthTokenExchangeResult } from "./providers/types";

export type OAuthCodeProfileExchangeResult = Omit<OAuthTokenExchangeResult, "profile"> & Readonly<{
    profile: unknown;
}>;

export async function exchangeOAuthCodeForProfile(input: Readonly<{
    provider: OAuthFlowProvider;
    env: NodeJS.ProcessEnv;
    code: string;
    state?: string;
    iss?: string;
    pkceCodeVerifier?: string;
    expectedNonce?: string;
}>): Promise<OAuthCodeProfileExchangeResult> {
    const exchanged = await input.provider.exchangeCodeForAccessToken(input);
    const profile = exchanged.profile !== undefined
        ? exchanged.profile
        : await input.provider.fetchProfile({
            env: input.env,
            accessToken: exchanged.accessToken,
            idToken: exchanged.idToken,
            idTokenClaims: exchanged.idTokenClaims,
        });
    return { ...exchanged, profile };
}
