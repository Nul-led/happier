import { db } from "@/storage/db";
import * as privacyKit from "privacy-kit";

import {
    ACCOUNT_SCOPED_KV_RESERVED_PREFIX,
    assertPublicGenericKvPrefix,
} from "./accountScopedKv";

export interface KVListOptions {
    prefix?: string;
    afterKey?: string;
    limit?: number;
}

export interface KVListResult {
    items: Array<{
        key: string;
        value: string;
        version: number;
    }>;
}

/**
 * List all key-value pairs for the authenticated user, optionally filtered by prefix.
 * Returns keys, values, and versions. Excludes entries with null values (deleted).
 */
export async function kvList(
    ctx: { uid: string },
    options?: KVListOptions
): Promise<KVListResult> {
    assertPublicGenericKvPrefix(options?.prefix);

    const where = {
        accountId: ctx.uid,
        value: {
            not: null  // Exclude deleted entries (null values)
        },
        NOT: {
            key: {
                startsWith: ACCOUNT_SCOPED_KV_RESERVED_PREFIX,
            },
        },
        ...(options?.prefix || options?.afterKey !== undefined ? {
            key: {
                ...(options.prefix ? { startsWith: options.prefix } : {}),
                ...(options.afterKey !== undefined ? { gt: options.afterKey } : {}),
            },
        } : {}),
    };

    const results = await db.userKVStore.findMany({
        where,
        orderBy: {
            key: 'asc'
        },
        take: options?.limit
    });

    return {
        items: results
            .filter(r => r.value !== null)  // Extra safety check
            .map(r => ({
                key: r.key,
                value: privacyKit.encodeBase64(r.value!),
                version: r.version
            }))
    };
}
