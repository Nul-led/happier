export type HappierListDetailLayoutState =
  | Readonly<{ mode: 'split'; listRatio: number }>
  | Readonly<{ mode: 'stacked' }>;

/** Pane minima and the ratio preference belong to the content's owner. */
export function resolveHappierListDetailGeometry(input: Readonly<{
  availableWidth: number;
  minListWidth: number;
  minDetailWidth: number;
  preferredListRatio: number;
  gap: number;
}>): HappierListDetailLayoutState {
  const paneWidth = input.availableWidth - input.gap;
  if (!Number.isFinite(paneWidth) || paneWidth <= 0
    || paneWidth < input.minListWidth + input.minDetailWidth) {
    return { mode: 'stacked' };
  }

  return {
    mode: 'split',
    listRatio: Math.min(
      Math.max(input.preferredListRatio, input.minListWidth / paneWidth),
      1 - input.minDetailWidth / paneWidth,
    ),
  };
}
