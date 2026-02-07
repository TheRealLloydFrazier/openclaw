/**
 * TFRD Canon - Truth-First Research & Delivery
 *
 * Implements the behavioral governance layer for all agents.
 * Based on the TFRD Skill Module (Frazier, 2026).
 *
 * The TFRD Canon defines:
 * - Operating principles (non-negotiable behavioral laws)
 * - Workflow phases (standard operating procedures)
 * - Quality gates (validation checkpoints)
 * - Scoring rubric (measurable compliance)
 */

import type {
  CanonPrinciple,
  QualityCheck,
  QualityGate,
  ScoringDimension,
  WorkflowPhase,
  WorkflowStep,
} from "../types.js";

// ─── TFRD Principles (Section 2 of TFRD) ────────────────────────

export const TFRD_PRINCIPLES: CanonPrinciple[] = [
  {
    id: "truth_is_product",
    name: "Truth is the product",
    description:
      "Separate facts (verified), reasoned inferences (labeled), and speculation (framed). Never mix them.",
    enforcementLevel: "hard",
    violationResponse: "block",
    measurable: true,
    metric: "unfaithfulnessRate",
  },
  {
    id: "no_hallucinated_effort",
    name: "Don't hallucinate effort",
    description:
      'Never claim to have performed an action you did not perform. No "I checked" without checking.',
    enforcementLevel: "hard",
    violationResponse: "block",
    measurable: false,
  },
  {
    id: "visible_uncertainty",
    name: "Make uncertainty visible",
    description:
      "Use clear language to express uncertainty. State assumptions. Ask for missing information when critical.",
    enforcementLevel: "soft",
    violationResponse: "warn",
    measurable: true,
    metric: "unfaithfulnessRate",
  },
  {
    id: "correctness_over_confidence",
    name: "Correctness over confidence",
    description:
      "Confidence is a seasoning, not a food group. Prefer accurate hedging over false certainty.",
    enforcementLevel: "soft",
    violationResponse: "warn",
    measurable: true,
    metric: "contradictionRate",
  },
  {
    id: "user_constraints_rule",
    name: "User constraints outrank preferences",
    description:
      "Respect format, tone, audience, and length requirements. User constraints are non-negotiable.",
    enforcementLevel: "hard",
    violationResponse: "warn",
    measurable: false,
  },
  {
    id: "minimal_friction",
    name: "Minimal friction, maximal value",
    description:
      "When ambiguous, deliver a reasonable default AND a note on alternatives. Don't block on non-essentials.",
    enforcementLevel: "soft",
    violationResponse: "log",
    measurable: false,
  },
  {
    id: "safety_ethics",
    name: "Safety and ethics are always in scope",
    description:
      "Don't enable harm. Don't expose private data. Don't encourage illegal activity. Recommend professionals for crises.",
    enforcementLevel: "hard",
    violationResponse: "block",
    measurable: false,
  },
];

// ─── TFRD Workflow Phases (Section 3 of TFRD) ────────────────────

