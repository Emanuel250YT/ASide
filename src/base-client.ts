/**
 * BaseClient — the core ASide identity class.
 *
 * Manages a single profile (uuid + wallet + photo) across all chains and apps.
 * Designed to be extended (Discord.js style):
 *
 * ```ts
 * class MyClient extends BaseClient {
 *   async fetchReputation() { ... }
 * }
 * ```
 *
 * CDN is optional at construction — pass it immediately or set it later via `setCdn()`:
 *
 * ```ts
 * const client = new BaseClient({ uuid, wallet, photo })
 * client.setCdn(myCdn)
 * await client.getOrCreate()
 * ```
 *
 * Or with CDN at construction:
 *
 * ```ts
 * const client = new BaseClient({ uuid, wallet, photo, cdn: kaolinCdn })
 * ```
 */

import { eq, jsonToPayload, ExpirationTime } from 'arka-cdn'
import type { ArkaCDN, Hex } from 'arka-cdn'
import {
  ATTR_TYPE,
  ATTR_UUID,
  ATTR_WALLET,
  DEFAULT_EXPIRY_SECONDS,
  PROFILE_TYPE,
} from './constants.js'
import { ExtensionClient } from './extension.js'
import { AccessTokenManager } from './access-token.js'
import { ProfileWatcher } from './watcher.js'
import { SocialClient } from './social.js'
import { FeedClient } from './feed.js'
import type {
  BaseClientOptions,
  BaseProfileData,
  BaseProfileResult,
  CreateAccessTokenOptions,
  CreateAccessTokenResult,
  GetOrCreateOptions,
  WatcherOptions,
} from './types.js'

export class BaseClient {
  uuid: string
  wallet: string
  photo: string
  displayName: string | undefined
  bio: string | undefined

  protected _cdn: ArkaCDN | undefined

  constructor(options: BaseClientOptions) {
    this.uuid = options.uuid
    this.wallet = options.wallet
    this.photo = options.photo
    this.displayName = options.displayName
    this.bio = options.bio
    this._cdn = options.cdn
  }

  // ─── CDN management ───────────────────────────────────────────────────────

  /**
   * Sets (or replaces) the ArkaCDN instance used by this client.
   * Useful when the CDN is created after the client.
   */
  setCdn(cdn: ArkaCDN): this {
    this._cdn = cdn
    return this
  }

  /** Returns the current ArkaCDN instance. Throws if not set. */
  get cdn(): ArkaCDN {
    if (!this._cdn) {
      throw new Error(
        'ASide: no CDN configured. Pass `cdn` to the constructor or call `setCdn()` first.',
      )
    }
    return this._cdn
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  protected async findProfile(searchCdn: ArkaCDN): Promise<BaseProfileResult | null> {
    const result = await searchCdn.entity
      .query()
      .where([
        eq(ATTR_TYPE, PROFILE_TYPE),
        eq(ATTR_WALLET, this.wallet),
      ])
      .withPayload(true)
      .withAttributes(true)
      .fetch()

    if (result.entities.length === 0) return null

    // Keep only entities that genuinely belong to this wallet:
    //   1. The on-chain entity owner (the wallet that signed the transaction) must
    //      match when the chain exposes it.
    //   2. The payload's wallet field must also match (guards against spoofed payloads).
    const valid = result.entities
      .map(e => ({ entity: e, profile: e.toJson() as BaseProfileData }))
      .filter(({ entity, profile }) => {
        if (profile.wallet.toLowerCase() !== this.wallet.toLowerCase()) return false
        const owner = (entity as { owner?: string }).owner
        if (owner && owner.toLowerCase() !== this.wallet.toLowerCase()) return false
        return true
      })

    if (valid.length === 0) return null

    // Always resolve to the oldest profile for this wallet so that migrations,
    // re-creations, and multi-chain scenarios consistently produce one canonical
    // identity.
    valid.sort((a, b) => a.profile.createdAt - b.profile.createdAt)

    const { entity, profile } = valid[0]!

    // UUID discovery — the canonical UUID is the one stored in the oldest
    // on-chain profile.  The uuid passed to the constructor is only the
    // "proposed" value used when no profile exists yet.
    this.uuid = profile.uuid

    // Sync mutable fields.
    this.bio = profile.bio
    this.displayName = profile.displayName
    this.photo = profile.photo

    return { entityKey: entity.key, profile }
  }

  private async createProfileOn(
    targetCdn: ArkaCDN,
    syncedFrom?: string,
  ): Promise<BaseProfileResult> {
    const now = Date.now()
    const profileData: BaseProfileData = {
      uuid: this.uuid,
      wallet: this.wallet,
      photo: this.photo,
      ...(this.displayName != null ? { displayName: this.displayName } : {}),
      ...(this.bio != null ? { bio: this.bio } : {}),
      createdAt: now,
      updatedAt: now,
      ...(syncedFrom != null ? { syncedFrom } : {}),
    }

    const { entityKey } = await targetCdn.entity.create({
      payload: jsonToPayload(profileData),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: PROFILE_TYPE },
        { key: ATTR_UUID, value: this.uuid },
        { key: ATTR_WALLET, value: this.wallet },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })

    return { entityKey, profile: profileData }
  }

