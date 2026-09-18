import { Context } from "@/context";
import { buildUserProfile, describeIdentityPresentation, toSocialIdentities, UserProfile } from "./type";
import { db } from "@/storage/db";
import { RelationshipStatus } from "@/storage/prisma";

export async function friendList(ctx: Context): Promise<UserProfile[]> {
    // Query all relationships where current user is fromUserId with friend, pending, or requested status
    const relationships = await db.userRelationship.findMany({
        where: {
            fromUserId: ctx.uid,
            status: {
                in: [RelationshipStatus.friend, RelationshipStatus.pending, RelationshipStatus.requested]
            }
        },
        include: {
            toUser: {
                include: {
                    AccountIdentity: {
                        select: { provider: true, providerLogin: true, profile: true, showOnProfile: true },
                        orderBy: { provider: "asc" },
                    },
                }
            }
        }
    });

    // Build UserProfile objects
    const identitiesByRelationship = relationships.map((relationship) =>
        toSocialIdentities(relationship.toUser.AccountIdentity));
    // One provider presentation load for the whole list.
    const presentation = await describeIdentityPresentation(identitiesByRelationship.flat());

    const profiles: UserProfile[] = [];
    for (const [index, relationship] of relationships.entries()) {
        profiles.push(buildUserProfile(
            relationship.toUser as any,
            relationship.status,
            identitiesByRelationship[index]!,
            presentation,
        ));
    }

    return profiles;
}
