import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

describe("sidebar AI Elements rendering", () => {
  it("renders reasoning, tool calls, and final response in order", () => {
    const source = readFileSync(
      resolve(packageRoot, "src/sidebar/SidebarApp.tsx"),
      "utf8"
    )

    expect(source).toContain("../components/ai-elements/reasoning")
    expect(source).toContain("../components/ai-elements/tool")
    expect(source).toContain("getAutoOpenSectionKey")
    expect(source).toContain("<Reasoning")
    expect(source).toContain("message.toolCalls?.map")
    expect(source).toContain("<ToolHeader")
    expect(source).toContain("open={isSectionOpen(reasoningSectionKey)}")
    expect(source).toContain("open={isSectionOpen(toolSectionKey)}")

    expect(source.indexOf("message.reasoning")).toBeLessThan(
      source.indexOf("message.toolCalls?.map")
    )
    expect(source.indexOf("message.toolCalls?.map")).toBeLessThan(
      source.indexOf("message.content ?")
    )
    expect(source).not.toContain("mail-agent-tool-item")
    expect(source).not.toContain("mail-agent-reasoning")
    expect(source).not.toContain("defaultOpen={tool.status !== \"done\"}")
  })

  it("keeps assistant messages from being styled as custom cards", () => {
    const css = readFileSync(
      resolve(packageRoot, "src/sidebar/sidebar.css"),
      "utf8"
    )
    const message = readFileSync(
      resolve(packageRoot, "src/ai-elements/message.tsx"),
      "utf8"
    )
    const tool = readFileSync(
      resolve(packageRoot, "src/components/ai-elements/tool.tsx"),
      "utf8"
    )
    const reasoning = readFileSync(
      resolve(packageRoot, "src/components/ai-elements/reasoning.tsx"),
      "utf8"
    )

    expect(css).toContain(".ai-message[data-from=\"assistant\"] .ai-message-content")
    expect(css).toContain("background: transparent")
    expect(css).toContain("border: 0")
    expect(css).toContain(".ai-tool-header")
    expect(css).toContain(".ai-reasoning-trigger")
    expect(css).toContain(".ai-code-block-pre code > span")
    expect(css).toContain("[data-streamdown=\"table-wrapper\"]")
    expect(css).toContain("justify-content: flex-end")
    expect(css).toContain("[data-streamdown=\"code-block-actions\"]")
    expect(css).toContain("td:last-child")
    expect(message).toContain("controls={false}")
    expect(message).toContain("lineNumbers={false}")
    expect(message).toContain("Streamdown")
    expect(message).toContain("streamdownPlugins")
    expect(tool).toContain("formatToolValue")
    expect(tool).toContain("ai-tool-header")
    expect(reasoning).toContain("const isControlled = open !== undefined")
    expect(reasoning).toContain("ai-reasoning-trigger")
    expect(css).not.toContain(".mail-agent-tool-item")
    expect(css).not.toContain(".mail-agent-reasoning")
    expect(css).not.toContain("[data-streamdown=\"table-wrapper\"] > div:first-child:not(:last-child) {\n  display: none")
  })
})
