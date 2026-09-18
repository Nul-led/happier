/** Host-private member of the existing signed broker application. It is not
 * part of a Provider's `/v1` surface and never reaches Provider dispatch. */
export const PROVIDER_BROKER_PRIVATE_CLOSE_PATH =
  '/v1/_happier/provider-broker/close' as const;
