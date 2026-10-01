import { Linking, Platform } from 'react-native';
import { desktopHostKind, invokeDesktopHost } from '@/utils/platform/desktopHost';

export async function openExternalUrl(
  url: string,
  opts?: Readonly<{ platformOS?: string }>,
): Promise<boolean> {
  const normalized = String(url ?? '').trim();
  if (!/^https?:\/\//i.test(normalized)) return false;

  const platformOS = String(opts?.platformOS ?? Platform.OS ?? '').toLowerCase();
  if (platformOS === 'web' && desktopHostKind() === 'tauri') {
    try {
      await invokeDesktopHost('plugin:opener|open_url', { url: normalized });
      return true;
    } catch {
      console.error('Tauri could not open an external URL');
      return false;
    }
  }
  if (platformOS === 'web') {
    try {
      const openFn = (globalThis as unknown as { open?: unknown }).open;
      if (typeof openFn === 'function') {
        (openFn as (url: string, target?: string, features?: string) => unknown)(
          normalized,
          '_blank',
          'noopener,noreferrer',
        );
        return true;
      }
    } catch {
      // fall through
    }
  }

  try {
    await Linking.openURL(normalized);
    return true;
  } catch {
    return false;
  }
}
