export class MaxIterationsError extends Error {
  constructor(readonly maxIterations: number) {
    super(
      `Agent reached max iterations (${maxIterations}) without producing a final response.`
    )
    this.name = "MaxIterationsError"
  }
}
