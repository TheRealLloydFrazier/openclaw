/**
 * Incremental Context Engine
 *
 * Implements additive (O(delta)) context management instead of
 * rebuilding the full context pack on every turn (O(N)).
 *
 * Core idea: maintain a context snapshot and compute only what changed.
 * Periodic checkpoints prevent snapshot drift.
 */

import { createHash, randomUUID } from "node:crypto";
import type { RetrievalPipeline } from "../crystal/retrieval.js";
import type {
  Capsule,
  CheckpointPolicy,
  ContextDelta,
  ContextSnapshot,
  DeltaReason,
  RetrievalConstraints,
  RetrievalRequest,
  RetrievalResult,
} from "../types.js";
import { estimateTokens } from "../crystal/capsule.js";

// ─── Default Policies ────────────────────────────────────────────

export const DEFAULT_CHECKPOINT_POLICY: CheckpointPolicy = {
  maxTurnsSinceCheckpoint: 20,
  maxDeltaAccumulation: 0.6, // checkpoint if >60% of capsules replaced
  onTopicShift: true,
  onAnnealingComplete: true,
};

// ─── Incremental Context Engine ──────────────────────────────────

export class IncrementalContextEngine {
  private currentSnapshot: ContextSnapshot | null = null;
  private turnsSinceCheckpoint: number = 0;
  private totalDeltaOps: number = 0;
  private snapshotHistory: ContextSnapshot[] = [];
  private readonly maxSnapshotHistory = 500;
  private turnCounter = 0; // monotonic; independent of trimmed history length

  constructor(
    private pipeline: RetrievalPipeline,
    private checkpointPolicy: CheckpointPolicy = DEFAULT_CHECKPOINT_POLICY,
  ) {}

  /**
   * Retrieve context for a query. Uses delta computation when possible,
   * falls back to full retrieval (checkpoint) when needed.
   */
  retrieve(request: RetrievalRequest): IncrementalRetrievalResult {
    const shouldCheckpoint = this.shouldCheckpoint(request);

    if (shouldCheckpoint || !this.currentSnapshot) {
      return this.fullRetrieval(request, "checkpoint");
    }

    return this.deltaRetrieval(request);
  }

  /**
   * Force a full retrieval (checkpoint), ignoring delta path.
   */
  forceCheckpoint(request: RetrievalRequest): IncrementalRetrievalResult {
    return this.fullRetrieval(request, "checkpoint");
  }

  /**
   * Notify the engine that annealing completed (triggers checkpoint).
   */
  onAnnealingComplete(): void {
    if (this.checkpointPolicy.onAnnealingComplete) {
      this.currentSnapshot = null; // force checkpoint on next retrieval
    }
  }

  /**
   * Get the current snapshot (for debugging/observability).
   */
  getCurrentSnapshot(): ContextSnapshot | null {
    return this.currentSnapshot;
  }

  /**
   * Get snapshot history (for analysis).
   */
  getSnapshotHistory(): ContextSnapshot[] {
    return [...this.snapshotHistory];
  }

  // ─── Full Retrieval (Checkpoint) ───────────────────────────

  private fullRetrieval(
    request: RetrievalRequest,
    reason: DeltaReason,
  ): IncrementalRetrievalResult {
    const result = this.pipeline.retrieve(request);

    const snapshot = this.createSnapshot(result);
    this.currentSnapshot = snapshot;
    this.recordSnapshot(snapshot);
    this.turnsSinceCheckpoint = 0;
    this.totalDeltaOps = 0;

    return {
      ...result,
      delta: {
        added: snapshot.capsuleIds,
        removed: [],
        updated: [],
        reordered: false,
        reason,
      },
      wasCheckpoint: true,
      snapshotId: snapshot.snapshotId,
    };
  }

  // ─── Delta Retrieval ───────────────────────────────────────

