import { Log } from "@/util/log"

const log = Log.create({ service: "mdns" })

export namespace MDNS {
  // mDNS functionality disabled - bonjour-service package not available
  export function publish(_port: number, _name = "opencode") {
    log.info("mDNS publish skipped (disabled)")
  }

  export function unpublish() {
    log.info("mDNS unpublish skipped (disabled)")
  }
}
