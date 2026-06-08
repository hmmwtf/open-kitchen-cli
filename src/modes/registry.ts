import type { ModeDefinition, ModeName } from "../core/types.js";
import { modeDefinitions } from "./definitions.js";

const modesByName = new Map<ModeName, ModeDefinition>(
  modeDefinitions.map((mode) => [mode.name, mode])
);

export function listModes(): ModeDefinition[] {
  return [...modeDefinitions];
}

export function getMode(name: ModeName): ModeDefinition {
  const mode = modesByName.get(name);
  if (!mode) {
    throw new Error(`Unknown mode: ${name}`);
  }
  return mode;
}

export function isModeName(value: string): value is ModeName {
  return modesByName.has(value as ModeName);
}
