import * as Haptics from 'expo-haptics';

export async function hapticsError(): Promise<void> {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
}

export async function hapticsLight(): Promise<void> {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

export async function hapticsSelection(): Promise<void> {
    await Haptics.selectionAsync().catch(() => undefined);
}

export async function hapticsSuccess(): Promise<void> {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

/** A firmer tick for a threshold that changes what a gesture will do (a lock, a hold). */
export async function hapticsMedium(): Promise<void> {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
}
