import path from "node:path";

import { resolveRamblaHome } from "../../../rambla-home.js";

const OPENCODE_HOME_DIRNAME = "opencode-home";

export function resolveOpenCodeHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveRamblaHome(env), OPENCODE_HOME_DIRNAME);
}
