import { describe, expect, it } from 'vitest';

import { captureHomeExternalAuthTarget } from './homeExternalAuthTarget';

describe('captureHomeExternalAuthTarget', () => {
    it('captures the immutable Home identity and endpoint used to start OAuth', () => {
        expect(captureHomeExternalAuthTarget({
            serverId: '  home-a  ',
            serverUrl: '  https://home-a.example  ',
        })).toEqual({
            serverId: 'home-a',
            serverUrl: 'https://home-a.example',
        });
    });

    it('does not manufacture a target from missing runtime facts', () => {
        expect(captureHomeExternalAuthTarget({
            serverId: ' ',
            serverUrl: null,
        })).toEqual({});
    });
});
