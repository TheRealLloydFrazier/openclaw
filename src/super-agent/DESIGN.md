# Super-Agent Architecture Design Document

**Authors:** Lloyd D. Frazier (Memory Statue v2), OpenClaw Contributors
**Date:** 2026-02-07
**Status:** Stage 1 - Design Specification

---

## 1. Overview

This document specifies a super-agent architecture that integrates seven
subsystems into a unified runtime. The design builds on Memory Statue v2
(Frazier, 2026) and extends it with multi-LLM orchestration, swarm coordination,
incremental context management, behavioral governance, capability security,
and full observability.

### 1.1 Design Goals

1. **Drift-resistant long-horizon memory** (Memory Statue v2)
2. **Multi-LLM composition** - not comparison, but synthesis of best elements
3. **Additive retrieval** - O(delta) not O(N) context reconstruction
4. **Swarm intelligence** - specialized agents sharing a compounding knowledge base
5. **Behavioral governance** - TFRD Canon as constitutional law for agent behavior
6. **Capability security** - fine-grained, runtime-negotiable permissions
7. **Full observability** - every decision traceable, every failure debuggable

### 1.2 Non-Goals

- Replacing OpenClaw's existing channel/messaging infrastructure
- Training or fine-tuning LLMs
- Building a new vector database engine
- Production deployment (this is a reference architecture)

### 1.3 Subsystem Map

```
                    ┌──────────────────────────────┐
                    │      SWARM ORCHESTRATOR       │
                    │  task decomposition, routing  │
                    │  agent lifecycle, coordination│
                    └──────┬───────┬───────┬───────┘
                           │       │       │
                    ┌──────┴──┐ ┌──┴────┐ ┌┴───────┐
                    │ Agent A │ │Agent B│ │Agent N │
                    │ (spec.) │ │(spec.)│ │(spec.) │
                    └──┬──────┘ └──┬────┘ └┬───────┘
                       │           │       │
                    ┌──┴───────────┴───────┴───────┐
                    │      MULTI-LLM ROUTER        │
                    │  model selection, synthesis   │
                    │  output fusion, quality judge │
                    └──────────────┬────────────────┘
                                   │
                    ┌──────────────┴────────────────┐
                    │   INCREMENTAL CONTEXT ENGINE   │
                    │  delta computation, snapshots  │
                    │  additive retrieval, checkpts  │
                    └──────────────┬────────────────┘
                                   │
                    ┌──────────────┴────────────────┐
                    │       MEMORY CRYSTAL           │
                    │  capsules, indices, governance │
                    │  retrieval pipeline, drift mon │
                    └──────────────┬────────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
┌─────────┴──────────┐ ┌──────────┴─────────┐ ┌───────────┴──────────┐
│   TFRD CANON       │ │ CAPABILITY SECURITY│ │  REASONING TRACE     │
│ behavioral govern. │ │ permission engine  │ │  observability       │
└────────────────────┘ └────────────────────┘ └──────────────────────┘
```

---

## 2. Memory Crystal (Memory Statue v2 Implementation)

### 2.1 Capsule Schema

The capsule is the atomic unit of memory. Every piece of knowledge stored
in the crystal is a capsule.

