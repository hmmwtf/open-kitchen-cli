import type { Command } from "commander";
import { listModes } from "../../modes/registry.js";

export function registerModesCommand(program: Command): void {
  program
    .command("modes")
    .description("List available OpenKitchen modes.")
    .action(() => {
      for (const mode of listModes()) {
        console.log(`${mode.name.padEnd(8)} ${mode.displayName.padEnd(8)} ${mode.description}`);
        console.log(`          policies: ${mode.defaultPolicies.join(", ")}`);
        console.log(`          agents:   ${mode.agentRoles.join(", ")}`);
      }
    });
}
