import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { CloudSync } from "../../remote-storage"
import { EOL } from "os"

export const CloudCommand = cmd({
  command: "cloud <command>",
  describe: "cloud storage sync commands",
  builder: (yargs: Argv) => {
    return yargs
      .command(CloudPullCommand)
      .command(CloudPushCommand)
      .command(CloudStatusCommand)
      .command(CloudInitCommand)
      .demandCommand(1, "You must specify a cloud command")
  },
  handler: async () => {
    // This is handled by subcommands
  },
})

export const CloudPullCommand = cmd({
  command: "pull <projectId>",
  describe: "pull project files from cloud storage",
  builder: (yargs: Argv) => {
    return yargs
      .positional("projectId", {
        describe: "cloud project identifier",
        type: "string",
        demandOption: true,
      })
      .option("directory", {
        alias: "d",
        describe: "local directory to pull into (defaults to current directory)",
        type: "string",
      })
  },
  handler: async (args) => {
    await bootstrap(args.directory ?? process.cwd(), async () => {
      UI.empty()
      prompts.intro("Cloud Pull")

      const spinner = prompts.spinner()
      spinner.start("Downloading files from cloud...")

      try {
        const downloadedCount = await CloudSync.pull(args.projectId!, args.directory)
        spinner.stop(`Downloaded ${downloadedCount} files`)

        prompts.outro("Pull complete!")
      } catch (error) {
        spinner.stop("Failed to pull")
        prompts.log.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    })
  },
})

export const CloudPushCommand = cmd({
  command: "push <projectId>",
  describe: "push local changes to cloud storage",
  builder: (yargs: Argv) => {
    return yargs
      .positional("projectId", {
        describe: "cloud project identifier",
        type: "string",
        demandOption: true,
      })
      .option("directory", {
        alias: "d",
        describe: "local directory to push from (defaults to current directory)",
        type: "string",
      })
  },
  handler: async (args) => {
    await bootstrap(args.directory ?? process.cwd(), async () => {
      UI.empty()
      prompts.intro("Cloud Push")

      // First show status
      const changes = await CloudSync.status(args.projectId!, args.directory)

      if (changes.length === 0) {
        prompts.log.info("No changes to push")
        prompts.outro("Push complete!")
        return
      }

      prompts.log.info(`Changes to push:`)
      for (const change of changes) {
        const symbol = change.status === "added" ? "+" : change.status === "deleted" ? "-" : "~"
        process.stderr.write(`  ${symbol} ${change.path}${EOL}`)
      }

      const confirm = await prompts.confirm({
        message: `Push ${changes.length} changes?`,
      })

      if (prompts.isCancel(confirm) || !confirm) {
        throw new UI.CancelledError()
      }

      const spinner = prompts.spinner()
      spinner.start("Uploading changes...")

      try {
        const result = await CloudSync.push(args.projectId!, args.directory)
        spinner.stop(`Uploaded ${result.uploaded} files, deleted ${result.deleted} files`)

        if (result.errors.length > 0) {
          prompts.log.warn(`Completed with ${result.errors.length} errors:`)
          for (const error of result.errors) {
            process.stderr.write(`  ${error}${EOL}`)
          }
        }

        prompts.outro("Push complete!")
      } catch (error) {
        spinner.stop("Failed to push")
        prompts.log.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    })
  },
})

export const CloudStatusCommand = cmd({
  command: "status <projectId>",
  describe: "show files changed since last sync",
  builder: (yargs: Argv) => {
    return yargs
      .positional("projectId", {
        describe: "cloud project identifier",
        type: "string",
        demandOption: true,
      })
      .option("directory", {
        alias: "d",
        describe: "local directory to check (defaults to current directory)",
        type: "string",
      })
  },
  handler: async (args) => {
    await bootstrap(args.directory ?? process.cwd(), async () => {
      UI.empty()
      prompts.intro("Cloud Status")

      try {
        const lastSync = await CloudSync.getLastSync(args.directory)
        if (lastSync) {
          prompts.log.info(`Last sync: ${lastSync.toLocaleString()}`)
        } else {
          prompts.log.warn("Project has not been synced yet")
        }

        const changes = await CloudSync.status(args.projectId!, args.directory)

        if (changes.length === 0) {
          prompts.log.success("No changes since last sync")
        } else {
          const added = changes.filter((c) => c.status === "added")
          const modified = changes.filter((c) => c.status === "modified")
          const deleted = changes.filter((c) => c.status === "deleted")

          prompts.log.info(`Changes:`)

          if (added.length > 0) {
            process.stderr.write(`  Added (${added.length}):${EOL}`)
            for (const change of added) {
              process.stderr.write(`    + ${change.path}${EOL}`)
            }
          }

          if (modified.length > 0) {
            process.stderr.write(`  Modified (${modified.length}):${EOL}`)
            for (const change of modified) {
              process.stderr.write(`    ~ ${change.path}${EOL}`)
            }
          }

          if (deleted.length > 0) {
            process.stderr.write(`  Deleted (${deleted.length}):${EOL}`)
            for (const change of deleted) {
              process.stderr.write(`    - ${change.path}${EOL}`)
            }
          }
        }

        prompts.outro("")
      } catch (error) {
        prompts.log.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    })
  },
})

export const CloudInitCommand = cmd({
  command: "init <projectId>",
  describe: "initialize a new cloud project from current directory",
  builder: (yargs: Argv) => {
    return yargs
      .positional("projectId", {
        describe: "cloud project identifier to create",
        type: "string",
        demandOption: true,
      })
      .option("directory", {
        alias: "d",
        describe: "local directory to initialize (defaults to current directory)",
        type: "string",
      })
  },
  handler: async (args) => {
    await bootstrap(args.directory ?? process.cwd(), async () => {
      UI.empty()
      prompts.intro("Cloud Init")

      const confirm = await prompts.confirm({
        message: `Initialize cloud project '${args.projectId}'? This will upload all files in the current directory.`,
      })

      if (prompts.isCancel(confirm) || !confirm) {
        throw new UI.CancelledError()
      }

      const spinner = prompts.spinner()
      spinner.start("Initializing cloud project...")

      try {
        await CloudSync.init(args.projectId!, args.directory)
        spinner.stop("Cloud project initialized")

        prompts.outro("Project ready for cloud sync!")
      } catch (error) {
        spinner.stop("Failed to initialize")
        prompts.log.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    })
  },
})
