import {
    HomeConnectionEndpointV1Schema,
    type HomeConnectionDescriptorV1,
    type HomeConnectionEndpointV1,
} from '@happier-dev/protocol';

import type { SystemTaskPromptEnvelope } from '@/components/systemTasks/prompts/readLatestSystemTaskPrompt';
import type { AccountDirectorySession } from '@/sync/domains/accountDirectory/accountDirectorySession';

type RelocationDirectorySession = Pick<AccountDirectorySession, 'publishHomeDescriptor' | 'readHomeDescriptor'>;

export type PersonalHomeRelocationPublication = Readonly<{
    publish: (input: Readonly<{
        homeServerIdentityId: string;
        homeLabel: string;
        minimumOuterRevisionExclusive: number;
        canonicalServerUrl: string;
        endpoints: readonly HomeConnectionEndpointV1[];
    }>) => Promise<HomeConnectionDescriptorV1>;
    read: (homeServerIdentityId: string) => Promise<HomeConnectionDescriptorV1 | null>;
}>;

type RelocationPromptResponderParams = Readonly<{
    operationId: string;
    homeServerIdentityId: string;
    homeLabel: string;
    session: RelocationDirectorySession;
}>;

type RelocationPromptResponderWithPublicationParams = Omit<RelocationPromptResponderParams, 'session'> & Readonly<{
    publication: PersonalHomeRelocationPublication;
}>;

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readPositiveRevision(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function assertExpectedOperation(prompt: SystemTaskPromptEnvelope, params: RelocationPromptResponderParams): void {
    const operationId = readString(prompt.data.operationId);
    const homeServerIdentityId = readString(prompt.data.homeServerIdentityId);
    if (operationId !== params.operationId || homeServerIdentityId !== params.homeServerIdentityId) {
        throw new Error('Personal Home relocation prompt did not match the requested Home operation.');
    }
}

/**
 * The task runner owns relocation progress and prompt delivery. This adapter
 * only validates the bound prompt facts and delegates publication/readback to
 * the canonical Account Directory session; it neither stores credentials nor
 * becomes a Home-location authority.
 */
export function createPersonalHomeRelocationPromptResponder(
    params: RelocationPromptResponderParams,
): (prompt: SystemTaskPromptEnvelope) => Promise<Readonly<{ descriptor: unknown | null }>> {
    return createPersonalHomeRelocationPromptResponderWithPublication({
        operationId: params.operationId,
        homeServerIdentityId: params.homeServerIdentityId,
        homeLabel: params.homeLabel,
        publication: {
            publish: async (input) => {
                const result = await params.session.publishHomeDescriptor({
                    homeServerIdentityId: input.homeServerIdentityId,
                    label: input.homeLabel,
                    minimumOuterRevisionExclusive: input.minimumOuterRevisionExclusive,
                    canonicalServerUrl: input.canonicalServerUrl,
                    endpoints: input.endpoints,
                });
                return result.entry.connectionDescriptor;
            },
            read: async (homeServerIdentityId) => {
                const entry = await params.session.readHomeDescriptor(homeServerIdentityId);
                return entry?.connectionDescriptor ?? null;
            },
        },
    });
}

/**
 * The relocation task binds every publication/readback prompt to its operation
 * and Home identity. Directory-backed publication and initiating-client profile
 * adoption share this validation boundary; only their canonical persistence
 * owner differs.
 */
export function createPersonalHomeRelocationPromptResponderWithPublication(
    params: RelocationPromptResponderWithPublicationParams,
): (prompt: SystemTaskPromptEnvelope) => Promise<Readonly<{ descriptor: unknown | null }>> {
    return async (prompt) => {
        assertExpectedOperation(prompt, params);

        if (prompt.kind === 'personal_home.publish_relocation_descriptor.v1') {
            const canonicalServerUrl = readString(prompt.data.canonicalServerUrl);
            const minimumOuterRevisionExclusive = readPositiveRevision(prompt.data.minimumOuterRevisionExclusive);
            if (!canonicalServerUrl || minimumOuterRevisionExclusive === null || !Array.isArray(prompt.data.endpoints)
                || prompt.data.endpoints.length === 0) {
                throw new Error('Personal Home relocation publication prompt contained invalid destination facts.');
            }
            const endpoints = prompt.data.endpoints.map((endpoint) => HomeConnectionEndpointV1Schema.safeParse(endpoint));
            if (endpoints.some((endpoint) => !endpoint.success)) {
                throw new Error('Personal Home relocation publication prompt contained invalid destination facts.');
            }
            const published = await params.publication.publish({
                homeServerIdentityId: params.homeServerIdentityId,
                homeLabel: params.homeLabel,
                minimumOuterRevisionExclusive,
                canonicalServerUrl,
                endpoints: endpoints.flatMap((endpoint) => endpoint.success ? [endpoint.data] : []),
            });
            return { descriptor: published };
        }

        if (prompt.kind === 'personal_home.read_relocation_descriptor.v1') {
            return { descriptor: await params.publication.read(params.homeServerIdentityId) };
        }

        throw new Error('Unexpected Personal Home relocation prompt.');
    };
}
