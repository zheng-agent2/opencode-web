import z from "zod"
import { NamedError } from "@opencode-ai/util/error"

// Minimal MCP stub for removed MCP functionality
export namespace MCP {
  export const Failed = NamedError.create("McpFailed", z.object({ message: z.string() }))

  export const Status = z.object({
    status: z.enum(["connected", "disconnected", "needs_auth", "needs_client_registration", "failed"]),
    error: z.string().optional(),
  })
  export type Status = z.infer<typeof Status>

  export const Resource = z.object({
    name: z.string(),
    uri: z.string(),
    description: z.string().optional(),
    mimeType: z.string().optional(),
    client: z.string(),
  })
  export type Resource = z.infer<typeof Resource>

  export async function status(): Promise<Record<string, Status>> {
    return {}
  }

  export async function add(name: string, config: any): Promise<Status> {
    throw new Error("MCP support removed")
  }

  export async function supportsOAuth(name: string): Promise<boolean> {
    return false
  }

  export async function startAuth(name: string): Promise<any> {
    throw new Error("MCP support removed")
  }

  export async function finishAuth(name: string, code: string): Promise<Status> {
    throw new Error("MCP support removed")
  }

  export async function authenticate(name: string): Promise<Status> {
    throw new Error("MCP support removed")
  }

  export async function removeAuth(name: string): Promise<void> {
    throw new Error("MCP support removed")
  }

  export async function connect(name: string): Promise<void> {
    throw new Error("MCP support removed")
  }

  export async function disconnect(name: string): Promise<void> {
    throw new Error("MCP support removed")
  }

  export async function resources(): Promise<Record<string, Resource>> {
    return {}
  }

  export async function tools(): Promise<Record<string, any>> {
    return {}
  }

  export async function prompts(): Promise<Record<string, any>> {
    return {}
  }

  export async function getPrompt(clientName: string, promptName: string, args?: any): Promise<any> {
    throw new Error("MCP support removed")
  }

  export async function readResource(clientName: string, uri: string): Promise<any> {
    throw new Error("MCP support removed")
  }
}
