/**
 * Multi-LLM Router and Synthesizer
 *
 * Operates at three levels:
 *   Level 1 (Route): Send to single best model for the task
 *   Level 2 (Verify): Send to N models, judge picks best
 *   Level 3 (Synthesize): Send to N models, extract best elements, fuse
 *
 * Level 3 is the novel component: not "pick the best answer" but
 * "extract the unique contribution of each answer and fuse them."
 */

import { randomUUID } from "node:crypto";
import type {
  CrossModelComparison,
  ExtractedElements,
  ModelCapabilities,
  ModelOutput,
  ModelProfile,
  RoutingStrategy,
  SynthesizedOutput,
  TaskAnalysis,
  TaskComplexity,
  TaskDomain,
  TaskStakes,
} from "../types.js";

// ─── LLM Budget ──────────────────────────────────────────────────

export interface LLMBudget {
  maxConcurrentModels: number;
  maxTokensPerSynthesis: number;
  maxCostPerTask: number;
  fallbackOnBudgetExhaust: string;
}

export const DEFAULT_LLM_BUDGET: LLMBudget = {
  maxConcurrentModels: 3,
  maxTokensPerSynthesis: 50_000,
  maxCostPerTask: 0.5, // $0.50
  fallbackOnBudgetExhaust: "anthropic/claude-sonnet",
};

// ─── Model Adapter Interface ─────────────────────────────────────

/**
 * Adapter for calling LLMs. Implementations provided by consumers.
 */
export interface ModelAdapter {
  call(
    modelId: string,
    prompt: string,
    options?: { maxTokens?: number; temperature?: number },
  ): Promise<ModelOutput>;
}

// ─── Multi-LLM Router ───────────────────────────────────────────

export class MultiLLMRouter {
  private models: Map<string, ModelProfile> = new Map();

  constructor(
    private adapter: ModelAdapter,
    private budget: LLMBudget = DEFAULT_LLM_BUDGET,
  ) {}

  // ─── Model Registration ────────────────────────────────────

  registerModel(profile: ModelProfile): void {
    this.models.set(profile.id, profile);
  }

  getModel(id: string): ModelProfile | undefined {
    return this.models.get(id);
  }

  getRegisteredModels(): ModelProfile[] {
    return Array.from(this.models.values());
  }

  // ─── Task Analysis ─────────────────────────────────────────

  analyzeTask(description: string): TaskAnalysis {
    const domain = detectDomain(description);
    const complexity = detectComplexity(description);
    const stakes = detectStakes(description);

    return {
      primaryDomain: domain,
      complexity,
      stakes,
      latencyBudgetMs: stakes === "high" ? 30_000 : 10_000,
      tokenBudget: complexity === "complex" ? 8_000 : 2_000,
    };
  }

  // ─── Strategy Selection ────────────────────────────────────

  selectStrategy(analysis: TaskAnalysis): RoutingStrategy {
    if (analysis.stakes === "low" && analysis.complexity === "simple") {
      return "route";
    }
    if (analysis.stakes === "medium") {
      return "route"; // route to best model for domain
    }
    if (analysis.stakes === "high" && analysis.complexity !== "complex") {
      return "verify";
    }
    // high stakes + complex
    return "synthesize";
  }

  // ─── Level 1: Route (single best model) ────────────────────

  selectBestModel(analysis: TaskAnalysis): string {
    const profiles = Array.from(this.models.values());
    if (profiles.length === 0) {
      return this.budget.fallbackOnBudgetExhaust;
    }

    // Score each model for this task domain
    const scored = profiles.map((p) => ({
      id: p.id,
      score: scoreModelForDomain(p.capabilities, analysis.primaryDomain),
      cost: p.costPer1kTokens.output,
      latency: p.latencyP50Ms,
    }));

    // Filter by budget
    const withinBudget = scored.filter(
      (s) => (s.cost * analysis.tokenBudget) / 1000 <= this.budget.maxCostPerTask,
    );

    if (withinBudget.length === 0) {
      return this.budget.fallbackOnBudgetExhaust;
    }

    // Sort by score (descending), then cost (ascending)
    withinBudget.sort((a, b) => b.score - a.score || a.cost - b.cost);
    return withinBudget[0]!.id;
  }

  async route(prompt: string, analysis: TaskAnalysis): Promise<ModelOutput> {
    const modelId = this.selectBestModel(analysis);
    return this.adapter.call(modelId, prompt, {
      maxTokens: analysis.tokenBudget,
    });
  }

  // ─── Level 2: Verify (N models, judge picks best) ──────────

