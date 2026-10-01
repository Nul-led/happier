import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { Platform } from 'react-native';

import { Typography } from '@/constants/Typography';
import type { Theme } from '@/theme';

import { useAppShellColumn } from '@/components/navigation/shell/appRail/appShellColumnContext';
import { isRunningOnMac } from '@/utils/platform/platform';

import { createHeader } from './Header';

/**
 * Whether stacks draw the app's own header (`createHeader`) rather than the native one: Android, Mac
 * Catalyst and the web, and everywhere inside the desktop app shell, whose one header rule (pages
 * there draw no stack header) lives in `createHeader`. iPhone keeps the native header.
 */
export function useAppStackUsesCustomHeader(): boolean {
    const shell = useAppShellColumn();
    return Platform.OS === 'android' || isRunningOnMac() || Platform.OS === 'web' || shell.present;
}

export function createAppStackScreenOptions(args: Readonly<{
    contentStyle?: NativeStackNavigationOptions['contentStyle'];
    headerBackTitle: string;
    shouldUseCustomHeader: boolean;
    theme: Theme;
}>): NativeStackNavigationOptions {
    return {
        header: args.shouldUseCustomHeader ? createHeader : undefined,
        headerBackTitle: args.headerBackTitle,
        headerShadowVisible: false,
        contentStyle: args.contentStyle ?? {
            backgroundColor: args.theme.colors.surface.base,
        },
        headerStyle: {
            backgroundColor: args.theme.colors.chrome.header.background,
        },
        headerTintColor: args.theme.colors.chrome.header.foreground,
        headerTitleStyle: {
            color: args.theme.colors.chrome.header.foreground,
            ...Typography.default('semiBold'),
        },
    };
}
