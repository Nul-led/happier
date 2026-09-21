import {
    ACCOUNT_STORED_CONTENT_SESSION_SPAWN_PLACEMENT_ORIGIN_PROTOCOL_VERSION,
    ExternalActionMachineBootstrapV1Schema,
    MachineOperationProtocolCapabilitiesV1Schema,
    MachineKindFromLegacyProjectionSchema,
    RunnerMachineContentKeyBindingV1Schema,
    type MachineKind,
} from "@happier-dev/protocol";

export type MachineSerializationRow = Readonly<{
    id: string;
    kind?: MachineKind;
    metadata: string;
    metadataVersion: number;
    daemonState: string | null;
    daemonStateVersion: number;
    dataEncryptionKey: Uint8Array | null;
    runnerContentKeyBinding?: unknown | null;
    installationId?: string | null;
    installationPublicKey?: Uint8Array | null;
    contentPublicKeyFingerprint?: string | null;
    operationProtocolCapabilities?: unknown | null;
    operationProtocolCapabilitiesRevision?: number | null;
    replacedByMachineId?: string | null;
    replacedAt?: Date | null;
    replacementReason?: string | null;
    replacementSource?: string | null;
    replacementActorUserId?: string | null;
    seq: number;
    active: boolean;
    lastActiveAt: Date;
    revokedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}>;

export function serializeMachineRow(
    row: MachineSerializationRow,
    options: Readonly<{
        recipientAccountStoredContentProtocolVersion?: number | null;
    }> = {},
) {
    const kind = MachineKindFromLegacyProjectionSchema.parse(row.kind);
    const runnerContentKeyBinding = kind === "ephemeral_session_runner"
        ? RunnerMachineContentKeyBindingV1Schema.safeParse(row.runnerContentKeyBinding)
        : null;
    const capabilityProjection =
        MachineOperationProtocolCapabilitiesV1Schema.safeParse(
            row.operationProtocolCapabilities,
        );
    const capabilityRevision =
        typeof row.operationProtocolCapabilitiesRevision === "number"
        && Number.isInteger(row.operationProtocolCapabilitiesRevision)
        && row.operationProtocolCapabilitiesRevision > 0
            ? row.operationProtocolCapabilitiesRevision
            : null;
    // A capability leaf is recipient-safe only together with the revision that
    // proves it was an accepted complete projection. Malformed or partial
    // persistence, or a revoked/replaced Machine, is deliberately
    // indistinguishable from unsupported.
    const completeOperationProtocolCapabilities =
        capabilityProjection.success
        && capabilityRevision !== null
        && row.revokedAt === null
        && row.replacedByMachineId === null
            ? capabilityProjection.data
            : null;
    const operationProtocolCapabilities = completeOperationProtocolCapabilities === null
        ? null
        : options.recipientAccountStoredContentProtocolVersion !== undefined
            && options.recipientAccountStoredContentProtocolVersion !== null
            && options.recipientAccountStoredContentProtocolVersion
                >= ACCOUNT_STORED_CONTENT_SESSION_SPAWN_PLACEMENT_ORIGIN_PROTOCOL_VERSION
            ? completeOperationProtocolCapabilities
            : (() => {
                const {
                    sessionSpawnPlacementOrigin: _withheldPlacementOrigin,
                    ...preV4Capabilities
                } = completeOperationProtocolCapabilities;
                return preV4Capabilities;
            })();

    return {
        id: row.id,
        kind,
        metadata: row.metadata,
        metadataVersion: row.metadataVersion,
        daemonState: row.daemonState,
        daemonStateVersion: row.daemonStateVersion,
        dataEncryptionKey: row.dataEncryptionKey ? Buffer.from(row.dataEncryptionKey).toString("base64") : null,
        runnerContentKeyBinding:
            runnerContentKeyBinding?.success === true
                ? runnerContentKeyBinding.data
                : null,
        installationId: row.installationId ?? null,
        installationPublicKey: row.installationPublicKey ? Buffer.from(row.installationPublicKey).toString("base64") : null,
        contentPublicKeyFingerprint: row.contentPublicKeyFingerprint ?? null,
        operationProtocolCapabilities,
        operationProtocolCapabilitiesRevision:
            operationProtocolCapabilities === null ? null : capabilityRevision,
        replacedByMachineId: row.replacedByMachineId ?? null,
        replacedAt: row.replacedAt ? row.replacedAt.getTime() : null,
        replacementReason: row.replacementReason ?? null,
        replacementSource: row.replacementSource ?? null,
        replacementActorUserId: row.replacementActorUserId ?? null,
        seq: row.seq,
        active: row.active,
        activeAt: row.lastActiveAt.getTime(),
        revokedAt: row.revokedAt ? row.revokedAt.getTime() : null,
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
    };
}

/**
 * A PAT caller selects an exact Machine with this row and, for a restricted
 * Runner, seals its protected request against the Runner's own content key.
 * Only the Runner arm carries content: the envelope is an Account-sealed box
 * the Home cannot open and the binding is the strict non-secret proof that
 * authenticates it, so a bearer-only token learns nothing usable. Persistent
 * Machine content and install state keep the released closed projection.
 */
export function serializeExternalActionMachineBootstrapRow(
    row: Pick<
        MachineSerializationRow,
        "id" | "active" | "revokedAt" | "replacedByMachineId"
    > & Partial<Pick<
        MachineSerializationRow,
        "kind" | "installationId" | "dataEncryptionKey" | "runnerContentKeyBinding"
    >>,
) {
    const kind = MachineKindFromLegacyProjectionSchema.parse(row.kind);
    const runnerContentKeyBinding = kind === "ephemeral_session_runner"
        ? RunnerMachineContentKeyBindingV1Schema.safeParse(row.runnerContentKeyBinding)
        : null;
    return ExternalActionMachineBootstrapV1Schema.parse({
        id: row.id,
        active: row.active,
        revokedAt: row.revokedAt ? row.revokedAt.getTime() : null,
        replacedByMachineId: row.replacedByMachineId ?? null,
        kind,
        installationId: kind === "ephemeral_session_runner"
            ? row.installationId ?? null
            : null,
        dataEncryptionKey: kind === "ephemeral_session_runner" && row.dataEncryptionKey
            ? Buffer.from(row.dataEncryptionKey).toString("base64")
            : null,
        runnerContentKeyBinding: runnerContentKeyBinding?.success === true
            ? runnerContentKeyBinding.data
            : null,
    });
}
