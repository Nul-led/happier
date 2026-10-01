import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HappierSession } from './index.js';

// Only transferable browser transport is substituted; the host mount stays real.
class Port {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  postMessage() {}
  start() {}
  close() {}
}
const channels: { port1: Port; port2: Port }[] = [];
beforeEach(() => {
  channels.length = 0;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('MessageChannel', class { port1 = new Port(); port2 = new Port(); constructor() { channels.push(this); } });
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

it('StrictMode double mount retains one iframe and prop changes reuse it', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const getCredential = vi.fn(async () => ({ token: 'hap_v1_test', expiresAt: '2030-01-01T00:00:00.000Z' }));
  await act(async () => { root.render(<StrictMode><HappierSession happierUrl="https://app.happier.dev" sessionId="A" getCredential={getCredential} /></StrictMode>); });
  expect(container.querySelectorAll('iframe')).toHaveLength(1);
  const frame = container.querySelector('iframe');
  await act(async () => { root.render(<StrictMode><HappierSession happierUrl="https://app.happier.dev" sessionId="B" getCredential={getCredential} title="Lead B" /></StrictMode>); });
  expect(container.querySelector('iframe')).toBe(frame);
  expect(frame?.title).toBe('Lead B');
  await act(async () => { root.render(<StrictMode><HappierSession happierUrl="https://other.happier.dev" sessionId="X" getCredential={getCredential} /></StrictMode>); });
  expect(new URL(container.querySelector('iframe')!.src).pathname).toBe('/embed/session/X');
  await act(async () => { root.unmount(); });
  expect(container.querySelector('iframe')).toBeNull();
});

it('remounts the adopted new-chat session without letting a later creation replace an explicit target', async () => {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const getCredential = vi.fn(async () => ({ token: 'hap_v1_test', expiresAt: '2030-01-01T00:00:00.000Z' }));
  const onSessionCreated = vi.fn();
  await act(async () => { root.render(<HappierSession happierUrl="https://app.happier.dev" getCredential={getCredential} onSessionCreated={onSessionCreated} />); });
  const frame = container.querySelector('iframe')!;
  vi.spyOn(frame.contentWindow!, 'postMessage');
  const url = new URL(frame.src);
  const identity = { instanceId: url.searchParams.get('i')!, mountNonce: url.searchParams.get('n')! };
  await act(async () => { window.dispatchEvent(new MessageEvent('message', { origin: url.origin, source: frame.contentWindow, data: { kind: 'ready', bridgeVersion: 1, identity, embedPublicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } })); });
  await act(async () => { channels[0].port1.onmessage?.({ data: { version: 1, identity, sequence: 1, payload: { kind: 'state', sessionId: 'N', phase: 'ready' } } }); });
  await act(async () => { root.render(<HappierSession happierUrl="https://other.happier.dev" getCredential={getCredential} onSessionCreated={onSessionCreated} />); });
  expect(new URL(container.querySelector('iframe')!.src).pathname).toBe('/embed/session/N');
  await act(async () => { root.render(<HappierSession happierUrl="https://other.happier.dev" sessionId="X" getCredential={getCredential} onSessionCreated={onSessionCreated} />); });
  const nextFrame = container.querySelector('iframe')!;
  vi.spyOn(nextFrame.contentWindow!, 'postMessage');
  const nextUrl = new URL(nextFrame.src);
  const nextIdentity = { instanceId: nextUrl.searchParams.get('i')!, mountNonce: nextUrl.searchParams.get('n')! };
  await act(async () => { window.dispatchEvent(new MessageEvent('message', { origin: nextUrl.origin, source: nextFrame.contentWindow, data: { kind: 'ready', bridgeVersion: 1, identity: nextIdentity, embedPublicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } })); });
  await act(async () => { channels[1].port1.onmessage?.({ data: { version: 1, identity: nextIdentity, sequence: 1, payload: { kind: 'session.created', sessionId: 'Late' } } }); });
  expect(onSessionCreated).toHaveBeenCalledExactlyOnceWith({ sessionId: 'Late' });
  await act(async () => { root.render(<HappierSession happierUrl="https://third.happier.dev" sessionId="X" getCredential={getCredential} onSessionCreated={onSessionCreated} />); });
  expect(new URL(container.querySelector('iframe')!.src).pathname).toBe('/embed/session/X');
  await act(async () => { root.unmount(); });
});
