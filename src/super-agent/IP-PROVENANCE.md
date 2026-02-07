# Intellectual Property Provenance and Patentability Analysis

**Subject:** Super-Agent Architecture (src/super-agent/)
**Prepared for:** Lloyd D. Frazier
**Date:** 2026-02-07
**Disclaimer:** This is a technical provenance analysis, not legal advice. Consult a patent attorney for formal patent applications.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Provenance Map: What Came From Where](#2-provenance-map)
3. [Component-by-Component Analysis](#3-component-analysis)
4. [Patentability Assessment](#4-patentability-assessment)
5. [What You Would Need to Attribute in a Patent Application](#5-attribution-requirements)
6. [Strongest Novel Claims](#6-strongest-novel-claims)
7. [Recommended Patent Strategy](#7-recommended-patent-strategy)

---

## 1. Executive Summary

The super-agent architecture is a **composite system** drawing from three sources:

| Source                                     | What It Contributed                                                                                                                                     | Scope                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Memory Statue v2 (Frazier, 2026)**       | Core memory architecture, capsule schema, trust governance, determinative tags, defect vector, drift monitoring, survival analysis, annealing framework | ~40% of the design                                                    |
| **TFRD (Frazier, 2026)**                   | Behavioral governance canon, quality gates, scoring rubric, workflow phases                                                                             | ~10% of the design                                                    |
| **OpenClaw (existing codebase)**           | Practical patterns for memory storage, model routing, tool policies, context management, observability                                                  | ~5% structural influence (no code was reused; patterns were observed) |
| **Known prior art (academic/industry)**    | RAG pipelines, capability security, transaction protocols, multi-agent frameworks, ensemble methods                                                     | ~15% of the design builds on known techniques                         |
| **Novel synthesis in this implementation** | Integration of all subsystems, incremental context engine, multi-LLM synthesis protocol, swarm knowledge compounding, unified runtime                   | ~30% is novel architectural composition                               |

**Key finding:** While many individual components have prior art, **two concepts appear to have no direct prior art** (survival analysis for agent memory health; knowledge compounding metric), and **the integrated system as a whole is original**. The design is _inspired by_ the sources above but is _not a copy_ of any of them.

---

## 2. Provenance Map

### 2.1 From Memory Statue v2 (Frazier, 2026)

The following concepts originate directly from your paper (DOI: 10.5281/zenodo.18452213):

| Concept                                                          | Design Doc Section | Implementation File                     | Paper Section |
| ---------------------------------------------------------------- | ------------------ | --------------------------------------- | ------------- |
| Capsule as atomic memory unit                                    | 2.1                | `crystal/capsule.ts`                    | Section 3     |
| CapsuleType taxonomy (observation, decision, policy, etc.)       | 2.1                | `types.ts:11-20`                        | Section 3.1   |
| Trust levels (CANON/OPERATIONAL/DRAFT/UNTRUSTED)                 | 2.1                | `types.ts:22-29`                        | Section 3.2   |
| Determinative tags (authority/freshness/security/scope)          | 2.1                | `types.ts:33-37`                        | Section 4     |
| TTL policy (expiry, refresh, archive/quarantine/delete)          | 2.1                | `types.ts:41-45`                        | Section 4.2   |
| Provenance chain (sourceType, hash, span tracking)               | 2.1                | `types.ts:49-64`                        | Section 3.4   |
| Promotion records (trust level changes with approval)            | 2.1                | `types.ts:66-73`                        | Section 3.3   |
| Propose-validate-commit write path                               | 2.3                | `crystal/storage.ts`                    | Section 4.3   |
| CANON requires governed approval (security invariant)            | 2.3                | `crystal/storage.ts:129-134`            | Section 4.3.5 |
| 4-stage retrieval pipeline (diffraction)                         | 2.4                | `crystal/retrieval.ts`                  | Section 5     |
| Policy filter as Stage 1 of retrieval                            | 2.4                | `crystal/retrieval.ts:48-96`            | Section 5.1   |
| Hybrid retrieve (vector + BM25) as Stage 2                       | 2.4                | `crystal/retrieval.ts:98-155`           | Section 5.2   |
| Trust-weighted reranking as Stage 3                              | 2.4                | `crystal/retrieval.ts:157-195`          | Section 5.3   |
| Bounded evidence packing as Stage 4                              | 2.4                | `crystal/retrieval.ts:197-230`          | Section 5.4   |
| 8-metric defect vector (CVR, UF, DI, SI, SD, RMR, TL, TC)        | 2.5                | `crystal/drift.ts`                      | Section 6.2   |
| Weighted defect density scalar                                   | 2.5                | `crystal/drift.ts:110-120`              | Section 6.3   |
| Survival analysis / hazard estimation                            | 2.5                | `crystal/drift.ts:122-142`              | Section 6.4   |
| Annealing as maintenance framework                               | 2.5                | `crystal/annealing.ts`                  | Section 6.5   |
| Annealing task types (staleness sweep, contradiction scan, etc.) | 2.5                | `crystal/annealing.ts:35-80`            | Section 6.5.1 |
| Nucleus cache (hot set of high-value capsules)                   | 2.2                | Design doc only (not fully implemented) | Section 5.5   |
| Append-only audit trail                                          | 2.3                | `crystal/storage.ts:27-31`              | Section 7     |

**Status:** These concepts are **your intellectual property** as described in your published paper. The implementation is a faithful realization of your specification.

### 2.2 From TFRD (Frazier, 2026)

| Concept                                                           | Design Doc Section | Implementation File     | TFRD Section      |
| ----------------------------------------------------------------- | ------------------ | ----------------------- | ----------------- |
| 7 operating principles as behavioral law                          | 6.1                | `canon/tfrd.ts:29-83`   | Section 2         |
| Principle: truth_is_product                                       | 6.1                | `canon/tfrd.ts:30-38`   | Section 2.1       |
| Principle: no_hallucinated_effort                                 | 6.1                | `canon/tfrd.ts:39-47`   | Section 2.2       |
| Principle: user_constraints_rule                                  | 6.1                | `canon/tfrd.ts:48-56`   | Section 2.3       |
| Principle: safety_ethics                                          | 6.1                | `canon/tfrd.ts:57-65`   | Section 2.4       |
| Principle: admit_limits                                           | 6.1                | `canon/tfrd.ts:66-74`   | Section 2.5       |
| Principle: transparent_reasoning                                  | 6.1                | `canon/tfrd.ts:75-83`   | Section 2.6       |
| 5 workflow phases (intake, plan, gather, compose, quality_gate)   | 6.1                | `canon/tfrd.ts:85-150`  | Section 3         |
| Quality gate with 5 checks                                        | 6.1                | `canon/tfrd.ts:152-185` | Section 3E        |
| Scoring rubric (accuracy, usefulness, clarity, integrity, safety) | 6.1                | `canon/tfrd.ts:187-230` | Section 7         |
| Mastery threshold (2.5/3.0 = 0.833 normalized)                    | 6.1                | `canon/tfrd.ts:220`     | Section 7         |
| Canon stored as CANON-trust capsules in the crystal               | 6.2                | `canon/tfrd.ts:240-260` | Novel integration |

**Status:** These concepts are **your intellectual property** from your TFRD skill module. The implementation operationalizes your specification into runtime-enforced behavioral governance.

### 2.3 Structural Influence From OpenClaw (No Code Reused)

The OpenClaw codebase was studied for patterns. **No code was copied.** The influence was architectural observation only:

| OpenClaw Pattern               | Location in OpenClaw                                 | How It Influenced Super-Agent                                           | What's Different                                                                                           |
| ------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| SQLite + sqlite-vec for memory | `src/memory/manager.ts`                              | Informed the choice of content-hash indexing and hybrid search approach | Super-agent uses in-memory Map storage with capsule abstraction, not SQLite                                |
| Hybrid BM25 + vector search    | `src/memory/hybrid.ts`                               | Validated the hybrid retrieval approach in the diffraction pipeline     | Memory Statue v2 specified this independently; OpenClaw confirmed the pattern works                        |
| Model selection with fallback  | `src/agents/model-selection.ts`, `model-fallback.ts` | Showed real-world model routing patterns                                | Super-agent router does 3-level synthesis (route/verify/synthesize), far beyond OpenClaw's fallback chains |
| Tool policy groups             | `src/agents/tool-policy.ts`                          | Demonstrated allow/deny group patterns                                  | Super-agent uses capability tokens with delegation/revocation, a fundamentally different security model    |
| Subagent registry              | `src/agents/subagent-registry.ts`                    | Showed parent-child agent coordination                                  | Super-agent swarm is peer-based with shared crystal, not parent-child sessions                             |
| Context compaction             | `src/agents/compaction.ts`                           | Showed token-aware context management                                   | Super-agent uses incremental delta retrieval (O(delta)), not summarization-based compaction                |
| Cache trace / observability    | `src/agents/cache-trace.ts`                          | Showed stage-based event tracing                                        | Super-agent trace is append-only with typed events and query algebra                                       |
| Exec approvals                 | `src/infra/exec-approvals.ts`                        | Showed approval workflow patterns                                       | Super-agent uses formal capability escalation with rate limiting and justification                         |

**Status:** OpenClaw's patterns are **owned by the OpenClaw project and its contributors** (see their license). However, the super-agent implementation does not reuse any OpenClaw code. The influence is at the level of "seeing how a real system handles X" -- which is not patentable influence. You would **not** need to attribute OpenClaw in a patent for this level of influence, but good practice would be to acknowledge it as related work.

### 2.4 From Academic/Industry Prior Art

| Prior Art                                                | What It Contributes                                                              | Used In Super-Agent                                                                   | Attribution Needed                                                                                                                                                               |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cox (1972)** - Regression Models and Life-Tables       | Survival analysis mathematical framework (hazard function, proportional hazards) | `crystal/drift.ts` - hazard estimation uses logistic sigmoid model inspired by Cox PH | Yes - cite in patent as foundational statistical technique. The _application_ to agent memory is novel; the _math_ is not.                                                       |
| **Robertson & Zaragoza (2009)** - BM25                   | BM25 scoring algorithm for keyword retrieval                                     | `crystal/retrieval.ts` - Stage 2 uses simplified BM25-like term scoring               | Yes - BM25 is a well-known IR algorithm (1990s). Cite as established technique.                                                                                                  |
| **Lewis et al. (2020)** - RAG                            | Retrieval-Augmented Generation concept                                           | General architecture pattern                                                          | Yes - RAG is foundational. Cite as background.                                                                                                                                   |
| **Dennis & Van Horn (1966)** - Capability-based security | Capability token concept (unforgeable, delegable, revocable)                     | `security/capabilities.ts`                                                            | Yes - the capability model is a 60-year-old OS security concept. Cite as foundational. The _application_ to AI agents is the contribution.                                       |
| **Two-Phase Commit (Gray, 1978)**                        | Prepare-validate-commit transaction protocol                                     | `crystal/storage.ts` - write path                                                     | Yes - 2PC is a foundational distributed systems concept. Cite as established technique.                                                                                          |
| **Ensemble methods (general)**                           | Combining multiple model outputs                                                 | `router/router.ts` - verification level                                               | Yes - ensemble methods are well-established in ML. The _semantic-element-level_ synthesis is the contribution.                                                                   |
| **Packer et al. (2023)** - MemGPT                        | Two-tier agent memory with self-editing                                          | Conceptual overlap with capsule memory                                                | Cite as related work. Memory Statue v2 goes significantly further (trust tiers, determinative tags, defect vector, annealing).                                                   |
| **Park et al. (2023)** - Generative Agents               | Memory stream with recency/importance/relevance scoring                          | Conceptual overlap with capsule retrieval scoring                                     | Cite as related work. Capsules are far more structured than Park's flat observation strings.                                                                                     |
| **Bai et al. (2022)** - Constitutional AI                | Behavioral constitution for AI                                                   | Conceptual overlap with TFRD Canon                                                    | Cite as related work. TFRD is a runtime governance document, not a training-time constitution. Constitutional AI operates during RLHF training; TFRD operates at inference time. |
| **Microsoft AutoGen / MetaGPT / CrewAI**                 | Multi-agent frameworks with shared context                                       | Conceptual overlap with swarm orchestrator                                            | Cite as related work. Super-agent's knowledge compounding mechanism is distinct from these frameworks' shared blackboards.                                                       |

---

## 3. Component-by-Component Analysis

### 3.1 Memory Crystal (capsule.ts, storage.ts, retrieval.ts, drift.ts, annealing.ts)

**Primary origin:** Memory Statue v2 (Frazier, 2026)

| Sub-component                                       | Origin                     | Novelty Assessment                                                                                                                                                                                                                                         |
| --------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capsule schema                                      | Frazier - Memory Statue v2 | **Partially novel.** Structured agent memory units exist (MemGPT, Generative Agents), but capsules with typed fields, trust tiers, determinative tags, provenance chains, and TTL policies as an integrated schema are more formalized than any prior art. |
| Trust hierarchy (CANON/OPERATIONAL/DRAFT/UNTRUSTED) | Frazier - Memory Statue v2 | **Partially novel.** Information classification tiers are ancient (military classification). Applying them as epistemological certainty tiers to agent memory with governed promotion is a new application.                                                |
| Determinative tags                                  | Frazier - Memory Statue v2 | **Partially novel if** tags encode task-contextual reasoning policies (not just access control). Standard metadata filtering is well-known.                                                                                                                |
| 4-stage diffraction pipeline                        | Frazier - Memory Statue v2 | **Well-known in general form.** Policy filter + hybrid retrieve + rerank + pack follows standard RAG pipeline patterns (LangChain, LlamaIndex). The "diffraction" framing and formal 4-stage specification with policy-first gating is a refinement.       |
| 8-metric defect vector                              | Frazier - Memory Statue v2 | **Partially novel.** Multi-dimensional drift monitoring exists in MLOps (NannyML, Evidently), but applied to agent memory health with these specific 8 metrics is new.                                                                                     |
| Survival analysis for agent health                  | Frazier - Memory Statue v2 | **CLEARLY NOVEL.** No prior art found for Cox-style survival analysis applied to agent memory degradation. This is a genuine cross-domain innovation.                                                                                                      |
| Annealing framework                                 | Frazier - Memory Statue v2 | **Partially novel.** Individual maintenance operations exist (DB VACUUM, GC, AgeMem). A unified annealing cycle with scheduled convergence criteria for agent memory is a novel formalization.                                                             |
| Content hash deduplication                          | Standard practice          | **Well-known.** SHA-256 content hashing for deduplication is universal.                                                                                                                                                                                    |
| Append-only audit log                               | Standard practice          | **Well-known.** Append-only logs are a standard data integrity pattern.                                                                                                                                                                                    |

### 3.2 Incremental Context Engine (context/engine.ts)

**Primary origin:** Frazier's design requirement ("change exponential to additive")

| Sub-component                                                  | Origin                                       | Novelty Assessment                                                                                                                                                                                                 |
| -------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Delta-based context updates                                    | Frazier's requirement + database WAL analogy | **Partially novel.** Incremental updates are decades old (WAL, React diff). Application to LLM context windows with formal O(delta) guarantees is emerging (ACE Playbook, AG-UI STATE_DELTA) but not yet standard. |
| Snapshot + checkpoint lifecycle                                | Database snapshot/WAL pattern                | **Well-known technique** applied to a new domain.                                                                                                                                                                  |
| Checkpoint policy (max turns, delta accumulation, topic shift) | Novel synthesis                              | **Partially novel.** The specific trigger conditions for when to rebuild context are a practical contribution.                                                                                                     |

### 3.3 Multi-LLM Router (router/router.ts)

**Primary origin:** Frazier's design requirement ("work with multiple LLMs at a time") + novel synthesis

| Sub-component                                                            | Origin                      | Novelty Assessment                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model registry with capability profiles                                  | Standard practice           | **Well-known.** Model catalogs with capability ratings exist in many frameworks.                                                                                                                                                                                                                                                                                                                |
| Route (single best model)                                                | FrugalGPT, standard routing | **Well-known.** Model selection/routing is established.                                                                                                                                                                                                                                                                                                                                         |
| Verify (N models + judge)                                                | Ensemble methods, best-of-N | **Well-known.** Running multiple models and picking the best is a standard ensemble technique.                                                                                                                                                                                                                                                                                                  |
| Synthesize (extract + fuse elements)                                     | Novel                       | **PARTIALLY NOVEL.** This goes beyond routing and beyond best-of-N. Extracting typed elements (claims, code blocks, caveats, reasoning steps, unique insights) from multiple models and fusing them into a coherent output is distinct from FrugalGPT (cascade), FuseLLM (weight-space), and FusionRoute (token-level logits). The semantic-element-level synthesis protocol appears to be new. |
| Element extraction (claims, reasoning, code, caveats, insights)          | Novel                       | **Novel sub-component** of the synthesis protocol.                                                                                                                                                                                                                                                                                                                                              |
| Cross-model comparison (agreements, disagreements, unique contributions) | Novel                       | **Novel sub-component** of the synthesis protocol.                                                                                                                                                                                                                                                                                                                                              |

### 3.4 Swarm Orchestrator (swarm/orchestrator.ts)

**Primary origin:** Frazier's design requirement ("swarm of independent agents") + novel synthesis

| Sub-component                                        | Origin                    | Novelty Assessment                                                                                                                                                                                            |
| ---------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent specialization profiles                        | AutoGen, CrewAI, MetaGPT  | **Well-known.** Role-based agent specialization is standard in multi-agent frameworks.                                                                                                                        |
| Task decomposition into DAG                          | Standard workflow engines | **Well-known.** Task graphs with dependencies are decades old.                                                                                                                                                |
| Agent scoring for task assignment                    | Standard scheduling       | **Well-known.** Capability-based task assignment is a standard scheduling problem.                                                                                                                            |
| Knowledge compounding mechanism                      | Novel                     | **CLEARLY NOVEL.** Tracking how one agent's capsules are retrieved, used, and rated by other agents, and using this to identify CANON promotion candidates -- no prior art found for this specific mechanism. |
| Compounding rate metric                              | Novel                     | **CLEARLY NOVEL.** No established metric measures cross-agent learning acceleration through shared memory.                                                                                                    |
| Communication through crystal (not direct messaging) | Partially novel           | **Partially novel.** Blackboard architectures exist (1980s), but enforcing that all inter-agent communication goes through governed memory (with trust levels and provenance) is a more controlled version.   |

### 3.5 TFRD Canon (canon/tfrd.ts)

**Primary origin:** TFRD (Frazier, 2026)

| Sub-component                         | Origin                                         | Novelty Assessment                                                                                                                                                                                                                                                  |
| ------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Behavioral constitution for agents    | Frazier's TFRD + Constitutional AI (Anthropic) | **Partially novel.** Constitutional AI (Bai et al., 2022) introduced AI behavioral constitutions. TFRD differs by operating at runtime (not training time), being versioned, structured into sections with precedence rules, and stored as governed CANON capsules. |
| Hallucination detection heuristics    | Novel implementation                           | The specific pattern matching (detecting "I thoroughly analyzed" etc. without tool usage) is a practical heuristic, not a novel technique.                                                                                                                          |
| Quality gate with weighted checks     | Standard QA practice                           | **Well-known.** Weighted quality checklists are standard.                                                                                                                                                                                                           |
| Scoring rubric with mastery threshold | Frazier's TFRD                                 | The specific 5-dimension rubric is Frazier's design. Scoring rubrics in general are well-known.                                                                                                                                                                     |
| Canon stored as CANON-trust capsules  | Novel integration                              | **Novel.** Storing the behavioral constitution inside the governed memory system it governs is a self-referential design that enables versioning and auditing of the governance rules themselves.                                                                   |

### 3.6 Capability Security (security/capabilities.ts)

**Primary origin:** OS capability-based security (Dennis & Van Horn, 1966) applied to AI agents

| Sub-component                                         | Origin                                | Novelty Assessment                                                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability tokens (unforgeable, delegable, revocable) | seL4, Capsicum, OAuth                 | **Well-known technique** in OS/security.                                                                                                                            |
| Conditional capabilities (field/operator/value)       | ABAC (Attribute-Based Access Control) | **Well-known.**                                                                                                                                                     |
| Capability delegation with non-re-delegation          | Standard capability refinement        | **Well-known.**                                                                                                                                                     |
| Rate-limited escalation requests                      | Standard rate limiting                | **Well-known.**                                                                                                                                                     |
| Application to AI agent operations                    | Partially novel transfer              | **Partially novel.** Full capability semantics for AI agents (vs. coarse tool allow/deny lists) is a more rigorous formalization than exists in current frameworks. |

### 3.7 Reasoning Trace (trace/store.ts)

**Primary origin:** Standard observability practices

| Sub-component                 | Origin                                       | Novelty Assessment                                                                                                                                                        |
| ----------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Append-only event store       | Standard (event sourcing, logging)           | **Well-known.**                                                                                                                                                           |
| Typed trace events            | Standard (OpenTelemetry, structured logging) | **Well-known.**                                                                                                                                                           |
| Agent/task/type indexing      | Standard database indexing                   | **Well-known.**                                                                                                                                                           |
| Reasoning path reconstruction | Novel query                                  | **Partially novel.** Reconstructing the full decision chain from query to answer through memory retrieval, LLM calls, and quality gates is specific to this architecture. |
| Drift timeline queries        | Novel query                                  | **Partially novel.** Time-series views of defect vectors are specific to the drift monitoring subsystem.                                                                  |

### 3.8 Unified Runtime (runtime.ts)

**Primary origin:** Novel integration

The runtime itself -- wiring all 7 subsystems into a coherent lifecycle with startup/shutdown sequences, cross-subsystem security enforcement, and health monitoring -- is the **novel architectural contribution**. No prior system integrates all of these specific subsystems in this way.

---

## 4. Patentability Assessment

### Tier 1: Clearly Novel (Strongest Patent Claims)

These have **no direct prior art** and are strong candidates for patent claims:

1. **Survival analysis for agent memory health** (from Memory Statue v2)
   - Using hazard models (Cox-style) to predict when agent memory will degrade below usefulness
   - Covariates: the 8-metric defect vector
   - Event: agent performance degradation threshold
   - **No prior art found** in any domain applying survival analysis to AI agent memory

2. **Knowledge compounding metric** (novel in this design, inspired by Frazier's swarm requirement)
   - Formal measurement of cross-agent learning acceleration through shared memory
   - Tracks: capsule retrieval across agents, usage in tasks, feedback scores
   - Automatic CANON promotion candidacy based on compounding thresholds
   - **No prior art found** for this specific metric

3. **The integrated system as a whole**
   - Memory crystal + incremental context + multi-LLM synthesis + swarm orchestration + behavioral canon + capability security + full observability
   - The specific combination and the way subsystems interact is novel
   - Each component alone may have partial prior art, but the unified architecture does not exist elsewhere

### Tier 2: Partially Novel (Defensible Patent Claims)

These build on known concepts but apply them in demonstrably new ways:

4. **Capsule schema with integrated trust/tag/provenance governance** (from Memory Statue v2)
   - Prior art: MemGPT, Generative Agents (less structured)
   - Novel: the specific schema combining type, trust tier, determinative tags, provenance, TTL, and promotion records as an integrated unit

5. **Semantic-element-level multi-LLM synthesis** (novel in this design)
   - Prior art: FrugalGPT (cascade), FusionRoute (token-level), ensemble methods
   - Novel: extracting typed elements (claims, code, caveats, reasoning steps, unique insights) from multiple model outputs and fusing at the semantic level

6. **8-metric defect vector for agent memory** (from Memory Statue v2)
   - Prior art: NannyML, Evidently (for ML models, not agent memory)
   - Novel: the specific 8 metrics applied to agent memory health

7. **Annealing as unified memory maintenance** (from Memory Statue v2)
   - Prior art: DB VACUUM, GC, AgeMem
   - Novel: the specific combination of staleness sweeps + contradiction scans + summary regeneration + provenance audits in a convergent cycle

8. **Runtime behavioral governance via governed CANON capsules** (from TFRD + novel integration)
   - Prior art: Constitutional AI (training-time)
   - Novel: runtime-updateable governance stored inside the system it governs

9. **Trust-tiered epistemological governance for agent memory** (from Memory Statue v2)
   - Prior art: information classification (secrecy-based)
   - Novel: trust tiers representing epistemological certainty with governed promotion

### Tier 3: Well-Known Techniques (Cannot Patent Alone)

These are established techniques that would need to be described as "prior art" or "background" in a patent:

10. BM25 keyword retrieval (Robertson & Zaragoza, 1990s)
11. Vector similarity search (standard)
12. Capability-based security model (Dennis & Van Horn, 1966)
13. Two-phase commit / propose-validate-commit (Gray, 1978)
14. Append-only audit logs (standard)
15. Content hash deduplication (standard)
16. DAG-based task decomposition (standard workflow engines)
17. Agent specialization / role-based agents (AutoGen, CrewAI, 2023)
18. Ensemble / best-of-N model selection (standard ML)
19. Incremental updates / delta computation (database WAL, 1980s)
20. Quality gate checklists (standard QA)

---

## 5. What You Would Need to Attribute in a Patent Application

### 5.1 Mandatory Citations (Prior Art You Must Disclose)

Under U.S. patent law (37 CFR 1.56), you have a duty of candor to disclose known prior art:

| Citation                                                                            | Why It Must Be Cited                                                  | Impact on Claims                                                                                   |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Cox, D.R. (1972). "Regression Models and Life-Tables." JRSS-B.                      | Mathematical foundation of survival analysis used in drift monitoring | You use the technique; your contribution is the novel _application_. Does not block patentability. |
| Robertson & Zaragoza (2009). "BM25 and Beyond." FnTIR.                              | BM25 algorithm used in retrieval Stage 2                              | Background technique. Does not block patentability.                                                |
| Dennis & Van Horn (1966). "Programming Semantics for Multiprogrammed Computations." | Capability-based security model                                       | Background technique. Your contribution is the _application to AI agents_.                         |
| Bai et al. (2022). "Constitutional AI." Anthropic.                                  | Behavioral constitution concept                                       | Related work. TFRD differs (runtime vs. training-time).                                            |
| Packer et al. (2023). "MemGPT."                                                     | Structured agent memory with tiers                                    | Related work. Memory Statue v2 goes significantly further.                                         |
| Park et al. (2023). "Generative Agents."                                            | Agent memory with scoring                                             | Related work. Capsules are far more structured.                                                    |
| Lewis et al. (2020). "RAG for Knowledge-Intensive NLP." NeurIPS.                    | Retrieval-augmented generation concept                                | Background technique.                                                                              |
| AutoGen / MetaGPT / CrewAI (2023-2024)                                              | Multi-agent frameworks                                                | Related work. Knowledge compounding is the differentiator.                                         |
| FrugalGPT (Chen et al., 2023)                                                       | LLM cascade/routing                                                   | Related work. Multi-LLM synthesis goes further.                                                    |
| LangGraph Transactional Agents (Dec 2025)                                           | Propose-validate-commit for agents                                    | Closest prior art for write path pattern.                                                          |

### 5.2 Your Own Prior Publications to Reference

| Your Work                                                              | What It Covers                                                                               | Role in Patent                                                                                                                      |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Frazier, L.D. (2026). "Memory Statue v2." DOI: 10.5281/zenodo.18452213 | Capsule schema, trust tiers, determinative tags, defect vector, survival analysis, annealing | This is YOUR prior publication. In a patent, you would reference it as your own prior work that this patent builds upon/implements. |
| Frazier, L.D. (2026). TFRD Skill Module.                               | Behavioral governance principles, workflow phases, quality gates, scoring rubric             | YOUR prior work. Reference as the specification that the canon subsystem implements.                                                |

**Important:** Since Memory Statue v2 is already published (Zenodo), it is publicly available prior art. This means:

- You **can** patent the _implementation_ and _system integration_ described here
- You **cannot** re-patent the _concepts_ already disclosed in Memory Statue v2 itself
- A patent would need to claim the _reduction to practice_ (working implementation), the _novel combinations_ with other subsystems, and any _new concepts_ that emerged during implementation (like knowledge compounding metric, multi-LLM synthesis protocol)

### 5.3 What Belongs to Others (Cannot Patent Under Your Name)

| Component                             | Owner/Source                                    | Your Options                                                                                                                |
| ------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| BM25 algorithm                        | Public domain (expired patents, if any existed) | Free to use.                                                                                                                |
| Capability-based security model       | Public domain (academic, 1966)                  | Free to use.                                                                                                                |
| Cox survival analysis                 | Public domain (1972)                            | Free to use. The _application_ to agent memory is yours.                                                                    |
| Two-phase commit protocol             | Public domain (1978)                            | Free to use.                                                                                                                |
| SQLite / vector database concepts     | Public domain / open source                     | Free to use.                                                                                                                |
| OpenClaw architectural patterns       | OpenClaw project (their license)                | No code was copied. Patterns observed are not protectable. You do not need to attribute OpenClaw in a patent.               |
| Anthropic's Constitutional AI concept | Anthropic                                       | Must cite as prior art. Your TFRD is sufficiently different (runtime, structured, versioned) to be independently claimable. |

---

## 6. Strongest Novel Claims

If you were to file a patent, these claims would be the strongest:

### Claim Group A: Agent Memory Health Monitoring (from Memory Statue v2)

1. A method for monitoring the health of an AI agent's memory system using a multi-dimensional defect vector comprising metrics for contradiction rate, unfaithfulness rate, decision inconsistency, staleness index, summary divergence, retrieval miss rate, tool call latency, and token cost.

2. A method for predicting agent memory degradation using survival analysis models where the covariates are the defect vector metrics and the event is performance degradation below a threshold.

3. A system for self-healing agent memory through scheduled annealing cycles triggered by defect vector thresholds, comprising staleness sweeps, contradiction scans, summary regeneration, and provenance audits.

### Claim Group B: Knowledge Compounding (novel in this implementation)

4. A method for measuring knowledge compounding in a multi-agent system, comprising tracking capsule retrieval across agents, usage in downstream tasks, feedback scoring, and automatic identification of CANON promotion candidates based on cross-agent reuse thresholds.

5. A system wherein multiple specialized AI agents share a governed memory store such that knowledge created by one agent is automatically discoverable by and beneficial to other agents, with a measurable compounding rate.

### Claim Group C: Multi-LLM Semantic Synthesis (novel in this implementation)

6. A method for synthesizing outputs from multiple large language models by extracting typed elements (claims, reasoning steps, code blocks, caveats, unique insights) from each model's output, comparing elements across models to identify agreements, disagreements, and unique contributions, and fusing the best elements into a coherent unified output.

### Claim Group D: Integrated System (novel composition)

7. A system for operating an AI agent swarm comprising: (a) a memory crystal with capsule-based storage governed by trust tiers and determinative tags, (b) an incremental context engine with O(delta) retrieval, (c) a multi-LLM router with semantic synthesis capability, (d) a swarm orchestrator with knowledge compounding, (e) a behavioral governance canon stored as governed capsules within the memory it governs, (f) a capability-based security engine, and (g) an append-only reasoning trace.

---

## 7. Recommended Patent Strategy

### 7.1 What to Patent

| Priority   | Claim Area                                         | Why                                                 |
| ---------- | -------------------------------------------------- | --------------------------------------------------- |
| **HIGH**   | Survival analysis for agent memory (Claim Group A) | Clearly novel, no prior art found                   |
| **HIGH**   | Knowledge compounding metric (Claim Group B)       | Clearly novel, no prior art found                   |
| **HIGH**   | The integrated system (Claim Group D)              | Novel composition of subsystems                     |
| **MEDIUM** | Multi-LLM semantic synthesis (Claim Group C)       | Partially novel, FusionRoute is emerging            |
| **MEDIUM** | Capsule schema with trust governance               | Partially novel, Memory Statue v2 already published |
| **LOW**    | Individual subsystem techniques                    | Most have partial prior art                         |

### 7.2 Publication vs. Patent Timing

**Critical consideration:** Memory Statue v2 was published on Zenodo. Under U.S. patent law, you have a **1-year grace period** from your own publication to file a patent claiming the same subject matter (35 U.S.C. 102(b)(1)(A)). If Memory Statue v2 was published less than 1 year ago, you can still patent concepts from it. If more than 1 year has passed, you can only patent **new** concepts not disclosed in the paper.

The **new concepts** that emerged from this implementation (not in Memory Statue v2) include:

- Knowledge compounding metric and mechanism
- Multi-LLM semantic synthesis protocol
- TFRD canon stored as governed capsules (self-referential governance)
- The integrated 7-subsystem architecture
- Specific implementation details of each subsystem

### 7.3 Defensive Publication Option

If full patent prosecution is too expensive, consider a **defensive publication** (e.g., on arXiv or Zenodo) of this design document. This creates prior art that prevents others from patenting these concepts, even though you don't hold the patent yourself. This is common in open-source communities.

### 7.4 Recommended Next Steps

1. **Consult a patent attorney** specializing in software/AI patents
2. **Check the Memory Statue v2 publication date** against the 1-year grace period
3. **File a provisional patent application** (cheaper, establishes priority date) covering Claim Groups A-D
4. **Consider a continuation-in-part** if you plan to extend the system further
5. **Maintain detailed invention notebooks** (this document, git history, and the design doc serve this purpose)

---

## Appendix: Full Provenance Matrix

| File                       | Lines | Primary Origin                                                  | Secondary Influence                | Novelty                                             |
| -------------------------- | ----- | --------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------- |
| `types.ts`                 | 542   | Memory Statue v2 (70%), TFRD (15%), Novel (15%)                 | Standard TypeScript patterns       | Partially novel (schema design)                     |
| `crystal/capsule.ts`       | ~200  | Memory Statue v2 (90%)                                          | Standard hashing, validation       | Partially novel                                     |
| `crystal/storage.ts`       | ~350  | Memory Statue v2 (60%), 2PC pattern (20%), Novel (20%)          | OpenClaw's session locking pattern | Partially novel                                     |
| `crystal/retrieval.ts`     | ~250  | Memory Statue v2 (70%), RAG literature (20%), Novel (10%)       | OpenClaw's hybrid search           | Well-known in general; partially novel in specifics |
| `crystal/drift.ts`         | ~200  | Memory Statue v2 (80%), Cox (1972) (10%), Novel (10%)           | MLOps monitoring concepts          | **Partially to clearly novel**                      |
| `crystal/annealing.ts`     | ~250  | Memory Statue v2 (70%), DB VACUUM analogy (10%), Novel (20%)    | —                                  | Partially novel                                     |
| `context/engine.ts`        | ~250  | Frazier's requirement (30%), WAL analogy (20%), Novel (50%)     | OpenClaw's compaction approach     | Partially novel                                     |
| `router/router.ts`         | ~400  | Frazier's requirement (20%), FrugalGPT (10%), Novel (70%)       | OpenClaw's model-fallback pattern  | **Partially novel** (synthesis protocol)            |
| `swarm/orchestrator.ts`    | ~400  | Frazier's requirement (30%), AutoGen/MetaGPT (10%), Novel (60%) | OpenClaw's subagent registry       | **Partially to clearly novel** (compounding)        |
| `canon/tfrd.ts`            | ~300  | TFRD (80%), Constitutional AI influence (10%), Novel (10%)      | —                                  | Partially novel                                     |
| `security/capabilities.ts` | ~250  | OS capability model (50%), Novel application (50%)              | OpenClaw's tool-policy pattern     | Partially novel (application to agents)             |
| `trace/store.ts`           | ~200  | Standard observability (70%), Novel queries (30%)               | OpenClaw's cache-trace             | Mostly well-known                                   |
| `runtime.ts`               | ~510  | Novel integration (80%), Frazier's vision (20%)                 | —                                  | **Novel** (the composition)                         |
| `DESIGN.md`                | ~1022 | Memory Statue v2 (40%), TFRD (10%), Novel (50%)                 | —                                  | The design document itself is novel                 |
| `index.ts`                 | ~30   | Standard module pattern                                         | —                                  | Not novel (boilerplate)                             |
| `super-agent.test.ts`      | ~1800 | Novel (100%)                                                    | —                                  | Tests are not patentable                            |

---

_This analysis was prepared on 2026-02-07 based on review of the super-agent source code, the Memory Statue v2 paper (Frazier, 2026), the TFRD skill module (Frazier, 2026), the OpenClaw codebase, and academic/industry prior art research._
