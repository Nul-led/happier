# Session collaboration: access, key delivery, personal state

One Session can be readable by its owner, by Accounts it was shared with directly, and by the
members of Teams and flat Groups it was granted to. This page is the contributor's map of who
decides what across that surface, because the decisions look adjacent but are deliberately
separate: **who may do something** is Session access, **whether they can decrypt it** is key
delivery, **whether it is personally relevant** is the personal-state owner, and **what the
Session is doing right now** is the awareness projector.

See also [Team lifecycle, policy, and branding](teams.md),
[Team membership, flat Groups, and Session-history horizons](teams-membership-and-groups.md),
[Encryption and data encoding](encryption.md) for the recipient-envelope tuple,
[Protocol](protocol.md) for the awareness projection and its wire selectors, and
[Compatibility](compatibility.md) for the released owner/direct seam.

> **Status (0.3 development source).** Team and Group grants, responsibility, discussions,
> Follow and the shared read-state owner are implemented behind the `sessions.collaboration`,
> `sessions.conversations` and `sessions.following` feature ids, which are per-Home capability
> boundaries enabled by default (see [feature-gating.md](feature-gating.md)). Released direct
> sharing is independent of all three. Source presence is not release availability.

## Canonical owners

| Decision or fact | Owner |
|---|---|
| Effective access for one `(Account, Session)` | `apps/server/sources/app/session/access/sessionAccess.ts` |
| Capability rules, level order, delegation-gain rule | `packages/protocol/src/sessions/access/sessionEffectiveAccessV1.ts` |
| Access role classification for a projection | `readSessionAccessProjectionRoleV1` in the same Protocol module |
| Grant mutation, subject resolution, transition effects | `apps/server/sources/app/session/access/sessionAccessGrantService.ts` |
| Complete current structural recipients of a Session | `apps/server/sources/app/session/access/sessionRecipients.ts` |
| Team authentication qualification for a Session operation | `apps/server/sources/app/session/access/sessionAccessAuthentication.ts` |
| Recipient data-key envelope tuple and its pages | `apps/server/sources/app/session/encryption/sessionDataKeyEnvelopeService.ts`, `.../sessionDataKeyEnvelopePersistence.ts` |
| Recipient content-key readiness projection | `apps/server/sources/app/session/encryption/sessionDataKeyRecipientProjection.ts` |
| Envelope wire shapes and summary-bucket precedence | `packages/protocol/src/sessions/encryption/sessionDataKeyEnvelopes.ts` |
| Durable viewer read state and its cursor operations | `apps/server/sources/app/session/personal/readState.ts` |
| Follow relations, auto-follow preferences, Follow entry | `apps/server/sources/app/session/follow/accountFollowService.ts` |
| Operational awareness projection | `packages/protocol/src/sessions/awareness/projectV1.ts` |
| Discussion mutations, including Agent provenance | `apps/server/sources/app/session/discussions/mutations.ts` |

## One access decision, two presentations

`projectEffectiveSessionAccess` in `sessionAccess.ts` is the only place that turns a loaded
Session row into an access answer. It collects the applicable grants — the caller's direct
`SessionShare` rows, then the Team and Group grants whose membership is currently active and
whose `effectiveAt` is after that member's history horizon — and projects them through the
Protocol's `projectSessionAccessCapabilitiesV1`. Capabilities are resolved per grant, never by
combining grants: an Admin grant and a delegated Edit grant do not add up to delegated Admin,
because each capability must be supported by one qualifying grant on its own.

The wire shape is `SessionEffectiveAccessV1`, marked `v: 1`, carrying the resolved `level`
(`view` → `edit` → `admin` → `owner`), the decisive `sources`, the full `capabilities` record,
an optional `audienceContext`, and an optional `primaryTeamId`. Three of those are frequently
misread:

- `sources` is the *decisive* set, not the complete audience. The projector records the highest
  grant, plus the grant that supplied permission delegation, plus a Team grant that is required
  by Team policy — enough to explain the answer, not to enumerate the sharing topology.
- `audienceContext` is one safe display identity. It is never an authorization input.
- `primaryTeamId` is authored organizational context. It may name a Team that has nothing to do
  with the decisive grant, and it never establishes a grant or an audience match.

`resolveSessionAccessForOperation` is the single composition point for a protected operation. It
keeps structural entitlement and Team authentication separate until that point, so an
owner-or-direct path can never be suppressed by a failing Team-derived path, and it carries the
`accessMode` selector: `legacy_owner_or_direct` leaves Team and Group grants out of the answer
for a released reader while every other rule — runtime-principal currentness, Account status,
transcript shareability, capability — stays in the same owner. The two seam projections are two
presentations of one decision, never two admissions.

A verified Session-scoped Runner principal is admitted here too, as a capped `edit` recipient
with empty `sources` and no owner metadata: its authority is credential-derived, not a persisted
sharing relationship, and `verifyCurrentMaterializedRunnerPrincipalInTx` revalidates the
persisted activation, Machine and AccessKey binding on every sensitive operation rather than
trusting the socket admission that proved the signed bearer once. The Machine-RPC half of that
principal is in [peer-mediation.md](peer-mediation.md).

For clients, `readSessionAccessProjectionRoleV1` is the one normalizer that turns a Session
record into `owner` / `recipient` / `unavailable`. A present-but-malformed `effectiveAccess`
resolves `unavailable` and must not fall back to released owner/direct inference; only true
absence permits the released `share` translation.