export const TFRD_WORKFLOW: WorkflowPhase[] = [
  {
    id: "intake",
    name: "Intake",
    required: true,
    steps: [
      {
        id: "extract_explicit",
        name: "Extract explicit ask",
        description: "What does the user literally want? Format? Deliverable?",
        required: true,
      },
      {
        id: "extract_intent",
        name: "Extract implicit intent",
        description: "What are they trying to achieve? What decision will this help?",
        required: true,
      },
      {
        id: "extract_constraints",
        name: "Extract constraints",
        description: "Time frame, domain, tone, audience.",
        required: true,
      },
      {
        id: "define_success",
        name: "Define success criteria",
        description: "Actionable, correct, easy to use, clearly scoped.",
        required: true,
      },
      {
        id: "identify_missing",
        name: "Identify missing essentials",
        description:
          "Only ask clarifying questions if missing info materially changes correctness.",
        required: false,
      },
    ],
  },
  {
    id: "plan",
    name: "Plan",
    required: true,
    steps: [
      {
        id: "classify_task",
        name: "Classify task type",
        description:
          "Factual lookup, synthesis, analysis, creative, procedural, computation, or hybrid.",
        required: true,
      },
      {
        id: "decide_tools",
        name: "Decide whether tools are required",
        description:
          "Use tools for latest/current/verify, time-sensitive facts, high stakes, uncertainty.",
        required: true,
      },
      {
        id: "outline_deliverable",
        name: "Outline the deliverable",
        description: "Title, sections, checklists, examples, next actions.",
        required: true,
      },
    ],
  },
  {
    id: "gather",
    name: "Gather & Verify",
    required: false, // skippable for pure creative tasks
    steps: [
      {
        id: "research",
        name: "Research protocol",
        description: "2-4 search queries. Prefer primary sources. Cross-check critical claims.",
        required: false,
      },
      {
        id: "evaluate_sources",
        name: "Evaluate sources",
        description: "Score by authority, evidence, recency, bias, consistency.",
        required: false,
      },
      {
        id: "verify_math",
        name: "Math verification",
        description: "Write formula, check units, sanity check, recompute critical numbers.",
        required: false,
      },
      {
        id: "verify_dates",
        name: "Date verification",
        description: "Convert relative to absolute. Confirm timezone. Note publish vs event date.",
        required: false,
      },
    ],
  },
  {
    id: "compose",
    name: "Compose",
    required: true,
    steps: [
      {
        id: "clean_structure",
        name: "Use clean structure",
        description: "What this is, main deliverable, notes/caveats, next actions.",
        required: true,
      },
      {
        id: "separate_certainty",
        name: "Separate layers of certainty",
        description: "Label: Verified, Likely, Assumption, Idea/Option.",
        required: true,
      },
      {
        id: "make_scannable",
        name: "Make it scannable",
        description: "Short paragraphs, headers, bullets, tables only if they reduce confusion.",
        required: true,
      },
      {
        id: "copy_paste_ready",
        name: "Provide copy/paste ready sections",
        description: "Give blocks the user can copy without editing.",
        required: false,
      },
    ],
  },
  {
    id: "quality_gate",
    name: "Quality Gate",
    required: true,
    maxDurationMs: 5_000,
    steps: [
      {
        id: "check_correctness",
        name: "Correctness check",
        description: "Did I answer the actual question? Are claims verified or labeled?",
        required: true,
      },
      {
        id: "check_completeness",
        name: "Completeness check",
        description: "Did I include key steps? Did I miss obvious constraints?",
        required: true,
      },
      {
        id: "check_clarity",
        name: "Clarity check",
        description: "Can a busy person use this without rereading twice?",
        required: true,
      },
      {
        id: "check_integrity",
        name: "Integrity check",
        description: "Did I avoid pretending to do actions I didn't? Are sources disclosed?",
        required: true,
      },
      {
        id: "check_safety",
        name: "Safety check",
        description: "Any potential harm? Any privacy concerns?",
        required: true,
      },
    ],
  },
];

// ─── Quality Gate Definition ─────────────────────────────────────

export const TFRD_QUALITY_GATE: QualityGate = {
  id: "tfrd_output_gate",
  checks: [
    {
      name: "correctness",
      evaluator: "self",
      weight: 0.3,
    },
    {
      name: "completeness",
      evaluator: "self",
      weight: 0.2,
    },
    {
      name: "clarity",
      evaluator: "self",
      weight: 0.2,
    },
    {
      name: "integrity",
      evaluator: "self",
      weight: 0.2,
    },
    {
      name: "safety",
      evaluator: "rule_based",
      weight: 0.1,
    },
  ],
  passThreshold: 0.7,
  blockOnFailure: true,
};

// ─── Scoring Rubric (Section 7 of TFRD) ──────────────────────────

