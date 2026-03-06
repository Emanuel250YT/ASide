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

// ═══════════════════════════════════════════════════════════════════════════════
// 16. EVENTS — create / publish / update / cancel
// ═══════════════════════════════════════════════════════════════════════════════

section("16. Events — create / publish / update / cancel")

const events = client.events()

// Create a new event in draft status
const now = Date.now()
const event = await events.createEvent({
  title: "Arkiv Hackathon 2025",
  description: "A 48-hour hackathon on the Arkiv network.",
  startsAt: now + 7 * 24 * 60 * 60 * 1000,    // 1 week from now
  endsAt: now + 9 * 24 * 60 * 60 * 1000,    // 2 days after start
  timezone: "UTC",
  modality: "hybrid",
  visibility: "public",
  capacity: 200,
  location: { name: "Techspace", city: "Berlin", country: "DE", url: "https://meet.example.com" },
  tags: ["hackathon", "web3", "arkiv"],
  categories: ["technology"],
  requiresApproval: false,
})
ok("createEvent (draft)", { entityKey: event.entityKey, title: event.title, status: event.status })

// Publish it
const published = await events.publishEvent(event.entityKey)
ok("publishEvent", { status: published.status, visibility: published.visibility })

// Update some fields
const eventUpdated = await events.updateEvent(event.entityKey, {
  description: "A 48-hour hackathon — prizes worth $10,000.",
  capacity: 250,
})
ok("updateEvent", { description: eventUpdated.description, capacity: eventUpdated.capacity })

// Duplicate it as a new draft
const copy = await events.duplicateEvent(event.entityKey, { title: "Arkiv Hackathon — Spring Edition" })
ok("duplicateEvent", { entityKey: copy.entityKey, title: copy.title, status: copy.status })

// Cancel the copy
const evCancelled = await events.cancelEvent(copy.entityKey)
ok("cancelEvent", { status: evCancelled.status })

// List organizer's own events
const myEvents = await events.listEvents()
ok("listEvents (my own)", myEvents.map(e => e.title))

// Public discovery
const upcoming = await events.listUpcomingEvents()
ok("listUpcomingEvents count", upcoming.length)

const byCity = await events.listByCity("Berlin")
ok("listByCity Berlin", byCity.map(e => e.title))

const search = await events.searchEvents("hackathon")
ok("searchEvents 'hackathon'", search.map(e => e.title))

// ═══════════════════════════════════════════════════════════════════════════════
// 17. EVENTS — agenda items
// ═══════════════════════════════════════════════════════════════════════════════

section("17. Events — agenda items")

const evKey = event.entityKey

const withAgenda = await events.addAgendaItem(evKey, {
  title: "Opening Keynote",
  description: "Welcome to Arkiv Hackathon 2025!",
  startsAt: now + 7 * 24 * 60 * 60 * 1000,
  endsAt: now + 7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000,
})
ok("addAgendaItem", withAgenda.agenda?.map(a => a.title))

const item = withAgenda.agenda?.[0]
if (item) {
  const agendaUpdated = await events.updateAgendaItem(evKey, item.id, { title: "Opening Keynote (updated)" })
  ok("updateAgendaItem", agendaUpdated.agenda?.map(a => a.title))

  const removed = await events.removeAgendaItem(evKey, item.id)
  ok("removeAgendaItem — agenda length after", removed.agenda?.length ?? 0)
}

// ═══════════════════════════════════════════════════════════════════════════════
// 18. EVENTS — organizers & roles
// ═══════════════════════════════════════════════════════════════════════════════

section("18. Events — organizers & roles")

// Add a co-host (simulated; real UUID + wallet would come from their profile)
const coHostWallet = "0x000000000000000000000000000000000000dead"
const organizer = await events.addOrganizer(evKey, "user-cohost-uuid", coHostWallet, "host")
ok("addOrganizer", { userUuid: organizer.userUuid, role: organizer.role })

const organizers = await events.listOrganizers(evKey)
ok("listOrganizers count", organizers.length)

const changed = await events.changeOrganizerRole(evKey, "user-cohost-uuid", "admin")
ok("changeOrganizerRole", { userUuid: changed.userUuid, newRole: changed.role })

await events.removeOrganizer(evKey, "user-cohost-uuid")
ok("removeOrganizer")

