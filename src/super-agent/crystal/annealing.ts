/**
 * Annealing - Maintenance Routines for the Memory Crystal
 *
 * Implements the maintenance/repair loop from Memory Statue v2 Section 6.3.
 * Annealing routines fix drift before it becomes failure.
 *
 * Two invariants (Memory Statue v2 Section 6.3):
 *   1. Never delete raw sources
 *   2. Never let maintenance silently rewrite canon
 */

import { randomUUID } from "node:crypto";
import type { DefectVector } from "../types.js";
import type { DriftMonitor, DriftThresholds } from "./drift.js";
import type { CrystalStorage } from "./storage.js";
import { DEFAULT_THRESHOLDS } from "./drift.js";

// ─── Annealing Task Types ────────────────────────────────────────

export type AnnealingTaskType =
  | "staleness_sweep"
  | "summary_regeneration"
  | "contradiction_scan"
  | "tag_hygiene"
  | "reindex_embeddings"
  | "provenance_audit"
  | "security_scan";

export interface AnnealingTask {
  type: AnnealingTaskType;
  priority: number; // 0 (lowest) to 1 (highest)
  maxDocuments: number;
  maxDurationMs: number;
}

export interface AnnealingResult {
  runId: string;
  timestamp: string;
  tasksExecuted: AnnealingTaskType[];
  preDefects: DefectVector;
  postDefects: DefectVector;
  capsulesTouched: number;
  durationMs: number;
  escalatedToHuman: boolean;
  details: Record<string, unknown>;
}

// ─── Annealing Schedule ──────────────────────────────────────────

export interface AnnealingSchedule {
  // Fixed cadence: run every N interactions
  cadenceInteractions: number;

  // Reactive: run when thresholds are breached
  thresholds: DriftThresholds;

  // Budget per annealing run
  maxDocumentsPerRun: number;
  maxDurationMs: number;
}

export const DEFAULT_SCHEDULE: AnnealingSchedule = {
  cadenceInteractions: 500,
  thresholds: DEFAULT_THRESHOLDS,
  maxDocumentsPerRun: 200,
  maxDurationMs: 30_000,
};

// ─── Annealing Engine ────────────────────────────────────────────

export class AnnealingEngine {
  private lastAnnealStep: number = 0;
  private results: AnnealingResult[] = [];

  constructor(
    private storage: CrystalStorage,
    private driftMonitor: DriftMonitor,
    private schedule: AnnealingSchedule = DEFAULT_SCHEDULE,
  ) {}

  /**
   * Check if annealing should run based on cadence or thresholds.
   */
  shouldRun(currentStep: number): boolean {
    // Cadence check
    if (currentStep - this.lastAnnealStep >= this.schedule.cadenceInteractions) {
      return true;
    }

    // Threshold check
    const defects = this.driftMonitor.computeDefects(currentStep);
    return this.driftMonitor.shouldAnneal(defects);
  }

  /**
   * Execute an annealing run.
   * Selects tasks based on current defect vector, executes them,
   * and measures post-annealing defects to verify improvement.
   */
  async run(currentStep: number): Promise<AnnealingResult> {
    const startTime = Date.now();
    const runId = `anneal_${randomUUID()}`;

    // Measure pre-annealing defects
    const preDefects = this.driftMonitor.computeDefects(currentStep);

    // Select tasks based on which metrics are worst
    const tasks = this.selectTasks(preDefects);
    const tasksExecuted: AnnealingTaskType[] = [];
    let capsulesTouched = 0;
    const details: Record<string, unknown> = {};

    for (const task of tasks) {
      // Budget check
      if (Date.now() - startTime > this.schedule.maxDurationMs) break;
      if (capsulesTouched >= this.schedule.maxDocumentsPerRun) break;

      const result = this.executeTask(task);
      tasksExecuted.push(task.type);
      capsulesTouched += result.touched;
      details[task.type] = result;
    }

    // Measure post-annealing defects
    const postDefects = this.driftMonitor.computeDefects(currentStep);

    // Check if we improved - if not, escalate
    const preDensity = this.driftMonitor.computeDensity(preDefects);
    const postDensity = this.driftMonitor.computeDensity(postDefects);
    const escalatedToHuman = postDensity >= preDensity;

    this.lastAnnealStep = currentStep;

    const annealResult: AnnealingResult = {
      runId,
      timestamp: new Date().toISOString(),
      tasksExecuted,
      preDefects,
      postDefects,
      capsulesTouched,
      durationMs: Date.now() - startTime,
      escalatedToHuman,
      details,
    };

    this.results.push(annealResult);
    return annealResult;
  }

