import { buildTerminalAttachmentMetadataFromHostHandle } from '@/agent/runtime/terminal/attachmentMetadata';
import type { TerminalHostHandle } from '@/integrations/terminalHost/_types';
import {
  createTerminalAttachmentId,
  writeTerminalAttachmentInfo,
} from '@/terminal/attachment/terminalAttachmentInfo';

export async function bindSpawnedTerminalHostAttachment(params: Readonly<{
  happyHomeDir: string;
  sessionId: string;
  handle: TerminalHostHandle;
  disposeUnboundHost: () => Promise<void>;
}>): Promise<void> {
  const attachmentId = params.handle.attachmentId ?? createTerminalAttachmentId();
  const handle = { ...params.handle, attachmentId };
  const terminal = buildTerminalAttachmentMetadataFromHostHandle(handle);
  if (!terminal) throw new Error(`Failed to build ${handle.kind} terminal attachment metadata`);
  try {
    await writeTerminalAttachmentInfo({
      happyHomeDir: params.happyHomeDir,
      sessionId: params.sessionId,
      attachmentId,
      handle,
      terminal,
    });
  } catch (bindingError) {
    try {
      await params.disposeUnboundHost();
    } catch (disposalError) {
      throw new AggregateError(
        [bindingError, disposalError],
        `Failed to bind and dispose an unbound ${handle.kind} terminal host`,
      );
    }
    throw bindingError;
  }
}
