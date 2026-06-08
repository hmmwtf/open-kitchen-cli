#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { registerAdaptersCommand } from "./commands/adapters.js";
import { registerLedgerCommand } from "./commands/ledger.js";
import { registerLedgerShortcutCommands } from "./commands/ledger-shortcuts.js";
import { registerLedgerStatsCommand } from "./commands/ledger-stats.js";
import { registerModesCommand } from "./commands/modes.js";
import { registerRecommendCommand } from "./commands/recommend.js";
import { registerRecipeCommand } from "./commands/recipe.js";
import { registerResumeCommand } from "./commands/resume.js";
import { registerRunCommand } from "./commands/run.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("open-kitchen")
    .description("Local-first mode-based orchestration CLI for AI coding agents.")
    .version("0.1.0");

  registerModesCommand(program);
  registerAdaptersCommand(program);
  registerRecommendCommand(program);
  registerRunCommand(program);
  registerResumeCommand(program);
  registerRecipeCommand(program);
  registerLedgerCommand(program);
  registerLedgerShortcutCommands(program);
  registerLedgerStatsCommand(program);

  return program;
}

const currentFile = realPathOrOriginal(fileURLToPath(import.meta.url));
const invokedFile = process.argv[1] ? realPathOrOriginal(process.argv[1]) : undefined;

if (invokedFile === currentFile) {
  await createProgram().parseAsync(process.argv);
}

function realPathOrOriginal(value: string): string {
  try {
    return realpathSync.native(value);
  } catch {
    return value;
  }
}
