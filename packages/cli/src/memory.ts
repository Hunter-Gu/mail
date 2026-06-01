import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
export const MEMORY_PATH = resolve(__dirname, "../data/memory.md")

export async function readMemory(): Promise<string> {
  if (!existsSync(MEMORY_PATH)) return ""
  return readFile(MEMORY_PATH, "utf-8")
}

export async function appendMemory(content: string): Promise<void> {
  await mkdir(dirname(MEMORY_PATH), { recursive: true })
  const existing = existsSync(MEMORY_PATH)
    ? await readFile(MEMORY_PATH, "utf-8")
    : ""
  await writeFile(
    MEMORY_PATH,
    existing ? `${existing}\n\n${content}` : content,
    "utf-8"
  )
}
