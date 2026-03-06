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
 * Options for constructing a {@link BaseClient}.
 *
 * `cdn` is **optional** — you can provide it later via `client.setCdn(cdn)`
 * or pass it at construction time for immediate use.
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
  /**
   * ArkaCDN instance for the current chain.
   * Optional at construction — can be provided later with `setCdn()`.
   */
  cdn?: ArkaCDN;
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
/**
 * A permission definition for a custom permission bit.
 * Permissions are stored as a bigint bitmask inside the ASide snowflake.
 */
interface PermissionDefinition {
  /** Unique name for this permission (e.g. "READ_PROFILE"). */
  name: string;
  /** The bit position (0–62). Each position = 2^n in the bitmask. */
  bit: number;
  /** Human-readable description. */
  description?: string;
}
/**
 * A Snowflake ID with embedded permission bits.
 * Format (128-bit, encoded as hex string):
 *   [48-bit timestamp ms][14-bit worker/datacenter][14-bit sequence][52-bit permissions]
 */
type PermissionSnowflake = string;
/**
 * Claims embedded inside an ASide access token (the encrypted payload).
 * All fields travel inside the AES-GCM ciphertext — never in plaintext.
 */
interface AccessTokenClaims {
  /** Application ID that requested this token. */
  appId: string;
  /** Domain the app is authorized for. */
  domain: string;
  /**
   * Snowflake encoding the granted permissions bitmask.
   * Decode with `SnowflakeGenerator.extractPermissions(snowflake)`.
   */
  permissions: PermissionSnowflake;
  /** Issued-at timestamp (Unix ms). */
  issuedAt: number;
  /** Token expiry timestamp (Unix ms). */
  expiresAt: number;
  /** UUID of the profile that issued this token. */
  issuerUuid: string;
  /** Wallet address of the profile owner. */
  issuerWallet: string;
  /** Unique token ID (snowflake). Used for reference / revocation hints. */
  tokenId: PermissionSnowflake;
}
/**
 * A sealed access token ready to be handed to a third-party app.
 *
 * The inner claims are AES-256-GCM encrypted with a key derived from ECDH:
 * - The **client** uses the app's published public key + a freshly generated
 *   ephemeral key pair. The derived key never leaves the client.
 * - The **app server** uses its private key + the token's `ephemeralPublicKey`
 *   to re-derive the identical key and decrypt.
 */
interface SealedAccessToken {
  /** Encrypted claims payload (base64url). */
  ciphertext: string;
  /** AES-GCM initialization vector (base64url, 12 bytes). */
  iv: string;
  /** App ID — in plaintext so the recipient can look up its key pair. */
  appId: string;
  /** Token ID so it can be referenced/revoked without decrypting. */
  tokenId: PermissionSnowflake;
  /** Expiry so clients can reject obviously expired tokens before decryption. */
  expiresAt: number;
  /**
   * Ephemeral ECDH P-256 public key (uncompressed, hex, 65 bytes).
   * The server uses this with its private key to derive the AES encryption key.
   * Safe to transmit publicly — math guarantees the shared secret stays secret.
   */
  ephemeralPublicKey: string;
}
/** Returned by `AccessTokenManager.create()`. */
interface CreateAccessTokenResult {
  /** The sealed token to hand to the app server. */
  token: SealedAccessToken;
  /**
   * Session HMAC key (hex) derived from the ECDH shared secret.
   * Stored by the client and passed to `createSessionRequest()`.
   * The server always re-derives this value during `validateSession()`.
   */
  sessionKey: string;
}
/**
 * Options for creating an access token.
 */
