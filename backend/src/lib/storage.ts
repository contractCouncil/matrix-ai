/**
 * Storage utilities. Supports two backends:
 *   - Cloudflare R2 / any S3-compatible service when R2_* env vars are set.
 *   - Local disk under backend/.local-storage/ otherwise (dev fallback).
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const useR2 = Boolean(
  process.env.R2_ENDPOINT_URL &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    !process.env.R2_ENDPOINT_URL.includes("placeholder") &&
    !process.env.R2_ACCESS_KEY_ID.includes("placeholder"),
);

// Serverless filesystems are ephemeral; local-disk storage cannot work on
// Vercel/Lambda. Fail fast at boot with a clear message instead of silently
// writing files that vanish between invocations.
if (!useR2 && (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)) {
  throw new Error(
    "Storage misconfigured: R2_ENDPOINT_URL / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY must be set in serverless environments (local-disk mode is not supported).",
  );
}

const LOCAL_ROOT = path.resolve(process.cwd(), ".local-storage");
const LOCAL_URL_BASE =
  process.env.BACKEND_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3001}`;
const LOCAL_SIGNING_SECRET =
  process.env.DOWNLOAD_SIGNING_SECRET ??
  process.env.SUPABASE_SECRET_KEY ??
  "dev-local-storage-secret";

function getClient(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT_URL!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

const BUCKET = process.env.R2_BUCKET_NAME ?? "mike";

export const storageEnabled = true;
export const storageMode: "r2" | "local" = useR2 ? "r2" : "local";

function localPathFor(key: string): string {
  const safe = key.replace(/\.\.+/g, "_");
  return path.join(LOCAL_ROOT, safe);
}

function signLocal(key: string, exp: number, disposition?: string): string {
  const payload = `${key}\n${exp}\n${disposition ?? ""}`;
  return crypto
    .createHmac("sha256", LOCAL_SIGNING_SECRET)
    .update(payload)
    .digest("hex");
}

export function verifyLocalSignature(
  key: string,
  exp: number,
  signature: string,
  disposition?: string,
): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = signLocal(key, exp, disposition);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export async function uploadFile(
  key: string,
  content: ArrayBuffer,
  contentType: string,
): Promise<void> {
  if (storageMode === "local") {
    const filePath = localPathFor(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, Buffer.from(content));
    return;
  }
  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: Buffer.from(content),
      ContentType: contentType,
    }),
  );
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

export async function downloadFile(key: string): Promise<ArrayBuffer | null> {
  if (storageMode === "local") {
    try {
      const buf = await fs.readFile(localPathFor(key));
      return buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      ) as ArrayBuffer;
    } catch {
      return null;
    }
  }
  try {
    const client = getClient();
    const response = await client.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    );
    if (!response.Body) return null;
    const bytes = await response.Body.transformToByteArray();
    return bytes.buffer as ArrayBuffer;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteFile(key: string): Promise<void> {
  if (storageMode === "local") {
    try {
      await fs.unlink(localPathFor(key));
    } catch {
      // ignore missing files
    }
    return;
  }
  const client = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// ---------------------------------------------------------------------------
// Signed URL (pre-signed for temporary direct access)
// ---------------------------------------------------------------------------

export async function getSignedUrl(
  key: string,
  expiresIn = 3600,
  downloadFilename?: string,
): Promise<string | null> {
  if (storageMode === "local") {
    const disposition = downloadFilename
      ? buildContentDisposition("attachment", downloadFilename)
      : undefined;
    const exp = Math.floor(Date.now() / 1000) + expiresIn;
    const sig = signLocal(key, exp, disposition);
    const params = new URLSearchParams({
      key,
      exp: String(exp),
      sig,
    });
    if (disposition) params.set("disposition", disposition);
    return `${LOCAL_URL_BASE}/local-storage?${params.toString()}`;
  }
  try {
    const client = getClient();
    const responseContentDisposition = downloadFilename
      ? buildContentDisposition("attachment", downloadFilename)
      : undefined;
    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ResponseContentDisposition: responseContentDisposition,
    });
    return await awsGetSignedUrl(client, command, { expiresIn });
  } catch {
    return null;
  }
}

export function normalizeDownloadFilename(name: string): string {
  const trimmed = name.trim();
  const base = trimmed || "download";
  return base.replace(/[\x00-\x1F\x7F]/g, "_").replace(/[\\/]/g, "_");
}

export function sanitizeDispositionFilename(name: string): string {
  return normalizeDownloadFilename(name).replace(/["\\]/g, "_");
}

export function encodeRFC5987(str: string): string {
  return encodeURIComponent(str).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

export function buildContentDisposition(
  kind: "inline" | "attachment",
  filename: string,
): string {
  const normalized = normalizeDownloadFilename(filename);
  return `${kind}; filename="${sanitizeDispositionFilename(normalized)}"; filename*=UTF-8''${encodeRFC5987(normalized)}`;
}

export async function readLocalFile(key: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(localPathFor(key));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Storage key helpers
// ---------------------------------------------------------------------------

export function storageKey(
  userId: string,
  docId: string,
  filename: string,
): string {
  return `documents/${userId}/${docId}/source${storageExtension(filename, ".bin")}`;
}

export function pdfStorageKey(
  userId: string,
  docId: string,
  stem: string,
): string {
  return `documents/${userId}/${docId}/${stem}.pdf`;
}

export function generatedDocKey(
  userId: string,
  docId: string,
  filename: string,
): string {
  return `generated/${userId}/${docId}/generated${storageExtension(filename, ".docx")}`;
}

export function versionStorageKey(
  userId: string,
  docId: string,
  versionSlug: string,
  filename: string,
): string {
  return `documents/${userId}/${docId}/versions/${versionSlug}${storageExtension(filename, ".bin")}`;
}

function storageExtension(filename: string, fallback: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot < 0) return fallback;
  const ext = filename.slice(lastDot).toLowerCase();
  return /^\.[a-z0-9]{1,16}$/.test(ext) ? ext : fallback;
}
