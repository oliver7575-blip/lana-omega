import type { createServiceClient } from './supabase/service'

export interface PosTable { slot: number; name: string }
type Db = ReturnType<typeof createServiceClient>

const DEFAULT_TABLES: PosTable[] = Array.from({ length: 8 }, (_, i) => ({ slot: i + 1, name: `Table ${i + 1}` }))

/** The hotel's bar / pool tables, kept in the hotel's settings (8 numbered tables until the first change). */
export async function getTables(db: Db, tenantId: string): Promise<PosTable[]> {
  const { data } = await db.from('tenants').select('channel_settings').eq('id', tenantId).single()
  const list = (data?.channel_settings as { pos_tables?: PosTable[] } | null)?.pos_tables
  return Array.isArray(list) && list.length ? list : DEFAULT_TABLES
}

export async function saveTables(db: Db, tenantId: string, tables: PosTable[]): Promise<string | null> {
  const { data } = await db.from('tenants').select('channel_settings').eq('id', tenantId).single()
  const next = { ...((data?.channel_settings as Record<string, unknown>) ?? {}), pos_tables: tables }
  const { error } = await db.from('tenants').update({ channel_settings: next }).eq('id', tenantId)
  return error ? error.message : null
}