  async verify(
    prompt: string,
    analysis: TaskAnalysis,
    modelIds?: string[],
  ): Promise<VerifiedOutput> {
    const models =
      modelIds ?? this.selectTopModels(analysis, Math.min(2, this.budget.maxConcurrentModels));

    // Guard: with no registered models there is nothing to verify against.
    // Degrade gracefully to a single routed call rather than returning empty.
    if (models.length === 0) {
      const output = await this.route(prompt, analysis);
      return {
        chosen: output,
        chosenModelId: output.modelId,
        allOutputs: new Map([[output.modelId, output]]),
        scores: new Map([[output.modelId, scoreOutput(output)]]),
      };
    }

    // Execute in parallel
    const outputs = await Promise.all(
      models.map((id) =>
        this.adapter.call(id, prompt, {
          maxTokens: analysis.tokenBudget,
        }),
      ),
    );

    // Judge: pick the best output
    // In production, this would use a separate judge LLM
    // For now, use heuristic scoring
    const scored = outputs.map((output, i) => ({
      output,
      modelId: models[i]!,
      score: scoreOutput(output),
    }));

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0]!;

    return {
      chosen: best.output,
      chosenModelId: best.modelId,
      allOutputs: new Map(outputs.map((o, i) => [models[i]!, o])),
      scores: new Map(scored.map((s) => [s.modelId, s.score])),
    };
  }

  // ─── Level 3: Synthesize (extract + fuse) ──────────────────

  /**
   * The synthesis protocol:
   * 1. Parallel execution across models
   * 2. Element extraction from each output
   * 3. Cross-model comparison (agreements, disagreements, unique)
   * 4. Fusion (merge agreements, resolve disagreements, incorporate unique)
   * 5. Coherence pass
   */
  async synthesize(
    prompt: string,
    analysis: TaskAnalysis,
    modelIds?: string[],
  ): Promise<SynthesizedOutput> {
    const models = modelIds ?? this.selectTopModels(analysis, this.budget.maxConcurrentModels);

    // Guard: synthesis needs at least one model. With none registered, fall
    // back to a single routed call wrapped as a synthesized result so callers
    // always receive usable content instead of an empty string.
    if (models.length === 0) {
      const output = await this.route(prompt, analysis);
      return {
        content: output.content,
        sourceModels: [output.modelId],
        elementSources: new Map(),
        confidence: 0.5,
        synthesisTrace: JSON.stringify({ models: [output.modelId], fallback: "no_models" }),
      };
    }

    // Step 1: Parallel execution
    const outputs = await Promise.all(
      models.map((id) =>
        this.adapter.call(id, prompt, {
          maxTokens: analysis.tokenBudget,
        }),
      ),
    );

    const outputMap = new Map<string, ModelOutput>();
    for (let i = 0; i < models.length; i++) {
      outputMap.set(models[i]!, outputs[i]!);
    }

    // Step 2: Element extraction
    const elements = new Map<string, ExtractedElements>();
    for (const [modelId, output] of outputMap) {
      elements.set(modelId, extractElements(output.content));
    }

    // Step 3: Cross-model comparison
    const comparison = compareAcrossModels(elements);

    // Step 4: Fusion
    const fused = fuseOutputs(comparison, elements);

    // Step 5: Coherence (in production, run through an LLM to smooth)
    // For now, the fused output is the final output

    return {
      content: fused,
      sourceModels: models,
      elementSources: buildElementSourceMap(comparison),
      confidence: computeSynthesisConfidence(comparison),
      synthesisTrace: JSON.stringify({
        models,
        agreementCount: comparison.agreements.length,
        disagreementCount: comparison.disagreements.length,
        uniqueCount: comparison.uniqueContributions.length,
      }),
    };
  }

  // ─── Unified Execute ───────────────────────────────────────

  /**
   * Analyze the task, select strategy, and execute.
   */
  async execute(
    prompt: string,
    descriptionOrAnalysis?: string | TaskAnalysis,
  ): Promise<ExecutionResult> {
    const analysis =
      typeof descriptionOrAnalysis === "string"
        ? this.analyzeTask(descriptionOrAnalysis)
        : (descriptionOrAnalysis ?? this.analyzeTask(prompt));

    const strategy = this.selectStrategy(analysis);

    switch (strategy) {
      case "route": {
        const output = await this.route(prompt, analysis);
        return { strategy, output: output.content, modelIds: [output.modelId] };
      }
      case "verify": {
        const result = await this.verify(prompt, analysis);
        return {
          strategy,
          output: result.chosen.content,
          modelIds: Array.from(result.allOutputs.keys()),
        };
      }
      case "synthesize": {
        const result = await this.synthesize(prompt, analysis);
        return {
          strategy,
          output: result.content,
          modelIds: result.sourceModels,
        };
      }
    }
  }

  // ─── Helpers ───────────────────────────────────────────────

  private selectTopModels(analysis: TaskAnalysis, count: number): string[] {
    const profiles = Array.from(this.models.values());
    const scored = profiles
      .map((p) => ({
        id: p.id,
        score: scoreModelForDomain(p.capabilities, analysis.primaryDomain),
      }))
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, count).map((s) => s.id);
  }
}

