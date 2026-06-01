import React from "react"
import { createRoot } from "react-dom/client"

import { SidebarApp } from "../../src/sidebar/SidebarApp"
import "../../src/sidebar/sidebar.css"

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SidebarApp />
  </React.StrictMode>
)
