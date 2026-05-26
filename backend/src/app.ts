import "dotenv/config";
import express from "express";
import cors from "cors";
import { chatRouter } from "./routes/chat";
import { projectsRouter } from "./routes/projects";
import { projectChatRouter } from "./routes/projectChat";
import { documentsRouter } from "./routes/documents";
import { tabularRouter } from "./routes/tabular";
import { workflowsRouter } from "./routes/workflows";
import { userRouter } from "./routes/user";
import { downloadsRouter } from "./routes/downloads";
import {
  readLocalFile,
  storageMode,
  verifyLocalSignature,
} from "./lib/storage";

export const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL ?? "http://localhost:3000",
    credentials: true,
  }),
);

app.use(express.json({ limit: "50mb" }));

app.use("/chat", chatRouter);
app.use("/projects", projectsRouter);
app.use("/projects/:projectId/chat", projectChatRouter);
app.use("/single-documents", documentsRouter);
app.use("/tabular-review", tabularRouter);
app.use("/workflows", workflowsRouter);
app.use("/user", userRouter);
app.use("/users", userRouter);
app.use("/download", downloadsRouter);

app.get("/health", (_req, res) =>
  res.json({ ok: true, storage: storageMode }),
);

app.get("/local-storage", async (req, res) => {
  if (storageMode !== "local") return void res.status(404).end();
  const key = typeof req.query.key === "string" ? req.query.key : "";
  const sig = typeof req.query.sig === "string" ? req.query.sig : "";
  const exp = Number(req.query.exp);
  const disposition =
    typeof req.query.disposition === "string" ? req.query.disposition : undefined;
  if (!key || !sig || !verifyLocalSignature(key, exp, sig, disposition)) {
    return void res.status(403).json({ detail: "Invalid or expired signature" });
  }
  const buf = await readLocalFile(key);
  if (!buf) return void res.status(404).json({ detail: "Not found" });
  if (key.endsWith(".pdf")) res.setHeader("Content-Type", "application/pdf");
  else if (key.endsWith(".docx"))
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  if (disposition) res.setHeader("Content-Disposition", disposition);
  res.send(buf);
});
