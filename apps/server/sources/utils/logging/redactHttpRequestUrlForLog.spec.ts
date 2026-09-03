import { describe, expect, it } from 'vitest';

import { redactHttpRequestUrlForLog } from './redactHttpRequestUrlForLog';

describe('redactHttpRequestUrlForLog', () => {
    it('removes OAuth code and state query material universally and preserves the pathname', () => {
        const code = 'SENTINEL_OAUTH_CODE';
        const state = 'SENTINEL_OAUTH_STATE';
        const redacted = redactHttpRequestUrlForLog(
            `/v1/auth/external/github/callback?code=${code}&state=${state}`,
        );

        expect(redacted).toBe('/v1/auth/external/github/callback');
        expect(redacted).not.toContain(code);
        expect(redacted).not.toContain(state);
    });

    it('removes query and fragment material from absolute URLs', () => {
        const code = 'SENTINEL_OAUTH_CODE';
        const state = 'SENTINEL_OAUTH_STATE';
        const redacted = redactHttpRequestUrlForLog(
            `https://server.example.test/v1/auth/external/oidc/callback?code=${code}&state=${state}#fragment`,
        );

        expect(redacted).toBe('https://server.example.test/v1/auth/external/oidc/callback');
        expect(redacted).not.toContain(code);
        expect(redacted).not.toContain(state);
    });

    it('composes with the sensitive path-capability redactor and drops the query', () => {
        const capability = 'SENTINEL_PUBLIC_SHARE_CAPABILITY';
        const redacted = redactHttpRequestUrlForLog(`/v1/public-share/${capability}/messages?consent=true`);

        expect(redacted).toBe('/v1/public-share/:token/messages');
        expect(redacted).not.toContain(capability);
    });

    it('templates a browser Artifact capability and drops its correlation query', () => {
        const capability = 'SENTINEL_BROWSER_ARTIFACT_CAPABILITY';
        const correlation = 'SENTINEL_BROWSER_ARTIFACT_CORRELATION';
        const redacted = redactHttpRequestUrlForLog(
            `/v1/plugins/availability/ui-artifacts/browser/${capability}/assets/app.js?correlation=${correlation}`,
        );

        expect(redacted).toBe('/v1/plugins/availability/ui-artifacts/browser/:token/assets/app.js');
        expect(redacted).not.toContain(capability);
        expect(redacted).not.toContain(correlation);
    });

    it('preserves plain pathnames, star-request targets, and empty URLs unchanged', () => {
        expect(redactHttpRequestUrlForLog('/health')).toBe('/health');
        expect(redactHttpRequestUrlForLog('/v1/sessions/session-1/public-share')).toBe(
            '/v1/sessions/session-1/public-share',
        );
        expect(redactHttpRequestUrlForLog('*')).toBe('*');
        expect(redactHttpRequestUrlForLog('')).toBe('');
    });
});
