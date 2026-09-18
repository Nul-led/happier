/**
 * Returns a log-safe representation of a URL that may contain a public-share,
 * invitation, native-auth, or browser Artifact bearer capability.
 */
export function redactPublicShareCapabilityUrl(rawUrl: string): string {
  const publicShareRedacted = rawUrl.replace(
    /(\/(?:v1\/public-share|share|join)\/)([^/?#\s]+)/g,
    '$1:token',
  );
  const nativeAuthRedacted = publicShareRedacted.replace(
    /(\/auth\/(?:email\/verify|password\/reset)\/)([^/?#\s]+)/g,
    '$1:token',
  );
  return nativeAuthRedacted.replace(
    /(\/v1\/plugins\/availability\/ui-artifacts\/browser\/)([^/?#\s]+)((?:\/[^?#\s]*)?)(?:[?#][^\s]*)?/g,
    '$1:token$3',
  );
}
