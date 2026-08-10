import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { canReuseSessionKey, singleFlight } from "../src/console/SealCryptoService";

/**
 * Unit tests for the SessionKey caching decisions. The full decrypt() path is not
 * exercised here: it would require mocking four SDK surfaces at once
 * (@mysten/seal SessionKey/SealClient/EncryptedObject, @mysten/sui Transaction,
 * and the gRPC client) with no existing mock scaffolding in the repo. The two
 * pieces of decision logic — when a cached key may be reused, and how concurrent
 * cold callers share one creation — are extracted and tested directly.
 */

const ADDR = "0xabc";
const fresh = { address: ADDR, sessionKey: { isExpired: () => false } };
const expired = { address: ADDR, sessionKey: { isExpired: () => true } };

describe("canReuseSessionKey", () => {
  it("returns false when there is no cached key", () => {
    expect(canReuseSessionKey(undefined, ADDR)).toBe(false);
  });

  it("returns true for a matching address that is not expired", () => {
    expect(canReuseSessionKey(fresh, ADDR)).toBe(true);
  });

  it("returns false when the cached key has expired", () => {
    expect(canReuseSessionKey(expired, ADDR)).toBe(false);
  });

  it("returns false when the signer address differs", () => {
    expect(canReuseSessionKey(fresh, "0xdifferent")).toBe(false);
  });
});

describe("singleFlight", () => {
  /**
   * A cache + an async create, wired exactly as getSessionKey wires them. `create`
   * yields to the event loop before storing, which is what let concurrent callers
   * all miss the cache in the pre-fix code.
   */
  function makeSubject(behavior: "succeed" | "fail" = "succeed") {
    let cached: string | undefined;
    let creates = 0;
    const lock = Effect.runSync(Effect.makeSemaphore(1));
    const create = Effect.gen(function* () {
      creates += 1;
      yield* Effect.sleep("10 millis"); // stands in for the getObject RPC + signature
      if (behavior === "fail") return yield* Effect.fail("boom" as const);
      cached = `session-${creates}`;
      return cached;
    });
    return {
      creates: () => creates,
      get: () => singleFlight(lock, () => cached, create),
      evict: () => {
        cached = undefined;
      },
    };
  }

  // Regression: five parallel download_file calls on a cold cache used to issue
  // five SessionKey.create() round-trips, because each read the empty cache
  // before the first create resolved.
  it("runs create once for many concurrent cold callers", async () => {
    const subject = makeSubject();
    const results = await Effect.runPromise(
      Effect.all(
        Array.from({ length: 5 }, () => subject.get()),
        { concurrency: "unbounded" },
      ),
    );
    expect(subject.creates()).toBe(1);
    expect(results).toEqual(Array.from({ length: 5 }, () => "session-1"));
  });

  it("serves a warm cache without touching the lock", async () => {
    const subject = makeSubject();
    await Effect.runPromise(subject.get());
    await Effect.runPromise(subject.get());
    expect(subject.creates()).toBe(1);
  });

  it("creates again after the cached value is evicted (expiry)", async () => {
    const subject = makeSubject();
    await Effect.runPromise(subject.get());
    subject.evict();
    const second = await Effect.runPromise(subject.get());
    expect(subject.creates()).toBe(2);
    expect(second).toBe("session-2");
  });

  // A failed create must not wedge the lock or leave a stale in-flight entry:
  // the permit is released with the cache still empty, so the next caller retries.
  it("propagates a create failure and lets the next caller retry", async () => {
    const failing = makeSubject("fail");
    const error = await Effect.runPromise(Effect.flip(failing.get()));
    expect(error).toBe("boom");
    await Effect.runPromise(Effect.flip(failing.get()));
    expect(failing.creates()).toBe(2);
  });
});
