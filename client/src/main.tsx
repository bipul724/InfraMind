import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { client } from "./lib/appwrite";

// Confirm the Appwrite connection once on startup
client
  .ping()
  .then(() => console.log("✅ Appwrite connected"))
  .catch((error) => console.error("❌ Appwrite ping failed:", error));

createRoot(document.getElementById("root")!).render(<App />);
