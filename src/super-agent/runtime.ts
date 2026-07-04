/**
 * Super-Agent Unified Runtime
 *
 * Wires all seven subsystems together into a single runtime:
 *   1. Memory Crystal (storage, retrieval, drift, annealing)
 *   2. Incremental Context Engine
 *   3. Multi-LLM Router
 *   4. Swarm Orchestrator
 *   5. TFRD Canon
 *   6. Capability Security Engine
 *   7. Reasoning Trace
 */

import type {
  AgentSpecialization,
  DefectVector,
  EscalationRequest,
  EscalationResponse,
  ModelProfile,
  RetrievalRequest,
  SwarmTask,
  TaskResult,
  TrustLevel,
  WriteProposal,
} from "./types.js";
import { TFRDCanon, type QualityGateResult } from "./canon/tfrd.js";
import { IncrementalContextEngine, type IncrementalRetrievalResult } from "./context/engine.js";
import { AnnealingEngine, type AnnealingResult } from "./crystal/annealing.js";
import { DriftMonitor } from "./crystal/drift.js";
import { RetrievalPipeline } from "./crystal/retrieval.js";
import { CrystalStorage } from "./crystal/storage.js";
import { MultiLLMRouter, type ModelAdapter, type ExecutionResult } from "./router/router.js";
import { CapabilityEngine, type PermissionResult } from "./security/capabilities.js";
import { SwarmOrchestrator, type SwarmStatus } from "./swarm/orchestrator.js";
import { TraceStore } from "./trace/store.js";

// ─── Runtime Configuration ───────────────────────────────────────

export interface SuperAgentConfig {
  /** Optional model adapter for LLM calls */
  modelAdapter?: ModelAdapter;

  /** Models to register */
  models?: ModelProfile[];

  /** Escalation handler for capability requests */
  escalationHandler?: (req: EscalationRequest) => EscalationResponse;

  /** Maximum escalations per hour per agent */
  maxEscalationsPerHour?: number;

  /** Annealing cadence (interactions between maintenance runs) */
  annealingCadence?: number;

  /** Drift monitoring window size */
  driftWindowSize?: number;

  /** Checkpoint policy for incremental context */
  checkpointMaxTurns?: number;
}

// ─── Super-Agent Runtime ─────────────────────────────────────────

export class SuperAgentRuntime {
  // Subsystems
  readonly crystal: CrystalStorage;
  readonly retrieval: RetrievalPipeline;
  readonly drift: DriftMonitor;
  readonly annealing: AnnealingEngine;
  readonly context: IncrementalContextEngine;
  readonly router: MultiLLMRouter;
  readonly swarm: SwarmOrchestrator;
  readonly canon: TFRDCanon;
  readonly security: CapabilityEngine;
  readonly trace: TraceStore;

  // State
  private step: number = 0;
  private initialized: boolean = false;

  constructor(config: SuperAgentConfig = {}) {
    // 1. Memory Crystal
    this.crystal = new CrystalStorage();

    // 2. Retrieval Pipeline
    this.retrieval = new RetrievalPipeline(this.crystal);

    // 3. Drift Monitor
    this.drift = new DriftMonitor(this.crystal, undefined, undefined, config.driftWindowSize);

    // 4. Annealing Engine
    this.annealing = new AnnealingEngine(
      this.crystal,
      this.drift,
      config.annealingCadence
        ? {
            cadenceInteractions: config.annealingCadence,
            thresholds: {
              contradictionRate: 0.1,
              unfaithfulnessRate: 0.15,
              decisionInconsistency: 0.1,
              stalenessIndex: 0.2,
              summaryDivergence: 0.25,
              retrievalMissRate: 0.15,
              toolCallTailLatency: 0.8,
              tokenTailCost: 0.8,
            },
            maxDocumentsPerRun: 200,
            maxDurationMs: 30_000,
          }
        : undefined,
    );

    // 5. Incremental Context Engine
    this.context = new IncrementalContextEngine(
      this.retrieval,
      config.checkpointMaxTurns
        ? {
            maxTurnsSinceCheckpoint: config.checkpointMaxTurns,
            maxDeltaAccumulation: 0.6,
            onTopicShift: true,
            onAnnealingComplete: true,
          }
        : undefined,
    );

    // 6. Multi-LLM Router
    const adapter = config.modelAdapter ?? createNoOpAdapter();
    this.router = new MultiLLMRouter(adapter);

    if (config.models) {
      for (const model of config.models) {
        this.router.registerModel(model);
      }
    }

    // 7. Trace Store
    this.trace = new TraceStore();

    // 8. Swarm Orchestrator
    this.swarm = new SwarmOrchestrator(this.crystal, this.trace);

    // 9. TFRD Canon
    this.canon = new TFRDCanon();

    // 10. Security Engine
    this.security = new CapabilityEngine({
      escalationHandler: config.escalationHandler,
      maxEscalationsPerHour: config.maxEscalationsPerHour,
    });
  }

