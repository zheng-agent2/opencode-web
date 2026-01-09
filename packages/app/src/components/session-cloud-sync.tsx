import { createSignal, createResource, Show, For } from "solid-js"
import { useSDK } from "@/context/sdk"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Popover } from "@opencode-ai/ui/popover"
import { showToast } from "@opencode-ai/ui/toast"

interface CloudStatus {
  configured: boolean
  projectId: string | null
  lastSync: string | null
  changes: Array<{
    path: string
    status: "added" | "modified" | "deleted"
    localSize?: number
    remoteSize?: number
  }>
}

interface PushResult {
  success: boolean
  uploaded: number
  deleted: number
  errors: string[]
}

export function SessionCloudSync() {
  const sdk = useSDK()
  const [pushing, setPushing] = createSignal(false)
  const [pulling, setPulling] = createSignal(false)

  const fetchStatus = async (): Promise<CloudStatus> => {
    const response = await fetch(`${sdk.url}/cloud/status?directory=${encodeURIComponent(sdk.directory)}`)
    if (!response.ok) {
      throw new Error("Failed to fetch cloud status")
    }
    return response.json()
  }

  const [status, { refetch }] = createResource(fetchStatus, {
    initialValue: {
      configured: false,
      projectId: null,
      lastSync: null,
      changes: [],
    },
  })

  const handlePush = async () => {
    setPushing(true)
    try {
      const response = await fetch(`${sdk.url}/cloud/push?directory=${encodeURIComponent(sdk.directory)}`, {
        method: "POST",
      })
      const result: PushResult = await response.json()

      if (result.success) {
        showToast({
          title: "Cloud sync complete",
          description: `Uploaded ${result.uploaded} files, deleted ${result.deleted} files`,
        })
        refetch()
      } else {
        showToast({
          variant: "error",
          title: "Cloud sync failed",
          description: result.errors.join(", "),
        })
      }
    } catch (err) {
      showToast({
        variant: "error",
        title: "Cloud sync failed",
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setPushing(false)
    }
  }

  const handlePull = async () => {
    setPulling(true)
    try {
      const response = await fetch(`${sdk.url}/cloud/pull?directory=${encodeURIComponent(sdk.directory)}`, {
        method: "POST",
      })
      const result = await response.json()

      if (result.success) {
        showToast({
          title: "Cloud pull complete",
          description: `Downloaded ${result.fileCount} files`,
        })
        refetch()
      } else {
        showToast({
          variant: "error",
          title: "Cloud pull failed",
          description: result.error,
        })
      }
    } catch (err) {
      showToast({
        variant: "error",
        title: "Cloud pull failed",
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setPulling(false)
    }
  }

  const hasChanges = () => status()?.changes?.length > 0
  const changeCount = () => status()?.changes?.length ?? 0

  return (
    <Show when={status()?.configured}>
      <Popover
        title="Cloud Sync"
        trigger={
          <Tooltip value={hasChanges() ? `${changeCount()} changes to sync` : "Cloud sync"}>
            <Button variant="ghost" size="small" class="gap-1.5">
              <div class="relative">
                <Icon name="cloud" size="small" class="text-icon-weak" />
                <Show when={hasChanges()}>
                  <div class="absolute -top-1 -right-1 size-2 rounded-full bg-icon-warning-base" />
                </Show>
              </div>
              <Show when={hasChanges()}>
                <span class="text-12-regular text-text-weak">{changeCount()}</span>
              </Show>
            </Button>
          </Tooltip>
        }
      >
        <div class="w-72 flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <div class="text-12-regular text-text-weak">
              Project: <span class="text-text-base">{status()?.projectId}</span>
            </div>
          </div>

          <Show when={status()?.lastSync}>
            <div class="text-12-regular text-text-weak">
              Last sync: {new Date(status()!.lastSync!).toLocaleString()}
            </div>
          </Show>

          <Show
            when={hasChanges()}
            fallback={<div class="text-12-regular text-text-weak py-2">No changes to sync</div>}
          >
            <div class="max-h-40 overflow-y-auto border border-border-weak-base rounded">
              <For each={status()?.changes}>
                {(change) => (
                  <div class="flex items-center gap-2 px-2 py-1 text-12-regular border-b border-border-weak-base last:border-b-0">
                    <span
                      classList={{
                        "text-icon-success-base": change.status === "added",
                        "text-icon-warning-base": change.status === "modified",
                        "text-icon-critical-base": change.status === "deleted",
                      }}
                    >
                      {change.status === "added" ? "+" : change.status === "deleted" ? "-" : "~"}
                    </span>
                    <span class="text-text-base truncate">{change.path}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <div class="flex gap-2">
            <Button size="small" variant="secondary" onClick={handlePull} disabled={pulling()}>
              <Icon name={pulling() ? "loader" : "cloud-download"} size="small" />
              Pull
            </Button>
            <Button size="small" variant="primary" onClick={handlePush} disabled={pushing() || !hasChanges()}>
              <Icon name={pushing() ? "loader" : "cloud-upload"} size="small" />
              Push {hasChanges() ? `(${changeCount()})` : ""}
            </Button>
          </div>
        </div>
      </Popover>
    </Show>
  )
}

