/**
 * Super-Agent Test Suite
 *
 * Tests all seven subsystems and the unified runtime.
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeEach } from "vitest";
import type { Capsule, ModelOutput, ModelProfile, WriteProposal } from "./types.js";
import { TFRDCanon } from "./canon/tfrd.js";
import { IncrementalContextEngine } from "./context/engine.js";
import { AnnealingEngine } from "./crystal/annealing.js";
import {
  createCapsule,
  hashContent,
  isCapsuleExpired,
  isCapsuleStale,
  validateCapsule,
  estimateTokens,
} from "./crystal/capsule.js";
import { DriftMonitor } from "./crystal/drift.js";
import { RetrievalPipeline } from "./crystal/retrieval.js";
import { CrystalStorage } from "./crystal/storage.js";
import { MultiLLMRouter } from "./router/router.js";
import { SuperAgentRuntime } from "./runtime.js";
import { CapabilityEngine } from "./security/capabilities.js";
import { SwarmOrchestrator } from "./swarm/orchestrator.js";
import { TraceStore } from "./trace/store.js";

// ─── Helpers ─────────────────────────────────────────────────────

function makeWriteProposal(overrides?: Partial<WriteProposal>): WriteProposal {
  return {
    proposalId: `prop_${randomUUID()}`,
    proposedBy: "agent_test",
    operation: "create",
    capsule: {
      content: `Test content ${randomUUID()}`,
      type: "observation",
      tags: [],
    },
    justification: "Test write",
    targetTrust: "OPERATIONAL",
    ...overrides,
  };
}

function makeModelProfile(id: string, overrides?: Partial<ModelProfile>): ModelProfile {
  return {
    id,
    provider: "test",
    name: id,
    capabilities: {
      reasoning: 0.8,
      coding: 0.7,
      creativity: 0.6,
      factualAccuracy: 0.8,
      instruction: 0.7,
      safety: 0.9,
      multimodal: false,
      languages: ["en"],
    },
    costPer1kTokens: { input: 0.01, output: 0.03 },
    latencyP50Ms: 500,
    latencyP95Ms: 2000,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsToolUse: true,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 1. CAPSULE TESTS
// ═══════════════════════════════════════════════════════════════════

describe("Capsule", () => {
  it("creates a capsule with correct defaults", () => {
    const capsule = createCapsule({
      type: "observation",
      content: "The sky is blue",
      trust: "OPERATIONAL",
    });

    expect(capsule.id).toMatch(/^cap_/);
    expect(capsule.type).toBe("observation");
    expect(capsule.content).toBe("The sky is blue");
    expect(capsule.trust).toBe("OPERATIONAL");
    expect(capsule.version).toBe(1);
    expect(capsule.contentHash).toBe(hashContent("The sky is blue"));
    expect(capsule.tags).toEqual([]);
    expect(capsule.provenance).toEqual([]);
    expect(capsule.accessCount).toBe(0);
    expect(capsule.usefulness).toBe(0);
  });

  it("validates capsules correctly", () => {
    const valid = createCapsule({
      type: "decision",
      content: "We chose option A",
      trust: "CANON",
    });
    expect(validateCapsule(valid)).toEqual([]);

    const invalid = { ...valid, type: "nonexistent" as any };
    const errors = validateCapsule(invalid);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.field).toBe("type");
  });

  it("detects content hash mismatch", () => {
    const capsule = createCapsule({
      type: "observation",
      content: "Original content",
      trust: "DRAFT",
    });
    capsule.contentHash = "wrong_hash";

    const errors = validateCapsule(capsule);
    expect(errors.some((e) => e.field === "contentHash")).toBe(true);
  });

  it("checks TTL expiry correctly", () => {
    const future = createCapsule({
      type: "state_card",
      content: "Active state",
      trust: "OPERATIONAL",
      ttl: {
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        onExpiry: "archive",
      },
    });
    expect(isCapsuleExpired(future)).toBe(false);

    const past = createCapsule({
      type: "state_card",
      content: "Expired state",
      trust: "OPERATIONAL",
      ttl: {
        expiresAt: new Date(Date.now() - 86400000).toISOString(),
        onExpiry: "archive",
      },
    });
    expect(isCapsuleExpired(past)).toBe(true);
  });

  it("checks staleness correctly", () => {
    const stale = createCapsule({
      type: "observation",
      content: "Old info",
      trust: "OPERATIONAL",
      ttl: {
        refreshAfter: new Date(Date.now() - 3600000).toISOString(),
        onExpiry: "archive",
      },
    });
    expect(isCapsuleStale(stale)).toBe(true);
  });

  it("estimates tokens reasonably", () => {
    expect(estimateTokens("hello world")).toBeGreaterThan(0);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. CRYSTAL STORAGE TESTS
// ═══════════════════════════════════════════════════════════════════

describe("CrystalStorage", () => {
  let storage: CrystalStorage;

  beforeEach(() => {
    storage = new CrystalStorage();
  });

  it("creates capsules via write proposals", () => {
    const proposal = makeWriteProposal();
    const result = storage.processWriteProposal(proposal);

    expect(result.committed).toBe(true);
    expect(result.capsuleId).toBeDefined();
    expect(storage.getCapsuleCount()).toBe(1);
  });

  it("rejects duplicate content", () => {
    const content = "Unique content " + randomUUID();
    const p1 = makeWriteProposal({
      capsule: { content, type: "observation", tags: [] },
    });
    const p2 = makeWriteProposal({
      capsule: { content, type: "observation", tags: [] },
    });

    storage.processWriteProposal(p1);
    const result = storage.processWriteProposal(p2);

    expect(result.committed).toBe(false);
    expect(result.validationErrors).toContain("Duplicate content detected");
  });

  it("blocks CANON writes without governance", () => {
    const proposal = makeWriteProposal({
      targetTrust: "CANON",
      proposedBy: "regular_agent",
    });
    const result = storage.processWriteProposal(proposal);

    expect(result.committed).toBe(false);
    expect(result.reason).toContain("governed approval");
  });

  it("allows CANON writes from governance", () => {
    const proposal = makeWriteProposal({
      targetTrust: "CANON",
      proposedBy: "governance",
    });
    const result = storage.processWriteProposal(proposal);

    expect(result.committed).toBe(true);
  });

  it("updates capsules with version increment", () => {
    const createResult = storage.processWriteProposal(makeWriteProposal());
    const capsuleId = createResult.capsuleId!;

    const updateProposal = makeWriteProposal({
      operation: "update",
      capsule: { id: capsuleId, content: "Updated content", type: "observation", tags: [] },
    });
    const updateResult = storage.processWriteProposal(updateProposal);

    expect(updateResult.committed).toBe(true);
    const updated = storage.getCapsule(capsuleId);
    expect(updated?.version).toBe(2);
    expect(updated?.content).toBe("Updated content");
  });

  it("promotes capsules with audit trail", () => {
    const createResult = storage.processWriteProposal(makeWriteProposal({ targetTrust: "DRAFT" }));
    const capsuleId = createResult.capsuleId!;

    const promoteProposal: WriteProposal = {
      proposalId: `prop_${randomUUID()}`,
      proposedBy: "agent_test",
      operation: "promote",
      capsule: { id: capsuleId, content: "any" },
      justification: "Verified by multiple agents",
      targetTrust: "OPERATIONAL",
    };
    const result = storage.processWriteProposal(promoteProposal);

    expect(result.committed).toBe(true);
    const promoted = storage.getCapsule(capsuleId);
    expect(promoted?.trust).toBe("OPERATIONAL");
    expect(promoted?.promotionHistory).toHaveLength(1);
    expect(promoted?.promotionHistory[0]?.from).toBe("DRAFT");
    expect(promoted?.promotionHistory[0]?.to).toBe("OPERATIONAL");
  });

  it("archives without deleting (Memory Statue v2 Rule 1)", () => {
    const createResult = storage.processWriteProposal(makeWriteProposal());
    const capsuleId = createResult.capsuleId!;

    const archiveProposal: WriteProposal = {
      proposalId: `prop_${randomUUID()}`,
      proposedBy: "agent_test",
      operation: "archive",
      capsule: { id: capsuleId, content: "any" },
      justification: "No longer needed",
      targetTrust: "UNTRUSTED",
    };
    storage.processWriteProposal(archiveProposal);

    // Capsule still exists but is UNTRUSTED with ARCHIVED tag
    const archived = storage.getCapsule(capsuleId);
    expect(archived).toBeDefined();
    expect(archived?.trust).toBe("UNTRUSTED");
    expect(archived?.tags.some((t) => t.value === "ARCHIVED")).toBe(true);
  });

  it("maintains audit log", () => {
    storage.processWriteProposal(makeWriteProposal());
    storage.processWriteProposal(makeWriteProposal());

    const log = storage.getAuditLog();
    expect(log.length).toBe(2);
    expect(log.every((e) => e.action === "capsule_created")).toBe(true);
  });

  it("expires stale capsules", () => {
    const proposal = makeWriteProposal();
    const result = storage.processWriteProposal(proposal);
    const capsule = storage.getCapsule(result.capsuleId!)!;

    // Manually set TTL to the past
    capsule.ttl = {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      onExpiry: "archive",
    };

    const expired = storage.expireStaleCapsules();
    expect(expired).toContain(capsule.id);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. RETRIEVAL PIPELINE TESTS
// ═══════════════════════════════════════════════════════════════════

describe("RetrievalPipeline", () => {
  let storage: CrystalStorage;
  let pipeline: RetrievalPipeline;

  beforeEach(() => {
    storage = new CrystalStorage();
    pipeline = new RetrievalPipeline(storage);

    // Seed some capsules
    const topics = [
      "TypeScript is a typed superset of JavaScript",
      "React uses virtual DOM for efficient rendering",
      "Node.js enables server-side JavaScript execution",
      "PostgreSQL is a relational database system",
      "Docker containers isolate application environments",
    ];

    for (const content of topics) {
      storage.processWriteProposal(
        makeWriteProposal({
          capsule: { content, type: "observation", tags: [] },
        }),
      );
    }
  });

  it("retrieves relevant capsules for a query", () => {
    const result = pipeline.retrieve({
      query: "TypeScript JavaScript",
      requester: "test",
      permissions: [],
      constraints: {
        maxCapsules: 10,
        maxTokens: 2000,
        trustFloor: "UNTRUSTED",
        maxDepth: 1,
        maxToolCalls: 10,
      },
    });

    expect(result.capsules.length).toBeGreaterThan(0);
    expect(result.pipelineTrace.stage4_packedCount).toBeGreaterThan(0);
    expect(result.contextPackHash).toBeDefined();
  });

  it("respects trust floor", () => {
    // Add an UNTRUSTED capsule
    storage.processWriteProposal(
      makeWriteProposal({
        capsule: { content: "Untrusted TypeScript info", type: "observation", tags: [] },
        targetTrust: "DRAFT",
      }),
    );

    const result = pipeline.retrieve({
      query: "TypeScript",
      requester: "test",
      permissions: [],
      constraints: {
        maxCapsules: 10,
        maxTokens: 2000,
        trustFloor: "OPERATIONAL",
        maxDepth: 1,
        maxToolCalls: 10,
      },
    });

    // DRAFT capsules should be excluded
    expect(result.capsules.every((c) => c.trust !== "DRAFT")).toBe(true);
  });

  it("respects capsule count budget", () => {
    const result = pipeline.retrieve({
      query: "JavaScript",
      requester: "test",
      permissions: [],
      constraints: {
        maxCapsules: 2,
        maxTokens: 10000,
        trustFloor: "UNTRUSTED",
        maxDepth: 1,
        maxToolCalls: 10,
      },
    });

    expect(result.capsules.length).toBeLessThanOrEqual(2);
  });

  it("filters by security tags", () => {
    storage.processWriteProposal(
      makeWriteProposal({
        capsule: {
          content: "Secret: TypeScript compiler internals",
          type: "observation",
          tags: [{ category: "security", value: "CONFIDENTIAL:internal", enforced: true }],
        },
      }),
    );

    // Without matching permission
    const result = pipeline.retrieve({
      query: "TypeScript compiler",
      requester: "test",
      permissions: [],
      constraints: {
        maxCapsules: 10,
        maxTokens: 2000,
        trustFloor: "UNTRUSTED",
        maxDepth: 1,
        maxToolCalls: 10,
      },
    });

    const hasSecret = result.capsules.some((c) => c.content.includes("Secret"));
    expect(hasSecret).toBe(false);
  });

  it("provides pipeline trace metrics", () => {
    const result = pipeline.retrieve({
      query: "database",
      requester: "test",
      permissions: [],
      constraints: {
        maxCapsules: 10,
        maxTokens: 2000,
        trustFloor: "UNTRUSTED",
        maxDepth: 1,
        maxToolCalls: 10,
      },
    });

    expect(result.pipelineTrace.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.totalCandidates).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. DRIFT MONITOR TESTS
// ═══════════════════════════════════════════════════════════════════

describe("DriftMonitor", () => {
  let storage: CrystalStorage;
  let monitor: DriftMonitor;

  beforeEach(() => {
    storage = new CrystalStorage();
    monitor = new DriftMonitor(storage);
  });

  it("computes zero defects for empty system", () => {
    const defects = monitor.computeDefects(0);
    expect(defects.contradictionRate).toBe(0);
    expect(defects.stalenessIndex).toBe(0);
  });

  it("detects contradictions in interaction log", () => {
    // Log interactions with contradictions
    for (let i = 0; i < 10; i++) {
      monitor.logInteraction({
        step: i,
        timestamp: new Date().toISOString(),
        queryId: `q${i}`,
        retrievedCapsuleIds: [],
        hadContradiction: i % 2 === 0, // 50% contradiction rate
        toolCalls: 1,
        tokensUsed: 100,
      });
    }

    const defects = monitor.computeDefects(10);
    expect(defects.contradictionRate).toBe(0.5);
  });

  it("detects staleness", () => {
    // Add expired capsule
    const result = storage.processWriteProposal(
      makeWriteProposal({
        capsule: {
          content: "Stale fact",
          type: "observation",
          tags: [],
          ttl: {
            expiresAt: new Date(Date.now() - 1000).toISOString(),
            onExpiry: "archive",
          },
        },
      }),
    );

    const defects = monitor.computeDefects(1);
    expect(defects.stalenessIndex).toBeGreaterThan(0);
  });

  it("computes scalar defect density", () => {
    const defects = {
      contradictionRate: 0.1,
      unfaithfulnessRate: 0.2,
      decisionInconsistency: 0.0,
      stalenessIndex: 0.3,
      summaryDivergence: 0.1,
      retrievalMissRate: 0.0,
      toolCallTailLatency: 0.0,
      tokenTailCost: 0.0,
    };

    const density = monitor.computeDensity(defects);
    expect(density).toBeGreaterThan(0);
    expect(density).toBeLessThan(1);
  });

  it("detects threshold breaches", () => {
    const defects = {
      contradictionRate: 0.5, // above 0.1 threshold
      unfaithfulnessRate: 0.0,
      decisionInconsistency: 0.0,
      stalenessIndex: 0.0,
      summaryDivergence: 0.0,
      retrievalMissRate: 0.0,
      toolCallTailLatency: 0.0,
      tokenTailCost: 0.0,
    };

    const breaches = monitor.checkThresholds(defects);
    expect(breaches.length).toBeGreaterThan(0);
    expect(breaches[0]!.metric).toBe("contradictionRate");
  });

  it("estimates hazard and survival", () => {
    const lowRisk = {
      contradictionRate: 0.01,
      unfaithfulnessRate: 0.01,
      decisionInconsistency: 0.0,
      stalenessIndex: 0.01,
      summaryDivergence: 0.0,
      retrievalMissRate: 0.0,
      toolCallTailLatency: 0.0,
      tokenTailCost: 0.0,
    };

    const hazard = monitor.estimateHazard(lowRisk);
    // Low risk should yield a hazard near 0.5 (sigmoid baseline) but not high
    expect(hazard).toBeLessThan(0.7);

    const survival = monitor.estimateSurvival(lowRisk, 1000);
    expect(survival).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. INCREMENTAL CONTEXT ENGINE TESTS
// ═══════════════════════════════════════════════════════════════════

describe("IncrementalContextEngine", () => {
  let storage: CrystalStorage;
  let pipeline: RetrievalPipeline;
  let engine: IncrementalContextEngine;

  beforeEach(() => {
    storage = new CrystalStorage();
    pipeline = new RetrievalPipeline(storage);
    engine = new IncrementalContextEngine(pipeline, {
      maxTurnsSinceCheckpoint: 5,
      maxDeltaAccumulation: 0.6,
      onTopicShift: false,
      onAnnealingComplete: true,
    });

    // Seed data
    for (const content of [
      "Python is a programming language",
      "JavaScript runs in browsers",
      "Rust ensures memory safety",
    ]) {
      storage.processWriteProposal(
        makeWriteProposal({
          capsule: { content, type: "observation", tags: [] },
        }),
      );
    }
  });

  it("does full retrieval on first call", () => {
    const result = engine.retrieve({
      query: "programming language",
      requester: "test",
      permissions: [],
      constraints: {
        maxCapsules: 10,
        maxTokens: 2000,
        trustFloor: "UNTRUSTED",
        maxDepth: 1,
        maxToolCalls: 10,
      },
    });

    expect(result.wasCheckpoint).toBe(true);
    expect(result.snapshotId).toMatch(/^snap_/);
  });

  it("uses delta retrieval on subsequent calls", () => {
    const request = {
      query: "programming",
      requester: "test",
      permissions: [],
      constraints: {
        maxCapsules: 10,
        maxTokens: 2000,
        trustFloor: "UNTRUSTED" as const,
        maxDepth: 1,
        maxToolCalls: 10,
      },
    };

    const first = engine.retrieve(request);
    expect(first.wasCheckpoint).toBe(true);

    const second = engine.retrieve(request);
    expect(second.wasCheckpoint).toBe(false);
  });

  it("checkpoints after max turns", () => {
    const request = {
      query: "programming",
      requester: "test",
      permissions: [],
      constraints: {
        maxCapsules: 10,
        maxTokens: 2000,
        trustFloor: "UNTRUSTED" as const,
        maxDepth: 1,
        maxToolCalls: 10,
      },
    };

    // First call = checkpoint (turnsSinceCheckpoint resets to 0)
    engine.retrieve(request);

    // Calls 2-6 = delta (turnsSinceCheckpoint goes 1,2,3,4,5)
    for (let i = 0; i < 5; i++) {
      const result = engine.retrieve(request);
      expect(result.wasCheckpoint).toBe(false);
    }

    // Call 7 = checkpoint (turnsSinceCheckpoint=5 >= maxTurnsSinceCheckpoint=5)
    const result = engine.retrieve(request);
    expect(result.wasCheckpoint).toBe(true);
  });

  it("tracks snapshot history", () => {
    const request = {
      query: "language",
      requester: "test",
      permissions: [],
      constraints: {
        maxCapsules: 10,
        maxTokens: 2000,
        trustFloor: "UNTRUSTED" as const,
        maxDepth: 1,
        maxToolCalls: 10,
      },
    };

    engine.retrieve(request);
    engine.retrieve(request);
    engine.retrieve(request);

    expect(engine.getSnapshotHistory()).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. MULTI-LLM ROUTER TESTS
// ═══════════════════════════════════════════════════════════════════

describe("MultiLLMRouter", () => {
  let router: MultiLLMRouter;

  beforeEach(() => {
    const mockAdapter = {
      async call(modelId: string, prompt: string): Promise<ModelOutput> {
        return {
          modelId,
          content: `Response from ${modelId}: ${prompt.slice(0, 50)}`,
          tokenCount: { input: 100, output: 50 },
          latencyMs: 100,
          finishReason: "stop",
        };
      },
    };

    router = new MultiLLMRouter(mockAdapter);

    router.registerModel(
      makeModelProfile("claude-opus", {
        capabilities: {
          reasoning: 0.95,
          coding: 0.9,
          creativity: 0.8,
          factualAccuracy: 0.9,
          instruction: 0.85,
          safety: 0.95,
          multimodal: true,
          languages: ["en"],
        },
      }),
    );

    router.registerModel(
      makeModelProfile("gpt-4", {
        capabilities: {
          reasoning: 0.85,
          coding: 0.85,
          creativity: 0.85,
          factualAccuracy: 0.85,
          instruction: 0.9,
          safety: 0.85,
          multimodal: true,
          languages: ["en"],
        },
      }),
    );

    router.registerModel(
      makeModelProfile("gemini-pro", {
        capabilities: {
          reasoning: 0.8,
          coding: 0.75,
          creativity: 0.7,
          factualAccuracy: 0.8,
          instruction: 0.75,
          safety: 0.8,
          multimodal: true,
          languages: ["en"],
        },
      }),
    );
  });

  it("analyzes task domains correctly", () => {
    expect(router.analyzeTask("Write a function to sort an array").primaryDomain).toBe("coding");
    expect(router.analyzeTask("Analyze the tradeoffs between A and B").primaryDomain).toBe(
      "reasoning",
    );
    expect(router.analyzeTask("Write a creative story about dragons").primaryDomain).toBe(
      "creative",
    );
  });

  it("selects appropriate routing strategy", () => {
    expect(
      router.selectStrategy({
        primaryDomain: "coding",
        complexity: "simple",
        stakes: "low",
        latencyBudgetMs: 10000,
        tokenBudget: 2000,
      }),
    ).toBe("route");
    expect(
      router.selectStrategy({
        primaryDomain: "reasoning",
        complexity: "complex",
        stakes: "high",
        latencyBudgetMs: 30000,
        tokenBudget: 8000,
      }),
    ).toBe("synthesize");
  });

  it("routes to best model for domain", () => {
    const bestForReasoning = router.selectBestModel({
      primaryDomain: "reasoning",
      complexity: "moderate",
      stakes: "medium",
      latencyBudgetMs: 10000,
      tokenBudget: 2000,
    });

    expect(bestForReasoning).toBe("claude-opus");
  });

  it("executes route strategy", async () => {
    const result = await router.route("Debug this code", {
      primaryDomain: "coding",
      complexity: "simple",
      stakes: "low",
      latencyBudgetMs: 10000,
      tokenBudget: 2000,
    });

    expect(result.content).toContain("Response from");
  });

  it("executes verify strategy", async () => {
    const result = await router.verify(
      "Is this claim accurate?",
      {
        primaryDomain: "factual",
        complexity: "simple",
        stakes: "high",
        latencyBudgetMs: 10000,
        tokenBudget: 2000,
      },
      ["claude-opus", "gpt-4"],
    );

    expect(result.allOutputs.size).toBe(2);
    expect(result.chosenModelId).toBeDefined();
  });

  it("executes synthesize strategy", async () => {
    const result = await router.synthesize("Explain quantum computing in detail", {
      primaryDomain: "reasoning",
      complexity: "complex",
      stakes: "high",
      latencyBudgetMs: 30000,
      tokenBudget: 8000,
    });

    expect(result.sourceModels.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("has unified execute method", async () => {
    const result = await router.execute("Help me with code", "coding");
    expect(result.strategy).toBeDefined();
    expect(result.output).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. SWARM ORCHESTRATOR TESTS
// ═══════════════════════════════════════════════════════════════════

describe("SwarmOrchestrator", () => {
  let storage: CrystalStorage;
  let trace: TraceStore;
  let swarm: SwarmOrchestrator;

  beforeEach(() => {
    storage = new CrystalStorage();
    trace = new TraceStore();
    swarm = new SwarmOrchestrator(storage, trace);
  });

  it("registers agents", () => {
    const agent = swarm.registerAgent({
      name: "Code Agent",
      specialization: {
        domain: "coding",
        subdomains: ["typescript", "testing"],
        preferredModels: ["claude-opus"],
        writeTags: [],
      },
      capabilities: ["code", "test"],
    });

    expect(agent.id).toMatch(/^agent_/);
    expect(agent.status).toBe("idle");
    expect(swarm.getAllAgents()).toHaveLength(1);
  });

  it("assigns tasks to matching agents", () => {
    swarm.registerAgent({
      name: "Code Agent",
      specialization: {
        domain: "coding",
        subdomains: ["typescript"],
        preferredModels: [],
        writeTags: [],
      },
      capabilities: ["code"],
    });

    swarm.registerAgent({
      name: "Research Agent",
      specialization: {
        domain: "research",
        subdomains: ["papers"],
        preferredModels: [],
        writeTags: [],
      },
      capabilities: ["search"],
    });

    const task = swarm.submitTask({
      description: "Write a TypeScript function",
      domain: "coding",
    });

    expect(task.status).toBe("assigned");
    const agent = swarm.getAgent(task.assignedAgent!);
    expect(agent?.specialization.domain).toBe("coding");
  });

  it("tracks task completion and metrics", () => {
    const agent = swarm.registerAgent({
      name: "Test Agent",
      specialization: {
        domain: "testing",
        subdomains: [],
        preferredModels: [],
        writeTags: [],
      },
      capabilities: [],
    });

    const task = swarm.submitTask({
      description: "Run tests",
      domain: "testing",
    });

    swarm.completeTask(task.id, {
      output: "All tests passed",
      capsuleIds: [],
      confidence: 0.95,
    });

    expect(swarm.getTask(task.id)?.status).toBe("completed");
    expect(swarm.getAgent(agent.id)?.status).toBe("idle");
    expect(swarm.getAgent(agent.id)?.performanceMetrics.tasksCompleted).toBe(1);
  });

  it("decomposes tasks with dependencies", () => {
    swarm.registerAgent({
      name: "Agent A",
      specialization: { domain: "general", subdomains: [], preferredModels: [], writeTags: [] },
      capabilities: [],
    });
    swarm.registerAgent({
      name: "Agent B",
      specialization: { domain: "general", subdomains: [], preferredModels: [], writeTags: [] },
      capabilities: [],
    });
    swarm.registerAgent({
      name: "Agent C",
      specialization: { domain: "general", subdomains: [], preferredModels: [], writeTags: [] },
      capabilities: [],
    });

    const parent = swarm.submitTask({
      description: "Build feature",
      domain: "general",
    });

    const subtasks = swarm.decompose(
      parent.id,
      [
        { description: "Design API", domain: "general" },
        { description: "Implement API", domain: "general" },
      ],
      [{ fromIndex: 0, toIndex: 1, type: "data" }],
    );

    expect(subtasks).toHaveLength(2);
    // First subtask should be assigned; second should be blocked by dependency
    expect(subtasks[0]?.status).toBe("assigned");
    expect(subtasks[1]?.status).toBe("blocked");
  });

  it("tracks knowledge compounding", () => {
    const agent = swarm.registerAgent({
      name: "Learner",
      specialization: { domain: "learning", subdomains: [], preferredModels: [], writeTags: [] },
      capabilities: [],
    });

    const task = swarm.submitTask({ description: "Learn X", domain: "learning" });

    // Complete with capsule writes
    swarm.completeTask(
      task.id,
      {
        output: "Learned X",
        capsuleIds: ["cap_123"],
        confidence: 0.9,
      },
      [makeWriteProposal()],
    );

    // Another agent retrieves the knowledge
    swarm.trackCapsuleRetrieval("cap_123", "agent_other");
    swarm.trackCapsuleUsage("cap_123", "task_456");
    swarm.recordCapsuleFeedback("cap_123", 0.9);

    const metrics = swarm.getCompoundingRate();
    expect(metrics.crossAgentRetrievals).toBeGreaterThan(0);
  });

  it("provides swarm status", () => {
    swarm.registerAgent({
      name: "A",
      specialization: { domain: "a", subdomains: [], preferredModels: [], writeTags: [] },
      capabilities: [],
    });

    const status = swarm.getSwarmStatus();
    expect(status.totalAgents).toBe(1);
    expect(status.idleAgents).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. TFRD CANON TESTS
// ═══════════════════════════════════════════════════════════════════

describe("TFRDCanon", () => {
  let canon: TFRDCanon;

  beforeEach(() => {
    canon = new TFRDCanon();
  });

  it("has all required principles", () => {
    const principles = canon.getPrinciples();
    expect(principles.length).toBe(7);
    expect(principles.some((p) => p.id === "truth_is_product")).toBe(true);
    expect(principles.some((p) => p.id === "no_hallucinated_effort")).toBe(true);
    expect(principles.some((p) => p.id === "safety_ethics")).toBe(true);
  });

  it("identifies hard principles", () => {
    const hard = canon.getHardPrinciples();
    expect(hard.length).toBeGreaterThan(0);
    expect(hard.every((p) => p.enforcementLevel === "hard")).toBe(true);
  });

  it("detects potential hallucinated effort claims", () => {
    const violations = canon.checkPrinciples("I checked the database and verified the results");
    expect(violations.some((v) => v.principleId === "no_hallucinated_effort")).toBe(true);
  });

  it("detects overconfident language", () => {
    const violations = canon.checkPrinciples("This is definitely the correct answer");
    expect(violations.some((v) => v.principleId === "correctness_over_confidence")).toBe(true);
  });

  it("runs quality gate", () => {
    const result = canon.runQualityGate({
      query: "What is TypeScript?",
      output:
        "## TypeScript\n\nTypeScript is a typed superset of JavaScript.\n\n- Adds static types\n- Compiles to JS\n- Developed by Microsoft",
      toolsUsed: false,
      sourcesProvided: false,
      assumptionsLabeled: false,
    });

    expect(result.scores.size).toBeGreaterThan(0);
    expect(result.overallScore).toBeGreaterThan(0);
  });

  it("generates system prompt", () => {
    const prompt = canon.toSystemPrompt();
    expect(prompt).toContain("TFRD Canon");
    expect(prompt).toContain("Non-Negotiable Principles");
    expect(prompt).toContain("Quality Gate");
  });

  it("scores outputs on rubric", () => {
    const result = canon.scoreOutput({
      accuracy: 3,
      usefulness: 2,
      clarity: 3,
      integrity: 2,
      safety: 3,
    });

    expect(result.average).toBeGreaterThan(0);
    expect(result.dimensionScores.size).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. CAPABILITY SECURITY ENGINE TESTS
// ═══════════════════════════════════════════════════════════════════

describe("CapabilityEngine", () => {
  let engine: CapabilityEngine;

  beforeEach(() => {
    engine = new CapabilityEngine({
      maxEscalationsPerHour: 3,
    });
  });

  it("grants and checks capabilities", () => {
    engine.grant({
      resource: "crystal:read",
      actions: ["retrieve"],
      scope: { type: "global" },
      grantedTo: "agent_1",
      grantedBy: "system",
      delegatable: false,
      revocable: true,
    });

    const result = engine.check("agent_1", "crystal:read", "retrieve");
    expect(result.allowed).toBe(true);
  });

  it("denies access without capability", () => {
    const result = engine.check("agent_1", "crystal:write", "create");
    expect(result.allowed).toBe(false);
  });

  it("enforces capability expiration", () => {
    engine.grant({
      resource: "crystal:read",
      actions: ["retrieve"],
      scope: { type: "global" },
      grantedTo: "agent_1",
      grantedBy: "system",
      expiresAt: new Date(Date.now() - 1000).toISOString(), // already expired
      delegatable: false,
      revocable: true,
    });

    const result = engine.check("agent_1", "crystal:read", "retrieve");
    expect(result.allowed).toBe(false);
  });

  it("revokes capabilities", () => {
    const cap = engine.grant({
      resource: "crystal:read",
      actions: ["retrieve"],
      scope: { type: "global" },
      grantedTo: "agent_1",
      grantedBy: "system",
      delegatable: false,
      revocable: true,
    });

    expect(engine.check("agent_1", "crystal:read", "retrieve").allowed).toBe(true);

    engine.revoke(cap.id, "admin");

    expect(engine.check("agent_1", "crystal:read", "retrieve").allowed).toBe(false);
  });

  it("delegates capabilities (when delegatable)", () => {
    const cap = engine.grant({
      resource: "crystal:read",
      actions: ["retrieve"],
      scope: { type: "global" },
      grantedTo: "agent_1",
      grantedBy: "system",
      delegatable: true,
      revocable: true,
    });

    const delegated = engine.delegate(cap.id, "agent_1", "agent_2");
    expect(delegated).not.toBeNull();
    expect(engine.check("agent_2", "crystal:read", "retrieve").allowed).toBe(true);

    // Delegated capability should NOT be re-delegatable
    expect(delegated!.delegatable).toBe(false);
  });

  it("blocks delegation of non-delegatable capabilities", () => {
    const cap = engine.grant({
      resource: "crystal:write",
      actions: ["propose"],
      scope: { type: "global" },
      grantedTo: "agent_1",
      grantedBy: "system",
      delegatable: false,
      revocable: true,
    });

    const result = engine.delegate(cap.id, "agent_1", "agent_2");
    expect(result).toBeNull();
  });

  it("rate limits escalation requests", () => {
    for (let i = 0; i < 3; i++) {
      engine.requestEscalation({
        requestId: `esc_${i}`,
        requestedBy: "agent_1",
        capability: { resource: "admin", actions: ["*"] },
        justification: "Need access",
        taskContext: "Task",
        urgency: "low",
      });
    }

    // 4th escalation should be rate limited
    const result = engine.requestEscalation({
      requestId: "esc_3",
      requestedBy: "agent_1",
      capability: { resource: "admin", actions: ["*"] },
      justification: "Need access",
      taskContext: "Task",
      urgency: "low",
    });

    expect(result.granted).toBe(false);
    expect(result.reason).toContain("rate limit");
  });

  it("evaluates conditions", () => {
    engine.grant({
      resource: "crystal:write",
      actions: ["propose"],
      scope: { type: "global" },
      grantedTo: "agent_1",
      grantedBy: "system",
      delegatable: false,
      revocable: true,
      conditions: [{ field: "trust_level", operator: "eq", value: "OPERATIONAL" }],
    });

    const allowed = engine.checkWithConditions("agent_1", "crystal:write", "propose", {
      trust_level: "OPERATIONAL",
    });
    expect(allowed.allowed).toBe(true);

    const denied = engine.checkWithConditions("agent_1", "crystal:write", "propose", {
      trust_level: "CANON",
    });
    expect(denied.allowed).toBe(false);
  });

  it("maintains audit log", () => {
    engine.grant({
      resource: "test",
      actions: ["read"],
      scope: { type: "global" },
      grantedTo: "agent_1",
      grantedBy: "system",
      delegatable: false,
      revocable: true,
    });

    const log = engine.getAuditLog();
    expect(log.length).toBeGreaterThan(0);
    expect(log[0]!.action).toBe("capability_granted");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. TRACE STORE TESTS
// ═══════════════════════════════════════════════════════════════════

describe("TraceStore", () => {
  let store: TraceStore;

  beforeEach(() => {
    store = new TraceStore();
  });

  it("records and retrieves events", () => {
    const event = store.record("agent_1", "task_received", {
      taskId: "task_123",
    });

    expect(event.id).toMatch(/^trace_/);
    expect(store.getEvent(event.id)).toBeDefined();
    expect(store.getEventCount()).toBe(1);
  });

  it("queries by agent", () => {
    store.record("agent_1", "task_received", {});
    store.record("agent_2", "task_received", {});
    store.record("agent_1", "llm_call_result", {});

    expect(store.byAgent("agent_1")).toHaveLength(2);
    expect(store.byAgent("agent_2")).toHaveLength(1);
  });

  it("queries by task", () => {
    store.record("agent_1", "task_received", {}, { taskId: "task_1" });
    store.record("agent_1", "retrieval_result", {}, { taskId: "task_1" });
    store.record("agent_1", "task_received", {}, { taskId: "task_2" });

    expect(store.byTask("task_1")).toHaveLength(2);
  });

  it("follows trace chains", () => {
    const e1 = store.record("agent_1", "task_received", {});
    const e2 = store.record(
      "agent_1",
      "retrieval_start",
      {},
      {
        parentEventId: e1.id,
      },
    );
    const e3 = store.record(
      "agent_1",
      "retrieval_result",
      {},
      {
        parentEventId: e2.id,
      },
    );

    const chain = store.traceChain(e3.id);
    expect(chain).toHaveLength(3);
    expect(chain[0]!.id).toBe(e1.id);
    expect(chain[2]!.id).toBe(e3.id);
  });

  it("computes agent summaries", () => {
    store.record("agent_1", "task_received", {});
    store.record("agent_1", "llm_call_result", {}, { durationMs: 500 });
    store.record("agent_1", "llm_call_result", {}, { durationMs: 1000 });
    store.record("agent_1", "error", { message: "test error" });

    const summary = store.agentSummary("agent_1");
    expect(summary.totalEvents).toBe(4);
    expect(summary.errorCount).toBe(1);
    expect(summary.llmCallCount).toBe(2);
    expect(summary.avgLLMLatencyMs).toBe(750);
  });

  it("exports as JSON and JSONL", () => {
    store.record("agent_1", "task_received", { test: true });

    const json = store.export("json");
    expect(JSON.parse(json)).toHaveLength(1);

    const jsonl = store.export("jsonl");
    expect(jsonl.split("\n").filter(Boolean)).toHaveLength(1);
  });

  it("compacts old events", () => {
    const old = store.record("agent_1", "retrieval_result", {
      largePayload: "x".repeat(2000),
    });

    // Manually set timestamp to the past
    const event = store.getEvent(old.id)!;
    event.timestamp = new Date(Date.now() - 86400000 * 2).toISOString();

    const result = store.compact(new Date(Date.now() - 86400000).toISOString());
    expect(result.compactedEvents).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. UNIFIED RUNTIME TESTS
// ═══════════════════════════════════════════════════════════════════

describe("SuperAgentRuntime", () => {
  let runtime: SuperAgentRuntime;

  beforeEach(() => {
    runtime = new SuperAgentRuntime({
      models: [makeModelProfile("test-model")],
    });
    runtime.initialize();
  });

  it("initializes all subsystems", () => {
    const health = runtime.getHealth();
    expect(health.step).toBe(0);
    expect(health.capsuleCount).toBe(0);
    expect(health.traceEventCount).toBeGreaterThan(0); // init events
  });

  it("registers agents with capabilities", () => {
    const agentId = runtime.registerAgent({
      name: "Test Agent",
      specialization: {
        domain: "testing",
        subdomains: ["unit", "integration"],
        preferredModels: ["test-model"],
        writeTags: [],
      },
      capabilities: ["test", "code"],
    });

    expect(agentId).toMatch(/^agent_/);

    // Agent should have read and write capabilities
    const caps = runtime.security.getAgentCapabilities(agentId);
    expect(caps.length).toBeGreaterThanOrEqual(2);
  });

  it("handles write proposals with security", () => {
    const agentId = runtime.registerAgent({
      name: "Writer",
      specialization: {
        domain: "writing",
        subdomains: [],
        preferredModels: [],
        writeTags: [],
      },
      capabilities: [],
    });

    const result = runtime.proposeWrite({
      proposalId: `prop_${randomUUID()}`,
      proposedBy: agentId,
      operation: "create",
      capsule: {
        content: "A new observation",
        type: "observation",
        tags: [],
      },
      justification: "Discovered during task",
      targetTrust: "OPERATIONAL",
    });

    expect(result.committed).toBe(true);
    expect(runtime.crystal.getCapsuleCount()).toBe(1);
  });

  it("blocks unauthorized reads", () => {
    const result = runtime.retrieve({
      query: "test",
      requester: "unauthorized_agent",
      permissions: [],
      constraints: {
        maxCapsules: 10,
        maxTokens: 2000,
        trustFloor: "UNTRUSTED",
        maxDepth: 1,
        maxToolCalls: 10,
      },
    });

    expect(result).toBeNull();
  });

  it("provides system health", () => {
    const health = runtime.getHealth();
    expect(health.defects).toBeDefined();
    expect(health.defectDensity).toBeGreaterThanOrEqual(0);
    expect(health.hazardRate).toBeGreaterThanOrEqual(0);
    expect(health.survival100Steps).toBeGreaterThan(0);
    expect(health.swarm).toBeDefined();
  });

  it("runs LLM tasks with quality gate", async () => {
    const agentId = runtime.registerAgent({
      name: "LLM Agent",
      specialization: {
        domain: "general",
        subdomains: [],
        preferredModels: ["test-model"],
        writeTags: [],
      },
      capabilities: [],
    });

    const { result, qualityGate } = await runtime.executeLLMTask("What is TypeScript?", agentId);

    expect(result.output).toBeDefined();
    expect(qualityGate.overallScore).toBeGreaterThanOrEqual(0);
  });

  it("shuts down cleanly", () => {
    runtime.shutdown();
    // Should have recorded shutdown trace
    const events = runtime.trace.byType("task_received");
    expect(events.some((e) => e.data.event === "runtime_shutdown")).toBe(true);
  });
});
