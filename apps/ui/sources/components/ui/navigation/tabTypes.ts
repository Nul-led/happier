/** Every tab the phone's main tab bar can show; `resolveTabBarTabs` decides which ones it does. */
export const TAB_TYPES = ['inbox', 'sessions', 'projects', 'friends', 'settings'] as const;
export type TabType = typeof TAB_TYPES[number];
