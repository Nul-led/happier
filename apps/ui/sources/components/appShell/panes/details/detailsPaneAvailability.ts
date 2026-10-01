import { useLocalSetting } from '@/sync/domains/state/storage';
import { useDeviceType } from '@/utils/platform/responsive';

/**
 * Whether a side pane (a destination's details, a right sidebar) belongs beside the page here. False
 * on phones (native, and phone-sized web, where a pane could only cover the whole screen) and when
 * side panes are turned off: push the content as its own page instead.
 */
export function useDetailsPaneAvailable(): boolean {
    const deviceType = useDeviceType();
    const multiPaneEnabled = useLocalSetting('uiMultiPanePanelsEnabled') !== false;
    return multiPaneEnabled && deviceType !== 'phone';
}
