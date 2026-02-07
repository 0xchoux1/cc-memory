/**
 * Inverted Index implementation for fast full-text search
 * Stores term -> document mappings in SQLite
 */

import type { Database as SqlJsDatabase } from 'sql.js';
import { tokenize, calculateTermFrequency } from './tokenizer.js';

export type DocumentType = 'episodic' | 'semantic' | 'working' | 'pattern' | 'insight' | 'wisdom';

export interface IndexEntry {
  term: string;
  docType: DocumentType;
  docId: string;
  frequency: number;
}

export interface SearchResult {
  docType: DocumentType;
  docId: string;
  score: number;
  matchedTerms: string[];
}

export class InvertedIndex {
  private db: SqlJsDatabase | null = null;
  private saveCallback?: () => void;

  constructor(db: SqlJsDatabase | null) {
    this.db = db;
  }

  setDatabase(db: SqlJsDatabase): void {
    this.db = db;
  }

  setSaveCallback(callback: () => void): void {
    this.saveCallback = callback;
  }

  private save(): void {
    if (this.saveCallback) {
      this.saveCallback();
    }
  }

  /**
   * Create the search index table if it doesn't exist
   */
  createTable(): void {
    if (!this.db) return;

    this.db.run(`
      CREATE TABLE IF NOT EXISTS search_index (
        term TEXT NOT NULL,
        doc_type TEXT NOT NULL,
        doc_id TEXT NOT NULL,
        frequency INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (term, doc_type, doc_id)
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_search_term ON search_index(term)
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_search_doc ON search_index(doc_type, doc_id)
    `);

    this.save();
  }

  /**
   * Index a document by extracting and storing its terms
   */
  indexDocument(docType: DocumentType, docId: string, content: string): number {
    if (!this.db || !content) return 0;

    const tokens = tokenize(content);
    if (tokens.length === 0) return 0;

    const termFreq = calculateTermFrequency(tokens);
    const now = Date.now();

    // Remove existing entries for this document
    this.db.run('DELETE FROM search_index WHERE doc_type = ? AND doc_id = ?', [docType, docId]);

    // Insert new entries
    let indexed = 0;
    for (const [term, frequency] of termFreq) {
      this.db.run(
        'INSERT INTO search_index (term, doc_type, doc_id, frequency, created_at) VALUES (?, ?, ?, ?, ?)',
        [term, docType, docId, frequency, now]
      );
      indexed++;
    }

    this.save();
    return indexed;
  }

  /**
   * Index multiple fields of a document
   */
  indexDocumentFields(docType: DocumentType, docId: string, fields: Record<string, string | undefined>): number {
    const combinedContent = Object.values(fields)
      .filter((v): v is string => v !== undefined && v !== null)
      .join(' ');

    return this.indexDocument(docType, docId, combinedContent);
  }

  /**
   * Remove a document from the index
   */
  removeDocument(docType: DocumentType, docId: string): boolean {
    if (!this.db) return false;

    this.db.run('DELETE FROM search_index WHERE doc_type = ? AND doc_id = ?', [docType, docId]);
    const changes = this.db.getRowsModified();
    this.save();
    return changes > 0;
  }

  /**
   * Search for documents matching the query
   */
  search(query: string, options?: {
    docTypes?: DocumentType[];
    limit?: number;
    minScore?: number;
  }): SearchResult[] {
    if (!this.db || !query) return [];

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const placeholders = queryTokens.map(() => '?').join(', ');
    let sql = `
      SELECT doc_type, doc_id, term, frequency
      FROM search_index
      WHERE term IN (${placeholders})
    `;
    const params: (string | number)[] = [...queryTokens];

    if (options?.docTypes && options.docTypes.length > 0) {
      const typeHolders = options.docTypes.map(() => '?').join(', ');
      sql += ` AND doc_type IN (${typeHolders})`;
      params.push(...options.docTypes);
    }

    const result = this.db.exec(sql, params);
    if (result.length === 0) return [];

    // Aggregate results by document
    const docScores = new Map<string, { score: number; matchedTerms: Set<string>; docType: DocumentType }>();

    for (const row of result[0].values) {
      const docType = row[0] as DocumentType;
      const docId = row[1] as string;
      const term = row[2] as string;
      const frequency = row[3] as number;

      const key = `${docType}:${docId}`;
      const existing = docScores.get(key);

      if (existing) {
        existing.score += frequency;
        existing.matchedTerms.add(term);
      } else {
        docScores.set(key, {
          score: frequency,
          matchedTerms: new Set([term]),
          docType,
        });
      }
    }

    // Convert to results and apply scoring boost for multiple term matches
    let results: SearchResult[] = [];
    for (const [key, data] of docScores) {
      const docId = key.split(':').slice(1).join(':');
      const matchRatio = data.matchedTerms.size / queryTokens.length;
      const finalScore = data.score * (1 + matchRatio);

      results.push({
        docType: data.docType,
        docId,
        score: finalScore,
        matchedTerms: [...data.matchedTerms],
      });
    }

    if (options?.minScore !== undefined) {
      results = results.filter(r => r.score >= options.minScore!);
    }

    results.sort((a, b) => b.score - a.score);

    if (options?.limit !== undefined && options.limit > 0) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Get index statistics
   */
  getStats(): { totalTerms: number; uniqueTerms: number; documentCount: number } {
    if (!this.db) {
      return { totalTerms: 0, uniqueTerms: 0, documentCount: 0 };
    }

    const totalResult = this.db.exec('SELECT SUM(frequency) FROM search_index');
    const uniqueResult = this.db.exec('SELECT COUNT(DISTINCT term) FROM search_index');
    const docResult = this.db.exec('SELECT COUNT(DISTINCT doc_type || doc_id) FROM search_index');

    return {
      totalTerms: totalResult.length > 0 && totalResult[0].values[0][0]
        ? Number(totalResult[0].values[0][0])
        : 0,
      uniqueTerms: uniqueResult.length > 0 && uniqueResult[0].values[0][0]
        ? Number(uniqueResult[0].values[0][0])
        : 0,
      documentCount: docResult.length > 0 && docResult[0].values[0][0]
        ? Number(docResult[0].values[0][0])
        : 0,
    };
  }

  /**
   * Clear the entire index
   */
  clear(): void {
    if (!this.db) return;
    this.db.run('DELETE FROM search_index');
    this.save();
  }

  /**
   * Rebuild index for a specific document type
   */
  clearDocumentType(docType: DocumentType): void {
    if (!this.db) return;
    this.db.run('DELETE FROM search_index WHERE doc_type = ?', [docType]);
    this.save();
  }
}
