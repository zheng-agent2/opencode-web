import { createClient, SupabaseClient } from "@supabase/supabase-js"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { Global } from "../global"
import path from "path"
import fs from "fs/promises"

export namespace SupabaseStorage {
  const log = Log.create({ service: "supabase-storage" })

  let client: SupabaseClient | null = null

  export async function getClient(): Promise<SupabaseClient> {
    if (client) return client

    const config = await Config.get()
    if (!config.supabase) {
      // Check environment variables as fallback
      const url = process.env.SUPABASE_URL
      const serviceKey = process.env.SUPABASE_SERVICE_KEY

      if (!url || !serviceKey) {
        throw new Error(
          "Supabase configuration not found. Set supabase.url and supabase.serviceKey in config, or SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.",
        )
      }

      client = createClient(url, serviceKey)
      return client
    }

    client = createClient(config.supabase.url, config.supabase.serviceKey)
    return client
  }

  export async function getBucket(): Promise<string> {
    const config = await Config.get()
    return config.supabase?.bucket ?? process.env.SUPABASE_BUCKET ?? "opencode-files"
  }

  export interface FileInfo {
    name: string
    path: string
    size: number
    lastModified: Date
  }

  /**
   * List all files in a bucket path recursively
   */
  export async function listFiles(remotePath: string): Promise<FileInfo[]> {
    const supabase = await getClient()
    const bucket = await getBucket()

    const files: FileInfo[] = []

    async function listRecursive(currentPath: string) {
      const { data, error } = await supabase.storage.from(bucket).list(currentPath, {
        limit: 1000,
        sortBy: { column: "name", order: "asc" },
      })

      if (error) {
        log.error("Failed to list files", { path: currentPath, error: error.message })
        throw new Error(`Failed to list files at ${currentPath}: ${error.message}`)
      }

      if (!data) return

      for (const item of data) {
        const itemPath = currentPath ? `${currentPath}/${item.name}` : item.name

        if (item.id === null) {
          // This is a folder, recurse into it
          await listRecursive(itemPath)
        } else {
          // This is a file
          files.push({
            name: item.name,
            path: itemPath,
            size: item.metadata?.size ?? 0,
            lastModified: new Date(item.updated_at ?? item.created_at ?? Date.now()),
          })
        }
      }
    }

    await listRecursive(remotePath)
    return files
  }

  /**
   * Download a single file from the bucket
   */
  export async function downloadFile(remotePath: string, localPath: string): Promise<void> {
    const supabase = await getClient()
    const bucket = await getBucket()

    log.info("Downloading file", { remotePath, localPath })

    const { data, error } = await supabase.storage.from(bucket).download(remotePath)

    if (error) {
      log.error("Failed to download file", { remotePath, error: error.message })
      throw new Error(`Failed to download ${remotePath}: ${error.message}`)
    }

    if (!data) {
      throw new Error(`No data received for ${remotePath}`)
    }

    // Ensure directory exists
    await fs.mkdir(path.dirname(localPath), { recursive: true })

    // Write file
    const buffer = Buffer.from(await data.arrayBuffer())
    await fs.writeFile(localPath, buffer)

    log.info("Downloaded file", { remotePath, localPath, size: buffer.length })
  }

  /**
   * Download an entire folder from the bucket to a local directory
   */
  export async function downloadFolder(remotePath: string, localPath: string): Promise<number> {
    log.info("Downloading folder", { remotePath, localPath })

    const files = await listFiles(remotePath)

    if (files.length === 0) {
      log.info("No files found in remote folder", { remotePath })
      return 0
    }

    let downloadedCount = 0
    for (const file of files) {
      // Calculate relative path from the remote folder
      const relativePath = file.path.startsWith(remotePath + "/")
        ? file.path.slice(remotePath.length + 1)
        : file.path.startsWith(remotePath)
          ? file.path.slice(remotePath.length)
          : file.path

      const localFilePath = path.join(localPath, relativePath)

      try {
        await downloadFile(file.path, localFilePath)
        downloadedCount++
      } catch (err) {
        log.error("Failed to download file", { file: file.path, error: err })
        throw err
      }
    }

    log.info("Downloaded folder", { remotePath, localPath, fileCount: downloadedCount })
    return downloadedCount
  }