interface CreateAccessTokenOptions {
  /** The application ID being authorized. */
  appId: string;
  /** Domain the token is valid for (e.g. "example.com"). */
  domain: string;
  /** Permission bitmask or a pre-generated snowflake. Pass a `bigint` for a raw bitmask. */
  permissions: bigint | PermissionSnowflake;
  /** Token lifetime in milliseconds. Default: 1 hour (3_600_000). */
  ttlMs?: number;
  /**
   * The app's ECDH P-256 public key (uncompressed, hex).
   * Obtained from the app server. Safe to transmit over any channel.
   */
  appPublicKey: string;
  /**
   * The user's private phrase. AES-256-GCM encrypted inside the token —
   * never transmitted in plaintext.
   */
  phrase: string;
  /** Automatically set by `BaseClient.createAccessToken()`. */
  issuerUuid?: string;
  /** Automatically set by `BaseClient.createAccessToken()`. */
  issuerWallet?: string;
}
/**
 * Options for validating an access token.
 */
interface ValidateTokenOptions {
  /** The sealed token to validate. */
  token: SealedAccessToken;
  /**
   * The app's ECDH P-256 private key (PKCS8 hex).
   * Only the app server should hold this. Used to re-derive the AES key.
   */
  appPrivateKey: string;
  /** Expected domain. Validation fails if `claims.domain` does not match. */
  expectedDomain?: string;
  /** Expected app ID. Validation fails if `claims.appId` does not match. */
  expectedAppId?: string;
}
/** Result of a successful token validation. */
interface ValidateTokenResult {
  valid: true;
  /** The decrypted, verified claims. */
  claims: AccessTokenClaims;
  /** The decrypted user phrase (only available after correct decryption). */
  phrase: string;
  /**
   * Session HMAC key re-derived from the ECDH shared secret.
   * Pass to `validateSession()` to verify signed session requests.
   */
  sessionKey: string;
}
/** Result of a failed token validation. */
interface InvalidTokenResult {
  valid: false;
  reason: string;
}
/**
 * An ECDH P-256 key pair used for app-server token authorization.
 *
 * The server generates this pair once (or rotates periodically).
 * - **`privateKey`** — PKCS8-encoded hex; kept on the server, never shared.
 * - **`publicKey`**  — Uncompressed P-256 raw hex (65 bytes); publish on-chain or via API.
 *
 * With this scheme, no shared secret is ever transmitted: each token carries an
 * ephemeral public key and the server re-derives the matching encryption key locally.
 */
interface AppKeyPair {
  /** PKCS8-encoded EC private key as hex string. **Never share this.** */
  privateKey: string;
  /** Uncompressed P-256 public key (65 bytes) as hex. Safe to publish. */
  publicKey: string;
  /** Unique ID for tracking which key pair was used (for rotation). */
  keyId: string;
  /** Unix timestamp (ms) when this key pair was created. */
  createdAt: number;
  /** Unix timestamp (ms) when this key pair expires. */
  expiresAt: number;
}
/**
 * @deprecated Use {@link AppKeyPair} and {@link generateAppKeyPair} instead.
 * The symmetric parity key scheme is vulnerable to interception during key exchange.
 */
interface ParityKeyPair {
  /** @deprecated */
  key: string;
  /** @deprecated */
  keyId: string;
  /** @deprecated */
  expiresAt: number;
}
/** A named CDN instance for a specific chain/network. */
interface ChainCDN {
  /** Human-readable chain name (e.g. "kaolin", "mendoza"). */
  name: string;
  /** The ArkaCDN instance for this chain. */
  cdn: ArkaCDN;
}
/** Result from a watcher poll — one entry per chain. */
interface WatcherChainResult {
  chain: string;
  exists: boolean;
  profile: BaseProfileResult | null;
}
/** Options for {@link ProfileWatcher}. */
interface WatcherOptions {
  /** Chains to watch. */
  chains: ChainCDN[];
  /** Polling interval in ms. Default: 10_000 (10 seconds). */
  intervalMs?: number;
  /** Called each time a poll cycle completes. */
  onPoll?: (results: WatcherChainResult[]) => void;
  /** Called the first time a profile is found on a chain it wasn't on before. */
  onFound?: (chain: string, result: BaseProfileResult) => void;
  /** Called if a previously-found profile disappears from a chain. */
  onLost?: (chain: string) => void;
}
/**
 * A session request payload — sent from the client to a service to prove
 * possession of a valid token without re-transmitting it every time.
 *
 * The signature is HMAC-SHA256 over `"${nonce}:${requestedAt}:${tokenId}"`
 * using the session key derived from the ECDH exchange.
 *
 * The server MUST track used nonces within the token's validity window to
 * prevent replay attacks.
 */
