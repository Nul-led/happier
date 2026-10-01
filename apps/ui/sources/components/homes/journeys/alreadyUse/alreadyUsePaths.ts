/**
 * The three ways into Homes someone already uses, each first-class (lab K1):
 * - `service`: the sign-in service this device finds Homes with (Happier Cloud by default);
 * - `other_service`: a self-hosted or company sign-in service, checked by its address;
 * - `direct`: a Home with no account service, from a device already connected (its link or code) or
 *   by its address, then that Home's own sign-in (`home_sign_in`).
 */
export type AlreadyUsePath = 'service' | 'other_service' | 'direct';
