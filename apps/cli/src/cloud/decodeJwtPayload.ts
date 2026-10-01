/**
 * Utility functions for connect commands
 */

/**
 * Decode JWT payload without verification
 * Used to extract user info (email) from id_token
 * 
 * @param token - JWT token string
 * @returns Decoded payload or null if invalid
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) {
            return null;
        }
        
        // JWT payload is the second part, base64url encoded
        const payload = parts[1];
        
        // Decode base64url to JSON
        const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
        return JSON.parse(decoded);
    } catch {
        return null;
    }
}

/**
 * The account id a Happier credential token names: its trimmed `sub`, or null
 * when the token is malformed or carries no subject. The one reader for it.
 */
export function readAccountIdFromToken(token: string): string | null {
    const subject = decodeJwtPayload(token)?.sub;
    return typeof subject === 'string' && subject.trim() ? subject.trim() : null;
}