interface SessionRequest {
  /** The sealed access token that authorized this session. */
  token: SealedAccessToken;
  /** Unix timestamp (ms) when this specific request was created. */
  requestedAt: number;
  /**
   * Unique nonce for this request.
   * Auto-generated by `createSessionRequest()`. The server SHOULD store and
   * reject nonces it has already seen within the token's lifetime.
   */
  nonce: string;
  /** HMAC-SHA256 over `${nonce}:${requestedAt}:${tokenId}` (hex). */
  signature: string;
}
type SocialStatus = 'active' | 'removed';
type FriendRequestStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';
type ReactionType = 'like' | 'love' | 'laugh' | 'wow' | 'sad' | 'angry';
type PostMediaType = 'image' | 'video' | 'audio';
interface SocialFollow {
  entityKey: string;
  followerUuid: string;
  followeeUuid: string;
  followedAt: number;
  status: SocialStatus;
}
interface FriendRequest {
  entityKey: string;
  fromUuid: string;
  fromWallet: string;
  toUuid: string;
  message?: string;
  sentAt: number;
  respondedAt?: number;
  status: FriendRequestStatus;
}
interface SocialPost {
  entityKey: string;
  authorUuid: string;
  authorWallet: string;
  content: string;
  media?: PostMedia[];
  tags?: string[];
  /** UUIDs of mentioned profiles. */
  mentions?: string[];
  createdAt: number;
  updatedAt: number;
  status: SocialStatus;
}
interface PostMedia {
  url: string;
  type: PostMediaType;
  alt?: string;
}
interface SocialReaction {
  entityKey: string;
  reactorUuid: string;
  /** Entity key of the post or comment being reacted to. */
  targetEntityKey: string;
  type: ReactionType;
  createdAt: number;
  status: SocialStatus;
}
interface SocialComment {
  entityKey: string;
  authorUuid: string;
  authorWallet: string;
  /** Entity key of the post this comment belongs to. */
  targetEntityKey: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  status: SocialStatus;
}
interface SocialBlock {
  entityKey: string;
  byUuid: string;
  blockedUuid: string;
  blockedAt: number;
  status: SocialStatus;
}
interface CreatePostOptions {
  content: string;
  media?: PostMedia[];
  tags?: string[];
  mentions?: string[];
}
interface PaginationOptions {
  limit?: number;
  offset?: number;
}
/** Decoded data from a profile QR code. */
interface ProfileQRData {
  version: 1;
  type: 'profile';
  uuid: string;
  wallet: string;
  displayName?: string;
  photo?: string;
}
/** Decoded data from a friend-request QR code. */
interface FriendRequestQRData {
  version: 1;
  type: 'friend_request';
  fromUuid: string;
  fromWallet: string;
  displayName?: string;
  message?: string;
  /** Unix timestamp (ms) after which this QR code should be rejected. */
  expiresAt: number;
  /** Random nonce to prevent QR re-scanning attacks. */
  nonce: string;
}
interface QREncodeOptions {
  /** Lifetime of the QR data in ms. Default: 15 minutes. */
  expiresInMs?: number;
  /** Optional human-readable message embedded in the QR. */
  message?: string;
}
//#endregion
//#region src/extension.d.ts
/**
 * Internal implementation of {@link ExtensionClientInstance}.
 * Manages a single app-specific extension entity on-chain,
 * linked to a base profile via `uuid` + `wallet` + `namespace`.
 */
