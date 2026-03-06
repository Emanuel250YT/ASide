/**
 * ASide — comprehensive use-case examples
 *
 * Every section is self-contained and labelled.
 * Run:  node index.js
 *
 * Prerequisites:
 *   - Fill config.json with your private key  { "privateKey": "0x..." }
 *   - Run `pnpm build` in the repo root first
 */

import aside from "../dist/index.cjs"
import data from "./config.json" with { type: "json" }

// ─── Destructure everything we'll use ────────────────────────────────────────

const {
  // CDN / chain setup
  ArkaCDN, PublicClient, WalletClient, http, chainFromName,
  // Account
  privateKeyToAccount, generatePrivateKey,
  // Core client
  BaseClient,
  // Access tokens
  AccessTokenManager, generateAppKeyPair,
  // Snowflake IDs
  SnowflakeGenerator,
  // QR utilities
  encodeProfileLink, decodeProfileLink,
  encodeFriendRequest, decodeFriendRequest,
  isFriendRequestQRValid, friendRequestQRExpiresIn,
  // Crypto utilities
  generateAesKey, aesEncrypt, aesDecrypt,
  phraseToCommitment, verifyPhraseCommitment,
  hmacSign, hmacVerify, ecdhDeriveKeys,
} = aside

// ─── Helpers ──────────────────────────────────────────────────────────────────

function section(title) {
  console.log(`\n${"─".repeat(60)}`)
  console.log(`  ${title}`)
  console.log("─".repeat(60))
}

