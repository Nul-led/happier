export const SELECTOR_JOBS = Object.freeze({
  run_ui_e2e: ['ui-e2e'],
  run_workspace_sync_real: ['workspace-sync-real'],
  run_workspace_sync_performance: ['workspace-sync-real'],
  run_mobile_e2e_android: ['mobile-e2e-android'],
  run_mobile_e2e_ios: ['mobile-e2e-ios'],
  run_ui: ['ui-unit', 'ui-integration', 'ui', 'shared-packages-unit'],
  run_plugin_workspaces: ['plugin-workspaces-unit'],
  run_server: ['server'],
  run_home_iroh_real: ['home-iroh-real'],
  run_server_db_contract: ['server-db-contract'],
  run_cli: ['cli'],
  run_stack: ['stack'],
  run_typecheck: ['typecheck'],
  run_cli_daemon_e2e: ['cli-daemon-e2e'],
  run_e2e_core: ['e2e-core'],
  run_e2e_core_slow: ['e2e-core-slow'],
  run_providers: ['release_actor_guard', 'providers'],
  run_stress: ['stress'],
  run_release_contracts: ['release-contracts'],
  run_installers_smoke: ['installers-smoke-linux', 'installers-smoke-macos', 'installers-smoke-windows'],
  run_artifact_verify: ['artifact-verify'],
  run_binary_smoke: ['binary-smoke'],
  run_cli_update_continuity: ['cli-update-continuity'],
  run_daemon_continuity: ['daemon-continuity'],
  run_session_continuity: ['session-continuity'],
  run_release_assets_docker: ['release-assets-docker'],
  run_self_host_systemd: ['self-host-systemd-e2e'],
  run_self_host_launchd: ['self-host-launchd-e2e'],
  run_self_host_schtasks: ['self-host-schtasks-e2e'],
  run_self_host_daemon: ['self-host-daemon-e2e'],
});

// Default jobs whose guarded command must execute. The two path-filtered jobs
// remain ordinary workflow defaults, but an irrelevant-path success is valid;
// their actual failures are still rejected by collectCiSummary's non-required
// branch. An explicit selector below always makes its jobs required.
const DEFAULT_REQUIRED = new Set([
  'run_ui',
  'run_plugin_workspaces',
  'run_server',
  'run_home_iroh_real',
  'run_server_db_contract',
  'run_cli',
  'run_stack',
  'run_typecheck',
  'run_cli_daemon_e2e',
  'run_e2e_core',
  'run_release_contracts',
  'run_installers_smoke',
  'run_binary_smoke',
]);

const WORKFLOW_CALL_ONLY = new Set([
  'run_mobile_e2e_android',
  'run_mobile_e2e_ios',
  'run_e2e_core_slow',
  'run_release_assets_docker',
]);

const DISPATCH_OR_CALL_ONLY = new Set([
  'run_providers',
  'run_self_host_systemd',
  'run_self_host_launchd',
  'run_self_host_schtasks',
  'run_self_host_daemon',
]);

export function jobsForSelectedInputs({ inputs, eventName }) {
  const explicitlySelected = inputs.select_jobs_explicitly === true;
  const jobs = new Set(['cliproxyapi-managed-runtime', 'trusted_ref_guard']);
  for (const [selector, selectedJobs] of Object.entries(SELECTOR_JOBS)) {
    const eventAllows = !WORKFLOW_CALL_ONLY.has(selector) || eventName === 'workflow_call';
    const dispatchAllows = !DISPATCH_OR_CALL_ONLY.has(selector)
      || eventName === 'workflow_call'
      || eventName === 'workflow_dispatch';
    const selected = eventAllows
      && dispatchAllows
      && (inputs[selector] === true || (!explicitlySelected && DEFAULT_REQUIRED.has(selector)));
    if (selected) for (const job of selectedJobs) jobs.add(job);
  }
  return jobs;
}

export function collectCiSummary({ needs, requiredJobs }) {
  const ids = new Set([...Object.keys(needs), ...requiredJobs]);
  const lanes = [...ids].map((id) => ({
    id,
    required: requiredJobs.has(id),
    result: needs[id]?.result ?? null,
    conclusion: needs[id]?.conclusion ?? null,
    outputs: needs[id]?.outputs ?? {},
  }));
  const failures = lanes.filter(({ required, result, outputs }) => (
    required
      ? result !== 'success' || outputs.command_executed === 'false'
      : result !== 'success' && result !== 'skipped'
  ));
  return { lanes, failures };
}
