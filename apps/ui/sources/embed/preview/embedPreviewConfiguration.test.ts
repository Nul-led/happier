import { describe, expect, it } from 'vitest';

import {
    EMPTY_EMBED_PREVIEW_CONFIGURATION,
    adoptEmbedPreviewConfiguration,
    buildEmbedPreviewConfigureEnvelope,
    buildEmbedPreviewReadyEnvelope,
    isEmbedPreviewReadyEnvelope,
} from './embedPreviewConfiguration';

const identity = { instanceId: 'preview-1', mountNonce: 'nonce-1' };

describe('embed preview configuration', () => {
    it('keeps the applied style and overrides when an identical configure arrives again', () => {
        const first = adoptEmbedPreviewConfiguration(EMPTY_EMBED_PREVIEW_CONFIGURATION, {
            kind: 'configure', ui: { attachments: false }, style: { v: 1, radius: 'round' },
        });
        const again = adoptEmbedPreviewConfiguration(first, {
            kind: 'configure', ui: { attachments: false }, style: { v: 1, radius: 'round' },
        });
        expect(again).toBe(first);

        // Only the part that changed gets a new reference: the style owner re-applies nothing for a UI toggle.
        const toggled = adoptEmbedPreviewConfiguration(first, {
            kind: 'configure', ui: { attachments: true }, style: { v: 1, radius: 'round' },
        });
        expect(toggled.style).toBe(first.style);
        expect(toggled.ui).toEqual({ attachments: true });
    });

    it('sends the host bridge configure envelope and answers only its own preview\'s ready signal', () => {
        const envelope = buildEmbedPreviewConfigureEnvelope({
            identity,
            sequence: 3,
            configuration: { style: { v: 1, density: 'compact' }, ui: { modelPicker: true } },
        });
        expect(envelope).toMatchObject({
            direction: 'hostToFrame', sequence: 3, identity,
            payload: { kind: 'configure', ui: { modelPicker: true }, style: { density: 'compact' } },
        });

        expect(isEmbedPreviewReadyEnvelope(buildEmbedPreviewReadyEnvelope(identity), identity)).toBe(true);
        expect(isEmbedPreviewReadyEnvelope(buildEmbedPreviewReadyEnvelope({ instanceId: 'x', mountNonce: 'y' }), identity)).toBe(false);
        expect(isEmbedPreviewReadyEnvelope({ kind: 'state' }, identity)).toBe(false);
    });
});