function ok(label, value) {
  const display = value === undefined ? "" :
    typeof value === "object"
      ? JSON.stringify(value, null, 2)
      : String(value)
  console.log(`✓ ${label}${display ? ":\n  " + display.replace(/\n/g, "\n  ") : ""}`)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CHAIN & CDN SETUP
// ═══════════════════════════════════════════════════════════════════════════════

section("1. Chain & CDN setup")

const kaolin = chainFromName("kaolin")
ok("kaolin chain", kaolin.name)

const publicClient = PublicClient({ chain: kaolin, transport: http() })
const walletClient = WalletClient({
  account: privateKeyToAccount(data.privateKey),
  chain: kaolin,
  transport: http(),
})

const cdn = ArkaCDN.create({ publicClient, wallets: walletClient })
ok("ArkaCDN created")

// ═══════════════════════════════════════════════════════════════════════════════
// 2. BASE PROFILE — get / getOrCreate / update
// ═══════════════════════════════════════════════════════════════════════════════

section("2. Base profile — get / getOrCreate / update")

// wallet is the authority — uuid is discovered from chain if a profile exists.
// The uuid here is a proposal: once the profile is found on-chain, client.uuid
// is overridden with the canonical oldest uuid stored for this wallet.
const client = new BaseClient({
  uuid: crypto.randomUUID(),
  wallet: privateKeyToAccount(data.privateKey).address,
  photo: "https://example.com/avatar.png",
  displayName: "Alice",
  cdn,
})

// getOrCreate — safest entry point.
// autoRetryOnUuidConflict handles the case where the proposed uuid is already
// claimed by a different wallet: a fresh uuid is minted automatically.
const profile = await client.getOrCreate({ autoRetryOnUuidConflict: true })
ok("getOrCreate", {
  entityKey: profile.entityKey,
  uuid: profile.profile.uuid,
  displayName: profile.profile.displayName,
})
ok("client.uuid (canonical from chain)", client.uuid)

// get — read-only fetch, returns null if no profile exists
const fetched = await client.get()
ok("get", fetched?.profile.uuid)

// update — write mutable fields; client state stays coherent immediately
const updated = await client.update({ displayName: "Alice Arkiv", bio: "Building on Arkiv" })
ok("update", { displayName: updated.profile.displayName, bio: updated.profile.bio })
ok("client.displayName (in-memory, no re-fetch needed)", client.displayName)

// ═══════════════════════════════════════════════════════════════════════════════
// 3. CROSS-CHAIN SYNC
// ═══════════════════════════════════════════════════════════════════════════════

section("3. Cross-chain sync")

// A second CDN pointing to the same kaolin chain simulates "another chain"
const cdn2 = ArkaCDN.create({
  publicClient: PublicClient({ chain: kaolin, transport: http() }),
  wallets: WalletClient({
    account: privateKeyToAccount(data.privateKey),
    chain: kaolin,
    transport: http(),
  }),
})

// sync(): checks current chain first.
// If missing, searches otherChains in order and replicates the found profile.
// If found nowhere, creates a fresh profile on the current chain.
const synced = await client.sync([cdn2])

ok("sync", {
  uuid: synced.profile.uuid,
  syncedFrom: synced.profile.syncedFrom ?? "(native — already on chain)",
})

// ═══════════════════════════════════════════════════════════════════════════════
// 4. EXTENSION DATA — per-app namespaced storage
// ═══════════════════════════════════════════════════════════════════════════════

section("4. Extension data — app-specific storage")

// Each namespace is fully independent — apps never see each other's data.
const gameExt = client.extend("my-game")

// Create or fetch with initial data
const extResult = await gameExt.getOrCreate({ score: 0, level: 1, badges: [] })
ok("extension.getOrCreate", extResult.extension.data)

// Partial update — unmentioned fields are preserved
const extUpdated = await gameExt.update({ score: 1200, badges: ["pioneer"] })
ok("extension.update", extUpdated.extension.data)

// Read back
const extFetched = await gameExt.get()
ok("extension.get", extFetched?.extension.data)

// ═══════════════════════════════════════════════════════════════════════════════
// 5. PHOTO UPLOAD & DOWNLOAD  (arka-cdn file API)
// ═══════════════════════════════════════════════════════════════════════════════

section("5. Photo upload / download  (arka-cdn file API)")

// Normally you'd pass real image bytes from readFileSync / fetch / <input>
const fakeImageBytes = new Uint8Array(32).fill(0xff)

// uploadPhoto() stores the buffer as chunked on-chain data and sets this.photo
const manifestKey = await client.uploadPhoto(fakeImageBytes, {
  filename: "avatar.png",
  mimeType: "image/png",
})
ok("uploadPhoto — manifest key (0x-prefixed)", manifestKey)
ok("client.photo updated to manifest key", client.photo)

// downloadPhoto() works for any photo that starts with 0x (a CDN manifest key).
// Returns null for plain HTTPS URLs.
const photoResult = await client.downloadPhoto()
ok(
  "downloadPhoto",
  photoResult ? `${photoResult.size} bytes, ${photoResult.mimeType}` : "null (plain URL photo)",
)

// Persist the manifest key to the on-chain profile
await client.update({ photo: manifestKey })
ok("profile photo updated on-chain")

// ═══════════════════════════════════════════════════════════════════════════════
// 6. SOCIAL GRAPH — follow / unfollow / block
// ═══════════════════════════════════════════════════════════════════════════════

section("6. Social graph — follow / unfollow / block")

const social = client.social()

// Follow
const follow = await social.follow("user-bob")
ok("follow", { status: follow.status, followeeUuid: follow.followeeUuid })

// Check following status
ok("isFollowing user-bob", await social.isFollowing("user-bob"))

// Following / follower lists
const following = await social.getFollowing()
ok("getFollowing count", following.length)

const followers = await social.getFollowers()
ok("getFollowers count", followers.length)

ok("getFollowerCounts", await social.getFollowerCounts())

// Unfollow (soft-delete — entity stays, status becomes 'removed')
await social.unfollow("user-bob")
ok("unfollow user-bob")

// Block (also silently unfollows the target)
const block = await social.block("user-spam")
ok("block", { status: block.status, blockedUuid: block.blockedUuid })
ok("isBlocked user-spam", await social.isBlocked("user-spam"))

const blockedList = await social.getBlockedUsers()
ok("getBlockedUsers count", blockedList.length)

// Unblock
await social.unblock("user-spam")
ok("unblock user-spam")

// ═══════════════════════════════════════════════════════════════════════════════
// 7. FRIEND REQUESTS
// ═══════════════════════════════════════════════════════════════════════════════

section("7. Friend requests")

// Alice sends a request to Charlie
const friendReq = await social.sendFriendRequest("user-charlie", "Hey Charlie, add me!")
ok("sendFriendRequest", { entityKey: friendReq.entityKey, status: friendReq.status })

// Outgoing pending requests
const outgoing = await social.getOutgoingFriendRequests()
ok("getOutgoingFriendRequests count", outgoing.length)

// Incoming pending requests (from others — likely empty in this demo)
const incoming = await social.getIncomingFriendRequests()
ok("getIncomingFriendRequests count", incoming.length)

// Cancel our outgoing request
const cancelled = await social.cancelFriendRequest(friendReq.entityKey)
ok("cancelFriendRequest", cancelled.status)

// (In a real app the recipient calls acceptFriendRequest / rejectFriendRequest.
//  acceptFriendRequest also creates mutual follows automatically.)

// ═══════════════════════════════════════════════════════════════════════════════
// 8. FEED — posts / reactions / comments
// ═══════════════════════════════════════════════════════════════════════════════

section("8. Feed — posts / reactions / comments")

const feed = client.feed()

// Create a text post
const post = await feed.createPost({
  content: "Hello, Arkiv network! 🚀",
  tags: ["arkiv", "web3"],
})
ok("createPost", { entityKey: post.entityKey, content: post.content })

// Create a media post
const mediaPost = await feed.createPost({
  content: "Check out this photo",
  media: [{ type: "image", url: "https://example.com/photo.png" }],
})
ok("createPost with media", { entityKey: mediaPost.entityKey })

// Fetch a single post
ok("getPost content", (await feed.getPost(post.entityKey))?.content)

// Edit post
const editedPost = await feed.updatePost(post.entityKey, "Hello, Arkiv network! Updated ✏️")
ok("updatePost", editedPost.content)

// Reactions
const like = await feed.like(post.entityKey)
ok("like", { type: like.type, status: like.status })

const love = await feed.react(post.entityKey, "love")
ok("react(love)", love.type)

ok("getReactionCounts", await feed.getReactionCounts(post.entityKey))
ok("hasReacted(like)", await feed.hasReacted(post.entityKey, "like"))

await feed.unlike(post.entityKey)
ok("unlike")

// Comments
const comment = await feed.addComment(post.entityKey, "Great post!")
ok("addComment", { entityKey: comment.entityKey, content: comment.content })

const editedComment = await feed.editComment(comment.entityKey, "Great post! Really inspiring.")
ok("editComment", editedComment.content)

ok("getComments count", (await feed.getComments(post.entityKey)).length)

await feed.deleteComment(comment.entityKey)
ok("deleteComment")

// User's own posts
const myPosts = await feed.getUserPosts()
ok("getUserPosts count", myPosts.length)

// Feed from a set of followed UUIDs  (pass list explicitly)
const feedItems = await feed.getFeed([client.uuid], { limit: 10 })
ok("getFeed items", feedItems.length)

// Delete a post (soft-delete — sets status to 'removed')
await feed.deletePost(post.entityKey)
ok("deletePost")

// ═══════════════════════════════════════════════════════════════════════════════
// 9. QR CODE UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

section("9. QR code utilities")

// Profile link QR — public, no sensitive data
const profileUri = encodeProfileLink({
  uuid: client.uuid,
  wallet: client.wallet,
  displayName: client.displayName,
  photo: client.photo,
})
ok("encodeProfileLink", profileUri)

const profileData = decodeProfileLink(profileUri)
ok("decodeProfileLink", { uuid: profileData?.uuid, displayName: profileData?.displayName })

// Friend request QR — time-limited (default 15 min), with a random nonce
const friendQrUri = encodeFriendRequest(
  { fromUuid: client.uuid, fromWallet: client.wallet, displayName: client.displayName },
  { message: "Add me on this app!" },
)
ok("encodeFriendRequest (first 80 chars)", friendQrUri.slice(0, 80) + "…")

const friendQrData = decodeFriendRequest(friendQrUri)
ok("decodeFriendRequest", { fromUuid: friendQrData?.fromUuid, message: friendQrData?.message })

ok("isFriendRequestQRValid", isFriendRequestQRValid(friendQrUri))
ok("friendRequestQRExpiresIn", Math.round(friendRequestQRExpiresIn(friendQrUri) / 1000) + "s remaining")

// ═══════════════════════════════════════════════════════════════════════════════
// 10. ACCESS TOKENS — ECDH P-256 sealed tokens + session requests
// ═══════════════════════════════════════════════════════════════════════════════

section("10. Access tokens — ECDH P-256 sealed tokens")

// Step 1: App server generates a key pair ONCE and publishes the public key
const appKeys = await generateAppKeyPair()
ok("generateAppKeyPair — publicKey (first 20 chars)", appKeys.publicKey.slice(0, 20) + "…")

// Step 2: Client creates a sealed token directed at the app's public key.
//         The phrase and all claims are AES-256-GCM encrypted — never transmitted plain.
const { token, sessionKey } = await client.createAccessToken({
  appId: "my-dapp",
  domain: "my-dapp.com",
  permissions: 3n,
  appPublicKey: appKeys.publicKey,
  phrase: "my-secret-phrase",
})
ok("createAccessToken", { appId: token.appId, issuerUuid: token.issuerUuid })

// Step 3: App server validates and decrypts the token
const manager = new AccessTokenManager()
const validation = await manager.validate({ token, appPrivateKey: appKeys.privateKey })
ok("validate — valid", validation.valid)
if (validation.valid) {
  ok("validate — recovered claims", { issuerUuid: validation.claims.issuerUuid, phrase: validation.phrase })
}

// Step 4: Client creates a signed session request
const sessionReq = await manager.createSessionRequest(token, sessionKey)
ok("createSessionRequest — tokenId", sessionReq.tokenId)

// Step 5: Server verifies the session request HMAC
const sessionValidation = await manager.validateSession(sessionReq, appKeys.privateKey)
ok("validateSession — valid", sessionValidation.valid)

// ═══════════════════════════════════════════════════════════════════════════════
// 11. SNOWFLAKE IDs — timestamped 128-bit IDs with permission bitmasks
// ═══════════════════════════════════════════════════════════════════════════════

section("11. Snowflake IDs — timestamped IDs with permission bitmasks")

const sf = new SnowflakeGenerator({ workerId: 1 })

// Register named permission bits
sf.definePermission({ name: "READ_PROFILE", bit: 0, description: "Read profile data" })
sf.definePermission({ name: "WRITE_PROFILE", bit: 1, description: "Write profile data" })
sf.definePermission({ name: "MANAGE_TOKENS", bit: 2, description: "Manage access tokens" })
sf.definePermission({ name: "ADMIN", bit: 3, description: "Full admin access" })

// Generate a snowflake granting READ_PROFILE + MANAGE_TOKENS
const flake = sf.generate({ permissions: ["READ_PROFILE", "MANAGE_TOKENS"] })
ok("generate — hex snowflake", flake)

const decoded = sf.decode(flake)
ok("decode", {
  timestamp: decoded.timestamp.toISOString(),
  workerId: String(decoded.workerId),
  permissions: decoded.permissions,
})

ok("hasPermission READ_PROFILE (granted)", SnowflakeGenerator.hasPermission(flake, 0))
ok("hasPermission WRITE_PROFILE (not granted)", SnowflakeGenerator.hasPermission(flake, 1))

// ═══════════════════════════════════════════════════════════════════════════════
// 12. PROFILE WATCHER — multi-chain polling
// ═══════════════════════════════════════════════════════════════════════════════

section("12. ProfileWatcher — multi-chain polling")

// watch() creates a ProfileWatcher attached to this client.
// It polls each supplied chain via getOnChain() and fires callbacks on presence changes.
const watcher = client.watch({
  chains: [
    { name: "kaolin", cdn },
    { name: "kaolin-mirror", cdn: cdn2 },   // same chain, different CDN — demo only
  ],
  intervalMs: 30_000,
  onFound: (chain, result) => ok(`onFound [${chain}]`, result?.profile.uuid),
  onLost: (chain) => ok(`onLost  [${chain}]`),
  onPoll: (results) => ok("onPoll", results.map(r => `${r.chain}: ${r.exists ? "✓" : "✗"}`)),
})

// Run one manual poll cycle (avoids blocking the example with setInterval)
const pollResults = await watcher.poll()
ok("manual poll results", pollResults.map(r => `${r.chain}: ${r.exists ? "found" : "not found"}`))

// In production: watcher.start() then watcher.stop() when done

// ═══════════════════════════════════════════════════════════════════════════════
// 13. CRYPTO UTILITIES — AES-256-GCM, HMAC, phrase commitments, ECDH
// ═══════════════════════════════════════════════════════════════════════════════

section("13. Crypto utilities")

// ── AES-256-GCM symmetric encryption ─────────────────────────────────────────
const aesKey = await generateAesKey()
ok("generateAesKey — type", aesKey.type)

const { ciphertext, iv } = await aesEncrypt("sensitive user data", aesKey)
ok("aesEncrypt — iv length", iv.length)

const decrypted = await aesDecrypt(ciphertext, iv, aesKey)
ok("aesDecrypt — recovered", decrypted)

// ── Phrase commitment (blind verification — phrase is never stored raw) ───────
const commitment = await phraseToCommitment("my-phrase")
ok("phraseToCommitment — hash (first 20 chars)", commitment.hash.slice(0, 20) + "…")
ok("verifyPhraseCommitment (match)", await verifyPhraseCommitment("my-phrase", commitment.hash, commitment.salt))
ok("verifyPhraseCommitment (wrong phrase)", await verifyPhraseCommitment("wrong", commitment.hash, commitment.salt))

// ── HMAC-SHA256 message signing ───────────────────────────────────────────────
const hmacKey = await generateAesKey()
const sig = await hmacSign("data to sign", hmacKey)
ok("hmacSign (first 16 chars)", sig.slice(0, 16) + "…")
ok("hmacVerify (valid)", await hmacVerify("data to sign", sig, hmacKey))
ok("hmacVerify (tampered)", await hmacVerify("tampered data", sig, hmacKey))

// ── ECDH key agreement ────────────────────────────────────────────────────────
// Both parties derive the same shared key from each other's public key.
// Typical use: sealed messages, end-to-end encrypted DMs.
const partyA = await generateAppKeyPair()
const partyB = await generateAppKeyPair()

const { encKey: encA } = await ecdhDeriveKeys(partyA.privateKey, partyB.publicKey)
const { encKey: encB } = await ecdhDeriveKeys(partyB.privateKey, partyA.publicKey)

const { ciphertext: ecdhCt, iv: ecdhIv } = await aesEncrypt("hello ecdh", encA)
const ecdhRecovered = await aesDecrypt(ecdhCt, ecdhIv, encB)
ok("ECDH encrypt with A, decrypt with B", ecdhRecovered)

// ═══════════════════════════════════════════════════════════════════════════════
// 14. CUSTOM BaseClient SUBCLASS  (Discord.js-style extensibility)
// ═══════════════════════════════════════════════════════════════════════════════

section("14. Custom BaseClient subclass")

class GameClient extends BaseClient {
  /** Returns the game extension scoped to this player. */
  game() {
    return this.extend("my-game")
  }

  /** Convenience: award points and persist them on-chain in one call. */
  async awardPoints(points) {
    const ext = this.game()
    const existing = await ext.get()
    const current = existing?.extension.data ?? { score: 0, level: 1, badges: [] }
    return ext.update({ score: current.score + points })
  }

  /** Level up if score threshold is reached. */
  async maybeLevel() {
    const ext = this.game()
    const existing = await ext.get()
    if (!existing) return null
    const { score, level } = existing.extension.data
    if (score >= level * 1000) {
      return ext.update({ level: level + 1 })
    }
    return existing
  }
}

const gameClient = new GameClient({ uuid: client.uuid, wallet: client.wallet, photo: client.photo, cdn })

const awarded = await gameClient.awardPoints(500)
ok("GameClient.awardPoints", awarded.extension.data)

const leveled = await gameClient.maybeLevel()
ok("GameClient.maybeLevel", leveled?.extension.data)

// ═══════════════════════════════════════════════════════════════════════════════
// 15. KEY GENERATION — onboarding helpers
// ═══════════════════════════════════════════════════════════════════════════════

section("15. Key generation — onboarding helpers")

const newKey = generatePrivateKey()
ok("generatePrivateKey (first 10 chars)", newKey.slice(0, 10) + "…")

const newAccount = privateKeyToAccount(newKey)
ok("derived wallet address", newAccount.address)

// Generate a new UUID for a fresh user (stable across chains)
ok("new user uuid", crypto.randomUUID())

console.log("\n✅  All examples completed.\n")
