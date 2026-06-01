import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import type { ContextModels } from "agent"

export function createModels(): ContextModels {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not set. Create a .env file.")
  }
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

  // const apiKey = process.env.GEMINI_API_KEY
  // if (!apiKey) {
  //   throw new Error("DEEPSEEK_API_KEY is not set. Create a .env file.")
  // }

  // const google = createGoogleGenerativeAI({
  //   apiKey
  // })
  // const MODEL_ID = "gemini-3-flash-preview"
  // return {
  //   main: google(MODEL_ID),
  //   search: google(MODEL_ID),
  //   summary: google(MODEL_ID)
  // }
}
