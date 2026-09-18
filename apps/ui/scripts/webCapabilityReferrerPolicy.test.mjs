import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const templateUrl = new URL('../public/index.html', import.meta.url);

test('the standalone web document never sends capability URLs as referrers', async () => {
    const html = await readFile(templateUrl, 'utf8');

    const referrerPolicy = html.match(
        /<meta\s+name=["']referrer["']\s+content=["']no-referrer["']\s*\/>/i,
    );
    assert.ok(referrerPolicy?.index !== undefined, 'missing document-level no-referrer policy');

    const firstSubresourceIndex = html.search(/<(?:link|script|img)\b/i);
    assert.ok(
        firstSubresourceIndex === -1 || referrerPolicy.index < firstSubresourceIndex,
        'the referrer policy must precede every initial subresource request',
    );
});
