import type * as React from 'react';

/**
 * The workflow document's presentation contract (04 §4.11): one document
 * component renders both editing and reading. A reader (05's Steps tab, a
 * built-in or View-access workflow) passes `editable: false` and, per step,
 * exactly these slots; each has a fixed place in the block anatomy, so a state
 * arriving never moves the blocks around it. The editor itself reads no run
 * state.
 */
export type WorkflowDocumentStepSlots = Readonly<{
    /** The state word with its tone, in the block heading line. */
    state?: React.ReactNode;
    /** A repeated body's occurrence selector, in the container heading line. */
    occurrenceSelector?: React.ReactNode;
    /** The effective role/engine chip, only where it differs from the authored one. */
    engineChip?: React.ReactNode;
    /** The reviewed-state card after a decision, under the composer. */
    reviewedCard?: React.ReactNode;
    /** The step's own-work link, in the footer row. */
    footer?: React.ReactNode;
}>;

export type WorkflowDocumentPresentation = Readonly<{
    /** `false`: no Add row, inserters, block menus, moves or Step options writes. */
    editable: boolean;
    /** One line above the first block (the frozen-version or read-only sentence). */
    note?: React.ReactNode;
    step?: (blockId: string) => WorkflowDocumentStepSlots | null;
}>;