  // ─── Task Selection ────────────────────────────────────────

  private selectTasks(defects: DefectVector): AnnealingTask[] {
    const tasks: AnnealingTask[] = [];

    // Staleness is easy and high-impact
    if (defects.stalenessIndex > this.schedule.thresholds.stalenessIndex) {
      tasks.push({
        type: "staleness_sweep",
        priority: defects.stalenessIndex,
        maxDocuments: 100,
        maxDurationMs: 5_000,
      });
    }

    // Summary divergence
    if (defects.summaryDivergence > this.schedule.thresholds.summaryDivergence) {
      tasks.push({
        type: "summary_regeneration",
        priority: defects.summaryDivergence,
        maxDocuments: 50,
        maxDurationMs: 10_000,
      });
    }

    // Contradiction
    if (defects.contradictionRate > this.schedule.thresholds.contradictionRate) {
      tasks.push({
        type: "contradiction_scan",
        priority: defects.contradictionRate,
        maxDocuments: 50,
        maxDurationMs: 10_000,
      });
    }

    // Tag hygiene (always useful, low priority)
    tasks.push({
      type: "tag_hygiene",
      priority: 0.1,
      maxDocuments: 200,
      maxDurationMs: 3_000,
    });

    // Provenance audit
    tasks.push({
      type: "provenance_audit",
      priority: 0.2,
      maxDocuments: 100,
      maxDurationMs: 3_000,
    });

    // Sort by priority (highest first)
    return tasks.sort((a, b) => b.priority - a.priority);
  }

  // ─── Task Execution ────────────────────────────────────────

  private executeTask(task: AnnealingTask): { touched: number; details: Record<string, unknown> } {
    switch (task.type) {
      case "staleness_sweep":
        return this.stalenessSweep(task.maxDocuments);
      case "summary_regeneration":
        return this.summaryRegeneration(task.maxDocuments);
      case "contradiction_scan":
        return this.contradictionScan(task.maxDocuments);
      case "tag_hygiene":
        return this.tagHygiene(task.maxDocuments);
      case "provenance_audit":
        return this.provenanceAudit(task.maxDocuments);
      case "reindex_embeddings":
        return { touched: 0, details: { note: "requires embedding model" } };
      case "security_scan":
        return this.securityScan(task.maxDocuments);
    }
  }

  /** Expire capsules past their TTL */
  private stalenessSweep(maxDocuments: number): {
    touched: number;
    details: Record<string, unknown>;
  } {
    const expired = this.storage.expireStaleCapsules();
    const touched = Math.min(expired.length, maxDocuments);
    return {
      touched,
      details: { expiredIds: expired.slice(0, maxDocuments) },
    };
  }

  /** Check summaries still match their sources */
  private summaryRegeneration(maxDocuments: number): {
    touched: number;
    details: Record<string, unknown>;
  } {
    const summaries = this.storage.getCapsulesByType("summary");
    let orphaned = 0;
    let checked = 0;

    for (const summary of summaries.slice(0, maxDocuments)) {
      checked++;
      // Check if parent capsules still exist
      const parentsMissing = summary.parentCapsuleIds.some((pid) => !this.storage.getCapsule(pid));
      if (parentsMissing) {
        orphaned++;
        // Flag for review (don't auto-fix - Memory Statue v2 Rule 2)
      }
    }

    return {
      touched: checked,
      details: { checked, orphaned },
    };
  }

