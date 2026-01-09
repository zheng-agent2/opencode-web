import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { List } from "@opencode-ai/ui/list"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { createMemo } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"

interface DialogSelectDirectoryProps {
  title?: string
  multiple?: boolean
  onSelect: (result: string | string[] | null) => void
}

export function DialogSelectDirectory(props: DialogSelectDirectoryProps) {
  const sync = useGlobalSync()
  const sdk = useGlobalSDK()
  const dialog = useDialog()

  const home = createMemo(() => sync.data.path.home)
  const root = createMemo(() => sync.data.path.home || sync.data.path.directory)

  function join(base: string | undefined, rel: string) {
    const b = (base ?? "").replace(/[\\/]+$/, "")
    const r = rel.replace(/^[\\/]+/, "").replace(/[\\/]+$/, "")
    if (!b) return r
    if (!r) return b
    return b + "/" + r
  }

  function display(rel: string) {
    const full = join(root(), rel)
    const h = home()
    if (!h) return full
    if (full === h) return "~"
    if (full.startsWith(h + "/") || full.startsWith(h + "\\")) {
      return "~" + full.slice(h.length)
    }
    return full
  }

  function normalizeQuery(query: string) {
    const h = home()

    if (!query) return query
    if (query.startsWith("~/")) return query.slice(2)

    if (h) {
      const lc = query.toLowerCase()
      const hc = h.toLowerCase()
      if (lc === hc || lc.startsWith(hc + "/") || lc.startsWith(hc + "\\")) {
        return query.slice(h.length).replace(/^[\\/]+/, "")
      }
    }

    return query
  }

  async function fetchDirs(query: string) {
    const directory = root()
    // #region agent log
    const debugData2 = {
      directory,
      query,
      home: home(),
      sdkUrl: sdk.url,
      syncHome: sync.data.path.home,
      syncDir: sync.data.path.directory,
    }
    console.log("[DEBUG] fetchDirs called", debugData2)
    fetch("http://127.0.0.1:7246/ingest/3f780156-45fe-4e83-a393-57f8a6744add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: "dialog-select-directory.tsx:fetchDirs",
        message: "fetchDirs called",
        data: debugData2,
        timestamp: Date.now(),
        sessionId: "debug-session",
        hypothesisId: "B,C,D",
      }),
    }).catch(() => {})
    // #endregion
    if (!directory) return [] as string[]

    const results = await sdk.client.find
      .files({ directory, query, type: "directory", limit: 50 })
      .then((x) => {
        // #region agent log
        console.log("[DEBUG] fetchDirs success", { resultCount: x.data?.length ?? 0, firstResult: x.data?.[0] })
        fetch("http://127.0.0.1:7246/ingest/3f780156-45fe-4e83-a393-57f8a6744add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            location: "dialog-select-directory.tsx:fetchDirs",
            message: "fetchDirs success",
            data: { resultCount: x.data?.length ?? 0, firstResult: x.data?.[0] },
            timestamp: Date.now(),
            sessionId: "debug-session",
            hypothesisId: "E",
          }),
        }).catch(() => {})
        // #endregion
        return x.data ?? []
      })
      .catch((e) => {
        // #region agent log
        console.log("[DEBUG] fetchDirs error", { error: e?.message })
        fetch("http://127.0.0.1:7246/ingest/3f780156-45fe-4e83-a393-57f8a6744add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            location: "dialog-select-directory.tsx:fetchDirs",
            message: "fetchDirs error",
            data: { error: e?.message },
            timestamp: Date.now(),
            sessionId: "debug-session",
            hypothesisId: "E",
          }),
        }).catch(() => {})
        // #endregion
        return []
      })

    return results.map((x) => x.replace(/[\\/]+$/, ""))
  }

  const directories = async (filter: string) => {
    const query = normalizeQuery(filter.trim())
    return fetchDirs(query)
  }

  function resolve(rel: string) {
    const absolute = join(root(), rel)
    props.onSelect(props.multiple ? [absolute] : absolute)
    dialog.close()
  }

  return (
    <Dialog title={props.title ?? "Open project"}>
      <List
        search={{ placeholder: "Search folders", autofocus: true }}
        emptyMessage="No folders found"
        items={directories}
        key={(x) => x}
        onSelect={(path) => {
          if (!path) return
          resolve(path)
        }}
      >
        {(rel) => {
          const path = display(rel)
          return (
            <div class="w-full flex items-center justify-between rounded-md">
              <div class="flex items-center gap-x-3 grow min-w-0">
                <FileIcon node={{ path: rel, type: "directory" }} class="shrink-0 size-4" />
                <div class="flex items-center text-14-regular min-w-0">
                  <span class="text-text-weak whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                    {getDirectory(path)}
                  </span>
                  <span class="text-text-strong whitespace-nowrap">{getFilename(path)}</span>
                </div>
              </div>
            </div>
          )
        }}
      </List>
    </Dialog>
  )
}
