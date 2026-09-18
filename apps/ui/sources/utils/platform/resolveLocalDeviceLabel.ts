/**
 * Human-readable identity for device-local custody. This is presentation only:
 * authorization remains bound to the exact Account/device cryptographic owner.
 */
export function resolveLocalDeviceLabel(input: Readonly<{
    deviceName: unknown;
    platform: string;
}>): string | null {
    const trimmed = typeof input.deviceName === 'string' ? input.deviceName.trim() : '';
    if (trimmed) return trimmed;
    if (input.platform === 'ios') return 'iPhone';
    if (input.platform === 'android') return 'Android';
    return null;
}
