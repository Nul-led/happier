import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/storage/db";
import { inTx } from "@/storage/inTx";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { setTeamCredentialAudienceInTx, type TeamCredentialAudienceInput } from "./resourceAudience";

const TEST_AUTHENTICATION = { authenticationAuthority: "present_user", authenticationEvidence: [] } as const;

describe("Team credential audience mutation", () => {
    let harness: LightSqliteHarness;
    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: "happier-resource-audience-", initAuth: false });
    }, 180_000);
    afterAll(async () => { await harness?.close(); });

    async function fixture() {
        const custodian = await db.account.create({ data: { encryptionMode: "plain" } });
        const manager = await db.account.create({ data: { encryptionMode: "plain" } });
        const recipient = await db.account.create({ data: { encryptionMode: "plain" } });
        const team = await db.team.create({ data: { name: "Credential administration" } });
        await db.teamMembership.create({ data: { teamId: team.id, accountId: custodian.id, role: "member" } });
        const managerMembership = await db.teamMembership.create({ data: { teamId: team.id, accountId: manager.id, role: "admin" } });
        const recipientMembership = await db.teamMembership.create({ data: { teamId: team.id, accountId: recipient.id, role: "guest" } });
        const group = await db.teamGroup.create({ data: { teamId: team.id, name: "Developers", nameKey: "developers" } });
        const resource = await db.teamCredentialResource.create({ data: {
            teamId: team.id, custodianAccountId: custodian.id, displayName: "Shared connection",
            disclosureCeiling: "direct_allowed", sessionUsePolicy: "personal_allowed",
            sourceBindingJson: JSON.stringify({ v: 1, kind: "provider_connection", connectionId: "pc_source", connectionSecurityFingerprint: "connection-security:v1:source", credentialSlotId: "apiKey" }),
        } });
        const input: TeamCredentialAudienceInput = {
            resourceId: resource.id, expectedRevision: resource.revision, allMembersDeliveryMode: null,
            groupGrants: [{ teamGroupId: group.id, deliveryMode: "direct" }],
            memberGrants: [{ teamMembershipId: recipientMembership.id, deliveryMode: "direct" }],
        };
        const set = (actorAccountId: string, next = input) => inTx(tx => setTeamCredentialAudienceInTx(tx, { actorAccountId, input: next, authentication: TEST_AUTHENTICATION }));
        return { custodian, manager, team, group, resource, managerMembership, recipientMembership, input, set };
    }

    it("commits one whole audience revision and refuses stale or non-manager writes", async () => {
        const f = await fixture();
        await expect(f.set(f.manager.id)).resolves.toEqual({ ok: true, resourceId: f.resource.id, revision: 1 });
        // The source custodian is allowed to narrow its own audience, so this
        // replay reaches the shared CAS boundary and reports the stale revision.
        await expect(f.set(f.custodian.id)).resolves.toEqual({ ok: false, error: "resource_changed" });
        await expect(f.set(f.manager.id, { ...f.input, allMembersDeliveryMode: "direct", groupGrants: [], memberGrants: [] }))
            .resolves.toEqual({ ok: false, error: "resource_changed" });
        const stored = await db.teamCredentialResource.findUniqueOrThrow({ where: { id: f.resource.id }, include: { groupGrants: true, memberGrants: true } });
        expect(stored).toMatchObject({ revision: 1, allMembersDeliveryMode: null });
        expect(stored.groupGrants).toMatchObject([{ teamGroupId: f.group.id, deliveryMode: "direct" }]);
        expect(stored.memberGrants).toMatchObject([{ teamMembershipId: f.recipientMembership.id, deliveryMode: "direct" }]);
        const events = await db.teamCredentialActivityEvent.findMany({ where: { resourceId: f.resource.id } });
        expect(events).toMatchObject([{
            teamId: f.team.id, actorAccountId: f.manager.id,
            kind: "audience_changed", subjectDisplayName: f.resource.displayName,
        }]);
        const rollback = new Error("abort the composed resource mutation");
        await expect(inTx(async tx => {
            const changed = await setTeamCredentialAudienceInTx(tx, {
                actorAccountId: f.manager.id,
                input: { ...f.input, expectedRevision: 1, groupGrants: [], memberGrants: [] },
                authentication: TEST_AUTHENTICATION,
            });
            expect(changed.ok).toBe(true);
            throw rollback;
        })).rejects.toBe(rollback);
        expect(await db.teamCredentialResource.findUniqueOrThrow({ where: { id: f.resource.id } })).toMatchObject({ revision: 1 });
        expect(await db.teamCredentialActivityEvent.count({ where: { resourceId: f.resource.id } })).toBe(1);
        expect(await db.teamCredentialMemberGrant.count({ where: { resourceId: f.resource.id } })).toBe(1);
        await db.teamMembership.update({ where: { id: f.managerMembership.id }, data: { status: "suspended" } });
        await expect(f.set(f.manager.id, { ...f.input, expectedRevision: 1 })).resolves.toEqual({ ok: false, error: "resource_forbidden" });
    });

    it("lets a departed source custodian only reduce the current audience while a manager may widen it", async () => {
        const f = await fixture();
        await expect(f.set(f.manager.id)).resolves.toEqual({ ok: true, resourceId: f.resource.id, revision: 1 });
        await db.teamMembership.deleteMany({ where: { teamId: f.team.id, accountId: f.custodian.id } });

        await expect(f.set(f.custodian.id, {
            ...f.input,
            expectedRevision: 1,
            memberGrants: [],
        })).resolves.toEqual({ ok: true, resourceId: f.resource.id, revision: 2 });
        expect(await db.teamCredentialResource.findUniqueOrThrow({ where: { id: f.resource.id } }))
            .toMatchObject({ revision: 2, allMembersDeliveryMode: null });
        expect(await db.teamCredentialGroupGrant.count({ where: { resourceId: f.resource.id } })).toBe(1);
        expect(await db.teamCredentialMemberGrant.count({ where: { resourceId: f.resource.id } })).toBe(0);

        await expect(f.set(f.custodian.id, {
            ...f.input,
            expectedRevision: 2,
            allMembersDeliveryMode: "direct",
            memberGrants: [],
        })).resolves.toEqual({ ok: false, error: "resource_forbidden" });
        await expect(f.set(f.manager.id, {
            ...f.input,
            expectedRevision: 2,
            allMembersDeliveryMode: "direct",
            memberGrants: [],
        })).resolves.toEqual({ ok: true, resourceId: f.resource.id, revision: 3 });
    });

    it("zeroizes derived recipient material when the audience is replaced", async () => {
        const f = await fixture();
        await expect(f.set(f.manager.id)).resolves.toEqual({ ok: true, resourceId: f.resource.id, revision: 1 });
        await db.teamCredentialResource.update({
            where: { id: f.resource.id },
            data: { directSourceVersionsJson: JSON.stringify({ "member-1": "source-version-1" }) },
        });
        await db.teamCredentialRecipientMaterial.create({ data: {
            resourceId: f.resource.id,
            recipientAccountId: f.recipientMembership.accountId,
            sourceMemberKey: "member-1",
            sourceVersion: "source-version-1",
            recipientMode: "plain",
            storedMaterial: new Uint8Array([1, 2, 3]),
        } });

        await expect(f.set(f.manager.id, {
            ...f.input,
            expectedRevision: 1,
            groupGrants: [],
            memberGrants: [],
        })).resolves.toEqual({ ok: true, resourceId: f.resource.id, revision: 2 });

        expect(await db.teamCredentialRecipientMaterial.count({ where: { resourceId: f.resource.id } })).toBe(0);
        expect(await db.teamCredentialResource.findUniqueOrThrow({ where: { id: f.resource.id } }))
            .toMatchObject({ directSourceVersionsJson: null });
    });

    it("saves a broker audience on a compatible offline persistent custodian Machine", async () => {
        const f = await fixture();
        const machine = await db.machine.create({ data: {
            id: `broker-${f.custodian.id}`,
            accountId: f.custodian.id,
            metadata: "{}",
            kind: "persistent",
            active: false,
            operationProtocolCapabilities: { providerBrokerIngress: { protocolVersions: [1] } },
            operationProtocolCapabilitiesRevision: 1,
        } });
        await db.teamCredentialResource.update({ where: { id: f.resource.id }, data: { brokerMachineId: machine.id } });

        await expect(f.set(f.manager.id, {
            ...f.input, allMembersDeliveryMode: "brokered", groupGrants: [], memberGrants: [],
        })).resolves.toEqual({ ok: true, resourceId: f.resource.id, revision: 1 });
        expect(await db.teamCredentialResource.findUniqueOrThrow({ where: { id: f.resource.id } }))
            .toMatchObject({ brokerMachineId: machine.id, allMembersDeliveryMode: "brokered", revision: 1 });
    });

    it("rejects foreign audiences and source-ceiling escalation without changing prior grants", async () => {
        const f = await fixture();
        const other = await db.team.create({ data: { name: "Other Team" } });
        const foreign = await db.teamGroup.create({ data: { teamId: other.id, name: "Foreign", nameKey: "foreign" } });
        await expect(f.set(f.manager.id, { ...f.input, groupGrants: [{ teamGroupId: foreign.id, deliveryMode: "direct" }] }))
            .resolves.toEqual({ ok: false, error: "invalid_audience" });
        await db.teamCredentialResource.update({ where: { id: f.resource.id }, data: { disclosureCeiling: "brokered_only" } });
        await expect(f.set(f.manager.id)).resolves.toEqual({ ok: false, error: "disclosure_not_allowed" });
        expect(await db.teamCredentialResource.findUniqueOrThrow({ where: { id: f.resource.id } })).toMatchObject({ revision: 0 });
        expect(await db.teamCredentialGroupGrant.count({ where: { resourceId: f.resource.id } })).toBe(0);
        expect(await db.teamCredentialMemberGrant.count({ where: { resourceId: f.resource.id } })).toBe(0);
    });
});
