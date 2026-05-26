export type MaybePromise<T> = T | Promise<T>

export interface TraceWriter {
  readonly batch?: boolean

  write(content: string): MaybePromise<void>
}
