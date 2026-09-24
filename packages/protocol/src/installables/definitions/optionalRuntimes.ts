import { InstallableDependencyDescriptorSchema } from '../descriptor.js';

function optionalRuntime(params: Readonly<{
  key: string;
  componentId: 'happier-memory-runtime' | 'happier-voice-runtime' | 'happier-difftastic';
  name: string;
  description: string;
  command: string;
  iconName: string;
}>) {
  return InstallableDependencyDescriptorSchema.parse({
    id: params.key,
    key: params.key,
    kind: 'dep',
    version: '1',
    capabilityId: `dep.${params.key}`,
    display: { name: params.name },
    description: params.description,
    source: { kind: 'first_party_runtime', componentId: params.componentId },
    binary: { commands: [params.command], systemFirst: false, managedFallback: true },
    defaultPolicy: { autoInstallWhenNeeded: true, autoUpdateMode: 'off' },
    consent: { install: 'not_required', update: 'not_required' },
    ui: { iconName: params.iconName },
  });
}

export const LOCAL_EMBEDDINGS_INSTALLABLE_DESCRIPTOR = optionalRuntime({
  key: 'local-embeddings',
  componentId: 'happier-memory-runtime',
  name: 'Local embeddings',
  description: 'On-device embeddings for local memory search. Install ahead of time to use offline.',
  command: 'happier-memory-runtime',
  iconName: 'cpu',
});

export const DIFFTASTIC_INSTALLABLE_DESCRIPTOR = optionalRuntime({
  key: 'difftastic',
  componentId: 'happier-difftastic',
  name: 'Difftastic',
  description: 'Syntax-aware diffs. Install ahead of time to use offline.',
  command: 'difft',
  iconName: 'arrows-left-right',
});

export const LOCAL_VOICE_RUNTIME_INSTALLABLE_DESCRIPTOR = optionalRuntime({
  key: 'local-voice-runtime',
  componentId: 'happier-voice-runtime',
  name: 'On-device voice inference',
  description: 'Native on-device speech recognition and synthesis. Install ahead of time to use offline.',
  command: 'happier-voice-runtime',
  iconName: 'microphone',
});