  // ─── Initialization ────────────────────────────────────────

  /**
   * Initialize the runtime. Call this before using the system.
   * Follows the startup sequence from the design doc.
   */
  initialize(): void {
    if (this.initialized) return;

    // Record initialization
    this.trace.record("system", "task_received", {
      event: "runtime_initialized",
      subsystems: [
        "crystal",
        "retrieval",
        "drift",
        "annealing",
        "context",
        "router",
        "swarm",
        "canon",
        "security",
        "trace",
      ],
    });

    // Compute baseline drift
    const baseline = this.drift.computeDefects(0);
    this.trace.record("system", "drift_measurement", {
      step: 0,
      defects: baseline,
      density: this.drift.computeDensity(baseline),
    });

    this.initialized = true;
  }

  // ─── High-Level Operations ─────────────────────────────────

  /**
   * Register a new agent in the swarm with appropriate capabilities.
   */
  registerAgent(config: {
    name: string;
    specialization: AgentSpecialization;
    capabilities: string[];
    trustLevel?: TrustLevel;
    permissions?: { resource: string; actions: string[] }[];
  }): string {
    const agent = this.swarm.registerAgent(config);

    // Grant default capabilities
    this.security.grant({
      resource: "crystal:read",
      actions: ["retrieve"],
      scope: { type: "global" },
      grantedTo: agent.id,
      grantedBy: "system",
      delegatable: false,
      revocable: true,
    });

    this.security.grant({
      resource: "crystal:write",
      actions: ["propose"],
      scope: { type: "domain", domain: config.specialization.domain },
      grantedTo: agent.id,
      grantedBy: "system",
      delegatable: false,
      revocable: true,
    });

    // Grant additional permissions
    if (config.permissions) {
      for (const perm of config.permissions) {
        this.security.grant({
          resource: perm.resource,
          actions: perm.actions,
          scope: { type: "global" },
          grantedTo: agent.id,
          grantedBy: "system",
          delegatable: false,
          revocable: true,
        });
      }
    }

    return agent.id;
  }

  /**
   * Submit a task to the swarm.
   */
  submitTask(config: {
    description: string;
    domain: string;
    requiredCapabilities?: string[];
    priority?: number;
  }): string {
    this.step++;
    const task = this.swarm.submitTask(config);

    this.trace.record("orchestrator", "task_received", {
      taskId: task.id,
      domain: config.domain,
      priority: config.priority,
    });

    return task.id;
  }

  /**
   * Retrieve context for a query with full pipeline:
   * security check → incremental retrieval → quality gate → trace
   */
  retrieve(request: RetrievalRequest): IncrementalRetrievalResult | null {
    // Security check
    const permission = this.security.check(request.requester, "crystal:read", "retrieve");
    if (!permission.allowed) {
      this.trace.record(request.requester, "capability_check", {
        resource: "crystal:read",
        action: "retrieve",
        allowed: false,
        reason: permission.reason,
      });
      return null;
    }

    // Incremental retrieval
    const startTime = Date.now();
    const result = this.context.retrieve(request);
    const durationMs = Date.now() - startTime;

    // Log to trace
    this.trace.record(
      request.requester,
      "retrieval_result",
      {
        capsuleCount: result.capsules.length,
        tokenCount: result.tokenCount,
        wasCheckpoint: result.wasCheckpoint,
        deltaAdded: result.delta.added.length,
        deltaRemoved: result.delta.removed.length,
      },
      { durationMs },
    );

    // Log to drift monitor
    this.drift.logInteraction({
      step: this.step,
      timestamp: new Date().toISOString(),
      queryId: request.query,
      retrievedCapsuleIds: result.capsules.map((c) => c.id),
      hadContradiction: false,
      toolCalls: 0,
      tokensUsed: result.tokenCount,
    });

    return result;
  }

