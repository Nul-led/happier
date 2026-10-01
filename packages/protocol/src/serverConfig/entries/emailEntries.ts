import { defineServerConfigRegistry } from '../serverConfigEntry.js';

/** Outgoing mail (plan §3.3). Read per send by `resolveAuthEmailDelivery`. */
export const EMAIL_SERVER_CONFIG = defineServerConfigRegistry({
    HAPPIER_AUTH_EMAIL_SMTP_HOST: {
        type: 'string',
        sensitivity: 'plain',
        apply: 'live',
        editable: 'home',
        section: 'email',
        description: 'SMTP server host name. Mail is off until this and the from address are set.',
    },
    HAPPIER_AUTH_EMAIL_SMTP_PORT: {
        type: 'int',
        bounds: { min: 1, max: 65_535 },
        sensitivity: 'plain',
        apply: 'live',
        editable: 'home',
        section: 'email',
        description: 'SMTP server port. When unset: 465 with implicit TLS, otherwise 587.',
    },
    HAPPIER_AUTH_EMAIL_SMTP_SECURE: {
        type: 'boolean',
        default: false,
        sensitivity: 'plain',
        apply: 'live',
        editable: 'home',
        section: 'email',
        description: 'Use implicit TLS for the SMTP connection (usually port 465).',
    },
    HAPPIER_AUTH_EMAIL_SMTP_USERNAME: {
        type: 'string',
        sensitivity: 'plain',
        apply: 'live',
        editable: 'home',
        section: 'email',
        description: 'SMTP user name, when the server requires authentication.',
    },
    HAPPIER_AUTH_EMAIL_SMTP_PASSWORD: {
        type: 'string',
        sensitivity: 'secret',
        apply: 'live',
        editable: 'home',
        section: 'email',
        description: 'SMTP password. Stored sealed and never shown again.',
    },
    HAPPIER_AUTH_EMAIL_FROM_ADDRESS: {
        type: 'email',
        sensitivity: 'plain',
        apply: 'live',
        editable: 'home',
        section: 'email',
        description: 'Address mail is sent from. Mail is off until this and the SMTP host are set.',
    },
    HAPPIER_AUTH_EMAIL_FROM_NAME: {
        type: 'string',
        default: 'Happier',
        sensitivity: 'plain',
        apply: 'live',
        editable: 'home',
        section: 'email',
        description: 'Sender name shown with the from address.',
    },
});
