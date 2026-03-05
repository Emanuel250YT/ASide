import { ArkaCDN } from "arka-cdn";

//#region src/types.d.ts
/**
 * Base profile data stored on-chain. Identical across all apps and chains.
 * Only wallet + uuid are immutable; the rest can be updated via `client.update()`.
 */
interface BaseProfileData {
  /** Stable cross-chain identifier. Never changes once set. */
  uuid: string;
  /** Blockchain wallet address that owns this profile. */
  wallet: string;
  /** Profile photo URL or ArkaCDN entity key. */
  photo: string;
  /** Optional display name. */
  displayName?: string;
  /** Optional short bio. */
  bio?: string;
  /** Unix timestamp (ms) of initial profile creation. */
  createdAt: number;
  /** Unix timestamp (ms) of last profile update. */
  updatedAt: number;
  /**
   * Entity key of the source profile when this was replicated from another chain.
   * Undefined for profiles created natively on this chain.
   */
  syncedFrom?: string;
}
/**
 * App-specific extension data stored as a separate entity linked to a base profile.
 * Independent from the base client — each app manages its own namespace.
 *
 * @template T Shape of the app-specific data object.
 */
interface ExtensionData<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Identifies which app this extension belongs to (e.g. "my-game", "my-dapp"). */
  namespace: string;
  /** UUID of the base profile this extension is linked to. */
  uuid: string;
  /** Wallet address of the profile owner. */
  wallet: string;
  /** The app-specific data blob. */
  data: T;
  /** Unix timestamp (ms) when this extension was first created. */
  createdAt: number;
  /** Unix timestamp (ms) of the last extension update. */
  updatedAt: number;
}
/**
 * Options for constructing a {@link BaseClientInstance} via {@link createBaseClient}.
 *
 * @example
 * ```ts
 * const client = createBaseClient({
 *   uuid: 'my-uuid',
 *   wallet: '0x...',
 *   photo: 'https://...',
 *   cdn,
 * })
 * ```
 */
interface BaseClientOptions {
  /** Stable cross-chain identifier. Generate once with `generateUUID()` from arka-cdn. */
  uuid: string;
  /** Blockchain wallet address. */
  wallet: string;
  /** Profile photo URL or ArkaCDN entity key. */
  photo: string;
  /** Optional display name. */
  displayName?: string;
  /** Optional short bio. */
  bio?: string;
  /** ArkaCDN instance configured for the current chain. */
  cdn: ArkaCDN;
}
/** Returned by base profile operations (get, getOrCreate, update, sync). */
interface BaseProfileResult {
  /** On-chain entity key of the profile entity. */
  entityKey: string;
  /** The resolved profile data. */
  profile: BaseProfileData;
}
/**
 * Returned by extension operations (get, getOrCreate, update).
 * @template T Shape of the app-specific data.
 */
interface ExtensionResult<T extends Record<string, unknown>> {
  /** On-chain entity key of the extension entity. */
  entityKey: string;
  /** The resolved extension data including app-specific payload. */
  extension: ExtensionData<T>;
}
/**
 * The main base client instance.
 * Manages a profile (uuid + wallet + photo + optional info) on the current chain.
 * The same profile is interoperable across all chains and apps.
 */
interface BaseClientInstance {
  /** The profile's stable identifier. */
  readonly uuid: string;
  /** The wallet address that owns this profile. */
  readonly wallet: string;
  /**
   * Fetches the profile from the current chain.
   * Returns `null` if no profile exists yet.
   */
  get(): Promise<BaseProfileResult | null>;
  /**
   * Fetches the profile from the current chain.
   * If no profile exists, creates one with the options passed to `createBaseClient`.
   */
  getOrCreate(): Promise<BaseProfileResult>;
  /**
   * Updates mutable fields of an existing profile on the current chain.
   * Throws if the profile has not been created yet.
   */
  update(data: Partial<Pick<BaseProfileData, 'photo' | 'displayName' | 'bio'>>): Promise<BaseProfileResult>;
  /**
   * Cross-chain sync: looks for the profile on the current chain first.
   * If not found, checks each supplied CDN (other chains) in order.
   * When a match is found it is **replicated** to the current chain automatically.
   * If the profile does not exist anywhere, it is created fresh.
   *
   * @param otherChains - ArkaCDN instances pointing to other chains to search.
   */
  sync(otherChains: ArkaCDN[]): Promise<BaseProfileResult>;
  /**
   * Returns an {@link ExtensionClientInstance} scoped to `namespace`.
   * The extension is independent of the base client and stores app-specific data.
   *
   * @param namespace - A unique app identifier (e.g. `"my-game"`, `"my-dapp"`).
   *
   * @example
   * ```ts
   * const gameExt = client.extend<{ score: number; level: number }>('my-game')
   * const { extension } = await gameExt.getOrCreate({ score: 0, level: 1 })
   * ```
   */
  extend<T extends Record<string, unknown>>(namespace: string): ExtensionClientInstance<T>;
}
/**
 * An app-specific extension client linked to a base profile.
 * Fully independent from the base client — the base profile is never modified.
 *
 * @template T Shape of the app-specific data.
 */