// ─── Result Types ────────────────────────────────────────────────

export interface VerifiedOutput {
  chosen: ModelOutput;
  chosenModelId: string;
  allOutputs: Map<string, ModelOutput>;
  scores: Map<string, number>;
}

export interface ExecutionResult {
  strategy: RoutingStrategy;
  output: string;
  modelIds: string[];
}

// ─── Domain Detection (heuristic) ────────────────────────────────

const DOMAIN_KEYWORDS: Record<TaskDomain, string[]> = {
  reasoning: ["analyze", "compare", "evaluate", "reason", "logic", "argument", "tradeoff"],
  coding: ["code", "function", "bug", "implement", "refactor", "test", "debug", "program"],
  creative: ["write", "story", "creative", "poem", "imagine", "design", "brand"],
  factual: ["what is", "who is", "when did", "fact", "date", "statistic", "define"],
  instruction: ["how to", "steps", "guide", "tutorial", "explain how", "process"],
  multimodal: ["image", "picture", "video", "audio", "visual", "diagram"],
  translation: ["translate", "language", "convert to", "in spanish", "in french"],
};

function detectDomain(text: string): TaskDomain {
  const lower = text.toLowerCase();
  let bestDomain: TaskDomain = "reasoning";
  let bestScore = 0;

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS) as [TaskDomain, string[]][]) {
    const score = keywords.filter((kw) => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestDomain = domain;
    }
  }

  return bestDomain;
}

function detectComplexity(text: string): TaskComplexity {
  const words = text.split(/\s+/).length;
  if (words < 20) return "simple";
  if (words < 100) return "moderate";
  return "complex";
}

function detectStakes(text: string): TaskStakes {
  const lower = text.toLowerCase();
  const highStakesKeywords = [
    "critical",
    "production",
    "security",
    "legal",
    "medical",
    "financial",
    "safety",
  ];
  const mediumStakesKeywords = ["important", "review", "verify", "accurate", "reliable"];

  if (highStakesKeywords.some((kw) => lower.includes(kw))) return "high";
  if (mediumStakesKeywords.some((kw) => lower.includes(kw))) return "medium";
  return "low";
}

// ─── Model Scoring ───────────────────────────────────────────────

function scoreModelForDomain(caps: ModelCapabilities, domain: TaskDomain): number {
  switch (domain) {
    case "reasoning":
      return caps.reasoning * 0.6 + caps.factualAccuracy * 0.3 + caps.safety * 0.1;
    case "coding":
      return caps.coding * 0.7 + caps.reasoning * 0.2 + caps.instruction * 0.1;
    case "creative":
      return caps.creativity * 0.6 + caps.instruction * 0.3 + caps.safety * 0.1;
    case "factual":
      return caps.factualAccuracy * 0.7 + caps.reasoning * 0.2 + caps.safety * 0.1;
    case "instruction":
      return caps.instruction * 0.6 + caps.reasoning * 0.3 + caps.safety * 0.1;
    case "multimodal":
      return caps.multimodal ? 0.8 : 0.1;
    case "translation":
      return caps.instruction * 0.5 + caps.creativity * 0.3 + caps.factualAccuracy * 0.2;
  }
}

function scoreOutput(output: ModelOutput): number {
  // Simple heuristic: longer, more structured outputs tend to be better
  const lengthScore = Math.min(output.content.length / 2000, 1);
  const structureScore = (output.content.match(/\n/g)?.length ?? 0) / 20;
  return Math.min(1, lengthScore * 0.6 + structureScore * 0.4);
}

// ─── Element Extraction ──────────────────────────────────────────

function extractElements(content: string): ExtractedElements {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);

  // Extract claims (sentences that assert something)
  const claims = lines
    .filter((l) => l.match(/^[A-Z]/) && l.includes("."))
    .map((l) => ({
      text: l.trim(),
      confidence: 0.7,
    }));

  // Extract code blocks
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  const codeBlocks: ExtractedElements["codeBlocks"] = [];
  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    codeBlocks.push({
      code: match[2] ?? "",
      language: match[1] ?? "text",
    });
  }

  // Extract caveats (lines with hedge words)
  const caveats = lines
    .filter((l) => /\b(however|but|note|caveat|warning|limitation|although|though)\b/i.test(l))
    .map((l) => l.trim());

  // Reasoning steps (numbered or bulleted items)
  const reasoningSteps = lines
    .filter((l) => /^\s*(\d+[\.\)]|-|\*)\s/.test(l))
    .map((l) => ({ step: l.trim(), valid: true }));

  // Unique insights (heuristic: longer sentences with specific details)
  const uniqueInsights = lines
    .filter((l) => l.length > 100 && !caveats.includes(l.trim()))
    .map((l) => l.trim());

  return { claims, reasoningSteps, codeBlocks, caveats, uniqueInsights };
}

