#!/usr/bin/env node
import {createLoopbackRelay} from "./unix-relay.js";
import {runGuestMain} from "./cli.js";

// This is the one final Node exec. Both relays and native Pi SDK run here;
// the no-fork seccomp profile does not require helper child processes.
const relays:Awaited<ReturnType<typeof createLoopbackRelay>>[]=[];
try {
  relays.push(await createLoopbackRelay(process.env.CHIO_PI_GATEWAY_SOCKET!,Number(process.env.CHIO_PI_GATEWAY_PORT)));
  relays.push(await createLoopbackRelay(process.env.CHIO_PI_MODEL_SOCKET!,Number(process.env.CHIO_PI_MODEL_PORT)));
  await runGuestMain();
} catch {
  process.stderr.write("Confined Linux Pi guest refused or failed\n");process.exitCode=1;
} finally {for(const relay of relays)await relay.close();}