```typescript
interface Capsule {
  // Identity
  id: string; // stable UUID
  type: CapsuleType; // what kind of knowledge
  version: number; // monotonic version counter

  // Content
  content: string; // text payload
  contentHash: string; // SHA-256 of content
  embedding?: Float32Array; // vector embedding (lazy-computed)

  // Governance
  trust: TrustLevel; // CANON | OPERATIONAL | DRAFT | UNTRUSTED
  tags: DeterminativeTag[]; // policy/security/freshness gates
  promotionHistory: PromotionRecord[]; // audit trail of trust changes

  // Time
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  accessedAt: string; // last retrieval time
  ttl?: TTLPolicy; // expiration policy

  // Provenance
  provenance: ProvenanceEntry[]; // where this knowledge came from
  sourceAgentId?: string; // which agent created this
  parentCapsuleIds: string[]; // linked parent capsules

  // Retrieval metadata
  accessCount: number; // how often retrieved
  usefulness: number; // 0-1 score from feedback
}

type CapsuleType =
  | "observation" // raw fact or data point
  | "decision" // a choice that was made and why
  | "policy" // a rule or constraint
  | "state_card" // current state of something
  | "summary" // compressed summary of sources
  | "skill" // learned procedure or technique
  | "artifact" // produced output (code, document, etc.)
  | "correction" // explicit correction of prior knowledge
  | "reflection"; // meta-reasoning about agent performance

type TrustLevel = "CANON" | "OPERATIONAL" | "DRAFT" | "UNTRUSTED";

interface DeterminativeTag {
  category: "authority" | "freshness" | "security" | "scope" | "artifact";
  value: string; // e.g., "CONFIDENTIAL:HR", "TTL:30d", "PROJECT:alpha"
  enforced: boolean; // if true, this tag gates retrieval (non-negotiable)
}

interface TTLPolicy {
  expiresAt?: string; // hard expiration
  refreshAfter?: string; // soft: should be re-verified after this time
  onExpiry: "archive" | "quarantine" | "delete";
}

interface ProvenanceEntry {
  sourceType:
    | "agent_output"
    | "tool_result"
    | "human_input"
    | "document"
    | "api_response"
    | "capsule_derivation";
  sourceId: string;
  sourceAgentId?: string;
  timestamp: string;
  span?: [number, number]; // character range in source
  hash: string; // SHA-256 of source content at time of derivation
}

interface PromotionRecord {
  from: TrustLevel;
  to: TrustLevel;
  timestamp: string;
  approvedBy: string; // agent ID, human ID, or governance policy ID
  reason: string;
  reversible: boolean;
}
```

### 2.2 Index Architecture

The crystal maintains multiple indices for hybrid retrieval:

```typescript
interface CrystalIndices {
  // Vector similarity index (primary semantic search)
  vectorIndex: VectorIndex;

  // Keyword/BM25 index (exact match, identifiers)
  keywordIndex: KeywordIndex;

  // Metadata index (fast filtering by tags, type, trust, time)
  metadataIndex: MetadataIndex;

  // Provenance graph (capsule relationships)
  provenanceGraph: ProvenanceGraph;

  // Nucleus (hot set - frequently accessed, high-value capsules)
  nucleus: NucleusCache;
}

interface NucleusCache {
  capsuleIds: Set<string>; // IDs of hot-set capsules
  maxSize: number; // bounded size
  evictionPolicy: "lru" | "usefulness-weighted";
  precomputedEmbeddings: Map<string, Float32Array>;
}
```

### 2.3 Write Path (Propose-Validate-Commit)

Agents never write directly to the crystal. They propose writes,
which pass through validation and governance.

```typescript
interface WriteProposal {
  proposalId: string;
  proposedBy: string; // agent ID
  operation: "create" | "update" | "archive" | "promote" | "demote";
  capsule: Partial<Capsule>; // the proposed content
  justification: string; // why this write is needed
  targetTrust: TrustLevel; // requested trust level
  conflictResolution?: "replace" | "supersede" | "merge";
}

// Validation pipeline
// 1. Schema validation (all required fields present, types correct)
// 2. Duplicate detection (content hash check)
// 3. Contradiction scan (does this conflict with existing CANON?)
// 4. Policy compliance (does this violate any determinative tags?)
// 5. Trust gate (CANON promotion requires governed approval)
// 6. Commit to append-only log + update indices
```

### 2.4 Retrieval Pipeline (Diffraction)

Four-stage deterministic pipeline as specified in Memory Statue v2 Section 5:

```typescript
interface RetrievalRequest {
  query: string;
  queryIntent?: string;
  requester: string; // agent ID
  permissions: string[]; // ACL tags this agent holds
  constraints: RetrievalConstraints;
}

interface RetrievalConstraints {
  maxCapsules: number; // packing budget (capsule count)
  maxTokens: number; // packing budget (token count)
  trustFloor: TrustLevel; // minimum trust level
  requiredTags?: DeterminativeTag[];
  excludedTags?: DeterminativeTag[];
  timeWindow?: { after?: string; before?: string };
  maxDepth: number; // recursion limit
  maxToolCalls: number; // bounded computation
}

// Pipeline stages:
// Stage 1: Policy Filter  - enforce determinative tags + ACL
// Stage 2: Hybrid Retrieve - vector similarity + BM25 keyword
// Stage 3: Rerank/Score    - relevance scoring with trust weighting
// Stage 4: Pack            - bounded evidence set with provenance
```

