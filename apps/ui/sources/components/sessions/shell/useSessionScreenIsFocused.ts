import { useDestinationFocus } from '@/components/appShell/workspace/DestinationInstanceHost';

export function useSessionScreenIsFocused(): boolean {
    return useDestinationFocus();
}