declare class ExtensionClient<T extends Record<string, unknown>> implements ExtensionClientInstance<T> {
  private readonly namespace;
  private readonly cdn;
  private readonly uuid;
  private readonly wallet;
  constructor(namespace: string, cdn: ArkaCDN, uuid: string, wallet: string);
  private findExtension;
  get(): Promise<ExtensionResult<T> | null>;
  getOrCreate(initialData: T): Promise<ExtensionResult<T>>;
  update(data: Partial<T>): Promise<ExtensionResult<T>>;
}
//#endregion
//#region src/watcher.d.ts
declare class ProfileWatcher {
  private readonly client;
  private readonly opts;
  private timer;
  private readonly lastSeen;
  constructor(client: BaseClient, opts: WatcherOptions);
  get running(): boolean;
  /** Starts polling. */
  start(): this;
  /** Stops polling. */
  stop(): this;
  /**
   * Runs one poll cycle manually.
   * Called automatically when `start()` is active.
   */
  poll(): Promise<WatcherChainResult[]>;
}
//#endregion
//#region src/social.d.ts
declare class SocialClient {
  private readonly cdn;
  private readonly uuid;
  private readonly wallet;
  constructor(cdn: ArkaCDN, uuid: string, wallet: string);
  /**
   * Follows a user identified by `targetUuid`.
   * If a follow entity already exists (even if unfollowed), it is reactivated.
   * Returns the updated/created follow record.
   */
  follow(targetUuid: string): Promise<SocialFollow>;
  /**
   * Unfollows a user. No-op if not currently following.
   */
  unfollow(targetUuid: string): Promise<void>;
  /**
   * Returns `true` if the current user is actively following `targetUuid`.
   */
  isFollowing(targetUuid: string): Promise<boolean>;
  /**
   * Returns the list of users that `uuid` (default: current user) is following.
   */
  getFollowing(options?: PaginationOptions & {
    uuid?: string;
  }): Promise<SocialFollow[]>;
  /**
   * Returns the list of users following `uuid` (default: current user).
   */
  getFollowers(options?: PaginationOptions & {
    uuid?: string;
  }): Promise<SocialFollow[]>;
  /**
   * Returns follower + following counts for `uuid` (default: current user).
   */
  getFollowerCounts(uuid?: string): Promise<{
    followers: number;
    following: number;
  }>;
  /**
   * Sends a friend request to `targetUuid`.
   * Returns the created {@link FriendRequest}.
   */
  sendFriendRequest(targetUuid: string, message?: string): Promise<FriendRequest>;
  /**
   * Updates the status of a friend request owned by the current user's peer
   * (called by the **recipient**).
   */
  private _respondToRequest;
  /**
   * Accepts a pending friend request (called by the **recipient**).
   * Automatically creates a corresponding follow in both directions.
   */
  acceptFriendRequest(entityKey: string): Promise<FriendRequest>;
  /**
   * Rejects a pending friend request (called by the **recipient**).
   */
  rejectFriendRequest(entityKey: string): Promise<FriendRequest>;
  /**
   * Cancels an outgoing friend request (called by the **sender**).
   */
  cancelFriendRequest(entityKey: string): Promise<FriendRequest>;
  /**
   * Returns pending friend requests received by the current user.
   */
  getIncomingFriendRequests(): Promise<FriendRequest[]>;
  /**
   * Returns pending friend requests sent by the current user.
   */
  getOutgoingFriendRequests(): Promise<FriendRequest[]>;
  /**
   * Returns the list of accepted friends (bidirectional follows).
   * A "friend" is a user with whom there is an accepted friend request.
   */
  getFriends(options?: PaginationOptions): Promise<FriendRequest[]>;
  /**
   * Blocks `targetUuid`. Also unfollows them silently (if following).
   */
  block(targetUuid: string): Promise<SocialBlock>;
  /**
   * Removes a block on `targetUuid`.
   */
  unblock(targetUuid: string): Promise<void>;
  /**
   * Returns `true` if the current user has blocked `targetUuid`.
   */
  isBlocked(targetUuid: string): Promise<boolean>;
  /**
   * Returns the list of users blocked by the current profile.
   */
  getBlockedUsers(options?: PaginationOptions): Promise<SocialBlock[]>;
  private _findFollow;
  private _findBlock;
}
//#endregion
//#region src/feed.d.ts
declare class FeedClient {
  private readonly cdn;
  private readonly uuid;
  private readonly wallet;
  constructor(cdn: ArkaCDN, uuid: string, wallet: string);
  /**
   * Creates a new post. Returns the created {@link SocialPost}.
   */
  createPost(options: CreatePostOptions): Promise<SocialPost>;
  /**
   * Fetches a single post by entity key.
   * Returns `null` if not found or deleted.
   */
  getPost(entityKey: string): Promise<SocialPost | null>;
  /**
   * Updates the content of the current user's post.
   * Returns the updated post.
   */
  updatePost(entityKey: string, content: string): Promise<SocialPost>;
  /**
   * Soft-deletes a post (sets `status: "removed"`).
   * Only the post author can delete their post.
   */
  deletePost(entityKey: string): Promise<void>;
  /**
   * Returns all active posts by `uuid` (default: current user).
   */
  getUserPosts(options?: PaginationOptions & {
    uuid?: string;
  }): Promise<SocialPost[]>;
  /**
   * Returns a chronological feed of posts from a list of followed UUIDs.
   * Pass the list explicitly if you have it; otherwise every post is returned.
   *
   * @param followingUuids - UUIDs of accounts to include in the feed.
   */
  getFeed(followingUuids: string[], options?: PaginationOptions): Promise<SocialPost[]>;
  /**
   * Adds a reaction to an entity (post or comment).
   * If the user has already reacted with the same type, this is a no-op.
   */
  react(targetEntityKey: string, type?: ReactionType): Promise<SocialReaction>;
  /** Shorthand for `react(key, 'like')`. */
  like(targetEntityKey: string): Promise<SocialReaction>;
  /**
   * Removes the current user's reaction of `type` from an entity.
   */
  unreact(targetEntityKey: string, type?: ReactionType): Promise<void>;
  /** Shorthand for `unreact(key, 'like')`. */
  unlike(targetEntityKey: string): Promise<void>;
  /**
   * Returns `true` if the current user has reacted to `targetEntityKey` with `type`.
   */
  hasReacted(targetEntityKey: string, type?: ReactionType): Promise<boolean>;
  /**
   * Returns all active reactions for `targetEntityKey`.
   * Optionally filter by reaction type.
   */
  getReactions(targetEntityKey: string, type?: ReactionType): Promise<SocialReaction[]>;
  /**
   * Returns the count of active reactions on `targetEntityKey` per type.
   */
  getReactionCounts(targetEntityKey: string): Promise<Record<ReactionType, number>>;
  /**
   * Adds a comment to a post or another comment.
   */
  addComment(targetEntityKey: string, content: string): Promise<SocialComment>;
  /**
   * Updates the content of the current user's comment.
   */
  editComment(entityKey: string, content: string): Promise<SocialComment>;
  /**
   * Soft-deletes a comment.
   */
  deleteComment(entityKey: string): Promise<void>;
  /**
   * Returns all active comments on `targetEntityKey`, sorted oldest-first.
   */
  getComments(targetEntityKey: string, options?: PaginationOptions): Promise<SocialComment[]>;
  private _findReaction;
  private _getCommentsByKey;
}
//#endregion
//#region src/base-client.d.ts
declare class BaseClient {
  readonly uuid: string;
  readonly wallet: string;
  readonly photo: string;
  readonly displayName: string | undefined;
  readonly bio: string | undefined;
  protected _cdn: ArkaCDN | undefined;
  constructor(options: BaseClientOptions);
  /**
   * Sets (or replaces) the ArkaCDN instance used by this client.
   * Useful when the CDN is created after the client.
   */
  setCdn(cdn: ArkaCDN): this;
  /** Returns the current ArkaCDN instance. Throws if not set. */
  get cdn(): ArkaCDN;
  protected findProfile(searchCdn: ArkaCDN): Promise<BaseProfileResult | null>;
  private createProfileOn;
  /**
   * Fetches the profile from the current chain.
   * Returns `null` if no profile exists yet.
   */
  get(): Promise<BaseProfileResult | null>;
  /**
   * Fetches the profile from a specific CDN instance (not the default one).
   * Used by the watcher and cross-chain sync.
   */
  getOnChain(cdn: ArkaCDN): Promise<BaseProfileResult | null>;
  /**
   * Fetches the profile. If none exists, creates it on the current chain.
   */
  getOrCreate(): Promise<BaseProfileResult>;
  /**
   * Updates mutable profile fields on the current chain.
   * Throws if the profile has not been created yet.
   */
  update(data: Partial<Pick<BaseProfileData, 'photo' | 'displayName' | 'bio'>>): Promise<BaseProfileResult>;
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
  sync(otherChains: ArkaCDN[]): Promise<BaseProfileResult>;
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
  extend<T extends Record<string, unknown>>(namespace: string): ExtensionClient<T>;
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
  social(): SocialClient;
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
  feed(): FeedClient;
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
  createAccessToken(options: Omit<CreateAccessTokenOptions, 'issuerUuid' | 'issuerWallet'>): Promise<CreateAccessTokenResult>;
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
  watch(opts: WatcherOptions): ProfileWatcher;
}
//#endregion
//#region src/access-token.d.ts
declare class AccessTokenManager {
  private readonly workerId;
  private readonly sf;
  constructor(workerId?: bigint | number);
  /**
   * Creates a sealed access token using ECDH P-256 key exchange.
   *
   * Returns both the `token` (hand to the app server) and a `sessionKey`
   * (retain client-side for signing session requests).
   */
  create(options: CreateAccessTokenOptions): Promise<CreateAccessTokenResult>;
  /**
   * Validates and decrypts a sealed access token.
   *
   * Returns `{ valid: true, claims, phrase, sessionKey }` on success, or
   * `{ valid: false, reason }` on failure.
   */
  validate(options: ValidateTokenOptions): Promise<ValidateTokenResult | InvalidTokenResult>;
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
  createSessionRequest(token: SealedAccessToken, sessionKey: string, nonce?: string): Promise<SessionRequest>;
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
  validateSession(request: SessionRequest, appPrivateKey: string, options?: {
    expectedDomain?: string;
    expectedAppId?: string;
  }): Promise<ValidateTokenResult | InvalidTokenResult>;
}
//#endregion
//#region src/snowflake.d.ts
interface SnowflakeGeneratorOptions {
  /** Worker / datacenter ID (0 – 16383). Default: 0. */
  workerId?: bigint | number;
}
interface GenerateSnowflakeOptions {
  /**
   * Named permissions to embed.
   * Pass an array of registered permission names (e.g. `['READ_PROFILE', 'WRITE_PROFILE']`).
   * OR pass a raw `bigint` bitmask directly.
   */
  permissions?: string[] | bigint;
}
interface DecodedSnowflake {
  /** Raw 128-bit bigint. */
  raw: bigint;
  /** Original hex string. */
  hex: PermissionSnowflake;
  /** UTC timestamp embedded in the snowflake. */
  timestamp: Date;
  /** Worker ID. */
  workerId: bigint;
  /** Sequence counter. */
  sequence: bigint;
  /** Raw permission bitmask. */
  permissionBits: bigint;
  /** Resolved permission names (only names registered on this generator instance). */
  permissions: string[];
}
declare class SnowflakeGenerator {
  private readonly workerId;
  private sequence;
  private lastMs;
  private readonly permissions;
  constructor(options?: SnowflakeGeneratorOptions);
  /**
   * Registers a new permission definition.
   * Bit positions 0–51 are available (52 bits total).
   */
  definePermission(def: PermissionDefinition): this;
  /** Returns all registered permissions. */
  getPermissions(): PermissionDefinition[];
  /** Resolves an array of permission names into a bitmask. */
  resolveBitmask(names: string[]): bigint;
  /** Resolves a bitmask into permission names (only registered ones). */
  resolveNames(mask: bigint): string[];
  /**
   * Generates a new 128-bit snowflake.
   * Thread-safe within a single JS event loop (monotonic sequence counter).
   */
  generate(options?: GenerateSnowflakeOptions): PermissionSnowflake;
  /** Decodes a snowflake hex string back into its components. */
  decode(snowflake: PermissionSnowflake): DecodedSnowflake;
  /**
   * Extracts just the permission bitmask from a snowflake without full decoding.
   * Useful for quick permission checks.
   */
  static extractPermissions(snowflake: PermissionSnowflake): bigint;
  /**
   * Checks if a snowflake has a specific permission bit set.
   *
   * @example
   * ```ts
   * if (SnowflakeGenerator.hasPermission(token.claims.permissions, 1n)) { ... }
   * ```
   */
  static hasPermission(snowflake: PermissionSnowflake, bit: bigint | number): boolean;
}
//#endregion
//#region src/crypto.d.ts
/**
 * Encrypts `plaintext` with AES-256-GCM using `key`.
 * Returns `{ ciphertext, iv }` both as base64url strings.
 */
