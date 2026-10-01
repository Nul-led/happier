/** Service definition metadata must never become a nested daemon/session install request. */
export function stripDaemonServiceInstallRequestEnv(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...environment };
  delete env.HAPPIER_DAEMON_SERVICE_MANAGED_BY;
  delete env.HAPPIER_DAEMON_SERVICE_BUNDLE_ID;
  delete env.HAPPIER_DAEMON_SERVICE_AUTOSTART;
  return env;
}
