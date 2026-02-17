import type { StructuredToolInterface } from '@langchain/core/tools';
import type { BotConfig, BinanceConfig } from '../config.js';
import type { AgentConfig, AgentEvent } from '../../dexter/src/agent/types.js';

// Reuse Dexter's internal modules — import directly, don't modify
import { callLlm } from '../../dexter/src/model/llm.js';
import { extractTextContent, hasToolCalls } from '../../dexter/src/utils/ai-message.js';
import { InMemoryChatHistory } from '../../dexter/src/utils/in-memory-chat-history.js';
import { estimateTokens, CONTEXT_THRESHOLD, KEEP_TOOL_USES } from '../../dexter/src/utils/tokens.js';
import { AgentToolExecutor } from '../../dexter/src/agent/tool-executor.js';
import { createRunContext, type RunContext } from '../../dexter/src/agent/run-context.js';
import { buildFinalAnswerContext } from '../../dexter/src/agent/final-answer-context.js';
import { buildIterationPrompt, buildFinalAnswerPrompt } from '../../dexter/src/agent/prompts.js';
import type { ContextClearedEvent, DoneEvent, TokenUsage } from '../../dexter/src/agent/types.js';

// Our custom modules
import { getTradingTools } from '../tools/registry.js';
import { buildTradingSystemPrompt } from './trading-prompts.js';

const DEFAULT_MAX_ITERATIONS = 10;

/**
 * Trading agent — wraps Dexter's agent loop with our custom tools and prompts.
 *
 * This class mirrors Dexter's Agent architecture but uses:
 * - Our merged tool registry (Dexter tools + Binance/signals/portfolio tools)
 * - Our trading-specific system prompt
 * - The same iterative tool-calling loop, scratchpad, and context management
 *
 * We don't subclass Dexter's Agent because its constructor is private.
 * Instead we replicate the loop using Dexter's exported building blocks.
 */
export class TradingAgent {
  private readonly model: string;
  private readonly maxIterations: number;
  private readonly tools: StructuredToolInterface[];
  private readonly toolMap: Map<string, StructuredToolInterface>;
  private readonly toolExecutor: AgentToolExecutor;
  private readonly systemPrompt: string;
  private readonly signal?: AbortSignal;

  private constructor(
    config: AgentConfig,
    tools: StructuredToolInterface[],
    systemPrompt: string
  ) {
    this.model = config.model ?? 'openrouter:qwen/qwen3-235b-a22b';
    this.maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.tools = tools;
    this.toolMap = new Map(tools.map((t) => [t.name, t]));
    this.toolExecutor = new AgentToolExecutor(this.toolMap, config.signal);
    this.systemPrompt = systemPrompt;
    this.signal = config.signal;
  }

  /**
   * Create a TradingAgent with merged tools and trading prompts.
   */
  static create(
    agentConfig: AgentConfig,
    botConfig: BotConfig,
    binanceConfig: BinanceConfig | null
  ): TradingAgent {
    const model = agentConfig.model ?? botConfig.model;
    const tools = getTradingTools(model, botConfig, binanceConfig);
    const systemPrompt = buildTradingSystemPrompt(model, botConfig, binanceConfig);
    return new TradingAgent({ ...agentConfig, model }, tools, systemPrompt);
  }