  // ─── Public profile API ───────────────────────────────────────────────────

  /**
   * Fetches the profile from the current chain.
   * Returns `null` if no profile exists yet.
   */
  async get(): Promise<BaseProfileResult | null> {
    return this.findProfile(this.cdn)
  }

  /**
   * Fetches the profile from a specific CDN instance (not the default one).
   * Used by the watcher and cross-chain sync.
   */
  async getOnChain(cdn: ArkaCDN): Promise<BaseProfileResult | null> {
    return this.findProfile(cdn)
  }

  /**
   * Fetches the profile. If none exists, creates it on the current chain.
   */
  async getOrCreate(options?: GetOrCreateOptions): Promise<BaseProfileResult> {
    const existing = await this.findProfile(this.cdn)
    if (existing) return existing

    // UUID collision detection: before writing, check whether the proposed UUID
    // is already claimed by a *different* wallet.  If so, and the caller opted
    // in to automatic collision resolution, generate a fresh UUID so the new
    // profile doesn't collide with an unrelated one.
    if (options?.autoRetryOnUuidConflict) {
      const conflictResult = await this.cdn.entity
        .query()
        .where([eq(ATTR_TYPE, PROFILE_TYPE), eq(ATTR_UUID, this.uuid)])
        .withPayload(true)
        .fetch()

      const conflict = conflictResult.entities.find((e) => {
        const p = e.toJson() as BaseProfileData
        return p.wallet.toLowerCase() !== this.wallet.toLowerCase()
      })

      if (conflict) {
        // Proposed UUID is taken by a different wallet — mint a new one.
        this.uuid = crypto.randomUUID()
      }
    }

    return this.createProfileOn(this.cdn)
  }

  /**
   * Updates mutable profile fields on the current chain.
   * Throws if the profile has not been created yet.
   */
  async update(
    data: Partial<Pick<BaseProfileData, 'photo' | 'displayName' | 'bio'>>,
  ): Promise<BaseProfileResult> {
    const existing = await this.findProfile(this.cdn)
    if (!existing) {
      throw new Error(
        `ASide: profile not found for uuid="${this.uuid}". Call getOrCreate() first.`,
      )
    }

    const now = Date.now()
    const updated: BaseProfileData = {
      ...existing.profile,
      ...data,
      // Immutable fields — always force them back
      uuid: this.uuid,
      wallet: this.wallet,
      updatedAt: now,
    }

    await this.cdn.entity.update({
      entityKey: existing.entityKey as Hex,
      payload: jsonToPayload(updated),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: PROFILE_TYPE },
        { key: ATTR_UUID, value: this.uuid },
        { key: ATTR_WALLET, value: this.wallet },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })

    // Keep in-memory state coherent with what was just written on-chain.
    this.photo = updated.photo
    this.displayName = updated.displayName
    this.bio = updated.bio

