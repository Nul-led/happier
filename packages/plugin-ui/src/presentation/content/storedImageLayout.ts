export type HappierStoredImageDimensions = Readonly<{ width: number; height: number }>;
function readPositiveDimension(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : null;
}
export function resolveHappierStoredImageDimensions(value: Readonly<{ width?: number; height?: number }> | null): HappierStoredImageDimensions | null {
  const width = readPositiveDimension(value?.width);
  const height = readPositiveDimension(value?.height);
  return width && height ? { width, height } : null;
}
/** The incumbent Session image thumbnail geometry, shared by core and plugins. */
export function resolveHappierStoredImageLayout(input: Readonly<{
  persistedDimensions?: Readonly<{ width?: number; height?: number }> | null;
  loadedDimensions?: Readonly<{ width?: number; height?: number }> | null;
}>): HappierStoredImageDimensions {
  const dimensions = resolveHappierStoredImageDimensions(input.persistedDimensions ?? null)
    ?? resolveHappierStoredImageDimensions(input.loadedDimensions ?? null);
  if (!dimensions) return { width: 84, height: 84 };
  const scale = Math.min(220 / dimensions.width, 160 / dimensions.height);
  return { width: Math.max(1, Math.round(dimensions.width * scale)), height: Math.max(1, Math.round(dimensions.height * scale)) };
}
