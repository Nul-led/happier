import { describe, expect, it, vi } from 'vitest';

import { parseClaudeScreenState } from '../screenState.js';
import { answerClaudeUnifiedRegisteredDialog } from './dialogAnswer.js';
import {
  getClaudeUnifiedDialogIdentity,
  getClaudeUnifiedRecognizedDialogRegistryEntry,
  resolveClaudeUnifiedVisibleDialog,
} from './dialogRegistry.js';
import { createFakeControlPort } from './fakeControlPort.js';

const EFFORT_DIALOG = [
  'Change effort level?',
  'Switching to high means the full history will be processed with high effort.',
  '',
  '❯ 1. Yes, switch to high',
  '  2. No, go back',
].join('\n');

const SAFEGUARD_DIALOG = [
  'Session paused',
  '',
  "Fable 5's safeguards flagged this message.",
  '',
  '❯ 1. Switch to Opus 4.8',
  '  2. Edit prompt and retry with Fable 5',
].join('\n');

const RESUME_CHOICE_DIALOG = [
  'This session is 18h old and 560.4k tokens.',
  '❯ 1. Resume from summary',
  '  2. Resume full session',
].join('\n');

const IDLE_COMPOSER = [
  '──────────────────────────────',
  '❯ ',
  '──────────────────────────────',
].join('\n');

const HIDDEN_TRUST_DIALOG = [
  'Quick safety check: is this a project you created or one you trust?',
  '',
  '❯ No, exit',
  '  Yes, I trust this folder',
  '',
  'Enter to confirm · Esc to cancel',
].join('\n');

const HIDDEN_UNKNOWN_DIALOG = [
  'Allow external CLAUDE.md file imports?',
  '',
  '❯ No, disable external imports',
  '  Yes, allow external imports',
  '',
  'Enter to confirm · Esc to cancel',
].join('\n');

function confirmOption(dialogId: 'effort_change') {
  const entry = getClaudeUnifiedRecognizedDialogRegistryEntry(dialogId);
  return entry.options({ effortChangeDialogTarget: 'high' } as never)[0];
}

