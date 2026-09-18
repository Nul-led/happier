import type { View } from 'react-native';

import type { NewSessionSimplePanelProps } from '@/components/sessions/new/components/NewSessionSimplePanel';
import type {
    NewSessionWizardAgentProps,
    NewSessionWizardFooterProps,
    NewSessionWizardLayoutProps,
    NewSessionWizardMachineProps,
    NewSessionWizardProfilesProps,
    NewSessionWizardProps,
} from '@/components/sessions/new/components/NewSessionWizard';
import type { NewSessionCheckoutCreationDraft } from '@/sync/domains/state/newSessionCheckoutDraft';

export type NewSessionSimpleScreenProps = NewSessionSimplePanelProps & Readonly<{
    checkoutCreationDraft: NewSessionCheckoutCreationDraft | null;
    setCheckoutCreationDraft: React.Dispatch<React.SetStateAction<NewSessionCheckoutCreationDraft | null>>;
}>;

export type NewSessionScreenModel =
    | Readonly<{
        variant: 'simple';
        popoverBoundaryRef: React.RefObject<View>;
        launchOverlay: React.ReactNode | null;
        launchOnRequestClose: () => void;
        overlayPresentation?: 'card' | 'screen';
        overlayFocusReturnRef?: React.RefObject<View | null>;
        overlayAccessibilityLabel?: string;
        simpleProps: NewSessionSimpleScreenProps;
    }>
    | Readonly<{
        variant: 'wizard';
        popoverBoundaryRef: React.RefObject<View>;
        launchOverlay: React.ReactNode | null;
        launchOnRequestClose: () => void;
        overlayPresentation?: 'card' | 'screen';
        overlayFocusReturnRef?: React.RefObject<View | null>;
        overlayAccessibilityLabel?: string;
        wizardProps: Readonly<{
            layout: NewSessionWizardLayoutProps;
            sectionPresentation?: NewSessionWizardProps['sectionPresentation'];
            useColumnLayout?: NewSessionWizardProps['useColumnLayout'];
            profiles: NewSessionWizardProfilesProps;
            agent: NewSessionWizardAgentProps;
            machine: NewSessionWizardMachineProps;
            footer: NewSessionWizardFooterProps;
        }>;
    }>;
