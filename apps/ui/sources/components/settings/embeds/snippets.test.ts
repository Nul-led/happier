import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { buildEmbedSnippetsV1, type EmbedSnippetsInput } from './snippets';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');

const baseInput: EmbedSnippetsInput = {
    happierUrl: 'https://app.happier.dev',
    serverUrl: 'https://api.happier.dev',
    hasListingOrganization: true,
    organizationLabel: 'folder Leads · tag inbound',
    createAllowed: true,
    newChat: true,
};

// The host's own framework, which the snippets use but do not define.
const HOST_PRELUDE = `
declare const process: { env: Record<string, string | undefined> };
type HostRequest = { body: { sessionId?: string; embedPublicKey: string; reason: 'initial' | 'expiring' | 'rejected' | 'open' | 'created'; createdByTokenId?: string }; user: { id: string } };
type HostResponse = { json(value: unknown): void; sendStatus(code: number): void };
declare const app: { post(path: string, ...handlers: Array<(req: HostRequest, res: HostResponse, next?: () => void) => unknown>): void };
declare const requireSignedInUser: (req: HostRequest, res: HostResponse, next?: () => void) => void;
export {};
`;

/** Compiles one snippet against the real SDK and embed sources; returns the diagnostic messages. */
function compile(fileName: string, source: string): string[] {
    const files = new Map<string, string>([[path.join(REPO_ROOT, '.snippet-check', fileName), `${HOST_PRELUDE}\n${source}`]]);
    const options: ts.CompilerOptions = {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        jsx: ts.JsxEmit.ReactJSX,
        lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
        baseUrl: REPO_ROOT,
        paths: {
            '@happier-dev/sdk': ['packages/sdk/src/index.public.ts'],
            '@happier-dev/embed/react': ['packages/embed/src/react/index.tsx'],
            // React's types are installed for the UI workspace, not at the repository root.
            react: ['apps/ui/node_modules/@types/react/index.d.ts'],
            'react/jsx-runtime': ['apps/ui/node_modules/@types/react/jsx-runtime.d.ts'],
        },
    };
    const host = ts.createCompilerHost(options);
    const readFile = host.readFile.bind(host);
    const fileExists = host.fileExists.bind(host);
    host.readFile = (name) => files.get(name) ?? readFile(name);
    host.fileExists = (name) => files.has(name) || fileExists(name);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion) => {
        const text = files.get(name);
        return text !== undefined ? ts.createSourceFile(name, text, languageVersion, true) : getSourceFile(name, languageVersion);
    };
    const program = ts.createProgram([...files.keys()], options, host);
    const [snippetFile] = [...files.keys()];
    return ts.getPreEmitDiagnostics(program, program.getSourceFile(snippetFile!))
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

