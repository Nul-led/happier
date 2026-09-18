import { db } from "@/storage/db";
import type { Tx } from "@/storage/inTx";

/**
 * Check if two users are friends
 *
 * @param userId1 - First user ID
 * @param userId2 - Second user ID
 * @returns True if users are friends
 */
export async function areFriends(
    userId1: string,
    userId2: string,
    reader: Pick<Tx, "userRelationship"> = db,
): Promise<boolean> {
    const relationship = await reader.userRelationship.findFirst({
        where: {
            OR: [
                { fromUserId: userId1, toUserId: userId2, status: 'friend' },
                { fromUserId: userId2, toUserId: userId1, status: 'friend' }
            ]
        }
    });
    return relationship !== null;
}
