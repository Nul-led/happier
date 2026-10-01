import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import type { RunnerLaunchManifestV1 } from '@happier-dev/protocol/ephemeralRunner/launchManifest';

import {
  resolveEphemeralRunnerActiveClosePresentation,
  resolveEphemeralRunnerConsentReviewPresentation,
  resolveEphemeralRunnerDirectoryChoicePresentation,
  resolveEphemeralRunnerEndpointPresentation,
  resolveEphemeralRunnerFailureRecoveryPresentation,
  resolveEphemeralRunnerRegistryProfilePresentation,
  resolveEphemeralRunnerReviewedRuntimeFacts,
  type EphemeralRunnerEndpointPresentation,
} from './endpointTerminalUi';

/**
 * The shipped native-shell renderer is plain browser JavaScript inside the Tauri
 * bundle, so it is exercised here as the real bytes it ships as. The DOM and the
 * Tauri bridge are genuine system boundaries and are the only things stubbed;
 * every rendering and response decision below is the shell's own.
 */
const SHELL_SOURCE = readFileSync(
  new URL('../../runner-native-shell/web/main.js', import.meta.url),
  'utf8',
);

type StubElement = {
  tagName: string;
  textContent: string;
  hidden: boolean;
  onclick: null | (() => unknown);
  onchange: null | (() => unknown);
  type: string;
  checked: boolean;
  children: StubElement[];
  append: (...nodes: StubElement[]) => void;
  replaceChildren: (...nodes: StubElement[]) => void;
  focus: () => void;
  attributes: Record<string, string>;
  setAttribute: (name: string, value: string) => void;
};

type ShellMessage = Readonly<{ v: 1; requestId: string; response: Record<string, unknown> }>
  | Readonly<{ v: 1; event: Record<string, unknown> }>;

function createHarness(
  commands: Record<string, (args?: Record<string, unknown>) => unknown>,
  options: Readonly<{ listenSettles?: Promise<void> }> = {},
) {
  const focusLog: string[] = [];
  const sent: ShellMessage[] = [];
  const listeners = new Map<string, (event: { payload: string }) => void>();
  // Tauri's `listen` registers through an asynchronous IPC round trip; events
  // emitted before it settles are not delivered to this page.
  const readyAfterListeners: string[][] = [];

  const element = (name: string): StubElement => {
    const node: StubElement = {
      tagName: name,
      textContent: '',
      hidden: false,
      onclick: null,
      onchange: null,
      type: '',
      checked: false,
      children: [],
      append: (...nodes) => { node.children.push(...nodes); },
      replaceChildren: (...nodes) => { node.children = [...nodes]; },
      // Buttons are told apart by their label, so a focus assertion can name the
      // exact control the plan requires to receive focus.
      focus: () => { focusLog.push(node.textContent || name); },
      attributes: {},
      setAttribute: (attribute, value) => { node.attributes[attribute] = value; },
    };
    return node;
  };

  const named = {
    heading: element('heading'),
    status: element('status'),
    detail: element('detail'),
    review: element('review'),
    reviewTitle: element('reviewTitle'),
    facts: element('facts'),
    notice: element('notice'),
    actions: element('actions'),
    polite: element('polite'),
    assertive: element('assertive'),
  };

  const invoke = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'runner_core_send') {
      sent.push(JSON.parse(String(args?.line ?? '')) as ShellMessage);
      return undefined;
    }
    if (name === 'runner_renderer_ready') {
      readyAfterListeners.push([...listeners.keys()]);
      return undefined;
    }
    const command = commands[name];
    if (!command) throw new Error(`unexpected_command:${name}`);
    return command(args);
  });

  const document = {
    documentElement: { lang: 'en' },
    createElement: (tagName: string) => element(tagName),
    querySelector: (selector: string) => {
      const key = selector.replace('#', '') as keyof typeof named;
      return named[key] ?? null;
    },
  };

  const window = {
    __TAURI__: {
      core: { invoke },
      event: {
        listen: (name: string, callback: (event: { payload: string }) => void) => {
          const register = () => {
            listeners.set(name, callback);
            return () => listeners.delete(name);
          };
          return options.listenSettles ? options.listenSettles.then(register) : Promise.resolve(register());
        },
      },
    },
  };

  // The shell resolves its own elements: nothing is injected here, so a renderer
  // that relied on an id-named global (`status` is a legacy Window attribute and
  // is never the element) would fail instead of silently rendering nothing.
  // eslint-disable-next-line no-new-func -- runs the shipped shell bytes under a stubbed DOM boundary
  const run = new Function('window', 'document', SHELL_SOURCE);
  run(window, document);

  const descendants = (node: StubElement): StubElement[] => node.children.flatMap((child) => [child, ...descendants(child)]);
  return {
    named,
    sent,
    focusLog,
    readyAfterListeners,
    emit(value: unknown) {
      listeners.get('runner-core-stdout')?.({ payload: `${JSON.stringify(value)}\n` });
    },
    present(presentation: EphemeralRunnerEndpointPresentation) {
      this.emit({ v: 1, publication: { v: 1, type: 'presentation', presentation } });
    },
    closeWindow() {
      listeners.get('runner-window-close-requested')?.({ payload: '' });
    },
    labels() {
      return named.actions.children.map((child) => child.textContent);
    },
    rendered() {
      return [...descendants(named.facts).map((child) => child.textContent), named.notice.textContent].join('\n');
    },
    descendants,
    documentLanguage() {
      return document.documentElement.lang;
    },
    async click(label: string) {
      const button = named.actions.children.find((child) => child.textContent === label);
      if (!button) throw new Error(`missing_button:${label}. Present: ${named.actions.children.map((c) => c.textContent).join(', ')}`);
      await button.onclick?.();
      await Promise.resolve();
    },
  };
}

