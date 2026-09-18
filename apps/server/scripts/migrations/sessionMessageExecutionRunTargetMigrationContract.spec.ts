import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const serverRoot = join(import.meta.dirname, "..", "..");
const migrationId = "20260913180000_add_session_message_execution_run_target";

async function read(relativePath: string): Promise<string> {
    return await readFile(join(serverRoot, relativePath), "utf8");
}

function model(schema: string, name: string): string {
    const match = schema.match(new RegExp(`model\\s+${name}\\s+\\{([\\s\\S]*?)\\n\\}`, "m"));
    if (!match?.[1]) throw new Error(`model ${name} not found`);
    return match[1];
}

describe("Session message execution-run target migration contract", () => {
    const providers = [
        {
            schemaPath: "prisma/schema.prisma",
            migrationPath: `prisma/migrations/${migrationId}/migration.sql`,
            expectedAlter: 'ALTER TABLE "SessionMessage" ADD COLUMN "targetExecutionRunId" TEXT;',
        },
        {
            schemaPath: "prisma/sqlite/schema.prisma",
            migrationPath: `prisma/sqlite/migrations/${migrationId}/migration.sql`,
            expectedAlter: 'ALTER TABLE "SessionMessage" ADD COLUMN "targetExecutionRunId" TEXT;',
        },
        {
            schemaPath: "prisma/mysql/schema.prisma",
            migrationPath: `prisma/mysql/migrations/${migrationId}/migration.sql`,
            expectedAlter: "ALTER TABLE `SessionMessage` ADD COLUMN `targetExecutionRunId` VARCHAR(191) NULL;",
        },
    ] as const;

    it.each(providers)("adds one nullable private binding in $schemaPath", async ({ schemaPath }) => {
        const schema = await read(schemaPath);

        expect(model(schema, "SessionMessage")).toMatch(
            /^\s*targetExecutionRunId\s+String\?\s*$/m,
        );
        expect(schema.match(/^\s*targetExecutionRunId\s+String\?\s*$/gm)).toHaveLength(2);
    });

    it.each(providers)(
        "keeps $migrationPath additive and data-preserving",
        async ({ migrationPath, expectedAlter }) => {
            const sql = await read(migrationPath);

            expect(sql).toContain(expectedAlter);
            expect(sql.match(/ALTER TABLE/g)).toHaveLength(1);
            expect(sql).not.toMatch(/SessionPendingMessage|\b(?:UPDATE|INSERT|DELETE|DROP|CREATE)\b/i);
        },
    );
});
