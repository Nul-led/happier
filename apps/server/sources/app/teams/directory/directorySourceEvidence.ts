/**
 * Bounded external directory evidence for Lane 03 source readers (Teams Lane 03
 * child 05 §7 internal source/reconciler seam).
 *
 * These are the only shapes directory readers hand upward: stable external IDs
 * carry identity; emails, logins, and display names are presentation/review
 * hints and never authority. This seam is private to `apps/server` and is
 * never published through `packages/plugin-sdk`.
 */

export type DirectoryPerson = Readonly<{
    externalUserId: string;
    externalSubjectId?: string;
    email?: string;
    displayName?: string;
    login?: string;
    active: boolean;
    externalUpdatedAt?: Date;
}>;

export type DirectoryGroup = Readonly<{
    externalGroupId: string;
    displayName: string;
    externalUpdatedAt?: Date;
}>;

export type DirectoryGroupMember = Readonly<{
    externalGroupId: string;
    externalUserId: string;
}>;
