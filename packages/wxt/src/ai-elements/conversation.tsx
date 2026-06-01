import { ScrollArea } from "@base-ui/react/scroll-area"
import { Button } from "@base-ui/react/button"
import { ChevronDown } from "lucide-react"
import {
  ComponentPropsWithoutRef,
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react"

import { cn } from "./utils"

type ConversationContextValue = {
  atBottom: boolean
  scrollToBottom: (behavior?: ScrollBehavior) => void
}

const ConversationContext =
  createContext<ConversationContextValue | null>(null)

type ConversationProps = Omit<
  ComponentPropsWithoutRef<typeof ScrollArea.Root>,
  "children" | "className"
> & {
  children: ReactNode
  className?: string
}

export function Conversation({
  children,
  className,
  ...props
}: ConversationProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [atBottom, setAtBottom] = useState(true)

  const updateScrollState = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const distanceFromBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    setAtBottom(distanceFromBottom < 24)
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const viewport = viewportRef.current
    if (!viewport) return

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior
    })
  }, [])

  const context = useMemo(
    () => ({
      atBottom,
      scrollToBottom
    }),
    [atBottom, scrollToBottom]
  )

  return (
    <ConversationContext.Provider value={context}>
      <ScrollArea.Root
        className={cn("ai-conversation", className)}
        {...props}
      >
        <ScrollArea.Viewport
          className="ai-conversation-viewport"
          onScroll={updateScrollState}
          ref={viewportRef}
        >
          <ScrollArea.Content className="ai-conversation-scroll">
            {children}
          </ScrollArea.Content>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar
          className="ai-conversation-scrollbar"
          orientation="vertical"
        >
          <ScrollArea.Thumb className="ai-conversation-thumb" />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>
    </ConversationContext.Provider>
  )
}

export function ConversationContent({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  const { scrollToBottom } = useConversation()

  useLayoutEffect(() => {
    scrollToBottom("smooth")
  }, [children, scrollToBottom])

  return (
    <div
      aria-live="polite"
      className={cn("ai-conversation-content", className)}
      role="log"
      {...props}
    >
      {children}
    </div>
  )
}

export function ConversationScrollButton({
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof Button>, "className"> & {
  className?: string
}) {
  const conversation = useConversation()

  if (conversation.atBottom) return null

  return (
    <Button
      aria-label="Scroll to latest message"
      className={cn("ai-conversation-scroll-button", className)}
      onClick={() => conversation.scrollToBottom()}
      type="button"
      {...props}
    >
      <ChevronDown aria-hidden size={16} strokeWidth={2.25} />
    </Button>
  )
}

function useConversation(): ConversationContextValue {
  const context = useContext(ConversationContext)
  if (!context) {
    throw new Error("Conversation components must be used within Conversation.")
  }
  return context
}
