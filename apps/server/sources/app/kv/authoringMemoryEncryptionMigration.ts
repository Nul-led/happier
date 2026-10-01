import {
    assertAuthoringMemoryContentForModeV1,
    pluginJsonValuesEqual,
    type AccountEncryptionMigrateAuthoringMemoryDirective,
    type AuthoringMemoryRowV1,
} from "@happier-dev/protocol";
import type { Tx } from "@/storage/inTx";

import { buildAuthoringMemoryPhysicalKey, encodeAccountScopedKvJson } from "./accountScopedKv";
import { listAuthoringMemoryInTx, markAuthoringMemoryChangedInTx } from "./authoringMemoryStorage";
import { applyUserKvMutationsInTx } from "./kvMutate";

type Params = Readonly<{
    accountId: string;
    toMode: "plain" | "e2ee";
    directive?: AccountEncryptionMigrateAuthoringMemoryDirective;
}>;
export type AuthoringMemoryAccountMigrationResult =
    | Readonly<{ status: "applied"; rows: readonly AuthoringMemoryRowV1[] }>
    | Readonly<{ status: "migration_incomplete" | "invalid_content" }>;

function indexDirective(params: Params) {
    const items = new Map<string, NonNullable<Params["directive"]>["items"][number]>();
    for (const item of params.directive?.items ?? []) {
        if (items.has(item.key)) return null;
        try { assertAuthoringMemoryContentForModeV1(item.content, params.toMode); }
        catch { return null; }
        items.set(item.key, item);
    }
    return items;
}

/** The caller holds the Account transition fence and aborts on any rejection. */
export async function migrateAuthoringMemoryForAccountModeInTx(
    tx: Tx, params: Params,
): Promise<AuthoringMemoryAccountMigrationResult> {
    const source = await listAuthoringMemoryInTx(tx, { accountId: params.accountId });
    if (source.status !== "listed") return { status: "invalid_content" };
    const rows = source.rows.filter((row) => row.content !== null);
    const items = indexDirective(params);
    if (!items) return { status: "invalid_content" };
    if (items.size !== rows.length || rows.some((row) => {
        const item = items.get(row.key);
        return !item || item.expectedRevision !== row.revision;
    })) return { status: "migration_incomplete" };
    if (rows.length === 0) return { status: "applied", rows: [] };

    const application = await applyUserKvMutationsInTx(tx, { uid: params.accountId }, rows.map((row) => {
        const item = items.get(row.key)!;
        const value = encodeAccountScopedKvJson(item.content);
        if (value === null) throw new Error("Validated authoring memory cannot be encoded");
        return { key: buildAuthoringMemoryPhysicalKey(row.key), version: item.expectedRevision, value };
    }));
    if (!application.success) return { status: "migration_incomplete" };
    const migrated: AuthoringMemoryRowV1[] = [];
    for (const row of rows) {
        const item = items.get(row.key)!;
        const revision = item.expectedRevision + 1;
        await markAuthoringMemoryChangedInTx(tx, { accountId: params.accountId, key: row.key, revision });
        migrated.push({ key: row.key, revision, content: item.content });
    }
    return { status: "applied", rows: migrated };
}

/** Exact lost-response replay observes the committed rows and performs no writes. */
export async function matchAuthoringMemoryAccountMigrationPostStateInTx(tx: Tx, params: Params): Promise<
    | Readonly<{ status: "matched"; rows: readonly AuthoringMemoryRowV1[] }>
    | Readonly<{ status: "mismatch" }>
> {
    const state = await listAuthoringMemoryInTx(tx, { accountId: params.accountId });
    if (state.status !== "listed") return { status: "mismatch" };
    const rows = state.rows.filter((row) => row.content !== null);
    const items = indexDirective(params);
    if (!items || items.size !== rows.length || rows.some((row) => {
        const item = items.get(row.key);
        return !item || row.revision !== item.expectedRevision + 1 || !pluginJsonValuesEqual(row.content, item.content);
    })) return { status: "mismatch" };
    return { status: "matched", rows };
}
