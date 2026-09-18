import { describe, expect, it } from "vitest";
import {
    deriveGithubDirectoryExternalSourceKey,
    deriveWorkosDirectoryExternalSourceKey,
    parseTeamDirectoryBindingConfigV1,
} from "./directorySourceBinding";

describe("directorySourceBinding", () => {
    it("parses only the two exact versioned source documents", () => {
        expect(parseTeamDirectoryBindingConfigV1({
            v: 1,
            kind: "workos_directory",
            workosDirectoryId: "directory_01",
        })).toEqual({ v: 1, kind: "workos_directory", workosDirectoryId: "directory_01" });
        expect(parseTeamDirectoryBindingConfigV1({
            v: 1,
            kind: "github_organization",
            githubOrganizationLogin: "Acme",
        })).toEqual({ v: 1, kind: "github_organization", githubOrganizationLogin: "Acme" });

        expect(() => parseTeamDirectoryBindingConfigV1({
            v: 1,
            kind: "workos_directory",
            workosDirectoryId: "directory_01",
            organizationId: "copied-authority",
        })).toThrow();
        expect(() => parseTeamDirectoryBindingConfigV1({
            v: 1,
            kind: "github_organization",
            githubOrganizationLogin: " ",
        })).toThrow();
        expect(() => parseTeamDirectoryBindingConfigV1({
            v: 2,
            kind: "workos_directory",
            workosDirectoryId: "directory_01",
        })).toThrow();
    });

    it("derives domain-separated collision-safe keys from immutable owner identity", () => {
        const workos = deriveWorkosDirectoryExternalSourceKey({
            organizationId: "organization:one",
            directoryId: "directory:two",
        });
        expect(workos).toMatch(/^workos_directory:[A-Za-z0-9_-]{43}$/);
        expect(deriveWorkosDirectoryExternalSourceKey({
            organizationId: "organization:one",
            directoryId: "directory:two",
        })).toBe(workos);
        expect(deriveWorkosDirectoryExternalSourceKey({
            organizationId: "organization",
            directoryId: "one:directory:two",
        })).not.toBe(workos);

        expect(deriveGithubDirectoryExternalSourceKey({
            registrationId: "registration",
            installationId: 101n,
            organizationId: 202n,
        })).toMatch(/^github_organization:[A-Za-z0-9_-]{43}$/);
    });
});