  /**
   * Upload a single file to the bucket
   */
  export async function uploadFile(localPath: string, remotePath: string): Promise<void> {
    const supabase = await getClient()
    const bucket = await getBucket()

    log.info("Uploading file", { localPath, remotePath })

    const content = await fs.readFile(localPath)

    const { error } = await supabase.storage.from(bucket).upload(remotePath, content, {
      upsert: true,
    })

    if (error) {
      log.error("Failed to upload file", { localPath, remotePath, error: error.message })
      throw new Error(`Failed to upload ${localPath}: ${error.message}`)
    }

    log.info("Uploaded file", { localPath, remotePath, size: content.length })
  }

  /**
   * Upload an entire folder to the bucket
   */
  export async function uploadFolder(localPath: string, remotePath: string): Promise<number> {
    log.info("Uploading folder", { localPath, remotePath })

    const files: string[] = []

    async function walkDir(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          // Skip common ignored directories
          if ([".git", "node_modules", ".next", "dist", "build"].includes(entry.name)) {
            continue
          }
          await walkDir(fullPath)
        } else {
          files.push(fullPath)
        }
      }
    }

    await walkDir(localPath)

    if (files.length === 0) {
      log.info("No files found in local folder", { localPath })
      return 0
    }

    let uploadedCount = 0
    for (const file of files) {
      const relativePath = path.relative(localPath, file)
      const remoteFilePath = remotePath ? `${remotePath}/${relativePath}` : relativePath

      try {
        await uploadFile(file, remoteFilePath)
        uploadedCount++
      } catch (err) {
        log.error("Failed to upload file", { file, error: err })
        throw err
      }
    }

    log.info("Uploaded folder", { localPath, remotePath, fileCount: uploadedCount })
    return uploadedCount
  }

  /**
   * Delete a file from the bucket
   */
  export async function deleteFile(remotePath: string): Promise<void> {
    const supabase = await getClient()
    const bucket = await getBucket()

    log.info("Deleting file", { remotePath })

    const { error } = await supabase.storage.from(bucket).remove([remotePath])

    if (error) {
      log.error("Failed to delete file", { remotePath, error: error.message })
      throw new Error(`Failed to delete ${remotePath}: ${error.message}`)
    }

    log.info("Deleted file", { remotePath })
  }

  /**
   * Delete multiple files from the bucket
   */
  export async function deleteFiles(remotePaths: string[]): Promise<void> {
    if (remotePaths.length === 0) return

    const supabase = await getClient()
    const bucket = await getBucket()

    log.info("Deleting files", { count: remotePaths.length })

    const { error } = await supabase.storage.from(bucket).remove(remotePaths)

    if (error) {
      log.error("Failed to delete files", { error: error.message })
      throw new Error(`Failed to delete files: ${error.message}`)
    }

    log.info("Deleted files", { count: remotePaths.length })
  }

  /**
   * Check if a file exists in the bucket
   */
  export async function exists(remotePath: string): Promise<boolean> {
    const supabase = await getClient()
    const bucket = await getBucket()

    const dir = path.dirname(remotePath)
    const filename = path.basename(remotePath)

    const { data, error } = await supabase.storage.from(bucket).list(dir === "." ? "" : dir, {
      search: filename,
    })

    if (error) {
      return false
    }

    return data?.some((item) => item.name === filename) ?? false
  }

  /**
   * Get file metadata
   */
  export async function getMetadata(
    remotePath: string,
  ): Promise<{ size: number; lastModified: Date } | null> {
    const supabase = await getClient()
    const bucket = await getBucket()

    const dir = path.dirname(remotePath)
    const filename = path.basename(remotePath)

    const { data, error } = await supabase.storage.from(bucket).list(dir === "." ? "" : dir, {
      search: filename,
    })

    if (error || !data) {
      return null
    }

    const file = data.find((item) => item.name === filename)
    if (!file) {
      return null
    }

    return {
      size: file.metadata?.size ?? 0,
      lastModified: new Date(file.updated_at ?? file.created_at ?? Date.now()),
    }
  }
}

