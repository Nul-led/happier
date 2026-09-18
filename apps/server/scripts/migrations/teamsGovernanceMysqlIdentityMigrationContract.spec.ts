import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const serverRoot = join(import.meta.dirname, "..", "..");

describe("Team governance MySQL identity migration contract", () => {
    it("keeps Group-name identity aligned with the canonical case-fold-only key", async () => {
        const sql = await readFile(join(
            serverRoot,
            "prisma/mysql/migrations/20260905220000_add_team_home_governance/migration.sql",
        ), "utf8");

        expect(sql).toContain(
            "`nameKey` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL",
        );
    });
});
