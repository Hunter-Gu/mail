import { describe, expect, it } from "vitest"

import { createLimitRounds } from "../limit-rounds"

describe("createLimitRounds", () => {
  it("tracks iteration limits", () => {
    const limit = createLimitRounds(2)

    expect(limit.done()).toBe(false)

    limit.next()
    expect(limit.done()).toBe(false)

    limit.next()
    expect(limit.done()).toBe(true)

    limit.reset()
    expect(limit.done()).toBe(false)
  })
})
