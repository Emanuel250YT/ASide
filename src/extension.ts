import { eq, jsonToPayload, ExpirationTime } from 'arka-cdn'
import type { ArkaCDN, Hex } from 'arka-cdn'
import {
  ATTR_NAMESPACE,
  ATTR_TYPE,
  ATTR_UUID,
  ATTR_WALLET,
  DEFAULT_EXPIRY_SECONDS,
  EXTENSION_TYPE,
} from './constants.js'
import type {
  ExtensionClientInstance,
  ExtensionData,
  ExtensionResult,
} from './types.js'

/**
 * Internal implementation of {@link ExtensionClientInstance}.
 * Manages a single app-specific extension entity on-chain,
 * linked to a base profile via `uuid` + `wallet` + `namespace`.
 */
export class ExtensionClient<T extends Record<string, unknown>>
  implements ExtensionClientInstance<T> {
  constructor(
    private readonly namespace: string,
    private readonly cdn: ArkaCDN,
    private readonly uuid: string,
    private readonly wallet: string,
  ) { }

  private async findExtension(): Promise<ExtensionResult<T> | null> {
    const result = await this.cdn.entity
      .query()
      .where([
        eq(ATTR_TYPE, EXTENSION_TYPE),
        eq(ATTR_UUID, this.uuid),
        eq(ATTR_WALLET, this.wallet),
        eq(ATTR_NAMESPACE, this.namespace),
      ])
      .withPayload(true)
      .withAttributes(true)
      .fetch()

    const entity = result.entities[0]
    if (!entity) return null

    const extension = entity.toJson() as ExtensionData<T>
    return { entityKey: entity.key, extension }
  }

  async get(): Promise<ExtensionResult<T> | null> {
    return this.findExtension()
  }

  async getOrCreate(initialData: T): Promise<ExtensionResult<T>> {
    const existing = await this.findExtension()
    if (existing) return existing

    const now = Date.now()
    const extensionData: ExtensionData<T> = {
      namespace: this.namespace,
      uuid: this.uuid,
      wallet: this.wallet,
      data: initialData,
      createdAt: now,
      updatedAt: now,
    }

    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(extensionData),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EXTENSION_TYPE },
        { key: ATTR_UUID, value: this.uuid },
        { key: ATTR_WALLET, value: this.wallet },
        { key: ATTR_NAMESPACE, value: this.namespace },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })

    return { entityKey, extension: extensionData }
  }

  async update(data: Partial<T>): Promise<ExtensionResult<T>> {
    const existing = await this.findExtension()
    if (!existing) {
      throw new Error(
        `ASide: extension "${this.namespace}" not found for uuid="${this.uuid}". Call getOrCreate() first.`,
      )
    }

    const now = Date.now()
    const updated: ExtensionData<T> = {
      ...existing.extension,
      data: { ...existing.extension.data, ...data },
      updatedAt: now,
    }

    await this.cdn.entity.update({
      entityKey: existing.entityKey as Hex,
      payload: jsonToPayload(updated),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EXTENSION_TYPE },
        { key: ATTR_UUID, value: this.uuid },
        { key: ATTR_WALLET, value: this.wallet },
        { key: ATTR_NAMESPACE, value: this.namespace },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })

    return { entityKey: existing.entityKey, extension: updated }
  }
}
