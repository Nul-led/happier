import type { AccountSettings } from '@happier-dev/protocol';

import {
  buildCliSessionRowModel,
  UNKNOWN_CLI_SESSION_AGENT_LABEL,
  type CliSessionRowModel,
} from '@/cli/output/session/buildCliSessionRowModel';
import type { StoredCredentials } from '@/persistence';
import type { ResolvedContributionRegistry } from '@/plugins/projection/registry/types';
import type { fetchSessionsPage, RawSessionListRow } from '@/session/transport/http/sessionsHttp';
import { compactHomePath } from '@/ui/format/styles';
import type { SessionActionSelectorRow } from '@/ui/ink/SessionActionSelector';
import { formatSessionListMetadataUpgradeNotice } from './session/sessionListPresentation';
import { buildAttachSelectionModel, buildAttachSelectionModelFromSessions, formatAttachIneligibilityFooter } from './attachInteractiveSelection';

type FetchSessionsPageFn = typeof fetchSessionsPage;

type ResumeContributionRegistry = Pick<ResolvedContributionRegistry, 'agentDefinitionsById'>;

export type ResumeSelectionFooterHint = Readonly<{
  ineligibleCount: number;
  resumableCount: number;
  activeRunningCount: number;
  metadataUpgradeRequiredCount?: number;
}>;

export type ResumeSelectionModel = Readonly<{
  rows: SessionActionSelectorRow[];
  hint: ResumeSelectionFooterHint;
}>;

type ContinueSelectionParams = Parameters<typeof buildAttachSelectionModel>[0] & Parameters<typeof buildResumeSelectionModel>[0];

export async function buildContinueSelectionModel(params: ContinueSelectionParams): Promise<Readonly<{
  rows: SessionActionSelectorRow[];
  probeSessionIdFn?: (sessionId: string) => Promise<{ reachable: boolean; reason?: string }>;
  footerHint: string | null;
}>> {
  const [recentPage, activePage] = await Promise.all([
    params.fetchSessionsPageFn({ token: params.credentials.token, limit: 200 }),
    params.fetchSessionsPageFn({ token: params.credentials.token, limit: 200, activeOnly: true }),
  ]);
  // Keep both discovery windows: older running sessions may not be in the recent
  // page. Active-feed membership wins an overlapping stopped observation so a
  // running session cannot also be offered for vendor resume.
  const sessionsById = new Map(recentPage.sessions.map((session) => [session.id, session]));
  for (const session of activePage.sessions) sessionsById.set(session.id, session);
  const sessions = [...sessionsById.values()];
  const stopped = buildResumeSelectionModelFromSessions({
    ...params,
    sessions: sessions.filter((session) => session.active !== true),
    metadataUpgradeRequiredCount: recentPage.metadataUpgradeRequiredCount,
  });
  const running = await buildAttachSelectionModelFromSessions({
    ...params,
    sessions: sessions.filter((session) => session.active === true),
  });
  const rows = [
    ...running.rows.map((row) => ({ ...row, annotation: row.annotation ?? (row.disabled ? null : 'running') })),
    ...stopped.rows.map((row) => ({ ...row, annotation: row.annotation ?? (row.disabled ? null : 'stopped') })),
  ];
  rows.sort((left, right) => {
    if (left.disabled !== right.disabled) return left.disabled ? 1 : -1;
    return right.updatedAt - left.updatedAt;
  });
  const footerHint = [
    formatAttachIneligibilityFooter(running.hint),
    formatResumeSelectionFooter({ ...stopped.hint, activeRunningCount: 0 }),
  ].filter((value): value is string => Boolean(value)).join(' ');
  return {
    rows,
    probeSessionIdFn: running.probeSessionIdFn,
    footerHint: footerHint || null,
  };
}

type ResumeIneligibilityCategory =
  | 'vendor_resume_not_supported'
  | 'vendor_resume_id_missing'
  | 'experimental_disabled'
  | 'path_unknown'
  | 'unknown';

function classifyResumeIneligibility(rowModel: CliSessionRowModel): ResumeIneligibilityCategory {
  if (!rowModel.path) return 'path_unknown';
  if (rowModel.vendorResume.eligible) return 'unknown';
  switch (rowModel.vendorResume.reasonCode) {
    case 'agent_unsupported':
      return 'vendor_resume_not_supported';
    case 'vendor_resume_id_missing':
      return 'vendor_resume_id_missing';
    case 'experimental_disabled':
    case 'backend_disabled_by_account_settings':
      return 'experimental_disabled';
    default:
      return 'unknown';
  }
}

function shortReasonForResume(category: ResumeIneligibilityCategory): string {
  switch (category) {
    case 'vendor_resume_not_supported':
      return 'agent does not support resume';
    case 'vendor_resume_id_missing':
      return 'vendor resume id missing';
    case 'experimental_disabled':
      return 'resume disabled in settings';
    case 'path_unknown':
      return 'working directory missing';
    default:
      return 'cannot be resumed';
  }
}

