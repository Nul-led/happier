import type { ReleasedDirectSessionShareProfileV1 } from '@happier-dev/protocol';

//
// Session Sharing Types
//

/**
 * Access log entry for public shares
 *
 * @remarks
 * Records when and by whom a public share was accessed. IP address and user
 * agent are only logged if the user gave consent or consent was not required.
 */
export interface PublicShareAccessLog {
    /** Unique identifier for this log entry */
    id: string;
    /**
     * User who accessed the share, if authenticated
     *
     * @remarks
     * Null if the user accessed anonymously without authentication.
     */
    user: ReleasedDirectSessionShareProfileV1 | null;
    /** Timestamp of access (milliseconds since epoch) */
    accessedAt: number;
    /**
     * IP address of the accessor
     *
     * @remarks
     * Only logged if user gave consent (when `isConsentRequired` is true)
     * or if consent was not required.
     */
    ipAddress: string | null;
    /**
     * User agent string of the accessor's browser
     *
     * @remarks
     * Only logged if user gave consent (when `isConsentRequired` is true)
     * or if consent was not required.
     */
    userAgent: string | null;
}

//
// API Request/Response Types
//

/**
 * Response when accessing a session via public share
 *
 * @remarks
 * Returns the session data and encrypted key needed to decrypt it.
 * Public shares always have view-only access.
 */
export interface AccessPublicShareResponse {
    /** Session information */
    session: {
        /** Session ID */
        id: string;
        /** Session sequence number */
        seq: number;
        /** Session encryption mode */
        encryptionMode: 'e2ee' | 'plain';
        /** Creation timestamp (milliseconds since epoch) */
        createdAt: number;
        /** Last update timestamp (milliseconds since epoch) */
        updatedAt: number;
        /** Whether session is active */
        active: boolean;
        /** Last activity timestamp (milliseconds since epoch) */
        activeAt: number;
        /** Session metadata */
        metadata: any;
        /** Metadata version number */
        metadataVersion: number;
        /** Agent state */
        agentState: any;
        /** Agent state version number */
        agentStateVersion: number;
    };
    /** Access level (always 'view' for public shares) */
    accessLevel: 'view';
    /** Encrypted data key for decrypting session (base64); null for plaintext sessions */
    encryptedDataKey: string | null;
    /** Session owner profile */
    owner: ReleasedDirectSessionShareProfileV1;
    /** Whether consent is required (echoed) */
    isConsentRequired: boolean;
}

/** Response containing access logs for a public share */
export interface PublicShareAccessLogsResponse {
    /** List of access log entries */
    logs: PublicShareAccessLog[];
}

//
// Error Types
//

/**
 * Base error class for session sharing operations
 *
 * @remarks
 * All session sharing errors extend from this class for easy error handling.
 */
export class SessionSharingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SessionSharingError';
    }
}

/**
 * Error thrown when a requested share does not exist
 *
 * @remarks
 * This can occur when trying to access, update, or delete a share that
 * has already been deleted or never existed.
 */
export class ShareNotFoundError extends SessionSharingError {
    constructor() {
        super('Share not found');
        this.name = 'ShareNotFoundError';
    }
}

/**
 * Error thrown when a public share token is invalid or expired
 *
 * @remarks
 * This can occur if:
 * - The token doesn't exist
 * - The share has expired (past `expiresAt`)
 * - The maximum uses have been reached
 * - The current user is blocked
 */
export class PublicShareNotFoundError extends SessionSharingError {
    constructor() {
        super('Public share not found or expired');
        this.name = 'PublicShareNotFoundError';
    }
}

/**
 * Error thrown when accessing a public share that requires consent
 *
 * @remarks
 * When `isConsentRequired` is true, users must explicitly consent to
 * access logging by passing `consent=true` in the request. This error
 * indicates the consent parameter was missing or false.
 */
export class ConsentRequiredError extends SessionSharingError {
    constructor() {
        super('Consent required for access');
        this.name = 'ConsentRequiredError';
    }
}

/**
 * Error thrown when a public share has reached its maximum usage limit
 *
 * @remarks
 * When a public share has a `maxUses` limit and that limit has been
 * reached, further access attempts will fail with this error.
 */
export class MaxUsesReachedError extends SessionSharingError {
    constructor() {
        super('Maximum uses reached');
        this.name = 'MaxUsesReachedError';
    }
}
