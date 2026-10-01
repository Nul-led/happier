import * as React from 'react';

/** The enclosing row or section's current reveal request; null outside a requested scope. */
export const ItemRevealContext = React.createContext<string | null>(null);
