/**
 * Seal constants for Walrus Console.
 *
 * Package identifiers moved to `packageConfig.ts` — they are network-dependent and
 * change on every contract redeploy, so they are resolved rather than pinned here.
 */

// Seal key servers on testnet (threshold = 2 out of 3).
export const SEAL_KEY_SERVER_OBJECT_IDS = [
  "0x6068c0acb197dddbacd4746a9de7f025b2ed5a5b6c1b1ab44dade4426d141da2",
  "0x164ac3d2b3b8694b8181c13f671950004765c23f270321a45fdd04d40cccf0f2",
  "0x9c949e53c36ab7a9c484ed9e8b43267a77d4b8d70e79aa6b39042e3d4c434105",
] as const;

// BCS schema for Seal identity (must exactly match the on-chain `seal_approve` check).
import { bcs } from "@mysten/sui/bcs";

export const SealIdentity = bcs.struct("SealIdentity", {
  policyObjectId: bcs.Address,
  nonce: bcs.fixedArray(32, bcs.u8()),
});

export type SealIdentityInput = {
  policyObjectId: string;
  nonce: number[];
};
