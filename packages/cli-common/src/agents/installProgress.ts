/** Presentation samples from the canonical install/acquisition owner; the caller owns step identity. */
export type AgentInstallProgressEvent =
  | Readonly<{ t: 'progress'; bytesDone: number; bytesTotal: number | null }>
  | Readonly<{ t: 'log'; line: string }>;

export type AgentInstallProgressCallback = (event: AgentInstallProgressEvent) => void;
