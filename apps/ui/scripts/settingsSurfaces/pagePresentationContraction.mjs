#!/usr/bin/env node
/** U10: remove redundant page props, and report every list that needs classification before the flip.
 * Dry run by default; the shared runner preserves unrelated hunks and re-plans current bytes.
 */
import { readFileSync } from 'node:fs';
import {
    absOf, applyEdits, attrExpression, createRunner, forEachDescendant, getAttr, isJsx,
    lineOf, listUiFiles, parseSource, removalEditForAttr, tagNameOf, ts,
} from './lib.mjs';

const runner = createRunner('pagePresentationContraction');
// Observed U10 inventory: these are floating pickers, navigation rails, embedded collection
// scrollers or transcript surfaces. Their prior presentation is covered by invariant I1.
const groupedFiles = new Set([
    'sources/app/(app)/new/pick/path.tsx',
    'sources/app/(app)/new/pick/preview-machine.tsx',
    'sources/app/(app)/session/[id]/log.tsx',
    'sources/app/(app)/share/[token].tsx',
    'sources/components/browser/launchpad/BrowserLaunchpad.tsx',
    'sources/components/machines/MachineReplacementPickerModal.tsx',
    'sources/components/projects/ProjectsListView.tsx',
    'sources/components/secrets/SecretsList.tsx',
    'sources/components/sessions/handoff/SessionHandoffPickerModal.tsx',
    'sources/components/sessions/shell/SessionsListEmptyState.tsx',
    'sources/components/settings/home/governance/HomeConsoleNavigation.tsx',
    'sources/components/settings/home/governance/HomeInvitePeopleDialog.tsx',
    'sources/components/settings/mcpServers/McpBindingOverridesEditorModal.tsx',
    'sources/components/settings/mcpServers/McpWorkspaceRootPickerModal.tsx',
    'sources/components/settings/shell/SettingsSidebar.tsx',
    'sources/components/ui/forms/valueRefs/SavedSecretPickerModal.tsx',
    'sources/components/ui/forms/valueRefs/ValueRefEditorModal.tsx',
    'sources/components/ui/lists/collection/CollectionList.tsx',
    'sources/components/workflows/column/WorkflowsColumn.tsx',
    'sources/components/workspaces/sync/openWorkspaceSyncAddMachine.tsx',
    'sources/voice/pickers/VoiceSessionSpawnPickerModal.tsx',
]);
for (const rel of listUiFiles()) {
    if (!runner.selected(rel)) continue;
    if (!readFileSync(absOf(rel), 'utf8').includes('<ItemList')) continue;
    runner.processFile(rel, (text) => {
        const sf = parseSource(rel, text);
        const edits = [];
        forEachDescendant(sf, (node) => {
            if (!isJsx(node) || tagNameOf(node) !== 'ItemList') return;
            const presentation = getAttr(node, 'presentation');
            const value = attrExpression(presentation);
            const line = lineOf(sf, node.getStart(sf));
            if (!presentation && groupedFiles.has(rel)) {
                edits.push({ start: node.openingElement?.tagName.getEnd() ?? node.tagName.getEnd(),
                    end: node.openingElement?.tagName.getEnd() ?? node.tagName.getEnd(), text: ' presentation="grouped"' });
                runner.match(rel, line, 'non-page presentation preserved');
                return;
            }
            if (value && ts.isStringLiteral(value) && value.text === 'page') {
                edits.push(removalEditForAttr(text, presentation, sf));
                runner.match(rel, line, 'redundant page prop removed');
            } else {
                runner.skip(rel, line, presentation ? 'explicit non-page or dynamic presentation' : 'unmarked list: classify page or grouped before default flip');
            }
        });
        return applyEdits(text, edits);
    });
}
runner.finish();
