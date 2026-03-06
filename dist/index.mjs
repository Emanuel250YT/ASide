import { ExpirationTime, eq, jsonToPayload } from "arka-cdn";
//#region src/constants.ts
/** Shared attribute keys used for all ASide entities. */
const ATTR_TYPE = "aside.type";
const ATTR_UUID = "aside.uuid";
const ATTR_WALLET = "aside.wallet";
const ATTR_NAMESPACE = "aside.namespace";
/** Attribute keys for social graph entities. */
const ATTR_TARGET_UUID = "aside.social.target";
const ATTR_TARGET_KEY = "aside.social.target_key";
/** Entity type discriminators stored in `aside.type`. */
const PROFILE_TYPE = "profile";
const EXTENSION_TYPE = "extension";
/** Social entity type discriminators. */
const SOCIAL_FOLLOW_TYPE = "aside.social.follow";
const SOCIAL_FRIEND_REQUEST_TYPE = "aside.social.friend_request";
const SOCIAL_POST_TYPE = "aside.social.post";
const SOCIAL_REACTION_TYPE = "aside.social.reaction";
const SOCIAL_COMMENT_TYPE = "aside.social.comment";
const SOCIAL_BLOCK_TYPE = "aside.social.block";
/**
* Default entity TTL: 365 days in seconds.
* Profiles and extensions expire after one year unless renewed.
*/
const DEFAULT_EXPIRY_SECONDS = 365 * 24 * 60 * 60;
/** Custom epoch for ASide snowflakes: 2025-01-01T00:00:00.000Z */
const SNOWFLAKE_EPOCH = 1735689600000n;
const SNOWFLAKE_WORKER_BITS = 14n;
const SNOWFLAKE_SEQUENCE_BITS = 14n;
const SNOWFLAKE_PERMISSION_BITS = 52n;
/** Max values derived from bit widths. */
const MAX_WORKER_ID = (1n << SNOWFLAKE_WORKER_BITS) - 1n;
const MAX_SEQUENCE = (1n << SNOWFLAKE_SEQUENCE_BITS) - 1n;
const MAX_PERMISSIONS = (1n << SNOWFLAKE_PERMISSION_BITS) - 1n;
/** PBKDF2 iteration count (OWASP minimum for SHA-256 is 600 000; 100 000 is a practical default). */
const PBKDF2_ITERATIONS = 1e5;
/** Default app ECDH key pair TTL: 30 days. */
const DEFAULT_APP_KEY_TTL_MS = 720 * 60 * 60 * 1e3;
/** Default access token TTL: 1 hour. */
const DEFAULT_TOKEN_TTL_MS = 3600 * 1e3;
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
			eq(ATTR_TYPE, EXTENSION_TYPE),
			eq(ATTR_UUID, this.uuid),
			eq(ATTR_WALLET, this.wallet),
			eq(ATTR_NAMESPACE, this.namespace)
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
			payload: jsonToPayload(extensionData),
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
			expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
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
			payload: jsonToPayload(updated),
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
			expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
		});
		return {
			entityKey: existing.entityKey,
			extension: updated
		};
	}
};
//#endregion
//#region src/crypto.ts
/**
* Cross-environment cryptographic primitives for ASide.
*
* All operations use the WebCrypto API (`globalThis.crypto.subtle`), which is
* available in Node.js >= 16 and all modern browsers — no polyfills required.
*
* ## Algorithms used
* - AES-256-GCM   — symmetric encryption with authentication tag
* - HMAC-SHA256   — message authentication (session request signatures)
* - ECDH P-256    — asymmetric key exchange (token issuance / validation)
* - HKDF-SHA256   — key derivation from ECDH shared secret
* - PBKDF2-SHA256 — phrase commitment (offline-attack resistant hashing)
*/
function getSubtle() {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) throw new Error("ASide: WebCrypto SubtleCrypto is not available in this environment. Node.js >= 16 required, or run in a modern browser.");
	return subtle;
}
function randomBytes(n) {
	const buf = new Uint8Array(n);
	globalThis.crypto.getRandomValues(buf);
	return buf;
}
function hexToBytes(hex) {
	if (hex.startsWith("0x")) hex = hex.slice(2);
	if (hex.length % 2 !== 0) throw new Error("ASide: invalid hex string length");
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
	return out;
}
function bytesToHex(bytes) {
	return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function toBase64url$1(bytes) {
	const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function fromBase64url$1(str) {
	const padded = str.replace(/-/g, "+").replace(/_/g, "/").padEnd(str.length + (4 - str.length % 4) % 4, "=");
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}
function b(u8) {
	if (u8.buffer instanceof ArrayBuffer) return u8;
	const clean = new Uint8Array(u8.byteLength);
	clean.set(u8);
	return clean;
}
function normalizeKey(key) {
	if (typeof key === "string") return hexToBytes(key);
	return key;
}
async function importAesKey(raw) {
	return getSubtle().importKey("raw", b(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function importHmacKey(raw) {
	return getSubtle().importKey("raw", b(raw), {
		name: "HMAC",
		hash: "SHA-256"
	}, false, ["sign", "verify"]);
}
const enc = new TextEncoder();
const dec = new TextDecoder();
/**
* Encrypts `plaintext` with AES-256-GCM using `key`.
* Returns `{ ciphertext, iv }` both as base64url strings.
*/
async function aesEncrypt(plaintext, key) {
	const rawKey = normalizeKey(key);
	if (rawKey.length !== 32) throw new Error(`ASide: AES key must be 32 bytes, got ${rawKey.length}`);
	const iv = randomBytes(12);
	const cryptoKey = await importAesKey(rawKey);
	const encrypted = await getSubtle().encrypt({
		name: "AES-GCM",
		iv: b(iv)
	}, cryptoKey, b(enc.encode(plaintext)));
	return {
		ciphertext: toBase64url$1(new Uint8Array(encrypted)),
		iv: toBase64url$1(iv)
	};
}
/**
* Decrypts `ciphertext` (base64url) with AES-256-GCM.
* Returns the plaintext string.
*/
async function aesDecrypt(ciphertext, iv, key) {
	const rawKey = normalizeKey(key);
	if (rawKey.length !== 32) throw new Error(`ASide: AES key must be 32 bytes, got ${rawKey.length}`);
	const cryptoKey = await importAesKey(rawKey);
	let decrypted;
	try {
		decrypted = await getSubtle().decrypt({
			name: "AES-GCM",
			iv: b(fromBase64url$1(iv))
		}, cryptoKey, b(fromBase64url$1(ciphertext)));
	} catch {
		throw new Error("ASide: decryption failed — invalid key, IV, or corrupted ciphertext");
	}
	return dec.decode(decrypted);
}
/**
* Computes HMAC-SHA256 over `message` (string) with `key`.
* Returns the signature as a hex string.
*/
async function hmacSign(message, key) {
	const cryptoKey = await importHmacKey(normalizeKey(key));
	const sig = await getSubtle().sign("HMAC", cryptoKey, b(enc.encode(message)));
	return bytesToHex(new Uint8Array(sig));
}
/**
* Verifies an HMAC-SHA256 signature.
* Uses constant-time comparison internally via SubtleCrypto.verify.
*/
async function hmacVerify(message, signature, key) {
	const cryptoKey = await importHmacKey(normalizeKey(key));
	const sigBytes = hexToBytes(signature);
	return getSubtle().verify("HMAC", cryptoKey, b(sigBytes), b(enc.encode(message)));
}
/**
* Generates a cryptographically random AES-256 key.
* Returns as hex string.
*/
function generateAesKey() {
	return bytesToHex(randomBytes(32));
}
async function importEcdhPrivateKey(hex) {
	return getSubtle().importKey("pkcs8", b(hexToBytes(hex)), {
		name: "ECDH",
		namedCurve: "P-256"
	}, false, ["deriveBits"]);
}
async function importEcdhPublicKey(hex) {
	return getSubtle().importKey("raw", b(hexToBytes(hex)), {
		name: "ECDH",
		namedCurve: "P-256"
	}, false, []);
}
async function hkdf(ikm, info, length = 32) {
	const ikmKey = await getSubtle().importKey("raw", b(ikm), "HKDF", false, ["deriveBits"]);
	const bits = await getSubtle().deriveBits({
		name: "HKDF",
		hash: "SHA-256",
		salt: b(new Uint8Array(32)),
		info: b(enc.encode(info))
	}, ikmKey, length * 8);
	return new Uint8Array(bits);
}
/**
* Generates a new ECDH P-256 key pair for app-server authorization.
*
* - The **private key** (PKCS8 hex) is kept on the app server and never shared.
* - The **public key** (uncompressed P-256 raw hex, 65 bytes) can be published
*   on-chain alongside the app's identity entity.
*
* With this pair the server never needs to transmit a shared secret to clients:
* each client generates an ephemeral key pair, does ECDH with the published
* public key, and derives a unique per-token encryption key.
*/
async function generateAppKeyPair(ttlMs = DEFAULT_APP_KEY_TTL_MS) {
	const kp = await getSubtle().generateKey({
		name: "ECDH",
		namedCurve: "P-256"
	}, true, ["deriveBits"]);
	const [privateKeyDer, publicKeyRaw] = await Promise.all([getSubtle().exportKey("pkcs8", kp.privateKey), getSubtle().exportKey("raw", kp.publicKey)]);
	return {
		privateKey: bytesToHex(new Uint8Array(privateKeyDer)),
		publicKey: bytesToHex(new Uint8Array(publicKeyRaw)),
		keyId: bytesToHex(randomBytes(16)),
		createdAt: Date.now(),
		expiresAt: Date.now() + ttlMs
	};
}
/**
* Derives a token encryption key and a session HMAC key from an ECDH shared secret.
*
* - Call this from the **client side** using the ephemeral private key + app public key.
* - Call this from the **server side** using the app private key + ephemeral public key.
*
* Both sides arrive at identical `encKey` and `sessionKey` without ever transmitting
* the shared secret.
*
* @internal Used by AccessTokenManager.
*/
async function ecdhDeriveKeys(privateKeyHex, publicKeyHex) {
	const [privateKey, publicKey] = await Promise.all([importEcdhPrivateKey(privateKeyHex), importEcdhPublicKey(publicKeyHex)]);
	const sharedBits = await getSubtle().deriveBits({
		name: "ECDH",
		public: publicKey
	}, privateKey, 256);
	const shared = new Uint8Array(sharedBits);
	const [encBytes, sessionBytes] = await Promise.all([hkdf(shared, "aside-token-enc", 32), hkdf(shared, "aside-token-session", 32)]);
	return {
		encKey: bytesToHex(encBytes),
		sessionKey: bytesToHex(sessionBytes)
	};
}
/**
* Derives a PBKDF2-SHA256 hash of `phrase` given a random `salt`.
* Used internally by `phraseToCommitment` and `verifyPhraseCommitment`.
*/
async function pbkdf2Hash(phrase, salt) {
	const phraseKey = await getSubtle().importKey("raw", b(enc.encode(phrase)), "PBKDF2", false, ["deriveBits"]);
	const bits = await getSubtle().deriveBits({
		name: "PBKDF2",
		hash: "SHA-256",
		salt: b(salt),
		iterations: PBKDF2_ITERATIONS
	}, phraseKey, 256);
	return new Uint8Array(bits);
}
/**
* Produces a PBKDF2-SHA256 commitment from a phrase.
*
* Store `{ hash, salt }` instead of the raw phrase. Use `verifyPhraseCommitment`
* to authenticate a user later without exposing the phrase.
*
* @example
* ```ts
* const { hash, salt } = await phraseToCommitment('my-secret')
* // store hash + salt, discard the phrase
* const ok = await verifyPhraseCommitment('my-secret', hash, salt)  // true
* ```
*/
async function phraseToCommitment(phrase) {
	const salt = randomBytes(32);
	return {
		hash: bytesToHex(await pbkdf2Hash(phrase, salt)),
		salt: bytesToHex(salt)
	};
}
/**
* Constant-time verification of a phrase against a stored PBKDF2 commitment.
*/
async function verifyPhraseCommitment(phrase, hash, salt) {
	const computed = await pbkdf2Hash(phrase, hexToBytes(salt));
	const expected = hexToBytes(hash);
	if (computed.length !== expected.length) return false;
	let diff = 0;
	for (let i = 0; i < computed.length; i++) diff |= (computed[i] ?? 0) ^ (expected[i] ?? 0);
	return diff === 0;
}
//#endregion
//#region src/snowflake.ts
/**
* ASide SnowflakeGenerator
*
* Generates 128-bit snowflake IDs with embedded permission bitmasks.
*
* Structure (bits, left to right):
*   [48 timestamp ms] [14 worker] [14 sequence] [52 permissions]
*
* Encoded as a 32-character lowercase hex string.
*
* Usage:
* ```ts
* const sf = new SnowflakeGenerator({ workerId: 1n })
*
* // Register custom permissions
* sf.definePermission({ name: 'READ_PROFILE', bit: 0 })
* sf.definePermission({ name: 'WRITE_PROFILE', bit: 1 })
* sf.definePermission({ name: 'MANAGE_TOKENS', bit: 2 })
*
* // Generate a snowflake granting READ_PROFILE + MANAGE_TOKENS
* const flake = sf.generate({ permissions: ['READ_PROFILE', 'MANAGE_TOKENS'] })
*
* // Decode
* const { timestamp, permissions } = sf.decode(flake)
* ```
*/
var SnowflakeGenerator = class SnowflakeGenerator {
	workerId;
	sequence = 0n;
	lastMs = -1n;
	permissions = /* @__PURE__ */ new Map();
	constructor(options = {}) {
		const wid = BigInt(options.workerId ?? 0);
		if (wid < 0n || wid > MAX_WORKER_ID) throw new RangeError(`ASide: workerId must be 0–${MAX_WORKER_ID}, got ${wid}`);
		this.workerId = wid;
	}
	/**
	* Registers a new permission definition.
	* Bit positions 0–51 are available (52 bits total).
	*/
	definePermission(def) {
		if (def.bit < 0 || def.bit > 51) throw new RangeError(`ASide: permission bit must be 0–51, got ${def.bit}`);
		this.permissions.set(def.name, def);
		return this;
	}
	/** Returns all registered permissions. */
	getPermissions() {
		return Array.from(this.permissions.values());
	}
	/** Resolves an array of permission names into a bitmask. */
	resolveBitmask(names) {
		let mask = 0n;
		for (const name of names) {
			const def = this.permissions.get(name);
			if (!def) throw new Error(`ASide: unknown permission "${name}"`);
			mask |= 1n << BigInt(def.bit);
		}
		return mask;
	}
	/** Resolves a bitmask into permission names (only registered ones). */
	resolveNames(mask) {
		const result = [];
		for (const def of this.permissions.values()) if (mask >> BigInt(def.bit) & 1n) result.push(def.name);
		return result;
	}
	/**
	* Generates a new 128-bit snowflake.
	* Thread-safe within a single JS event loop (monotonic sequence counter).
	*/
	generate(options = {}) {
		let ms = BigInt(Date.now()) - SNOWFLAKE_EPOCH;
		if (ms < this.lastMs) ms = this.lastMs;
		if (ms === this.lastMs) {
			this.sequence = this.sequence + 1n & MAX_SEQUENCE;
			if (this.sequence === 0n) {
				ms = ms + 1n;
				this.lastMs = ms;
			}
		} else {
			this.sequence = 0n;
			this.lastMs = ms;
		}
		let permBits;
		if (options.permissions === void 0) permBits = 0n;
		else if (typeof options.permissions === "bigint") permBits = options.permissions & MAX_PERMISSIONS;
		else permBits = this.resolveBitmask(options.permissions) & MAX_PERMISSIONS;
		return (ms << SNOWFLAKE_WORKER_BITS + SNOWFLAKE_SEQUENCE_BITS + SNOWFLAKE_PERMISSION_BITS | this.workerId << SNOWFLAKE_SEQUENCE_BITS + SNOWFLAKE_PERMISSION_BITS | this.sequence << SNOWFLAKE_PERMISSION_BITS | permBits).toString(16).padStart(32, "0");
	}
	/** Decodes a snowflake hex string back into its components. */
	decode(snowflake) {
		const raw = BigInt(`0x${snowflake}`);
		const permBits = raw & MAX_PERMISSIONS;
		const sequence = raw >> SNOWFLAKE_PERMISSION_BITS & MAX_SEQUENCE;
		const workerId = raw >> SNOWFLAKE_PERMISSION_BITS + SNOWFLAKE_SEQUENCE_BITS & MAX_WORKER_ID;
		const tsOffset = raw >> SNOWFLAKE_PERMISSION_BITS + SNOWFLAKE_SEQUENCE_BITS + SNOWFLAKE_WORKER_BITS;
		return {
			raw,
			hex: snowflake,
			timestamp: new Date(Number(tsOffset + SNOWFLAKE_EPOCH)),
			workerId,
			sequence,
			permissionBits: permBits,
			permissions: this.resolveNames(permBits)
		};
	}
	/**
	* Extracts just the permission bitmask from a snowflake without full decoding.
	* Useful for quick permission checks.
	*/
	static extractPermissions(snowflake) {
		return BigInt(`0x${snowflake}`) & MAX_PERMISSIONS;
	}
	/**
	* Checks if a snowflake has a specific permission bit set.
	*
	* @example
	* ```ts
	* if (SnowflakeGenerator.hasPermission(token.claims.permissions, 1n)) { ... }
	* ```
	*/
	static hasPermission(snowflake, bit) {
		const mask = 1n << BigInt(bit);
		return (SnowflakeGenerator.extractPermissions(snowflake) & mask) === mask;
	}
};
//#endregion
//#region src/access-token.ts
/**
* ASide AccessTokenManager
*
* Issues and validates short-lived access tokens that authorize third-party apps
* to act on behalf of an ASide profile holder.
*
* ## Token flow (ECDH-based — no shared secret transmitted)
*
* 1. **App server** calls `generateAppKeyPair()` once.
*    - Stores the private key securely.
*    - Publishes the **public key** (e.g. on-chain or via an API endpoint).
*
* 2. **Client** calls `manager.create({ appPublicKey, phrase, ... })`.
*    - Generates an ephemeral ECDH P-256 key pair locally.
*    - ECDH(ephemeralPrivate, appPublicKey) → shared secret.
*    - HKDF(sharedSecret, "aside-token-enc")     → encKey.
*    - HKDF(sharedSecret, "aside-token-session") → sessionKey.
*    - All claims (including phrase) are AES-256-GCM encrypted with encKey.
*    - Returns `{ token, sessionKey }`. The raw encKey is discarded.
*
* 3. **App server** calls `manager.validate({ token, appPrivateKey })`.
*    - ECDH(appPrivate, token.ephemeralPublicKey) → same shared secret.
*    - Re-derives encKey and decrypts claims.
*    - Returns `{ valid, claims, phrase, sessionKey }`.
*
* 4. **Client** calls `manager.createSessionRequest(token, sessionKey)`.
*    - Signs `"${nonce}:${requestedAt}:${tokenId}"` with HMAC-SHA256 using sessionKey.
*    - Nonce is auto-generated if not supplied.
*
* 5. **App server** calls `manager.validateSession(request, appPrivateKey)`.
*    - Re-derives the same sessionKey via ECDH.
*    - Verifies the HMAC signature.
*
* ## Security properties
*
* - **No shared secret transmission**: the app public key is safe to publish.
*   Attackers observing the public key cannot derive the encKey.
* - **Per-token forward secrecy**: each token uses a unique ephemeral key pair.
* - **AES-256-GCM authentication tag**: any ciphertext tampering is detected.
* - **Replay protection**: nonce is required in session requests; servers SHOULD
*   store seen nonces for the duration of the token's validity window.
* - **Domain + App ID binding**: prevents token reuse across different apps.
*/
var AccessTokenManager = class {
	sf;
	constructor(workerId = 0) {
		this.workerId = workerId;
		this.sf = new SnowflakeGenerator({ workerId });
	}
	/**
	* Creates a sealed access token using ECDH P-256 key exchange.
	*
	* Returns both the `token` (hand to the app server) and a `sessionKey`
	* (retain client-side for signing session requests).
	*/
	async create(options) {
		const { appId, domain, permissions, ttlMs = DEFAULT_TOKEN_TTL_MS, appPublicKey, phrase, issuerUuid = "", issuerWallet = "" } = options;
		const ephemeralPair = await generateAppKeyPair(ttlMs + 6e4);
		const { encKey, sessionKey } = await ecdhDeriveKeys(ephemeralPair.privateKey, appPublicKey);
		const now = Date.now();
		const expiresAt = now + ttlMs;
		const permSnowflake = typeof permissions === "bigint" ? this.sf.generate({ permissions }) : permissions;
		const tokenId = this.sf.generate();
		const fullClaims = {
			appId,
			domain,
			permissions: permSnowflake,
			issuedAt: now,
			expiresAt,
			issuerUuid,
			issuerWallet,
			tokenId,
			phrase
		};
		const { ciphertext, iv } = await aesEncrypt(JSON.stringify(fullClaims), encKey);
		return {
			token: {
				ciphertext,
				iv,
				appId,
				tokenId,
				expiresAt,
				ephemeralPublicKey: ephemeralPair.publicKey
			},
			sessionKey
		};
	}
	/**
	* Validates and decrypts a sealed access token.
	*
	* Returns `{ valid: true, claims, phrase, sessionKey }` on success, or
	* `{ valid: false, reason }` on failure.
	*/
	async validate(options) {
		const { token, appPrivateKey, expectedDomain, expectedAppId } = options;
		if (Date.now() > token.expiresAt) return {
			valid: false,
			reason: "Token has expired"
		};
		let encKey;
		let sessionKey;
		try {
			({encKey, sessionKey} = await ecdhDeriveKeys(appPrivateKey, token.ephemeralPublicKey));
		} catch {
			return {
				valid: false,
				reason: "ECDH key derivation failed — invalid key material"
			};
		}
		let fullClaims;
		try {
			const plaintext = await aesDecrypt(token.ciphertext, token.iv, encKey);
			fullClaims = JSON.parse(plaintext);
		} catch {
			return {
				valid: false,
				reason: "Token decryption failed — invalid key or corrupted ciphertext"
			};
		}
		if (Date.now() > fullClaims.expiresAt) return {
			valid: false,
			reason: "Token has expired (inner claims)"
		};
		if (expectedDomain !== void 0 && fullClaims.domain !== expectedDomain) return {
			valid: false,
			reason: `Domain mismatch: expected "${expectedDomain}", got "${fullClaims.domain}"`
		};
		if (expectedAppId !== void 0 && fullClaims.appId !== expectedAppId) return {
			valid: false,
			reason: `App ID mismatch: expected "${expectedAppId}", got "${fullClaims.appId}"`
		};
		if (token.tokenId !== fullClaims.tokenId) return {
			valid: false,
			reason: "Token ID mismatch between envelope and claims"
		};
		const { phrase, ...claims } = fullClaims;
		return {
			valid: true,
			claims,
			phrase,
			sessionKey
		};
	}
	/**
	* Creates a signed {@link SessionRequest} from a validated token.
	*
	* The signature is HMAC-SHA256 over `"${nonce}:${requestedAt}:${tokenId}"`
	* using the `sessionKey` returned by `create()`.
	*
	* A random nonce is generated automatically if not provided.
	*
	* @param token      - The sealed token (from `create()`).
	* @param sessionKey - The session key returned by `create()`.
	* @param nonce      - Optional custom nonce (auto-generated when omitted).
	*/
	async createSessionRequest(token, sessionKey, nonce) {
		const requestedAt = Date.now();
		const resolvedNonce = nonce ?? Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
		return {
			token,
			requestedAt,
			nonce: resolvedNonce,
			signature: await hmacSign(`${resolvedNonce}:${requestedAt}:${token.tokenId}`, sessionKey)
		};
	}
	/**
	* Validates an inbound {@link SessionRequest}.
	*
	* Checks (in order):
	* 1. Request timestamp is within the allowed clock skew (5 minutes).
	* 2. Token is not expired, domain/app binding passes, inner claims are intact.
	* 3. HMAC signature is valid (re-derived session key via ECDH).
	*
	* The server **SHOULD** track seen nonces and reject duplicates to fully prevent
	* replay attacks within the 5-minute window.
	*/
	async validateSession(request, appPrivateKey, options = {}) {
		const age = Date.now() - request.requestedAt;
		if (age < 0 || age > 3e5) return {
			valid: false,
			reason: `Request is too old or from the future (age: ${age}ms)`
		};
		const tokenResult = await this.validate({
			token: request.token,
			appPrivateKey,
			...options
		});
		if (!tokenResult.valid) return tokenResult;
		if (!await hmacVerify(`${request.nonce}:${request.requestedAt}:${request.token.tokenId}`, request.signature, tokenResult.sessionKey)) return {
			valid: false,
			reason: "Invalid request signature"
		};
		return tokenResult;
	}
};
//#endregion
//#region src/watcher.ts
var ProfileWatcher = class {
	opts;
	timer = null;
	lastSeen = /* @__PURE__ */ new Map();
	constructor(client, opts) {
		this.client = client;
		this.opts = {
			intervalMs: 1e4,
			...opts
		};
	}
	get running() {
		return this.timer !== null;
	}
	/** Starts polling. */
	start() {
		if (this.timer !== null) return this;
		this.timer = setInterval(() => {
			this.poll();
		}, this.opts.intervalMs);
		this.poll();
		return this;
	}
	/** Stops polling. */
	stop() {
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
		return this;
	}
	/**
	* Runs one poll cycle manually.
	* Called automatically when `start()` is active.
	*/
	async poll() {
		const results = await Promise.all(this.opts.chains.map(async (chain) => {
			const profile = await this.client.getOnChain(chain.cdn);
			return {
				chain: chain.name,
				exists: profile !== null,
				profile
			};
		}));
		for (const result of results) {
			const wasPresent = this.lastSeen.get(result.chain) ?? null;
			if (result.exists && wasPresent !== true) this.opts.onFound?.(result.chain, result.profile);
			else if (!result.exists && wasPresent === true) this.opts.onLost?.(result.chain);
			this.lastSeen.set(result.chain, result.exists);
		}
		this.opts.onPoll?.(results);
		return results;
	}
};
//#endregion
//#region src/social.ts
/**
* SocialClient — follow graph, friend requests, and user blocking.
*
* Obtain via `client.social()`:
*
* ```ts
* const social = client.social()
* await social.follow('target-uuid')
* const followers = await social.getFollowers()
* ```
*
* All social data is stored as entities on ArkaCDN.  "Soft deletes" (unfollow,
* unblock, cancel) update the entity's `status` field because ArkaCDN does not
* expose a delete operation.
*/
var SocialClient = class SocialClient {
	constructor(cdn, uuid, wallet) {
		this.cdn = cdn;
		this.uuid = uuid;
		this.wallet = wallet;
	}
	/**
	* Follows a user identified by `targetUuid`.
	* If a follow entity already exists (even if unfollowed), it is reactivated.
	* Returns the updated/created follow record.
	*/
	async follow(targetUuid) {
		const now = Date.now();
		const existing = await this._findFollow(this.uuid, targetUuid);
		if (existing) {
			if (existing.status === "active") return existing;
			const updated = {
				...existing,
				status: "active",
				followedAt: now
			};
			await this.cdn.entity.update({
				entityKey: existing.entityKey,
				payload: jsonToPayload(updated),
				contentType: "application/json",
				attributes: [
					{
						key: ATTR_TYPE,
						value: SOCIAL_FOLLOW_TYPE
					},
					{
						key: ATTR_UUID,
						value: existing.followerUuid
					},
					{
						key: ATTR_TARGET_UUID,
						value: existing.followeeUuid
					}
				],
				expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
			});
			return updated;
		}
		const follow = {
			followerUuid: this.uuid,
			followeeUuid: targetUuid,
			followedAt: now,
			status: "active"
		};
		const { entityKey } = await this.cdn.entity.create({
			payload: jsonToPayload(follow),
			contentType: "application/json",
			attributes: [
				{
					key: ATTR_TYPE,
					value: SOCIAL_FOLLOW_TYPE
				},
				{
					key: ATTR_UUID,
					value: this.uuid
				},
				{
					key: ATTR_TARGET_UUID,
					value: targetUuid
				}
			],
			expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
		});
		return {
			entityKey,
			...follow
		};
	}
	/**
	* Unfollows a user. No-op if not currently following.
	*/
	async unfollow(targetUuid) {
		const existing = await this._findFollow(this.uuid, targetUuid);
		if (!existing || existing.status === "removed") return;
		const updated = {
			...existing,
			status: "removed"
		};
		await this.cdn.entity.update({
			entityKey: existing.entityKey,
			payload: jsonToPayload(updated),
			contentType: "application/json",
			attributes: [
				{
					key: ATTR_TYPE,
					value: SOCIAL_FOLLOW_TYPE
				},
				{
					key: ATTR_UUID,
					value: existing.followerUuid
				},
				{
					key: ATTR_TARGET_UUID,
					value: existing.followeeUuid
				}
			],
			expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
		});
	}
	/**
	* Returns `true` if the current user is actively following `targetUuid`.
	*/
	async isFollowing(targetUuid) {
		return (await this._findFollow(this.uuid, targetUuid))?.status === "active";
	}
	/**
	* Returns the list of users that `uuid` (default: current user) is following.
	*/
	async getFollowing(options = {}) {
		const { uuid = this.uuid, limit, offset = 0 } = options;
		return applyPagination$1((await this.cdn.entity.query().where([eq(ATTR_TYPE, SOCIAL_FOLLOW_TYPE), eq(ATTR_UUID, uuid)]).withPayload(true).fetch()).entities.map((e) => e.toJson()).filter((f) => f.status === "active"), offset, limit);
	}
	/**
	* Returns the list of users following `uuid` (default: current user).
	*/
	async getFollowers(options = {}) {
		const { uuid = this.uuid, limit, offset = 0 } = options;
		return applyPagination$1((await this.cdn.entity.query().where([eq(ATTR_TYPE, SOCIAL_FOLLOW_TYPE), eq(ATTR_TARGET_UUID, uuid)]).withPayload(true).fetch()).entities.map((e) => e.toJson()).filter((f) => f.status === "active"), offset, limit);
	}
	/**
	* Returns follower + following counts for `uuid` (default: current user).
	*/
	async getFollowerCounts(uuid = this.uuid) {
		const [followers, following] = await Promise.all([this.getFollowers({ uuid }), this.getFollowing({ uuid })]);
		return {
			followers: followers.length,
			following: following.length
		};
	}
	/**
	* Sends a friend request to `targetUuid`.
	* Returns the created {@link FriendRequest}.
	*/
	async sendFriendRequest(targetUuid, message) {
		const now = Date.now();
		const request = {
			fromUuid: this.uuid,
			fromWallet: this.wallet,
			toUuid: targetUuid,
			sentAt: now,
			status: "pending",
			...message !== void 0 ? { message } : {}
		};
		const { entityKey } = await this.cdn.entity.create({
			payload: jsonToPayload(request),
			contentType: "application/json",
			attributes: [
				{
					key: ATTR_TYPE,
					value: SOCIAL_FRIEND_REQUEST_TYPE
				},
				{
					key: ATTR_UUID,
					value: this.uuid
				},
				{
					key: ATTR_TARGET_UUID,
					value: targetUuid
				}
			],
			expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
		});
		return {
			entityKey,
			...request
		};
	}
	/**
	* Updates the status of a friend request owned by the current user's peer
	* (called by the **recipient**).
	*/
	async _respondToRequest(entityKey, status) {
		const entity = (await this.cdn.entity.query().where([eq(ATTR_TYPE, SOCIAL_FRIEND_REQUEST_TYPE), eq(ATTR_TARGET_UUID, this.uuid)]).withPayload(true).fetch()).entities.find((e) => e.key === entityKey);
		if (!entity) throw new Error(`ASide: friend request "${entityKey}" not found`);
		const req = entity.toJson();
		const updated = {
			...req,
			status,
			respondedAt: Date.now()
		};
		await this.cdn.entity.update({
			entityKey,
			payload: jsonToPayload(updated),
			contentType: "application/json",
			attributes: [
				{
					key: ATTR_TYPE,
					value: SOCIAL_FRIEND_REQUEST_TYPE
				},
				{
					key: ATTR_UUID,
					value: req.fromUuid
				},
				{
					key: ATTR_TARGET_UUID,
					value: req.toUuid
				}
			],
			expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
		});
		return updated;
	}
	/**
	* Accepts a pending friend request (called by the **recipient**).
	* Automatically creates a corresponding follow in both directions.
	*/
	async acceptFriendRequest(entityKey) {
		const updated = await this._respondToRequest(entityKey, "accepted");
		await Promise.all([this.follow(updated.fromUuid), new SocialClient(this.cdn, updated.fromUuid, updated.fromWallet).follow(this.uuid)]);
		return updated;
	}
	/**
	* Rejects a pending friend request (called by the **recipient**).
	*/
	async rejectFriendRequest(entityKey) {
		return this._respondToRequest(entityKey, "rejected");
	}
	/**
	* Cancels an outgoing friend request (called by the **sender**).
	*/
	async cancelFriendRequest(entityKey) {
		const entity = (await this.cdn.entity.query().where([eq(ATTR_TYPE, SOCIAL_FRIEND_REQUEST_TYPE), eq(ATTR_UUID, this.uuid)]).withPayload(true).fetch()).entities.find((e) => e.key === entityKey);
		if (!entity) throw new Error(`ASide: friend request "${entityKey}" not found`);
		const req = entity.toJson();
		const updated = {
			...req,
			status: "cancelled"
		};
		await this.cdn.entity.update({
			entityKey,
			payload: jsonToPayload(updated),
			contentType: "application/json",
			attributes: [
				{
					key: ATTR_TYPE,
					value: SOCIAL_FRIEND_REQUEST_TYPE
				},
				{
					key: ATTR_UUID,
					value: req.fromUuid
				},
				{
					key: ATTR_TARGET_UUID,
					value: req.toUuid
				}
			],
			expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
		});
		return updated;
	}
	/**
	* Returns pending friend requests received by the current user.
	*/
	async getIncomingFriendRequests() {
		return (await this.cdn.entity.query().where([eq(ATTR_TYPE, SOCIAL_FRIEND_REQUEST_TYPE), eq(ATTR_TARGET_UUID, this.uuid)]).withPayload(true).fetch()).entities.map((e) => e.toJson()).filter((r) => r.status === "pending");
	}
	/**
	* Returns pending friend requests sent by the current user.
	*/
	async getOutgoingFriendRequests() {
		return (await this.cdn.entity.query().where([eq(ATTR_TYPE, SOCIAL_FRIEND_REQUEST_TYPE), eq(ATTR_UUID, this.uuid)]).withPayload(true).fetch()).entities.map((e) => e.toJson()).filter((r) => r.status === "pending");
	}
	/**
	* Returns the list of accepted friends (bidirectional follows).
	* A "friend" is a user with whom there is an accepted friend request.
	*/
	async getFriends(options = {}) {
		const { limit, offset = 0 } = options;
		return applyPagination$1((await this.cdn.entity.query().where([eq(ATTR_TYPE, SOCIAL_FRIEND_REQUEST_TYPE)]).withPayload(true).fetch()).entities.map((e) => e.toJson()).filter((r) => r.status === "accepted" && (r.fromUuid === this.uuid || r.toUuid === this.uuid)), offset, limit);
	}
	/**
	* Blocks `targetUuid`. Also unfollows them silently (if following).
	*/
	async block(targetUuid) {
		await this.unfollow(targetUuid);
		const existing = await this._findBlock(this.uuid, targetUuid);
		if (existing && existing.status === "active") return existing;
		const now = Date.now();
		const blockData = {
			byUuid: this.uuid,
			blockedUuid: targetUuid,
			blockedAt: now,
			status: "active"
		};
		if (existing) {
			const updated = {
				...existing,
				status: "active",
				blockedAt: now
			};
			await this.cdn.entity.update({
				entityKey: existing.entityKey,
				payload: jsonToPayload(updated),
				contentType: "application/json",
				attributes: [
					{
						key: ATTR_TYPE,
						value: SOCIAL_BLOCK_TYPE
					},
					{
						key: ATTR_UUID,
						value: existing.byUuid
					},
					{
						key: ATTR_TARGET_UUID,
						value: existing.blockedUuid
					}
				],
				expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
			});
			return updated;
		}
		const { entityKey } = await this.cdn.entity.create({
			payload: jsonToPayload(blockData),
			contentType: "application/json",
			attributes: [
				{
					key: ATTR_TYPE,
					value: SOCIAL_BLOCK_TYPE
				},
				{
					key: ATTR_UUID,
					value: this.uuid
				},
				{
					key: ATTR_TARGET_UUID,
					value: targetUuid
				}
			],
			expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
		});
		return {
			entityKey,
			...blockData
		};
	}
	/**
	* Removes a block on `targetUuid`.
	*/
	async unblock(targetUuid) {
		const existing = await this._findBlock(this.uuid, targetUuid);
		if (!existing || existing.status === "removed") return;
		await this.cdn.entity.update({
			entityKey: existing.entityKey,
			payload: jsonToPayload({
				...existing,
				status: "removed"
			}),
			contentType: "application/json",
			attributes: [
				{
					key: ATTR_TYPE,
					value: SOCIAL_BLOCK_TYPE
				},
				{
					key: ATTR_UUID,
					value: existing.byUuid
				},
				{
					key: ATTR_TARGET_UUID,
					value: existing.blockedUuid
				}
			],
			expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
		});
	}
	/**
	* Returns `true` if the current user has blocked `targetUuid`.
	*/
	async isBlocked(targetUuid) {
		return (await this._findBlock(this.uuid, targetUuid))?.status === "active";
	}
	/**
	* Returns the list of users blocked by the current profile.
	*/
	async getBlockedUsers(options = {}) {
		const { limit, offset = 0 } = options;
		return applyPagination$1((await this.cdn.entity.query().where([eq(ATTR_TYPE, SOCIAL_BLOCK_TYPE), eq(ATTR_UUID, this.uuid)]).withPayload(true).fetch()).entities.map((e) => e.toJson()).filter((b) => b.status === "active"), offset, limit);
	}
	async _findFollow(followerUuid, followeeUuid) {
		const entity = (await this.cdn.entity.query().where([
			eq(ATTR_TYPE, SOCIAL_FOLLOW_TYPE),
			eq(ATTR_UUID, followerUuid),
			eq(ATTR_TARGET_UUID, followeeUuid)
		]).withPayload(true).fetch()).entities[0];
		if (!entity) return null;
		return {
			...entity.toJson(),
			entityKey: entity.key
		};
	}
	async _findBlock(byUuid, blockedUuid) {
		const entity = (await this.cdn.entity.query().where([
			eq(ATTR_TYPE, SOCIAL_BLOCK_TYPE),
			eq(ATTR_UUID, byUuid),
			eq(ATTR_TARGET_UUID, blockedUuid)
		]).withPayload(true).fetch()).entities[0];
		if (!entity) return null;
		return {
			...entity.toJson(),
			entityKey: entity.key
		};
	}
};
function applyPagination$1(items, offset, limit) {
	const sliced = items.slice(offset);
	return limit !== void 0 ? sliced.slice(0, limit) : sliced;
}
//#endregion
//#region src/feed.ts
/**
* FeedClient — posts, likes, comments, and timeline feed.
*
* Obtain via `client.feed()`:
*
* ```ts
* const feed = client.feed()
* const { post } = await feed.createPost({ content: 'Hello world!' })
* await feed.like(post.entityKey)
* const timeline = await feed.getFeed()
* ```
*
* All feed data is stored as entities on ArkaCDN.
*/
var FeedClient = class {
	constructor(cdn, uuid, wallet) {
		this.cdn = cdn;
		this.uuid = uuid;
		this.wallet = wallet;
	}
	/**
	* Creates a new post. Returns the created {@link SocialPost}.
	*/
	async createPost(options) {
		const now = Date.now();
		const post = {
			authorUuid: this.uuid,
			authorWallet: this.wallet,
			content: options.content,
			createdAt: now,
			updatedAt: now,
			status: "active",
			...options.media !== void 0 ? { media: options.media } : {},
			...options.tags !== void 0 ? { tags: options.tags } : {},
			...options.mentions !== void 0 ? { mentions: options.mentions } : {}
		};
		const { entityKey } = await this.cdn.entity.create({
			payload: jsonToPayload(post),
			contentType: "application/json",
			attributes: [
				{
					key: ATTR_TYPE,
					value: SOCIAL_POST_TYPE
				},
				{
					key: ATTR_UUID,
					value: this.uuid
				},
				{
					key: ATTR_WALLET,
					value: this.wallet
				}
			],
			expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
		});
		return {
			entityKey,
			...post
		};
	}
	/**
	* Fetches a single post by entity key.
	* Returns `null` if not found or deleted.
	*/
	async getPost(entityKey) {
		const entity = (await this.cdn.entity.query().where([eq(ATTR_TYPE, SOCIAL_POST_TYPE)]).withPayload(true).fetch()).entities.find((e) => e.key === entityKey);
		if (!entity) return null;
		const post = entity.toJson();
		if (post.status === "removed") return null;
		return {
			...post,
			entityKey: entity.key
		};
	}
	/**
	* Updates the content of the current user's post.
	* Returns the updated post.
	*/
	async updatePost(entityKey, content) {
		const post = await this.getPost(entityKey);
		if (!post) throw new Error(`ASide: post "${entityKey}" not found`);
		if (post.authorUuid !== this.uuid) throw new Error("ASide: cannot edit another user's post");
		const updated = {
			...post,
			content,
			updatedAt: Date.now()
		};
		await this.cdn.entity.update({
			entityKey,
			payload: jsonToPayload(updated),
			contentType: "application/json",
			attributes: [
				{
					key: ATTR_TYPE,
					value: SOCIAL_POST_TYPE
				},
				{
					key: ATTR_UUID,
					value: post.authorUuid
				},
				{
					key: ATTR_WALLET,
					value: post.authorWallet
				}
			],
			expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
		});
		return updated;
	}
	/**
	* Soft-deletes a post (sets `status: "removed"`).
	* Only the post author can delete their post.
	*/
	async deletePost(entityKey) {
		const post = await this.getPost(entityKey);
		if (!post) return;
		if (post.authorUuid !== this.uuid) throw new Error("ASide: cannot delete another user's post");
		await this.cdn.entity.update({
			entityKey,
			payload: jsonToPayload({
				...post,
				status: "removed"
			}),
			contentType: "application/json",
			attributes: [
				{
					key: ATTR_TYPE,
					value: SOCIAL_POST_TYPE
				},
				{
					key: ATTR_UUID,
					value: post.authorUuid
				},
				{
					key: ATTR_WALLET,
					value: post.authorWallet
				}
			],
			expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
		});
	}
	/**
	* Returns all active posts by `uuid` (default: current user).
	*/
	async getUserPosts(options = {}) {
		const { uuid = this.uuid, limit, offset = 0 } = options;
		return applyPagination((await this.cdn.entity.query().where([eq(ATTR_TYPE, SOCIAL_POST_TYPE), eq(ATTR_UUID, uuid)]).withPayload(true).fetch()).entities.map((e) => ({
			...e.toJson(),
			entityKey: e.key
		})).filter((p) => p.status === "active").sort((a, b) => b.createdAt - a.createdAt), offset, limit);
	}
	/**
	* Returns a chronological feed of posts from a list of followed UUIDs.
	* Pass the list explicitly if you have it; otherwise every post is returned.
	*
	* @param followingUuids - UUIDs of accounts to include in the feed.
	*/
	async getFeed(followingUuids, options = {}) {
		const { limit, offset = 0 } = options;
		if (followingUuids.length === 0) return [];
		return applyPagination((await Promise.all(followingUuids.map((uuid) => this.getUserPosts({ uuid })))).flat().sort((a, b) => b.createdAt - a.createdAt), offset, limit);
	}
	/**
	* Adds a reaction to an entity (post or comment).
	* If the user has already reacted with the same type, this is a no-op.
	*/
	async react(targetEntityKey, type = "like") {
		const existing = await this._findReaction(targetEntityKey, this.uuid, type);
		if (existing && existing.status === "active") return existing;
		const now = Date.now();
		const reaction = {
			reactorUuid: this.uuid,
			targetEntityKey,
			type,
			createdAt: now,
			status: "active"
		};
		if (existing) {
			const updated = {
				...existing,
				status: "active"
			};
			await this.cdn.entity.update({
				entityKey: existing.entityKey,
				payload: jsonToPayload(updated),
				contentType: "application/json",
				attributes: [
					{
						key: ATTR_TYPE,
						value: SOCIAL_REACTION_TYPE
					},
					{
						key: ATTR_UUID,
						value: existing.reactorUuid
					},
					{
						key: ATTR_TARGET_KEY,
						value: existing.targetEntityKey
					}
				],
				expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
			});
			return updated;
		}
		const { entityKey } = await this.cdn.entity.create({
			payload: jsonToPayload(reaction),
			contentType: "application/json",
			attributes: [
				{
					key: ATTR_TYPE,
					value: SOCIAL_REACTION_TYPE
				},
				{
					key: ATTR_UUID,
					value: this.uuid
				},
				{
					key: ATTR_TARGET_KEY,
					value: targetEntityKey
				}
			],
			expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
		});
		return {
			entityKey,
			...reaction
		};
	}
	/** Shorthand for `react(key, 'like')`. */
	like(targetEntityKey) {
		return this.react(targetEntityKey, "like");
	}
	/**
	* Removes the current user's reaction of `type` from an entity.
	*/
	async unreact(targetEntityKey, type = "like") {
		const existing = await this._findReaction(targetEntityKey, this.uuid, type);
		if (!existing || existing.status === "removed") return;
		await this.cdn.entity.update({
			entityKey: existing.entityKey,
			payload: jsonToPayload({
				...existing,
				status: "removed"
			}),
			contentType: "application/json",
			attributes: [
				{
					key: ATTR_TYPE,
					value: SOCIAL_REACTION_TYPE
				},
				{
					key: ATTR_UUID,
					value: existing.reactorUuid
				},
				{
					key: ATTR_TARGET_KEY,
					value: existing.targetEntityKey
				}
			],
			expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
		});
	}
	/** Shorthand for `unreact(key, 'like')`. */
	unlike(targetEntityKey) {
		return this.unreact(targetEntityKey, "like");
	}
	/**
	* Returns `true` if the current user has reacted to `targetEntityKey` with `type`.
	*/
	async hasReacted(targetEntityKey, type = "like") {
		return (await this._findReaction(targetEntityKey, this.uuid, type))?.status === "active";
	}
	/**
	* Returns all active reactions for `targetEntityKey`.
	* Optionally filter by reaction type.
	*/
	async getReactions(targetEntityKey, type) {
		return (await this.cdn.entity.query().where([eq(ATTR_TYPE, SOCIAL_REACTION_TYPE), eq(ATTR_TARGET_KEY, targetEntityKey)]).withPayload(true).fetch()).entities.map((e) => ({
			...e.toJson(),
			entityKey: e.key
		})).filter((r) => r.status === "active" && (type === void 0 || r.type === type));
	}
	/**
	* Returns the count of active reactions on `targetEntityKey` per type.
	*/
	async getReactionCounts(targetEntityKey) {
		const reactions = await this.getReactions(targetEntityKey);
		const counts = {
			like: 0,
			love: 0,
			laugh: 0,
			wow: 0,
			sad: 0,
			angry: 0
		};
		for (const r of reactions) counts[r.type]++;
		return counts;
	}
	/**
	* Adds a comment to a post or another comment.
	*/
	async addComment(targetEntityKey, content) {
		const now = Date.now();
		const comment = {
			authorUuid: this.uuid,
			authorWallet: this.wallet,
			targetEntityKey,
			content,
			createdAt: now,
			updatedAt: now,
			status: "active"
		};
		const { entityKey } = await this.cdn.entity.create({
			payload: jsonToPayload(comment),
			contentType: "application/json",
			attributes: [
				{
					key: ATTR_TYPE,
					value: SOCIAL_COMMENT_TYPE
				},
				{
					key: ATTR_UUID,
					value: this.uuid
				},
				{
					key: ATTR_TARGET_KEY,
					value: targetEntityKey
				}
			],
			expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
		});
		return {
			entityKey,
			...comment
		};
	}
	/**
	* Updates the content of the current user's comment.
	*/
	async editComment(entityKey, content) {
		const comment = (await this._getCommentsByKey(entityKey))[0];
		if (!comment) throw new Error(`ASide: comment "${entityKey}" not found`);
		if (comment.authorUuid !== this.uuid) throw new Error("ASide: cannot edit another user's comment");
		const updated = {
			...comment,
			content,
			updatedAt: Date.now()
		};
		await this.cdn.entity.update({
			entityKey,
			payload: jsonToPayload(updated),
			contentType: "application/json",
			attributes: [
				{
					key: ATTR_TYPE,
					value: SOCIAL_COMMENT_TYPE
				},
				{
					key: ATTR_UUID,
					value: comment.authorUuid
				},
				{
					key: ATTR_TARGET_KEY,
					value: comment.targetEntityKey
				}
			],
			expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
		});
		return updated;
	}
	/**
	* Soft-deletes a comment.
	*/
	async deleteComment(entityKey) {
		const comment = (await this._getCommentsByKey(entityKey))[0];
		if (!comment) return;
		if (comment.authorUuid !== this.uuid) throw new Error("ASide: cannot delete another user's comment");
		await this.cdn.entity.update({
			entityKey,
			payload: jsonToPayload({
				...comment,
				status: "removed"
			}),
			contentType: "application/json",
			attributes: [
				{
					key: ATTR_TYPE,
					value: SOCIAL_COMMENT_TYPE
				},
				{
					key: ATTR_UUID,
					value: comment.authorUuid
				},
				{
					key: ATTR_TARGET_KEY,
					value: comment.targetEntityKey
				}
			],
			expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
		});
	}
	/**
	* Returns all active comments on `targetEntityKey`, sorted oldest-first.
	*/
	async getComments(targetEntityKey, options = {}) {
		const { limit, offset = 0 } = options;
		return applyPagination((await this.cdn.entity.query().where([eq(ATTR_TYPE, SOCIAL_COMMENT_TYPE), eq(ATTR_TARGET_KEY, targetEntityKey)]).withPayload(true).fetch()).entities.map((e) => ({
			...e.toJson(),
			entityKey: e.key
		})).filter((c) => c.status === "active").sort((a, b) => a.createdAt - b.createdAt), offset, limit);
	}
	async _findReaction(targetEntityKey, reactorUuid, type) {
		const entity = (await this.cdn.entity.query().where([
			eq(ATTR_TYPE, SOCIAL_REACTION_TYPE),
			eq(ATTR_UUID, reactorUuid),
			eq(ATTR_TARGET_KEY, targetEntityKey)
		]).withPayload(true).fetch()).entities.find((e) => {
			return e.toJson().type === type;
		});
		if (!entity) return null;
		return {
			...entity.toJson(),
			entityKey: entity.key
		};
	}
	async _getCommentsByKey(entityKey) {
		return (await this.cdn.entity.query().where([eq(ATTR_TYPE, SOCIAL_COMMENT_TYPE)]).withPayload(true).fetch()).entities.filter((e) => e.key === entityKey).map((e) => ({
			...e.toJson(),
			entityKey: e.key
		}));
	}
};
function applyPagination(items, offset, limit) {
	const sliced = items.slice(offset);
	return limit !== void 0 ? sliced.slice(0, limit) : sliced;
}
//#endregion
//#region src/base-client.ts
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
var BaseClient = class {
	uuid;
	wallet;
	photo;
	displayName;
	bio;
	_cdn;
	constructor(options) {
		this.uuid = options.uuid;
		this.wallet = options.wallet;
		this.photo = options.photo;
		this.displayName = options.displayName;
		this.bio = options.bio;
		this._cdn = options.cdn;
	}
	/**
	* Sets (or replaces) the ArkaCDN instance used by this client.
	* Useful when the CDN is created after the client.
	*/
	setCdn(cdn) {
		this._cdn = cdn;
		return this;
	}
	/** Returns the current ArkaCDN instance. Throws if not set. */
	get cdn() {
		if (!this._cdn) throw new Error("ASide: no CDN configured. Pass `cdn` to the constructor or call `setCdn()` first.");
		return this._cdn;
	}
	async findProfile(searchCdn) {
		const entity = (await searchCdn.entity.query().where([
			eq(ATTR_TYPE, PROFILE_TYPE),
			eq(ATTR_UUID, this.uuid),
			eq(ATTR_WALLET, this.wallet)
		]).withPayload(true).withAttributes(true).fetch()).entities[0];
		if (!entity) return null;
		const profile = entity.toJson();
		return {
			entityKey: entity.key,
			profile
		};
	}
	async createProfileOn(targetCdn, syncedFrom) {
		const now = Date.now();
		const profileData = {
			uuid: this.uuid,
			wallet: this.wallet,
			photo: this.photo,
			...this.displayName != null ? { displayName: this.displayName } : {},
			...this.bio != null ? { bio: this.bio } : {},
			createdAt: now,
			updatedAt: now,
			...syncedFrom != null ? { syncedFrom } : {}
		};
		const { entityKey } = await targetCdn.entity.create({
			payload: jsonToPayload(profileData),
			contentType: "application/json",
			attributes: [
				{
					key: ATTR_TYPE,
					value: PROFILE_TYPE
				},
				{
					key: ATTR_UUID,
					value: this.uuid
				},
				{
					key: ATTR_WALLET,
					value: this.wallet
				}
			],
			expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
		});
		return {
			entityKey,
			profile: profileData
		};
	}
	/**
	* Fetches the profile from the current chain.
	* Returns `null` if no profile exists yet.
	*/
	async get() {
		return this.findProfile(this.cdn);
	}
	/**
	* Fetches the profile from a specific CDN instance (not the default one).
	* Used by the watcher and cross-chain sync.
	*/
	async getOnChain(cdn) {
		return this.findProfile(cdn);
	}
	/**
	* Fetches the profile. If none exists, creates it on the current chain.
	*/
	async getOrCreate() {
		const existing = await this.findProfile(this.cdn);
		if (existing) return existing;
		return this.createProfileOn(this.cdn);
	}
	/**
	* Updates mutable profile fields on the current chain.
	* Throws if the profile has not been created yet.
	*/
	async update(data) {
		const existing = await this.findProfile(this.cdn);
		if (!existing) throw new Error(`ASide: profile not found for uuid="${this.uuid}". Call getOrCreate() first.`);
		const now = Date.now();
		const updated = {
			...existing.profile,
			...data,
			uuid: this.uuid,
			wallet: this.wallet,
			updatedAt: now
		};
		await this.cdn.entity.update({
			entityKey: existing.entityKey,
			payload: jsonToPayload(updated),
			contentType: "application/json",
			attributes: [
				{
					key: ATTR_TYPE,
					value: PROFILE_TYPE
				},
				{
					key: ATTR_UUID,
					value: this.uuid
				},
				{
					key: ATTR_WALLET,
					value: this.wallet
				}
			],
			expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
		});
		return {
			entityKey: existing.entityKey,
			profile: updated
		};
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
	async sync(otherChains) {
		const existing = await this.findProfile(this.cdn);
		if (existing) return existing;
		for (const otherCdn of otherChains) {
			const found = await this.findProfile(otherCdn);
			if (found) {
				const now = Date.now();
				const replicatedData = {
					...found.profile,
					updatedAt: now,
					syncedFrom: found.entityKey
				};
				const { entityKey } = await this.cdn.entity.create({
					payload: jsonToPayload(replicatedData),
					contentType: "application/json",
					attributes: [
						{
							key: ATTR_TYPE,
							value: PROFILE_TYPE
						},
						{
							key: ATTR_UUID,
							value: this.uuid
						},
						{
							key: ATTR_WALLET,
							value: this.wallet
						}
					],
					expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400)
				});
				return {
					entityKey,
					profile: replicatedData
				};
			}
		}
		return this.createProfileOn(this.cdn);
	}
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
	extend(namespace) {
		return new ExtensionClient(namespace, this.cdn, this.uuid, this.wallet);
	}
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
	social() {
		return new SocialClient(this.cdn, this.uuid, this.wallet);
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
	feed() {
		return new FeedClient(this.cdn, this.uuid, this.wallet);
	}
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
	async createAccessToken(options) {
		return new AccessTokenManager().create({
			...options,
			issuerUuid: this.uuid,
			issuerWallet: this.wallet
		});
	}
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
	watch(opts) {
		return new ProfileWatcher(this, opts);
	}
};
//#endregion
//#region src/qr.ts
const SCHEME = "aside://v1";
const DEFAULT_FRIEND_QR_TTL_MS = 900 * 1e3;
function toBase64url(json) {
	const str = JSON.stringify(json);
	const bytes = new TextEncoder().encode(str);
	const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function fromBase64url(b64) {
	const padded = b64.replace(/-/g, "+").replace(/_/g, "/").padEnd(b64.length + (4 - b64.length % 4) % 4, "=");
	try {
		const binary = atob(padded);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return null;
	}
}
function randomNonce() {
	return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
}
/**
* Encodes a profile link as a scannable `aside://v1/profile?{payload}` URI.
*
* Profile QR codes are **public** — they contain no sensitive data.
*
* @example
* ```ts
* const uri = encodeProfileLink({ uuid, wallet, displayName: 'Alice', photo })
* // Pass `uri` to your QR library to render
* ```
*/
function encodeProfileLink(data) {
	return `${SCHEME}/profile?${toBase64url({
		version: 1,
		type: "profile",
		uuid: data.uuid,
		wallet: data.wallet,
		...data.displayName !== void 0 ? { displayName: data.displayName } : {},
		...data.photo !== void 0 ? { photo: data.photo } : {}
	})}`;
}
/**
* Decodes a profile QR URI produced by {@link encodeProfileLink}.
*
* Returns `null` if the URI is malformed or not a valid ASide profile link.
*/
function decodeProfileLink(uri) {
	const data = parseUri(uri, "profile");
	if (!data) return null;
	if (typeof data !== "object" || data === null || !hasStringProp(data, "uuid") || !hasStringProp(data, "wallet")) return null;
	return data;
}
/**
* Encodes a time-limited friend request as a scannable `aside://v1/friend_request?{payload}` URI.
*
* The QR code expires after `options.expiresInMs` (default: 15 minutes).
* A random nonce is embedded so the recipient can detect duplicate scans the same QR.
*
* @example
* ```ts
* const uri = encodeFriendRequest({
*   fromUuid: client.uuid,
*   fromWallet: client.wallet,
*   displayName: 'Alice',
*   message: 'Hey, add me!',
* })
* ```
*/
function encodeFriendRequest(data, options = {}) {
	const ttl = options.expiresInMs ?? DEFAULT_FRIEND_QR_TTL_MS;
	return `${SCHEME}/friend_request?${toBase64url({
		version: 1,
		type: "friend_request",
		fromUuid: data.fromUuid,
		fromWallet: data.fromWallet,
		expiresAt: Date.now() + ttl,
		nonce: randomNonce(),
		...data.displayName !== void 0 ? { displayName: data.displayName } : {},
		...options.message !== void 0 ? { message: options.message } : {},
		...data.message !== void 0 ? { message: data.message } : {}
	})}`;
}
/**
* Decodes a friend-request QR URI produced by {@link encodeFriendRequest}.
*
* Returns `null` if the URI is malformed, not a valid ASide friend request, or
* has already **expired**. Always check the return value before proceeding.
*
* @example
* ```ts
* const reqData = decodeFriendRequest(scannedUri)
* if (!reqData) { alert('QR code expired or invalid'); return }
* await social.sendFriendRequest(reqData.fromUuid)
* ```
*/
function decodeFriendRequest(uri) {
	const data = parseUri(uri, "friend_request");
	if (!data) return null;
	if (typeof data !== "object" || data === null || !hasStringProp(data, "fromUuid") || !hasStringProp(data, "fromWallet") || !hasNumberProp(data, "expiresAt") || !hasStringProp(data, "nonce")) return null;
	const req = data;
	if (Date.now() > req.expiresAt) return null;
	return req;
}
/**
* Returns `true` if `uri` is a valid (and not expired) ASide friend request QR.
* Convenience wrapper around {@link decodeFriendRequest}.
*/
function isFriendRequestQRValid(uri) {
	return decodeFriendRequest(uri) !== null;
}
/**
* Returns the number of milliseconds remaining before a friend request QR expires.
* Returns `0` if already expired or the URI is invalid.
*/
function friendRequestQRExpiresIn(uri) {
	const data = parseUri(uri, "friend_request");
	if (!data || typeof data !== "object" || data === null || !hasNumberProp(data, "expiresAt")) return -Infinity;
	return data.expiresAt - Date.now();
}
/**
* Parses any `aside://v1/{type}?{payload}` URI.
* Returns the decoded JSON payload or `null` on error.
*/
function parseAsideUri(uri) {
	if (!uri.startsWith(`${SCHEME}/`)) return null;
	const withoutScheme = uri.slice(`${SCHEME}/`.length);
	const qIdx = withoutScheme.indexOf("?");
	if (qIdx === -1) return null;
	const type = withoutScheme.slice(0, qIdx);
	const payload = fromBase64url(withoutScheme.slice(qIdx + 1));
	if (payload === null) return null;
	return {
		type,
		payload
	};
}
function parseUri(uri, expectedType) {
	const parsed = parseAsideUri(uri);
	if (!parsed || parsed.type !== expectedType) return null;
	return parsed.payload;
}
function hasStringProp(obj, key) {
	return key in obj && typeof obj[key] === "string";
}
function hasNumberProp(obj, key) {
	return key in obj && typeof obj[key] === "number";
}
//#endregion
export { ATTR_NAMESPACE, ATTR_TARGET_KEY, ATTR_TARGET_UUID, ATTR_TYPE, ATTR_UUID, ATTR_WALLET, AccessTokenManager, BaseClient, DEFAULT_EXPIRY_SECONDS, EXTENSION_TYPE, ExtensionClient, FeedClient, PROFILE_TYPE, ProfileWatcher, SNOWFLAKE_EPOCH, SOCIAL_BLOCK_TYPE, SOCIAL_COMMENT_TYPE, SOCIAL_FOLLOW_TYPE, SOCIAL_FRIEND_REQUEST_TYPE, SOCIAL_POST_TYPE, SOCIAL_REACTION_TYPE, SnowflakeGenerator, SocialClient, aesDecrypt, aesEncrypt, decodeFriendRequest, decodeProfileLink, ecdhDeriveKeys, encodeFriendRequest, encodeProfileLink, friendRequestQRExpiresIn, generateAesKey, generateAppKeyPair, hmacSign, hmacVerify, isFriendRequestQRValid, parseAsideUri, phraseToCommitment, verifyPhraseCommitment };

//# sourceMappingURL=index.mjs.map