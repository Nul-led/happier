/** Publication identity shared by release tooling and runtime artifact readers. */
export const RELEASE_PRODUCT_PUBLICATIONS = {
  happier: { rollingTagPrefix: 'cli', versionTagPrefix: 'cli-v', archiveFormat: 'tar.gz' },
  hstack: { rollingTagPrefix: 'stack', versionTagPrefix: 'stack-v', archiveFormat: 'tar.gz' },
  'happier-server': { rollingTagPrefix: 'server', versionTagPrefix: 'server-v', archiveFormat: 'tar.gz' },
  'happier-runner': { rollingTagPrefix: 'runner', versionTagPrefix: 'runner-v', archiveFormat: 'zip' },
} as const;

export type ReleaseProduct = keyof typeof RELEASE_PRODUCT_PUBLICATIONS;
export const RELEASE_PRODUCTS = Object.freeze(Object.keys(RELEASE_PRODUCT_PUBLICATIONS) as ReleaseProduct[]);

export function getReleaseProductPublication(product: ReleaseProduct) {
  const { rollingTagPrefix, versionTagPrefix } = RELEASE_PRODUCT_PUBLICATIONS[product];
  return { rollingTagPrefix, versionTagPrefix };
}

export function getReleaseProductArchiveFormat(product: string): 'zip' | 'tar.gz' | null {
  return Object.hasOwn(RELEASE_PRODUCT_PUBLICATIONS, product)
    ? RELEASE_PRODUCT_PUBLICATIONS[product as ReleaseProduct].archiveFormat
    : null;
}
