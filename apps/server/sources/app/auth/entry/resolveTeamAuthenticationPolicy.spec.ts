import { describe, expect, it } from "vitest";

import {
    hasUsableTeamAuthenticationChoiceOtherThan,
    resolveTeamAuthenticationPolicy,
    resolveTeamAuthenticationPolicyActivationReadiness,
} from "./resolveTeamAuthenticationPolicy";

describe("resolveTeamAuthenticationPolicy", () => {
    it("treats null and explicit inherit as the same unrestricted Team policy", () => {
        expect(resolveTeamAuthenticationPolicy({ policy: null, homeMethods: [], teamConnections: [] }))
            .toEqual({ status: "inherit" });
        expect(resolveTeamAuthenticationPolicy({
            policy: { v: 1, mode: "inherit" },
            homeMethods: [],
            teamConnections: [],
        })).toEqual({ status: "inherit" });
    });

    it("resolves a stored provider method id against the catalog case-insensitively", () => {
        expect(resolveTeamAuthenticationPolicy({
            policy: {
                v: 1,
                mode: "restricted",
                accepted: [{ kind: "home_method", methodId: "GitHub" }],
            },
            homeMethods: [{ id: "github", available: true }],
            teamConnections: [],
        })).toEqual({
            status: "restricted",
            choices: [{
                reference: { kind: "home_method", methodId: "GitHub" },
                availability: "usable",
            }],
        });
    });

    it("resolves a stored provider method id whose bytes carry surrounding whitespace", () => {
        // A `teams.policy.set` caller may store `" GitHub "`: the qualifier and
        // the in-transaction resolver already trim before they compare, so this
        // resolver reporting it unavailable was the only disagreement about the
        // same method identity.
        expect(resolveTeamAuthenticationPolicy({
            policy: {
                v: 1,
                mode: "restricted",
                accepted: [{ kind: "home_method", methodId: " GitHub " }],
            },
            homeMethods: [{ id: "github", available: true }],
            teamConnections: [],
        })).toEqual({
            status: "restricted",
            choices: [{
                reference: { kind: "home_method", methodId: " GitHub " },
                availability: "usable",
            }],
        });
    });

    it("retains configured unavailable references while resolving exact usable alternatives", () => {
        const result = resolveTeamAuthenticationPolicy({
            policy: {
                v: 1,
                mode: "restricted",
                accepted: [
                    { kind: "team_connection", connectionId: "connection-missing" },
                    { kind: "home_method", methodId: "email_password" },
                    { kind: "team_connection", connectionId: "connection-ready" },
                ],
            },
            homeMethods: [
                { id: "email_password", available: false },
                { id: "github", available: true },
            ],
            teamConnections: [
                { id: "connection-ready", available: true },
                { id: "connection-other-team", available: true },
            ],
        });

        expect(result).toEqual({
            status: "restricted",
            choices: [
                {
                    reference: { kind: "home_method", methodId: "email_password" },
                    availability: "unavailable",
                },
                {
                    reference: { kind: "team_connection", connectionId: "connection-missing" },
                    availability: "unavailable",
                },
                {
                    reference: { kind: "team_connection", connectionId: "connection-ready" },
                    availability: "usable",
                },
            ],
        });
        if (result.status !== "restricted") throw new Error("expected restricted resolution");
        expect(hasUsableTeamAuthenticationChoiceOtherThan(
            result,
            { kind: "team_connection", connectionId: "connection-ready" },
        )).toBe(false);
        expect(hasUsableTeamAuthenticationChoiceOtherThan(
            result,
            { kind: "team_connection", connectionId: "connection-missing" },
        )).toBe(true);
    });

    it("fails malformed persisted policy closed", () => {
        expect(resolveTeamAuthenticationPolicy({
            policy: { v: 1, mode: "restricted", accepted: [] },
            homeMethods: [{ id: "email_password", available: true }],
            teamConnections: [],
        })).toEqual({ status: "unavailable" });
    });

    it("requires one usable native or current-tested external choice before activation", () => {
        const resolution = resolveTeamAuthenticationPolicy({
            policy: {
                v: 1,
                mode: "restricted",
                accepted: [
                    { kind: "home_method", methodId: "email_password" },
                    { kind: "team_connection", connectionId: "connection-ready" },
                ],
            },
            homeMethods: [{ id: "email_password", available: true }],
            teamConnections: [{ id: "connection-ready", available: true }],
        });

        expect(resolveTeamAuthenticationPolicyActivationReadiness(resolution, []))
            .toBe("provider_test_required");
        expect(resolveTeamAuthenticationPolicyActivationReadiness(
            resolution,
            [{ kind: "home_method", methodId: "email_password" }],
        )).toBe("ready");
    });

    it("does not count a current test for an unavailable or differently tagged choice", () => {
        const resolution = resolveTeamAuthenticationPolicy({
            policy: {
                v: 1,
                mode: "restricted",
                accepted: [{ kind: "team_connection", connectionId: "same-id" }],
            },
            homeMethods: [{ id: "same-id", available: true }],
            teamConnections: [{ id: "same-id", available: false }],
        });

        expect(resolveTeamAuthenticationPolicyActivationReadiness(
            resolution,
            [{ kind: "home_method", methodId: "same-id" }],
        )).toBe("unavailable");
    });
});
