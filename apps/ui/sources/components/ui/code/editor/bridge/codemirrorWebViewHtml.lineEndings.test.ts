// @vitest-environment jsdom
import * as state from '@codemirror/state';
import * as view from '@codemirror/view';
import * as commands from '@codemirror/commands';
import * as language from '@codemirror/language';
import * as autocomplete from '@codemirror/autocomplete';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildCodeMirrorWebViewHtml } from './codemirrorWebViewHtml';

// Load the installed CodeMirror modules through the WebView's embedded-bundle ABI.
vi.mock('./codemirrorWebViewBundle.generated', () => ({ CODEMIRROR_WEBVIEW_BUNDLE_JS: '/* installed modules supplied by test */' }));

type Envelope = { v: number; type: string; payload: { doc?: string; requestId?: string; message?: string } };

function bootBridge() {
    const messages: Envelope[] = [];
    document.body.innerHTML = '<div id="root"></div>';
    vi.stubGlobal('__CM6__', { ...state, ...view, ...commands, ...language, ...autocomplete });
    Object.defineProperty(window, 'ReactNativeWebView', {
        configurable: true,
        value: { postMessage: (raw: string) => messages.push(JSON.parse(raw)) },
    });
    const html = buildCodeMirrorWebViewHtml({
        theme: {
            backgroundColor: '#000', textColor: '#fff', dividerColor: '#333', lineNumberColor: '#777',
            activeLineColor: '#111', selectionColor: '#555', isDark: true,
            syntax: {
                defaultColor: '#fff', keywordColor: '#fff', stringColor: '#fff', commentColor: '#777',
                numberColor: '#fff', functionColor: '#fff',
            },
        },
        wrapLines: true,
        showLineNumbers: true,
        changeDebounceMs: 100,
        maxChunkBytes: 64_000,
    });
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
    if (!script) throw new Error('WebView bridge script missing');
    const documentListeners = vi.spyOn(document, 'addEventListener');
    const windowListeners = vi.spyOn(window, 'addEventListener');
    new Function(script)();
    expect(messages).toEqual([{ v: 1, type: 'ready', payload: { ok: true } }]);
    const send = (type: string, payload: object) => window.dispatchEvent(new MessageEvent('message', {
        data: JSON.stringify({ v: 1, type, payload }),
    }));
    const getView = () => {
        const element = document.querySelector<HTMLElement>('.cm-editor');
        const editor = element ? view.EditorView.findFromDOM(element) : null;
        if (!editor) throw new Error('CodeMirror view missing');
        return editor;
    };
    const cleanup = () => {
        getView().destroy();
        for (const [type, listener] of documentListeners.mock.calls) {
            if (type === 'message') document.removeEventListener(type, listener);
        }
        for (const [type, listener] of windowListeners.mock.calls) {
            if (type === 'message') window.removeEventListener(type, listener);
        }
    };
    return { messages, send, getView, cleanup };
}

describe('native CodeMirror WebView line endings', () => {
    let cleanup: (() => void) | undefined;

    beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
    afterEach(() => {
        cleanup?.();
        cleanup = undefined;
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        Reflect.deleteProperty(window, 'ReactNativeWebView');
    });

    it.each(['\r\n', '\r', '\n'])('preserves %j in snapshots, debounced changes and stale-host flushes', (separator) => {
        const bridge = bootBridge();
        cleanup = bridge.cleanup;
        const initial = `one${separator}two${separator}`;
        bridge.send('init', { doc: initial });
        bridge.send('requestDoc', { requestId: 'initial' });
        expect(bridge.messages.at(-1)).toEqual({ v: 1, type: 'docSnapshot', payload: { requestId: 'initial', doc: initial } });

        const editor = bridge.getView();
        editor.dispatch({ changes: { from: editor.state.doc.length, insert: `three${separator}` } });
        vi.advanceTimersByTime(100);
        const changed = `${initial}three${separator}`;
        expect(bridge.messages.at(-1)).toEqual({ v: 1, type: 'docChanged', payload: { doc: changed } });

        editor.dispatch({ selection: { anchor: 2 } });
        const beforeEcho = editor.state;
        bridge.send('setDoc', { doc: changed });
        expect(editor.state).toBe(beforeEcho);
        expect(editor.state.selection.main.anchor).toBe(2);

        editor.dispatch({ changes: { from: editor.state.doc.length, insert: 'four' } });
        bridge.send('setDoc', { doc: changed });
        expect(bridge.messages.at(-1)).toEqual({ v: 1, type: 'docChanged', payload: { doc: `${changed}four` } });
        bridge.send('requestDoc', { requestId: 'latest' });
        expect(bridge.messages.at(-1)?.payload.doc).toBe(`${changed}four`);
    });

    it('detects the separator again when the host replaces the document', () => {
        const bridge = bootBridge();
        cleanup = bridge.cleanup;
        bridge.send('init', { doc: 'one\r\ntwo\r\n' });
        bridge.send('setDoc', { doc: 'alpha\rbeta\r' });
        bridge.send('requestDoc', { requestId: 'replacement' });
        expect(bridge.messages.at(-1)?.payload.doc).toBe('alpha\rbeta\r');
        const editor = bridge.getView();
        editor.dispatch({ changes: { from: editor.state.doc.length, insert: 'gamma\r' } });
        vi.advanceTimersByTime(100);
        expect(bridge.messages.at(-1)?.payload.doc).toBe('alpha\rbeta\rgamma\r');
    });
});
