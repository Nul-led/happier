export type MachineCarrierTransferFlow = 'file_transfer' | 'attachment_transfer';

export type MachineCarrierTransferRequestKind =
    | 'composer_media_stage_upload_v1'
    | 'session_attachment_upload_v1'
    | 'session_file_upload_v1'
    | 'prompt_asset_upload_v1'
    | 'composer_media_stage_inspect_v1'
    | 'prompt_asset_download_v1'
    | 'prompt_registry_download_v1'
    | 'workspace_file_download_v1';

const MACHINE_CARRIER_FLOW_BY_REQUEST_KIND = {
    composer_media_stage_upload_v1: 'attachment_transfer',
    session_attachment_upload_v1: 'attachment_transfer',
    session_file_upload_v1: 'file_transfer',
    prompt_asset_upload_v1: 'file_transfer',
    composer_media_stage_inspect_v1: 'attachment_transfer',
    prompt_asset_download_v1: 'file_transfer',
    prompt_registry_download_v1: 'file_transfer',
    workspace_file_download_v1: 'file_transfer',
} as const satisfies Record<MachineCarrierTransferRequestKind, MachineCarrierTransferFlow>;

export function resolveMachineCarrierTransferFlow(
    request: Readonly<{ t: MachineCarrierTransferRequestKind }>,
): MachineCarrierTransferFlow {
    return MACHINE_CARRIER_FLOW_BY_REQUEST_KIND[request.t];
}
