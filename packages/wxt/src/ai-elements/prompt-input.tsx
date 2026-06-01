import { Button } from "@base-ui/react/button"
import { Field } from "@base-ui/react/field"
import { Tooltip } from "@base-ui/react/tooltip"
import { LoaderCircle, SendHorizontal } from "lucide-react"
import {
  ComponentPropsWithoutRef,
  FormEvent,
  ReactNode,
  forwardRef,
  useId
} from "react"

import { cn } from "./utils"

export type PromptInputMessage = {
  text: string
}

type PromptInputProps = Omit<
  ComponentPropsWithoutRef<"form">,
  "onSubmit"
> & {
  onSubmit?: (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>
  ) => void
}

export function PromptInput({
  children,
  className,
  onSubmit,
  ...props
}: PromptInputProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const text = String(formData.get("message") ?? "")
    onSubmit?.({ text }, event)
  }

  return (
    <form
      className={cn("ai-prompt-input", className)}
      onSubmit={submit}
      {...props}
    >
      {children}
    </form>
  )
}

type PromptInputTextareaProps = ComponentPropsWithoutRef<"textarea"> & {
  label?: string
}

export const PromptInputTextarea = forwardRef<
  HTMLTextAreaElement,
  PromptInputTextareaProps
>(function PromptInputTextarea(
  { className, disabled, id, label = "Message", name = "message", ...props },
  ref
) {
  const generatedId = useId()
  const textareaId = id ?? generatedId

  return (
    <Field.Root
      className="ai-prompt-input-field"
      disabled={disabled}
      name={name}
    >
      <Field.Label className="ai-sr-only" htmlFor={textareaId}>
        {label}
      </Field.Label>
      <textarea
        className={cn("ai-prompt-input-textarea", className)}
        disabled={disabled}
        id={textareaId}
        name={name}
        ref={ref}
        {...props}
      />
    </Field.Root>
  )
})

export function PromptInputFooter({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div className={cn("ai-prompt-input-footer", className)} {...props}>
      {children}
    </div>
  )
}

export function PromptInputTools({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div className={cn("ai-prompt-input-tools", className)} {...props}>
      {children}
    </div>
  )
}

type PromptInputButtonProps = Omit<
  ComponentPropsWithoutRef<typeof Button>,
  "className"
> & {
  className?: string
  tooltip?: ReactNode
  tooltipSide?: ComponentPropsWithoutRef<typeof Tooltip.Positioner>["side"]
}

export function PromptInputButton({
  children,
  className,
  tooltip,
  tooltipSide = "top",
  ...props
}: PromptInputButtonProps) {
  const button = (
    <Button className={cn("ai-prompt-input-button", className)} {...props}>
      {children}
    </Button>
  )

  if (!tooltip) return button

  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={button} />
      <Tooltip.Portal>
        <Tooltip.Positioner
          className="ai-tooltip-positioner"
          side={tooltipSide}
          sideOffset={8}
        >
          <Tooltip.Popup className="ai-tooltip-popup">
            {tooltip}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

type PromptInputSubmitProps = Omit<
  PromptInputButtonProps,
  "children" | "type"
> & {
  status?: "ready" | "submitted" | "streaming" | "error"
}

export function PromptInputSubmit({
  className,
  disabled,
  status = "ready",
  tooltip,
  ...props
}: PromptInputSubmitProps) {
  const busy = status === "submitted" || status === "streaming"

  return (
    <PromptInputButton
      aria-label={busy ? "Sending message" : "Send message"}
      className={cn("ai-prompt-input-submit", className)}
      disabled={disabled || busy}
      tooltip={tooltip ?? (busy ? "Working" : "Send")}
      type="submit"
      {...props}
    >
      {busy ? (
        <LoaderCircle
          aria-hidden
          className="ai-prompt-input-spinner"
          size={16}
          strokeWidth={2.25}
        />
      ) : (
        <SendHorizontal aria-hidden size={16} strokeWidth={2.25} />
      )}
    </PromptInputButton>
  )
}