### 2.5 Drift Monitoring

Continuous measurement of the defect vector from Memory Statue v2 Section 6:

```typescript
interface DefectVector {
  contradictionRate: number; // CVR: rolling contradiction rate [0,1]
  unfaithfulnessRate: number; // UF: claims not supported by evidence [0,1]
  decisionInconsistency: number; // DI: unstable decisions [0,1]
  stalenessIndex: number; // SI: expired capsules still in use [0,1]
  summaryDivergence: number; // SD: summaries drifted from sources [0,1]
  retrievalMissRate: number; // RMR: failed to retrieve known-good capsules [0,1]
  toolCallTailLatency: number; // TL: P95 tool call count [normalized]
  tokenTailCost: number; // TC: P95 token usage [normalized]
}

interface DriftMonitor {
  // Compute defect vector at current step
  computeDefects(step: number): DefectVector;

  // Scalar defect density (weighted sum)
  computeDensity(defects: DefectVector, weights: number[]): number;

  // Check if any threshold is breached
  checkThresholds(defects: DefectVector): ThresholdBreach[];

  // Trigger annealing if needed
  shouldAnneal(defects: DefectVector, schedule: AnnealingSchedule): boolean;
}
```

---

## 3. Incremental Context Engine

### 3.1 Problem Statement

Standard retrieval rebuilds the full context pack on every turn. For a crystal
with N capsules and a conversation at turn T, this is O(N) work per turn.
Over a long session, this becomes the dominant cost.

### 3.2 Core Idea: Delta Retrieval

Instead of rebuilding from scratch, maintain a context snapshot and compute
only what changed.

```typescript
interface ContextSnapshot {
  snapshotId: string;
  turnNumber: number;
  capsuleIds: string[]; // ordered list of capsules in current context
  capsuleVersions: Map<string, number>; // version at time of inclusion
  tokenCount: number;
  contentHash: string; // hash of the packed context
  createdAt: string;
}

interface ContextDelta {
  added: string[]; // capsule IDs to add
  removed: string[]; // capsule IDs to remove
  updated: string[]; // capsule IDs that changed (new version)
  reordered: boolean; // whether priority ordering changed
  reason: DeltaReason;
}

type DeltaReason =
  | "new_query" // user asked something new
  | "new_capsule" // new knowledge was written
  | "capsule_expired" // TTL expired
  | "capsule_promoted" // trust level changed
  | "relevance_shift" // query context shifted enough to rerank
  | "checkpoint"; // periodic full rebuild
```

### 3.3 Snapshot Lifecycle

```
Turn 1: Full retrieval → Snapshot S1
Turn 2: Delta computation → Delta D2 → Apply D2 to S1 → Snapshot S2
Turn 3: Delta computation → Delta D3 → Apply D3 to S2 → Snapshot S3
...
Turn K: Checkpoint → Full retrieval → Snapshot SK (reset drift)
```

### 3.4 When to Checkpoint (Full Rebuild)

Delta accumulation can itself drift. Checkpointing periodically ensures
the snapshot stays faithful to a full retrieval result.

```typescript
interface CheckpointPolicy {
  maxTurnsSinceCheckpoint: number; // e.g., 20 turns
  maxDeltaAccumulation: number; // e.g., if >60% of capsules replaced
  onTopicShift: boolean; // checkpoint when query topic changes significantly
  onAnnealingComplete: boolean; // checkpoint after maintenance runs
}
```

### 3.5 Cost Model

```
Standard retrieval: C_turn = C_embed(q) + C_search(N) + C_rerank(K) + C_pack(K)
Delta retrieval:    C_turn = C_embed(q) + C_diff(S, q) + C_pack(|delta|)

where C_diff << C_search(N) for small deltas

Amortized over T turns with checkpoint every P turns:
  Standard: T * C_full
  Delta:    (T/P) * C_full + (T - T/P) * C_delta
```

