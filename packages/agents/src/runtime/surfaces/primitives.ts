import type {
  SessionStateFieldId,
  SessionStateFieldValue,
} from '@happier-dev/protocol';

export type SessionStateUpdateV1<F extends SessionStateFieldId = SessionStateFieldId> = Readonly<{
  fieldId: F;
  value: SessionStateFieldValue<F>;
  updatedAt?: number;
}>;

export type AgentSurfaceDiagnosticV1 = Readonly<{
  code: string;
  severity?: 'info' | 'warning' | 'error';
  retryable?: boolean;
  safeMessage?: string;
  details?: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type AgentSurfaceOperationReceiptV1 = Readonly<{
  operationId?: string;
  providerOperationId?: string;
  diagnostics?: readonly AgentSurfaceDiagnosticV1[];
  sessionStateUpdates?: readonly SessionStateUpdateV1[];
}>;

export type AgentSurfaceBaseFailureCodeV1 =
  | 'unsupported'
  | 'unavailable'
  | 'not_authorized'
  | 'invalid_request'
  | 'cancelled'
  | 'provider_error'
  | 'timeout';

export type AgentSurfaceResultV1<
  TValue,
  TCode extends string = AgentSurfaceBaseFailureCodeV1,
> =
  | Readonly<{
      ok: true;
      value: TValue;
      receipt?: AgentSurfaceOperationReceiptV1;
    }>
  | Readonly<{
      ok: false;
      code: TCode | AgentSurfaceBaseFailureCodeV1;
      message?: string;
      retryable?: boolean;
      receipt?: AgentSurfaceOperationReceiptV1;
      diagnostics?: readonly AgentSurfaceDiagnosticV1[];
    }>;

export type AgentSessionLaunchHintsV1 = Readonly<{
  directory?: string;
  environmentVariables?: Readonly<Record<string, string>>;
  sessionStateUpdates?: readonly SessionStateUpdateV1[];
}>;
