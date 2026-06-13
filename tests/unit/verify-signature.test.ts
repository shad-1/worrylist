import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Response, NextFunction } from "express";
import {
  computeNotionSignature,
  verifyNotionSignature,
  type RawBodyRequest,
} from "../../src/triggers/verify-signature";

const SECRET = "test-verification-token";

function mockReqRes(opts: { signature?: string; rawBody?: Buffer }) {
  const req = {
    rawBody: opts.rawBody,
    header: (name: string) =>
      name === "X-Notion-Signature" ? opts.signature : undefined,
  } as unknown as RawBodyRequest;

  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  } as unknown as Response & { statusCode: number; body: unknown };

  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

describe("verifyNotionSignature", () => {
  const orig = process.env.NOTION_WEBHOOK_SECRET;
  beforeEach(() => { process.env.NOTION_WEBHOOK_SECRET = SECRET; });
  afterEach(() => {
    if (orig === undefined) delete process.env.NOTION_WEBHOOK_SECRET;
    else process.env.NOTION_WEBHOOK_SECRET = orig;
    vi.restoreAllMocks();
  });

  it("calls next() for a valid signature", () => {
    const rawBody = Buffer.from(JSON.stringify({ id: "page-1" }));
    const signature = computeNotionSignature(SECRET, rawBody);
    const { req, res, next } = mockReqRes({ signature, rawBody });

    verifyNotionSignature(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect((res as unknown as { statusCode: number }).statusCode).toBe(200);
  });

  it("rejects an invalid signature with 401", () => {
    const rawBody = Buffer.from(JSON.stringify({ id: "page-1" }));
    const { req, res, next } = mockReqRes({ signature: "sha256=deadbeef", rawBody });

    verifyNotionSignature(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
  });

  it("rejects a tampered body with 401", () => {
    const signedBody = Buffer.from(JSON.stringify({ id: "page-1" }));
    const signature = computeNotionSignature(SECRET, signedBody);
    const tamperedBody = Buffer.from(JSON.stringify({ id: "page-EVIL" }));
    const { req, res, next } = mockReqRes({ signature, rawBody: tamperedBody });

    verifyNotionSignature(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
  });

  it("rejects a missing signature header with 401", () => {
    const rawBody = Buffer.from(JSON.stringify({ id: "page-1" }));
    const { req, res, next } = mockReqRes({ rawBody });

    verifyNotionSignature(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
  });

  it("skips verification (calls next) when secret is not configured", () => {
    delete process.env.NOTION_WEBHOOK_SECRET;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { req, res, next } = mockReqRes({});

    verifyNotionSignature(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalled();
  });
});
