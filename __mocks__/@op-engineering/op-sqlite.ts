/**
 * Jest mock for @op-engineering/op-sqlite.
 *
 * The real module is a JSI/native TurboModule that cannot run under Node/Jest.
 * This mock provides an in-memory implementation so repository calls used by
 * App mount do not throw and test rendering resolves to the bundled fallback.
 */
const data: Array<Record<string, unknown>> = [];

function execute(_query: string, _params: unknown[] = []): Promise<Record<string, any>> {
  const rows: Array<Record<string, unknown>> = data.slice();
  return Promise.resolve({ insertId: undefined, rowsAffected: 0, rows });
}

const memoryDb = {
  execute,
  executeSync: () => ({ insertId: undefined, rowsAffected: 0, rows: [] }),
  executeBatch: async () => ({ rowsAffected: 0 }),
  transaction: async () => undefined,
  close: () => undefined,
  closeAsync: async () => undefined,
  delete: () => undefined,
};

export const open = () => memoryDb;
export const openAsync = async () => memoryDb;
export const OPSQLite = { open: () => memoryDb, openAsync: () => Promise.resolve(memoryDb) };
export const isSQLCipher = () => false;
export const isLibsql = () => false;
export const isTurso = () => false;
export const isIOSEmbedded = () => false;

export default { open, openAsync, OPSQLite };
