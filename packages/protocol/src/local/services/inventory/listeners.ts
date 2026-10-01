/** One local listener despite IPv4/IPv6 bindings; separate machines and LAN interfaces remain distinct. */
export function localServiceListenerGroupKey(listener: Readonly<{
  machineId: string;
  protocol: string;
  port: number;
  address: Readonly<{ kind: string; host: string }>;
}>): string {
  const host = listener.address.kind === 'loopback' || listener.address.kind === 'wildcard'
    ? 'local' : listener.address.host;
  return JSON.stringify([listener.machineId, listener.protocol, listener.port, host]);
}
