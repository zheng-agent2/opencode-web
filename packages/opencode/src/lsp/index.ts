import z from "zod"

// Minimal LSP stub for removed LSP functionality
export namespace LSP {
  export const Range = z.object({
    start: z.object({
      line: z.number(),
      character: z.number(),
    }),
    end: z.object({
      line: z.number(),
      character: z.number(),
    }),
  })
  export type Range = z.infer<typeof Range>
}

