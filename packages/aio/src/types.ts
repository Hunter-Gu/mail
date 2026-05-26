import {
  generateText,
  streamText,
  type LanguageModelUsage,
  type ModelMessage
} from "ai"

import type { TraceEvent } from "./generic-agent/trace-events"
import type { AgentTools } from "./tools"
import type { Trace } from "./trace"

export type Context = Record<string, unknown>

export interface IAgentBase<TContext extends Context = Context> {
  readonly name?: string

  readonly trace?: Trace<TraceEvent> | Trace<TraceEvent>[]

  readonly tools: AgentTools<TContext>

  maxIterations?: number

  getSystemInstruction(): string | Promise<string>

  /**
   * Optional prefix messages to inject before the first user turn.
   * Called once when the first `prompt()` is invoked on an empty history.
   * Use this to prepend context (e.g. user memory) without altering the
   * system prompt, so prompt caching remains stable across conversations.
   */
  getInitialMessages?(): ModelMessage[] | Promise<ModelMessage[]>

  /** When the max iteration limit is reached, ask the user whether to continue */
  askContinue?(): boolean | Promise<boolean>

  onText?(text: string): void
  onTextDelta?(delta: string, done: boolean): void

  onReasoning?(reasoning: string): void
  onReasoningDelta?(delta: string, done: boolean): void

  onToolCall?(name: string, args: Record<string, unknown>): void
  onToolResult?(name: string, result: string): void

  /** Optional callback for token usage emitted by the LLM backend. */
  onTokenUsage?(usage: LanguageModelUsage): void

  onError?(error: unknown): void
}

type ModelConfig<T = unknown> = Omit<T, "messages">

export interface IAgentStream<
  TContext extends Context = Context
> extends IAgentBase<TContext> {
  streaming: true

  getModelConfig(): ModelConfig<Parameters<typeof streamText>[0]>
}

export interface IAgent<
  TContext extends Context = Context
> extends IAgentBase<TContext> {
  streaming?: false

  getModelConfig(): ModelConfig<Parameters<typeof generateText>[0]>
}

export type Agent<TContext extends Context = Context> =
  | IAgent<TContext>
  | IAgentStream<TContext>

export type MessageContentPart = Exclude<
  ModelMessage["content"],
  string
>[number]