function fullReasonForResume(category: ResumeIneligibilityCategory): string {
  switch (category) {
    case 'vendor_resume_not_supported':
      return 'This session agent does not support resume from the CLI.';
    case 'vendor_resume_id_missing':
      return 'The vendor resume id is missing from this session metadata.';
    case 'experimental_disabled':
      return 'Resume is disabled by your account settings.';
    case 'path_unknown':
      return 'This session has no working directory recorded; CLI resume needs one.';
    default:
      return 'This session cannot be resumed from this CLI.';
  }
}

function buildBaseRow(rowModel: CliSessionRowModel): SessionActionSelectorRow {
  const path = compactHomePath(rowModel.path) || rowModel.path || '';
  return {
    sessionId: rowModel.id,
    agentId: rowModel.agentId ?? UNKNOWN_CLI_SESSION_AGENT_LABEL,
    updatedAt: rowModel.updatedAt,
    title: [rowModel.tag, rowModel.title].filter((value) => typeof value === 'string' && value.trim().length > 0).join(' · '),
    path,
    annotation: null,
    probeable: false,
    disabled: false,
    disabledReason: null,
  };
}

export async function buildResumeSelectionModel(params: Readonly<{
  credentials: StoredCredentials;
  accountSettings: AccountSettings;
  fetchSessionsPageFn: FetchSessionsPageFn;
  contributionRegistry: ResumeContributionRegistry | null;
  accountEncryptionMode: 'plain' | 'e2ee';
}>): Promise<ResumeSelectionModel> {
  const page = await params.fetchSessionsPageFn({ token: params.credentials.token, limit: 200 });
  return buildResumeSelectionModelFromSessions({
    ...params,
    sessions: page.sessions,
    metadataUpgradeRequiredCount: page.metadataUpgradeRequiredCount,
  });
}

function buildResumeSelectionModelFromSessions(params: Readonly<
  Omit<Parameters<typeof buildResumeSelectionModel>[0], 'fetchSessionsPageFn'> & {
    sessions: readonly RawSessionListRow[];
    metadataUpgradeRequiredCount?: number;
  }
>): ResumeSelectionModel {
  const rows: SessionActionSelectorRow[] = [];
  let activeRunningCount = 0;
  let ineligibleCount = 0;
  let resumableCount = 0;

  for (const rawSession of params.sessions) {
    const rowModel = buildCliSessionRowModel({
      credentials: params.credentials,
      accountEncryptionMode: params.accountEncryptionMode,
      rawSession,
      accountSettings: params.accountSettings,
      contributionRegistry: params.contributionRegistry,
    });
    if (rowModel.isSystem) continue;
    if (rowModel.archivedAt !== null) continue;
    if (rowModel.active === true) {
      activeRunningCount += 1;
      continue;
    }

    const baseRow = buildBaseRow(rowModel);
    if (rowModel.vendorResume.eligible && rowModel.path) {
      rows.push(baseRow);
      resumableCount += 1;
      continue;
    }

    const category = classifyResumeIneligibility(rowModel);
    ineligibleCount += 1;
    rows.push({
      ...baseRow,
      annotation: shortReasonForResume(category),
      disabled: true,
      disabledReason: fullReasonForResume(category),
    });
  }

  rows.sort((left, right) => {
    if (left.disabled !== right.disabled) return left.disabled ? 1 : -1;
    return right.updatedAt - left.updatedAt;
  });

  return {
    rows,
    hint: {
      ineligibleCount,
      resumableCount,
      activeRunningCount,
      ...(params.metadataUpgradeRequiredCount !== undefined
        ? { metadataUpgradeRequiredCount: params.metadataUpgradeRequiredCount }
        : {}),
    },
  };
}

export function formatResumeSelectionFooter(hint: ResumeSelectionFooterHint): string | null {
  const sessionWord = (count: number) => count === 1 ? 'session' : 'sessions';
  const fragments: string[] = [];
  const metadataUpgradeNotice = formatSessionListMetadataUpgradeNotice(hint.metadataUpgradeRequiredCount);
  if (metadataUpgradeNotice) fragments.push(metadataUpgradeNotice);
  if (hint.activeRunningCount > 0) {
    fragments.push(`${hint.activeRunningCount} ${sessionWord(hint.activeRunningCount)} running; use \`happier attach\` to attach a terminal.`);
  }
  if (hint.ineligibleCount > 0) {
    fragments.push(`${hint.ineligibleCount} ${sessionWord(hint.ineligibleCount)} cannot be resumed; see reasons above.`);
  }
  return fragments.length > 0 ? fragments.join(' ') : null;
}
