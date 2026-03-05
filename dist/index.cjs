Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let arka_cdn = require("arka-cdn");
//#region src/constants.ts
/** Shared attribute keys used for all ASide entities. */
const ATTR_TYPE = "aside.type";
const ATTR_UUID = "aside.uuid";
const ATTR_WALLET = "aside.wallet";
const ATTR_NAMESPACE = "aside.namespace";
/** Entity type discriminators stored in `aside.type`. */
const PROFILE_TYPE = "profile";
const EXTENSION_TYPE = "extension";
/**
* Default entity TTL: 365 days in seconds.
* Profiles and extensions expire after one year unless renewed.
*/
const DEFAULT_EXPIRY_SECONDS = 365 * 24 * 60 * 60;
//#endregion
//#region src/extension.ts
/**
* Internal implementation of {@link ExtensionClientInstance}.
* Manages a single app-specific extension entity on-chain,
* linked to a base profile via `uuid` + `wallet` + `namespace`.
*/
var ExtensionClient = class {
	constructor(namespace, cdn, uuid, wallet) {
		this.namespace = namespace;
		this.cdn = cdn;
		this.uuid = uuid;
		this.wallet = wallet;
	}
	async findExtension() {
		const entity = (await this.cdn.entity.query().where([
			(0, arka_cdn.eq)(ATTR_TYPE, EXTENSION_TYPE),
			(0, arka_cdn.eq)(ATTR_UUID, this.uuid),
			(0, arka_cdn.eq)(ATTR_WALLET, this.wallet),
			(0, arka_cdn.eq)(ATTR_NAMESPACE, this.namespace)
		]).withPayload(true).withAttributes(true).fetch()).entities[0];
		if (!entity) return null;
		const extension = entity.toJson();
		return {
			entityKey: entity.key,
			extension
		};
	}
	async get() {
		return this.findExtension();
	}
	async getOrCreate(initialData) {
		const existing = await this.findExtension();
		if (existing) return existing;
		const now = Date.now();
		const extensionData = {
			namespace: this.namespace,
			uuid: this.uuid,
			wallet: this.wallet,
			data: initialData,
			createdAt: now,
			updatedAt: now
		};
		const { entityKey } = await this.cdn.entity.create({
			payload: (0, arka_cdn.jsonToPayload)(extensionData),
			contentType: "application/json",
			attributes: [
				{
					key: ATTR_TYPE,
					value: EXTENSION_TYPE
				},
				{
					key: ATTR_UUID,
					value: this.uuid
				},
				{
					key: ATTR_WALLET,
					value: this.wallet
				},
				{
					key: ATTR_NAMESPACE,
					value: this.namespace
				}
			],
			expiresIn: arka_cdn.ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
		});
		return {
			entityKey,
			extension: extensionData
		};
	}
	async update(data) {
		const existing = await this.findExtension();
		if (!existing) throw new Error(`ASide: extension "${this.namespace}" not found for uuid="${this.uuid}". Call getOrCreate() first.`);
		const now = Date.now();
		const updated = {
			...existing.extension,
			data: {
				...existing.extension.data,
				...data
			},
			updatedAt: now
		};
		await this.cdn.entity.update({
			entityKey: existing.entityKey,
			payload: (0, arka_cdn.jsonToPayload)(updated),
			contentType: "application/json",
			attributes: [
				{
					key: ATTR_TYPE,
					value: EXTENSION_TYPE
				},
				{
					key: ATTR_UUID,
					value: this.uuid
				},
				{
					key: ATTR_WALLET,
					value: this.wallet
				},
				{
					key: ATTR_NAMESPACE,
					value: this.namespace
				}
			],
			expiresIn: arka_cdn.ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
		});
		return {
			entityKey: existing.entityKey,
			extension: updated
		};
	}
};
//#endregion
//#region src/client.ts
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
function createBaseClient(options) {
	const { uuid, wallet, photo, displayName, bio, cdn } = options;
	async function findProfile(searchCdn) {
		const entity = (await searchCdn.entity.query().where([
			(0, arka_cdn.eq)(ATTR_TYPE, PROFILE_TYPE),
			(0, arka_cdn.eq)(ATTR_UUID, uuid),
			(0, arka_cdn.eq)(ATTR_WALLET, wallet)
		]).withPayload(true).withAttributes(true).fetch()).entities[0];
		if (!entity) return null;
		const profile = entity.toJson();
		return {
			entityKey: entity.key,
			profile
		};
	}
	async function createProfile(syncedFrom) {
		const now = Date.now();
		const profileData = {
			uuid,
			wallet,
			photo,
			...displayName != null ? { displayName } : {},
			...bio != null ? { bio } : {},
			createdAt: now,
			updatedAt: now,
			...syncedFrom != null ? { syncedFrom } : {}
		};
		const { entityKey } = await cdn.entity.create({
			payload: (0, arka_cdn.jsonToPayload)(profileData),
			contentType: "application/json",
			attributes: [
				{
					key: ATTR_TYPE,
					value: PROFILE_TYPE
				},
				{
					key: ATTR_UUID,
					value: uuid
				},
				{
					key: ATTR_WALLET,
					value: wallet
				}
			],
			expiresIn: arka_cdn.ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
		});
		return {
			entityKey,
			profile: profileData
		};
	}
	return {
		get uuid() {
			return uuid;
		},
		get wallet() {
			return wallet;
		},
		async get() {
			return findProfile(cdn);
		},
		async getOrCreate() {
			const existing = await findProfile(cdn);
			if (existing) return existing;
			return createProfile();
		},
		async update(data) {
			const existing = await findProfile(cdn);
			if (!existing) throw new Error(`ASide: profile not found for uuid="${uuid}". Call getOrCreate() first.`);
			const now = Date.now();
			const updated = {
				...existing.profile,
				...data,
				uuid,
				wallet,
				updatedAt: now
			};
			await cdn.entity.update({
				entityKey: existing.entityKey,
				payload: (0, arka_cdn.jsonToPayload)(updated),
				contentType: "application/json",
				attributes: [
					{
						key: ATTR_TYPE,
						value: PROFILE_TYPE
					},
					{
						key: ATTR_UUID,
						value: uuid
					},
					{
						key: ATTR_WALLET,
						value: wallet
					}
				],
				expiresIn: arka_cdn.ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
			});
			return {
				entityKey: existing.entityKey,
				profile: updated
			};
		},
		async sync(otherChains) {
			const existing = await findProfile(cdn);
			if (existing) return existing;
			for (const otherCdn of otherChains) {
				const found = await findProfile(otherCdn);
				if (found) {
					const now = Date.now();
					const replicatedData = {
						...found.profile,
						updatedAt: now,
						syncedFrom: found.entityKey
					};
					const { entityKey } = await cdn.entity.create({
						payload: (0, arka_cdn.jsonToPayload)(replicatedData),
						contentType: "application/json",
						attributes: [
							{
								key: ATTR_TYPE,
								value: PROFILE_TYPE
							},
							{
								key: ATTR_UUID,
								value: uuid
							},
							{
								key: ATTR_WALLET,
								value: wallet
							}
						],
						expiresIn: arka_cdn.ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
					});
					return {
						entityKey,
						profile: replicatedData
					};
				}
			}
			return createProfile();
		},
		extend(namespace) {
			return new ExtensionClient(namespace, cdn, uuid, wallet);
		}
	};
}
//#endregion
exports.ATTR_NAMESPACE = ATTR_NAMESPACE;
exports.ATTR_TYPE = ATTR_TYPE;
exports.ATTR_UUID = ATTR_UUID;
exports.ATTR_WALLET = ATTR_WALLET;
exports.DEFAULT_EXPIRY_SECONDS = DEFAULT_EXPIRY_SECONDS;
exports.EXTENSION_TYPE = EXTENSION_TYPE;
exports.PROFILE_TYPE = PROFILE_TYPE;
exports.createBaseClient = createBaseClient;

//# sourceMappingURL=index.cjs.map