  private deltaRetrieval(request: RetrievalRequest): IncrementalRetrievalResult {
    const prev = this.currentSnapshot!;

    // Run the full pipeline to get "what should be the context now"
    // The optimization: in production, this would be a lighter-weight
    // delta-aware retrieval that only searches for changes since last snapshot
    const result = this.pipeline.retrieve(request);

    // Compute the delta between previous and current
    const newIds = new Set(result.capsules.map((c) => c.id));
    const prevIds = new Set(prev.capsuleIds);

    const added = result.capsules.filter((c) => !prevIds.has(c.id)).map((c) => c.id);
    const removed = prev.capsuleIds.filter((id) => !newIds.has(id));
    const updated = result.capsules
      .filter((c) => {
        if (!prevIds.has(c.id)) return false;
        const prevVersion = prev.capsuleVersions.get(c.id);
        return prevVersion !== undefined && c.version > prevVersion;
      })
      .map((c) => c.id);

    // Check if ordering changed significantly
    const reordered = !arraysMatchOrder(
      prev.capsuleIds.filter((id) => newIds.has(id)),
      result.capsules.filter((c) => prevIds.has(c.id)).map((c) => c.id),
    );

    const delta: ContextDelta = {
      added,
      removed,
      updated,
      reordered,
      reason: "new_query",
    };

    // Apply delta to create new snapshot
    const snapshot = this.createSnapshot(result);
    this.currentSnapshot = snapshot;
    this.recordSnapshot(snapshot);
    this.turnsSinceCheckpoint++;
    this.totalDeltaOps += added.length + removed.length + updated.length;

    return {
      ...result,
      delta,
      wasCheckpoint: false,
      snapshotId: snapshot.snapshotId,
    };
  }

  // ─── Checkpoint Decision ───────────────────────────────────

  private shouldCheckpoint(request: RetrievalRequest): boolean {
    if (!this.currentSnapshot) return true;

    // Time-based checkpoint
    if (this.turnsSinceCheckpoint >= this.checkpointPolicy.maxTurnsSinceCheckpoint) {
      return true;
    }

    // Delta accumulation checkpoint
    const totalCapsules = this.currentSnapshot.capsuleIds.length || 1;
    if (this.totalDeltaOps / totalCapsules > this.checkpointPolicy.maxDeltaAccumulation) {
      return true;
    }

    // Topic shift detection (simplified: check query overlap with previous)
    if (this.checkpointPolicy.onTopicShift) {
      // In production, use embedding similarity between queries
      // For now, always delta (topic shift detection is a TODO)
    }

    return false;
  }

  // ─── Snapshot Creation ─────────────────────────────────────

  private createSnapshot(result: RetrievalResult): ContextSnapshot {
    const capsuleIds = result.capsules.map((c) => c.id);
    const capsuleVersions = new Map(result.capsules.map((c) => [c.id, c.version]));
    const content = result.capsules.map((c) => c.content).join("\n");
    const contentHash = createHash("sha256").update(content).digest("hex");

    return {
      snapshotId: `snap_${randomUUID()}`,
      turnNumber: ++this.turnCounter,
      capsuleIds,
      capsuleVersions,
      tokenCount: estimateTokens(content),
      contentHash,
      createdAt: new Date().toISOString(),
    };
  }

  /** Append a snapshot to history and bound the history size (telemetry). */
  private recordSnapshot(snapshot: ContextSnapshot): void {
    this.snapshotHistory.push(snapshot);
    if (this.snapshotHistory.length > this.maxSnapshotHistory) {
      this.snapshotHistory = this.snapshotHistory.slice(-this.maxSnapshotHistory);
    }
  }
}

// ─── Extended Result Type ────────────────────────────────────────

export interface IncrementalRetrievalResult extends RetrievalResult {
  delta: ContextDelta;
  wasCheckpoint: boolean;
  snapshotId: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

function arraysMatchOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((val, idx) => val === b[idx]);
}
