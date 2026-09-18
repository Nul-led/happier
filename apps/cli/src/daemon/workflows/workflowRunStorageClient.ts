import axios from 'axios';
import { PLUGIN_INSTALLATION_MANIFEST_PUBLISHER_HEADER_V1 } from '@happier-dev/protocol';

import { buildCurrentAccountStoredContentCompatibilityHttpHeaders } from '@/api/clientCompatibility/cliClientCompatibility';
import { resolveServerHttpBaseUrl } from '@/api/client/serverHttpBaseUrl';
import {
  createDefaultPluginInstallationPublisherHeader,
  type CreatePluginInstallationPublisherHeader,
} from '@/plugins/installations/publisherProof';

export const WORKFLOW_RUN_STORAGE_HTTP_PATH = '/v3/automations/runs/workflow-storage';

export type WorkflowRunStorageOperation = Readonly<Record<string, unknown> & {
  operation:
    | 'admit' | 'accepted-snapshot.resolve' | 'initialize' | 'get' | 'wait' | 'pause' | 'resume' | 'cancel' | 'list' | 'recovery.list'
    | 'invocations.list' | 'invocations.admit' | 'invocations.get' | 'invocations.fact'
    | 'transition' | 'invocations.retry' | 'invocations.recover' | 'result-delivery.settle' | 'delete';
}>;

/** Thin transport to the server's opaque workflow Run storage owner. */
export function createWorkflowRunStorageClient(params: Readonly<{
  token: string;
  machineId: string;
  serverHttpBaseUrl?: string;
  createPublisherHeader?: CreatePluginInstallationPublisherHeader;
}>) {
  const baseUrl = params.serverHttpBaseUrl ?? resolveServerHttpBaseUrl();
  const createPublisherHeader = params.createPublisherHeader ?? createDefaultPluginInstallationPublisherHeader;
  return {
    execute: async (operation: WorkflowRunStorageOperation, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<unknown> => {
      const body = { ...operation, publisherMachineId: params.machineId };
      const publisherHeader = await createPublisherHeader({ method: 'POST', path: WORKFLOW_RUN_STORAGE_HTTP_PATH, body });
      const request = () => axios.post<unknown>(`${baseUrl}${WORKFLOW_RUN_STORAGE_HTTP_PATH}`, body, {
        headers: {
          ...buildCurrentAccountStoredContentCompatibilityHttpHeaders(),
          Authorization: `Bearer ${params.token}`,
          'Content-Type': 'application/json',
          ...(publisherHeader ? { [PLUGIN_INSTALLATION_MANIFEST_PUBLISHER_HEADER_V1]: publisherHeader } : {}),
        },
        // Workflow wait is a server long-poll whose authored observation
        // deadline and caller AbortSignal are already carried by the request.
        // Axios must not impose a separate fixed platform deadline.
        timeout: operation.operation === 'wait' ? 0 : 30_000,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      const response = await request().catch(async (error: unknown) => {
        const ambiguous = typeof error !== 'object' || error === null
          || (!(error as { response?: unknown }).response && (error as { code?: unknown }).code !== 'ERR_CANCELED');
        if (![
          'admit', 'accepted-snapshot.resolve', 'initialize', 'invocations.admit',
          'invocations.retry', 'invocations.recover',
        ].includes(operation.operation) || !ambiguous) throw error;
        // Direct Run admission, Automation accepted-snapshot attachment,
        // initialization, and caller-bound row admission/recovery all have an exact
        // lost-response rejoin contract. Reuse caller ids and sealed bytes
        // verbatim; never resolve a mutable source again here.
        return await request();
      });
      return response.data;
    },
  };
}
