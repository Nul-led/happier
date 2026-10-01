import { describe, expect, it } from 'vitest';

import { resolveTranscriptBrowserActionReference } from './transcriptBrowserActionReference';

const view = { browserSessionId: 'browser_session_1', viewId: 'browser_view_1' } as const;

function automationInput(actionKind: string, payload: Record<string, unknown>) {
    return {
        actionId: `browser.automation.${actionKind}`,
        input: {
            v: 1,
            automationRequestId: 'request_1',
            ...view,
            navigationGeneration: 3,
            requestedBy: 'agent',
            requesterRef: { kind: 'session', id: 'session_1' },
            actionKind,
            payload,
            timeoutMs: 10_000,
        },
    };
}

const screenshot = {
    mediaId: 'media_1',
    mediaKind: 'image',
    width: 1280,
    height: 800,
    sizeBytes: 48_000,
    file: {
        sessionId: 'session_1',
        storage: 'session',
        path: '.happier/media/browser/shot-1.png',
        sha256: 'a'.repeat(64),
        mimeType: 'image/png',
    },
} as const;

describe('resolveTranscriptBrowserActionReference', () => {
    it('uses the automation locator grammar for a spaced role body', () => {
        const reference = resolveTranscriptBrowserActionReference({
            toolName: 'mcp__happier__action_execute', state: 'completed',
            input: automationInput('click', { locator: ' role= Button[name="Sign in"] ' }),
            result: null,
        });
        expect(reference?.targetLabel).toBe('Sign in');
    });
    it('reads a browser Action from the generic action tool and names its target by accessible name', () => {
        const reference = resolveTranscriptBrowserActionReference({
            toolName: 'mcp__happier__action_execute',
            state: 'completed',
            input: automationInput('click', { locator: 'role=button[name="Sign in"]' }),
            result: { status: 'succeeded' },
        });
        expect(reference).toMatchObject({
            actionId: 'browser.automation.click',
            verb: 'click',
            targetLabel: 'Sign in',
            view,
        });
    });

    it('never names a target from a CSS selector and never echoes typed values', () => {
        const typed = resolveTranscriptBrowserActionReference({
            toolName: 'mcp__happier__action_execute',
            state: 'completed',
            input: automationInput('type', { selector: '#password > input.secret', text: 'hunter2-super-secret' }),
            result: { status: 'succeeded' },
        });
        expect(typed).toMatchObject({ verb: 'type', targetLabel: null });
        expect(JSON.stringify(typed)).not.toContain('hunter2-super-secret');

        const visibleText = resolveTranscriptBrowserActionReference({
            toolName: 'mcp__happier__action_execute',
            state: 'completed',
            input: automationInput('click', { locator: 'text=Create account' }),
            result: null,
        });
        expect(visibleText?.targetLabel).toBe('Create account');
    });

    it('shows the page it opened without its query or fragment', () => {
        const reference = resolveTranscriptBrowserActionReference({
            toolName: 'mcp__happier__action_execute',
            state: 'completed',
            input: automationInput('navigate', { url: 'http://localhost:5173/login?token=abc#top' }),
            result: null,
        });
        expect(reference).toMatchObject({ verb: 'open', pageLabel: 'localhost:5173/login' });
        expect(JSON.stringify(reference)).not.toContain('token=abc');
    });

    it('carries a stored screenshot only from a completed result, with the store that holds its bytes', () => {
        const base = {
            toolName: 'mcp__happier__action_execute',
            input: { actionId: 'browser.context.captureScreenshot', input: { ...view } },
        } as const;
        const completed = resolveTranscriptBrowserActionReference({
            ...base,
            state: 'completed',
            result: JSON.stringify({ ok: true, result: { item: { screenshot } } }),
        });
        expect(completed).toMatchObject({
            verb: 'screenshot',
            screenshot: { mediaId: 'media_1', sessionId: 'session_1', storage: 'session', path: '.happier/media/browser/shot-1.png' },
        });

        const running = resolveTranscriptBrowserActionReference({ ...base, state: 'running', result: { item: { screenshot } } });
        expect(running?.screenshot).toBeNull();

        // The managed browser's captures are stored by the daemon for the Session (W2B).
        const daemonStored = resolveTranscriptBrowserActionReference({
            ...base,
            state: 'completed',
            result: { item: { screenshot: { ...screenshot, file: { ...screenshot.file, storage: 'daemon' } } } },
        });
        expect(daemonStored?.screenshot).toMatchObject({ mediaId: 'media_1', storage: 'daemon' });

        const unstored = resolveTranscriptBrowserActionReference({
            ...base,
            state: 'completed',
            result: { item: { screenshot: { ...screenshot, file: undefined } } },
        });
        expect(unstored?.screenshot).toBeNull();
    });

    it('offers to watch exact named views so the host can resolve their admitted daemon stream', () => {
        const opened = resolveTranscriptBrowserActionReference({
            toolName: 'mcp__happier__action_execute',
            state: 'completed',
            input: {
                actionId: 'browser.view.open',
                input: {
                    ...view,
                    target: { kind: 'externalUrl', targetId: 'target_1', url: 'https://example.com/docs' },
                },
            },
            result: null,
        });
        expect(opened).toMatchObject({ verb: 'open', pageLabel: 'example.com/docs' });
        expect(opened?.watch).toMatchObject({ ...view, target: { kind: 'externalUrl', url: 'https://example.com/docs' } });

        const clicked = resolveTranscriptBrowserActionReference({
            toolName: 'mcp__happier__action_execute',
            state: 'completed',
            input: automationInput('click', { locator: 'text=Save' }),
            result: null,
        });
        expect(clicked?.watch).toEqual(view);
    });

    it('uses the admitted result view when the Session action input omitted its filled-in identity', () => {
        const reference = resolveTranscriptBrowserActionReference({
            toolName: 'mcp__happier__action_execute', state: 'completed',
            input: { actionId: 'browser.view.open', input: { target: { kind: 'externalUrl', targetId: 'target_1', url: 'https://example.com' } } },
            result: { v: 1, commandId: 'open-command', status: 'dispatched', adapterKind: 'chromiumSidecar', events: [{ kind: 'viewOpened', ...view, occurredAt: 1, eventId: 'open',
                target: { kind: 'externalUrl', targetId: 'target_1', url: 'https://example.com' }, platform: 'web',
                adapterKind: 'chromiumSidecar', engineKind: 'streamedSurface', adapterCapabilities: {
                    adapterKind: 'chromiumSidecar', supportedTargetKinds: ['externalUrl'], supportedRenderEngines: ['streamedSurface'],
                    navigation: {}, diagnosticsFidelityByFamily: {}, contextKinds: [], inputRouting: 'none', supportsStreamingDisplay: true,
                } }] },
        });
        expect(reference?.watch).toMatchObject(view);
    });

    it('ignores other Actions, other MCP servers and look-alike tool names', () => {
        expect(resolveTranscriptBrowserActionReference({
            toolName: 'mcp__happier__action_execute',
            state: 'completed',
            input: { actionId: 'workflow.run.start', input: {} },
            result: null,
        })).toBeNull();
        expect(resolveTranscriptBrowserActionReference({
            toolName: 'mcp__othervendor__action_execute',
            state: 'completed',
            input: automationInput('click', { locator: 'text=Save' }),
            result: null,
        })).toBeNull();
        expect(resolveTranscriptBrowserActionReference({
            toolName: 'mcp__happier__action_execute',
            state: 'completed',
            input: { actionId: 'browser.not.a.real.action', input: {} },
            result: null,
        })).toBeNull();
    });
});
