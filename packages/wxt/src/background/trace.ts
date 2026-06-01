import { Trace, TraceEvent } from "aio"
import { logToServer } from "log-server"

export const trace = new Trace<TraceEvent>({
  write(content) {
    console.log("[Trace]: " + content)
  }
})

export function getLogTrace(sessionId: string) {
  return new Trace<TraceEvent>({
    // batch: true,
    write(content) {
      logToServer(JSON.parse(content), {
        namespace: "mail-agent",
        sessionId
      })
    }
  })
}
