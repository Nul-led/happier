import type * as React from 'react';

/**
 * One role as a picker shows it. Display-ready: the connected catalog owner resolves the role
 * (through `resolveRoleSelectionV1`) and its engine identity before a row ever renders, so the
 * rail itself makes no role decision.
 */
export type RoleRailItem = Readonly<{
    roleId: string;
    name: string;
    /** The first line of the role's instructions: what it is for. */
    purpose: string;
    /** "Opus 5.5 · High"; absent when the role follows the default agent. */
    engineLabel?: string;
    engineIcon?: React.ReactNode;
    /** The Agent the role's engine names; a caller compares it with the running one. */
    agentTargetKey?: string;
}>;
