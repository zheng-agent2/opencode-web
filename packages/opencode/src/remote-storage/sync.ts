import { SupabaseStorage } from "./supabase"
import { Log } from "../util/log"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Config } from "../config/config"
import path from "path"
import fs from "fs/promises"
import crypto from "crypto"

export namespace CloudSync {
  const log = Log.create({ service: "cloud-sync" })

  /**
   * Check if cloud sync is configured
   */
  export async function isConfigured(): Promise<boolean> {
    const config = await Config.get()
    if (config.supabase?.url && config.supabase?.serviceKey && config.supabase?.projectId) {
      return true
    }
    // Also check environment variables
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_KEY
    const projectId = process.env.SUPABASE_PROJECT_ID
    return !!(url && key && projectId)
  }

  /**
   * Get project ID from config or environment
   */
  export async function getConfiguredProjectId(): Promise<string | null> {
    const config = await Config.get()
    return config.supabase?.projectId ?? process.env.SUPABASE_PROJECT_ID ?? null
  }

  /**
   * Initialize cloud sync from config - auto-pull on startup
   */
  export async function initFromConfig(localDir?: string): Promise<{ synced: boolean; fileCount: number }> {
    const configured = await isConfigured()
    if (!configured) {
      log.info("Cloud sync not configured, skipping")
      return { synced: false, fileCount: 0 }
    }

    const projectId = await getConfiguredProjectId()
    if (!projectId) {
      log.warn("Cloud sync configured but no projectId specified")
      return { synced: false, fileCount: 0 }
    }

    const targetDir = localDir ?? Instance.directory
    log.info("Initializing cloud sync from config", { projectId, localDir: targetDir })

    try {
      const result = await openProject(projectId, targetDir, { forceRefresh: false })
      log.info("Cloud sync initialized", { projectId, pulled: result.pulled, fileCount: result.fileCount })
      return { synced: true, fileCount: result.fileCount }
    } catch (err) {
      log.error("Failed to initialize cloud sync", { projectId, error: err })
      throw err
    }
  }

  export interface SyncMetadata {
    projectId: string
    lastSync: number
    files: Record<
      string,
      {
        hash: string
        size: number
        mtime: number
      }
    >
  }

  export interface ChangedFile {
    path: string
    status: "added" | "modified" | "deleted"
    localSize?: number
    remoteSize?: number
  }

  export interface SyncResult {
    uploaded: number
    deleted: number
    errors: string[]
  }

  /**
   * Get the remote path prefix for a project
   */
  function getRemotePath(projectId: string): string {
    return `${projectId}/files`
  }

  /**
   * Get the local sync metadata file path
   */
  function getMetadataPath(localDir: string): string {
    return path.join(localDir, ".sync-meta.json")
  }