declare function aesEncrypt(plaintext: string, key: string | Uint8Array): Promise<{
  ciphertext: string;
  iv: string;
}>;
/**
 * Decrypts `ciphertext` (base64url) with AES-256-GCM.
 * Returns the plaintext string.
 */
declare function aesDecrypt(ciphertext: string, iv: string, key: string | Uint8Array): Promise<string>;
/**
 * Computes HMAC-SHA256 over `message` (string) with `key`.
 * Returns the signature as a hex string.
 */
declare function hmacSign(message: string, key: string | Uint8Array): Promise<string>;
/**
 * Verifies an HMAC-SHA256 signature.
 * Uses constant-time comparison internally via SubtleCrypto.verify.
 */
declare function hmacVerify(message: string, signature: string, key: string | Uint8Array): Promise<boolean>;
/**
 * Generates a cryptographically random AES-256 key.
 * Returns as hex string.
 */
declare function generateAesKey(): string;
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
declare function generateAppKeyPair(ttlMs?: number): Promise<AppKeyPair>;
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
declare function ecdhDeriveKeys(privateKeyHex: string, publicKeyHex: string): Promise<{
  encKey: string;
  sessionKey: string;
}>;
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
declare function phraseToCommitment(phrase: string): Promise<{
  hash: string;
  salt: string;
}>;
/**
 * Constant-time verification of a phrase against a stored PBKDF2 commitment.
 */
