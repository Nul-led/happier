import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { ArtifactsSpecimen, type ArtifactsSpecimenState } from '@/components/dev/artifacts/ArtifactsSpecimen';

const STATES: readonly ArtifactsSpecimenState[] = ['grid', 'empty', 'loading', 'quota', 'failed'];

/** Dev-only: the Artifacts browser with the lab's fixtures. `?state=grid|empty|loading|quota|failed`. */
export default function ArtifactsDevScreen() {
    const params = useLocalSearchParams<{ state?: string }>();
    const state = STATES.find((candidate) => candidate === params.state) ?? 'grid';
    return <ArtifactsSpecimen key={state} state={state} />;
}
