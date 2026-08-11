import { Effect, Layer, Redacted } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Captures what `SuiGrpcClient` was constructed with. `vi.hoisted` because
 * `vi.mock` factories are lifted above the imports below, so a plain `const`
 * would still be in its temporal dead zone when the factory runs.
 */
const { grpcConstructorOptions } = vi.hoisted(() => ({
  grpcConstructorOptions: [] as unknown[],
}));

vi.mock("@mysten/sui/grpc", () => ({
  SuiGrpcClient: class {
    constructor(options: unknown) {
      grpcConstructorOptions.push(options);
    }
  },
}));

import { type ConsoleConfig, ConsoleConfigTag } from "../src/config";
import { resolveFullnodeUrl } from "../src/console/packageConfig";
import { SealCryptoService } from "../src/console/SealCryptoService";

function makeConfig(baseUrl: string): ConsoleConfig {
  return {
    apiKey: Redacted.make("hbr_working_key_value"),
    servicePrivateKey: Redacted.make(""),
    adminKey: Redacted.make("hbradm_x"),
    adminServicePrivateKey: Redacted.make(""),
    baseUrl,
  } satisfies ConsoleConfig;
}

/**
 * Build the service so its constructor-time wiring runs. The Sui and Seal
 * clients are stateless config holders — `SealClient` only stores what it is
 * handed — so nothing here reaches the network.
 */
async function constructServiceWith(baseUrl: string): Promise<void> {
  const layer = SealCryptoService.DefaultWithoutDependencies.pipe(
    Layer.provide(Layer.succeed(ConsoleConfigTag, makeConfig(baseUrl))),
  );
  await Effect.runPromise(SealCryptoService.pipe(Effect.asVoid, Effect.provide(layer)));
}

/**
 * The network is derived from the Console API base URL rather than configured,
 * and nothing else in the suite observes that it reaches the Sui client:
 * re-pinning `network: "testnet"` here — which is what `main` carries, so it is
 * a plausible merge-conflict resolution — leaves every other test green while
 * pointing mainnet decrypts at a testnet fullnode.
 */
describe("SealCryptoService — Sui client follows the resolved network", () => {
  beforeEach(() => {
    grpcConstructorOptions.length = 0;
  });

  it("points at the testnet fullnode for a testnet Console host", async () => {
    await constructServiceWith("https://api.testnet.harbor.walrus.xyz");

    expect(grpcConstructorOptions).toEqual([
      { baseUrl: resolveFullnodeUrl("testnet"), network: "testnet" },
    ]);
  });

  it("points at the mainnet fullnode for a mainnet Console host", async () => {
    await constructServiceWith("https://api.mainnet.harbor.walrus.xyz");

    expect(grpcConstructorOptions).toEqual([
      { baseUrl: resolveFullnodeUrl("mainnet"), network: "mainnet" },
    ]);
  });
});
