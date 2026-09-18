import { describe, expect, it } from 'vitest';
import {
    TEAM_LOGO_MAX_SOURCE_BYTES_V1,
    decodeTeamLogoSourceV1,
} from '@happier-dev/protocol/teams';

import { createTeamLogoSource } from './teamLogoSource';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

describe('createTeamLogoSource', () => {
    it('produces a payload the media boundary decodes back to the exact bytes', () => {
        const result = createTeamLogoSource({ bytes: PNG_BYTES, mimeType: 'image/png' });

        expect(result.status).toBe('ok');
        if (result.status !== 'ok') return;
        // The server's own decoder is the acceptance test: a payload this client
        // builds must survive the boundary that will actually read it.
        const decoded = decodeTeamLogoSourceV1(result.source);
        expect(decoded.status).toBe('ok');
        if (decoded.status !== 'ok') return;
        expect([...decoded.bytes]).toEqual([...PNG_BYTES]);
        expect(decoded.mimeType).toBe('image/png');
    });

    it('accepts a media type that carries parameters or casing from the picker', () => {
        const result = createTeamLogoSource({ bytes: PNG_BYTES, mimeType: 'IMAGE/JPEG; charset=binary' });
        expect(result.status === 'ok' && result.source.mimeType).toBe('image/jpeg');
    });

    it('refuses a format the image processor does not accept', () => {
        expect(createTeamLogoSource({ bytes: PNG_BYTES, mimeType: 'image/heic' }))
            .toEqual({ status: 'invalid', reason: 'unsupported_format' });
        // A picker that reports nothing is not silently assumed to be PNG.
        expect(createTeamLogoSource({ bytes: PNG_BYTES, mimeType: null }))
            .toEqual({ status: 'invalid', reason: 'unsupported_format' });
    });

    it('refuses an oversized image before encoding it', () => {
        const oversized = new Uint8Array(TEAM_LOGO_MAX_SOURCE_BYTES_V1 + 1);
        expect(createTeamLogoSource({ bytes: oversized, mimeType: 'image/png' }))
            .toEqual({ status: 'invalid', reason: 'too_large' });
    });

    it('refuses an empty selection rather than sending a zero-byte logo', () => {
        expect(createTeamLogoSource({ bytes: new Uint8Array(0), mimeType: 'image/png' }))
            .toEqual({ status: 'invalid', reason: 'unsupported_format' });
    });
});
