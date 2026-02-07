/**
 * Diffraction Retrieval Pipeline
 *
 * Implements the 4-stage retrieval pipeline from Memory Statue v2 Section 5:
 *   Stage 1: Policy Filter - enforce determinative tags + ACL
 *   Stage 2: Hybrid Retrieve - vector similarity + BM25 keyword
 *   Stage 3: Rerank/Score - relevance scoring with trust weighting
 *   Stage 4: Pack - bounded evidence set with provenance
 */

import { createHash } from "node:crypto";
import type {
  Capsule,
  DeterminativeTag,
  PipelineTrace,
  RetrievalConstraints,
  RetrievalRequest,
  RetrievalResult,
  TrustLevel,
} from "../types.js";
import type { CrystalStorage } from "./storage.js";
import { TRUST_RANK } from "../types.js";
import { estimateTokens, isCapsuleExpired } from "./capsule.js";

// ─── Retrieval Pipeline ──────────────────────────────────────────

export class RetrievalPipeline {
  constructor(private storage: CrystalStorage) {}

  /**
   * Execute the full 4-stage retrieval pipeline.
   */
  retrieve(request: RetrievalRequest): RetrievalResult {
    const startTime = Date.now();
    const allCapsules = this.storage.getAllCapsules();

    // Stage 1: Policy Filter
    const stage1 = this.policyFilter(allCapsules, request.permissions, request.constraints);

    // Stage 2: Hybrid Retrieve (candidates)
    const stage2 = this.hybridRetrieve(stage1, request.query);

    // Stage 3: Rerank/Score
    const stage3 = this.rerank(stage2, request.query, request.constraints);

    // Stage 4: Pack (bounded evidence set)
    const stage4 = this.pack(stage3, request.constraints);

    const packedContent = stage4.map((c) => c.content).join("\n");
    const contextPackHash = createHash("sha256").update(packedContent).digest("hex");

    const trace: PipelineTrace = {
      stage1_policyFiltered: stage1.length,
      stage2_candidateCount: stage2.length,
      stage3_rerankedCount: stage3.length,
      stage4_packedCount: stage4.length,
      durationMs: Date.now() - startTime,
    };

    return {
      capsules: stage4,
      totalCandidates: allCapsules.length,
      pipelineTrace: trace,
      contextPackHash,
      tokenCount: estimateTokens(packedContent),
    };
  }

  // ─── Stage 1: Policy Filter ────────────────────────────────

  /**
   * Filter capsules by determinative tags and permissions.
   * Non-negotiable constraints are enforced BEFORE similarity scoring.
   */
  private policyFilter(
    capsules: Capsule[],
    permissions: string[],
    constraints: RetrievalConstraints,
  ): Capsule[] {
    const now = new Date();

    return capsules.filter((capsule) => {
      // Filter expired capsules
      if (isCapsuleExpired(capsule, now)) return false;

      // Filter by trust floor
      if (TRUST_RANK[capsule.trust] < TRUST_RANK[constraints.trustFloor]) {
        return false;
      }

      // Filter by time window
      if (constraints.timeWindow) {
        if (constraints.timeWindow.after && capsule.createdAt < constraints.timeWindow.after) {
          return false;
        }
        if (constraints.timeWindow.before && capsule.createdAt > constraints.timeWindow.before) {
          return false;
        }
      }

      // Enforce security tags - capsules with CONFIDENTIAL tags
      // require matching permission
      const securityTags = capsule.tags.filter((t) => t.category === "security" && t.enforced);
      for (const tag of securityTags) {
        if (!permissions.includes(tag.value)) {
          return false;
        }
      }

      // Enforce required tags
      if (constraints.requiredTags) {
        for (const required of constraints.requiredTags) {
          const hasTag = capsule.tags.some(
            (t) => t.category === required.category && t.value === required.value,
          );
          if (!hasTag) return false;
        }
      }

      // Enforce excluded tags
      if (constraints.excludedTags) {
        for (const excluded of constraints.excludedTags) {
          const hasExcluded = capsule.tags.some(
            (t) => t.category === excluded.category && t.value === excluded.value,
          );
          if (hasExcluded) return false;
        }
      }

      // Filter archived capsules
      const isArchived = capsule.tags.some(
        (t) => t.category === "authority" && t.value === "ARCHIVED",
      );
      if (isArchived) return false;

      return true;
    });
  }

