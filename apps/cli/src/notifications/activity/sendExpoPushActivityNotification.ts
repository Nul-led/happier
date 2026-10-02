import type { AttentionPreviewBehavior, ExpoPushNotificationChannelV1 } from '@happier-dev/protocol';

import type { PushNotificationClient, PushNotificationDeliveryOptions } from '@/api/pushNotifications';
import type { ActivityNotificationEvent } from './activityNotificationEvent';
import { buildActivityNotificationContent } from './buildActivityNotificationContent';

export type ExpoPushActivityNotificationSender = Readonly<Pick<PushNotificationClient, 'sendToAllDevicesAsync'>>;

export async function sendExpoPushActivityNotificationAsync(params: Readonly<{
  channel: ExpoPushNotificationChannelV1;
  event: ActivityNotificationEvent;
  sender: ExpoPushActivityNotificationSender;
  deliveryOptions?: PushNotificationDeliveryOptions;
  previewBehavior?: AttentionPreviewBehavior;
}>): Promise<boolean> {
  const built = buildActivityNotificationContent(params.event, {
    readyIncludeMessageText: params.channel.readyIncludeMessageText !== false,
    requestIncludeMessageText: params.channel.requestIncludeMessageText !== false,
    previewBehavior: params.previewBehavior,
  });
  if (params.deliveryOptions) {
    return await params.sender.sendToAllDevicesAsync(built.title, built.body, built.data, params.deliveryOptions);
  }
  return await params.sender.sendToAllDevicesAsync(built.title, built.body, built.data);
}
