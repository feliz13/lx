import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { lanxinDock, lanxinPlugin } from "./src/channel.js";
import { handleLanxinWebhookRequest } from "./src/monitor.js";
import { setLanxinRuntime } from "./src/runtime.js";

const plugin = {
  id: "lanxin",
  name: "Lanxin",
  description: "OpenClaw Lanxin (蓝信) channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setLanxinRuntime(api.runtime);
    api.registerChannel({ plugin: lanxinPlugin, dock: lanxinDock });
    api.registerHttpRoute({
      path: "/lanxin",
      auth: "plugin",
      match: "prefix",
      handler: handleLanxinWebhookRequest,
    });
  },
};

export default plugin;