  // ─── Stage 2: Hybrid Retrieve ──────────────────────────────

  /**
   * Hybrid retrieval: keyword matching + basic relevance scoring.
   * In production, this would use vector similarity + BM25.
   * This reference implementation uses keyword-based scoring.
   */
  private hybridRetrieve(candidates: Capsule[], query: string): ScoredCapsule[] {
    const queryTerms = tokenize(query);

    return candidates
      .map((capsule) => {
        const contentTerms = tokenize(capsule.content);
        const keywordScore = bm25Score(queryTerms, contentTerms);
        const recencyScore = computeRecencyScore(capsule.updatedAt);
        const trustBonus = TRUST_RANK[capsule.trust] / 4; // normalize to 0-1

        return {
          capsule,
          score: keywordScore * 0.6 + recencyScore * 0.2 + trustBonus * 0.2,
        };
      })
      .filter((sc) => sc.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  // ─── Stage 3: Rerank ───────────────────────────────────────

  /**
   * Rerank candidates by combining relevance, trust, and usefulness.
   * In production, this would use a cross-encoder reranker model.
   */
  private rerank(
    candidates: ScoredCapsule[],
    query: string,
    constraints: RetrievalConstraints,
  ): ScoredCapsule[] {
    // Apply trust-weighted reranking
    return candidates
      .map((sc) => {
        const trustWeight = TRUST_RANK[sc.capsule.trust] / 4;
        const usefulnessWeight = sc.capsule.usefulness;
        const accessWeight = Math.min(sc.capsule.accessCount / 100, 1);

        const rerankScore =
          sc.score * 0.5 + trustWeight * 0.25 + usefulnessWeight * 0.15 + accessWeight * 0.1;

        return { capsule: sc.capsule, score: rerankScore };
      })
      .sort((a, b) => b.score - a.score);
  }

  // ─── Stage 4: Pack ─────────────────────────────────────────

  /**
   * Pack candidates into a bounded evidence set.
   * Respects token budget and capsule count limits.
   * Preserves provenance: each capsule in the pack is traceable.
   */
  private pack(candidates: ScoredCapsule[], constraints: RetrievalConstraints): Capsule[] {
    const packed: Capsule[] = [];
    let tokenCount = 0;

    for (const { capsule } of candidates) {
      if (packed.length >= constraints.maxCapsules) break;

      const capsuleTokens = estimateTokens(capsule.content);
      if (tokenCount + capsuleTokens > constraints.maxTokens) break;

      packed.push(capsule);
      tokenCount += capsuleTokens;
    }

    return packed;
  }
}

// ─── Internal Types ──────────────────────────────────────────────

interface ScoredCapsule {
  capsule: Capsule;
  score: number;
}

// ─── BM25 Scoring (simplified) ───────────────────────────────────

const K1 = 1.2;
const B = 0.75;
const AVG_DOC_LENGTH = 100; // assumed average

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function bm25Score(queryTerms: string[], docTerms: string[]): number {
  const docLength = docTerms.length;
  const termFreq = new Map<string, number>();

  for (const term of docTerms) {
    termFreq.set(term, (termFreq.get(term) ?? 0) + 1);
  }

  let score = 0;
  for (const qt of queryTerms) {
    const tf = termFreq.get(qt) ?? 0;
    if (tf === 0) continue;

    // Simplified BM25 (without IDF, which would need corpus-level stats)
    const numerator = tf * (K1 + 1);
    const denominator = tf + K1 * (1 - B + B * (docLength / AVG_DOC_LENGTH));
    score += numerator / denominator;
  }

  return score;
}

// ─── Recency Score ───────────────────────────────────────────────

function computeRecencyScore(updatedAt: string): number {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Exponential decay: half-life of 14 days
  return Math.exp(-0.693 * (ageDays / 14));
}
