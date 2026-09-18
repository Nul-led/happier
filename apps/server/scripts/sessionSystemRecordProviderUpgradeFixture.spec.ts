import { createHash } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
    stageReleasedPreviewMigrations,
} from "./sessionSystemRecordProviderUpgradeFixture";
import { SESSION_SYSTEM_RECORD_PREVIEW_PROVENANCE } from "./sessionSystemRecordPreviewProvenance";
import { resolveServerWorkspaceRoot } from "./prismaCli";

describe("Session System Record preview upgrade provenance", () => {
    it.each(["postgres", "mysql"] as const)("stages the exact immutable %s preview", async (provider) => {
        const serverRoot = resolveServerWorkspaceRoot(import.meta.url);
        const expected = SESSION_SYSTEM_RECORD_PREVIEW_PROVENANCE.providers[provider];
        const staged = await stageReleasedPreviewMigrations({
            provider,
            serverRoot,
        });
        const exactSchemaFixture = await readFile(join(
            serverRoot,
            "scripts",
            "fixtures",
            "session-system-record-preview",
            expected.schemaFixtureFile,
        ));
        try {
            const stagedNames = (await readdir(join(staged.stageDir, "migrations"), { withFileTypes: true }))
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name)
                .sort((left, right) => left.localeCompare(right));
            const stagedSchemaBytes = await readFile(staged.schemaPath);

            expect.soft(SESSION_SYSTEM_RECORD_PREVIEW_PROVENANCE.release).toBe("server-v0.2.11-preview.2");
            expect.soft(SESSION_SYSTEM_RECORD_PREVIEW_PROVENANCE.commit)
                .toBe("98ea8fb76733b1dd785d38c31360179cafa84824");
            expect.soft(stagedNames).toEqual(expected.migrationNames);
            expect.soft(stagedSchemaBytes.equals(exactSchemaFixture)).toBe(true);
            expect.soft(createHash("sha256").update(stagedSchemaBytes).digest("hex"))
                .toBe(expected.schemaSha256);
        } finally {
            await rm(staged.stageDir, { recursive: true, force: true });
        }
    });
});
