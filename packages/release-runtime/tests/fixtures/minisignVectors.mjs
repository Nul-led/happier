// Pinned Minisign release-verification vectors.
//
// Provenance: minted once with node:crypto Ed25519 (OpenSSL) plus OpenSSL
// `blake2b512` for the prehashed variant, then frozen only after the released
// `verifyMinisign` implementation accepted the `Ed` and `ED` vectors and
// rejected the tampered/wrong-key ones. They therefore pin the exact release
// compatibility of the verifier rather than the behaviour of whichever
// cryptographic library the core happens to use, and the signatures come from
// an implementation independent of the verifying one.

export const RELEASE_ARTIFACT_NAME = 'happier-runner-v0.3.0-linux-x64.tar.gz';

export const RELEASE_ARTIFACT_TEXT = 'happier runner pinned release artifact payload\n';

export const RELEASE_ARTIFACT_SHA256 = 'a172b3b59650440273a7091bff3128ba6b22610590eda8a4692cfd6ee98202ef';

export const CHECKSUMS_TEXT = [
  'a172b3b59650440273a7091bff3128ba6b22610590eda8a4692cfd6ee98202ef  happier-runner-v0.3.0-linux-x64.tar.gz',
  'd9298a10d1b0735837dc4bd85dac641b0f3cef27a47e5d53a54f2f3f5b2fcffa  happier-runner-v0.3.0-darwin-arm64.tar.gz',
  '',
].join('\n');

export const PUBLIC_KEY_FILE = 'untrusted comment: minisign public key 91AE28177BF6E43C\n'
  + 'RWSRrigXe/bkPDtpXBxCYzSceMfLuKkwM1zx0vImnjZcTQt4BTl+HX7A\n';

export const UNRELATED_PUBLIC_KEY_FILE = 'untrusted comment: minisign public key 0F1E2D3C4B5A6978\n'
  + 'RWQPHi08S1ppeBEYhlEkPUSmRq3rbWfS9BcDVoCS3IKHDZHiy3wPAPkj\n';

const TRUSTED_COMMENT_LINE = 'trusted comment: timestamp:1757030400\tfile:SHA256SUMS.txt\thashed';

// Legacy `Ed` signatures sign the message bytes directly.
export const SIGNATURE_FILE_ED = [
  'untrusted comment: signature from minisign secret key',
  'RWSRrigXe/bkPKEJe64k2peNWoAfs72hMeR1GZOXO1B0dIjcVrpj4tyqsjVAeuP+4F6kRr1mnddfk+gqHiJY3ykKBtxa29v4Hws=',
  TRUSTED_COMMENT_LINE,
  'NJ1YBuSbFa5yaZ+mts/BkH92NPws9r6+/IOfmH/OCl/Y6UlQZVyPKLGYpm7ttBEgOj+5SeQABB4qgtZb8JRMBg==',
  '',
].join('\n');

// Current `ED` signatures sign the BLAKE2b-512 prehash of the message bytes.
export const SIGNATURE_FILE_PREHASHED = [
  'untrusted comment: signature from minisign secret key',
  'RUSRrigXe/bkPK4RfQHUZsyOe9/4WVtzYGAfxjjTpjD3AzY6q6qieo2Gbwr47qwTXNtoJFdPRUMIstWVBaIyJl5+MehmjrRM1Qk=',
  TRUSTED_COMMENT_LINE,
  '0JpkQY35pHWgKuPR2BbTIwn++70Q+8ZOnZsxJF0JREu6D4LQOxrcai5gFqJfQVKdxZxSp8r07JBncG5kRi9yDA==',
  '',
].join('\n');

export function replaceSignatureLine(sigFile, lineIndex, replacement) {
  const lines = sigFile.split('\n');
  lines[lineIndex] = replacement;
  return lines.join('\n');
}
