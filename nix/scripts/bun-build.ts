import path from "path"

const version = "@VERSION@"
const pkg = path.join(process.cwd(), "packages/opencode")
const target = process.env["BUN_COMPILE_TARGET"]

if (!target) {
  throw new Error("BUN_COMPILE_TARGET not set")
}

process.chdir(pkg)

const result = await Bun.build({
  tsconfig: "./tsconfig.json",
  sourcemap: "external",
  entrypoints: ["./src/index.ts"],
  define: {
    OPENCODE_VERSION: `'@VERSION@'`,
    OPENCODE_CHANNEL: "'latest'",
  },
  compile: {
    target,
    outfile: "opencode",
    autoloadBunfig: false,
    autoloadDotenv: false,
    //@ts-ignore (bun types aren't up to date)
    autoloadTsconfig: true,
    autoloadPackageJson: true,
    execArgv: ["--user-agent=opencode/" + version, "--use-system-ca", "--"],
    windows: {},
  },
})

if (!result.success) {
  console.error("Build failed!")
  for (const log of result.logs) {
    console.error(log)
  }
  throw new Error("Compilation failed")
}

console.log("Build successful!")