declare function verifyPhraseCommitment(phrase: string, hash: string, salt: string): Promise<boolean>;
//#endregion
//#region src/qr.d.ts
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
declare function encodeProfileLink(data: Omit<ProfileQRData, 'version' | 'type'>): string;
/**
 * Decodes a profile QR URI produced by {@link encodeProfileLink}.
 *
 * Returns `null` if the URI is malformed or not a valid ASide profile link.
 */
declare function decodeProfileLink(uri: string): ProfileQRData | null;
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
declare function encodeFriendRequest(data: Omit<FriendRequestQRData, 'version' | 'type' | 'expiresAt' | 'nonce'>, options?: QREncodeOptions): string;
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
declare function decodeFriendRequest(uri: string): FriendRequestQRData | null;
/**
 * Returns `true` if `uri` is a valid (and not expired) ASide friend request QR.
 * Convenience wrapper around {@link decodeFriendRequest}.
 */
declare function isFriendRequestQRValid(uri: string): boolean;
/**
 * Returns the number of milliseconds remaining before a friend request QR expires.
 * Returns `0` if already expired or the URI is invalid.
 */
declare function friendRequestQRExpiresIn(uri: string): number;
/**
 * Parses any `aside://v1/{type}?{payload}` URI.
 * Returns the decoded JSON payload or `null` on error.
 */
