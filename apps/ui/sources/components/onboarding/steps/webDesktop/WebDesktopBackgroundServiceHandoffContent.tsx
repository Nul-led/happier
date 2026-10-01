import * as React from 'react';

import { buildMachineAddCommand } from '@/components/machines/add/machineAddCommand';
import { buildWebDesktopBackgroundServiceHandoffSteps } from '../../commands/webDesktopHandoffSteps';
import {
    WizardGuidedHandoff,
    WizardGuidedHandoffDivider,
    WizardGuidedHandoffDownloadCta,
    WizardGuidedHandoffTerminal,
} from '../../ui/WizardGuidedHandoff';

export type WebDesktopBackgroundServiceHandoffContentProps = Readonly<{
    testID: string;
    relayUrl: string;
}>;

export function WebDesktopBackgroundServiceHandoffContent(props: WebDesktopBackgroundServiceHandoffContentProps) {
    const installAndSetupCommand = React.useMemo(() => buildMachineAddCommand({
        kind: 'joinHome', os: 'linux', descriptor: null, profileSource: null,
        fallbackHomeUrl: props.relayUrl, skipProviders: true,
    }), [props.relayUrl]);
    const installAndSetupWindowsCommand = React.useMemo(() => buildMachineAddCommand({
        kind: 'joinHome', os: 'windows', descriptor: null, profileSource: null,
        fallbackHomeUrl: props.relayUrl, skipProviders: true,
    }), [props.relayUrl]);
    const steps = React.useMemo(() => buildWebDesktopBackgroundServiceHandoffSteps({
        installAndSetupCommand,
        installAndSetupWindowsCommand,
        relayUrl: props.relayUrl,
    }), [installAndSetupCommand, installAndSetupWindowsCommand, props.relayUrl]);

    return (
        <WizardGuidedHandoff testID={props.testID}>
            <WizardGuidedHandoffTerminal
                testID={`${props.testID}-terminal`}
                steps={steps}
            />
            <WizardGuidedHandoffDivider testID={`${props.testID}-divider`} />
            <WizardGuidedHandoffDownloadCta testIDPrefix={props.testID} />
        </WizardGuidedHandoff>
    );
}