// Assign a stand-alone role (check-in manager at the door)
const role = await events.assignRole(evKey, "user-door-uuid", "checkin_manager")
ok("assignRole", { userUuid: role.userUuid, role: role.role })

const roles = await events.listRoles(evKey)
ok("listRoles count", roles.length)

const hasPerm = await events.checkPermission(evKey, "user-door-uuid", "checkin_manager")
ok("checkPermission (checkin_manager)", hasPerm)

const lacksAdminPerm = await events.checkPermission(evKey, "user-door-uuid", "admin")
ok("checkPermission (admin — should be false)", lacksAdminPerm)

await events.removeRole(evKey, "user-door-uuid")
ok("removeRole")

// ═══════════════════════════════════════════════════════════════════════════════
// 19. EVENTS — registration / RSVP
// ═══════════════════════════════════════════════════════════════════════════════

section("19. Events — registration / RSVP")

// Current user registers
const rsvp = await events.register(evKey)
ok("register", { entityKey: rsvp.entityKey, status: rsvp.status })

// Registrations list (organizer view)
const regs = await events.listRegistrations(evKey)
ok("listRegistrations count", regs.length)

// My own registrations (attendee view)
const myRsvps = await events.listMyRegistrations()
ok("listMyRegistrations count", myRsvps.length)

// Approve / reject (simulate with a dummy UUID that doesn't actually exist here)
// In production, attendeeUuid comes from another registered user.
// We approve the current user's own RSVP for demo purposes:
const approved = await events.approveRegistration(evKey, client.uuid)
ok("approveRegistration", approved.status)

// Attendee list (approved only)
const attendees = await events.listAttendees(evKey)
ok("listAttendees count", attendees.length)

// Mark attendance directly
const attended = await events.markAttendance(evKey, client.uuid)
ok("markAttendance", { checkedIn: attended.checkedIn })

// Close / reopen registration
const closed = await events.closeRegistration(evKey)
ok("closeRegistration", { registrationOpen: closed.registrationOpen })

const reopened = await events.reopenRegistration(evKey)
ok("reopenRegistration", { registrationOpen: reopened.registrationOpen })

// Enable manual approval for new registrations
const withApproval = await events.enableManualApproval(evKey)
ok("enableManualApproval", { requiresApproval: withApproval.requiresApproval })

await events.disableManualApproval(evKey)
ok("disableManualApproval")

// Cancel own registration
await events.cancelRegistration(evKey)
ok("cancelRegistration")

// ═══════════════════════════════════════════════════════════════════════════════
// 20. EVENTS — custom registration questions
// ═══════════════════════════════════════════════════════════════════════════════

section("20. Events — custom registration questions")

const q1 = await events.createQuestion(evKey, {
  label: "What is your experience with Arkiv?",
  type: "multiple_choice",
  required: true,
  options: ["None", "Beginner", "Intermediate", "Expert"],
})
ok("createQuestion", { label: q1.label, type: q1.type })

const q2 = await events.createQuestion(evKey, {
  label: "Your wallet address",
  type: "wallet",
  required: true,
})
ok("createQuestion (wallet)", { label: q2.label, type: q2.type })

const questions = await events.listQuestions(evKey)
ok("listQuestions count", questions.length)

const updatedQ = await events.updateQuestion(q1.entityKey, { label: "Arkiv experience level?" })
ok("updateQuestion", updatedQ.label)

// Reorder — put q2 first
await events.reorderQuestions(evKey, [q2.entityKey, q1.entityKey])
ok("reorderQuestions")

await events.deleteQuestion(q1.entityKey)
ok("deleteQuestion")

// ═══════════════════════════════════════════════════════════════════════════════
// 21. EVENTS — ticket types & tickets
// ═══════════════════════════════════════════════════════════════════════════════

section("21. Events — ticket types & tickets")

// Create a free tier
const freeTier = await events.createTicketType(evKey, {
  name: "Free",
  price: 0,
  capacity: 100,
})
ok("createTicketType (free)", { name: freeTier.name, price: freeTier.price })

// Create a paid tier with early-bird pricing
const paidTier = await events.createTicketType(evKey, {
  name: "Pro",
  description: "Full access + swag bag",
  price: 100,
  currency: "USD",
  capacity: 50,
  earlyBirdPrice: 70,
  earlyBirdEndsAt: now + 3 * 24 * 60 * 60 * 1000,
})
ok("createTicketType (paid)", { name: paidTier.name, earlyBirdPrice: paidTier.earlyBirdPrice })