declare function parseAsideUri(uri: string): {
  type: string;
  payload: unknown;
} | null;
//#endregion
//#region src/constants.d.ts
/** Shared attribute keys used for all ASide entities. */
declare const ATTR_TYPE = "aside.type";
declare const ATTR_UUID = "aside.uuid";
declare const ATTR_WALLET = "aside.wallet";
declare const ATTR_NAMESPACE = "aside.namespace";
/** Attribute keys for social graph entities. */
declare const ATTR_TARGET_UUID = "aside.social.target";
declare const ATTR_TARGET_KEY = "aside.social.target_key";
/** Entity type discriminators stored in `aside.type`. */
declare const PROFILE_TYPE = "profile";
declare const EXTENSION_TYPE = "extension";
/** Social entity type discriminators. */
declare const SOCIAL_FOLLOW_TYPE = "aside.social.follow";
declare const SOCIAL_FRIEND_REQUEST_TYPE = "aside.social.friend_request";
declare const SOCIAL_POST_TYPE = "aside.social.post";
declare const SOCIAL_REACTION_TYPE = "aside.social.reaction";
declare const SOCIAL_COMMENT_TYPE = "aside.social.comment";
declare const SOCIAL_BLOCK_TYPE = "aside.social.block";
/**
 * Default entity TTL: 365 days in seconds.
 * Profiles and extensions expire after one year unless renewed.
 */
