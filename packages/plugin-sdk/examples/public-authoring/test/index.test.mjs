import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('retains the portable production reference package contract', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  // This is a code-defined package. The canonical author build evaluates its
  // `definePlugin(...)` entry and emits the staged cold manifest only for the
  // package artifact; a handwritten source manifest would be a second owner.
  await assert.rejects(
    () => readFile(new URL('../.happier-plugin/plugin.json', import.meta.url), 'utf8'),
    { code: 'ENOENT' },
  );
  const module = await import('../dist/daemon.js');
  const manifest = module.manifest;
  const uiArtifactsManifest = JSON.parse(await readFile(
    new URL('../dist/happier-plugin-ui/ui-artifacts.json', import.meta.url),
    'utf8',
  ));
  const hostedSurface = await readFile(new URL('../ui/reviewPanel.web.tsx', import.meta.url), 'utf8');

  assert.ok(packageJson.dependencies['@happier-dev/plugin-ui']);
  assert.ok(packageJson.files.includes('resources'));
  assert.equal(typeof module.activate, 'function');
  assert.equal(manifest.id, 'examples.public-sdk-review-assistant');
  assert.deepEqual(manifest.contributes.resources, [
    {
      id: 'review-guide',
      source: 'packaged',
      kind: 'template',
      path: 'resources/review-guide.md',
      contentType: 'text/markdown',
    },
    {
      id: 'agent-context-companion-guide',
      source: 'packaged',
      kind: 'template',
      path: 'resources/agent-context-companion-guide.md',
      contentType: 'text/markdown',
    },
    {
      id: 'review-session-status',
      source: 'dynamic',
      kind: 'config',
      contentType: 'text/plain',
      scope: 'session',
      hostAccess: ['review-resource-account'],
      maxBytes: 8192,
    },
    {
      id: 'project-companion-dashboard-document',
      source: 'dynamic',
      kind: 'config',
      contentType: 'application/vnd.happier.declarative-document+json;version=1',
      scope: 'session',
      hostAccess: ['review-resource-account'],
      maxBytes: 8192,
    },
  ]);
  const projectCompanionDashboard = manifest.contributes.ui.views.find(
    (view) => view.id === 'project-companion-dashboard',
  );
  assert.deepEqual(
    manifest.contributes.ui.views.filter((view) => view.id.endsWith('-hosted-html')),
    [
      {
        id: 'review-services-hosted-html',
        container: 'servicesPanel',
        target: { kind: 'services' },
        renderer: 'review-services-hosted-html-renderer',
        title: 'Review service status',
      },
      {
        id: 'review-project-hosted-html',
        container: 'rightSidebarTab',
        target: { kind: 'project' },
        renderer: 'review-project-hosted-html-renderer',
        title: 'Review project status',
      },
    ],
  );
  assert.deepEqual(
    manifest.contributes.ui.renderers.filter((renderer) => renderer.id.endsWith('-hosted-html-renderer')),
    [
      {
        id: 'review-services-hosted-html-renderer',
        kind: 'hostedHtml',
        source: { kind: 'html', html: '<main><h1>Review service</h1><p>Ready for review.</p></main>' },
      },
      {
        id: 'review-project-hosted-html-renderer',
        kind: 'hostedHtml',
        source: { kind: 'html', html: '<main><h1>Project review</h1><p>Ready for review.</p></main>' },
      },
    ],
  );
  assert.deepEqual(
    uiArtifactsManifest.entries
      .map((entry) => entry.contributionId)
      .filter((contributionId) => contributionId.endsWith('-hosted-html-renderer')),
    [],
  );
  assert.deepEqual(
    manifest.contributes.ui.views
      .filter((view) => view.id.startsWith('public-slot-coverage-'))
      .map(({ container, target }) => ({ container, target })),
    [
      { container: 'rightSidebarTab', target: { kind: 'project' } },
      { container: 'rightPane', target: { kind: 'project' } },
      { container: 'detailsTab', target: { kind: 'project' } },
      { container: 'detailsPane', target: { kind: 'session' } },
      { container: 'detailsPane', target: { kind: 'project' } },
    ],
  );
  assert.deepEqual(
    manifest.contributes.ui.views
      .filter((view) => view.container === 'sessionSubagentLaunch' || view.container === 'sessionSubagentDetails')
      .map(({ id, container, target }) => ({ id, container, target })),
    [
      {
        id: 'review-subagent-launch',
        container: 'sessionSubagentLaunch',
        target: { kind: 'session' },
      },
      {
        id: 'review-subagent-details',
        container: 'sessionSubagentDetails',
        target: { kind: 'session' },
      },
    ],
  );
  // The embedded Session widget emits an ordinary `ui.views` inline
  // contribution: a stable qualified surface identity plus the declared
  // renderer chain, with no destination, instance policy or placement.
  assert.deepEqual(
    manifest.contributes.ui.views.filter((view) => view.container === 'sessionWidget'),
    [
      {
        id: 'review-status-widget',
        container: 'sessionWidget',
        target: { kind: 'session' },
        renderer: 'review-native',
        fallbackRenderers: ['review-web'],
        title: 'Review status',
      },
    ],
  );
  // The widget's renderer chain keeps the trusted installed Host API. Both
  // members require `openSurface` and `publishCurrentUiContext`, which the
  // closed caller-authored HTML ceiling (`context | watchContext |
  // readResource | watchResource | executeAction | notify`) forbids. An
  // installed external plugin therefore keeps exactly the same public
  // ABI/capabilities as a built-in; caller HTML restrictions must not apply.
  for (const rendererId of ['review-native', 'review-web']) {
    const renderer = manifest.contributes.ui.renderers.find((entry) => entry.id === rendererId);
    assert.ok(renderer, `installed widget renderer ${rendererId} must be declared`);
    assert.ok(
      renderer.requiredHostMethods.includes('openSurface')
        && renderer.requiredHostMethods.includes('publishCurrentUiContext'),
      `installed widget renderer ${rendererId} must keep methods outside the caller ceiling`,
    );
    assert.ok(
      renderer.requiredHostMethods.includes('executeAction')
        && renderer.requiredHostMethods.includes('readResource')
        && renderer.requiredHostMethods.includes('watchResource'),
      `installed widget renderer ${rendererId} must keep the safe Action/Resource methods`,
    );
  }
  // The widget's safe public Action/tool capability: one safe daemon Action
  // plus the agent/mcp tool that invokes it. The widget calls it through
  // `Action.Execute` with the Session-scoped summary as input.
  const reviewSummary = manifest.contributes.actions.find((action) => action.id === 'review-summary');
  assert.deepEqual(
    {
      id: reviewSummary.id,
      danger: reviewSummary.danger ?? reviewSummary.dangerLevel,
      surfaces: reviewSummary.surfaces,
      target: reviewSummary.execution.target,
      scopes: reviewSummary.scopes,
    },
    {
      id: 'review-summary',
      danger: 'safe',
      surfaces: ['cli', 'agent', 'ui'],
      target: 'daemon',
      scopes: ['global'],
    },
  );
  const reviewSummaryTool = manifest.contributes.tools.find((tool) => tool.id === 'review-summary-tool');
  assert.deepEqual(
    { surfaces: reviewSummaryTool.surfaces, action: reviewSummaryTool.action },
    { surfaces: ['agent', 'mcp'], action: 'review-summary' },
  );
  const nativeSurface = await readFile(new URL('../ui/reviewPanel.native.tsx', import.meta.url), 'utf8');
  assert.match(nativeSurface, /readSessionWidgetMount/u);
  assert.match(nativeSurface, /readReviewWidgetView\(context\.launchInput\)/u);
  assert.match(nativeSurface, /useLivePluginResource\('review-session-status'\)/u);
  assert.match(nativeSurface, /Action\.Execute[\s\S]*?action="review-summary"/u);
  assert.match(hostedSurface, /mount\.kind === 'embedded' && mount\.role === 'sessionWidget'/u);
  const reviewAgent = manifest.contributes.agents.find((agent) => agent.id === 'review-agent');
  assert.deepEqual(
    reviewAgent.ui.components.slots.map(({ slot, surfaceId }) => ({ slot, surfaceId })),
    [
      { slot: 'sessionSubagents.launchCards', surfaceId: 'review-subagent-launch' },
      { slot: 'sessionSubagents.teammateDetailsTab', surfaceId: 'review-subagent-details' },
    ],
  );
  assert.deepEqual(manifest.contributes.ui.translations[0].messages, {
    'review.subagents.launch.title': 'Launch review teammate',
    'review.subagents.launch.subtitle': 'Start a focused teammate in this review Session.',
  });
  assert.deepEqual(manifest.contributes.sessionInfoSections, [{
    id: 'project-companion-status',
    resourceId: 'project-companion-dashboard-document',
    order: 40,
    actions: ['open-review-status'],
  }]);
  assert.deepEqual(projectCompanionDashboard, {
    id: 'project-companion-dashboard',
    container: 'rightPane',
    target: { kind: 'session' },
    renderer: 'project-companion-dashboard-renderer',
    title: 'Project Companion',
    instancePolicy: 'singleton',
  });
  const projectCompanionDashboardRenderer = manifest.contributes.ui.renderers.find(
    (renderer) => renderer.id === 'project-companion-dashboard-renderer',
  );
  assert.deepEqual(projectCompanionDashboardRenderer, {
    id: 'project-companion-dashboard-renderer',
    kind: 'declarative',
    root: {
      kind: 'group',
      title: 'Project Companion',
      description: 'Live review status for the current Session.',
      children: [{
        kind: 'status',
        label: 'Review status',
        value: 'Waiting for the current review status.',
      }],
    },
    documentSource: {
      kind: 'resource',
      resourceId: 'project-companion-dashboard-document',
    },
  });
  const openProjectCompanionDashboard = manifest.contributes.sessionHeaderActions?.find(
    (action) => action.id === 'open-project-companion-dashboard',
  );
  assert.deepEqual(openProjectCompanionDashboard, {
    id: 'open-project-companion-dashboard',
    title: 'Open Project Companion',
    command: {
      kind: 'openSurface',
      destination: 'project-companion-dashboard',
    },
  });
  const projectCompanionActivity = manifest.contributes.ui.views.find(
    (view) => view.id === 'project-companion-activity-log',
  );
  assert.deepEqual(projectCompanionActivity, {
    id: 'project-companion-activity-log',
    container: 'bottomPane',
    target: { kind: 'session' },
    renderer: 'review-native',
    fallbackRenderers: ['review-web'],
    title: 'Project Companion activity',
    instancePolicy: 'singleton',
  });
  const projectCompanionProjectActivity = manifest.contributes.ui.views.find(
    (view) => view.id === 'project-companion-project-activity-log',
  );
  assert.deepEqual(projectCompanionProjectActivity, {
    id: 'project-companion-project-activity-log',
    container: 'bottomPane',
    target: { kind: 'project' },
    renderer: 'review-native',
    fallbackRenderers: ['review-web'],
    title: 'Project Companion activity',
    instancePolicy: 'singleton',
  });
  const openProjectCompanionActivity = manifest.contributes.sessionHeaderActions?.find(
    (action) => action.id === 'open-project-companion-activity',
  );
  assert.deepEqual(openProjectCompanionActivity, {
    id: 'open-project-companion-activity',
    title: 'Open Project Companion activity',
    command: {
      kind: 'openSurface',
      destination: 'project-companion-activity-log',
    },
  });
  // The packed author toolchain must accept the real Workflow authoring scope
  // on both scoped Composer families, and emit it unchanged into the manifest.
  assert.deepEqual(
    manifest.contributes.composerControls.map(({ id, scopes }) => ({ id, scopes })),
    [{ id: 'add-review-evidence', scopes: ['workflowAuthoring'] }],
  );
  assert.deepEqual(
    manifest.contributes.composerRegions.map(({ id, scopes }) => ({ id, scopes })),
    [{ id: 'review-context', scopes: ['workflowAuthoring'] }],
  );
  assert.match(hostedSurface, /readResource\(\s*'review-guide'/u);
  assert.doesNotMatch(hostedSurface, /(?:window\.parent|location\.(?:search|hash)|URLSearchParams)/u);
  assert.match(
    hostedSurface,
    /watchContext\(\(surface\) => applyContext\(root, surface\), \{ signal: context\.signal \}\)/u,
  );
  assert.match(
    hostedSurface,
    /host\.executeAction\([\s\S]*?signal === undefined \? undefined : \{ signal \}/u,
  );
  assert.match(
    hostedSurface,
    /summarizeReview\(\s*context\.hostApi,\s*'The review is ready\. Follow-up is needed\.',\s*context\.signal,?\s*\)/u,
  );
});