  /**
   * Run the agent loop — identical to Dexter's Agent.run() but using our tools/prompt.
   * Yields typed events for real-time UI updates.
   */
  async *run(query: string, inMemoryHistory?: InMemoryChatHistory): AsyncGenerator<AgentEvent> {
    const startTime = Date.now();

    if (this.tools.length === 0) {
      yield {
        type: 'done',
        answer: 'No tools available. Please check your API key configuration.',
        toolCalls: [],
        iterations: 0,
        totalTime: Date.now() - startTime,
      };
      return;
    }

    const ctx = createRunContext(query);
    let currentPrompt = this.buildInitialPrompt(query, inMemoryHistory);

    // Main agent loop
    while (ctx.iteration < this.maxIterations) {
      ctx.iteration++;

      const { response, usage } = await callLlm(currentPrompt, {
        model: this.model,
        systemPrompt: this.systemPrompt,
        tools: this.tools,
        signal: this.signal,
      });
      ctx.tokenCounter.add(usage);
      const responseText =
        typeof response === 'string' ? response : extractTextContent(response);

      // Emit thinking if there are also tool calls
      if (
        responseText?.trim() &&
        typeof response !== 'string' &&
        hasToolCalls(response)
      ) {
        const trimmedText = responseText.trim();
        ctx.scratchpad.addThinking(trimmedText);
        yield { type: 'thinking', message: trimmedText };
      }

      // No tool calls = ready for final answer
      if (typeof response === 'string' || !hasToolCalls(response)) {
        if (!ctx.scratchpad.hasToolResults() && responseText) {
          yield* this.handleDirectResponse(responseText, ctx);
          return;
        }
        yield* this.generateFinalAnswer(ctx);
        return;
      }

      // Execute tools and manage context
      yield* this.toolExecutor.executeAll(response, ctx);
      yield* this.manageContextThreshold(ctx);

      // Build next iteration prompt
      currentPrompt = buildIterationPrompt(
        query,
        ctx.scratchpad.getToolResults(),
        ctx.scratchpad.formatToolUsageForPrompt()
      );
    }

    // Max iterations reached
    yield* this.generateFinalAnswer(ctx, {
      fallbackMessage: `Reached maximum iterations (${this.maxIterations}).`,
    });
  }

  private async *handleDirectResponse(
    responseText: string,
    ctx: RunContext
  ): AsyncGenerator<AgentEvent, void> {
    yield { type: 'answer_start' };
    const totalTime = Date.now() - ctx.startTime;
    yield {
      type: 'done',
      answer: responseText,
      toolCalls: [],
      iterations: ctx.iteration,
      totalTime,
      tokenUsage: ctx.tokenCounter.getUsage(),
      tokensPerSecond: ctx.tokenCounter.getTokensPerSecond(totalTime),
    };
  }

  private async *generateFinalAnswer(
    ctx: RunContext,
    options?: { fallbackMessage?: string }
  ): AsyncGenerator<AgentEvent, void> {
    const fullContext = buildFinalAnswerContext(ctx.scratchpad);
    const finalPrompt = buildFinalAnswerPrompt(ctx.query, fullContext);

    yield { type: 'answer_start' };
    const { response, usage } = await callLlm(finalPrompt, {
      model: this.model,
      systemPrompt: this.systemPrompt,
      signal: this.signal,
    });
    ctx.tokenCounter.add(usage);
    const answer =
      typeof response === 'string' ? response : extractTextContent(response);

    const totalTime = Date.now() - ctx.startTime;
    yield {
      type: 'done',
      answer: options?.fallbackMessage ? answer || options.fallbackMessage : answer,
      toolCalls: ctx.scratchpad.getToolCallRecords(),
      iterations: ctx.iteration,
      totalTime,
      tokenUsage: ctx.tokenCounter.getUsage(),
      tokensPerSecond: ctx.tokenCounter.getTokensPerSecond(totalTime),
    } as DoneEvent;
  }

  private *manageContextThreshold(
    ctx: RunContext
  ): Generator<ContextClearedEvent, void> {
    const fullToolResults = ctx.scratchpad.getToolResults();
    const estimatedContextTokens = estimateTokens(
      this.systemPrompt + ctx.query + fullToolResults
    );

    if (estimatedContextTokens > CONTEXT_THRESHOLD) {
      const clearedCount = ctx.scratchpad.clearOldestToolResults(KEEP_TOOL_USES);
      if (clearedCount > 0) {
        yield {
          type: 'context_cleared',
          clearedCount,
          keptCount: KEEP_TOOL_USES,
        };
      }
    }
  }

  private buildInitialPrompt(
    query: string,
    inMemoryChatHistory?: InMemoryChatHistory
  ): string {
    if (!inMemoryChatHistory?.hasMessages()) {
      return query;
    }

    const userMessages = inMemoryChatHistory.getUserMessages();
    if (userMessages.length === 0) {
      return query;
    }

    const historyContext = userMessages
      .map((msg, i) => `${i + 1}. ${msg}`)
      .join('\n');
    return `Current query to answer: ${query}\n\nPrevious user queries for context:\n${historyContext}`;
  }
}
