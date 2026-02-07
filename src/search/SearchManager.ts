/**
 * Search Manager - High-level interface for memory search operations
 */

import type { Database as SqlJsDatabase } from 'sql.js';
import { InvertedIndex, type DocumentType, type SearchResult } from './InvertedIndex.js';
import type {
  EpisodicMemory,
  SemanticEntity,
  WorkingMemoryItem,
  Pattern,
  Insight,
  WisdomEntity,
} from '../memory/types.js';

export interface SearchOptions {
  /** Document types to search (default: all) */
  types?: DocumentType[];
  /** Maximum number of results (default: 20) */
  limit?: number;
  /** Minimum score threshold (default: 0) */
  minScore?: number;
  /** Whether to include metadata in results */
  includeMetadata?: boolean;
}

export interface EnrichedSearchResult extends SearchResult {
  metadata?: {
    summary?: string;
    name?: string;
    type?: string;
    timestamp?: number;
  };
}

export class SearchManager {
  private index: InvertedIndex;
  private db: SqlJsDatabase | null = null;

  constructor(db: SqlJsDatabase | null) {
    this.db = db;
    this.index = new InvertedIndex(db);
  }

  setDatabase(db: SqlJsDatabase): void {
    this.db = db;
    this.index.setDatabase(db);
  }

  setSaveCallback(callback: () => void): void {
    this.index.setSaveCallback(callback);
  }

  /**
   * Initialize the search index (create tables)
   */
  initialize(): void {
    this.index.createTable();
  }

  /**
   * Index an episodic memory
   */
  indexEpisode(episode: EpisodicMemory): void {
    this.index.indexDocumentFields('episodic', episode.id, {
      summary: episode.summary,
      details: episode.details,
      tags: episode.tags?.join(' '),
      learnings: episode.outcome?.learnings?.join(' '),
    });
  }

  /**
   * Index a semantic entity
   */
  indexEntity(entity: SemanticEntity): void {
    this.index.indexDocumentFields('semantic', entity.id, {
      name: entity.name,
      description: entity.description,
      tags: entity.tags?.join(' '),
      observations: entity.observations?.join(' '),
    });
  }

  /**
   * Index a working memory item
   */
  indexWorkingItem(item: WorkingMemoryItem): void {
    const valueStr = typeof item.value === 'string'
      ? item.value
      : JSON.stringify(item.value);

    this.index.indexDocumentFields('working', item.id, {
      key: item.key,
      value: valueStr,
      tags: item.tags?.join(' '),
    });
  }

  /**
   * Index a pattern
   */
  indexPattern(pattern: Pattern): void {
    this.index.indexDocumentFields('pattern', pattern.id, {
      pattern: pattern.pattern,
      tags: pattern.relatedTags?.join(' '),
    });
  }

  /**
   * Index an insight
   */
  indexInsight(insight: Insight): void {
    this.index.indexDocumentFields('insight', insight.id, {
      insight: insight.insight,
      reasoning: insight.reasoning,
      domains: insight.domains?.join(' '),
    });
  }

  /**
   * Index a wisdom entity
   */
  indexWisdom(wisdom: WisdomEntity): void {
    this.index.indexDocumentFields('wisdom', wisdom.id, {
      name: wisdom.name,
      principle: wisdom.principle,
      description: wisdom.description,
      tags: wisdom.tags?.join(' '),
      domains: wisdom.applicableDomains?.join(' '),
    });
  }

  /**
   * Remove a document from the index
   */
  removeDocument(docType: DocumentType, docId: string): boolean {
    return this.index.removeDocument(docType, docId);
  }

  /**
   * Search across memory types
   */
  search(query: string, options?: SearchOptions): SearchResult[] {
    return this.index.search(query, {
      docTypes: options?.types,
      limit: options?.limit ?? 20,
      minScore: options?.minScore,
    });
  }

  /**
   * Search with enriched metadata
   */
  searchWithMetadata(query: string, options?: SearchOptions): EnrichedSearchResult[] {
    if (!this.db) return [];

    const results = this.search(query, options);
    if (!options?.includeMetadata) {
      return results;
    }

    return results.map(result => {
      const enriched: EnrichedSearchResult = { ...result };
      try {
        switch (result.docType) {
          case 'episodic': {
            const res = this.db!.exec(
              'SELECT summary, type, timestamp FROM episodic_memory WHERE id = ?',
              [result.docId]
            );
            if (res.length > 0 && res[0].values.length > 0) {
              enriched.metadata = {
                summary: res[0].values[0][0] as string,
                type: res[0].values[0][1] as string,
                timestamp: res[0].values[0][2] as number,
              };
            }
            break;
          }
          case 'semantic': {
            const res = this.db!.exec(
              'SELECT name, description, type FROM semantic_entities WHERE id = ?',
              [result.docId]
            );
            if (res.length > 0 && res[0].values.length > 0) {
              enriched.metadata = {
                name: res[0].values[0][0] as string,
                summary: res[0].values[0][1] as string,
                type: res[0].values[0][2] as string,
              };
            }
            break;
          }
          case 'pattern': {
            const res = this.db!.exec(
              'SELECT pattern, status, created_at FROM patterns WHERE id = ?',
              [result.docId]
            );
            if (res.length > 0 && res[0].values.length > 0) {
              enriched.metadata = {
                summary: res[0].values[0][0] as string,
                type: res[0].values[0][1] as string,
                timestamp: res[0].values[0][2] as number,
              };
            }
            break;
          }
          case 'insight': {
            const res = this.db!.exec(
              'SELECT insight, status, created_at FROM insights WHERE id = ?',
              [result.docId]
            );
            if (res.length > 0 && res[0].values.length > 0) {
              enriched.metadata = {
                summary: res[0].values[0][0] as string,
                type: res[0].values[0][1] as string,
                timestamp: res[0].values[0][2] as number,
              };
            }
            break;
          }
          case 'wisdom': {
            const res = this.db!.exec(
              'SELECT name, principle, created_at FROM wisdom WHERE id = ?',
              [result.docId]
            );
            if (res.length > 0 && res[0].values.length > 0) {
              enriched.metadata = {
                name: res[0].values[0][0] as string,
                summary: res[0].values[0][1] as string,
                timestamp: res[0].values[0][2] as number,
              };
            }
            break;
          }
        }
      } catch {
        // Ignore metadata enrichment errors
      }
      return enriched;
    });
  }

  /**
   * Get search index statistics
   */
  getStats(): { totalTerms: number; uniqueTerms: number; documentCount: number } {
    return this.index.getStats();
  }

  /**
   * Clear the search index
   */
  clear(): void {
    this.index.clear();
  }

  /**
   * Rebuild index for a specific document type
   */
  clearDocumentType(docType: DocumentType): void {
    this.index.clearDocumentType(docType);
  }
}
