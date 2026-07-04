/**
 * Drift Monitor
 *
 * Implements defect vector computation and threshold monitoring
 * from Memory Statue v2 Section 6. Tracks the 8 drift metrics
 * and computes scalar defect density.
 */

import type { Capsule, DefectVector, RetrievalResult } from "../types.js";
import type { CrystalStorage } from "./storage.js";
import { DEFAULT_DRIFT_WEIGHTS } from "../types.js";
import { isCapsuleExpired, isCapsuleStale } from "./capsule.js";

// ─── Drift Thresholds ────────────────────────────────────────────

export interface DriftThresholds {
  contradictionRate: number;
  unfaithfulnessRate: number;
  decisionInconsistency: number;
  stalenessIndex: number;
  summaryDivergence: number;
  retrievalMissRate: number;
  toolCallTailLatency: number;
  tokenTailCost: number;
}

export const DEFAULT_THRESHOLDS: DriftThresholds = {
  contradictionRate: 0.1,
  unfaithfulnessRate: 0.15,
  decisionInconsistency: 0.1,
  stalenessIndex: 0.2,
  summaryDivergence: 0.25,
  retrievalMissRate: 0.15,
  toolCallTailLatency: 0.8,
  tokenTailCost: 0.8,
};

export interface ThresholdBreach {
  metric: keyof DefectVector;
  value: number;
  threshold: number;
}

// ─── Interaction Log (for rolling window metrics) ────────────────

export interface InteractionLog {
  step: number;
  timestamp: string;
  queryId: string;
  retrievedCapsuleIds: string[];
  outputClaims?: string[];
  supportedClaims?: number;
  totalClaims?: number;
  hadContradiction: boolean;
  decisionCorrect?: boolean;
  toolCalls: number;
  tokensUsed: number;
}

// ─── Drift Monitor ───────────────────────────────────────────────

export class DriftMonitor {
  private interactionLogs: InteractionLog[] = [];
  private defectHistory: { step: number; defects: DefectVector }[] = [];
  private readonly maxDefectHistory = 1000;

  constructor(
    private storage: CrystalStorage,
    private thresholds: DriftThresholds = DEFAULT_THRESHOLDS,
    private weights: number[] = DEFAULT_DRIFT_WEIGHTS,
    private windowSize: number = 100,
  ) {}

  // ─── Log an Interaction ────────────────────────────────────

  logInteraction(log: InteractionLog): void {
    this.interactionLogs.push(log);
    // Keep rolling window
    if (this.interactionLogs.length > this.windowSize * 2) {
      this.interactionLogs = this.interactionLogs.slice(-this.windowSize);
    }
  }

  // ─── Compute Defect Vector ─────────────────────────────────

  computeDefects(step?: number): DefectVector {
    const window = this.getWindow(step);
    const now = new Date();

    const defects: DefectVector = {
      contradictionRate: this.computeCVR(window),
      unfaithfulnessRate: this.computeUF(window),
      decisionInconsistency: this.computeDI(window),
      stalenessIndex: this.computeSI(now),
      summaryDivergence: this.computeSD(),
      retrievalMissRate: this.computeRMR(window),
      toolCallTailLatency: this.computeTL(window),
      tokenTailCost: this.computeTC(window),
    };

    this.defectHistory.push({
      step: step ?? this.interactionLogs.length,
      defects,
    });
    // Bound telemetry history so long-running monitors do not leak memory.
    if (this.defectHistory.length > this.maxDefectHistory) {
      this.defectHistory = this.defectHistory.slice(-this.maxDefectHistory);
    }

    return defects;
  }

  // ─── Scalar Defect Density ─────────────────────────────────

  computeDensity(defects: DefectVector): number {
    const values = [
      defects.contradictionRate,
      defects.unfaithfulnessRate,
      defects.decisionInconsistency,
      defects.stalenessIndex,
      defects.summaryDivergence,
      defects.retrievalMissRate,
      defects.toolCallTailLatency,
      defects.tokenTailCost,
    ];

    return this.weights.reduce((sum, w, i) => sum + w * (values[i] ?? 0), 0);
  }

  // ─── Threshold Checking ────────────────────────────────────

  checkThresholds(defects: DefectVector): ThresholdBreach[] {
    const breaches: ThresholdBreach[] = [];
    const entries = Object.entries(defects) as [keyof DefectVector, number][];

    for (const [metric, value] of entries) {
      const threshold = this.thresholds[metric];
      if (value > threshold) {
        breaches.push({ metric, value, threshold });
      }
    }

    return breaches;
  }

  // ─── Should Anneal? ────────────────────────────────────────

  shouldAnneal(defects: DefectVector): boolean {
    return this.checkThresholds(defects).length > 0;
  }

