import type { Request, Response, NextFunction } from "express";
import { createHmac, timingSafeEqual } from "crypto";

// express.json()'s `verify` hook stashes the raw request body here so we can
// compute the HMAC over the exact bytes Notion signed (re-serialising the
// parsed JSON would not byte-match).
export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/**
 * Compute the signature Notion sends in the `X-Notion-Signature` header:
 * "sha256=" + hex(HMAC-SHA256(rawBody, verificationToken)).
 */
export function computeNotionSignature(secret: string, rawBody: Buffer): string {
  return "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * Express middleware guarding the Notion webhook routes.
 *
 * - Secret unset: logs a warning and passes through, so local dev and the
 *   pre-deploy manual flow work before NOTION_WEBHOOK_SECRET is configured.
 *   Set the secret in production (Railway env) to enforce verification.
 * - Secret set: rejects any request missing or failing the signature check.
 */
export function verifyNotionSignature(req: RawBodyRequest, res: Response, next: NextFunction): void {
  const secret = process.env.NOTION_WEBHOOK_SECRET;

  if (!secret) {
    console.warn("[webhook] NOTION_WEBHOOK_SECRET not set — skipping signature verification");
    next();
    return;
  }

  const provided = req.header("X-Notion-Signature");
  if (!provided || !req.rawBody) {
    res.status(401).json({ error: "missing signature" });
    return;
  }

  const expected = computeNotionSignature(secret, req.rawBody);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: "invalid signature" });
    return;
  }

  next();
}
