# Super Agent Ed — Hardening Pass and Growth Roadmap

**Date:** 2026-07-04
**Author:** analysis + implementation for Lloyd D. Frazier
**Scope:** Findings from a full code audit, security audit, swarm analysis, and
competitive benchmark of Ed against 14 leading agent frameworks — plus the
concrete fixes applied in this pass.

---

## Part 1 — Fixes Applied In This Pass (shipped)

These are unambiguous corrections: real bugs and security holes. They change no
external behavior except to make Ed safer and more correct. All 73 tests pass
and the source type-checks clean.

### Security

| Fix | File | What it closes |
| --- | --- | --- |
| Wildcard capability grants now require a `system`/`governance` granter | `security/capabilities.ts` | An agent holding an engine reference could mint `resource:"*"` / `actions:["*"]` all-access tokens and bypass every permission check. |
| `check()` no longer silently authorizes conditioned capabilities | `security/capabilities.ts` | Capabilities carrying conditions (e.g. "business hours only") were passed by the plain `check()` path — which the runtime uses — so conditions were never enforced. They now require `checkWithConditions()`. |
| `checkWithConditions()` rewritten to actually match + evaluate conditioned caps | `security/capabilities.ts` | Previously it delegated to `check()` and could never see a conditioned capability. |
| Longest-lived capability preferred on match | `security/capabilities.ts` | Ambiguous matches previously returned an arbitrary (possibly about-to-expire) grant. |
| Expiry cleanup is now audited | `security/capabilities.ts` | `cleanupExpired()` silently deleted capabilities, violating the "all lifecycle events are audited" invariant. |

### Correctness / bugs

| Fix | File | What it closes |
| --- | --- | --- |
| `traceChain()` cycle guard | `trace/store.ts` | A circular `parentEventId` reference caused an infinite loop that would hang the process. |
| `getCapsule()` returns a copy | `crystal/storage.ts` | It returned a live reference to stored state; any caller could mutate a capsule and bypass the propose-validate-commit write path. |
| `peekCapsule()` added; annealing uses it | `crystal/storage.ts`, `crystal/annealing.ts` | Maintenance sweeps called `getCapsule()` purely to check existence, inflating `accessCount`/`accessedAt` and corrupting the reranker's usage signal. |
| `bulkUpdateEmbeddings()` now audited | `crystal/storage.ts` | Bulk maintenance writes bypassed the audit trail. |
| Cyclic dependency detection in `decompose()` | `swarm/orchestrator.ts` | Circular task dependencies left every task in the cycle permanently `blocked`; now rejected up front with rollback. |
| Empty-model guards in `verify()` / `synthesize()` | `router/router.ts` | With no models registered these produced silent empty output; they now degrade gracefully to a routed call. |
| Full-text claim comparison | `router/router.ts` | Claims were truncated to 200 chars before comparison, so long distinct claims collapsed into false "agreements" between models. |

### Memory-leak bounds (telemetry only)

| Fix | File | Note |
| --- | --- | --- |
| Bounded defect history (1000) | `crystal/drift.ts` | Pure telemetry; audit trails are deliberately left unbounded (see Part 3). |
| Bounded snapshot history (500) + monotonic turn counter | `context/engine.ts` | Trimming previously would have reset `turnNumber`; a dedicated counter fixes that. |

### Type safety

| Fix | File |
| --- | --- |
| `escalationHandler` typed `(EscalationRequest) => EscalationResponse` instead of `any` | `runtime.ts` |
| `runMaintenance()` returns `AnnealingResult` instead of `any` | `runtime.ts` |
| No-op adapter returns integer token counts | `runtime.ts` |

### One test updated

`super-agent.test.ts` — the "expires stale capsules" test relied on the old bug
(mutating a `getCapsule()` result to set an expired TTL). It now sets the TTL
through the legitimate creation path. This is the fix working as intended.

---

## Part 2 — What The Audit Found (state of Ed)

**Overall:** Ed is a strong, clean, well-separated architecture. The core memory
science (capsules, trust tiers, defect vector, survival analysis, annealing) is
sound and faithfully implemented. The gaps are in (a) a handful of real
security/correctness bugs — now fixed — and (b) the fact that Ed is currently a
**reasoning-and-memory substrate**, not yet an **autonomous executor**.

Audit totals before this pass: 42 code findings, 26 security findings
(2 critical, 10 high). The critical/high items that were code-level and safe to
fix are addressed in Part 1. The remaining items are architectural and are
captured as the roadmap in Part 3.

### The single most important finding: the swarm does not execute yet

