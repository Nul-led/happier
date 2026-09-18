import * as React from 'react';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';
import { sessionAddressKey, type SessionAddress } from '@/sync/domains/session/sessionAddress';
import { useServerCredentialAccountScopeResolution } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { SessionAccessEditor } from './SessionAccessEditor';
import { useLiveSessionAccessEditorController } from './useLiveSessionAccessEditorController';
import type { SessionAccessEditorPresentation } from './sessionAccessEditorTypes';

function ScopedEditor(props: Readonly<{scope:ServerAccountScope;sessionId:string;presentation:SessionAccessEditorPresentation;onRequestClose?:()=>void;onOpenFullSurface?:()=>void;testID?:string}>) {
    const controller=useLiveSessionAccessEditorController({scope:props.scope,sessionId:props.sessionId});
    return <SessionAccessEditor {...controller} presentation={props.presentation} onRequestClose={props.onRequestClose}
        onOpenFullSurface={props.onOpenFullSurface} testID={props.testID}/>;
}

/** Lazy composer host; exact Account resolution starts only when its popover mounts. */
export function LiveSessionAccessEditor(props:Readonly<{target:SessionAddress;presentation:SessionAccessEditorPresentation;onRequestClose?:()=>void;onOpenFullSurface?:()=>void;testID?:string}>) {
    const resolution=useServerCredentialAccountScopeResolution(props.target.serverId);
    if(resolution.kind!=='bound')return <Text>{t('common.loading')}</Text>;
    const {scope}=resolution;
    const editorKey = JSON.stringify([
        scope.accountId,
        sessionAddressKey({ serverId: scope.serverId, sessionId: props.target.sessionId }),
    ]);
    return <ScopedEditor key={editorKey} scope={scope} sessionId={props.target.sessionId} presentation={props.presentation}
        onRequestClose={props.onRequestClose} onOpenFullSurface={props.onOpenFullSurface} testID={props.testID}/>;
}
