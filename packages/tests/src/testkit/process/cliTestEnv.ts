export function sanitizeCliTestEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized = { ...env };
  // Fixture credentials belong to the fixture server, not an ambient stack.
  delete sanitized.HAPPIER_ACTIVE_SERVER_ID;
  delete sanitized.HAPPIER_DAEMON_SERVICE_INSTANCE_ID;
  delete sanitized.HAPPIER_DAEMON_SERVICE_SERVER_URL;
  return sanitized;
}
