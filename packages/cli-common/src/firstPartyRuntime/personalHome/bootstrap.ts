import {
    PersonalHomeSignupClosureError,
    type PersonalHomeSignupPolicyState,
} from '../personalHomeSignupPolicy.js';
import {
    createPersonalHomeRuntimeSpec,
    type PersonalHomeRuntimeSpec,
} from './personalHomeRuntimeSpec.js';

/**
 * Supported Home credential shapes for the local plain Personal Home account.
 * Token-only/plain Homes carry no secret material; `secret` is optional and is
 * never required in results. Shapes map onto the existing Home-scoped secure
 * TokenStorage credential variants at the composition-root boundary.
 */
export type PersonalHomeAccountCredentials = Readonly<{
    token: string;
    secret?: string;
}>;

/**
 * Completion/adoption receipt persisted by the caller-owned profile/adoption
 * seam only after every Home-readiness invariant has been verified. A failed
 * attempt never reaches this step, so absence of the receipt is the retry contract.
 */
export type PersonalHomeBootstrapReceipt = Readonly<{
    canonicalServerUrl: string;
    localServerUrl: string;
    port: number;
    accountCreated: boolean;
    completedAtMs: number;
}>;

export type PersonalHomeBootstrapResult = Readonly<{
    canonicalServerUrl: string;
    localServerUrl: string;
    port: number;
    credentials: PersonalHomeAccountCredentials;
    accountCreated: boolean;
    receipt: PersonalHomeBootstrapReceipt;
    profileId: string | null;
}>;

/**
 * Existing persisted credentials no longer authenticate against the local Home.
 * The Home stays loopback-only and blocked on the existing recovery path; a
 * duplicate account must never be created over an existing data directory.
 */
export class PersonalHomeCredentialsUnverifiedError extends Error {
    readonly code = 'personal_home_credentials_unverified';

    constructor() {
        super('Personal Home credentials could not be verified against the local Home. Use the existing recovery path instead of creating a duplicate account.');
        this.name = 'PersonalHomeCredentialsUnverifiedError';
    }
}

export type PersonalHomeBootstrapDeps = Readonly<{
    bindLoopback: () => Promise<void>;
    resolveNonCollidingPort: () => Promise<number>;
    readPersistedPort: () => Promise<number | null>;
    /** Authoritative persisted/runtime signup policy observed before the first mutation. */
    readPersistedPolicy: () => Promise<PersonalHomeSignupPolicyState>;
    /** Installs/starts the managed runtime; its installer owns env and port persistence. */
    ensureRuntimeStarted: (input: Readonly<{
        spec: PersonalHomeRuntimeSpec;
        port: number;
        anonymousSignupEnabled: boolean;
    }>) => Promise<void>;
    /** Reads credentials from the existing Home-scoped secure credential owner; null when absent. */
    readPersistedCredentials: () => Promise<PersonalHomeAccountCredentials | null>;
    /** Creates the local plain account through the existing key-challenge path (caller-owned). */
    createLocalAccount: (input: Readonly<{ endpoint: string; spec: PersonalHomeRuntimeSpec }>) => Promise<PersonalHomeAccountCredentials>;
    persistCredentials: (credentials: PersonalHomeAccountCredentials) => Promise<void>;
    /** Authenticated local access probe against the explicit local endpoint. */
    verifyAuthenticatedAccess: (credentials: PersonalHomeAccountCredentials) => Promise<boolean>;
    /** Persists signup closure through the managed installer, then restarts/reloads the Home. */
    restartHome: (input: Readonly<{
        spec: PersonalHomeRuntimeSpec;
        port: number;
        anonymousSignupEnabled: false;
    }>) => Promise<void>;
    /** Server-reported effective auth policy; unknown values fail closed. */
    readEffectivePolicy: () => Promise<PersonalHomeSignupPolicyState>;
    /** Fresh anonymous signup attempt on the real Home endpoint; true only when refused. */
    probeAnonymousSignupRefused: () => Promise<boolean>;
    readListenerOrigin: () => Promise<string>;
    /** Caller-owned completion/adoption persistence (profile upsert seam). Called only after all invariants hold. */
    persistCompletionReceipt: (receipt: PersonalHomeBootstrapReceipt) => Promise<void | Readonly<{ profileId?: string }>>;
    /** Optional non-loopback carrier; runs last and only after completion is persisted. */
    exposeCarrier?: () => Promise<void>;
}>;

