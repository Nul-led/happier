import type { ArtifactAccessGrantRowV1 } from '@happier-dev/protocol';
import type { SelectionListOption } from '@/components/ui/selectionList';
import { t } from '@/text';
import type { ShareSheetAdapter, ShareUiError, ShareUiReason } from '../shareSheetTypes';

/** The Artifact kinds the one documents adapter shares (FIN workflows; ORC roles and launch profiles). */
export type DocumentShareKind = 'workflow-definition.v1' | 'role.v1' | 'launch-profile.v1';

function documentUseHelp(kind: DocumentShareKind): string {
    switch (kind) {
        case 'workflow-definition.v1': return t('shareSheet.documents.help.workflowUse');
        case 'role.v1': return t('shareSheet.documents.help.roleUse');
        case 'launch-profile.v1': return t('shareSheet.documents.help.profileUse');
    }
}

/**
 * The kind's sharing rules. A workflow shared with a Team shows that Team every run; anyone else's
 * runs and triggers stay their own. A profile never carries a secret value.
 */
function documentShareNotes(kind: DocumentShareKind, grants: readonly ArtifactAccessGrantRowV1[]): readonly string[] {
    switch (kind) {
        case 'workflow-definition.v1': {
            const team = grants.some((row) => row.principal.kind === 'team');
            const personal = grants.length === 0 || grants.some((row) => row.principal.kind !== 'team');
            return [
                ...(personal ? [t('shareSheet.documents.notes.personalRuns')] : []),
                ...(team ? [t('shareSheet.documents.notes.teamRuns')] : []),
            ];
        }
        case 'role.v1': return [t('shareSheet.documents.notes.roleLive')];
        case 'launch-profile.v1': return [t('shareSheet.documents.notes.profileSecrets')];
    }
}

/**
 * The documents meaning of the one share sheet, over FIN's Artifact grants: "Can use / Can edit /
 * Admin" for every document kind, the kind's own help and rules, Copy link and Send a copy instead
 * when the host supplies them.
 */
export function createDocumentShareAdapter(input: Readonly<{
    kind: DocumentShareKind;
    grants: readonly ArtifactAccessGrantRowV1[];
    linkPath?: string;
    sendCopy?: () => void;
    loading: boolean;
    issue?: ShareUiError;
    notice?: ShareUiReason;
    readOnly: boolean;
    retryContent(): void;
}>): ShareSheetAdapter {
    return {
        namespace: 'document-share',
        title: t('shareSheet.documents.title'),
        levels: {
            view: { label: t('shareSheet.documents.levels.canUse'), help: documentUseHelp(input.kind) },
            edit: { label: t('shareSheet.documents.levels.canEdit'), help: t('shareSheet.documents.help.editForEveryone') },
            admin: { label: t('shareSheet.documents.levels.admin'), help: t('shareSheet.documents.help.adminOwnerShares') },
        },
        notes: documentShareNotes(input.kind, input.grants),
        ...(input.linkPath ? { linkPath: input.linkPath } : {}),
        ...(input.sendCopy ? { sendCopy: input.sendCopy } : {}),
        sections: () => {
            const notices: SelectionListOption[] = [];
            if (input.loading) notices.push({ id: 'loading', label: t('common.loading'), loading: true, disabled: true });
            const issue = input.issue;
            if (issue) notices.push({ id: 'issue', label: issue.message, onSelect: issue.retryable ? input.retryContent : undefined,
                ...(issue.retryable ? { subtitle: t('common.retry') } : {}) });
            if (input.notice) notices.push({ id: 'notice', label: input.notice.message, disabled: true });
            if (input.readOnly) notices.push({ id: 'read-only', label: t('shareSheet.documents.errors.ownerOnly'), disabled: true });
            return notices.length ? { trailing: [{ kind: 'static', id: 'status', options: notices }] } : {};
        },
    };
}
