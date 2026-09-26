import { accountDirectorySigningKeyMetadata } from "@/app/accountDirectory/accountDirectorySigner";
import type { FeaturesPayloadDelta } from "./types";

/**
 * Account Directory is an additive capability. The signing key is public
 * metadata; no bearer or Home credential is ever included in this payload.
 */
export function resolveAccountDirectoryFeature(env: NodeJS.ProcessEnv): FeaturesPayloadDelta {
    try {
        const signing = accountDirectorySigningKeyMetadata(env);
        return {
            capabilities: {
                accountDirectory: {
                    version: 1,
                    homeDirectory: true,
                    homeEnrollment: true,
                    homeLoginAssertion: signing,
                },
            },
        };
    } catch {
        // A missing master secret already prevents auth startup. Keep feature
        // discovery fail-closed while allowing health/configuration routes to
        // remain inspectable.
        return {};
    }
}

/**
 * Whether this server is an account service: it can sign the Home-directory assertions every
 * Account Directory credential is used for. Routes that mint the restricted Directory credential
 * answer to this one fact, the same one discovery advertises.
 */
export function isAccountDirectoryServiceEnabled(env: NodeJS.ProcessEnv): boolean {
    return resolveAccountDirectoryFeature(env).capabilities?.accountDirectory?.homeDirectory === true;
}