  /**
   * Calculate MD5 hash of a file
   */
  async function hashFile(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath)
    return crypto.createHash("md5").update(content).digest("hex")
  }

  /**
   * Load sync metadata from local directory
   */
  async function loadMetadata(localDir: string): Promise<SyncMetadata | null> {
    const metaPath = getMetadataPath(localDir)
    try {
      const content = await fs.readFile(metaPath, "utf-8")
      return JSON.parse(content) as SyncMetadata
    } catch {
      return null
    }
  }

  /**
   * Save sync metadata to local directory
   */
  async function saveMetadata(localDir: string, metadata: SyncMetadata): Promise<void> {
    const metaPath = getMetadataPath(localDir)
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2))
  }

  /**
   * Scan local directory and build file metadata
   */
  async function scanLocalFiles(
    localDir: string,
  ): Promise<Record<string, { hash: string; size: number; mtime: number }>> {
    const files: Record<string, { hash: string; size: number; mtime: number }> = {}

    async function walkDir(dir: string) {
      let entries: Awaited<ReturnType<typeof fs.readdir>>
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        const relativePath = path.relative(localDir, fullPath)

        // Skip ignored directories and files
        if (
          [".git", "node_modules", ".next", "dist", "build", ".sync-meta.json"].includes(entry.name)
        ) {
          continue
        }

        if (entry.isDirectory()) {
          await walkDir(fullPath)
        } else {
          try {
            const stat = await fs.stat(fullPath)
            const hash = await hashFile(fullPath)
            files[relativePath] = {
              hash,
              size: stat.size,
              mtime: stat.mtimeMs,
            }
          } catch (err) {
            log.error("Failed to scan file", { path: fullPath, error: err })
          }
        }
      }
    }

    await walkDir(localDir)
    return files
  }

  /**
   * Pull entire project from cloud to local directory
   */
  export async function pull(projectId: string, localDir?: string): Promise<number> {
    const targetDir = localDir ?? Instance.directory
    const remotePath = getRemotePath(projectId)

    log.info("Pulling project from cloud", { projectId, localDir: targetDir })

    // Download all files
    const downloadedCount = await SupabaseStorage.downloadFolder(remotePath, targetDir)

    // Scan local files and save metadata
    const files = await scanLocalFiles(targetDir)
    const metadata: SyncMetadata = {
      projectId,
      lastSync: Date.now(),
      files,
    }
    await saveMetadata(targetDir, metadata)

    log.info("Pull complete", { projectId, downloadedCount })
    return downloadedCount
  }

  /**
   * Push local changes back to cloud
   */
  export async function push(projectId: string, localDir?: string): Promise<SyncResult> {
    const targetDir = localDir ?? Instance.directory
    const remotePath = getRemotePath(projectId)

    log.info("Pushing project to cloud", { projectId, localDir: targetDir })

    const result: SyncResult = {
      uploaded: 0,
      deleted: 0,
      errors: [],
    }

    // Load previous sync metadata
    const previousMeta = await loadMetadata(targetDir)

    // Scan current local files
    const currentFiles = await scanLocalFiles(targetDir)

    // Determine what changed
    const previousFiles = previousMeta?.files ?? {}

    // Files to upload (new or modified)
    const toUpload: string[] = []
    for (const [filePath, fileInfo] of Object.entries(currentFiles)) {
      const prev = previousFiles[filePath]
      if (!prev || prev.hash !== fileInfo.hash) {
        toUpload.push(filePath)
      }
    }

    // Files to delete (existed before, don't exist now)
    const toDelete: string[] = []
    for (const filePath of Object.keys(previousFiles)) {
      if (!(filePath in currentFiles)) {
        toDelete.push(filePath)
      }
    }

    log.info("Sync changes detected", {
      upload: toUpload.length,
      delete: toDelete.length,
    })

    // Upload changed files
    for (const filePath of toUpload) {
      const localPath = path.join(targetDir, filePath)
      const remoteFilePath = `${remotePath}/${filePath}`

      try {
        await SupabaseStorage.uploadFile(localPath, remoteFilePath)
        result.uploaded++
      } catch (err) {
        const msg = `Failed to upload ${filePath}: ${err}`
        log.error(msg)
        result.errors.push(msg)
      }
    }

    // Delete removed files
    if (toDelete.length > 0) {
      const remotePathsToDelete = toDelete.map((f) => `${remotePath}/${f}`)
      try {
        await SupabaseStorage.deleteFiles(remotePathsToDelete)
        result.deleted = toDelete.length
      } catch (err) {
        const msg = `Failed to delete files: ${err}`
        log.error(msg)
        result.errors.push(msg)
      }
    }

    // Update sync metadata
    const metadata: SyncMetadata = {
      projectId,
      lastSync: Date.now(),
      files: currentFiles,
    }
    await saveMetadata(targetDir, metadata)

    log.info("Push complete", {
      uploaded: result.uploaded,
      deleted: result.deleted,
      errors: result.errors.length,
    })

    return result
  }

  /**
   * Get sync status - what files have changed since last sync
   */
  export async function status(projectId: string, localDir?: string): Promise<ChangedFile[]> {
    const targetDir = localDir ?? Instance.directory

    log.info("Getting sync status", { projectId, localDir: targetDir })

    // Load previous sync metadata
    const previousMeta = await loadMetadata(targetDir)

    // Scan current local files
    const currentFiles = await scanLocalFiles(targetDir)

    const changes: ChangedFile[] = []
    const previousFiles = previousMeta?.files ?? {}

    // Check for added and modified files
    for (const [filePath, fileInfo] of Object.entries(currentFiles)) {
      const prev = previousFiles[filePath]
      if (!prev) {
        changes.push({
          path: filePath,
          status: "added",
          localSize: fileInfo.size,
        })
      } else if (prev.hash !== fileInfo.hash) {
        changes.push({
          path: filePath,
          status: "modified",
          localSize: fileInfo.size,
          remoteSize: prev.size,
        })
      }
    }

    // Check for deleted files
    for (const [filePath, fileInfo] of Object.entries(previousFiles)) {
      if (!(filePath in currentFiles)) {
        changes.push({
          path: filePath,
          status: "deleted",
          remoteSize: fileInfo.size,
        })
      }
    }

    log.info("Sync status", {
      added: changes.filter((c) => c.status === "added").length,
      modified: changes.filter((c) => c.status === "modified").length,
      deleted: changes.filter((c) => c.status === "deleted").length,
    })

    return changes
  }

  /**
   * Check if a project has been synced before
   */
  export async function isSynced(localDir?: string): Promise<boolean> {
    const targetDir = localDir ?? Instance.directory
    const metadata = await loadMetadata(targetDir)
    return metadata !== null
  }

  /**
   * Get last sync timestamp
   */
  export async function getLastSync(localDir?: string): Promise<Date | null> {
    const targetDir = localDir ?? Instance.directory
    const metadata = await loadMetadata(targetDir)
    return metadata ? new Date(metadata.lastSync) : null
  }

  /**
   * Initialize a new cloud project (create bucket folder and initial sync)
   */
  export async function init(projectId: string, localDir?: string): Promise<void> {
    const targetDir = localDir ?? Instance.directory

    log.info("Initializing cloud project", { projectId, localDir: targetDir })

    // Push all current local files
    await push(projectId, targetDir)

    log.info("Cloud project initialized", { projectId })
  }

  /**
   * Open a cloud project - pulls from cloud if not synced or if forceRefresh is true
   * This is the main entry point for opening a cloud project with lazy sync
   */
  export async function openProject(
    projectId: string,
    localDir?: string,
    options?: { forceRefresh?: boolean },
  ): Promise<{ pulled: boolean; fileCount: number }> {
    const targetDir = localDir ?? Instance.directory

    log.info("Opening cloud project", { projectId, localDir: targetDir })

    const alreadySynced = await isSynced(targetDir)

    if (!alreadySynced || options?.forceRefresh) {
      log.info("Pulling project from cloud", { projectId, forceRefresh: options?.forceRefresh })
      const fileCount = await pull(projectId, targetDir)
      return { pulled: true, fileCount }
    }

    log.info("Project already synced, using local files", { projectId })
    return { pulled: false, fileCount: 0 }
  }

  /**
   * Get the project ID from sync metadata if available
   */
  export async function getProjectId(localDir?: string): Promise<string | null> {
    const targetDir = localDir ?? Instance.directory
    const metadata = await loadMetadata(targetDir)
    return metadata?.projectId ?? null
  }
}

