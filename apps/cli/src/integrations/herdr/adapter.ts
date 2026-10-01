import { randomUUID } from 'node:crypto';

import {
  resolveTerminalPromptWriteTimeoutMs,
  type TerminalAttachmentId,
  type TerminalControlPort,
  type TerminalHostAdapter,
  type TerminalHostHandle,
  type TerminalInputInjectionResult,
  type TerminalInputState,
  type TerminalSpecialKey,
} from '@happier-dev/agents';

import { buildTerminalControlCapture, normalizeCapturedScreen } from '@/integrations/terminalHost/controlCapture';
import {
  resolveTerminalPromptSubmissionFailureReason,
  runTerminalPromptSubmission,
  type TerminalPromptSubmitVerificationPolicy,
} from '@/integrations/terminalHost/promptSubmitVerification';
import { createTerminalHostDeadline, remainingTerminalHostDeadlineMs } from '@/integrations/terminalHost/deadline';
import { logger } from '@/ui/logger';

import { createHerdrClient, HerdrApiError, HerdrPaneCreationError, type HerdrClient } from './client';
import { createHerdrLaunchSpec } from './launchSpec';

const SPECIAL_KEYS: Readonly<Record<TerminalSpecialKey, string>> = {
  Enter: 'enter',
  Escape: 'esc',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Tab: 'tab',
  ShiftTab: 'shift+tab',
  CtrlC: 'ctrl+c',
  Backspace: 'backspace',
};

function paneFailure(error: unknown): boolean {
  return error instanceof HerdrApiError && error.code === 'pane_not_found';
}

function failedInjection(
  handle: TerminalHostHandle,
  reason: Extract<TerminalInputInjectionResult, { status: 'failed' }>['reason'],
  phase: Extract<TerminalInputInjectionResult, { status: 'failed' }>['phase'],
  duplicateRisk: Extract<TerminalInputInjectionResult, { status: 'failed' }>['duplicateRisk'],
): TerminalInputInjectionResult {
  return {
    status: 'failed', reason, phase, duplicateRisk, recoverable: reason !== 'pane_dead',
    observedAt: Date.now(), hostKind: 'herdr', hostSessionName: handle.sessionName,
    ...(handle.paneId ? { paneId: handle.paneId } : {}),
  };
}