  /**
   * Propose a write to the crystal with security and governance checks.
   */
  proposeWrite(proposal: WriteProposal): {
    committed: boolean;
    capsuleId?: string;
    reason?: string;
  } {
    // Security check
    const permission = this.security.check(proposal.proposedBy, "crystal:write", "propose");
    if (!permission.allowed) {
      this.trace.record(proposal.proposedBy, "capability_check", {
        resource: "crystal:write",
        action: "propose",
        allowed: false,
        reason: permission.reason,
      });
      return { committed: false, reason: permission.reason };
    }

    // Process through crystal
    const result = this.crystal.processWriteProposal(proposal);

    // Log
    this.trace.record(
      proposal.proposedBy,
      result.committed ? "write_committed" : "write_proposal",
      {
        proposalId: proposal.proposalId,
        operation: proposal.operation,
        committed: result.committed,
        capsuleId: result.capsuleId,
        reason: result.reason,
      },
    );

    return result;
  }

  /**
   * Execute an LLM task through the router with quality gate.
   */
  async executeLLMTask(
    prompt: string,
    agentId: string,
    description?: string,
  ): Promise<{
    result: ExecutionResult;
    qualityGate: QualityGateResult;
  }> {
    const startTime = Date.now();

    // Route and execute
    const result = await this.router.execute(prompt, description);

    this.trace.record(
      agentId,
      "llm_call_result",
      {
        strategy: result.strategy,
        modelIds: result.modelIds,
        outputLength: result.output.length,
      },
      { durationMs: Date.now() - startTime },
    );

    // Run quality gate
    const qualityGate = this.canon.runQualityGate({
      query: prompt,
      output: result.output,
      toolsUsed: false,
      sourcesProvided: false,
      assumptionsLabeled: false,
    });

    this.trace.record(agentId, "quality_gate", {
      passed: qualityGate.passed,
      overallScore: qualityGate.overallScore,
      violations: qualityGate.violations,
    });

    return { result, qualityGate };
  }

  // ─── Monitoring ────────────────────────────────────────────

  /**
   * Get current system health.
   */
  getHealth(): SystemHealth {
    const defects = this.drift.computeDefects(this.step);
    const density = this.drift.computeDensity(defects);
    const hazard = this.drift.estimateHazard(defects);
    const survival100 = this.drift.estimateSurvival(defects, 100);
    const swarmStatus = this.swarm.getSwarmStatus();

    return {
      step: this.step,
      defects,
      defectDensity: density,
      hazardRate: hazard,
      survival100Steps: survival100,
      needsAnnealing: this.annealing.shouldRun(this.step),
      swarm: swarmStatus,
      capsuleCount: this.crystal.getCapsuleCount(),
      traceEventCount: this.trace.getEventCount(),
      securityCapabilities: this.security.getAllCapabilities().length,
    };
  }

  /**
   * Run maintenance (annealing) if needed.
   */
  async runMaintenance(): Promise<{
    ran: boolean;
    result?: AnnealingResult;
  }> {
    if (!this.annealing.shouldRun(this.step)) {
      return { ran: false };
    }

    this.trace.record("system", "annealing_triggered", {
      step: this.step,
    });

    const result = await this.annealing.run(this.step);

    this.trace.record("system", "drift_measurement", {
      step: this.step,
      event: "post_annealing",
      preDefects: result.preDefects,
      postDefects: result.postDefects,
      improved:
        this.drift.computeDensity(result.postDefects) <
        this.drift.computeDensity(result.preDefects),
    });

    // Notify context engine
    this.context.onAnnealingComplete();

    return { ran: true, result };
  }

  // ─── Shutdown ──────────────────────────────────────────────

  /**
   * Graceful shutdown.
   */
  shutdown(): void {
    // Final drift measurement
    const finalDefects = this.drift.computeDefects(this.step);
    this.trace.record("system", "drift_measurement", {
      step: this.step,
      event: "shutdown",
      defects: finalDefects,
      density: this.drift.computeDensity(finalDefects),
    });

    this.trace.record("system", "task_received", {
      event: "runtime_shutdown",
      totalSteps: this.step,
    });

    this.initialized = false;
  }
}

// ─── Types ───────────────────────────────────────────────────────

export interface SystemHealth {
  step: number;
  defects: DefectVector;
  defectDensity: number;
  hazardRate: number;
  survival100Steps: number;
  needsAnnealing: boolean;
  swarm: SwarmStatus;
  capsuleCount: number;
  traceEventCount: number;
  securityCapabilities: number;
}

// ─── No-Op Adapter (for testing without LLM access) ─────────────

function createNoOpAdapter(): ModelAdapter {
  return {
    async call(modelId, prompt, options) {
      return {
        modelId,
        content: `[No-op response from ${modelId}]`,
        tokenCount: { input: Math.ceil(prompt.length / 4), output: 10 },
        latencyMs: 0,
        finishReason: "stop",
      };
    },
  };
}