const ticketTypes = await events.listTicketTypes(evKey)
ok("listTicketTypes count", ticketTypes.length)

// Update ticket type
const updatedTier = await events.updateTicketType(paidTier.entityKey, { capacity: 75 })
ok("updateTicketType capacity", updatedTier.capacity)

// Purchase a free ticket
const ticket = await events.purchaseTicket(freeTier.entityKey)
ok("purchaseTicket", { entityKey: ticket.entityKey, status: ticket.status })

// Generate QR for the ticket
const qrPayload = await events.generateTicketQR(ticket.entityKey)
ok("generateTicketQR (first 40 chars)", qrPayload.slice(0, 40) + "…")

// Validate the QR payload
const validated = await events.validateTicketQR(qrPayload)
ok("validateTicketQR", { entityKey: validated?.entityKey, status: validated?.status })

// List my tickets
const myTickets = await events.listMyTickets()
ok("listMyTickets count", myTickets.length)

// Discount code
const discount = await events.createDiscountCode(evKey, {
  code: "EARLY10",
  type: "percent",
  value: 10,
  maxUses: 50,
  expiresAt: now + 7 * 24 * 60 * 60 * 1000,
})
ok("createDiscountCode", { code: discount.code, type: discount.type, value: discount.value })

const validDiscount = await events.validateDiscountCode(evKey, "EARLY10")
ok("validateDiscountCode", validDiscount ? { code: validDiscount.code, value: validDiscount.value } : null)

const discounts = await events.listDiscountCodes(evKey)
ok("listDiscountCodes count", discounts.length)

await events.deleteDiscountCode(discount.entityKey)
ok("deleteDiscountCode")

// ═══════════════════════════════════════════════════════════════════════════════
// 22. EVENTS — waitlist
// ═══════════════════════════════════════════════════════════════════════════════

section("22. Events — waitlist")

// Make a capacity-1 micro-event
const miniEvent = await events.createEvent({
  title: "Exclusive Demo",
  startsAt: now + 14 * 24 * 60 * 60 * 1000,
  endsAt: now + 14 * 24 * 60 * 60 * 1000 + 3600_000,
  capacity: 1,
})
await events.publishEvent(miniEvent.entityKey)

// Register fills the one slot
await events.register(miniEvent.entityKey)

// Join waitlist (separate method — also auto-triggered inside register() when full)
const waitEntry = await events.joinWaitlist(miniEvent.entityKey)
ok("joinWaitlist", { position: waitEntry.position, status: waitEntry.status })

const waitlist = await events.listWaitlist(miniEvent.entityKey)
ok("listWaitlist count", waitlist.length)

// Promote from waitlist (organizer promotes the first person)
const promoted = await events.promoteFromWaitlist(miniEvent.entityKey, client.uuid)
ok("promoteFromWaitlist", { status: promoted.status })

// Leave the waitlist
await events.joinWaitlist(miniEvent.entityKey)  // re-join for demo
await events.leaveWaitlist(miniEvent.entityKey)
ok("leaveWaitlist")

// ═══════════════════════════════════════════════════════════════════════════════
// 23. EVENTS — invitations
// ═══════════════════════════════════════════════════════════════════════════════

section("23. Events — invitations")

const invite = await events.inviteByEmail(evKey, "alice@example.com")
ok("inviteByEmail", { entityKey: invite.entityKey, email: invite.email, status: invite.status })

const bulkInvites = await events.inviteList(evKey, ["bob@example.com", "carol@example.com"])
ok("inviteList sent count", bulkInvites.length)

const allInvites = await events.listInvites(evKey)
ok("listInvites count", allInvites.length)

// Resend
await events.resendInvite(invite.entityKey)
ok("resendInvite")

// Cancel one invite
await events.cancelInvite(invite.entityKey)
ok("cancelInvite", invite.entityKey.slice(0, 10) + "…")

// Accept / reject (current user accepts bulkInvites[0])
const accepted = await events.acceptInvite(bulkInvites[0].entityKey)
ok("acceptInvite", accepted.status)

const rejected = await events.rejectInvite(bulkInvites[1].entityKey)
ok("rejectInvite", rejected.status)

// ═══════════════════════════════════════════════════════════════════════════════
// 24. EVENTS — check-in
// ═══════════════════════════════════════════════════════════════════════════════