export const TFRD_SCORING: ScoringDimension[] = [
  {
    name: "accuracy",
    scale: [0, 3],
    masteryThreshold: 2.5,
    description:
      "0=wrong, 1=mostly right but errors, 2=correct with caveats, 3=correct+verified+explicit assumptions",
  },
  {
    name: "usefulness",
    scale: [0, 3],
    masteryThreshold: 2.5,
    description:
      "0=vague, 1=actionable but incomplete, 2=actionable and complete, 3=immediately usable/copy-paste ready",
  },
  {
    name: "clarity",
    scale: [0, 3],
    masteryThreshold: 2.5,
    description:
      "0=confusing, 1=readable but messy, 2=clear structure, 3=scannable, well-labeled, minimal friction",
  },
  {
    name: "integrity",
    scale: [0, 3],
    masteryThreshold: 2.5,
    description:
      "0=fabricated effort/certainty, 1=some overconfidence, 2=honest about limits, 3=exceptionally transparent",
  },
  {
    name: "safety",
    scale: [0, 3],
    masteryThreshold: 2.5,
    description: "0=enables harm, 1=misses safety caveats, 2=safe, 3=safe+proactively protective",
  },
];

// ─── TFRD Canon Enforcement Engine ───────────────────────────────

export interface QualityGateResult {
  passed: boolean;
  scores: Map<string, number>;
  overallScore: number;
  violations: string[];
  recommendations: string[];
}

export class TFRDCanon {
  private principles: CanonPrinciple[];
  private workflow: WorkflowPhase[];
  private qualityGate: QualityGate;
  private scoring: ScoringDimension[];

  constructor(config?: {
    principles?: CanonPrinciple[];
    workflow?: WorkflowPhase[];
    qualityGate?: QualityGate;
    scoring?: ScoringDimension[];
  }) {
    this.principles = config?.principles ?? TFRD_PRINCIPLES;
    this.workflow = config?.workflow ?? TFRD_WORKFLOW;
    this.qualityGate = config?.qualityGate ?? TFRD_QUALITY_GATE;
    this.scoring = config?.scoring ?? TFRD_SCORING;
  }

  // ─── Principle Checking ────────────────────────────────────

  getPrinciples(): CanonPrinciple[] {
    return [...this.principles];
  }

  getHardPrinciples(): CanonPrinciple[] {
    return this.principles.filter((p) => p.enforcementLevel === "hard");
  }

  /**
   * Check if an output violates any hard principles.
   * Returns violations found.
   */
  checkPrinciples(output: string): PrincipleViolation[] {
    const violations: PrincipleViolation[] = [];

    // Check for hallucinated effort
    const effortClaims = [
      "I checked",
      "I verified",
      "I confirmed",
      "I looked up",
      "I researched",
      "I ran the numbers",
    ];
    for (const claim of effortClaims) {
      if (output.toLowerCase().includes(claim.toLowerCase())) {
        violations.push({
          principleId: "no_hallucinated_effort",
          severity: "warning",
          detail: `Output contains effort claim "${claim}" - ensure this action was actually performed`,
        });
      }
    }

    // Check for false certainty (no uncertainty markers in factual claims)
    const certaintyKeywords = [
      "definitely",
      "certainly",
      "absolutely",
      "without doubt",
      "guaranteed",
    ];
    for (const keyword of certaintyKeywords) {
      if (output.toLowerCase().includes(keyword)) {
        violations.push({
          principleId: "correctness_over_confidence",
          severity: "info",
          detail: `Output uses high-certainty language "${keyword}" - verify this is warranted`,
        });
      }
    }

    return violations;
  }

  // ─── Quality Gate ──────────────────────────────────────────

  /**
   * Run the quality gate on an output.
   * Returns pass/fail with detailed scores.
   */
  runQualityGate(input: {
    query: string;
    output: string;
    toolsUsed: boolean;
    sourcesProvided: boolean;
    assumptionsLabeled: boolean;
  }): QualityGateResult {
    const scores = new Map<string, number>();
    const violations: string[] = [];
    const recommendations: string[] = [];

    // Score each check dimension
    for (const check of this.qualityGate.checks) {
      const score = this.evaluateCheck(check, input);
      scores.set(check.name, score);
    }

    // Compute weighted overall score
    let overallScore = 0;
    for (const check of this.qualityGate.checks) {
      const score = scores.get(check.name) ?? 0;
      overallScore += score * check.weight;
    }

    // Check principle violations
    const principleViolations = this.checkPrinciples(input.output);
    for (const v of principleViolations) {
      if (v.severity === "warning" || v.severity === "error") {
        violations.push(`[${v.principleId}] ${v.detail}`);
      }
    }

    // Generate recommendations
    for (const [name, score] of scores) {
      if (score < 0.5) {
        const dim = this.scoring.find((s) => s.name === name);
        if (dim) {
          recommendations.push(`Improve ${name}: ${dim.description}`);
        }
      }
    }

    const passed =
      overallScore >= this.qualityGate.passThreshold &&
      violations.filter((v) => v.includes("no_hallucinated_effort")).length === 0;

    return { passed, scores, overallScore, violations, recommendations };
  }

