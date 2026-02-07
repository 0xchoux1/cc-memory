/**
 * DIKW Pipeline - Automatic pattern detection and knowledge promotion
 *
 * This module implements automatic progression through the DIKW hierarchy:
 * Data (Episodes) → Information (grouped by similarity) → Knowledge (Patterns) → Wisdom
 *
 * Key features:
 * - Auto-detect patterns from episodic clusters with similar tags
 * - Promote patterns with frequency >= 3 to insight candidates
 * - Promote successfully applied insights (3+ successes) to wisdom candidates
 */

import type { SqliteStorage } from '../storage/SqliteStorage.js';
import type {
  EpisodicMemory,
  Pattern,
  PatternInput,
  Insight,
  InsightInput,
  WisdomEntity,
  WisdomEntityInput,
  AgentRole,
} from '../memory/types.js';

export interface DIKWPipelineConfig {
  /** Minimum episodes with same tags to suggest a pattern (default: 3) */
  minEpisodesForPattern: number;
  /** Minimum tag overlap ratio to consider episodes similar (default: 0.5) */
  tagOverlapThreshold: number;
  /** Minimum pattern frequency to suggest an insight (default: 3) */
  minFrequencyForInsight: number;
  /** Minimum successful applications to suggest wisdom (default: 3) */
  minSuccessesForWisdom: number;
  /** Maximum age in days to consider for pattern detection (default: 30) */
  maxEpisodeAgeDays: number;
}

export const DEFAULT_DIKW_CONFIG: DIKWPipelineConfig = {
  minEpisodesForPattern: 3,
  tagOverlapThreshold: 0.5,
  minFrequencyForInsight: 3,
  minSuccessesForWisdom: 3,
  maxEpisodeAgeDays: 30,
};

export interface PatternCandidate {
  suggestedPattern: string;
  supportingEpisodes: string[];
  commonTags: string[];
  confidence: number;
  episodeCount: number;
}

export interface InsightCandidate {
  suggestedInsight: string;
  sourcePattern: Pattern;
  reasoning: string;
  domains: string[];
  confidence: number;
}

export interface WisdomCandidate {
  suggestedWisdom: {
    name: string;
    principle: string;
    description: string;
  };
  sourceInsight: Insight;
  sourcePatterns: Pattern[];
  evidenceEpisodes: string[];
  confidence: number;
}

export interface PipelineAnalysisResult {
  patternCandidates: PatternCandidate[];
  insightCandidates: InsightCandidate[];
  wisdomCandidates: WisdomCandidate[];
  stats: {
    episodesAnalyzed: number;
    patternsAnalyzed: number;
    insightsAnalyzed: number;
    timestamp: number;
  };
}

export class DIKWPipeline {
  private storage: SqliteStorage;
  private config: DIKWPipelineConfig;

  constructor(storage: SqliteStorage, config?: Partial<DIKWPipelineConfig>) {
    this.storage = storage;
    this.config = { ...DEFAULT_DIKW_CONFIG, ...config };
  }

  /**
   * Run full DIKW analysis pipeline
   */
  analyze(): PipelineAnalysisResult {
    const patternCandidates = this.detectPatternCandidates();
    const insightCandidates = this.detectInsightCandidates();
    const wisdomCandidates = this.detectWisdomCandidates();

    const episodes = this.getRecentEpisodes();
    const patterns = this.storage.listPatterns({ limit: 1000 });
    const insights = this.storage.listInsights({ limit: 1000 });

    return {
      patternCandidates,
      insightCandidates,
      wisdomCandidates,
      stats: {
        episodesAnalyzed: episodes.length,
        patternsAnalyzed: patterns.length,
        insightsAnalyzed: insights.length,
        timestamp: Date.now(),
      },
    };
  }