export function createHerdrTerminalHostAdapter(params: Readonly<{
  binary: string;
  actionTimeoutMs: number;
  startupTimeoutMs: number;
  sessionName?: string;
  client?: HerdrClient;
  promptSubmitVerification?: TerminalPromptSubmitVerificationPolicy;
}>): TerminalHostAdapter {
  const sessionName = params.sessionName ?? 'default';
  const client = params.client ?? createHerdrClient({
    binary: params.binary,
    sessionName,
    actionTimeoutMs: params.actionTimeoutMs,
    startupTimeoutMs: params.startupTimeoutMs,
  });
  const clientFor = (handle: TerminalHostHandle): HerdrClient => (
    handle.socketPath === client.socketPath
      ? client
      : createHerdrClient({
        binary: params.binary,
        sessionName: handle.sessionName,
        ...(handle.socketPath ? { socketPath: handle.socketPath } : {}),
        actionTimeoutMs: params.actionTimeoutMs,
        startupTimeoutMs: params.startupTimeoutMs,
      })
  );

  async function resolvePane(handle: TerminalHostHandle): Promise<Readonly<{ paneId: string }> | null> {
    if (!handle.terminalId?.trim()) return null;
    return await clientFor(handle).findPane(handle.terminalId);
  }

  async function captureInputState(handle: TerminalHostHandle): Promise<TerminalInputState> {
    const pane = await resolvePane(handle);
    if (!pane) return { stable: false, currentInput: '', observedAt: Date.now() };
    try {
      const first = await clientFor(handle).readPane(pane.paneId);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const currentInput = await clientFor(handle).readPane(pane.paneId);
      return { stable: first === currentInput, currentInput, observedAt: Date.now() };
    } catch {
      return { stable: false, currentInput: '', observedAt: Date.now() };
    }
  }

  function createControlPort(handle: TerminalHostHandle): TerminalControlPort {
    const send = async (effect: (paneId: string) => Promise<void>) => {
      try {
        const pane = await resolvePane(handle);
        if (!pane) return { status: 'host_dead' as const, recoverable: false };
        await effect(pane.paneId);
        return { status: 'sent' as const, at: Date.now() };
      } catch (error) {
        if (paneFailure(error)) return { status: 'host_dead' as const, recoverable: false };
        return { status: 'failed' as const, reason: error instanceof HerdrApiError && error.code === 'timeout' ? 'timeout' as const : 'host_unreachable' as const };
      }
    };
    return {
      hostKind: 'herdr',
      sendLiteralText: (text) => send((paneId) => clientFor(handle).sendText(paneId, text)),
      sendRawSequence: (sequence) => send((paneId) => clientFor(handle).sendRaw(paneId, sequence)),
      sendSpecialKey: (key) => send((paneId) => clientFor(handle).sendKeys(paneId, [SPECIAL_KEYS[key]])),
      async captureScreen() {
        try {
          const pane = await resolvePane(handle);
          if (!pane) return { status: 'host_dead' as const, recoverable: false };
          const rawText = await clientFor(handle).readPane(pane.paneId);
          return {
            status: 'captured' as const,
            capture: buildTerminalControlCapture({ rawText, hostKind: 'herdr', capturedAtMs: Date.now() }),
          };
        } catch (error) {
          if (paneFailure(error)) return { status: 'host_dead' as const, recoverable: false };
          return { status: 'failed' as const, reason: error instanceof HerdrApiError && error.code === 'timeout' ? 'timeout' as const : 'host_unreachable' as const };
        }
      },
    };
  }

  return {
    kind: 'herdr',
    async validateExistingHostAdmission(handle) {
      await clientFor(handle).assertServerVersion();
    },
    async createOrAttachHost(opts) {
      const hostSessionName = opts.sessionName === 'default' ? sessionName : opts.sessionName;
      const launchClient = params.client || hostSessionName === sessionName
        ? client
        : createHerdrClient({
            binary: params.binary,
            sessionName: hostSessionName,
            actionTimeoutMs: params.actionTimeoutMs,
            startupTimeoutMs: params.startupTimeoutMs,
          });
      await launchClient.ensureServer();
      const launch = await createHerdrLaunchSpec(opts);
      let pane;
      try {
        pane = await launchClient.createPane({
          label: opts.label ?? opts.sessionName,
          cwd: opts.workingDirectory,
          argv: launch.argv,
          env: {},
        });
      } catch (error) {
        let failure = error;
        if (error instanceof HerdrPaneCreationError && error.launchDisposition !== 'unconfirmed') {
          try {
            await launch.discard();
          } catch (cleanupError) {
            failure = new HerdrPaneCreationError([...error.errors, cleanupError], error.launchDisposition, true);
          }
        }
        // Do not serialize the error's causes: OS/API errors can contain launch inputs.
        logger.infoFile('[WARN] [herdr] Pane creation failed', {
          launchDisposition: failure instanceof HerdrPaneCreationError ? failure.launchDisposition : 'unconfirmed',
          cleanupIncomplete: failure instanceof HerdrPaneCreationError ? failure.cleanupIncomplete : true,
        });
        throw failure;
      }
      const socketPath = launchClient.socketPath;
      if (!socketPath) throw new HerdrApiError('server_not_ready');
      const requestedAttachmentId = opts.spawnEnv.HAPPIER_TERMINAL_ATTACHMENT_ID?.trim();
      return {
        attachmentId: (requestedAttachmentId || randomUUID()) as TerminalAttachmentId,
        kind: 'herdr',
        sessionName: hostSessionName,
        paneId: pane.paneId,
        terminalId: pane.terminalId,
        socketPath,
        expectedCommandFragments: opts.spawnArgv.length > 0 ? [opts.spawnArgv[0] ?? ''] : [],
        attachMetadata: {
          attachStrategy: 'terminal_host',
          topology: 'shared',
          locality: 'same_machine',
          maxClients: null,
          requiresLocalAttachmentInfo: true,
          liveProbe: 'required',
        },
      };
    },
    async evaluateLiveness(handle) {
      const observedAt = Date.now();
      try {
        const pane = await resolvePane(handle);
        if (!pane) return { paneAlive: false, paneDead: true, observedAt };
        const process = await clientFor(handle).processInfo(pane.paneId);
        return {
          paneAlive: true,
          panePid: process.shellPid ?? undefined,
          paneCurrentCommand: process.foregroundProcesses.map((item) => item.argv.join(' ')).join(' | '),
          observedAt,
        };
      } catch (error) {
        if (paneFailure(error)) return { paneAlive: false, paneDead: true, observedAt };
        return { paneAlive: false, probeInconclusive: true, observedAt };
      }
    },
    captureInputState,
    createControlPort,
    async injectUserPrompt(handle, input) {
      if (input.scheduling.deferReason) {
        return {
          status: 'deferred',
          reason: input.scheduling.deferReason,
          recoverable: true,
          observedAt: Date.now(),
          ...(input.scheduling.retryAfterMs !== undefined ? { retryAfterMs: input.scheduling.retryAfterMs } : {}),
        };
      }
      let pane: Awaited<ReturnType<typeof resolvePane>>;
      try {
        pane = await resolvePane(handle);
      } catch (error) {
        return failedInjection(
          handle,
          error instanceof HerdrApiError && error.code === 'timeout' ? 'timeout' : 'host_unreachable',
          'liveness',
          'none',
        );
      }
      if (!pane) return failedInjection(handle, 'pane_dead', 'liveness', 'none');
      if (input.scheduling.deferredUntilQuietMs && !(await captureInputState(handle)).stable) {
        return { status: 'deferred', reason: 'user_typing', recoverable: true, observedAt: Date.now(), retryAfterMs: input.scheduling.deferredUntilQuietMs };
      }
      try {
        await clientFor(handle).sendText(pane.paneId, input.text);
      } catch (error) {
        return failedInjection(
          handle,
          error instanceof HerdrApiError && error.code === 'timeout' ? 'timeout' : 'host_unreachable',
          'during_write',
          'possible',
        );
      }
      const policy = params.promptSubmitVerification;
      const submissionDeadline = createTerminalHostDeadline(
        input.scheduling.timeoutMs ?? resolveTerminalPromptWriteTimeoutMs(input.text),
      );
      const submitted = await runTerminalPromptSubmission({
        promptText: input.text,
        remainingTimeoutMs: () => remainingTerminalHostDeadlineMs(submissionDeadline),
        ...(policy?.shouldVerifyAfterSubmit(input.text)
          ? {
            verifyStagedBeforeSubmit: async ({ promptText }) => (policy.verifyBeforeSubmitStaging ?? policy.verifyAfterSubmit)({
              promptText,
              screenText: normalizeCapturedScreen(await clientFor(handle).readPane(pane.paneId)),
            }),
            verifyAfterSubmit: async ({ promptText }) => policy.verifyAfterSubmit({
              promptText,
              screenText: normalizeCapturedScreen(await clientFor(handle).readPane(pane.paneId)),
            }),
          }
          : {}),
        submitEnter: async () => {
          try {
            await clientFor(handle).sendKeys(pane.paneId, ['enter']);
            return 'success';
          } catch (error) {
            return error instanceof HerdrApiError && error.code === 'timeout' ? 'timeout' : 'failed';
          }
        },
      });
      if (!submitted.success) {
        return failedInjection(
          handle,
          resolveTerminalPromptSubmissionFailureReason(submitted.reason),
          submitted.phase,
          submitted.duplicateRisk,
        );
      }
      return {
        status: 'injected', injectedAt: Date.now(), bytesWritten: Buffer.byteLength(input.text),
        hostKind: 'herdr', hostSessionName: handle.sessionName, paneId: pane.paneId,
      };
    },
    async interruptTurn(handle) {
      const pane = await resolvePane(handle);
      if (!pane) throw new HerdrApiError('pane_not_found');
      await clientFor(handle).sendKeys(pane.paneId, ['esc']);
    },
    async dispose(handle) {
      const pane = await resolvePane(handle);
      if (!pane) return;
      await clientFor(handle).closePane(pane.paneId);
    },
  };
}
