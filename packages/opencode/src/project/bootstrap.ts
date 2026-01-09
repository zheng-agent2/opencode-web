import { Plugin } from "../plugin"
import { Share } from "../share/share"
import { Format } from "../format"
import { FileWatcher } from "../file/watcher"
import { File } from "../file"
import { Project } from "./project"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Vcs } from "./vcs"
import { Log } from "@/util/log"
import { ShareNext } from "@/share/share-next"
import { CloudSync } from "@/remote-storage"

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })

  // Initialize cloud sync first if configured (auto-pull from Supabase)
  try {
    const cloudResult = await CloudSync.initFromConfig()
    if (cloudResult.synced) {
      Log.Default.info("cloud sync initialized", {
        fileCount: cloudResult.fileCount,
        directory: Instance.directory,
      })
    }
  } catch (err) {
    Log.Default.error("cloud sync initialization failed", {
      error: err instanceof Error ? err.message : String(err),
    })
    // Continue with local files if cloud sync fails
  }

  await Plugin.init()
  Share.init()
  ShareNext.init()
  Format.init()
  FileWatcher.init()
  File.init()
  Vcs.init()

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      await Project.setInitialized(Instance.project.id)
    }
  })
}