  /** Scan for CANON-CANON contradictions */
  private contradictionScan(maxDocuments: number): {
    touched: number;
    details: Record<string, unknown>;
  } {
    const canonCapsules = this.storage.getCapsulesByTrust("CANON").slice(0, maxDocuments);

    // Simple pairwise check for contradictions
    // (In production, use an LLM judge for semantic contradiction detection)
    const contradictions: { a: string; b: string }[] = [];

    for (let i = 0; i < canonCapsules.length; i++) {
      for (let j = i + 1; j < canonCapsules.length; j++) {
        const a = canonCapsules[i]!;
        const b = canonCapsules[j]!;
        if (a.type === b.type && a.type === "decision" && hasOverlappingTags(a, b)) {
          // Same type, same tags, different content = potential contradiction
          if (a.contentHash !== b.contentHash) {
            contradictions.push({ a: a.id, b: b.id });
          }
        }
      }
    }

    return {
      touched: canonCapsules.length,
      details: { scanned: canonCapsules.length, contradictions },
    };
  }

  /** Clean up tag taxonomy */
  private tagHygiene(maxDocuments: number): { touched: number; details: Record<string, unknown> } {
    const capsules = this.storage.getAllCapsules().slice(0, maxDocuments);
    const tagValues = new Map<string, number>();

    for (const capsule of capsules) {
      for (const tag of capsule.tags) {
        const key = `${tag.category}:${tag.value}`;
        tagValues.set(key, (tagValues.get(key) ?? 0) + 1);
      }
    }

    // Identify rare tags (potential typos)
    const rareTags = Array.from(tagValues.entries())
      .filter(([_, count]) => count === 1)
      .map(([tag]) => tag);

    return {
      touched: capsules.length,
      details: {
        uniqueTags: tagValues.size,
        rareTags: rareTags.slice(0, 20),
      },
    };
  }

  /** Check provenance chains are intact */
  private provenanceAudit(maxDocuments: number): {
    touched: number;
    details: Record<string, unknown>;
  } {
    const capsules = this.storage.getAllCapsules().slice(0, maxDocuments);
    let noProvenance = 0;
    let brokenLinks = 0;

    for (const capsule of capsules) {
      if (capsule.provenance.length === 0) {
        noProvenance++;
      }
      for (const entry of capsule.provenance) {
        if (entry.sourceType === "capsule_derivation" && !this.storage.getCapsule(entry.sourceId)) {
          brokenLinks++;
        }
      }
    }

    return {
      touched: capsules.length,
      details: { noProvenance, brokenLinks },
    };
  }

  /** Scan for untrusted capsules that might be influencing trusted behavior */
  private securityScan(maxDocuments: number): {
    touched: number;
    details: Record<string, unknown>;
  } {
    const untrusted = this.storage.getCapsulesByTrust("UNTRUSTED").slice(0, maxDocuments);

    // Check if any untrusted capsules are frequently accessed
    // (potential injection/poison drift)
    const suspicious = untrusted.filter((c) => c.accessCount > 10);

    return {
      touched: untrusted.length,
      details: {
        untrustedCount: untrusted.length,
        suspiciousCount: suspicious.length,
        suspiciousIds: suspicious.map((c) => c.id),
      },
    };
  }

  // ─── Results History ───────────────────────────────────────

  getResults(): AnnealingResult[] {
    return [...this.results];
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function hasOverlappingTags(
  a: { tags: { category: string; value: string }[] },
  b: { tags: { category: string; value: string }[] },
): boolean {
  const aSet = new Set(a.tags.map((t) => `${t.category}:${t.value}`));
  return b.tags.some((t) => aSet.has(`${t.category}:${t.value}`));
}
