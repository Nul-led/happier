function readRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

export function readNativeSshBootstrapDedupeKey(spec: Readonly<{
    kind: string;
    params: unknown;
}>): string {
    const params = readRecord(spec.params);
    const remoteHostId = typeof params.remoteHostId === 'string' && params.remoteHostId.trim()
        ? params.remoteHostId.trim()
        : JSON.stringify(params.ssh ?? {});
    return `${remoteHostId}:${spec.kind}`;
}
