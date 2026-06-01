import { ComponentPropsWithoutRef } from "react"
import { cjk } from "@streamdown/cjk"
import { code } from "@streamdown/code"
import { math } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"
import { Streamdown } from "streamdown"

import { cn } from "./utils"

export type MessageFrom = "user" | "assistant"

type MessageProps = ComponentPropsWithoutRef<"article"> & {
  from: MessageFrom
}

export function Message({
  children,
  className,
  from,
  ...props
}: MessageProps) {
  return (
    <article
      className={cn("ai-message", className)}
      data-from={from}
      {...props}
    >
      {children}
    </article>
  )
}

export function MessageContent({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div className={cn("ai-message-content", className)} {...props}>
      {children}
    </div>
  )
}

export function MessageResponse({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div className={cn("ai-message-response", className)} {...props}>
      {typeof children === "string" ? (
        <Streamdown
          controls={false}
          lineNumbers={false}
          plugins={streamdownPlugins}
        >
          {children}
        </Streamdown>
      ) : (
        children
      )}
    </div>
  )
}

const streamdownPlugins = { cjk, code, math, mermaid }
