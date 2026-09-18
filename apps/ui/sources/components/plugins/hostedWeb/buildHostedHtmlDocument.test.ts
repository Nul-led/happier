import { describe, expect, it } from 'vitest';

import { buildHostedHtmlDocument } from './buildHostedHtmlDocument';

function readCsp(document: string): string {
    return /content="([^"]*)"/u.exec(document)?.[1] ?? '';
}

/**
 * The host owns the shell, its Content-Security-Policy and its bootstrap. A
 * by-value document is authored content: it can neither replace them nor widen
 * its own egress by writing markup.
 */
describe('buildHostedHtmlDocument', () => {
    it('denies every egress by default', () => {
        expect(readCsp(buildHostedHtmlDocument('<p>Hello</p>'))).toContain("connect-src 'none'");
    });

    it('grants connect-src exactly the approved origins, deduplicated and ordered', () => {
        const csp = readCsp(buildHostedHtmlDocument('<p>Hello</p>', undefined, {
            networkOrigins: ['https://b.example.com', 'https://a.example.com', 'https://b.example.com'],
        }));
        expect(csp).toContain('connect-src https://a.example.com https://b.example.com');
        expect(csp).not.toContain("connect-src 'none'");
        // Widening one directive must not widen the rest of the profile.
        expect(csp).toContain("default-src 'none'");
        expect(csp).toContain("frame-src 'none'");
        expect(csp).toContain("form-action 'none'");
        expect(csp).toContain("base-uri 'none'");
    });

    it('refuses an origin the canonical capability grammar would reject', () => {
        for (const origin of [
            'https://*.example.com',
            'http://a.example.com',
            'https://a.example.com/v1',
            "https://a.example.com; default-src *",
        ]) {
            expect(() => buildHostedHtmlDocument('<p>Hello</p>', undefined, { networkOrigins: [origin] }))
                .toThrow();
        }
    });

    it('keeps authored markup out of the policy and bootstrap it cannot replace', () => {
        const document = buildHostedHtmlDocument(
            '<meta http-equiv="Content-Security-Policy" content="default-src *"><p>Hi</p>',
        );
        // The host policy is emitted first, so the authored copy cannot relax it.
        expect(readCsp(document)).toContain("default-src 'none'");
        expect(document.indexOf("default-src 'none'")).toBeLessThan(document.indexOf('default-src *'));
    });

    it('installs the host-owned external-link carrier before authored code', () => {
        const document = buildHostedHtmlDocument('<script>globalThis.authorStarted = true</script>', {
            identity: { instanceId: 'instance-1', mountNonce: 'nonce-1' },
            frameOrigin: 'null',
            hostOrigin: 'https://app.example.test',
        }, { externalHttpLinks: true });
        expect(document).toContain('__HAPPIER_UI_FRAME_EXTERNAL_LINKS_V1__');
        expect(document.indexOf('EXTERNAL_LINKS')).toBeLessThan(document.indexOf('authorStarted'));
    });
});
