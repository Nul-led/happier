import { describe, expect, it } from 'vitest';

import { createSurfaceInputControl } from './inputControl';

describe('surface input control', () => {
  it('closes admission before abort and waits for held input to release before hand back', async () => {
    const control = createSurfaceInputControl({ requireObservation: true });
    let finish: () => void = () => undefined;
    const release = new Promise<void>((resolve) => { finish = resolve; });
    let held = false;
    let aborted = false;
    let admissionDuringAbort: string | undefined;
    expect(control.observe(0)).toBe(true);
    const running = control.execute({
      requestedBy: 'agent',
      effect: async (signal) => {
        held = true;
        signal.addEventListener('abort', () => {
          aborted = true;
          admissionDuringAbort = control.getAdmissionFailure('human');
        }, { once: true });
        await release;
        held = false;
        return 'released';
      },
      classifyCompletion: () => 'known',
    });

    let stopped = false;
    const interruption = control.takeOver().then((result) => { stopped = true; return result; });
    expect(aborted).toBe(true);
    expect(admissionDuringAbort).toBe('busy');
    expect(control.getStatus()).toMatchObject({ controller: 'human', controlEpoch: 1, stopping: true });
    expect(control.handBack()).toBe(false);
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(held).toBe(true);

    finish();
    expect(await interruption).toEqual({ active: true, completion: 'known' });
    expect(await running).toMatchObject({ ok: true, value: 'released', interrupted: true, completion: 'known' });
    expect(held).toBe(false);
    expect(control.handBack()).toBe(true);
    expect(control.getAdmissionFailure('agent')).toBe('observation_required');
    expect(control.observe(1)).toBe(false);
    expect(control.observe(2)).toBe(true);
    expect(control.getAdmissionFailure('agent')).toBeUndefined();
  });

  it('allows uncertain hand back but requires a fresh agent observation before the next mutation', async () => {
    const control = createSurfaceInputControl();
    let finish: () => void = () => undefined;
    const release = new Promise<void>((resolve) => { finish = resolve; });
    const running = control.execute({
      requestedBy: 'agent', effect: async () => { await release; return 'unknown'; }, classifyCompletion: () => 'unknown',
    });
    const interruption = control.takeOver();
    finish();
    expect(await interruption).toEqual({ active: true, completion: 'unknown' });
    await running;
    expect(control.getStatus()).toMatchObject({ controller: 'human', stopping: false, uncertain: true });
    expect(control.observe(0)).toBe(false);
    expect(control.getAdmissionFailure('agent')).toBe('uncertain');
    expect(control.getAdmissionFailure('human')).toBeUndefined();
    expect(await control.execute({ requestedBy: 'human', effect: async () => 'click', classifyCompletion: () => 'known' }))
      .toMatchObject({ ok: true, value: 'click' });
    expect(control.getStatus().uncertain).toBe(true);
    expect(control.handBack()).toBe(true);
    expect(control.getStatus()).toMatchObject({ controller: 'idle', controlEpoch: 2, stopping: false, uncertain: true });
    expect(control.getAdmissionFailure('agent')).toBe('observation_required');
    let agentEffects = 0;
    const agentInput = {
      requestedBy: 'agent',
      effect: async () => { agentEffects += 1; return 'click'; },
      classifyCompletion: () => 'known',
    } satisfies Parameters<typeof control.execute>[0];
    expect(await control.execute(agentInput)).toEqual({ ok: false, errorCode: 'observation_required' });
    expect(agentEffects).toBe(0);
    expect(control.observe(1)).toBe(false);
    expect(control.getStatus().uncertain).toBe(true);
    control.invalidateObservation();
    expect(control.observe(2)).toBe(true);
    expect(control.getStatus().uncertain).toBe(false);
    expect(control.getAdmissionFailure('agent')).toBeUndefined();
    expect(await control.execute(agentInput)).toMatchObject({ ok: true, value: 'click', completion: 'known' });
    expect(agentEffects).toBe(1);
  });

  it('cannot clear an uncertain effect before a human takeover or while input is still active', async () => {
    const control = createSurfaceInputControl();
    await control.execute({ requestedBy: 'agent', effect: async () => 'unknown', classifyCompletion: () => 'unknown' });
    expect(control.observe(0)).toBe(false);
    await control.takeOver();
    let finish: () => void = () => undefined;
    const running = control.execute({ requestedBy: 'human', effect: () => new Promise<void>(resolve => { finish = resolve; }), classifyCompletion: () => 'known' });
    expect(control.observe(1)).toBe(false);
    finish();
    await running;
    expect(control.observe(1)).toBe(true);
  });

  it('keeps cancellation by the caller in flight until the real effect settles', async () => {
    const control = createSurfaceInputControl();
    const caller = new AbortController();
    let finish: () => void = () => undefined;
    const release = new Promise<void>((resolve) => { finish = resolve; });
    let effectSignal: AbortSignal | undefined;
    const running = control.execute({
      requestedBy: 'agent', signal: caller.signal,
      effect: async (signal) => { effectSignal = signal; await release; return 'released'; }, classifyCompletion: () => 'known',
    });
    caller.abort();
    expect(effectSignal?.aborted).toBe(true);
    expect(control.getAdmissionFailure('human')).toBe('busy');
    finish();
    expect(await running).toMatchObject({ ok: true, interrupted: true, completion: 'known', reason: 'user_canceled' });
    expect(control.getAdmissionFailure('agent')).toBe('observation_required');
  });

  it('closes a source without releasing single flight early or permitting observations to reopen it', async () => {
    const control = createSurfaceInputControl();
    let finish: () => void = () => undefined;
    const release = new Promise<void>((resolve) => { finish = resolve; });
    const running = control.execute({ requestedBy: 'agent', effect: async () => { await release; return 'done'; }, classifyCompletion: () => 'known' });
    const closing = control.close();
    expect(control.isClosed()).toBe(true);
    expect(control.getAdmissionFailure('agent')).toBe('busy');
    finish();
    await running;
    expect(await closing).toBe('known');
    expect(control.getAdmissionFailure('human')).toBe('closed');
    expect(control.observe(0)).toBe(false);
    expect(control.handBack()).toBe(false);
  });
});