section("24. Events — check-in")

// Manual check-in (organizer opens laptop at the door)
const checkin = await events.checkinManual(evKey, client.uuid)
ok("checkinManual", { method: checkin.method, attendeeUuid: checkin.attendeeUuid })

// QR check-in flow: generate → scan → validate
await events.cancelTicket(ticket.entityKey)      // reset for demo
const freshTicket = await events.purchaseTicket(freeTier.entityKey)
const freshQR = await events.generateTicketQR(freshTicket.entityKey)
const checkinByQR = await events.checkinByQR(freshQR)
ok("checkinByQR", { method: checkinByQR.method })

// Check-in status
const status = await events.getCheckinStatus(evKey, client.uuid)
ok("getCheckinStatus", { checkedInAt: status?.checkedInAt ? "set" : "null", method: status?.method })

// List all check-ins
const checkins = await events.listCheckins(evKey)
ok("listCheckins count", checkins.length)

// Undo a check-in
await events.undoCheckin(checkin.entityKey)
ok("undoCheckin")

// ═══════════════════════════════════════════════════════════════════════════════
// 25. EVENTS — communication & announcements
// ═══════════════════════════════════════════════════════════════════════════════

section("25. Events — communication & announcements")

await events.sendAnnouncement(evKey, "🚀 The schedule is now live — check the agenda!")
ok("sendAnnouncement")

await events.sendReminder(evKey)
ok("sendReminder (auto message)")

await events.sendReminder(evKey, "Doors open at 09:00 UTC tomorrow!")
ok("sendReminder (custom message)")

// ═══════════════════════════════════════════════════════════════════════════════
// 26. EVENTS — analytics
// ═══════════════════════════════════════════════════════════════════════════════

section("26. Events — analytics")

const analytics = await events.getAnalytics(evKey)
ok("getAnalytics", {
  registrations: analytics.registrations,
  approved: analytics.approved,
  checkins: analytics.checkins,
  conversionRate: analytics.conversionRate + "%",
})

// ═══════════════════════════════════════════════════════════════════════════════
// 27. EVENTS — calendars
// ═══════════════════════════════════════════════════════════════════════════════

section("27. Events — calendars")

const calendar = await events.createCalendar({ name: "My Web3 Events", visibility: "public" })
ok("createCalendar", { entityKey: calendar.entityKey, name: calendar.name })

const updatedCal = await events.updateCalendar(calendar.entityKey, { name: "Web3 & Arkiv Events" })
ok("updateCalendar", updatedCal.name)

// Add events to the calendar
const calEntry = await events.addToCalendar(calendar.entityKey, evKey)
ok("addToCalendar", { calendarEntityKey: calEntry.calendarEntityKey })

const calEvents = await events.listCalendarEvents(calendar.entityKey)
ok("listCalendarEvents count", calEvents.length)

// Follow / unfollow a calendar
await events.followCalendar(calendar.entityKey)
ok("followCalendar")

await events.unfollowCalendar(calendar.entityKey)
ok("unfollowCalendar")

// Remove event from calendar
await events.removeFromCalendar(calendar.entityKey, evKey)
ok("removeFromCalendar")

await events.deleteCalendar(calendar.entityKey)
ok("deleteCalendar (soft)")

// ═══════════════════════════════════════════════════════════════════════════════
// 28. EVENTS — notifications & moderation
// ═══════════════════════════════════════════════════════════════════════════════

section("28. Events — notifications & moderation")

// Create a notification
const notification = await events.createNotification({
  toUuid: client.uuid,
  fromUuid: client.uuid,
  eventEntityKey: evKey,
  type: "announcement",
  message: "Event starts in 24 hours!",
})
ok("createNotification", { type: notification.type, read: notification.read })

const notes = await events.listNotifications()
ok("listNotifications count", notes.length)

const unread = await events.listNotifications({ unreadOnly: true })
ok("listNotifications (unread)", unread.length)

await events.markNotificationRead(notification.entityKey)
ok("markNotificationRead")

await events.deleteNotification(notification.entityKey)
ok("deleteNotification")

// Report a user
await events.reportUser("user-spammer-uuid", "Sending unsolicited DMs", evKey)
ok("reportUser (event-scoped)")

await events.reportUser("user-abuser-uuid", "Inappropriate content")
ok("reportUser (platform-level)")

console.log("\n✅  All examples completed.\n")
