import type { StablePluginNotificationsOwner } from '@/plugins/runtime/invocation/services/notifications';
import { tryAcquireAuthoritativePluginRuntimeRegistryLease } from '@/plugins/runtime/reload/runtimeLease';

/** Reaches the daemon's current notification owner through its existing runtime lease. */
export function createHostPluginNotificationChannels(): Pick<
    StablePluginNotificationsOwner,
    'availableHostChannels' | 'sendHostNotification'
> {
    return Object.freeze({
        async availableHostChannels() {
            const lease = tryAcquireAuthoritativePluginRuntimeRegistryLease();
            if (!lease) return Object.freeze([]);
            try {
                return await lease.registry.pluginNotifications?.availableHostChannels() ?? Object.freeze([]);
            } finally {
                await lease.release();
            }
        },
        async sendHostNotification(request) {
            const lease = tryAcquireAuthoritativePluginRuntimeRegistryLease();
            if (!lease) return false;
            try {
                return await lease.registry.pluginNotifications?.sendHostNotification(request) ?? false;
            } finally {
                await lease.release();
            }
        },
    });
}
