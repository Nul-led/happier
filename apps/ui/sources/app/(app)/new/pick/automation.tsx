import { Redirect } from 'expo-router';

/**
 * Retained deep link for the withdrawn inline Automation picker.
 *
 * Creating an Automation is the shared wrapper's job, so an old bookmark lands
 * there instead of manufacturing a fresh inline Automation draft inside New
 * Session — that second authoring surface had different controls, different
 * validation and its own write, and it kept the retained compatibility writer
 * reachable for brand-new work. A persisted pre-change draft is still adopted
 * by its own owner when New Session opens it; this route carries no draft.
 */
export default function AutomationPickerRoute() {
    return <Redirect href={{ pathname: '/automations/new' }} />;
}
