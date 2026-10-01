export type MachinesSummary = Readonly<{
    hasUnknownServers: boolean;
    machineCount: number;
    onlineCount: number;
}>;

export function computeMachinesSummary(
    servers: ReadonlyArray<Readonly<{ machineCount: number | null; onlineCount: number | null }>>,
): MachinesSummary {
    let hasUnknownServers = false;
    let machineCount = 0;
    let onlineCount = 0;
    for (const server of servers) {
        if (server.machineCount === null || server.onlineCount === null) {
            hasUnknownServers = true;
            continue;
        }
        machineCount += server.machineCount;
        onlineCount += server.onlineCount;
    }
    return { hasUnknownServers, machineCount, onlineCount };
}