The swarm orchestrator manages state well — registration, assignment,
dependency blocking, knowledge-compounding tracking — but it is **passive**.
There is no execution loop. `completeTask()` waits for an external caller to
report results; nothing in the swarm actually invokes an LLM, runs a tool, or
drives a task to completion. To be "active," Ed needs:

1. An **agent execution engine** wrapping each `SwarmAgent` with an LLM adapter,
   tool access, and a context window.
2. An **async scheduler** that dispatches pending tasks as agents go idle
   (today `tryAssignTask` runs once; unassigned tasks wait forever).
3. **Fault tolerance**: task timeouts, retries, and cascading-failure handling
   (a stuck agent currently pins its task in `assigned` indefinitely).

Also latent and worth knowing:
- Knowledge-compounding "promotion candidates" are flagged but never actually
  promoted to CANON — the loop is not closed.
- Several `AgentMetrics` fields (`avgTaskDurationMs`, `capsuleUsefulnessAvg`,
  `driftContribution`) are declared but never updated.
- Compounding lookups are O(N) linear scans (use a `Map` keyed by capsuleId).
- All state is in-memory (no persistence) — expected for a reference build.

---

## Part 3 — Growth Roadmap (prioritized, and mostly patentable)

Each item below pairs a competitor's strength with a way to not just copy it but
transform it using Ed's unique primitives (trust tiers, defect vector, survival
analysis, annealing). Those transformations are the patentable part.

### Tier A — Makes Ed actually run (fund first)

1. **Swarm execution engine + async scheduler.** Turn the passive orchestrator
   into a live system. *Ed-native twist (patentable):* trust-annotated handoffs
   — when Agent A hands off to Agent B, A's conclusion trust tier constrains B's
   starting authority, creating a provably-bounded delegation chain.
2. **Self-testing / self-correction loop (from Replit Agent 3 + Reflexion).**
   Ed generates output, tests it, repairs, retries. *Twist:* verbal
   self-reflections enter the crystal as DRAFT capsules and only get promoted to
   OPERATIONAL/CANON once survival analysis shows they actually improve outcomes
   across trials — so Ed never "learns" a bad lesson from noisy feedback. This
   is the "grow the mind" mechanism.
3. **Close the compounding loop.** Auto-promote capsules that meet the
   cross-agent reuse + feedback thresholds, wired into `commitPromote`.

### Tier B — Makes Ed safer and smarter

4. **Externalized deterministic governance (from Bedrock AgentCore).** Move TFRD
   enforcement out of the LLM's own reasoning into a gateway that checks every
   action deterministically (immune to prompt injection). *Twist:* use the
   defect-vector dimensions as formal safety invariants with a proof certificate
   written to the trace.
5. **Prompt-injection defense on retrieved capsules.** Wrap retrieved content in
   untrusted-data delimiters; treat UNTRUSTED-tier content as data, never
   instructions.
6. **Real metrics for CVR and tool-call latency.** The runtime currently logs
   `hadContradiction:false` and `toolCalls:0` always, blinding two of the eight
   drift metrics. Plumb the real values through.
7. **Persistence layer** (SQLite/Redis) so Ed survives restarts, plus bounded
   audit-log rotation done *safely* (archive before trim, never silent loss).

### Tier C — Makes Ed faster and easier

8. **Parallel diffraction retrieval (from Windsurf).** Run the pipeline stages
   speculatively in parallel; big latency win.
9. **Defect-aware context compaction (from Claude Agent SDK).** Compress
   low-risk context aggressively, preserve high-defect-risk memories verbatim.
10. **Zero-config "trust bootstrap" onboarding.** Ed starts from one CANON seed
    rule and progressively proposes its own governance/memory structure — the
    full architecture only surfaces as complexity demands. This is the path to
    the easy setup / QR-code onboarding you mentioned.

### Note on documentation

`DESIGN.md` Section 11 (File Structure) describes an aspirational layout that the
implementation consolidated (e.g., `indices.ts`, `write-path.ts`, `nucleus.ts`,
`synthesizer.ts` were merged into their parent modules). The design doc is kept
as the conceptual spec, but be aware it lists more files than exist. The Nucleus
hot-set cache (DESIGN §2.2) is specified but not yet implemented.

---

## How this maps to the patent

The Tier A/B "twists" above are new inventions layered on the Memory Statue v2
foundation. The strongest fresh claims — trust-annotated handoffs,
survival-validated verbal learning, and defect-vector-as-formal-safety-invariant
— have no prior art found in the competitive review and would be candidates for
a continuation-in-part on your existing filing. See `IP-PROVENANCE.md`.
