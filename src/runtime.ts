import type { PluginRuntime } from "openclaw/plugin-sdk";

let lanxinRuntime: PluginRuntime | null = null;

export function setLanxinRuntime(runtime: PluginRuntime): void {
  lanxinRuntime = runtime;
}

export function getLanxinRuntime(): PluginRuntime {
  if (!lanxinRuntime) {
    throw new Error("Lanxin runtime not initialized. Ensure the plugin is loaded.");
  }
  return lanxinRuntime;
}