const manifest = {
  binding: {
    homeServerIdentityId: 'srv_acme_home',
    creatorAccountId: 'alice-account',
    artifact: { product: 'happier-runner', version: '0.3.0', target: 'linux-x64', sha256: 'b'.repeat(64) },
  },
  preparedAuthoring: {
    actionsSettings: { v: 1, actions: { 'session.activity.get': { enabled: false } } },
    authoring: {
      primaryTeamId: 'team-acme',
      agentTarget: { kind: 'agent', identity: { pluginId: 'dev.happier.codex', localId: 'codex' } },
      modelSelection: { kind: 'model', modelId: 'gpt-5.6' },
      permissionMode: 'safe-yolo',
    },
    composer: { text: 'Fix the checkout race.', references: [], attachments: [] },
    files: [{ id: 'file-1', name: 'trace.txt', mimeType: 'text/plain', sizeBytes: 42, sha256: 'a'.repeat(64) }],
    attachmentDestination: {
      uploadLocation: 'workspace',
      workspaceRelativeDir: '.happier/uploads',
      vcsIgnoreStrategy: 'git_info_exclude',
      vcsIgnoreWritesEnabled: true,
    },
  },
  displayFacts: { v: 1, homeId: 'srv_acme_home', homeName: 'Acme Home 🌍', requesterId: 'alice-account', requesterName: 'Alice Example', teamId: 'team-acme', teamName: '研究開発チーム' },
  credentialSelectionBinding: {
    v: 1,
    resourceId: 'resource-acme',
    brokerMachineId: 'broker-machine',
    revision: 7,
    application: {
      agentTargetKey: 'agent:dev.happier.codex/codex',
      implementationIdentity: { pluginId: 'happier.provider.openai', localId: 'openai' },
      endpointTemplateId: 'responses',
      protocol: 'openai-responses',
    },
    sourceRevision: 'source-revision-7',
  },
  reviewedProviderModel: {
    selection: { kind: 'team_credential_provider_model', resourceId: 'resource-acme', teamId: 'team-acme', expectedResourceRevision: 7, agentTargetKey: 'agent:dev.happier.codex/codex', modelId: 'gpt-5.6' },
    descriptor: { id: 'gpt-5.6', name: 'GPT 5.6 Verified' },
    application: { agentTargetKey: 'agent:dev.happier.codex/codex', implementationIdentity: { pluginId: 'happier.provider.openai', localId: 'openai' }, endpointTemplateId: 'responses', protocol: 'openai-responses' },
    sourceRevision: 'source-revision-7', availability: 'available',
  },
} as unknown as RunnerLaunchManifestV1;

