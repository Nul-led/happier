import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Directory identifiers are trimmed at the protocol boundary, so the portable binary
// collation supplies the required case-sensitive comparison without raising the
// repository's documented MySQL 8.0.16 support floor to the 0900 collation family.
const MYSQL_BINARY_COLLATION = "CHARACTER SET utf8mb4 COLLATE utf8mb4_bin";

function migrationSql(name: string): string {
    return readFileSync(join(process.cwd(), "prisma/mysql/migrations", name, "migration.sql"), "utf8");
}

describe("Account Directory MySQL exact identity migration contract", () => {
    it("binary-collates only the six exact Home and issuer identity columns", () => {
        const directorySql = migrationSql("20260830120000_add_account_directory_models");
        const approvalSql = migrationSql("20260830140000_add_home_assertion_approval_fields");

        expect(directorySql).toContain(
            "`preferredHomeServerIdentityId` VARCHAR(191) " + MYSQL_BINARY_COLLATION + " NULL",
        );
        expect(directorySql).toContain(
            "`homeServerIdentityId` VARCHAR(191) " + MYSQL_BINARY_COLLATION + " NOT NULL",
        );
        expect(directorySql).toContain(
            "`issuerServerIdentityId` VARCHAR(191) " + MYSQL_BINARY_COLLATION + " NOT NULL",
        );
        expect(directorySql).toContain(
            "`issuerSubjectId` VARCHAR(256) " + MYSQL_BINARY_COLLATION + " NOT NULL",
        );
        expect(approvalSql).toContain(
            "`requesterIssuerServerIdentityId` VARCHAR(191) " + MYSQL_BINARY_COLLATION + " NULL",
        );
        expect(approvalSql).toContain(
            "`requesterIssuerSubjectId` VARCHAR(256) " + MYSQL_BINARY_COLLATION + " NULL",
        );

        expect(directorySql.match(/COLLATE utf8mb4_bin/gu)).toHaveLength(4);
        expect(approvalSql.match(/COLLATE utf8mb4_bin/gu)).toHaveLength(2);
        expect(directorySql).not.toContain("COLLATE utf8mb4_0900_bin");
        expect(approvalSql).not.toContain("COLLATE utf8mb4_0900_bin");
        expect(directorySql).toMatch(/`accountId` VARCHAR\(191\) NOT NULL/gu);
        expect(approvalSql).not.toMatch(/`accountId`[^,;\n]*COLLATE/gu);
        expect(directorySql.match(/DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci/gu))
            .toHaveLength(2);
    });
});
