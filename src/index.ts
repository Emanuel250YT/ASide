/**
 * ASide — Temporary user profiles linked to blockchain wallets.
 *
 * Cross-chain identity layer built on ArkaCDN / Arkiv Network.
 *
 * ## Core concepts
 *
 * - **BaseClient** — the same profile (uuid + wallet + photo) everywhere.
 *   Create once, replicate automatically across chains.
 * - **Extension** — app-specific data stored independently of the base profile.
 *   Each app manages its own namespace without touching the base client.
 *
 * ## Quick start
 *
 * ```ts
 * import { createArkaCDN, PublicClient, WalletClient, generateUUID } from 'arka-cdn'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { createBaseClient } from 'aside'
 *
 * const cdn = createArkaCDN({
 *   publicClient: new PublicClient(),
 *   wallets: new WalletClient({ account: privateKeyToAccount(process.env.PK!) }),
 * })
 *
 * // 1. Create the base client — identical identity across all chains & apps
 * const client = createBaseClient({
 *   uuid: generateUUID(),   // generate once, save this value
 *   wallet: '0x...',
 *   photo: 'https://example.com/avatar.png',
 *   displayName: 'Alice',
 *   cdn,
 * })
 *
 * // 2. Get or create the on-chain profile
 * const { profile } = await client.getOrCreate()
 *
 * // 3. Sync from another chain (auto-replicates if found elsewhere)
 * const { profile } = await client.sync([polygonCdn, arbitrumCdn])
 *
 * // 4. App-specific extension (independent, typed, per-namespace)
 * const gameExt = client.extend<{ score: number; level: number }>('my-game')
 * const { extension } = await gameExt.getOrCreate({ score: 0, level: 1 })
 * await gameExt.update({ score: extension.data.score + 100 })
 * ```
 *
 * @module
 */

export { createBaseClient } from './client.js'
export type {
  BaseClientInstance,
  BaseClientOptions,
  BaseProfileData,
  BaseProfileResult,
  ExtensionClientInstance,
  ExtensionData,
  ExtensionResult,
} from './types.js'
export { ATTR_NAMESPACE, ATTR_TYPE, ATTR_UUID, ATTR_WALLET, DEFAULT_EXPIRY_SECONDS, EXTENSION_TYPE, PROFILE_TYPE } from './constants.js'