describe('embed snippets', () => {
    it.each([400, 403, 503])('projects HTTP %s from the generated credential callback without parsing a failed response', async (status) => {
        let getCredential!: (request: unknown) => Promise<unknown>;
        const source = buildEmbedSnippetsV1(baseInput).scriptTag
            .replace(/<\/?script[^>]*>/g, '').replace(/<div[^>]*><\/div>/, '').replace(/^\s*import .*$/m, '');
        const failedResponse = new Response('Access refused', { status });
        new Function('mountHappierSession', 'document', 'fetch', source)(
            (_container: unknown, options: { getCredential: typeof getCredential }) => { getCredential = options.getCredential; },
            { getElementById: () => ({}) }, async () => failedResponse,
        );
        await expect(getCredential({ reason: 'created' })).rejects.toMatchObject({
            code: status === 400 || status === 403 ? 'credential_rejected' : 'credential_unavailable',
        });
        expect(failedResponse.bodyUsed).toBe(false);
    });
    it('authorizes retry of a verified creation exchange and hands renewal to host ownership', async () => {
        let handler!: (req: { body: Record<string, unknown>; user: { id: string } }, res: { json(value: unknown): void; sendStatus(code: number): void }) => Promise<void>;
        const owned = new Set<string>();
        const mintInputs: { sessionId?: string; requireCreatedBy?: string }[] = [];
        const sdk = { embed: { createCredential: async (input: { sessionId?: string; requireCreatedBy?: string }) => {
            mintInputs.push(input);
            return { token: 'child', tokenId: 'creator', expiresAt: new Date(Date.now() + 900_000).toISOString() };
        } } };
        const source = ts.transpileModule(buildEmbedSnippetsV1(baseInput).backend.replace(/^import .*$/m, '').replaceAll('export ', ''), {
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText;
        new Function('connect', 'app', 'requireSignedInUser', 'canOpenSession', 'saveCreatedSession', 'process', source)(
            () => sdk, { post: (_path: string, _auth: unknown, callback: typeof handler) => { handler = callback; } }, () => {},
            async (_user: string, id: string) => owned.has(id), async (_user: string, id: string) => { owned.add(id); }, { env: { HAPPIER_EMBED_KEY: 'key' } });
        const responses: unknown[] = [];
        const res = { json: (value: unknown) => { responses.push(value); }, sendStatus: (code: number) => { responses.push(code); } };
        await handler({ body: { embedPublicKey: 'public' }, user: { id: 'user' } }, res);
        const request = { body: { sessionId: 'new', reason: 'created', createdByTokenId: 'creator', embedPublicKey: 'public' }, user: { id: 'user' } };
        await handler(request, res);
        await handler(request, res);
        await handler({ body: { sessionId: 'new', reason: 'expiring', embedPublicKey: 'public' }, user: { id: 'user' } }, res);
        expect(responses).toHaveLength(4);
        expect(responses).not.toContain(403);
        expect(owned.has('new')).toBe(true);
        expect(mintInputs.slice(1, 3)).toEqual([expect.objectContaining({ requireCreatedBy: 'creator' }), expect.objectContaining({ requireCreatedBy: 'creator' })]);
        expect(mintInputs[3]).not.toHaveProperty('requireCreatedBy');
        await handler({ ...request, user: { id: 'other-user' } }, res);
        expect(responses.at(-1)).toBe(403);
        expect(mintInputs).toHaveLength(4);
    });
    it('lists this embed’s chats only when it has a folder or tag to list by', () => {
        expect(buildEmbedSnippetsV1(baseInput).backend).toContain('happier.embed.listSessions(');
        expect(buildEmbedSnippetsV1({ ...baseInput, hasListingOrganization: false, organizationLabel: null }).backend)
            .not.toContain('listSessions(');
    });

    it('issues new-chat credentials only for an embed that starts new chats', () => {
        expect(buildEmbedSnippetsV1(baseInput).backend).toContain('requireCreatedBy');
        const withoutNewChat = buildEmbedSnippetsV1({ ...baseInput, newChat: false });
        expect(withoutNewChat.backend).not.toContain('requireCreatedBy');
        expect(withoutNewChat.react).not.toContain('onSessionCreated');
        expect(buildEmbedSnippetsV1({ ...baseInput, createAllowed: false }).backend).not.toContain('createSession(');
    });

    it('compiles against the SDK and embed types, and needs the host’s canOpenSession', { timeout: 240_000 }, () => {
        for (const input of [baseInput, { ...baseInput, newChat: false, hasListingOrganization: false, organizationLabel: null }]) {
            const snippets = buildEmbedSnippetsV1(input);
            expect(compile('backend.ts', snippets.backend)).toEqual([]);
            expect(compile('chat.tsx', snippets.react)).toEqual([]);
        }

        const withoutRule = buildEmbedSnippetsV1(baseInput).backend
            .split('\n')
            .filter((line) => !line.includes('declare function canOpenSession'))
            .join('\n');
        expect(compile('backend.ts', withoutRule).some((message) => message.includes('canOpenSession'))).toBe(true);
    });
});