---

## 4. Multi-LLM Router and Synthesizer

### 4.1 Architecture

The Multi-LLM layer operates at three levels, selectable per task:

```typescript
type RoutingStrategy = "route" | "verify" | "synthesize";

interface MultiLLMRouter {
  // Level 1: Route to single best model
  route(task: AgentTask): Promise<ModelSelection>;

  // Level 2: Send to N models, pick best via judge
  verify(task: AgentTask, models: ModelId[]): Promise<VerifiedOutput>;

  // Level 3: Send to N models, extract best elements, fuse
  synthesize(task: AgentTask, models: ModelId[]): Promise<SynthesizedOutput>;
}
```

### 4.2 Model Registry

```typescript
interface ModelProfile {
  id: ModelId;
  provider: "anthropic" | "openai" | "google" | "local" | string;
  capabilities: ModelCapabilities;
  costPer1kTokens: { input: number; output: number };
  latencyP50Ms: number;
  latencyP95Ms: number;
  contextWindow: number;
  supportsStreaming: boolean;
  supportsToolUse: boolean;
}

interface ModelCapabilities {
  reasoning: number; // 0-1 strength rating
  coding: number;
  creativity: number;
  factualAccuracy: number;
  instruction: number; // instruction-following fidelity
  safety: number;
  multimodal: boolean;
  languages: string[]; // ISO 639-1 codes
}
```

### 4.3 Routing Logic

```typescript
interface TaskAnalysis {
  primaryDomain:
    | "reasoning"
    | "coding"
    | "creative"
    | "factual"
    | "instruction"
    | "multimodal"
    | "translation";
  complexity: "simple" | "moderate" | "complex";
  stakes: "low" | "medium" | "high"; // determines routing strategy
  latencyBudgetMs: number;
  tokenBudget: number;
}

// Routing rules:
// - low stakes + simple → route to cheapest capable model
// - medium stakes → route to best model for domain
// - high stakes → verify (send to 2+ models, judge picks best)
// - high stakes + complex → synthesize (fuse best elements from all)
```

### 4.4 Synthesis Protocol

This is the novel component. Synthesis is NOT "pick the best answer."
It is "extract the unique contribution of each answer and fuse them."

```typescript
interface SynthesisStep {
  // Step 1: Parallel execution
  outputs: Map<ModelId, ModelOutput>;

  // Step 2: Element extraction (per-model)
  // For each output, identify: key claims, reasoning chains,
  // code blocks, creative elements, caveats, citations
  elements: Map<ModelId, ExtractedElements>;

  // Step 3: Cross-model comparison
  // Identify: agreements (high confidence), disagreements (needs resolution),
  // unique contributions (one model saw something others missed)
  comparison: CrossModelComparison;

  // Step 4: Fusion
  // Merge agreements, resolve disagreements via evidence weight,
  // incorporate unique contributions if they pass verification
  fused: FusedOutput;

  // Step 5: Coherence pass
  // Ensure the fused output reads as one voice, not a patchwork
  final: string;
}

interface ExtractedElements {
  claims: { text: string; confidence: number; evidence?: string }[];
  reasoningSteps: { step: string; valid: boolean }[];
  codeBlocks: { code: string; language: string; correctness?: number }[];
  caveats: string[];
  uniqueInsights: string[]; // things only this model mentioned
}

interface CrossModelComparison {
  agreements: { claim: string; supportedBy: ModelId[]; confidence: number }[];
  disagreements: { claim: string; positions: Map<ModelId, string> }[];
  uniqueContributions: { modelId: ModelId; contribution: string; value: number }[];
}
```

### 4.5 Cost Management

```typescript
interface LLMBudget {
  maxConcurrentModels: number; // cap parallel calls
  maxTokensPerSynthesis: number; // total across all models
  maxCostPerTask: number; // dollar amount cap
  fallbackOnBudgetExhaust: ModelId; // single model to use when budget is spent
}
```

---

## 5. Swarm Orchestrator

