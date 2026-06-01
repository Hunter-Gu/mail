import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import type { ContextModels } from "agent"

export function getModels(): ContextModels {
  let apiKey = import.meta.env.WXT_GEMINI_API_KEY

  if (apiKey) {
    const google = createGoogleGenerativeAI({
      apiKey
    })
    const MODEL_ID = "gemini-3-flash-preview"
    return {
      main: google(MODEL_ID),
      search: google(MODEL_ID),
      summary: google(MODEL_ID)
    }
  }

  apiKey = import.meta.env.WXT_DEEPSEEK_API_KEY
  if (apiKey) {
    const deepseek = createAnthropic({
      apiKey,
      baseURL: "https://api.deepseek.com/anthropic",
      name: "deepseek.anthropic"
    })

    const MODEL_ID = "deepseek-v4-flash"
    return {
      main: deepseek(MODEL_ID),
      search: deepseek(MODEL_ID),
      summary: deepseek(MODEL_ID)
    }
  }

  throw new Error("No API key found!")
}
