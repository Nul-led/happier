import { describe, expect, it } from 'vitest';
import { IrohTestController, type IrohTestControllerNative } from './irohTestController';

function createNativeFixture(): IrohTestControllerNative & { calls: string[]; observedPath: 'direct' | 'relay' | 'unknown' } {
  return {
    calls: [],
    observedPath: 'unknown',
    async forceDirectOnly() { this.calls.push('direct'); },
    async forceRelayOnly() { this.calls.push('relay'); },
    async restoreAutomatic() { this.calls.push('automatic'); this.observedPath = 'unknown'; },
    getObservedPath() { return this.observedPath; },
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

  it('fails closed without a native test-feature boundary', async () => {
    const controller = new IrohTestController(null);
    await expect(controller.forceRelayOnly()).rejects.toThrow(/test-relay-fixture/);
    expect(controller.getObservedPath()).toBe('unknown');
  });
});
