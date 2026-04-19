import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import apiRouter from "./routes/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.use(express.json());

// Static assets (HTML, JSX)
app.use(express.static(ROOT));

// API routes
app.use("/api", apiRouter);

// SPA fallback
app.get("*", (_req, res) => {
  res.sendFile(path.join(ROOT, "Claude Token Tracker.html"));
});

app.listen(PORT, () => {
  console.log(`Token Tracker running at http://localhost:${PORT}`);
});
