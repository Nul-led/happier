export type CliCommandPathClaim = Readonly<{
  source: 'static' | 'action' | 'agent' | 'plugin';
  ownerId: string;
  path: readonly string[];
  /** A namespace may contain terminal descendants, but still owns its exact path. */
  allowsDescendants?: boolean;
}>;

export type CliCommandPathConflict = Readonly<{
  left: CliCommandPathClaim;
  right: CliCommandPathClaim;
}>;

function isPathPrefix(prefix: readonly string[], candidate: readonly string[]): boolean {
  return prefix.length <= candidate.length
    && prefix.every((segment, index) => candidate[index] === segment);
}

/**
 * Structural path comparison shared by the composed registry and contributed
 * command projection. It contains no registry state or precedence policy.
 */
export function findCliCommandPathConflicts(
  claims: readonly CliCommandPathClaim[],
): readonly CliCommandPathConflict[] {
  const conflicts: CliCommandPathConflict[] = [];
  for (let leftIndex = 0; leftIndex < claims.length; leftIndex += 1) {
    const left = claims[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < claims.length; rightIndex += 1) {
      const right = claims[rightIndex]!;
      const leftPrefixesRight = isPathPrefix(left.path, right.path);
      const rightPrefixesLeft = isPathPrefix(right.path, left.path);
      if (!leftPrefixesRight && !rightPrefixesLeft) continue;

      const exact = left.path.length === right.path.length;
      if (exact
        || (leftPrefixesRight && !left.allowsDescendants)
        || (rightPrefixesLeft && !right.allowsDescendants)) {
        conflicts.push(Object.freeze({ left, right }));
      }
    }
  }
  return Object.freeze(conflicts);
}
