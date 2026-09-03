import { describe, expect, it } from 'vitest';

import {
  IrohTestController,
  createIrohTestControllerFromNativeAddon,
  type IrohTestControllerNative,
} from './irohTestController';

function createNativeFixture(): IrohTestControllerNative & {
  calls: string[];
  observedPath: 'direct' | 'relay' | 'unknown';
  relayUrl: string | null;
} {
  return {
    calls: [],
    observedPath: 'unknown',
    relayUrl: null,
    async forceDirectOnly() { this.calls.push('direct'); this.relayUrl = null; },
    async forceRelayOnly() { this.calls.push('relay'); this.relayUrl = 'http://127.0.0.1:4919'; },
    async restoreAutomatic() { this.calls.push('automatic'); this.observedPath = 'unknown'; this.relayUrl = null; },
    getObservedPath() { return this.observedPath; },
    getTestRelayUrl() { return this.relayUrl; },
  };
}

describe('IrohTestController', () => {
  it('delegates async topology changes and reports only the native observed path', async () => {
    const native = createNativeFixture();
    const controller = new IrohTestController(native);
    await controller.forceDirectOnly();
    expect(controller.getObservedPath()).toBe('unknown');
    native.observedPath = 'direct';
    expect(controller.getObservedPath()).toBe('direct');
    await controller.forceRelayOnly();
    native.observedPath = 'relay';
    expect(controller.getObservedPath()).toBe('relay');
    await controller.restoreAutomatic();
    expect(controller.getObservedPath()).toBe('unknown');
    expect(native.calls).toEqual(['direct', 'relay', 'automatic']);
  });

  it('exposes the test relay URL only while forced relay is active', async () => {
    const native = createNativeFixture();
    const controller = new IrohTestController(native);
    expect(controller.getTestRelayUrl()).toBeNull();
    await controller.forceRelayOnly();
    expect(controller.getTestRelayUrl()).toBe('http://127.0.0.1:4919');
    await controller.forceDirectOnly();
    expect(controller.getTestRelayUrl()).toBeNull();
    await controller.forceRelayOnly();
    expect(controller.getTestRelayUrl()).toBe('http://127.0.0.1:4919');
    await controller.restoreAutomatic();
    expect(controller.getTestRelayUrl()).toBeNull();
    expect(native.calls).toEqual(['relay', 'direct', 'relay', 'automatic']);
  });

  it('reports no relay URL without a native test-feature boundary', () => {
    const controller = new IrohTestController(null);
    expect(controller.getTestRelayUrl()).toBeNull();
  });

  it('adapts the raw fixture addon surface including the relay URL read', async () => {
    let relayUrl: string | null = null;
    const controller = createIrohTestControllerFromNativeAddon({
      async forceDirectOnly() { relayUrl = null; return JSON.stringify({ ok: true }); },
      async forceRelayOnly() { relayUrl = 'http://127.0.0.1:4919'; return JSON.stringify({ ok: true }); },
      async restoreAutomatic() { relayUrl = null; return JSON.stringify({ ok: true }); },
      getObservedPath() { return 'unknown'; },
      getTestRelayUrl() { return relayUrl; },
    });
    await controller.forceRelayOnly();
    expect(controller.getTestRelayUrl()).toBe('http://127.0.0.1:4919');
    await controller.restoreAutomatic();
    expect(controller.getTestRelayUrl()).toBeNull();
  });

  it('fails closed when the raw addon lacks the relay URL export', () => {
    expect(() => createIrohTestControllerFromNativeAddon({
      async forceDirectOnly() { return JSON.stringify({ ok: true }); },
      async forceRelayOnly() { return JSON.stringify({ ok: true }); },
      async restoreAutomatic() { return JSON.stringify({ ok: true }); },
      getObservedPath() { return 'unknown'; },
    })).toThrow(/test-relay-fixture/);
  });

  it('fails closed without a native test-feature boundary', async () => {
    const controller = new IrohTestController(null);
    await expect(controller.forceRelayOnly()).rejects.toThrow(/test-relay-fixture/);
    expect(controller.getObservedPath()).toBe('unknown');
    expect(controller.getTestRelayUrl()).toBeNull();
  });
});