### 5.1 Agent Specialization

Each agent in the swarm has a declared specialization. This determines
what tasks it receives and what knowledge domains it writes to.

```typescript
interface SwarmAgent {
  id: string;
  name: string;
  specialization: AgentSpecialization;
  status: "idle" | "working" | "blocked" | "offline";
  currentTask?: string;
  capabilities: string[]; // tool access list
  trustLevel: TrustLevel; // agent's own trust level for writes
  performanceMetrics: AgentMetrics;
}

interface AgentSpecialization {
  domain: string; // e.g., "backend-engineering", "research", "security"
  subdomains: string[]; // e.g., ["databases", "api-design", "performance"]
  preferredModels: ModelId[]; // models this agent works best with
  writeTags: DeterminativeTag[]; // tags auto-applied to this agent's capsules
}

interface AgentMetrics {
  tasksCompleted: number;
  taskSuccessRate: number;
  avgTaskDurationMs: number;
  capsulesContributed: number;
  capsuleUsefulnessAvg: number; // how often its capsules get retrieved by others
  driftContribution: number; // how much drift this agent's writes cause
}
```

### 5.2 Task Decomposition

The orchestrator breaks complex tasks into subtasks and assigns them
to specialized agents.

```typescript
interface TaskDecomposition {
  rootTask: SwarmTask;
  subtasks: SwarmTask[];
  dependencies: TaskDependency[]; // DAG of subtask dependencies
  assignmentStrategy: "specialist" | "round-robin" | "auction";
}

interface SwarmTask {
  id: string;
  parentId?: string;
  description: string;
  domain: string;
  requiredCapabilities: string[];
  assignedAgent?: string;
  status: "pending" | "assigned" | "in_progress" | "completed" | "failed" | "blocked";
  priority: number;
  deadline?: string;
  result?: TaskResult;
  writeProposals: WriteProposal[]; // capsules this task wants to write
}

interface TaskDependency {
  from: string; // task ID that must complete first
  to: string; // task ID that depends on it
  type: "data" | "approval" | "ordering";
}

interface TaskResult {
  output: string;
  capsuleIds: string[]; // capsules written as part of this task
  confidence: number;
  verifiedBy?: string; // another agent that verified this
}
```

### 5.3 Knowledge Compounding

The key mechanism: when one agent learns something, all agents benefit.

```typescript
// When Agent A completes a task:
// 1. Agent A proposes capsules from its work (findings, techniques, patterns)
// 2. Capsules are validated and committed to the crystal at OPERATIONAL trust
// 3. Crystal indices are updated (including the delta for incremental context)
// 4. Other agents' next retrievals can now surface Agent A's knowledge
// 5. If Agent A's capsule is retrieved and used successfully N times,
//    it becomes a candidate for CANON promotion

interface CompoundingEvent {
  sourceAgent: string;
  capsuleId: string;
  retrievedBy: string[]; // agents that retrieved this capsule
  usedInTasks: string[]; // tasks where this capsule influenced output
  feedbackScores: number[]; // usefulness ratings from consuming agents
  promotionCandidate: boolean; // eligible for CANON based on usage
}
```

### 5.4 Coordination Protocol

```typescript
interface SwarmProtocol {
  // Agent discovery and registration
  register(agent: SwarmAgent): void;
  deregister(agentId: string): void;

  // Task assignment
  assignTask(task: SwarmTask): string; // returns assigned agent ID
  reassignTask(taskId: string): string; // reassign if agent fails

  // Inter-agent communication (through the crystal, not direct)
  // Agents communicate by writing capsules, not by messaging each other.
  // This ensures all communication is logged, governed, and retrievable.

  // Conflict resolution
  resolveWriteConflict(proposals: WriteProposal[]): WriteProposal;

  // Health monitoring
  checkAgentHealth(agentId: string): AgentHealth;
  removeUnhealthyAgent(agentId: string): void;
}
```

### 5.5 Swarm Scaling Properties