/**
 * Executes the loopback-first Personal Home sequence: resolve stable layout/origin;
 * ensure/install/start the runtime with bootstrap signup enabled; create or verify the
 * local account; persist credentials; apply signup closure; restart/reload; verify
 * anonymous signup refusal and authenticated local access; only then persist the
 * completion/adoption receipt; optional carrier last. Every side effect is supplied by
 * an existing owner, so failed attempts are retryable and never mark completion.
 */
export async function runPersonalHomeBootstrap(deps: PersonalHomeBootstrapDeps): Promise<PersonalHomeBootstrapResult> {
    // 1. Stable loopback layout/origin.
    await deps.bindLoopback();
    const persistedPort = await deps.readPersistedPort();
    const port = persistedPort ?? await deps.resolveNonCollidingPort();
    const canonicalServerUrl = `http://127.0.0.1:${port}`;
    const spec = createPersonalHomeRuntimeSpec({ canonicalServerUrl });

    // 2. Ensure/install/start the runtime with the observed safe signup posture. Environment
    //    rendering, deduplication, approval-policy preservation, and port persistence belong to
    //    the canonical installer rather than a caller-owned mirror of its managed file.
    // A retry/update must never reopen a Home whose managed policy is already
    // closed. Fresh/legacy envs without a policy key retain the bootstrap
    // posture; the subsequent live readback still fails closed if the server
    // cannot prove the requested state.
    const existingPolicy = await deps.readPersistedPolicy();
    const bootstrapSignupEnabled = existingPolicy !== 'disabled';
    await deps.ensureRuntimeStarted({ spec, port, anonymousSignupEnabled: bootstrapSignupEnabled });

    // 3. Create or verify the local account. Existing credentials are verified first so a
    //    retry after a failed attempt never creates a duplicate account.
    const existingCredentials = await deps.readPersistedCredentials();
    let credentials: PersonalHomeAccountCredentials;
    let accountCreated: boolean;
    if (existingCredentials) {
        if (!(await deps.verifyAuthenticatedAccess(existingCredentials))) {
            throw new PersonalHomeCredentialsUnverifiedError();
        }
        credentials = existingCredentials;
        accountCreated = false;
    } else {
        credentials = await deps.createLocalAccount({ endpoint: canonicalServerUrl, spec });
        // 4. Persist the supported credential shape through the Home-scoped secure owner.
        await deps.persistCredentials(credentials);
        accountCreated = true;
    }

    // 5-6. Ask the canonical managed installer to persist signup closure and restart/reload.
    await deps.restartHome({ spec, port, anonymousSignupEnabled: false });

    // 7. Verify anonymous signup refusal: persisted config, server-reported effective policy
    //    (fail closed on unknown), and a fresh live refusal probe. No exposure on failure.
    if (await deps.readEffectivePolicy() !== 'disabled') {
        throw new PersonalHomeSignupClosureError();
    }
    if (!(await deps.probeAnonymousSignupRefused())) {
        throw new PersonalHomeSignupClosureError();
    }
    const localServerUrl = (await deps.readListenerOrigin()).replace(/\/+$/u, '');
    if (localServerUrl !== canonicalServerUrl) throw new Error('Personal Home listener origin drifted from its canonical URL');

    // 8. Verify authenticated local access with the persisted credentials after restart.
    if (!(await deps.verifyAuthenticatedAccess(credentials))) {
        throw new PersonalHomeCredentialsUnverifiedError();
    }

    // 9. Only after every invariant holds, persist the completion/adoption receipt.
    const receipt: PersonalHomeBootstrapReceipt = Object.freeze({
        canonicalServerUrl,
        localServerUrl,
        port,
        accountCreated,
        completedAtMs: Date.now(),
    });
    const persistedReceipt = await deps.persistCompletionReceipt(receipt);

    // 10. Optional non-loopback carrier, strictly last.
    if (deps.exposeCarrier) await deps.exposeCarrier();

    return {
        canonicalServerUrl,
        localServerUrl,
        port,
        credentials,
        accountCreated,
        receipt,
        profileId: persistedReceipt?.profileId ?? null,
    };
}