  /**
   * Detect pattern candidates from episodic clusters
   *
   * Groups episodes by tag similarity and suggests patterns
   * for clusters that meet the minimum episode threshold.
   */
  detectPatternCandidates(): PatternCandidate[] {
    const episodes = this.getRecentEpisodes();
    const clusters = this.clusterEpisodesByTags(episodes);
    const candidates: PatternCandidate[] = [];

    for (const cluster of clusters) {
      if (cluster.episodes.length >= this.config.minEpisodesForPattern) {
        // Check if a similar pattern already exists
        const existingPatterns = this.storage.listPatterns({
          limit: 100,
        });

        const hasExistingPattern = existingPatterns.some((p: Pattern) => {
          const tagOverlap = this.calculateTagOverlap(p.relatedTags, cluster.commonTags);
          return tagOverlap >= this.config.tagOverlapThreshold;
        });

        if (!hasExistingPattern) {
          const suggestedPattern = this.generatePatternDescription(cluster);
          const confidence = this.calculatePatternConfidence(cluster);

          candidates.push({
            suggestedPattern,
            supportingEpisodes: cluster.episodes.map(e => e.id),
            commonTags: cluster.commonTags,
            confidence,
            episodeCount: cluster.episodes.length,
          });
        }
      }
    }

    // Sort by confidence and episode count
    return candidates.sort((a, b) =>
      (b.confidence * b.episodeCount) - (a.confidence * a.episodeCount)
    );
  }

