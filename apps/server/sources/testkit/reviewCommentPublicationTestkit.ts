import { randomBytes } from "node:crypto";
import {
    buildReviewCommentPublicationTransportRequestV1,
    openReviewCommentPublicationTransportResponseV1,
    type ReviewCommentClaimPublicationDispatchRequestV1,
    type ReviewCommentPublicationCryptoContextV1,
} from "@happier-dev/protocol";
import type { ReviewCommentOperations, ReviewCommentMutationOperationParams } from "@/app/reviews/comments/operations";

/** Exercises the real client codec and server owner without mocking either. */
export async function claimReviewCommentPublication(
    operations: ReviewCommentOperations,
    params: ReviewCommentMutationOperationParams<ReviewCommentClaimPublicationDispatchRequestV1>,
    context: ReviewCommentPublicationCryptoContextV1 = { accountId: params.accountId, mode: "plain", material: null },
) {
    const input = buildReviewCommentPublicationTransportRequestV1({ input: params.input, context, randomBytes });
    const response = await operations.claimPublicationDispatch({ ...params, input });
    return openReviewCommentPublicationTransportResponseV1({ plan: params.input, context, response });
}
