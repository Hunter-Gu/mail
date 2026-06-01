import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "wxt"

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: "Mail Agent",
    description: "Gmail sidebar chat extension for the mail agent.",
    permissions: ["tabs", "sidePanel", "storage", "scripting"],
    host_permissions: [
      "https://mail.google.com/*",
      "https://api.deepseek.com/*"
    ],
    action: {
      default_title: "Mail Agent"
    },
    side_panel: {
      default_path: "sidepanel.html"
    },
    web_accessible_resources: [
      {
        resources: ["pageWorld.js"],
        matches: ["https://mail.google.com/*", "https://inbox.google.com/*"]
      }
    ]
  },
  vite: () => ({
    plugins: [...tailwindcss()] as never,
    build: {
      rollupOptions: {
        onwarn(warning, warn) {
          if (warning.code === "MODULE_LEVEL_DIRECTIVE") return
          warn(warning)
        }
      }
    }
  })
})
