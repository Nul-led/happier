import React from 'react';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { t } from '@/text';

import type { BugReportSimilarIssue } from './bugReportServiceClient';

/**
 * Possible duplicates of the report being written. Choosing one posts the report as a comment on it
 * instead of opening a new issue; the chosen issue is the only row until it is cleared.
 */
export function BugReportSimilarIssuesSection(props: Readonly<{
  loading: boolean;
  issues: BugReportSimilarIssue[];
  selectedIssueNumber: number | null;
  onSelectedIssueNumberChange: (value: number | null) => void;
  disabled: boolean;
}>): React.JSX.Element | null {
  if (!props.loading && props.issues.length === 0 && !props.selectedIssueNumber) {
    return null;
  }

  return (
    <ItemGroup
      title={t('bugReports.composer.similarIssues.title')}
      description={t('bugReports.composer.similarIssues.subtitle')}
    >
      {props.selectedIssueNumber ? (
        <Item
          testID="bug-report-similar-issue-selected"
          title={t('bugReports.composer.similarIssues.selectedTitle', { number: props.selectedIssueNumber })}
          subtitle={t('bugReports.composer.similarIssues.selectedSubtitle')}
          subtitleLines={0}
          selected
          showChevron={false}
          disabled={props.disabled}
          onPress={() => props.onSelectedIssueNumberChange(null)}
        />
      ) : null}
      {/* A new search keeps the earlier results on screen and says it is still looking. */}
      {!props.selectedIssueNumber && props.loading ? (
        <Item
          testID="bug-report-similar-issues-searching"
          title={t('bugReports.composer.similarIssues.searching')}
          loading
          mode="info"
        />
      ) : null}
      {!props.selectedIssueNumber ? props.issues.map((issue) => (
        <Item
          key={`${issue.owner}/${issue.repo}#${issue.number}`}
          testID={`bug-report-similar-issue-${issue.number}`}
          title={`#${issue.number} ${issue.title}`}
          titleLines={2}
          subtitle={issue.state === 'open'
            ? t('bugReports.composer.similarIssues.issueState.open')
            : t('bugReports.composer.similarIssues.issueState.closed')}
          accessibilityLabel={t('bugReports.composer.similarIssues.useIssueA11y', { number: issue.number })}
          disabled={props.disabled}
          onPress={() => props.onSelectedIssueNumberChange(issue.number)}
        />
      )) : null}
    </ItemGroup>
  );
}
