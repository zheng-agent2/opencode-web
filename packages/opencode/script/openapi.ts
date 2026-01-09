#!/usr/bin/env bun

import { Server } from "../src/server/server"

const spec = await Server.openapi()
console.log(JSON.stringify(spec, null, 2))
