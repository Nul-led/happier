import { describe, expect, it } from 'vitest';

import { readCanonicalPluginManifest } from '@/plugins/manifest/normalize';
import { createPluginManifestV2Fixture } from '@/plugins/testkit/manifestV2Fixture';

import { hasReviewSensitivePluginUpdate } from './updateReviewPolicy';

function manifestWithRenderer(
  renderer: Readonly<Record<string, unknown>>,
  version = '1.0.0',
) {
  const parsed = readCanonicalPluginManifest(createPluginManifestV2Fixture({
    id: 'acme.ui-realms',
    version,
    contributes: {
      ui: {
        renderers: [{ ...renderer }],
      },
    },
  }));
  if (!parsed) throw new Error('Expected canonical UI renderer manifest');
  return parsed;
}

const DECLARATIVE_PANEL = Object.freeze({
  id: 'panel',
  kind: 'declarative',
  root: { kind: 'text', text: 'Panel' },
});
const HOSTED_WEB_PANEL = Object.freeze({
  id: 'panel',
  kind: 'hostedWeb',
  source: { kind: 'artifact', artifact: 'panel-web' },
});
const REACT_NATIVE_PANEL = Object.freeze({
  id: 'panel',
  kind: 'reactNative',
  artifact: 'panel-native',
});

describe('hasReviewSensitivePluginUpdate executable realm expansion', () => {
  it('requires review when a retained renderer id expands from declarative to hosted-web execution', () => {
    expect(hasReviewSensitivePluginUpdate(
      manifestWithRenderer(DECLARATIVE_PANEL),
      manifestWithRenderer(HOSTED_WEB_PANEL, '1.0.1'),
      [],
    )).toBe(true);
  });

  it('requires review when a retained renderer id expands from declarative to React Native execution', () => {
    expect(hasReviewSensitivePluginUpdate(
      manifestWithRenderer(DECLARATIVE_PANEL),
      manifestWithRenderer(REACT_NATIVE_PANEL, '1.0.1'),
      [],
    )).toBe(true);
  });

  it('does not reopen review when hosted-web execution is unchanged', () => {
    expect(hasReviewSensitivePluginUpdate(
      manifestWithRenderer(HOSTED_WEB_PANEL),
      manifestWithRenderer(HOSTED_WEB_PANEL, '1.0.1'),
      [],
    )).toBe(false);
  });

  it('does not reopen review when declarative presentation changes without execution', () => {
    expect(hasReviewSensitivePluginUpdate(
      manifestWithRenderer(DECLARATIVE_PANEL),
      manifestWithRenderer(
        { ...DECLARATIVE_PANEL, root: { kind: 'text', text: 'Panel v2' } },
        '1.0.1',
      ),
      [],
    )).toBe(false);
  });

  it('does not reopen review when executable UI execution contracts back to declarative', () => {
    expect(hasReviewSensitivePluginUpdate(
      manifestWithRenderer(HOSTED_WEB_PANEL),
      manifestWithRenderer(DECLARATIVE_PANEL, '1.0.1'),
      [],
    )).toBe(false);
  });
});
