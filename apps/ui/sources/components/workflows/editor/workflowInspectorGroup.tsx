import * as React from 'react';

import type { WorkflowValidationIssue } from '@happier-dev/protocol/workflows/workflowV1';

import { ExpandableItem } from '@/components/ui/lists/ExpandableItem';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';

export const NO_DISCLOSURE: ReadonlyMap<string, boolean> = new Map();

/**
 * Whether a group is open: attention (an issue or a required-but-missing
 * field) always opens it; otherwise the person's recorded choice; otherwise
 * whether it holds a value set for this subject.
 */
export function resolveWorkflowInspectorGroupExpanded(params: Readonly<{
    attention: boolean;
    recorded: boolean | undefined;
    valueSet: boolean;
}>): boolean {
    if (params.attention) return true;
    return params.recorded ?? params.valueSet;
}

export function issuesUnder(issues: readonly WorkflowValidationIssue[], prefixes: readonly string[]): boolean {
    return issues.some((issue) => prefixes.some((prefix) => issue.path === prefix || issue.path.startsWith(`${prefix}/`)));
}

/**
 * One settings group as a disclosure whose closed line is its effective values
 * (04 §5.2, D10). Its open state follows `resolveWorkflowInspectorGroupExpanded`.
 */
export function WorkflowInspectorGroup(props: Readonly<{
    groupId: string;
    title: string;
    summary: string;
    attention: boolean;
    valueSet: boolean;
    disclosure: ReadonlyMap<string, boolean>;
    onChangeDisclosure?: (groupId: string, expanded: boolean) => void;
    testID: string;
    children: React.ReactNode;
}>): React.ReactElement {
    const expanded = resolveWorkflowInspectorGroupExpanded({
        attention: props.attention,
        recorded: props.disclosure.get(props.groupId),
        valueSet: props.valueSet,
    });
    const { groupId, onChangeDisclosure } = props;
    const onExpandedChange = React.useCallback((next: boolean) => {
        onChangeDisclosure?.(groupId, next);
    }, [groupId, onChangeDisclosure]);
    return (
        <ItemGroup>
            <ExpandableItem
                testID={props.testID}
                expanded={expanded}
                onExpandedChange={onExpandedChange}
                showDivider={false}
                header={({ headerProps }) => (
                    <Item
                        testID={`${props.testID}-header`}
                        title={props.title}
                        subtitle={props.summary}
                        onPress={headerProps.onPress}
                        accessibilityRole="button"
                        accessibilityExpanded={expanded}
                        showChevron={false}
                    />
                )}
            >
                {props.children}
            </ExpandableItem>
        </ItemGroup>
    );
}
