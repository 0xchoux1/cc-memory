/**
 * BaseRepository - Base class for all repository implementations
 *
 * Provides common functionality for database access and row conversion.
 */

import type { DatabaseConnection, QueryResult } from '../DatabaseConnection.js';

export abstract class BaseRepository {
  protected connection: DatabaseConnection;

  constructor(connection: DatabaseConnection) {
    this.connection = connection;
  }

  /**
   * Get the database connection
   */
  protected getConnection(): DatabaseConnection {
    return this.connection;
  }

  /**
   * Execute a SQL statement
   */
  protected run(sql: string, params?: (string | number | null | Uint8Array)[]): void {
    this.connection.run(sql, params);
  }

  /**
   * Execute a SQL query
   */
  protected exec(sql: string, params?: (string | number | null | Uint8Array)[]): QueryResult[] {
    return this.connection.exec(sql, params);
  }

  /**
   * Get modified row count
   */
  protected getRowsModified(): number {
    return this.connection.getRowsModified();
  }

  /**
   * Safely parse JSON with a fallback value
   */
  protected safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
    if (value === null || value === undefined || value === '') {
      return fallback;
    }
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  /**
   * Convert a row array to an object using column names
   */
  protected rowToObject<T>(columns: string[], row: unknown[]): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, idx) => {
      obj[col] = row[idx];
    });
    return obj;
  }
}