// ─── Cross-Model Comparison ──────────────────────────────────────

function compareAcrossModels(elements: Map<string, ExtractedElements>): CrossModelComparison {
  const allClaims = new Map<string, string[]>();
  const allInsights = new Map<string, { modelId: string; contribution: string }[]>();

  // Collect claims across models
  for (const [modelId, elems] of elements) {
    for (const claim of elems.claims) {
      const key = normalizeForComparison(claim.text);
      if (!allClaims.has(key)) allClaims.set(key, []);
      allClaims.get(key)!.push(modelId);
    }

    for (const insight of elems.uniqueInsights) {
      const key = normalizeForComparison(insight);
      if (!allInsights.has(key)) allInsights.set(key, []);
      allInsights.get(key)!.push({ modelId, contribution: insight });
    }
  }

  // Agreements: claims supported by 2+ models
  const agreements: CrossModelComparison["agreements"] = [];
  const disagreements: CrossModelComparison["disagreements"] = [];

  for (const [claim, models] of allClaims) {
    if (models.length >= 2) {
      agreements.push({
        claim,
        supportedBy: models,
        confidence: Math.min(1, models.length / elements.size),
      });
    }
  }

  // Unique contributions: insights from only one model
  const uniqueContributions: CrossModelComparison["uniqueContributions"] = [];
  for (const [, entries] of allInsights) {
    if (entries.length === 1) {
      const entry = entries[0]!;
      uniqueContributions.push({
        modelId: entry.modelId,
        contribution: entry.contribution,
        value: 0.5, // default value; in production, judge would score this
      });
    }
  }

  return { agreements, disagreements, uniqueContributions };
}

function normalizeForComparison(text: string): string {
  // Normalize the FULL text. A previous version truncated to 200 chars, which
  // made two long but distinct claims sharing a prefix collapse into one key —
  // producing false "agreements" between models that actually disagreed.
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Fusion ──────────────────────────────────────────────────────

function fuseOutputs(
  comparison: CrossModelComparison,
  elements: Map<string, ExtractedElements>,
): string {
  const sections: string[] = [];

  // Start with agreed-upon claims (highest confidence)
  if (comparison.agreements.length > 0) {
    const agreedClaims = comparison.agreements
      .sort((a, b) => b.confidence - a.confidence)
      .map((a) => a.claim);
    sections.push(agreedClaims.join("\n\n"));
  }

  // Add code blocks from the model with the most code
  const allCode: { modelId: string; blocks: ExtractedElements["codeBlocks"] }[] = [];
  for (const [modelId, elems] of elements) {
    if (elems.codeBlocks.length > 0) {
      allCode.push({ modelId, blocks: elems.codeBlocks });
    }
  }
  if (allCode.length > 0) {
    // Use the model with the most complete code
    allCode.sort((a, b) => {
      const aLen = a.blocks.reduce((s, b) => s + b.code.length, 0);
      const bLen = b.blocks.reduce((s, b) => s + b.code.length, 0);
      return bLen - aLen;
    });
    for (const block of allCode[0]!.blocks) {
      sections.push(`\`\`\`${block.language}\n${block.code}\n\`\`\``);
    }
  }

  // Add unique contributions (things only one model saw)
  if (comparison.uniqueContributions.length > 0) {
    const unique = comparison.uniqueContributions
      .sort((a, b) => b.value - a.value)
      .slice(0, 3) // top 3 unique insights
      .map((u) => u.contribution);
    sections.push(unique.join("\n\n"));
  }

  // Add caveats from all models (union)
  const allCaveats = new Set<string>();
  for (const [, elems] of elements) {
    for (const caveat of elems.caveats) {
      allCaveats.add(caveat);
    }
  }
  if (allCaveats.size > 0) {
    sections.push(Array.from(allCaveats).join("\n"));
  }

  return sections.join("\n\n---\n\n");
}

function buildElementSourceMap(comparison: CrossModelComparison): Map<string, string> {
  const map = new Map<string, string>();
  for (const agreement of comparison.agreements) {
    map.set(agreement.claim, agreement.supportedBy.join(","));
  }
  for (const unique of comparison.uniqueContributions) {
    map.set(unique.contribution, unique.modelId);
  }
  return map;
}

function computeSynthesisConfidence(comparison: CrossModelComparison): number {
  const totalElements =
    comparison.agreements.length +
    comparison.disagreements.length +
    comparison.uniqueContributions.length;

  if (totalElements === 0) return 0.5;

  // Confidence is higher when there's more agreement
  const agreementRatio = comparison.agreements.length / totalElements;
  return Math.min(1, agreementRatio * 0.8 + 0.2);
}
