import {
    IrohEndpointDescriptorV1Schema,
    type IrohEndpointDescriptorV1,
} from '@happier-dev/protocol';

export type MachineCarrierHostEligibility =
    | Readonly<{ kind: 'browser' }>
    | Readonly<{ kind: 'native'; lifecycleAvailable: boolean }>;

export type MachineCarrierPreselection =
    | Readonly<{
        kind: 'eligible';
        carrierKind: 'browser_stream' | 'native_http';
        targetEndpoint: IrohEndpointDescriptorV1;
    }>
    | Readonly<{ kind: 'ineligible' }>;

/** Pure host/endpoint eligibility shared by controls and transfer execution. */
export function resolveMachineCarrierPreselection(input: Readonly<{
    targetEndpoint: unknown;
    host: MachineCarrierHostEligibility;
}>): MachineCarrierPreselection {
    const endpoint = IrohEndpointDescriptorV1Schema.safeParse(input.targetEndpoint);
    if (!endpoint.success) {
        return { kind: 'ineligible' };
    }

    if (input.host.kind === 'browser') {
        return (endpoint.data.relayUrls?.length ?? 0) > 0
            ? { kind: 'eligible', carrierKind: 'browser_stream', targetEndpoint: endpoint.data }
            : { kind: 'ineligible' };
    }

    return input.host.lifecycleAvailable
        ? { kind: 'eligible', carrierKind: 'native_http', targetEndpoint: endpoint.data }
        : { kind: 'ineligible' };
}
