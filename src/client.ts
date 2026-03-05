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
import type {
  BaseClientInstance,
  BaseClientOptions,
  BaseProfileData,
  BaseProfileResult,
} from './types.js'

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
export function createBaseClient(options: BaseClientOptions): BaseClientInstance {
  const { uuid, wallet, photo, displayName, bio, cdn } = options

  async function findProfile(searchCdn: ArkaCDN): Promise<BaseProfileResult | null> {
    const result = await searchCdn.entity
      .query()
      .where([
        eq(ATTR_TYPE, PROFILE_TYPE),
        eq(ATTR_UUID, uuid),
        eq(ATTR_WALLET, wallet),
      ])
      .withPayload(true)
      .withAttributes(true)
      .fetch()

    const entity = result.entities[0]
    if (!entity) return null

    const profile = entity.toJson() as BaseProfileData
    return { entityKey: entity.key, profile }
  }

  async function createProfile(syncedFrom?: string): Promise<BaseProfileResult> {
    const now = Date.now()
    const profileData: BaseProfileData = {
      uuid,
      wallet,
      photo,
      ...(displayName != null ? { displayName } : {}),
      ...(bio != null ? { bio } : {}),
      createdAt: now,
      updatedAt: now,
      ...(syncedFrom != null ? { syncedFrom } : {}),
    }

    const { entityKey } = await cdn.entity.create({
      payload: jsonToPayload(profileData),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: PROFILE_TYPE },
        { key: ATTR_UUID, value: uuid },
        { key: ATTR_WALLET, value: wallet },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })

    return { entityKey, profile: profileData }
  }

  return {
    get uuid() {
      return uuid
    },

    get wallet() {
      return wallet
    },

    async get() {
      return findProfile(cdn)
    },

    async getOrCreate() {
      const existing = await findProfile(cdn)
      if (existing) return existing
      return createProfile()
    },

    async update(data) {
      const existing = await findProfile(cdn)
      if (!existing) {
        throw new Error(
          `ASide: profile not found for uuid="${uuid}". Call getOrCreate() first.`,
        )
      }

      const now = Date.now()
      const updated: BaseProfileData = {
        ...existing.profile,
        ...data,
        // These fields are immutable — always force them back.
        uuid,
        wallet,
        updatedAt: now,
      }

      await cdn.entity.update({
        entityKey: existing.entityKey as Hex,
        payload: jsonToPayload(updated),
        contentType: 'application/json',
        attributes: [
          { key: ATTR_TYPE, value: PROFILE_TYPE },
          { key: ATTR_UUID, value: uuid },
          { key: ATTR_WALLET, value: wallet },
        ],
        expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
      })

      return { entityKey: existing.entityKey, profile: updated }
    },

    async sync(otherChains) {
      // 1. Already on current chain — nothing to do.
      const existing = await findProfile(cdn)
      if (existing) return existing

      // 2. Search other chains in order.
      for (const otherCdn of otherChains) {
        const found = await findProfile(otherCdn)
        if (found) {
          // Replicate to current chain, preserving original profile data.
          const now = Date.now()
          const replicatedData: BaseProfileData = {
            ...found.profile,
            updatedAt: now,
            syncedFrom: found.entityKey,
          }

          const { entityKey } = await cdn.entity.create({
            payload: jsonToPayload(replicatedData),
            contentType: 'application/json',
            attributes: [
              { key: ATTR_TYPE, value: PROFILE_TYPE },
              { key: ATTR_UUID, value: uuid },
              { key: ATTR_WALLET, value: wallet },
            ],
            expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
          })

          return { entityKey, profile: replicatedData }
        }
      }

      // 3. Not found on any chain — create a fresh profile.
      return createProfile()
    },

    extend<T extends Record<string, unknown>>(namespace: string) {
      return new ExtensionClient<T>(namespace, cdn, uuid, wallet)
    },
  }
}
