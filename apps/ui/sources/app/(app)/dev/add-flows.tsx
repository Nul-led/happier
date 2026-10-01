import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { AddFlowsSpecimen } from '@/components/dev/addFlows/AddFlowsSpecimen';

/** Dev-only: the Add a machine / Add a Home specimen (lab `add-flows`). `?only=<frame>` renders one frame. */
export default function AddFlowsDevScreen() {
    const params = useLocalSearchParams<{ only?: string }>();
    return <AddFlowsSpecimen only={typeof params.only === 'string' ? params.only : null} />;
}
