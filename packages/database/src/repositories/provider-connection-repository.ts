import type { SqliteDb } from '../client.js';

export interface CustomProviderConnection {
  id: string;
  displayName: string;
  endpoint: string;
  model: string;
  apiKeySecretId?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export class ProviderConnectionRepository {
  constructor(private readonly db: SqliteDb) {}

  has(id: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM provider_connections WHERE id = ?').get(id));
  }

  createCustom(connection: CustomProviderConnection): CustomProviderConnection {
    const config = JSON.stringify({
      endpoint: connection.endpoint,
      model: connection.model,
      apiKeySecretId: connection.apiKeySecretId,
    });
    this.db
      .prepare(
        `INSERT INTO provider_connections
          (id, name, display_name, connection_type, config_json, status, created_at, updated_at)
         VALUES (?, ?, ?, 'openai-compatible', ?, ?, ?, ?)`,
      )
      .run(
        connection.id,
        connection.id,
        connection.displayName,
        config,
        connection.status,
        connection.createdAt,
        connection.updatedAt,
      );
    return connection;
  }

  listCustom(): CustomProviderConnection[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM provider_connections
         WHERE connection_type = 'openai-compatible'
         ORDER BY created_at`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const config = JSON.parse(String(row.config_json)) as Record<string, unknown>;
      return {
        id: String(row.id),
        displayName: String(row.display_name),
        endpoint: String(config.endpoint ?? ''),
        model: String(config.model ?? ''),
        apiKeySecretId:
          typeof config.apiKeySecretId === 'string' ? config.apiKeySecretId : undefined,
        status: String(row.status),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      };
    });
  }
}
