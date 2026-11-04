export type SettingRow = { value: string; updated_by: string; updated_at: string };

export function getSetting(db: D1Database, key: string) {
  return db
    .prepare('SELECT value, updated_by, updated_at FROM app_settings WHERE key = ?')
    .bind(key)
    .first<SettingRow>();
}

export async function putSetting(db: D1Database, key: string, value: string, by: string) {
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .bind(key, value, by, new Date().toISOString())
    .run();
}