declare const DEFAULT_EXPIRY_SECONDS: number;
/** Custom epoch for ASide snowflakes: 2025-01-01T00:00:00.000Z */
declare const SNOWFLAKE_EPOCH = 1735689600000n;
//#endregion
export { ATTR_NAMESPACE, ATTR_TARGET_KEY, ATTR_TARGET_UUID, ATTR_TYPE, ATTR_UUID, ATTR_WALLET, type AccessTokenClaims, AccessTokenManager, type AppKeyPair, BaseClient, type BaseClientOptions, type BaseProfileData, type BaseProfileResult, type ChainCDN, type CreateAccessTokenOptions, type CreateAccessTokenResult, type CreatePostOptions, DEFAULT_EXPIRY_SECONDS, EXTENSION_TYPE, ExtensionClient, type ExtensionData, type ExtensionResult, FeedClient, type FriendRequest, type FriendRequestQRData, type FriendRequestStatus, type InvalidTokenResult, PROFILE_TYPE, type PaginationOptions, type ParityKeyPair, type PermissionDefinition, type PermissionSnowflake, type PostMedia, type PostMediaType, type ProfileQRData, ProfileWatcher, type QREncodeOptions, type ReactionType, SNOWFLAKE_EPOCH, SOCIAL_BLOCK_TYPE, SOCIAL_COMMENT_TYPE, SOCIAL_FOLLOW_TYPE, SOCIAL_FRIEND_REQUEST_TYPE, SOCIAL_POST_TYPE, SOCIAL_REACTION_TYPE, type SealedAccessToken, type SessionRequest, SnowflakeGenerator, type SocialBlock, SocialClient, type SocialComment, type SocialFollow, type SocialPost, type SocialReaction, type SocialStatus, type ValidateTokenOptions, type ValidateTokenResult, type WatcherChainResult, type WatcherOptions, aesDecrypt, aesEncrypt, decodeFriendRequest, decodeProfileLink, ecdhDeriveKeys, encodeFriendRequest, encodeProfileLink, friendRequestQRExpiresIn, generateAesKey, generateAppKeyPair, hmacSign, hmacVerify, isFriendRequestQRValid, parseAsideUri, phraseToCommitment, verifyPhraseCommitment };
//# sourceMappingURL=index.d.cts.map