import { expect, it, vi } from 'vitest';

it.each([
    ['raw credential client', () => import('./rawCredentialClient'), 'createVoiceClientRawCredentialAccess'],
    ['speech runtime', () => import('../runtime/bundledSpeech/bundledSpeechRuntime'), 'createBundledSpeechRuntime'],
] as const)('loads the %s before its default Voice dependencies finish initializing', async (_label, load, exportName) => {
    // Keep the real sync/Voice import graph: speech client singleton creation
    // must not read the execution-machine resolver during module evaluation.
    vi.resetModules();
    await expect(load()).resolves.toHaveProperty(exportName);
});
