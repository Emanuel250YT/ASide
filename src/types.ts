import type { ArkaCDN } from 'arka-cdn'

// ─── Core profile data ────────────────────────────────────────────────────────

/**
 * Base profile data stored on-chain. Identical across all apps and chains.
 * Only wallet + uuid are immutable; the rest can be updated via `client.update()`.
 */
export interface BaseProfileData {
  /** Stable cross-chain identifier. Never changes once set. */
  uuid: string
  /** Blockchain wallet address that owns this profile. */
  wallet: string
  /** Profile photo URL or ArkaCDN entity key. */
  photo: string
  /** Optional display name. */
  displayName?: string
  /** Optional short bio. */
  bio?: string
  /** Unix timestamp (ms) of initial profile creation. */
  createdAt: number
  /** Unix timestamp (ms) of last profile update. */
  updatedAt: number
  /**
   * Entity key of the source profile when this was replicated from another chain.
   * Undefined for profiles created natively on this chain.
   */
  syncedFrom?: string
}

// ─── Extension data ────────────────────────────────────────────────────────────

/**
 * App-specific extension data stored as a separate entity linked to a base profile.
 * Independent from the base client — each app manages its own namespace.
 *
 * @template T Shape of the app-specific data object.
 */
export interface ExtensionData<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Identifies which app this extension belongs to (e.g. "my-game", "my-dapp"). */
  namespace: string
  /** UUID of the base profile this extension is linked to. */
  uuid: string
  /** Wallet address of the profile owner. */
  wallet: string
  /** The app-specific data blob. */
  data: T
  /** Unix timestamp (ms) when this extension was first created. */
  createdAt: number
  /** Unix timestamp (ms) of the last extension update. */
  updatedAt: number
}

// ─── Options ───────────────────────────────────────────────────────────────────

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
export interface BaseClientOptions {
  /** Stable cross-chain identifier. Generate once with `generateUUID()` from arka-cdn. */
  uuid: string
  /** Blockchain wallet address. */
  wallet: string
  /** Profile photo URL or ArkaCDN entity key. */
  photo: string
  /** Optional display name. */
  displayName?: string
  /** Optional short bio. */
  bio?: string
  /** ArkaCDN instance configured for the current chain. */
  cdn: ArkaCDN
}

// ─── Result shapes ─────────────────────────────────────────────────────────────

/** Returned by base profile operations (get, getOrCreate, update, sync). */
export interface BaseProfileResult {
  /** On-chain entity key of the profile entity. */
  entityKey: string
  /** The resolved profile data. */
  profile: BaseProfileData
}

/**
 * Returned by extension operations (get, getOrCreate, update).
 * @template T Shape of the app-specific data.
 */
export interface ExtensionResult<T extends Record<string, unknown>> {
  /** On-chain entity key of the extension entity. */
  entityKey: string
  /** The resolved extension data including app-specific payload. */
  extension: ExtensionData<T>
}

// ─── Client interfaces ─────────────────────────────────────────────────────────

/**
 * The main base client instance.
 * Manages a profile (uuid + wallet + photo + optional info) on the current chain.
 * The same profile is interoperable across all chains and apps.
 */
export interface BaseClientInstance {
  /** The profile's stable identifier. */
  readonly uuid: string
  /** The wallet address that owns this profile. */
  readonly wallet: string

  /**
   * Fetches the profile from the current chain.
   * Returns `null` if no profile exists yet.
   */
  get(): Promise<BaseProfileResult | null>

  /**
   * Fetches the profile from the current chain.
   * If no profile exists, creates one with the options passed to `createBaseClient`.
   */
  getOrCreate(): Promise<BaseProfileResult>

  /**
   * Updates mutable fields of an existing profile on the current chain.
   * Throws if the profile has not been created yet.
   */
  update(data: Partial<Pick<BaseProfileData, 'photo' | 'displayName' | 'bio'>>): Promise<BaseProfileResult>

  /**
   * Cross-chain sync: looks for the profile on the current chain first.
   * If not found, checks each supplied CDN (other chains) in order.
   * When a match is found it is **replicated** to the current chain automatically.
   * If the profile does not exist anywhere, it is created fresh.
   *
   * @param otherChains - ArkaCDN instances pointing to other chains to search.
   */
  sync(otherChains: ArkaCDN[]): Promise<BaseProfileResult>

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
  extend<T extends Record<string, unknown>>(namespace: string): ExtensionClientInstance<T>
}

/**
 * An app-specific extension client linked to a base profile.
 * Fully independent from the base client — the base profile is never modified.
 *
 * @template T Shape of the app-specific data.
 */
export interface ExtensionClientInstance<T extends Record<string, unknown>> {
  /**
   * Fetches the extension from the chain.
   * Returns `null` if the extension does not exist yet.
   */
  get(): Promise<ExtensionResult<T> | null>

  /**
   * Fetches the extension. If it does not exist, creates it with `initialData`.
   */
  getOrCreate(initialData: T): Promise<ExtensionResult<T>>

  /**
   * Partially updates the extension data.
   * Throws if the extension has not been created yet.
   */
  update(data: Partial<T>): Promise<ExtensionResult<T>>
}