  // ─── Defect History (for survival analysis) ────────────────

  getDefectHistory(): { step: number; defects: DefectVector }[] {
    return [...this.defectHistory];
  }

  /**
   * Estimate hazard: probability of failure at current step.
   * Uses a simple logistic model: h(t) = sigmoid(beta * delta_t)
   * where delta_t is the current defect density.
   */
  estimateHazard(defects: DefectVector, beta: number = 5.0): number {
    const density = this.computeDensity(defects);
    return sigmoid(beta * density);
  }

  /**
   * Estimate survival probability over N future steps.
   * S(t+N) = product(1 - h(t+i)) for i in 1..N
   * Assumes constant hazard (conservative estimate).
   */
  estimateSurvival(defects: DefectVector, steps: number, beta: number = 5.0): number {
    const hazard = this.estimateHazard(defects, beta);
    return Math.pow(1 - hazard, steps);
  }

  // ─── Individual Metric Computations ────────────────────────

  /** CVR: Rolling contradiction rate */
  private computeCVR(window: InteractionLog[]): number {
    if (window.length === 0) return 0;
    const contradictions = window.filter((l) => l.hadContradiction).length;
    return contradictions / window.length;
  }

  /** UF: Unfaithfulness rate (claims not supported by evidence) */
  private computeUF(window: InteractionLog[]): number {
    const logsWithClaims = window.filter((l) => l.totalClaims !== undefined && l.totalClaims > 0);
    if (logsWithClaims.length === 0) return 0;

    let totalSupported = 0;
    let totalClaims = 0;
    for (const log of logsWithClaims) {
      totalSupported += log.supportedClaims ?? 0;
      totalClaims += log.totalClaims ?? 0;
    }

    return totalClaims === 0 ? 0 : 1 - totalSupported / totalClaims;
  }

  /** DI: Decision inconsistency */
  private computeDI(window: InteractionLog[]): number {
    const decisionLogs = window.filter((l) => l.decisionCorrect !== undefined);
    if (decisionLogs.length === 0) return 0;

    const correct = decisionLogs.filter((l) => l.decisionCorrect).length;
    return 1 - correct / decisionLogs.length;
  }

  /** SI: Staleness index (expired capsules in use) */
  private computeSI(now: Date): number {
    const allCapsules = this.storage.getAllCapsules();
    if (allCapsules.length === 0) return 0;

    const expired = allCapsules.filter(
      (c) => isCapsuleExpired(c, now) || isCapsuleStale(c, now),
    ).length;
    return expired / allCapsules.length;
  }

  /** SD: Summary divergence (simplified - checks if summaries have source links) */
  private computeSD(): number {
    const summaries = this.storage.getCapsulesByType("summary");
    if (summaries.length === 0) return 0;

    // Check how many summaries still have valid source links
    const withSources = summaries.filter((s) => s.parentCapsuleIds.length > 0).length;
    const orphaned = summaries.length - withSources;

    return orphaned / summaries.length;
  }

  /** RMR: Retrieval miss rate (requires golden sets - simplified) */
  private computeRMR(window: InteractionLog[]): number {
    // Without golden retrieval sets, use a proxy:
    // what fraction of retrievals returned empty results?
    if (window.length === 0) return 0;
    const misses = window.filter((l) => l.retrievedCapsuleIds.length === 0).length;
    return misses / window.length;
  }

  /** TL: Tool call tail latency (P95 of tool calls) */
  private computeTL(window: InteractionLog[]): number {
    if (window.length === 0) return 0;
    const toolCalls = window.map((l) => l.toolCalls).sort((a, b) => a - b);
    const p95Index = Math.floor(toolCalls.length * 0.95);
    const p95 = toolCalls[p95Index] ?? 0;
    // Normalize: assume max acceptable is 50 tool calls
    return Math.min(1, p95 / 50);
  }

  /** TC: Token cost tail (P95 of tokens used) */
  private computeTC(window: InteractionLog[]): number {
    if (window.length === 0) return 0;
    const tokens = window.map((l) => l.tokensUsed).sort((a, b) => a - b);
    const p95Index = Math.floor(tokens.length * 0.95);
    const p95 = tokens[p95Index] ?? 0;
    // Normalize: assume max acceptable is 100k tokens
    return Math.min(1, p95 / 100_000);
  }

  // ─── Helpers ───────────────────────────────────────────────

  private getWindow(step?: number): InteractionLog[] {
    if (step === undefined) {
      return this.interactionLogs.slice(-this.windowSize);
    }
    return this.interactionLogs.filter((l) => l.step <= step && l.step > step - this.windowSize);
  }
}

// ─── Math Utilities ──────────────────────────────────────────────

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