```
Knowledge growth with N agents over T turns:
  Single agent:  K(T) = k * T                    (linear)
  Swarm (naive):  K(T) = k * N * T               (linear per agent, but N× more)
  Swarm (compounding): K(T) ~ k * N * T * (1 + r)^T   (compounding factor r)

Where r depends on:
  - Cross-domain knowledge reuse rate
  - Capsule usefulness scores
  - CANON promotion rate
  - Retrieval relevance across specializations

The compounding factor r is the key metric to optimize.
It represents how much one agent's learning accelerates other agents' work.
```

---

## 6. TFRD Canon (Behavioral Governance)

### 6.1 Constitutional Structure

TFRD provides the behavioral constitution that all agents in the swarm must follow.
It maps to Memory Statue v2's CANON governance layer.

```typescript
interface TFRDCanon {
  // Operating Principles (Section 2 of TFRD) - non-negotiable behavioral laws
  principles: CanonPrinciple[];

  // Workflow phases (Section 3 of TFRD) - standard operating procedures
  workflow: WorkflowPhase[];

  // Quality gates (Section 3E of TFRD) - validation checkpoints
  qualityGates: QualityGate[];

  // Scoring rubric (Section 7 of TFRD) - measurable compliance
  rubric: ScoringDimension[];

  // Domain packs (Section 10 of TFRD) - specialization overlays
  domainPacks: DomainPack[];
}

interface CanonPrinciple {
  id: string;
  name: string; // e.g., "truth_is_product"
  description: string;
  enforcementLevel: "hard" | "soft"; // hard = system-enforced, soft = self-assessed
  violationResponse: "block" | "warn" | "log";
  measurable: boolean;
  metric?: string; // metric name if measurable
}

interface WorkflowPhase {
  id: string;
  name: string; // "intake" | "plan" | "gather" | "compose" | "quality_gate"
  steps: WorkflowStep[];
  required: boolean; // can this phase be skipped?
  maxDurationMs?: number; // time budget
}

interface QualityGate {
  id: string;
  checks: QualityCheck[];
  passThreshold: number; // minimum checks that must pass (0-1)
  blockOnFailure: boolean; // if true, output is not delivered
}

interface QualityCheck {
  name: string; // e.g., "correctness", "completeness", "clarity"
  evaluator: "self" | "judge_llm" | "rule_based";
  weight: number;
}

interface ScoringDimension {
  name: string; // "accuracy" | "usefulness" | "clarity" | "integrity" | "safety"
  scale: [number, number]; // [0, 3]
  masteryThreshold: number; // 2.5
  description: string;
}
```

### 6.2 Canon Enforcement in the Swarm

Every agent in the swarm has the TFRD canon loaded as part of its system prompt.
The canon is stored as CANON-trust capsules in the crystal, making it:

- Versionable (new versions require governed promotion)
- Auditable (all agents' compliance is logged)
- Evolvable (domain packs can be added without changing core principles)

```typescript
// At agent initialization:
// 1. Retrieve all CANON capsules tagged [POLICY] + [TFRD]
// 2. Pack them into the agent's system context
// 3. Register quality gate hooks that run before every output
// 4. Log compliance scores to the reasoning trace
```

---

## 7. Capability Security Engine

### 7.1 Capability Model

Instead of coarse allow/deny lists, capabilities are fine-grained tokens
that can be granted, delegated, and revoked at runtime.

```typescript
interface Capability {
  id: string;
  resource: string; // what this capability grants access to
  actions: string[]; // what actions are permitted
  scope: CapabilityScope;
  grantedTo: string; // agent ID
  grantedBy: string; // who issued this capability
  expiresAt?: string;
  delegatable: boolean; // can this agent pass this capability to sub-agents?
  revocable: boolean;
  conditions?: CapabilityCondition[];
}

type CapabilityScope =
  | { type: "global" }
  | { type: "project"; projectId: string }
  | { type: "domain"; domain: string }
  | { type: "capsule"; capsuleIds: string[] }
  | { type: "temporal"; validAfter: string; validBefore: string };

interface CapabilityCondition {
  field: string; // e.g., "trust_level", "content_type", "tag"
  operator: "eq" | "neq" | "in" | "gt" | "lt";
  value: string | number | string[];
}
```

### 7.2 Permission Negotiation

When an agent needs a capability it does not have, it can request escalation.
This is not automatic - it requires justification and approval.

```typescript
interface EscalationRequest {
  requestId: string;
  requestedBy: string; // agent ID
  capability: Partial<Capability>;
  justification: string;
  taskContext: string; // what task requires this
  urgency: "low" | "medium" | "high";
}

interface EscalationResponse {
  requestId: string;
  granted: boolean;
  capability?: Capability; // the granted capability (may be narrower than requested)
  reason: string;
  approvedBy: string; // governance policy ID or human
}
```

### 7.3 Security Invariants

```
1. No agent can write CANON capsules without governed approval
2. No agent can read capsules outside its ACL scope
3. No agent can delegate capabilities it does not hold
4. All capability grants are logged in the append-only audit trail
5. Expired capabilities are enforced (no grace period)
6. Capability escalation requests are rate-limited per agent
```

---

## 8. Reasoning Trace (Observability)

### 8.1 Trace Structure

Every agent action produces a trace event. The trace is a complete,
replayable record of the agent's decision-making.

```typescript
interface TraceEvent {
  id: string;
  timestamp: string;
  agentId: string;
  taskId?: string;
  type: TraceEventType;
  data: Record<string, unknown>;
  parentEventId?: string; // for nested events (e.g., tool call within reasoning)
  durationMs?: number;
}

type TraceEventType =
  | "task_received" // agent got a new task
  | "retrieval_start" // started retrieving from crystal
  | "retrieval_result" // got results back
  | "llm_call_start" // sent prompt to LLM
  | "llm_call_result" // got LLM response
  | "tool_call" // invoked a tool
  | "write_proposal" // proposed a capsule write
  | "write_committed" // capsule write was committed
  | "quality_gate" // ran quality gate checks
  | "synthesis_step" // multi-LLM synthesis event
  | "capability_check" // checked a permission
  | "escalation_request" // requested permission escalation
  | "delta_computed" // incremental context delta
  | "checkpoint" // full context rebuild
  | "drift_measurement" // defect vector computed
  | "annealing_triggered" // maintenance routine started
  | "error" // something went wrong
  | "decision" // agent made a decision (with reasoning)
  | "reflection"; // agent reflected on its own performance
```

### 8.2 Trace Queries

```typescript
interface TraceQuery {
  // "Show me everything Agent A did on Task X"
  byAgent(agentId: string): TraceEvent[];
  byTask(taskId: string): TraceEvent[];

  // "Show me the retrieval that led to this output"
  retrievalChain(outputId: string): TraceEvent[];

  // "Show me all quality gate failures in the last hour"
  byType(type: TraceEventType, timeRange: TimeRange): TraceEvent[];

  // "Show me the full reasoning path from query to answer"
  reasoningPath(queryId: string): TraceEvent[];

  // "Show me all drift measurements over time"
  driftTimeline(timeRange: TimeRange): DefectVector[];
}
```

### 8.3 Trace Storage

Traces are append-only and stored separately from the crystal
(they are about the system, not knowledge in the system).

```typescript
interface TraceStore {
  append(event: TraceEvent): void;
  query(q: TraceQuery): TraceEvent[];
  compact(before: string): void; // compress old traces (keep summaries)
  export(format: "json" | "otlp"): string; // OpenTelemetry compatible export
}
```

---

## 9. Integration: How the Subsystems Connect

### 9.1 Request Flow (End-to-End)

```
1. User query arrives at Swarm Orchestrator
2. Orchestrator analyzes query, decomposes into tasks
3. Tasks are assigned to specialized agents
4. Each agent:
   a. Checks capabilities (Security Engine)
   b. Retrieves context (Incremental Context Engine → Crystal)
   c. Selects routing strategy (Multi-LLM Router)
   d. Generates output (LLM call(s))
   e. Runs quality gate (TFRD Canon)
   f. Proposes capsule writes (Crystal write path)
   g. Logs everything (Reasoning Trace)
5. Orchestrator collects results, handles dependencies
6. Final output is delivered with provenance
7. Drift monitor updates defect vector
8. Annealing scheduler checks thresholds
```

### 9.2 Startup Sequence

```
1. Initialize Crystal (load capsules, build indices)
2. Load TFRD Canon from CANON capsules
3. Initialize Security Engine (load capability grants)
4. Initialize Trace Store
5. Initialize Drift Monitor (compute baseline defect vector)
6. Initialize Incremental Context Engine (create initial snapshot)
7. Initialize Multi-LLM Router (register available models)
8. Initialize Swarm Orchestrator (register agents)
9. System ready
```

### 9.3 Shutdown Sequence

```
1. Stop accepting new tasks
2. Wait for in-progress tasks to complete (with timeout)
3. Final drift measurement
4. Flush trace buffer
5. Persist crystal state (snapshot indices)
6. Persist context snapshots
7. Clean shutdown
```

---

## 10. Implementation Phases

### Phase 0: Foundation (this session)

- Capsule schema and Crystal storage (SQLite-backed)
- Basic retrieval pipeline (4 stages)
- Write path (propose-validate-commit)
- Append-only audit log
- Basic drift metrics (SI, RMR - the "easy" ones)

### Phase 1: Intelligence Layer

- Multi-LLM Router (Level 1: routing)
- Incremental Context Engine (delta computation)
- Reasoning Trace (event logging)

### Phase 2: Swarm

- Swarm Orchestrator (task decomposition, assignment)
- Agent specialization and lifecycle
- Knowledge compounding mechanism

### Phase 3: Governance

- TFRD Canon integration
- Capability Security Engine
- Multi-LLM Synthesis (Level 3)
- Full drift monitoring (all 8 metrics)

### Phase 4: Validation

- Validation harness (Memory Statue v2 Section 7)
- Drift injection testing
- Long-horizon regression suite

---

## 11. File Structure

```
src/super-agent/
  DESIGN.md                    # this document
  types.ts                     # shared type definitions
  crystal/
    capsule.ts                 # capsule schema and validation
    storage.ts                 # SQLite-backed crystal storage
    indices.ts                 # vector + keyword + metadata indices
    retrieval.ts               # 4-stage diffraction pipeline
    write-path.ts              # propose-validate-commit
    nucleus.ts                 # hot set management
    drift.ts                   # defect vector computation
    annealing.ts               # maintenance routines
  context/
    snapshot.ts                # context snapshot management
    delta.ts                   # delta computation
    checkpoint.ts              # periodic full rebuild
  router/
    registry.ts                # model profiles and capabilities
    analyzer.ts                # task analysis for routing
    router.ts                  # routing logic (Level 1)
    verifier.ts                # verification logic (Level 2)
    synthesizer.ts             # synthesis protocol (Level 3)
  swarm/
    orchestrator.ts            # task decomposition and assignment
    agent.ts                   # agent lifecycle and specialization
    protocol.ts                # coordination protocol
    compounding.ts             # knowledge compounding tracking
  canon/
    tfrd.ts                    # TFRD canon structure
    enforcement.ts             # quality gate hooks
    scoring.ts                 # compliance scoring
  security/
    capabilities.ts            # capability model
    escalation.ts              # permission negotiation
    enforcement.ts             # security invariant checks
  trace/
    events.ts                  # trace event types
    store.ts                   # append-only trace storage
    query.ts                   # trace query interface
  runtime.ts                   # unified runtime (wires everything together)
  index.ts                     # public API
```

---

## 12. References

- Frazier, L. D. (2026). Memory Statue v2: A Structured Memory Architecture
  for Long-Horizon AI Agents. DOI: 10.5281/zenodo.18452213.
- Cox, D. R. (1972). Regression Models and Life-Tables. JRSS-B.
- Lewis, P. et al. (2020). Retrieval-Augmented Generation for Knowledge-Intensive
  NLP Tasks. NeurIPS 2020.
- Liu, N. F. et al. (2024). Lost in the Middle: How Language Models Use Long
  Contexts. TACL 12:157-173.
- Robertson, S. & Zaragoza, H. (2009). The Probabilistic Relevance Framework:
  BM25 and Beyond. FnTIR.
- Zhang, A. L. et al. (2025). Recursive Language Models. arXiv:2512.24601.
