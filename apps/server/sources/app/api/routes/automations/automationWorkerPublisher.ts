import {
    PluginInstallationPublisherProofError,
    readPluginInstallationPublisherHeader,
    resolvePluginInstallationPublisherProofExpiresAt,
    verifyPluginInstallationPublisherHeader,
    type VerifiedPluginInstallationPublisher,
} from "@/app/plugins/installations/publisherProof";

type AutomationWorkerVerifiedPublisher = VerifiedPluginInstallationPublisher & Readonly<{
    /** Test seams may project the already-verified signed request identity. */
    requestNonce?: string;
    proofExpiresAt?: Date;
}>;

export type AutomationWorkerPublisherDependencies = Readonly<{
    verifyPublisher: (params: Parameters<typeof verifyPluginInstallationPublisherHeader>[0]) =>
        Promise<AutomationWorkerVerifiedPublisher | null>;
}>;

export const DEFAULT_AUTOMATION_WORKER_PUBLISHER_DEPENDENCIES: AutomationWorkerPublisherDependencies = {
    verifyPublisher: verifyPluginInstallationPublisherHeader,
};

export type ExactAutomationWorkerPublisher = Readonly<{
    kind: "publisherProof";
    machineId: string;
    machineInstallationId: string;
    requestNonce: string;
    proofExpiresAt: Date;
}>;

/**
 * Binds one worker HTTP request to the exact current machine-installation
 * publisher. Missing or invalid proof never establishes worker authority.
 */
export async function resolveExactAutomationWorkerPublisher(params: Readonly<{
    dependencies: AutomationWorkerPublisherDependencies;
    accountId: string;
    request: Readonly<{
        method?: string;
        headers?: Record<string, string | string[] | undefined>;
        body?: unknown;
    }>;
    path: string;
    machineId: string;
}>): Promise<ExactAutomationWorkerPublisher | null> {
    try {
        const publisher = await params.dependencies.verifyPublisher({
            accountId: params.accountId,
            request: params.request,
            path: params.path,
            required: true,
        });
        if (publisher?.machineId !== params.machineId) return null;
        const header = publisher.requestNonce && publisher.proofExpiresAt
            ? null
            : readPluginInstallationPublisherHeader(params.request.headers);
        if (
            header
            && (
                header.proof.machineId !== publisher.machineId
                || header.proof.installationId !== publisher.installationId
            )
        ) return null;
        const requestNonce = publisher.requestNonce ?? header?.proof.nonce;
        const proofExpiresAt = publisher.proofExpiresAt
            ?? (header ? resolvePluginInstallationPublisherProofExpiresAt(header.proof) : undefined);
        if (!requestNonce || !proofExpiresAt) return null;
        return {
            kind: "publisherProof",
            machineId: publisher.machineId,
            machineInstallationId: publisher.installationId,
            requestNonce,
            proofExpiresAt,
        };
    } catch (error) {
        if (error instanceof PluginInstallationPublisherProofError) {
            return null;
        }
        throw error;
    }
}
