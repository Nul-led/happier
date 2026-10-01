import { Platform } from 'react-native';
import { usePathname, useSegments } from 'expo-router';
import { useAuth } from '@/auth/context/AuthContext';
import { useIsTablet } from '@/utils/platform/responsive';
import { isDesktopActivityOverlayWindowContext } from '@/activity/adapters/desktop/runtime/isDesktopActivityOverlayWindowContext';
import { isTerminalConnectWebPathname } from '@/utils/path/terminalConnectUrl';
import { isPublicRouteForUnauthenticated } from '@/auth/routing/authRouting';
import { useOnboardingJourneySessionActive } from '@/components/onboarding/tour/state/journeySession';

/** The same shell eligibility owns both navigation and responsive chrome. */
export function useWorkspaceShellEnabled(): boolean {
    const auth = useAuth();
    const pathname = usePathname();
    const segments = useSegments();
    const isTablet = useIsTablet();
    const overlay = isDesktopActivityOverlayWindowContext();
    const onboarding = useOnboardingJourneySessionActive();
    const normalized = segments.filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')));
    const publicNonHome = normalized.length > 0 && normalized[0] !== 'index'
        && isPublicRouteForUnauthenticated([...segments]);
    const bypass = onboarding || (Platform.OS === 'web' && (isTerminalConnectWebPathname(pathname) || publicNonHome));
    return auth.isAuthenticated && isTablet && !overlay && !bypass;
}
