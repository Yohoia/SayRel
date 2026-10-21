/**
 * Preload Bridge - History Domain
 *
 * Handles voice history and dictionary management
 */

type Listener = (...args: unknown[]) => void

export function createHistoryBridge(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
  subscribe: (channel: string, listener: Listener) => () => void
) {
  return {
    query: (payload?: unknown) => invoke('history:query', payload),
    delete: (id: string) => invoke('history:delete', id),
    updateMeta: (id: string, meta: unknown) => invoke('history:update-meta', id, meta),
    onCreated: (cb: Listener) => subscribe('history:created', cb),
    onDeleted: (cb: Listener) => subscribe('history:deleted', cb),

    // Dictionary
    dictionary: {
      getAll: () => invoke('dictionary:get-all'),
      add: (word: string) => invoke('dictionary:add', word),
      delete: (id: string) => invoke('dictionary:delete', id),
      import: (csv: string) => invoke('dictionary:import-csv', csv)
    }
  }
}

export type HistoryBridge = ReturnType<typeof createHistoryBridge>
