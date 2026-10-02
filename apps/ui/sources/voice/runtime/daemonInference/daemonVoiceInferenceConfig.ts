export function resolveDaemonStreamingSttJsonRpcCompatibilityAllowed(): boolean {
    const raw = String(process.env.EXPO_PUBLIC_HAPPIER_VOICE_DAEMON_STT_JSON_RPC_COMPAT ?? '').trim().toLowerCase();
    return raw !== '0' && raw !== 'false' && raw !== 'forbid' && raw !== 'disabled';
}
