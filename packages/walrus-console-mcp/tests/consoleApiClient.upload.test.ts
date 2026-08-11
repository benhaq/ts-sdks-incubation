import { HttpClient } from "@effect/platform";
import { Effect, Layer, Redacted } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleConfigTag } from "../src/config";
import { ConsoleApiClient, parseConsoleErrorBody } from "../src/console/ConsoleApiClient";
import { ConsoleApiError } from "../src/console/errors";
import type { BucketId, FileId } from "../src/console/types";

/**
 * The multipart upload and the blob download bypass the Effect HttpClient and
 * call global `fetch` directly, so they are exercised by stubbing `fetch` rather
 * than the HttpClient layer. Their error mapping is what matters here: dropping
 * the Console error `code` made `ConsoleStorageService`'s `mirror_missing_grant`
 * retry unreachable, so every upload into a freshly created private bucket
 * failed on the first attempt instead of waiting for the grant to propagate.
 */

const TestConfig = Layer.succeed(ConsoleConfigTag, {
  apiKey: Redacted.make("hbr_test_key"),
  servicePrivateKey: Redacted.make(""),
  adminKey: Redacted.make(""),
  adminServicePrivateKey: Redacted.make(""),
  baseUrl: "https://api.example.test",
});

// The HttpClient is required to build the service but is never reached by these
// two methods; a client that fails loudly proves they really do use `fetch`.
const unusedHttp = HttpClient.make(() =>
  Effect.die(new Error("HttpClient must not be used by the raw-fetch paths")),
);

const TestLayer = ConsoleApiClient.Default.pipe(
  Layer.provideMerge(Layer.mergeAll(TestConfig, Layer.succeed(HttpClient.HttpClient, unusedHttp))),
);

const BUCKET = "bucket-1" as BucketId;
const FILE = "file-1" as FileId;

function stubFetch(body: string, status: number, contentType = "application/json") {
  vi.stubGlobal(
    "fetch",
    async () => new Response(body, { status, headers: { "content-type": contentType } }),
  );
}

/** Run an upload against the stubbed fetch and return the failure. */
const uploadError = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const api = yield* ConsoleApiClient;
      return yield* api.uploadBucketFile(BUCKET, new Uint8Array([1, 2, 3]), "note.txt");
    }).pipe(Effect.provide(TestLayer), Effect.flip),
  );

const downloadError = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const api = yield* ConsoleApiClient;
      return yield* api.downloadBucketFile(BUCKET, FILE);
    }).pipe(Effect.provide(TestLayer), Effect.flip),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseConsoleErrorBody", () => {
  it("reads the flat `{ error, code }` shape the API middleware emits", () => {
    expect(parseConsoleErrorBody({ error: "no grant yet", code: "mirror_missing_grant" })).toEqual({
      code: "mirror_missing_grant",
      message: "no grant yet",
    });
  });

  it("reads the nested `{ error: { code, message } }` shape", () => {
    expect(parseConsoleErrorBody({ error: { code: "bad_request", message: "nope" } })).toEqual({
      code: "bad_request",
      message: "nope",
    });
  });

  it("reads the bare `{ error: 'msg' }` shape", () => {
    expect(parseConsoleErrorBody({ error: "plain" })).toEqual({
      code: undefined,
      message: "plain",
    });
  });

  it("falls back to top-level `message` when `error` is absent", () => {
    expect(parseConsoleErrorBody({ code: "x", message: "y" })).toEqual({ code: "x", message: "y" });
  });

  it("returns nothing for a non-object body", () => {
    expect(parseConsoleErrorBody("just a string")).toEqual({
      code: undefined,
      message: undefined,
    });
    expect(parseConsoleErrorBody(null)).toEqual({ code: undefined, message: undefined });
  });
});

describe("ConsoleApiClient.uploadBucketFile error mapping", () => {
  // Regression: this is the exact response Console returns while a newly created
  // private bucket's on-chain grant is still propagating. Losing `code` here made
  // ConsoleStorageService's retry dead code.
  it("preserves `mirror_missing_grant` from a 403 as a retryable ConsoleApiError", async () => {
    stubFetch(
      JSON.stringify({ error: "Bucket grant has not propagated", code: "mirror_missing_grant" }),
      403,
    );
    const error = (await uploadError()) as { _tag: string; code?: string; status?: number };
    // Must stay a ConsoleApiError: the retry guard is `instanceof ConsoleApiError`,
    // and ConsoleAuthError's closed code union cannot represent this value.
    expect(error._tag).toBe("ConsoleApiError");
    expect(error.code).toBe("mirror_missing_grant");
    expect(error.status).toBe(403);
  });

  // Closes the loop on the finding: it is not enough that `code` survives — the
  // error must satisfy ConsoleStorageService's guard verbatim
  // (`lastErr instanceof ConsoleApiError && lastErr.code === "mirror_missing_grant"`,
  // ConsoleStorageService.ts:89). Routing a 403 through `handleError` would yield
  // a ConsoleAuthError and fail this assertion even with the code preserved.
  // The full retry loop is not driven here: uploadFile also needs SealCryptoService,
  // which would mean mocking the @mysten/seal + gRPC surfaces (see sealSessionCache.test.ts).
  it("produces an error that satisfies the storage-service retry guard", async () => {
    stubFetch(JSON.stringify({ error: "not yet", code: "mirror_missing_grant" }), 403);
    const error = await uploadError();
    const retryable = error instanceof ConsoleApiError && error.code === "mirror_missing_grant";
    expect(retryable).toBe(true);
  });

  it("preserves the code from the nested error shape too", async () => {
    stubFetch(JSON.stringify({ error: { code: "quota_exceeded", message: "over cap" } }), 402);
    const error = (await uploadError()) as { code?: string; message: string };
    expect(error.code).toBe("quota_exceeded");
    expect(error.message).toContain("over cap");
  });

  it("keeps a non-JSON body as the message instead of crashing", async () => {
    stubFetch("<html>502 Bad Gateway</html>", 502, "text/html");
    const error = (await uploadError()) as { _tag: string; code?: string; message: string };
    expect(error._tag).toBe("ConsoleApiError");
    expect(error.code).toBeUndefined();
    expect(error.message).toContain("502 Bad Gateway");
  });
});

describe("ConsoleApiClient.downloadBucketFile error mapping", () => {
  it("preserves the error code on a failed download", async () => {
    stubFetch(JSON.stringify({ error: "no on-chain grant", code: "mirror_missing_grant" }), 403);
    const error = (await downloadError()) as { _tag: string; code?: string; status?: number };
    expect(error._tag).toBe("ConsoleApiError");
    expect(error.code).toBe("mirror_missing_grant");
    expect(error.status).toBe(403);
  });
});
