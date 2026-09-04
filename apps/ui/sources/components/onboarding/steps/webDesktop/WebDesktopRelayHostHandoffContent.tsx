import * as React from 'react';

import { buildCliInstallAndRunCommandForCurrentApp, buildCliInstallAndRunPowershellCommandForCurrentApp } from '../../commands/wizardCliCommands';
import { buildWebDesktopRelayHostHandoffSteps } from '../../commands/webDesktopHandoffSteps';
import {
    WizardGuidedHandoff,
    WizardGuidedHandoffDivider,
    WizardGuidedHandoffDownloadCta,
    WizardGuidedHandoffTerminal,
} from '../../ui/WizardGuidedHandoff';

export type WebDesktopRelayHostHandoffContentProps = Readonly<{
    testID: string;
}>;

export function WebDesktopRelayHostHandoffContent(props: WebDesktopRelayHostHandoffContentProps) {
    const installAndSetupRelayCommand = React.useMemo(() => buildCliInstallAndRunCommandForCurrentApp({ action: 'home-create' }), []);
    const installAndSetupRelayWindowsCommand = React.useMemo(() => buildCliInstallAndRunPowershellCommandForCurrentApp({ action: 'home-create' }), []);

    return (
        <WizardGuidedHandoff testID={props.testID}>
            <WizardGuidedHandoffTerminal
                testID={`${props.testID}-terminal`}
                steps={buildWebDesktopRelayHostHandoffSteps({
                    installAndSetupRelayCommand,
                    installAndSetupRelayWindowsCommand,
                })}
            />
            <WizardGuidedHandoffDivider testID={`${props.testID}-divider`} />
            <WizardGuidedHandoffDownloadCta testIDPrefix={props.testID} />
        </WizardGuidedHandoff>
    );
}
