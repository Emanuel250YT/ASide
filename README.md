# ASide

**ASide** is a TypeScript library for building social networks and identity-driven applications on top of the [Arkiv Network](https://github.com/Arkiv-Network/arka-cdn) blockchain. It provides everything you need out of the box: decentralized user profiles, a full social graph (follows, friends, blocks), a content feed (posts, reactions, comments), QR-based friend requests, and ECDH-secured access tokens â€” all backed by a public, tamper-proof ledger.

> **ArkaCDN is bundled.** You only need one install:
>
> ```bash
> npm install aside
> ```
>
> Everything in `arka-cdn` is re-exported by `aside` itself, so you never need to install `arka-cdn` separately.

Works in **Node.js â‰¥ 16** and all modern **browsers** (uses the WebCrypto API, no native crypto modules).

---

## Why ASide?

- **One library, many apps.** Any application built on Aside shares the same identity layer. A user's profile, followers, and posts are stored on the public blockchain â€” any Aside-powered app can read and build on top of them without extra integrations.
- **Truly decentralized.** Data lives on ArkaCDN (Arkiv Network). No central server, no vendor lock-in.
- **Cross-app social graph.** A user who follows someone on App A automatically shows that follow in App B â€” it's the same blockchain.
- **Secure by default.** ECDH P-256 tokens with per-token forward secrecy. No shared secrets are ever transmitted.
- **Fully typed.** First-class TypeScript with an ergonomic Discord.js-style class API.

---

## Table of contents

1. [Quick start](#quick-start)
2. [User profiles](#user-profiles)
3. [Social graph â€” follow, friend, block](#social-graph--follow-friend-block)
4. [Content feed â€” posts, reactions, comments](#content-feed--posts-reactions-comments)
5. [QR codes and deep links](#qr-codes-and-deep-links)
6. [Access tokens and session security](#access-tokens-and-session-security)
7. [Cross-app integration](#cross-app-integration)
8. [Per-app extension data](#per-app-extension-data)
9. [Multi-chain replication](#multi-chain-replication)
10. [ProfileWatcher](#profilewatcher)
11. [SnowflakeGenerator](#snowflakegenerator)
12. [Crypto utilities](#crypto-utilities)
13. [API reference](#api-reference)

---

## Quick start

```ts
import { ArkaCDN, BaseClient } from "aside";

// 1. Connect to the blockchain
const cdn = new ArkaCDN({
  /* your Arkiv Network chain config */
});

// 2. Create a client for a user
const client = new BaseClient({
  uuid: "user-123",
  wallet: "0xABCD...",
  photo: "https://example.com/avatar.png",
  cdn,
});

// 3. Fetch or create the profile on-chain
const profile = await client.getOrCreate();
console.log(profile.displayName); // "user-123" (or whatever was set)

// 4. Update the profile
await client.update({ displayName: "Alice" });

// 5. Use the social graph
const social = client.social();
await social.follow("user-456");

// 6. Write to the feed
const feed = client.feed();
const { post } = await feed.createPost({ content: "Hello, Arkiv!" });
```

---

## User profiles

A **profile** is the on-chain identity record tied to a `uuid` (your app's user ID) and a blockchain `wallet` address.

```ts
import { ArkaCDN, BaseClient } from "aside";

const cdn = new ArkaCDN({
  /* chain config */
});

const client = new BaseClient({
  uuid: "alice-uuid",
  wallet: "0xAlice...",
  photo: "https://cdn.example.com/alice.png",
  cdn,
});

// Fetch (returns null if the profile doesn't exist yet)
const existing = await client.get();

// Fetch or create (idempotent)
const profile = await client.getOrCreate();

// Update any field
await client.update({
  displayName: "Alice",
  photo: "https://cdn.example.com/alice-new.png",
});
```

### Subclassing (Discord.js style)

`BaseClient` is designed to be extended:

```ts
import { BaseClient, type BaseClientOptions } from "aside";

interface MyAppOptions extends BaseClientOptions {
  appId: string;
}

class MyAppClient extends BaseClient {
  readonly appId: string;

  constructor(options: MyAppOptions) {
    super(options);
    this.appId = options.appId;
  }

  async getGameProfile() {
    return this.extend<{ score: number; level: number }>(
      this.appId,
    ).getOrCreate();
  }
}

const client = new MyAppClient({ uuid, wallet, photo, cdn, appId: "my-game" });
await client.getGameProfile();
```

### Deferred CDN

If you can't connect to the blockchain synchronously (e.g. you need to wait for a wallet to connect), pass the CDN later:

```ts
const client = new BaseClient({ uuid, wallet, photo });
// ...wallet connects...
client.setCdn(cdn);
const profile = await client.getOrCreate();
```

---

## Social graph â€” follow, friend, block

`client.social()` returns a `SocialClient` that manages the full social graph for that user.

### Following

```ts
const social = client.social();

// Follow a user
await social.follow("bob-uuid");

// Unfollow
await social.unfollow("bob-uuid");

// Check if following
const following = await social.isFollowing("bob-uuid"); // boolean

// Paginated lists
const following = await social.getFollowing({ limit: 20, offset: 0 });
const followers = await social.getFollowers({ limit: 20 });

// Counts
const { followingCount, followerCount } = await social.getFollowerCounts();
```

### Friend requests

```ts
// Alice sends Bob a friend request
const request = await social.sendFriendRequest("bob-uuid");

// Bob accepts
const bobSocial = bobClient.social();
const incoming = await bobSocial.getIncomingFriendRequests();
await bobSocial.acceptFriendRequest(incoming[0].entityKey);

// List friends (mutual accepted requests)
const friends = await social.getFriends();

// Bob rejects instead
await bobSocial.rejectFriendRequest(incoming[0].entityKey);

// Alice cancels her outgoing request
const outgoing = await social.getOutgoingFriendRequests();
await social.cancelFriendRequest(outgoing[0].entityKey);
```

### Blocking

```ts
// Block a user (also automatically unfollows them)
await social.block("troll-uuid");

// Unblock
await social.unblock("troll-uuid");

// Check
const blocked = await social.isBlocked("troll-uuid"); // boolean

// List all blocked users
const blockedList = await social.getBlockedUsers();
```

---

## Content feed â€” posts, reactions, comments

`client.feed()` returns a `FeedClient` for posting content and interacting with it.

### Posts

```ts
const feed = client.feed();

// Create a text post
const { post } = await feed.createPost({
  content: "Check out this cool thing!",
  tags: ["blockchain", "web3"],
  mentions: ["bob-uuid"],
});

// Create a post with media
await feed.createPost({
  content: "My weekend hike",
  media: [{ url: "https://cdn.example.com/hike.jpg", type: "image" }],
});

// Get a single post
const post = await feed.getPost(entityKey);

// Update a post
await feed.updatePost(post.entityKey, { content: "Updated content" });

// Soft-delete a post
await feed.deletePost(post.entityKey);

// Get all posts by a user (paginated)
const posts = await feed.getUserPosts("alice-uuid", { limit: 10, offset: 0 });

// Build a timeline from the people a user follows
const followingUuids = (await social.getFollowing()).map((f) => f.followeeUuid);
const timeline = await feed.getFeed(followingUuids, { limit: 20 });
```

### Reactions and likes

```ts
// Like a post
await feed.like(post.entityKey);

// React with an emoji type: 'like' | 'love' | 'laugh' | 'wow' | 'sad' | 'angry'
await feed.react(post.entityKey, "love");

// Remove a reaction
await feed.unlike(post.entityKey);
await feed.unreact(post.entityKey, "love");

// Check if current user has reacted
const liked = await feed.hasReacted(post.entityKey, "like");

// Get all reactions on a post
const reactions = await feed.getReactions(post.entityKey);

// Get reaction counts grouped by type
const counts = await feed.getReactionCounts(post.entityKey);
// { like: 12, love: 4, laugh: 1, wow: 0, sad: 0, angry: 0 }
```

### Comments

```ts
// Add a comment
const comment = await feed.addComment(post.entityKey, "Great post!");

// Edit your own comment
await feed.editComment(comment.entityKey, "Great post! ðŸ”¥");

// Delete your comment
await feed.deleteComment(comment.entityKey);

// Get all comments on a post
const comments = await feed.getComments(post.entityKey, { limit: 50 });
```

---

## QR codes and deep links

Aside provides a URI scheme (`aside://v1/...`) for sharing profiles and sending friend requests via QR codes.

### Profile QR

```ts
import { encodeProfileLink, decodeProfileLink } from "aside";

// Encode a profile link (pass to any QR library for rendering)
const uri = encodeProfileLink({
  uuid: "alice-uuid",
  displayName: "Alice",
  wallet: "0xAlice...",
  photo: "https://cdn.example.com/alice.png",
});
// "aside://v1/profile?eyJ1dWlkIjoiYWxpY2UtdXVpZCIsImRpc3BsYXlOYW1lIjoiQWxpY2Ui..."

// Decode it on the receiving end
const data = decodeProfileLink(uri);
// { uuid: 'alice-uuid', displayName: 'Alice', wallet: '0xAlice...', photo: '...' }
```

### Friend request QR (with expiry)

```ts
import {
  encodeFriendRequest,
  decodeFriendRequest,
  isFriendRequestQRValid,
  friendRequestQRExpiresIn,
} from "aside";

// Generate a friend request QR valid for 10 minutes
const uri = encodeFriendRequest(
  {
    fromUuid: "alice-uuid",
    fromWallet: "0xAlice...",
    fromDisplayName: "Alice",
  },
  { ttlMs: 10 * 60 * 1000 },
);

// On the scanning side
if (isFriendRequestQRValid(uri)) {
  const request = decodeFriendRequest(uri); // null if expired
  if (request) {
    await bobSocial.sendFriendRequest(request.fromUuid);
  }
}

// How long until expiry (ms) â€” negative means already expired
const msLeft = friendRequestQRExpiresIn(uri);
console.log(`Expires in ${Math.round(msLeft / 1000)}s`);
```

### Parsing any aside:// URI

```ts
import { parseAsideUri } from "aside";

const parsed = parseAsideUri(uri);
// { type: 'profile' | 'friend-request', data: {...} }
```

---

## Access tokens and session security

Aside uses **ECDH P-256** for token issuance. The server never shares a secret with the client â€” each token derives a unique encryption key via ephemeral Diffie-Hellman. This gives per-token forward secrecy.

### Setup (server side â€” run once)

```ts
import { generateAppKeyPair } from "aside";

const appKey = await generateAppKeyPair();
// Store appKey.privateKey securely on your server.
// Publish appKey.publicKey to your clients (via API, environment variable, etc.)
```

### Issue a token (client side)

```ts
const result = await client.createAccessToken({
  phrase: "user-secret-phrase", // a secret only the user knows
  appId: "my-app-2025",
  appPublicKey: appKey.publicKey, // the server's public key
  permissions: permissionsSnowflake, // optional SnowflakeGenerator ID
  ttlMs: 60 * 60 * 1000, // 1 hour
});

const { token, sessionKey } = result;
// Send `token` to your server; keep `sessionKey` locally for signing requests.
```

### Validate the token (server side)

```ts
import { AccessTokenManager } from "aside";

const manager = new AccessTokenManager();

const result = await manager.validate({
  token,
  appPrivateKey: appKey.privateKey,
});

if (result.valid) {
  console.log(result.claims.sub); // user UUID
  console.log(result.claims.phrase); // decrypted user phrase
  console.log(result.sessionKey); // use this for verifying requests
} else {
  console.error(result.reason); // 'expired' | 'invalid' | 'decryption-failed'
}
```

### Signed session requests (replay-attack protection)

```ts
// Client: sign every API request with the session key
const request = await manager.createSessionRequest(token, sessionKey);
// Send `request` in your API call headers/body.

// Server: verify the request
const session = await manager.validateSession(request, appKey.privateKey, {
  maxAgeMs: 5 * 60 * 1000, // reject requests older than 5 minutes
});

if (session.valid) {
  // Proceed â€” nonce + timestamp + HMAC all verified
}
```

### Phrase commitments (password-style storage)

Store a verifiable commitment to a user's phrase without storing the phrase itself:

```ts
import { phraseToCommitment, verifyPhraseCommitment } from "aside";

// On registration
const { hash, salt } = await phraseToCommitment("user-secret-phrase");
// Store hash + salt in your database.

// On verification
const valid = await verifyPhraseCommitment("user-secret-phrase", hash, salt);
```

---

## Cross-app integration

The power of Aside is that **all apps share the same identity and social graph**. Because everything is stored on ArkaCDN (a public blockchain), any Aside-powered app can interoperate with any other.

### Example: App B reads App A's followers

```ts
// In App B â€” reading followers of "alice-uuid" even though they were created in App A
const aliceClient = new BaseClient({
  uuid: "alice-uuid",
  wallet: "0xAlice...",
  cdn,
});
const social = aliceClient.social();

const followers = await social.getFollowers();
// Returns followers created by *any* Aside app â€” App A, App B, App C, etc.
```

### Example: A game reads a social app's friend list

```ts
// The game reads Alice's friends (populated by a social media app)
const friends = await aliceSocial.getFriends();
const friendUuids = friends.map((f) =>
  f.senderUuid === "alice-uuid" ? f.receiverUuid : f.senderUuid,
);

// Then loads their game profiles
const gameProfiles = await Promise.all(
  friendUuids.map((uuid) =>
    new BaseClient({ uuid, wallet: "...", cdn })
      .extend<{ score: number }>("my-game-2025")
      .get(),
  ),
);
```

### Example: Cross-app feed aggregation

```ts
// Aggregate posts from multiple apps' feeds for the same users
const timeline = await feed.getFeed(friendUuids, { limit: 50 });
// Posts created by those users on any Aside app appear here.
```

---

## Per-app extension data

Store arbitrary app-specific data under a namespace alongside the base profile:

```ts
interface GameData {
  score: number;
  level: number;
  achievements: string[];
}

const ext = client.extend<GameData>("my-game-2025");

// Fetch or create the extension record
const gameProfile = await ext.getOrCreate();

// Update
await ext.update({ score: 9001, level: 42 });
```

Each app gets its own isolated namespace. Different apps never overwrite each other's extension data.

---

## Multi-chain replication

Replicate the base profile to additional blockchains in one call:

```ts
import { ArkaCDN, BaseClient } from "aside";

const kaolinCdn = new ArkaCDN({
  /* kaolin chain */
});
const mendozaCdn = new ArkaCDN({
  /* mendoza chain */
});

await client.sync([kaolinCdn, mendozaCdn]);
// Profile is now on the primary chain + kaolin + mendoza.
```

---

## ProfileWatcher

Watch multiple chains and react when a profile appears or disappears:

```ts
import { ArkaCDN } from "aside";

const kaolinCdn = new ArkaCDN({
  /* kaolin chain */
});

const watcher = client.watch({
  chains: [{ name: "kaolin", cdn: kaolinCdn }],
  intervalMs: 10_000,
  onFound(chain, profile) {
    console.log(`Profile found on ${chain.name}`, profile);
  },
  onLost(chain) {
    console.warn(`Profile disappeared from ${chain.name}`);
  },
});

watcher.start();
// ...
watcher.stop();
```

---

## SnowflakeGenerator

128-bit IDs with embedded 52-bit permission bitmasks â€” useful for encoding user roles and permissions into access tokens.

```ts
import { SnowflakeGenerator } from "aside";

const gen = new SnowflakeGenerator({ workerId: 1 });

gen
  .definePermission({ name: "read", bit: 0 })
  .definePermission({ name: "write", bit: 1 })
  .definePermission({ name: "admin", bit: 2 });

const id = gen.generate({ permissions: ["read", "write"] });

const decoded = gen.decode(id);
console.log(decoded.permissions); // ['read', 'write']

// Static helpers â€” no instance needed
SnowflakeGenerator.hasPermission(id, 2); // false â€” no admin
```

---

## Crypto utilities

Low-level primitives used internally, also available for your own use:

```ts
import {
  generateAesKey,
  aesEncrypt,
  aesDecrypt,
  hmacSign,
  hmacVerify,
  ecdhDeriveKeys,
  generateAppKeyPair,
  phraseToCommitment,
  verifyPhraseCommitment,
} from "aside";

// AES-256-GCM
const key = await generateAesKey();
const { ciphertext, iv } = await aesEncrypt(
  key,
  new TextEncoder().encode("hello"),
);
const plain = await aesDecrypt(key, ciphertext, iv);

// HMAC-SHA256
const sig = await hmacSign(key, new TextEncoder().encode("message"));
const ok = await hmacVerify(key, sig, new TextEncoder().encode("message"));

// ECDH (same keys derived on both sides â€” no secret transmission)
const serverKey = await generateAppKeyPair();
const clientKey = await generateAppKeyPair();
const serverSide = await ecdhDeriveKeys(
  serverKey.privateKey,
  clientKey.publicKey,
);
const clientSide = await ecdhDeriveKeys(
  clientKey.privateKey,
  serverKey.publicKey,
);
// serverSide.encKey === clientSide.encKey âœ“
```

All functions use `globalThis.crypto.subtle` â€” no Node.js built-ins, no polyfills needed.

---

## API reference

### `BaseClient`

| Method                     | Returns                              | Description                                      |
| -------------------------- | ------------------------------------ | ------------------------------------------------ |
| `new BaseClient(opts)`     | `BaseClient`                         | Construct with `{ uuid, wallet, photo, cdn? }`   |
| `.setCdn(cdn)`             | `this`                               | Set the CDN instance (fluent)                    |
| `.get()`                   | `Promise<BaseProfileResult \| null>` | Fetch the profile, or `null` if absent           |
| `.getOrCreate()`           | `Promise<BaseProfileResult>`         | Fetch or create the profile                      |
| `.update(data)`            | `Promise<BaseProfileResult>`         | Update profile fields                            |
| `.sync(cdns)`              | `Promise<BaseProfileResult>`         | Replicate to other chains                        |
| `.extend<T>(ns)`           | `ExtensionClient<T>`                 | App-specific extension data under namespace `ns` |
| `.watch(opts)`             | `ProfileWatcher`                     | Create a multi-chain watcher                     |
| `.social()`                | `SocialClient`                       | Access the social graph for this user            |
| `.feed()`                  | `FeedClient`                         | Access the content feed for this user            |
| `.createAccessToken(opts)` | `Promise<CreateAccessTokenResult>`   | Issue an ECDH-sealed access token                |

### `SocialClient`

| Method                              | Returns                                      | Description                                    |
| ----------------------------------- | -------------------------------------------- | ---------------------------------------------- |
| `.follow(targetUuid)`               | `Promise<SocialFollow>`                      | Follow a user                                  |
| `.unfollow(targetUuid)`             | `Promise<void>`                              | Unfollow a user                                |
| `.isFollowing(targetUuid)`          | `Promise<boolean>`                           | Check if the current user follows `targetUuid` |
| `.getFollowing(opts?)`              | `Promise<SocialFollow[]>`                    | List users this user follows                   |
| `.getFollowers(opts?)`              | `Promise<SocialFollow[]>`                    | List users following this user                 |
| `.getFollowerCounts()`              | `Promise<{ followingCount, followerCount }>` | Get follower / following counts                |
| `.sendFriendRequest(targetUuid)`    | `Promise<FriendRequest>`                     | Send a friend request                          |
| `.acceptFriendRequest(entityKey)`   | `Promise<FriendRequest>`                     | Accept an incoming friend request              |
| `.rejectFriendRequest(entityKey)`   | `Promise<FriendRequest>`                     | Reject an incoming friend request              |
| `.cancelFriendRequest(entityKey)`   | `Promise<FriendRequest>`                     | Cancel an outgoing friend request              |
| `.getIncomingFriendRequests(opts?)` | `Promise<FriendRequest[]>`                   | List incoming pending friend requests          |
| `.getOutgoingFriendRequests(opts?)` | `Promise<FriendRequest[]>`                   | List outgoing pending friend requests          |
| `.getFriends(opts?)`                | `Promise<FriendRequest[]>`                   | List accepted friends                          |
| `.block(targetUuid)`                | `Promise<SocialBlock>`                       | Block a user                                   |
| `.unblock(targetUuid)`              | `Promise<void>`                              | Unblock a user                                 |
| `.isBlocked(targetUuid)`            | `Promise<boolean>`                           | Check if `targetUuid` is blocked               |
| `.getBlockedUsers(opts?)`           | `Promise<SocialBlock[]>`                     | List all blocked users                         |

### `FeedClient`

| Method                             | Returns                                 | Description                          |
| ---------------------------------- | --------------------------------------- | ------------------------------------ |
| `.createPost(opts)`                | `Promise<SocialPost>`                   | Create a new post                    |
| `.getPost(entityKey)`              | `Promise<SocialPost \| null>`           | Fetch a single post                  |
| `.updatePost(entityKey, updates)`  | `Promise<SocialPost>`                   | Edit a post                          |
| `.deletePost(entityKey)`           | `Promise<void>`                         | Soft-delete a post                   |
| `.getUserPosts(uuid, opts?)`       | `Promise<SocialPost[]>`                 | Get all posts by a user              |
| `.getFeed(uuids, opts?)`           | `Promise<SocialPost[]>`                 | Timeline feed for a list of UUIDs    |
| `.react(entityKey, type)`          | `Promise<SocialReaction>`               | React to a post                      |
| `.like(entityKey)`                 | `Promise<SocialReaction>`               | Shorthand for `react(key, 'like')`   |
| `.unreact(entityKey, type)`        | `Promise<void>`                         | Remove a reaction                    |
| `.unlike(entityKey)`               | `Promise<void>`                         | Shorthand for `unreact(key, 'like')` |
| `.hasReacted(entityKey, type)`     | `Promise<boolean>`                      | Check if current user has reacted    |
| `.getReactions(entityKey, opts?)`  | `Promise<SocialReaction[]>`             | List all reactions on a post         |
| `.getReactionCounts(entityKey)`    | `Promise<Record<ReactionType, number>>` | Count reactions by type              |
| `.addComment(entityKey, content)`  | `Promise<SocialComment>`                | Add a comment to a post              |
| `.editComment(entityKey, content)` | `Promise<SocialComment>`                | Edit an existing comment             |
| `.deleteComment(entityKey)`        | `Promise<void>`                         | Soft-delete a comment                |
| `.getComments(entityKey, opts?)`   | `Promise<SocialComment[]>`              | List comments on a post              |

### `AccessTokenManager`

| Method                                     | Returns                                               | Description                        |
| ------------------------------------------ | ----------------------------------------------------- | ---------------------------------- |
| `new AccessTokenManager()`                 |                                                       |                                    |
| `.create(opts)`                            | `Promise<CreateAccessTokenResult>`                    | Issue an ECDH-sealed token         |
| `.validate(opts)`                          | `Promise<ValidateTokenResult \| InvalidTokenResult>`  | Decrypt + verify expiry            |
| `.createSessionRequest(token, sessionKey)` | `Promise<SessionRequest>`                             | HMAC-signed nonce request          |
| `.validateSession(req, privateKey, opts?)` | `Promise<ValidSessionResult \| InvalidSessionResult>` | Verify HMAC + age + decrypt claims |

### `SnowflakeGenerator`

| Method                                           | Returns               | Description                     |
| ------------------------------------------------ | --------------------- | ------------------------------- |
| `new SnowflakeGenerator({ workerId? })`          |                       | Default `workerId = 0`          |
| `.definePermission({ name, bit, description? })` | `this`                | Register a named permission bit |
| `.generate({ permissions? })`                    | `PermissionSnowflake` | Generate a 32-char hex ID       |
| `.decode(snowflake)`                             | `DecodedSnowflake`    | Decode timestamp + permissions  |
| `SnowflakeGenerator.extractPermissions(s)`       | `bigint`              | Get raw permission bits         |
| `SnowflakeGenerator.hasPermission(s, bit)`       | `boolean`             | Test a single permission bit    |

### QR utilities

| Function                           | Returns                       | Description                                     |
| ---------------------------------- | ----------------------------- | ----------------------------------------------- |
| `encodeProfileLink(data)`          | `string`                      | Encode a profile as an `aside://v1/profile` URI |
| `decodeProfileLink(uri)`           | `ProfileQRData`               | Decode a profile URI                            |
| `encodeFriendRequest(data, opts?)` | `string`                      | Encode a friend request URI with optional TTL   |
| `decodeFriendRequest(uri)`         | `FriendRequestQRData \| null` | Decode; returns `null` if expired               |
| `isFriendRequestQRValid(uri)`      | `boolean`                     | Returns `true` if not expired                   |
| `friendRequestQRExpiresIn(uri)`    | `number`                      | Milliseconds until expiry (negative = expired)  |
| `parseAsideUri(uri)`               | `{ type, data }`              | Parse any `aside://` URI                        |

---

## Release workflow

```bash
# bump version, generate changelog, tag, push â†’ CI publishes to npm
npm run release
```

Releases are automated via GitHub Actions (`.github/workflows/release.yml`). Add an `NPM_TOKEN` secret to your repository before the first publish.

---

## License

ISC