const runningFacts = resolveEphemeralRunnerReviewedRuntimeFacts({
  manifest,
  directory: '/workspace/exact',
});

const failure = Object.freeze({
  kind: 'before_session' as const,
  message: 'The request could not be prepared. Check the activation and try again.',
});

describe('ephemeral Runner native shell renderer', () => {
  it('signals readiness only after both core listeners are installed, and only once', async () => {
    // The shell starts the core on this signal. An event emitted before a
    // listener exists is dropped, so a first folder question sent early would
    // leave the endpoint waiting on buttons it never received.
    let settle!: () => void;
    const listenSettles = new Promise<void>((resolve) => { settle = resolve; });
    const harness = createHarness({}, { listenSettles });
    await Promise.resolve();
    expect(harness.readyAfterListeners).toEqual([]);

    settle();
    await vi.waitFor(() => expect(harness.readyAfterListeners).toHaveLength(1));
    expect(new Set(harness.readyAfterListeners[0])).toEqual(
      new Set(['runner-core-stdout', 'runner-window-close-requested']),
    );

    // The first question after readiness reaches the endpoint.
    harness.emit({ requestId: 'request-1', request: { v: 1, type: 'choose_directory', chooser: resolveEphemeralRunnerDirectoryChoicePresentation() } });
    expect(harness.labels()).toEqual(['Choose folder', 'Cancel request']);
    await Promise.resolve();
    expect(harness.readyAfterListeners).toHaveLength(1);
  });

  it('leaves a cancelled folder dialog unanswered and returns to the same folder choice', async () => {
    // `directory: null` is the endpoint's explicit activation-cancel answer: the
    // core declines the claim on it. A cancelled OS dialog decides nothing, so it
    // must send no response at all and return to the folder choice instead.
    const commands = { runner_pick_directory: (): string | null => null };
    const harness = createHarness(commands);

    harness.emit({ requestId: 'request-1', request: { v: 1, type: 'choose_directory', chooser: resolveEphemeralRunnerDirectoryChoicePresentation() } });
    await harness.click('Choose folder');

    expect(harness.sent).toEqual([]);
    expect(harness.labels()).toEqual(['Choose folder', 'Cancel request']);
    expect(harness.focusLog.at(-1)).toBe('Choose folder');

    // The restored chooser still answers the same outstanding request.
    commands.runner_pick_directory = () => '/workspace/second-try';
    await harness.click('Choose folder');
    expect(harness.sent).toEqual([{
      v: 1,
      requestId: 'request-1',
      response: { v: 1, type: 'directory_selected', directory: '/workspace/second-try' },
    }]);
  });

  it('closes the activation from the folder choice only when Cancel request is explicit', async () => {
    const harness = createHarness({});

    harness.emit({ requestId: 'request-1', request: { v: 1, type: 'choose_directory', chooser: resolveEphemeralRunnerDirectoryChoicePresentation() } });
    await harness.click('Cancel request');

    expect(harness.sent).toEqual([{
      v: 1,
      requestId: 'request-1',
      response: { v: 1, type: 'directory_selected', directory: null },
    }]);
  });

  it('grants only the optional plugin access the endpoint turned on, through Allow', async () => {
    const optionalHostAccess = [
      { id: 'clipboard.write', capability: 'clipboard', reason: 'Copies results', authorizationClass: 'hostResourceSelection', normalizedScope: {} },
      { id: 'network.fetch', capability: 'network', reason: 'Fetches docs', authorizationClass: 'hostResourceSelection', normalizedScope: {} },
    ];
    const pluginInstallation = { optionalHostAccess, requiredHostAccess: [], rawCredentialAccess: [], requestInterceptors: [],
      executableRealms: ['daemon'], pluginId: 'acme.reviewed-external', displayName: 'Reviewed External', version: '1.2.3',
      packageIdentity: { name: '@acme/reviewed-external', version: '1.2.3' },
      publisherIdentity: { status: 'unverified', id: 'acme', displayName: 'Acme' },
      source: { kind: 'npm', locator: '@acme/reviewed-external@1.2.3', integrity: 'sha512-x', integrityBasis: 'expected' },
      updateChannel: { kind: 'npm', packageName: '@acme/reviewed-external', registryOrigin: 'https://registry.npmjs.org' },
      signature: { status: 'notProvided' }, provenance: { status: 'notProvided' },
      curation: { status: 'unreviewed', sourceId: 'marketplace:community-npm' },
    } as never;
    const presentation = resolveEphemeralRunnerConsentReviewPresentation({ manifest, directory: '/workspace/exact', pluginInstallation });
    const harness = createHarness({});

    harness.emit({ requestId: 'request-1', request: { v: 1, type: 'review', review: presentation } });
    // Native checkboxes expose their state both visually and to assistive
    // technology; aria-checked on an otherwise unchanged button did not.
    const choices = harness.descendants(harness.named.actions).filter((child) => child.type === 'checkbox');
    expect(choices).toHaveLength(2);
    expect(choices.map((choice) => choice.checked)).toEqual([false, false]);
    const clipboard = choices[0]!;
    clipboard.checked = true;
    await clipboard.onchange?.();
    await harness.click('Allow');

    const answer = harness.sent[0] as Extract<ShellMessage, { requestId: string }>;
    expect(answer.response).toEqual({ v: 1, type: 'consent_decision', decision: 'allow', optionalSelections: [
      { accessId: 'clipboard.write', selected: true },
      { accessId: 'network.fetch', selected: false },
    ] });

    // The core's adapter turns exactly that answer into the canonical selection.
    const { createEphemeralRunnerNativeShellUi } = await import('./endpointNativeShellUi');
    const ui = createEphemeralRunnerNativeShellUi({
      request: async () => answer.response as never,
      subscribe: () => () => undefined,
    });
    await expect(ui.reviewAndRequestConsent({
      review: { manifest, directory: '/workspace/exact', launchManifestCommitment: 'l', authoringCommitment: 'a' } as never,
      pluginInstallation,
      signal: new AbortController().signal,
    })).resolves.toEqual({ allow: true, optionalSelections: [
      { accessId: 'clipboard.write', selected: true },
      { accessId: 'network.fetch', selected: false },
    ] });
  });

  it('sends a typed private-registry token only through Sign in, and keeps the question open on an empty token', async () => {
    const requirement = { registryOrigin: 'https://npm.acme.example.test', packageName: '@acme/agent', registryProfileId: null };
    const registry = resolveEphemeralRunnerRegistryProfilePresentation({ requirement });
    const harness = createHarness({});

    harness.emit({ requestId: 'request-1', request: { v: 1, type: 'registry_profile', registry } });
    expect(harness.named.reviewTitle.textContent).toBe(registry.title);
    expect(harness.rendered()).toContain('https://npm.acme.example.test');
    const field = harness.named.actions.children[0]!.children[0]! as unknown as { type: string; value?: string };
    expect(field.type).toBe('password');

    await harness.click(registry.signInLabel);
    expect(harness.sent).toEqual([]);

    field.value = '  endpoint-token ';
    await harness.click(registry.signInLabel);
    expect(harness.sent).toEqual([{ v: 1, requestId: 'request-1', response: {
      v: 1, type: 'registry_profile_decision', decision: 'sign_in', token: 'endpoint-token',
    } }]);
    expect(field.value).toBe('');

    const declining = createHarness({});
    declining.emit({ requestId: 'request-2', request: { v: 1, type: 'registry_profile', registry } });
    await declining.click(registry.declineLabel);
    expect(declining.sent).toEqual([{ v: 1, requestId: 'request-2', response: {
      v: 1, type: 'registry_profile_decision', decision: 'decline',
    } }]);
  });

  it('settles activation cancellation only through an explicit decision', async () => {
    const harness = createHarness({});
    const presentation = resolveEphemeralRunnerConsentReviewPresentation({
      manifest,
      directory: '/workspace/exact',
    });

    harness.emit({ requestId: 'request-1', request: { v: 1, type: 'review', review: presentation } });
    await harness.click('Decline');

    expect(harness.sent).toEqual([{
      v: 1,
      requestId: 'request-1',
      response: { v: 1, type: 'consent_decision', decision: 'decline' },
    }]);

    // Closing the window is the endpoint's other explicit route; it reaches the
    // core's one close-decision owner rather than a silent folder answer.
    harness.closeWindow();
    expect(harness.sent.at(-1)).toEqual({ v: 1, event: { v: 1, type: 'close_requested' } });
  });

  it('focuses the primary recovery action the core named, and falls back to Exit', () => {
    const retryable = createHarness({});
    retryable.present(resolveEphemeralRunnerEndpointPresentation({
      phase: 'failed',
      connection: 'connected',
      failure,
      canRetry: true,
    }));
    retryable.emit({ requestId: 'request-1', request: { v: 1, type: 'failure_recovery', failure, canRetry: true, recovery: resolveEphemeralRunnerFailureRecoveryPresentation({ failure }) } });

    expect(retryable.labels()).toEqual(['Retry', 'Exit']);
    expect(retryable.focusLog.at(-1)).toBe('Retry');

    const terminal = createHarness({});
    terminal.present(resolveEphemeralRunnerEndpointPresentation({
      phase: 'failed',
      connection: 'connected',
      failure,
      canRetry: false,
    }));
    terminal.emit({ requestId: 'request-1', request: { v: 1, type: 'failure_recovery', failure, canRetry: false, recovery: resolveEphemeralRunnerFailureRecoveryPresentation({ failure }) } });

    expect(terminal.labels()).toEqual(['Exit']);
    expect(terminal.focusLog.at(-1)).toBe('Exit');
    // A terminal failure states what happened and asks nothing the endpoint
    // cannot answer.
    expect(terminal.rendered()).toContain(failure.message);
    expect(terminal.rendered()).not.toContain(
      resolveEphemeralRunnerFailureRecoveryPresentation({ failure }).question,
    );
    expect(retryable.rendered()).toContain(
      resolveEphemeralRunnerFailureRecoveryPresentation({ failure }).question,
    );
  });

  it('announces and moves focus once per state transition without stealing focus on refetch', () => {
    const harness = createHarness({});
    const connecting = resolveEphemeralRunnerEndpointPresentation({ phase: 'connecting', connection: 'connected' });

    harness.present(connecting);
    expect(harness.named.polite.textContent).toBe('Connecting to Home');
    expect(harness.focusLog).toEqual(['heading']);

    // Re-publishing the same canonical state is a refetch, not a transition.
    harness.present(connecting);
    expect(harness.named.polite.textContent).toBe('');
    expect(harness.focusLog).toEqual(['heading']);

    harness.present(resolveEphemeralRunnerEndpointPresentation({ phase: 'installing_agent', connection: 'connected' }));
    expect(harness.named.polite.textContent).toBe('Installing Agent');
    expect(harness.focusLog).toEqual(['heading', 'heading']);
  });

  it('moves keyboard focus into every outstanding decision without prefocusing Allow', () => {
    const harness = createHarness({});
    harness.present(resolveEphemeralRunnerEndpointPresentation({ phase: 'running', connection: 'connected' }));

    harness.emit({ requestId: 'request-close', request: { v: 1, type: 'confirm_active_close', phase: 'running', confirm: resolveEphemeralRunnerActiveClosePresentation({ phase: 'running' }) } });
    expect(harness.labels()).toEqual(['Keep open', 'Stop Session']);
    expect(harness.focusLog.at(-1)).toBe('Keep open');

    const presentation = resolveEphemeralRunnerConsentReviewPresentation({ manifest, directory: '/workspace/exact' });
    harness.emit({ requestId: 'request-review', request: { v: 1, type: 'review', review: presentation } });
    expect(harness.focusLog.at(-1)).toBe('heading');
    expect(harness.focusLog.at(-1)).not.toBe('Allow');
  });

  it('drops consent-only detail once consent is settled and stays quiet while running', async () => {
    const harness = createHarness({});
    const presentation = resolveEphemeralRunnerConsentReviewPresentation({
      manifest,
      directory: '/workspace/exact',
    });

    harness.emit({ requestId: 'request-1', request: { v: 1, type: 'review', review: presentation } });
    expect(harness.rendered()).toContain('Fix the checkout race.');

    await harness.click('Allow');
    expect(harness.rendered()).not.toContain('Fix the checkout race.');
    expect(harness.named.review.hidden).toBe(true);

    harness.present(resolveEphemeralRunnerEndpointPresentation({
      phase: 'running',
      connection: 'connected',
      reviewedRuntimeSummary: runningFacts,
    }));

    const running = harness.rendered();
    expect(running).toContain('Acme Home 🌍');
    expect(running).toContain('Codex');
    expect(running).toContain('/workspace/exact');
    // Prompt, attachment digests, action policy and the consent notice are
    // consent-only material and never reappear on the running surface.
    expect(running).not.toContain('Fix the checkout race.');
    expect(running).not.toContain('a'.repeat(64));
    expect(running).not.toContain('Action policy');
    expect(harness.named.notice.textContent).toBe('');
    expect(harness.labels()).toEqual(['Stop Session']);
  });

  it('keeps Stop Session reachable after a kept-open window close', async () => {
    const harness = createHarness({});
    harness.present(resolveEphemeralRunnerEndpointPresentation({
      phase: 'running',
      connection: 'connected',
      reviewedRuntimeSummary: runningFacts,
    }));
    expect(harness.labels()).toEqual(['Stop Session']);

    const confirm = resolveEphemeralRunnerActiveClosePresentation({ phase: 'running' });
    harness.emit({ requestId: 'request-1', request: { v: 1, type: 'confirm_active_close', phase: 'running', confirm } });
    expect(harness.labels()).toEqual(['Keep open', 'Stop Session']);
    // The question states its exact consequence and keeps the quiet running
    // facts visible, so the endpoint sees what it is deciding about.
    expect(harness.rendered()).toContain(confirm.consequence);
    expect(harness.rendered()).toContain('/workspace/exact');

    await harness.click('Keep open');
    expect(harness.sent).toEqual([{
      v: 1,
      requestId: 'request-1',
      response: { v: 1, type: 'active_close_decision', decision: 'keep_open' },
    }]);

    // Keeping the window open leaves the Session running, so its Stop control
    // returns instead of leaving a dead button for a settled request.
    expect(harness.labels()).toEqual(['Stop Session']);
    await harness.click('Stop Session');
    expect(harness.sent.at(-1)).toEqual({ v: 1, event: { v: 1, type: 'stop_session' } });
  });

  it('never lets ambient status remove the outstanding decision', () => {
    const harness = createHarness({});
    const presentation = resolveEphemeralRunnerConsentReviewPresentation({
      manifest,
      directory: '/workspace/exact',
    });

    harness.emit({ requestId: 'request-1', request: { v: 1, type: 'review', review: presentation } });
    harness.present(resolveEphemeralRunnerEndpointPresentation({ phase: 'reviewing', connection: 'reconnecting' }));

    expect(harness.named.status.textContent).toBe('Reconnecting');
    expect(harness.named.status.hidden).toBe(false);
    expect(harness.labels()).toEqual(['Decline', 'Allow']);
    expect(harness.rendered()).toContain('Fix the checkout race.');
  });

  it('returns only the folder selected by the endpoint picker', async () => {
    const harness = createHarness({
      runner_pick_directory: () => '/workspace/picked',
    });

    harness.emit({ requestId: 'request-1', request: { v: 1, type: 'choose_directory', chooser: resolveEphemeralRunnerDirectoryChoicePresentation() } });
    await harness.click('Choose folder');
    expect(harness.sent.map((message) => 'response' in message ? message.response : null)).toEqual([
      { v: 1, type: 'directory_selected', directory: '/workspace/picked' },
    ]);
    expect(harness.labels()).not.toContain('Use home folder');
  });

  it('renders every projected review fact and keeps Decline reachable before Allow', async () => {
    const harness = createHarness({});
    const presentation = resolveEphemeralRunnerConsentReviewPresentation({
      manifest,
      directory: '/workspace/exact',
    });

    harness.emit({ requestId: 'request-1', request: { v: 1, type: 'review', review: presentation } });

    const rendered = harness.descendants(harness.named.facts).map((child) => child.textContent);
    for (const section of presentation.sections) {
      expect(rendered).toContain(section.title);
      for (const fact of section.facts) {
        expect(rendered).toContain(fact.label);
        expect(rendered).toContain(fact.value);
      }
    }
    expect(harness.named.notice.textContent).toBe(presentation.notice.join('\n'));
    expect(harness.named.review.hidden).toBe(false);

    const labels = harness.named.actions.children.map((child) => child.textContent);
    expect(labels).toEqual(['Decline', 'Allow']);
    // Allow is never auto-focused: focus lands on the heading above the content.
    expect(harness.focusLog.at(-1)).toBe('heading');

    await harness.click('Allow');
    expect(harness.sent).toEqual([{
      v: 1,
      requestId: 'request-1',
      response: { v: 1, type: 'consent_decision', decision: 'allow' },
    }]);
  });

  it('shows decision facts before technical disclosures in semantic review sections', () => {
    const harness = createHarness({});
    harness.present(resolveEphemeralRunnerEndpointPresentation({ phase: 'reviewing', connection: 'connected' }));
    const presentation = resolveEphemeralRunnerConsentReviewPresentation({ manifest, directory: '/workspace/exact' });
    harness.emit({ requestId: 'request-1', request: { v: 1, type: 'review', review: presentation } });

    const groups = harness.named.facts.children;
    expect(groups.every((group) => group.tagName === 'section')).toBe(true);
    expect(groups.map((group) => group.children[0]?.tagName)).toEqual(presentation.sections.map(() => 'h3'));
    const disclosed = groups.flatMap((group) => harness.descendants(group)
      .filter((node) => node.tagName === 'details')
      .flatMap((node) => harness.descendants(node).map((child) => child.textContent)));
    expect(disclosed).toContain('srv_acme_home');
    expect(disclosed).toContain('gpt-5.6');
    expect(disclosed).not.toContain('Acme Home 🌍');
    expect(disclosed).not.toContain('GPT 5.6 Verified');
    expect(disclosed).not.toContain('Fix the checkout race.');
    for (const entry of presentation.sections.flatMap((group) => group.facts)
      .filter((entry) => ['initial_access', 'action_policy', 'profile', 'environment', 'mcp', 'mcp_material', 'connected_services', 'connected_service_bindings'].includes(entry.id))) {
      expect(disclosed).not.toContain(entry.label);
    }
    expect(harness.named.status.hidden).toBe(true);
  });

  it('keeps a long Unicode verified name intact without displacing either consent action', () => {
    const longName = '研究🌍'.repeat(96);
    const harness = createHarness({});
    const presentation = resolveEphemeralRunnerConsentReviewPresentation({
      manifest: { ...manifest, displayFacts: { ...manifest.displayFacts, teamName: longName } },
      directory: '/workspace/exact',
    });

    harness.emit({ requestId: 'request-long', request: { v: 1, type: 'review', review: presentation } });

    expect(harness.rendered()).toContain(longName);
    expect(harness.labels()).toEqual(['Decline', 'Allow']);
    expect(harness.focusLog.at(-1)).toBe('heading');
  });

  it('renders only the control copy the core resolved, authoring no endpoint labels of its own', async () => {
    // Distinct non-English copy is the discriminating input: a renderer that
    // still owns its own literals keeps rendering English here, which is exactly
    // why endpoint chrome could not follow any copy owner.
    const chooser = {
      title: '作業フォルダを選ぶ',
      dialogTitle: 'Happier Runner の作業フォルダを選ぶ',
      chooseLabel: 'フォルダを選ぶ',
      cancelLabel: '要求を取り消す',
    };
    const confirm = {
      title: 'エージェントはまだ実行中です',
      consequence: '停止するとこのコンピュータのセッションが終了し、この Runner のアクセスが失効します。',
      keepOpenLabel: '開いたままにする',
      stopLabel: 'セッションを停止',
    };
    const recovery = {
      message: failure.message,
      question: 'この起動をやり直しますか、それとも終了しますか？',
      retryLabel: 'やり直す',
      exitLabel: '終了',
    };
    const dialogTitles: unknown[] = [];
    const harness = createHarness({
      runner_pick_directory: (args) => {
        dialogTitles.push(args?.title);
        return '/workspace/picked';
      },
    });

    harness.emit({ requestId: 'request-folder', request: { v: 1, type: 'choose_directory', chooser } });
    expect(harness.labels()).toEqual([chooser.chooseLabel, chooser.cancelLabel]);
    await harness.click(chooser.chooseLabel);
    // The operating system's own folder dialog is endpoint chrome too.
    expect(dialogTitles).toEqual([chooser.dialogTitle]);

    harness.emit({
      v: 1,
      publication: {
        v: 1,
        type: 'presentation',
        presentation: {
          heading: 'Happier Runner',
          status: 'エージェントを実行中',
          detail: null,
          announcement: { priority: 'polite', text: 'エージェントを実行中' },
          focusTarget: 'heading',
          actions: [{ id: 'stop_session', label: confirm.stopLabel }],
          facts: [],
        },
      },
    });
    expect(harness.labels()).toEqual([confirm.stopLabel]);

    harness.emit({ requestId: 'request-close', request: { v: 1, type: 'confirm_active_close', phase: 'running', confirm } });
    expect(harness.labels()).toEqual([confirm.keepOpenLabel, confirm.stopLabel]);
    // The endpoint must be able to read the exact consequence it is deciding on.
    expect(harness.rendered()).toContain(confirm.consequence);
    await harness.click(confirm.keepOpenLabel);

    harness.emit({
      requestId: 'request-recovery',
      request: { v: 1, type: 'failure_recovery', failure, canRetry: true, recovery },
    });
    expect(harness.labels()).toEqual([recovery.retryLabel, recovery.exitLabel]);
    expect(harness.rendered()).toContain(recovery.question);
  });

  it('applies the closed presentation language to the native document', () => {
    const harness = createHarness({});
    harness.present(resolveEphemeralRunnerEndpointPresentation({
      phase: 'running',
      connection: 'connected',
      locale: 'fr',
    }));

    expect(harness.documentLanguage()).toBe('fr');
  });

  it('returns focus to the page heading after every settled decision', async () => {
    const confirm = {
      title: 'The Agent is still running',
      consequence: 'Stopping ends the Session on this computer.',
      keepOpenLabel: 'Keep open',
      stopLabel: 'Stop Session',
    };
    const harness = createHarness({});
    harness.present(resolveEphemeralRunnerEndpointPresentation({ phase: 'running', connection: 'connected' }));

    harness.emit({ requestId: 'request-close', request: { v: 1, type: 'confirm_active_close', phase: 'running', confirm } });
    expect(harness.focusLog.at(-1)).toBe('Keep open');

    await harness.click('Keep open');
    // Settling removes the buttons the question owned. Leaving focus on a
    // detached node drops a keyboard or screen-reader user to the document body
    // with no announced place to resume from.
    expect(harness.focusLog.at(-1)).toBe('heading');

    const review = resolveEphemeralRunnerConsentReviewPresentation({ manifest, directory: '/workspace/exact' });
    harness.emit({ requestId: 'request-review', request: { v: 1, type: 'review', review } });
    await harness.click('Decline');
    expect(harness.focusLog.at(-1)).toBe('heading');
  });
});