interface ExtensionClientInstance<T extends Record<string, unknown>> {
  /**
   * Fetches the extension from the chain.
   * Returns `null` if the extension does not exist yet.
   */
  get(): Promise<ExtensionResult<T> | null>;
  /**
   * Fetches the extension. If it does not exist, creates it with `initialData`.
   */
  getOrCreate(initialData: T): Promise<ExtensionResult<T>>;
  /**
   * Partially updates the extension data.
   * Throws if the extension has not been created yet.
   */
  update(data: Partial<T>): Promise<ExtensionResult<T>>;
}
//#endregion
//#region src/client.d.ts
/**
 * Creates a {@link BaseClientInstance} for the given identity.
 *
 * The base client manages a single profile entity on-chain.
 * The same `uuid` + `wallet` combination identifies the same profile
 * across all chains and apps — making it the universal identity anchor.
 *
 * @example Minimal setup
 * ```ts
 * import { createArkaCDN, PublicClient, WalletClient } from 'arka-cdn'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { createBaseClient } from 'aside'
 *
 * const cdn = createArkaCDN({
 *   publicClient: new PublicClient(),
 *   wallets: new WalletClient({ account: privateKeyToAccount(process.env.PK!) }),
 * })
 *
 * const client = createBaseClient({
 *   uuid: 'a94a8fe5-ccb1-4a6a-a1a1-1f8e8b9b1',
 *   wallet: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
 *   photo: 'https://example.com/avatar.png',
 *   cdn,
 * })
 *
 * const { profile } = await client.getOrCreate()
 * ```
 *
 * @example With optional fields
 * ```ts
 * const client = createBaseClient({
 *   uuid,
 *   wallet,
 *   photo,
 *   displayName: 'vitalik.eth',
 *   bio: 'Ethereum co-founder',
 *   cdn,
 * })
 * ```
 *
 * @example Cross-chain sync (replicates from another chain automatically)
 * ```ts
 * const { profile } = await client.sync([polygonCdn, arbitrumCdn])
 * ```
 *
 * @example App-specific extension (independent data per app)
 * ```ts
 * const gameExt = client.extend<{ score: number; level: number }>('my-game')
 * const { extension } = await gameExt.getOrCreate({ score: 0, level: 1 })
 * await gameExt.update({ score: extension.data.score + 100 })
 * ```
 */
declare function createBaseClient(options: BaseClientOptions): BaseClientInstance;
//#endregion
//#region src/constants.d.ts
/** Shared attribute keys used for all ASide entities. */
declare const ATTR_TYPE = "aside.type";
declare const ATTR_UUID = "aside.uuid";
declare const ATTR_WALLET = "aside.wallet";
declare const ATTR_NAMESPACE = "aside.namespace";
/** Entity type discriminators stored in `aside.type`. */
declare const PROFILE_TYPE = "profile";
declare const EXTENSION_TYPE = "extension";
/**
 * Default entity TTL: 365 days in seconds.
 * Profiles and extensions expire after one year unless renewed.
 */
declare const DEFAULT_EXPIRY_SECONDS: number;
//#endregion
export { ATTR_NAMESPACE, ATTR_TYPE, ATTR_UUID, ATTR_WALLET, type BaseClientInstance, type BaseClientOptions, type BaseProfileData, type BaseProfileResult, DEFAULT_EXPIRY_SECONDS, EXTENSION_TYPE, type ExtensionClientInstance, type ExtensionData, type ExtensionResult, PROFILE_TYPE, createBaseClient };
//# sourceMappingURL=index.d.cts.map