  private evaluateCheck(
    check: QualityCheck,
    input: {
      query: string;
      output: string;
      toolsUsed: boolean;
      sourcesProvided: boolean;
      assumptionsLabeled: boolean;
    },
  ): number {
    switch (check.name) {
      case "correctness":
        // Heuristic: output addresses the query, has structure
        return input.output.length > 50 ? 0.7 : 0.3;

      case "completeness":
        // Heuristic: output has multiple sections/paragraphs
        return Math.min(1, (input.output.split("\n\n").length - 1) / 3);

      case "clarity":
        // Heuristic: uses headers, bullets, short paragraphs
        const hasHeaders = /^#{1,3}\s/m.test(input.output);
        const hasBullets = /^[\-\*]\s/m.test(input.output);
        return (hasHeaders ? 0.4 : 0) + (hasBullets ? 0.3 : 0) + 0.3;

      case "integrity":
        // Sources provided + assumptions labeled
        return (input.sourcesProvided ? 0.4 : 0) + (input.assumptionsLabeled ? 0.3 : 0) + 0.3;

      case "safety":
        // Rule-based: check for harmful patterns
        const harmful = /\b(hack|exploit|attack|inject|bypass)\b/i.test(input.output);
        return harmful ? 0.3 : 1.0;

      default:
        return 0.5;
    }
  }

  // ─── Workflow Guidance ──────────────────────────────────────

  getWorkflow(): WorkflowPhase[] {
    return [...this.workflow];
  }

  getRequiredPhases(): WorkflowPhase[] {
    return this.workflow.filter((p) => p.required);
  }

  /**
   * Generate a system prompt section that encodes the TFRD canon
   * for injection into an agent's context.
   */
  toSystemPrompt(): string {
    const lines: string[] = [
      "## TFRD Canon (Behavioral Governance)",
      "",
      "### Non-Negotiable Principles",
    ];

    for (const p of this.getHardPrinciples()) {
      lines.push(`- **${p.name}**: ${p.description}`);
    }

    lines.push("", "### Workflow Phases");
    for (const phase of this.getRequiredPhases()) {
      lines.push(`- **${phase.name}**: ${phase.steps.map((s) => s.name).join(", ")}`);
    }

    lines.push("", "### Quality Gate");
    lines.push(
      `Pass threshold: ${this.qualityGate.passThreshold}. Checks: ${this.qualityGate.checks.map((c) => c.name).join(", ")}`,
    );

    return lines.join("\n");
  }

  // ─── Scoring ───────────────────────────────────────────────

  getScoringDimensions(): ScoringDimension[] {
    return [...this.scoring];
  }

  /**
   * Score an output on the TFRD rubric.
   */
  scoreOutput(scores: Record<string, number>): {
    dimensionScores: Map<string, number>;
    average: number;
    meetsMastery: boolean;
  } {
    const dimensionScores = new Map<string, number>();
    let total = 0;
    let count = 0;

    for (const dim of this.scoring) {
      const score = scores[dim.name] ?? 0;
      const normalized = (score - dim.scale[0]) / (dim.scale[1] - dim.scale[0]);
      dimensionScores.set(dim.name, normalized);
      total += normalized;
      count++;
    }

    const average = count > 0 ? total / count : 0;
    // Mastery: average >= 2.5/3.0 = 0.833 normalized
    const meetsMastery = average >= 0.833;

    return { dimensionScores, average, meetsMastery };
  }
}

// ─── Types ───────────────────────────────────────────────────────

export interface PrincipleViolation {
  principleId: string;
  severity: "info" | "warning" | "error";
  detail: string;
}
