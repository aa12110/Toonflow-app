const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronRuntime", {
  getBackendConfig: async () => {
    const config = await ipcRenderer.invoke("app:get-backend-config");
    return {
      baseUrl: typeof config?.baseUrl === "string" ? config.baseUrl : "",
      wsBaseUrl: typeof config?.wsBaseUrl === "string" ? config.wsBaseUrl : "",
    };
  },
});