  /**
   * Detect insight candidates from high-frequency patterns
   */
  detectInsightCandidates(): InsightCandidate[] {
    const patterns = this.storage.listPatterns({
      status: 'confirmed',
      minFrequency: this.config.minFrequencyForInsight,
      limit: 100,
    });

    const candidates: InsightCandidate[] = [];

    for (const pattern of patterns) {
      // Check if an insight already exists for this pattern
      const existingInsights = this.storage.listInsights({ limit: 1000 });
      const hasExistingInsight = existingInsights.some((i: Insight) =>
        i.sourcePatterns.includes(pattern.id)
      );

      if (!hasExistingInsight) {
        const suggestedInsight = this.generateInsightFromPattern(pattern);
        const domains = this.inferDomains(pattern);

        candidates.push({
          suggestedInsight: suggestedInsight.insight,
          sourcePattern: pattern,
          reasoning: suggestedInsight.reasoning,
          domains,
          confidence: pattern.confidence * 0.8, // Slightly lower confidence for derived insights
        });
      }
    }

    return candidates.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Detect wisdom candidates from validated insights with successful applications
   */
  detectWisdomCandidates(): WisdomCandidate[] {
    const insights = this.storage.listInsights({
      status: 'validated',
      limit: 100,
    });

    const candidates: WisdomCandidate[] = [];

    for (const insight of insights) {
      // Check validation count (successful applications)
      // For now, we use the validatedBy array length as a proxy
      const validationCount = insight.validatedBy?.length || 0;

      if (validationCount >= this.config.minSuccessesForWisdom) {
        // Check if wisdom already exists for this insight
        const existingWisdom = this.storage.listWisdom({ limit: 1000 });
        const hasExistingWisdom = existingWisdom.some((w: WisdomEntity) =>
          w.derivedFromInsights.includes(insight.id)
        );

        if (!hasExistingWisdom) {
          const sourcePatterns = insight.sourcePatterns
            .map((pid: string) => this.storage.getPattern(pid))
            .filter((p): p is Pattern => p !== null);

          const evidenceEpisodes = sourcePatterns
            .flatMap((p: Pattern) => p.supportingEpisodes)
            .filter((id: string, index: number, arr: string[]) => arr.indexOf(id) === index); // unique

          const suggestedWisdom = this.generateWisdomFromInsight(insight, sourcePatterns);

          candidates.push({
            suggestedWisdom,
            sourceInsight: insight,
            sourcePatterns,
            evidenceEpisodes,
            confidence: insight.confidence * 0.9,
          });
        }
      }
    }

    return candidates.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Create a pattern from a candidate
   */
  createPatternFromCandidate(
    candidate: PatternCandidate,
    agentId?: string,
    agentRoles?: AgentRole[]
  ): Pattern {
    const input: PatternInput = {
      pattern: candidate.suggestedPattern,
      supportingEpisodes: candidate.supportingEpisodes,
      relatedTags: candidate.commonTags,
      confidence: candidate.confidence,
    };

    return this.storage.createPattern(input, agentId, agentRoles);
  }

  /**
   * Create an insight from a candidate
   */
  createInsightFromCandidate(
    candidate: InsightCandidate,
    agentId?: string
  ): Insight {
    const input: InsightInput = {
      insight: candidate.suggestedInsight,
      reasoning: candidate.reasoning,
      sourcePatterns: [candidate.sourcePattern.id],
      domains: candidate.domains,
      confidence: candidate.confidence,
    };

    return this.storage.createInsight(input, agentId);
  }

  /**
   * Create wisdom from a candidate
   */
  createWisdomFromCandidate(
    candidate: WisdomCandidate,
    agentId?: string
  ): WisdomEntity {
    const input: WisdomEntityInput = {
      name: candidate.suggestedWisdom.name,
      principle: candidate.suggestedWisdom.principle,
      description: candidate.suggestedWisdom.description,
      derivedFromInsights: [candidate.sourceInsight.id],
      derivedFromPatterns: candidate.sourcePatterns.map(p => p.id),
      evidenceEpisodes: candidate.evidenceEpisodes,
      applicableDomains: candidate.sourceInsight.domains,
      applicableContexts: [],
      limitations: [],
    };

    return this.storage.createWisdom(input, agentId);
  }

  /**
   * Increment pattern frequency when a similar episode is recorded
   */
  incrementPatternFrequency(episodeId: string): Pattern[] {
    const episode = this.storage.getEpisode(episodeId);
    if (!episode) return [];

    const patterns = this.storage.listPatterns({ limit: 1000 });
    const updatedPatterns: Pattern[] = [];

    for (const pattern of patterns) {
      const tagOverlap = this.calculateTagOverlap(pattern.relatedTags, episode.tags);
      if (tagOverlap >= this.config.tagOverlapThreshold) {
        // Update pattern with new supporting episode
        this.storage.incrementPatternFrequency(pattern.id, episodeId);
        const updated = this.storage.getPattern(pattern.id);
        if (updated) {
          updatedPatterns.push(updated);
        }
      }
    }

    return updatedPatterns;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private getRecentEpisodes(): EpisodicMemory[] {
    const cutoff = Date.now() - (this.config.maxEpisodeAgeDays * 24 * 60 * 60 * 1000);
    return this.storage.searchEpisodes({
      dateRange: { start: cutoff },
      limit: 1000,
    });
  }

  private clusterEpisodesByTags(episodes: EpisodicMemory[]): Array<{
    commonTags: string[];
    episodes: EpisodicMemory[];
  }> {
    const clusters: Map<string, { commonTags: string[]; episodes: EpisodicMemory[] }> = new Map();

    for (const episode of episodes) {
      if (episode.tags.length === 0) continue;

      // Create a cluster key from sorted tags
      const sortedTags = [...episode.tags].sort();
      let matched = false;

      // Try to find an existing cluster with sufficient overlap
      for (const [, cluster] of clusters) {
        const overlap = this.calculateTagOverlap(cluster.commonTags, episode.tags);
        if (overlap >= this.config.tagOverlapThreshold) {
          // Update common tags to intersection
          cluster.commonTags = cluster.commonTags.filter(t => episode.tags.includes(t));
          cluster.episodes.push(episode);
          matched = true;
          break;
        }
      }

      if (!matched) {
        // Create new cluster
        const key = sortedTags.join('|');
        clusters.set(key, {
          commonTags: [...episode.tags],
          episodes: [episode],
        });
      }
    }

    return Array.from(clusters.values());
  }

  private calculateTagOverlap(tags1: string[], tags2: string[]): number {
    if (tags1.length === 0 || tags2.length === 0) return 0;

    const set1 = new Set(tags1);
    const set2 = new Set(tags2);
    const intersection = [...set1].filter(t => set2.has(t));

    // Jaccard-like similarity: intersection / min(size1, size2)
    return intersection.length / Math.min(set1.size, set2.size);
  }

  private generatePatternDescription(cluster: {
    commonTags: string[];
    episodes: EpisodicMemory[];
  }): string {
    const tagList = cluster.commonTags.join(', ');
    const types = [...new Set(cluster.episodes.map(e => e.type))];
    const typeList = types.join('/');

    return `Recurring ${typeList} pattern related to: ${tagList}. ` +
      `Observed ${cluster.episodes.length} times with consistent outcomes.`;
  }

  private calculatePatternConfidence(cluster: {
    commonTags: string[];
    episodes: EpisodicMemory[];
  }): number {
    // Base confidence from episode count (more episodes = higher confidence)
    const countFactor = Math.min(1, cluster.episodes.length / 10);

    // Average importance of supporting episodes
    const avgImportance = cluster.episodes.reduce((sum, e) => sum + e.importance, 0) /
      cluster.episodes.length / 10;

    // Success rate if outcomes are available
    const withOutcomes = cluster.episodes.filter(e => e.outcome);
    const successRate = withOutcomes.length > 0
      ? withOutcomes.filter(e => e.outcome?.status === 'success').length / withOutcomes.length
      : 0.5;

    return (countFactor * 0.4) + (avgImportance * 0.3) + (successRate * 0.3);
  }

  private generateInsightFromPattern(pattern: Pattern): { insight: string; reasoning: string } {
    const insight = `Based on ${pattern.frequency} occurrences: ${pattern.pattern}`;
    const reasoning = `This insight is derived from a confirmed pattern that has been ` +
      `observed ${pattern.frequency} times with ${Math.round(pattern.confidence * 100)}% confidence. ` +
      `Related areas: ${pattern.relatedTags.join(', ')}.`;

    return { insight, reasoning };
  }

  private inferDomains(pattern: Pattern): string[] {
    // Infer domains from pattern tags
    const domainKeywords: Record<string, string[]> = {
      'frontend': ['ui', 'react', 'css', 'html', 'dom', 'component'],
      'backend': ['api', 'server', 'database', 'rest', 'graphql'],
      'security': ['auth', 'security', 'encryption', 'password', 'token'],
      'testing': ['test', 'spec', 'mock', 'assert', 'coverage'],
      'devops': ['deploy', 'ci', 'docker', 'kubernetes', 'pipeline'],
      'performance': ['performance', 'optimization', 'cache', 'speed'],
      'architecture': ['architecture', 'design', 'pattern', 'structure'],
    };

    const tagLower = pattern.relatedTags.map(t => t.toLowerCase());
    const domains: string[] = [];

    for (const [domain, keywords] of Object.entries(domainKeywords)) {
      if (keywords.some(kw => tagLower.some(t => t.includes(kw)))) {
        domains.push(domain);
      }
    }

    return domains.length > 0 ? domains : ['general'];
  }

  private generateWisdomFromInsight(
    insight: Insight,
    patterns: Pattern[]
  ): { name: string; principle: string; description: string } {
    const name = `Wisdom from: ${insight.insight.substring(0, 50)}...`;
    const principle = insight.insight;
    const description = `Validated wisdom derived from insight "${insight.insight}". ` +
      `Based on ${patterns.length} patterns with combined evidence from ` +
      `${patterns.reduce((sum, p) => sum + p.supportingEpisodes.length, 0)} episodes. ` +
      `${insight.reasoning}`;

    return { name, principle, description };
  }
}
