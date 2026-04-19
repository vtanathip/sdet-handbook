import { Router, Request, Response } from "express";
import { readDashboardData } from "../data/claudeReader.js";
import { scanClaudeDir } from "../data/fileScanner.js";

const router = Router();

router.get("/data", (req: Request, res: Response) => {
  try {
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    const data = readDashboardData(date);
    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.get("/files", (_req: Request, res: Response) => {
  try {
    res.json(scanClaudeDir());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

export default router;
