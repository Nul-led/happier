import * as React from 'react';

import { ArtifactEditor } from '@/components/artifacts/ArtifactEditor';

/** A new document in the Account Artifact store. */
export default function NewArtifactScreen(): React.ReactElement {
    return <ArtifactEditor artifact={null} mode="new" />;
}
