const withActivityNotificationsAndroid = require('./withActivityNotificationsAndroid.js');
const withActivityNotificationsIos = require('./withActivityNotificationsIos.js');

/**
 * Build integration for the native Activity remote alert consumer.
 *
 * Android routes Firebase messages to the isolated native notification process;
 * iOS adds the notification service extension target. Both are build-time wiring
 * for one consumer — neither adds a second notification sender.
 */
function withActivityNotifications(config, options = {}) {
  return withActivityNotificationsIos(withActivityNotificationsAndroid(config, options));
}

module.exports = withActivityNotifications;
