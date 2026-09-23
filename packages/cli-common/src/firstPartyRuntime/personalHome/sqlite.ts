import { createRequire } from 'node:module';

export type PersonalHomeSqliteStatement = Readonly<{
  get(...params: readonly unknown[]): unknown;
  all(...params: readonly unknown[]): unknown[];
  run(...params: readonly unknown[]): unknown;
}>;

export type PersonalHomeSqliteDatabase = Readonly<{
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): PersonalHomeSqliteStatement;
}>;

export function openPersonalHomeSqliteDatabase(
  databasePath: string,
  options: Readonly<{ readOnly?: boolean }> = {},
): PersonalHomeSqliteDatabase {
  const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
  // The complete CLI dist is compiled by Bun but also remains runnable by
  // Node. Keep the selected provider opaque to pkgroll so it cannot turn the
  // Node branch into an eager external import in every entrypoint.
  const moduleName = [isBunRuntime ? 'bun' : 'node', 'sqlite'].join(':');
  const loaded = createRequire(import.meta.url)(moduleName) as unknown;
  if (!loaded || typeof loaded !== 'object') {
    throw new Error(`Failed to load SQLite module: ${moduleName}`);
  }

  const constructor = isBunRuntime
    ? (loaded as Readonly<{ Database?: unknown }>).Database
    : (loaded as Readonly<{ DatabaseSync?: unknown }>).DatabaseSync;
  if (typeof constructor !== 'function') {
    throw new Error(`Failed to resolve SQLite database constructor: ${moduleName}`);
  }

  const Database = constructor as new (
    path: string,
    options?: Readonly<{ readOnly?: boolean; readonly?: boolean }>,
  ) => PersonalHomeSqliteDatabase;
  if (!options.readOnly) return new Database(databasePath);
  return new Database(databasePath, isBunRuntime ? { readonly: true } : { readOnly: true });
}