## Grants: direct-only `SessionShare`, plus Team and Group grants

`SessionShare` is the **direct** grant table and nothing else. One row is one
`(Session, recipient Account)` pair carrying `accessLevel` and `canApprovePermissions`; it is the
shape the released direct-sharing routes still read and write
(`packages/protocol/src/sessions/access/releasedDirectSessionShareV1.ts`).

Team and Group grants are separate tables — `SessionTeamGrant` and `SessionGroupGrant` — and they
deliberately do not copy membership. The grant row is durable and membership is evaluated live,
so removing a member revokes their access without touching the grant. Each row mints
`effectiveAt` once, from the same transaction-scoped database clock that mints membership
horizons, and preserves it across later desired-state replacements, because it is the only fact
that can decide a `from_membership` member's access to Session history. `requiredByTeamPolicy` is
set only by the Team session-policy composition and is never accepted from a client.
`SessionGroupGrant` stores no redundant `teamId`: the Group reaches its Team through its own
relation.

## Key delivery is a separate fact

Access says a recipient may read the Session. It does not say they can open it. For an encrypted
Session, each recipient needs a data-key envelope, and the canonical record is the
`(Session, recipient Account)` tuple behind
`GET`/`PATCH /v2/sessions/:sessionId/data-key/envelopes`.

The tuple carries three facts that are reported separately on the wire: `recipientAccountId`,
`envelopeState` (`prepared` / `missing` / `invalid`, describing stored bytes alone), and
`contentKey` (the recipient's readiness, `available` with the binding or `unavailable` with a
reason). The readiness projection has one owner,
`sessionDataKeyRecipientProjection.ts`, shared by the per-Session collection and the
membership-history page so the reason vocabulary and encodings are not answered twice.

`classifySessionDataKeyEnvelopeItemV1` is the one owner of summary-bucket precedence, and it
makes unavailable readiness exclusive: an inert tuple left behind by an earlier preparation must
not report a Plain or inconsistent Account as `prepared`. Structural validity of stored bytes is
never a claim that the recipient can open them, and a retained tuple after revocation is inert —
it is simply never projected again. The full preparation, repair and page-boundary contract is in
[encryption.md](encryption.md#recipient-key-delivery-development).

## Read state, Follow, and awareness

These three answer different questions and must not be collapsed:

- **Read state** (`AccountSessionReadState`) is the sole durable per-viewer unread owner. Absence
  means quiet; a frontier is clamped to the viewer-visible publication ceiling; a mutation touches
  exactly one Account.
- **Follow** is the durable per-Account choice to track a Session, with its notification and Voice
  preferences and the four auto-follow defaults (`assigned`, `direct`, `team`, `group`).
- **Awareness** is the pure operational projection of what the Session is doing. It is not
  persisted and owns no unread, Follow, attention or notification decision. See
  [protocol.md](protocol.md#session-awareness-development).

**The direct-share rule.** An explicit `mark-read` / `mark-unread` is admitted for *any* active
Account holding `readTranscript` — a direct-share recipient with `view` access included — and
seeds that Account's own read-state row through the single tracking-entry seam
(`beginViewerReadTrackingOnFollowEntryInTx`). It writes no Follow relation: choosing to mark a
Session unread is not choosing to follow it. Automatic tracking keeps the older rule: an
`advance` or a composed acknowledgement without an existing frontier is refused with
`session-not-tracked`, because a composed request must never fabricate a baseline. The tracked
predicate itself is owner-or-active-Follow, resolved through a narrow Follow-fact port, and
cursor presence is deliberately kept out of it.

Auto-follow runs only from new relationship evidence inside the canonical assignment or access
transaction. `applySessionAutoFollowForRelationshipChangeInTx` resolves the whole Account set
through set-oriented owners — preference, existing row, structural `readTranscript`, tracked
predicate — so a bulk Team or directory change never degrades into a per-Account authorization
loop, and a genuinely new follower starts at the then-current ceiling rather than replaying the
interval it was away.

One gap worth knowing about: `packages/protocol/src/sessions/personal/eventEligibility.ts`
classifies a `directly_shared` personal event, and the OS-alert leg deliberately excludes that
kind, but **no producer emits it** in current development source. Treat it as a classifier that is
ready for a producer, not as shipped behavior.

## Discussion provenance

Agent provenance on a discussion message is decided once, at the mutation writer
(`resolveMessageProducer` in `apps/server/sources/app/session/discussions/mutations.ts`), and a
caller never asserts it. The publisher socket supplies the richer run/tool-call form it verified
itself; any other automation-authority post — the public Action over a proof-bound PAT — is
stamped with the default Agent producer for that Session; a present-user post stays a direct human
row with no producer at all. `SessionDiscussionProducerV1` is descriptive display metadata: the
authenticated principal, never that field, is authority, and a producer naming another Session is
rejected as invalid content.

## Not decided here

Team identity, role and policy ([teams.md](teams.md)); membership lifetime and history horizons
([teams-membership-and-groups.md](teams-membership-and-groups.md)); Account encryption mode and
content-key ownership ([encryption.md](encryption.md)); route and transport selection for Machine
RPC ([peer-mediation.md](peer-mediation.md)); and the Action-surface admission floor that decides
which of these operations an Agent or the public API may invoke at all
([actions.md](actions.md)).
