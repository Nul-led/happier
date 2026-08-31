import { describe, expect, it } from 'vitest';

import { resolveHomeTransportPresentation } from './resolveHomeTransportPresentation';

describe('resolveHomeTransportPresentation', () => {
    it('reports a native direct path only when native telemetry says direct', () => {
        expect(resolveHomeTransportPresentation({
            carrier: 'iroh',
            irohObservedPath: 'direct',
            irohRelayPolicy: 'disabled',
        })).toEqual({
            pathLabelKey: 'connectionStatus.transport.direct',
            modeLabelKey: 'connectionStatus.transport.directOnly',
        });
    });

    it('reports secure relay only when native telemetry says relay', () => {
        expect(resolveHomeTransportPresentation({
            carrier: 'iroh',
            irohObservedPath: 'relay',
            irohRelayPolicy: 'automatic',
        })).toEqual({
            pathLabelKey: 'connectionStatus.transport.secureRelay',
            modeLabelKey: 'connectionStatus.transport.automatic',
        });
    });

    it('uses a neutral connected label for an unknown Iroh path', () => {
        expect(resolveHomeTransportPresentation({
            carrier: 'iroh',
            irohObservedPath: 'unknown',
            irohRelayPolicy: 'automatic',
        })).toEqual({
            pathLabelKey: 'status.connected',
            modeLabelKey: 'connectionStatus.transport.automatic',
        });
    });

    it('does not infer Iroh or native availability from a standard connection', () => {
        expect(resolveHomeTransportPresentation({ carrier: 'https' })).toEqual({
            pathLabelKey: 'connectionStatus.transport.standard',
            modeLabelKey: 'connectionStatus.transport.standard',
        });
        expect(resolveHomeTransportPresentation({})).toEqual({
            pathLabelKey: 'connectionStatus.transport.standard',
            modeLabelKey: 'connectionStatus.transport.standard',
        });
    });
});
