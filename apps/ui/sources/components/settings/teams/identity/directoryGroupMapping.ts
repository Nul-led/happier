import type { TeamDirectoryGroupV1, TeamExternalGroupBindingSetInputV1 } from '@happier-dev/protocol/teams';

type MappingGroup = Pick<TeamDirectoryGroupV1, 'sourceId' | 'externalGroupId' | 'mapping'>;
type MappingTarget = TeamExternalGroupBindingSetInputV1['target'];

type MappingCommand =
    | Readonly<{ kind: 'set'; externalGroupId: string; target: MappingTarget }>
    | Readonly<{ kind: 'remove'; bindingId: string }>;

export async function runDirectoryGroupMappingChange(input: Readonly<{
    sourceId: string;
    group: MappingGroup;
    target: MappingTarget | null;
    execute: (command: MappingCommand) => Promise<
        | Readonly<{ ok: true }>
        | Readonly<{ ok: false; approvalPending?: true; code: string }>
    >;
}>): Promise<Readonly<
    | { ok: true }
    | { ok: false; approvalPending?: true; code: string }
>> {
    if (input.group.sourceId !== input.sourceId) {
        return { ok: false, code: 'directory_group_source_mismatch' };
    }

    const mapping = input.group.mapping;
    let result: Awaited<ReturnType<typeof input.execute>>;
    if (input.target === null) {
        if (mapping.state === 'unbound') return { ok: true };
        result = await input.execute({ kind: 'remove', bindingId: mapping.bindingId });
    } else {
        result = await input.execute({
            kind: 'set',
            externalGroupId: input.group.externalGroupId,
            target: input.target,
        });
    }
    if (result.ok) return { ok: true };
    return result.approvalPending
        ? { ok: false, approvalPending: true, code: result.code }
        : { ok: false, code: result.code };
}
