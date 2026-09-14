import type { Command } from "commander";

const resolutionHelp =
  "\nHub origin precedence: command origin/--hub, RAMBLA_HUB_URL, active stored login, then https://hub.rambla.sh.\nCredential precedence: --api-key, RAMBLA_HUB_API_KEY, then a stored login for the exact resolved origin.\n";

export function addHubResolutionHelp(command: Command): Command {
  return command.addHelpText("after", resolutionHelp);
}
