import {
  BrowserContextAnnotationStructuredBlockV1Schema,
  type BrowserContextAnnotationStructuredBlockV1,
  type BrowserContextItemV1,
} from './v1.js';

/** Shared wire projection; callers retain ownership of grouping and egress admission. */
export function buildBrowserContextAnnotationStructuredBlock(
  group: readonly BrowserContextItemV1[],
): BrowserContextAnnotationStructuredBlockV1 | undefined {
  const annotations = group.filter((item): item is Extract<BrowserContextItemV1, { kind: 'browserAnnotation' }> =>
    item.kind === 'browserAnnotation',
  );
  if (annotations.length === 0) return undefined;
  const representative = annotations[0];
  const media: BrowserContextAnnotationStructuredBlockV1['screenshot']['media'] = [];
  const seen = new Set<string>();
  for (const item of annotations) {
    if (seen.has(item.media.mediaId)) continue;
    seen.add(item.media.mediaId);
    media.push(item.media);
  }
  const firstMedia = media[0];
  const elements: BrowserContextAnnotationStructuredBlockV1['elements'] = [];
  const regions: BrowserContextAnnotationStructuredBlockV1['regions'] = [];
  const strokes: BrowserContextAnnotationStructuredBlockV1['strokes'] = [];
  for (const item of annotations) {
    if (item.target.kind === 'element') {
      elements.push({
        selectorPath: item.target.selectorPath,
        ...(item.target.accessibleName ? { accessibleName: item.target.accessibleName } : {}),
        ...(item.target.rect ? { rect: item.target.rect } : {}),
      });
    } else {
      regions.push({ rect: item.target.rect });
    }
    if (item.stroke) strokes.push(item.stroke);
  }
  return BrowserContextAnnotationStructuredBlockV1Schema.parse({
    v: 1,
    kind: 'browser.annotation.v1',
    annotationId: representative.annotationId,
    sourceViewId: representative.sourceViewId,
    browserSessionId: representative.browserSessionId,
    contextIds: annotations.map((item) => item.contextId),
    elements,
    regions,
    strokes,
    ...(representative.comment ? { comment: representative.comment } : {}),
    screenshot: {
      // Retains the existing V1 projection's schema-owned media bound.
      media: media.slice(0, 8),
      cropRect: { x: 0, y: 0, width: firstMedia.width, height: firstMedia.height },
    },
    ...(representative.pageUrl ? { pageUrl: representative.pageUrl } : {}),
    ...(representative.pageTitle ? { pageTitle: representative.pageTitle } : {}),
  });
}
