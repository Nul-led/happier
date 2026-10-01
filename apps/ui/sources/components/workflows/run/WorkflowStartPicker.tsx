import * as React from 'react';
import { BUILTIN_WORKFLOW_CATALOG_V1, type WorkflowDefinitionV1, type WorkflowRunStartRequestV1 } from '@happier-dev/protocol';
import { SelectionList, type SelectionListStep } from '@/components/ui/selectionList';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { View } from 'react-native';
import { t, tLoose } from '@/text';
import { getWorkflowDefinition } from '@/sync/domains/workflows/workflowDefinitionActions';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { useWorkflowDefinitionLibrary } from '../library/workflowLibraryReads';

export type WorkflowStartSelection = Readonly<{
    id: string;
    name: string;
    description: string;
    definition: WorkflowDefinitionV1;
    source: WorkflowRunStartRequestV1['source'];
}>;

/** Only mounted while the Workflow chip is open; FIN owns the Account library and exact reads. */
export function WorkflowStartPicker(props: Readonly<{
    onSelect: (selection: WorkflowStartSelection) => void;
    onRequestClose: () => void;
    maxHeight: number;
}>): React.ReactElement {
    const library = useWorkflowDefinitionLibrary();
    const savedSelections = React.useRef(new Map<string, Readonly<{
        selection: WorkflowStartSelection;
        lifetime: NonNullable<ReturnType<typeof captureActiveServerAccountScopeLifetime>>;
    }>>());
    const builtinSelections = React.useMemo(() => BUILTIN_WORKFLOW_CATALOG_V1.map((entry): WorkflowStartSelection => ({
        id: entry.id, name: tLoose(entry.titleKey), description: tLoose(entry.descriptionKey),
        definition: entry.definition, source: { kind: 'catalog', workflow: entry.id },
    })), []);
    const asks = React.useCallback((definition: WorkflowDefinitionV1) => definition.inputs.length === 0
        ? t('workflows.start.noInputs')
        : t('workflows.start.asksFor', { names: definition.inputs.map((input) => input.name).join(', ') }), []);
    const rootStep = React.useMemo<SelectionListStep>(() => ({
        id: 'workflow-start-picker', inputPlaceholder: t('workflows.start.search'),
        sections: [
            { kind: 'static', id: 'builtins', title: t('workflows.start.builtin'), options: builtinSelections.map((entry) => ({
                id: entry.id, label: entry.name, subtitle: asks(entry.definition),
                testID: `workflow-choice:${entry.id}`,
                disabled: BUILTIN_WORKFLOW_CATALOG_V1.find((candidate) => candidate.id === entry.id)?.requiresOriginSession,
            })) },
            { kind: 'dynamic', id: 'library', title: t('workflows.start.library'),
                resolverKey: JSON.stringify(library.definitions.map((entry) => [entry.definitionId, entry.revision])),
                showSkeletonsOnFirstLoad: true,
                resolve: async (query, signal) => {
                    const lifetime = captureActiveServerAccountScopeLifetime();
                    if (lifetime === null) return { options: [] };
                    // Hydrate only the matching loaded page, through FIN's exact read. No second catalog/cache.
                    const rows = await Promise.all(library.definitions.filter((entry) =>
                        entry.metadata.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
                    ).map(async (header) => {
                        const result = await getWorkflowDefinition({ definitionId: header.definitionId, signal });
                        return {
                            id: result.definitionId, name: result.metadata.title, description: result.metadata.description ?? '',
                            definition: result.definition,
                            source: { kind: 'saved', definitionId: result.definitionId, revision: result.revision },
                        } satisfies WorkflowStartSelection;
                    }));
                    if (signal.aborted || !lifetime.isCurrent()) return { options: [] };
                    savedSelections.current = new Map(rows.map((entry) => [entry.id, { selection: entry, lifetime }]));
                    return { options: rows.map((entry) => ({ id: entry.id, label: entry.name, subtitle: asks(entry.definition) })) };
                },
            },
        ],
    }), [asks, builtinSelections, library.definitions]);
    return <View>
        <SelectionList rootStep={rootStep} maxHeight={props.maxHeight} heightBehavior="content" autoFocusInputOnWeb
            onSelect={(id) => {
                const saved = savedSelections.current.get(id);
                const selection = builtinSelections.find((entry) => entry.id === id)
                    ?? (saved?.lifetime.isCurrent() ? saved.selection : undefined);
                if (!selection) return;
                props.onSelect(selection);
                props.onRequestClose();
            }} onRequestClose={props.onRequestClose} />
        {library.failure ? <RoundButton size="small" display="inverted" title={t('common.retry')} onPress={library.retry} /> : null}
        {library.hasMore ? <RoundButton size="small" display="inverted" title={t('common.loadMore')}
            loading={library.loadingMore} onPress={library.loadMore} /> : null}
    </View>;
}
