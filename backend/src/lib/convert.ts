import JSZip from "jszip";
import mammoth from "mammoth";

/**
 * Some older Windows/Word archives store .docx entries with backslash
 * separators (e.g. `word\document.xml`). Mammoth both look up entries by exact
 * string and miss those files, producing empty output or conversion failures.
 * Rewrite any such entries to the canonical forward-slash form before handing
 * the buffer off.
 */
export async function normalizeDocxZipPaths(buffer: Buffer): Promise<Buffer> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return buffer;
  }
  const renames: [string, string][] = [];
  zip.forEach((relativePath) => {
    if (relativePath.includes("\\")) {
      renames.push([relativePath, relativePath.replace(/\\/g, "/")]);
    }
  });
  if (renames.length === 0) return buffer;
  for (const [oldPath, newPath] of renames) {
    const entry = zip.file(oldPath);
    if (!entry) continue;
    const content = await entry.async("nodebuffer");
    zip.remove(oldPath);
    zip.file(newPath, content);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

function htmlWrap(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 24mm 20mm; }
    body { font-family: -apple-system, "Segoe UI", Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #111; }
    h1, h2, h3, h4, h5, h6 { margin: 1.2em 0 0.4em; }
    p { margin: 0.5em 0; }
    table { border-collapse: collapse; width: 100%; }
    table, th, td { border: 1px solid #888; }
    th, td { padding: 4px 8px; }
    img { max-width: 100%; height: auto; }
    pre, code { font-family: ui-monospace, "SFMono-Regular", monospace; }
    pre { background: #f5f5f5; padding: 8px; white-space: pre-wrap; }
  </style></head><body>${body}</body></html>`;
}

let _browserPromise: Promise<import("puppeteer-core").Browser> | null = null;

async function launchBrowser(): Promise<import("puppeteer-core").Browser> {
  const puppeteer = await import("puppeteer-core");
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.default.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  const execPath =
    process.env.CHROME_PATH ||
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return puppeteer.default.launch({ executablePath: execPath, headless: true });
}

async function getBrowser(): Promise<import("puppeteer-core").Browser> {
  if (!_browserPromise) _browserPromise = launchBrowser();
  try {
    const b = await _browserPromise;
    if (b.connected !== false) return b;
  } catch {
    // fall through, relaunch
  }
  _browserPromise = launchBrowser();
  return _browserPromise;
}

/**
 * Convert a DOCX/DOC buffer to PDF.
 *
 * Pipeline: DOCX → HTML (mammoth) → PDF (headless Chromium via puppeteer-core).
 * Works on Vercel/AWS Lambda via @sparticuz/chromium and locally if Chrome is
 * installed at the default macOS path or CHROME_PATH is set.
 */
export async function docxToPdf(buffer: Buffer): Promise<Buffer> {
  const normalized = await normalizeDocxZipPaths(buffer);
  const { value: bodyHtml } = await mammoth.convertToHtml({ buffer: normalized });
  const html = htmlWrap(bodyHtml);

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "24mm", bottom: "24mm", left: "20mm", right: "20mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}

export function convertedPdfKey(userId: string, docId: string): string {
  return `converted-pdfs/${userId}/${docId}.pdf`;
}