describe('answerClaudeUnifiedRegisteredDialog', () => {
  it('navigates a hidden-shortcut dialog to the semantic target and confirms it', async () => {
    const state = parseClaudeScreenState(HIDDEN_TRUST_DIALOG);
    const dialog = resolveClaudeUnifiedVisibleDialog(state);
    expect(dialog?.kind).toBe('recognized');
    const option = dialog?.kind === 'recognized'
      ? dialog.options.find((candidate) => candidate.choice === 'trust_once')
      : null;
    const focusedTrust = HIDDEN_TRUST_DIALOG.replace('❯ No, exit', '  No, exit').replace('  Yes, I trust this folder', '❯ Yes, I trust this folder');
    const port = createFakeControlPort({ captures: [HIDDEN_TRUST_DIALOG, focusedTrust, IDLE_COMPOSER] });

    const result = await answerClaudeUnifiedRegisteredDialog({
      port,
      dialogId: 'trust_folder',
      option: option!,
      settleMs: 0,
      wait: async () => undefined,
    });

    expect(result).toEqual({ status: 'answered' });
    expect(port.sentLiteral).toEqual([]);
    expect(port.sentKeys).toEqual(['ArrowDown', 'Enter']);
  });

  it('never presses Enter when hidden-shortcut focus does not visibly move', async () => {
    const state = parseClaudeScreenState(HIDDEN_TRUST_DIALOG);
    const dialog = resolveClaudeUnifiedVisibleDialog(state);
    const option = dialog?.kind === 'recognized'
      ? dialog.options.find((candidate) => candidate.choice === 'trust_once')
      : null;
    const port = createFakeControlPort({ captures: [HIDDEN_TRUST_DIALOG, HIDDEN_TRUST_DIALOG] });

    const result = await answerClaudeUnifiedRegisteredDialog({
      port,
      dialogId: 'trust_folder',
      option: option!,
      settleMs: 0,
      wait: async () => undefined,
    });

    expect(result.status).toBe('failed');
    expect(port.sentKeys).toEqual(['ArrowDown']);
  });

  it('uses verified navigation for a future hidden-shortcut dialog parsed generically', async () => {
    const state = parseClaudeScreenState(HIDDEN_UNKNOWN_DIALOG);
    const dialog = resolveClaudeUnifiedVisibleDialog(state);
    expect(dialog?.kind).toBe('unrecognized');
    const option = dialog?.kind === 'unrecognized' ? dialog.options[1] : null;
    const focusedTarget = HIDDEN_UNKNOWN_DIALOG
      .replace('❯ No, disable external imports', '  No, disable external imports')
      .replace('  Yes, allow external imports', '❯ Yes, allow external imports');
    const port = createFakeControlPort({ captures: [HIDDEN_UNKNOWN_DIALOG, focusedTarget, IDLE_COMPOSER] });

    const result = await answerClaudeUnifiedRegisteredDialog({
      port,
      dialogId: 'unrecognized_confirmation',
      expectedIdentity: getClaudeUnifiedDialogIdentity(dialog!),
      option: option!,
      settleMs: 0,
      wait: async () => undefined,
    });

    expect(result).toEqual({ status: 'answered' });
    expect(port.sentLiteral).toEqual([]);
    expect(port.sentKeys).toEqual(['ArrowDown', 'Enter']);
  });

  it('types zero bytes when a same-id dialog option mutates before the answer', async () => {
    const original = parseClaudeScreenState([
      'Session paused',
      "Fable 5's safeguards flagged this message.",
      '❯ 1. Switch to Opus 4.8',
      '  2. Edit prompt and retry with Fable 5',
    ].join('\n'));
    const changed = [
      'Session paused',
      "Fable 5's safeguards flagged this message.",
      '❯ 1. Switch to Sonnet 4.7',
      '  2. Edit prompt and retry with Fable 5',
    ].join('\n');
    const dialog = resolveClaudeUnifiedVisibleDialog(original);
    expect(dialog?.kind).toBe('recognized');
    const option = dialog?.kind === 'recognized' ? dialog.options[0] : null;
    const port = createFakeControlPort({ captures: [changed] });

    const result = await answerClaudeUnifiedRegisteredDialog({
      port,
      dialogId: 'safeguard_pause',
      expectedIdentity: getClaudeUnifiedDialogIdentity(dialog!),
      option: option!,
      settleMs: 0,
      wait: async () => undefined,
    });

    expect(result.status).toBe('dialog_changed');
    expect(port.sentLiteral).toEqual([]);
    expect(port.sentKeys).toEqual([]);
  });
  it('recaptures before typing and answers a numbered dialog without appending Enter', async () => {
    const port = createFakeControlPort({ captures: [EFFORT_DIALOG, IDLE_COMPOSER] });
    const result = await answerClaudeUnifiedRegisteredDialog({
      port,
      dialogId: 'effort_change',
      option: confirmOption('effort_change'),
      settleMs: 0,
      wait: async () => undefined,
    });

    expect(result).toEqual({ status: 'answered' });
    expect(port.sentLiteral).toEqual(['1']);
    expect(port.sentKeys).toEqual([]);
  });

  it('does not append Enter after Claude auto-submits a resume-choice numeric shortcut', async () => {
    const state = parseClaudeScreenState(RESUME_CHOICE_DIALOG);
    const dialog = resolveClaudeUnifiedVisibleDialog(state);
    expect(dialog?.kind).toBe('recognized');
    const option = dialog?.kind === 'recognized' ? dialog.options[0] : null;
    const port = createFakeControlPort({ captures: [RESUME_CHOICE_DIALOG, IDLE_COMPOSER] });

    const result = await answerClaudeUnifiedRegisteredDialog({
      port,
      dialogId: 'resume_choice',
      option: option!,
      settleMs: 0,
      wait: async () => undefined,
    });

    expect(result).toEqual({ status: 'answered' });
    expect(port.sentLiteral).toEqual(['1']);
    expect(port.sentKeys).toEqual([]);
  });

  it('types nothing when the recaptured screen shows a DIFFERENT dialog (A→B replacement)', async () => {
    const port = createFakeControlPort({ captures: [SAFEGUARD_DIALOG] });
    const result = await answerClaudeUnifiedRegisteredDialog({
      port,
      dialogId: 'effort_change',
      option: confirmOption('effort_change'),
      settleMs: 0,
      wait: async () => undefined,
    });

    expect(result).toEqual({ status: 'dialog_changed', dialogId: 'safeguard_pause' });
    expect(port.sentLiteral).toEqual([]);
    expect(port.sentKeys).toEqual([]);
  });

  it('reports not_visible when no dialog is on the recaptured screen', async () => {
    const port = createFakeControlPort({ captures: [IDLE_COMPOSER] });
    const result = await answerClaudeUnifiedRegisteredDialog({
      port,
      dialogId: 'effort_change',
      option: confirmOption('effort_change'),
      settleMs: 0,
      wait: async () => undefined,
    });

    expect(result).toEqual({ status: 'not_visible' });
    expect(port.sentLiteral).toEqual([]);
  });

  it('waits through delayed terminal redraws after Claude accepts the numbered shortcut', async () => {
    const port = createFakeControlPort({
      captures: [EFFORT_DIALOG, EFFORT_DIALOG, EFFORT_DIALOG, IDLE_COMPOSER],
    });
    const result = await answerClaudeUnifiedRegisteredDialog({
      port,
      dialogId: 'effort_change',
      option: confirmOption('effort_change'),
      settleMs: 0,
      wait: async () => undefined,
    });

    expect(result).toEqual({ status: 'answered' });
    expect(port.captureCount()).toBe(4);
    expect(port.sentLiteral).toEqual(['1']);
  });

  it('fails when the same dialog is still visible after answering', async () => {
    const port = createFakeControlPort({ captures: [EFFORT_DIALOG, EFFORT_DIALOG] });
    const result = await answerClaudeUnifiedRegisteredDialog({
      port,
      dialogId: 'effort_change',
      option: confirmOption('effort_change'),
      settleMs: 0,
      wait: async () => undefined,
    });

    expect(result).toEqual({ status: 'failed', reason: 'dialog_still_visible' });
    expect(port.sentLiteral).toEqual(['1']);
  });

  it('publishes the exact submission boundary even when post-submit recapture fails', async () => {
    const onSubmitted = vi.fn();
    const port = createFakeControlPort({
      captures: [EFFORT_DIALOG],
      failCaptureAtIndexes: [1],
    });
    const result = await answerClaudeUnifiedRegisteredDialog({
      port,
      dialogId: 'effort_change',
      option: confirmOption('effort_change'),
      settleMs: 0,
      wait: async () => undefined,
      onSubmitted,
    });

    expect(result).toEqual({ status: 'failed', reason: 'host_dead:unrecoverable' });
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });
});
