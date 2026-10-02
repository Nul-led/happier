import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { TerminalJumpSpecimen } from '@/components/dev/terminal/jump/TerminalJumpSpecimen';

/** Dev-only: Jump to a terminal (terminal lab B4) over fixture terminals. `?q=vi` opens it typed. */
export default function TerminalJumpDevScreen() {
    const params = useLocalSearchParams<{ q?: string }>();
    return <TerminalJumpSpecimen initialQuery={typeof params.q === 'string' ? params.q : undefined} />;
}
