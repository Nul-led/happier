import { encodeBase64 } from '@/encryption/base64';
import { getRandomBytes } from '@/platform/cryptoRandom';

export async function createPairingSecret(): Promise<Readonly<{ secret: string }>> {
    const secret = encodeBase64(getRandomBytes(32), 'base64url');
    return { secret };
}
