import * as React from 'react';

/**
 * Web focus ownership for option rows.
 *
 * A SelectionList with its canonical input is one composite widget: DOM focus
 * stays on the combobox and `aria-activedescendant` identifies the active row,
 * so options must not become independent Tab stops. Headerless lists retain
 * the incumbent roving-tabindex entry point instead.
 */
export const SelectionListOptionTabBehaviorContext = React.createContext<'input-owned' | 'roving'>('roving');
