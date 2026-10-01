import type { GithubFeedbackReviewV1 } from '../feedback.js';

/** Latest dated review per author, independent of independently loaded page order. */
export function readLatestGithubReviewsV1(
  historical: readonly GithubFeedbackReviewV1[],
): ReadonlyMap<string, GithubFeedbackReviewV1> {
  const latestByAuthor = new Map<string, GithubFeedbackReviewV1>();
  for (const review of historical) {
    if (review.author === null) continue;
    const previous = latestByAuthor.get(review.author);
    // Missing/equal timestamps keep the first-seen record: they provide no
    // chronology with which to replace an already observed review.
    if (previous === undefined
      || (review.submittedAtMs !== null
        && (previous.submittedAtMs === null || review.submittedAtMs > previous.submittedAtMs))) {
      latestByAuthor.set(review.author, review);
    }
  }
  return latestByAuthor;
}
