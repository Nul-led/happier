import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { TerminalWorkspaceSpecimen } from '@/components/dev/terminal/TerminalWorkspaceSpecimen';

/** Dev-only: the session bottom pane (terminal lab B1/B2/B3/A1/L/M/ST). `?v=B1|B2|B3|A1|L|M|exited|offline|failed|bell`. */
export default function TerminalDevScreen() {
    const params = useLocalSearchParams<{ v?: string }>();
    return <TerminalWorkspaceSpecimen variant={typeof params.v === 'string' ? params.v : null} />;
}