    return { entityKey: existing.entityKey, profile: updated }
  }

  /**
   * Cross-chain sync.
   *
   * 1. If the profile exists on the current chain → return it.
   * 2. Search each CDN in `otherChains` in order.
   *    If found → replicate to the current chain and return.
   * 3. If not found anywhere → create fresh on the current chain.
   *
   * @param otherChains ArkaCDN instances for other chains (e.g. kaolin, mendoza).
   */
  async sync(otherChains: ArkaCDN[]): Promise<BaseProfileResult> {
    const existing = await this.findProfile(this.cdn)
    if (existing) return existing

    for (const otherCdn of otherChains) {
      const found = await this.findProfile(otherCdn)
      if (found) {
        const now = Date.now()
        const replicatedData: BaseProfileData = {
          ...found.profile,
          updatedAt: now,
          syncedFrom: found.entityKey,
        }

        const { entityKey } = await this.cdn.entity.create({
          payload: jsonToPayload(replicatedData),
          contentType: 'application/json',
          attributes: [
            { key: ATTR_TYPE, value: PROFILE_TYPE },
            { key: ATTR_UUID, value: this.uuid },
            { key: ATTR_WALLET, value: this.wallet },
          ],
          expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
        })

        return { entityKey, profile: replicatedData }
      }
    }

    return this.createProfileOn(this.cdn)
  }

  // ─── Extensions ───────────────────────────────────────────────────────────

  /**
   * Returns an {@link ExtensionClient} scoped to `namespace`.
   * Each namespace is independent — apps never touch each other's data.
   *
   * @example
   * ```ts
   * const gameExt = client.extend<{ score: number; level: number }>('my-game')
   * const { extension } = await gameExt.getOrCreate({ score: 0, level: 1 })
   * ```
   */
  extend<T extends Record<string, unknown>>(namespace: string): ExtensionClient<T> {
    return new ExtensionClient<T>(namespace, this.cdn, this.uuid, this.wallet)
  }

  // ─── Social features ──────────────────────────────────────────────────────

  /**
   * Returns a {@link SocialClient} for managing follows, friends, and blocks.
   *
   * @example
   * ```ts
   * const social = client.social()
   * await social.follow('target-uuid')
   * const followers = await social.getFollowers()
   * ```
   */
  social(): SocialClient {
    return new SocialClient(this.cdn, this.uuid, this.wallet)
  }

  /**
   * Returns a {@link FeedClient} for managing posts, reactions, and comments.
   *
   * @example
   * ```ts
   * const feed = client.feed()
   * const post = await feed.createPost({ content: 'Hello world!' })
   * await feed.like(post.entityKey)
   * ```
   */
  feed(): FeedClient {
    return new FeedClient(this.cdn, this.uuid, this.wallet)
  }

  // ─── Access tokens ────────────────────────────────────────────────────────

  /**
   * Creates a sealed access token for a third-party app using ECDH P-256.
   *
   * The token's claims include this client's `uuid` and `wallet` as issuer info.
   * The caller must supply the app server's `appPublicKey` (P-256 public key hex).
   *
   * Returns `{ token, sessionKey }`.  Keep `sessionKey` client-side for signing
   * subsequent session requests.
   *
   * @example
   * ```ts
   * const { token, sessionKey } = await client.createAccessToken({
   *   appId:        'my-dapp',
   *   domain:       'my-dapp.com',
   *   permissions:  3n,
   *   appPublicKey: keyFromServer,
   *   phrase:       mySecretPhrase,
   * })
   * ```
   */
  async createAccessToken(
    options: Omit<CreateAccessTokenOptions, 'issuerUuid' | 'issuerWallet'>,
  ): Promise<CreateAccessTokenResult> {
    const manager = new AccessTokenManager()
    return manager.create({
      ...options,
      issuerUuid: this.uuid,
      issuerWallet: this.wallet,
    })
  }

  // ─── Watcher ──────────────────────────────────────────────────────────────

  /**
   * Creates a {@link ProfileWatcher} for this client.
   *
   * @example
   * ```ts
   * const watcher = client.watch({
   *   chains: [
   *     { name: 'kaolin', cdn: kaolinCdn },
   *     { name: 'mendoza', cdn: mendozaCdn },
   *   ],
   *   onFound: (chain, result) => console.log(`Found on ${chain}`, result),
   * })
   * watcher.start()
   * ```
   */
  watch(opts: WatcherOptions): ProfileWatcher {
    return new ProfileWatcher(this, opts)
  }

  // ─── File storage (arka-cdn file API) ──────────────────────────────────────

  /**
   * Uploads an image buffer to ArkaCDN's chunked file storage and sets
   * `this.photo` to the returned manifest key.
   *
   * The manifest key has a `0x` prefix and can be passed directly to
   * `client.update({ photo: manifestKey })` or to `downloadPhoto()`.
   *
   * @example
   * ```ts
   * import { readFileSync } from 'node:fs'
   * const buf = readFileSync('avatar.png')
   * const key = await client.uploadPhoto(buf, { filename: 'avatar.png', mimeType: 'image/png' })
   * await client.update({ photo: key })
   * ```
   */
  async uploadPhoto(
    buffer: Uint8Array | ArrayBuffer,
    options?: { filename?: string; mimeType?: string },
  ): Promise<string> {
    type FileService = {
      upload(data: Uint8Array, opts: { filename: string; mimeType: string }): Promise<{ manifestKey: string }>
    }
    const fileService = (this.cdn as ArkaCDN & { file: FileService }).file
    const data = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer
    const { manifestKey } = await fileService.upload(data, {
      filename: options?.filename ?? 'photo',
      mimeType: options?.mimeType ?? 'image/jpeg',
    })
    this.photo = manifestKey
    return manifestKey
  }

  /**
   * Downloads the profile photo from ArkaCDN file storage.
   * Returns `null` when `this.photo` is a plain URL (not a manifest key).
   *
   * A manifest key is recognisable by its `0x` prefix — exactly what
   * `uploadPhoto()` returns.
   *
   * @example
   * ```ts
   * const result = await client.downloadPhoto()
   * if (result) {
   *   const blob = new Blob([result.data], { type: result.mimeType })
   * }
   * ```
   */
  async downloadPhoto(options?: {
    encryption?: { phrase: string; secret: string }
    onProgress?: (progress: { fetched: number; total: number }) => void
  }): Promise<{ data: Uint8Array; filename: string; mimeType: string; size: number } | null> {
    if (!this.photo || !this.photo.startsWith('0x')) return null
    type FileService = {
      download(key: string, opts?: object): Promise<{ data: Uint8Array; filename: string; mimeType: string; size: number }>
    }
    const fileService = (this.cdn as ArkaCDN & { file: FileService }).file
    return fileService.download(this.photo, options ?? {})
  }
}
