# ASide

Decentralized user profiles with cross-chain replication, per-app extension data, access token authorization, and session validation — powered by [ArkaCDN](https://github.com/Arkiv-Network/arka-cdn).

Works in **Node.js ≥ 16** and all modern **browsers** (uses the WebCrypto API, no native crypto modules).

---

## Install

```bash
pnpm add aside arka-cdn
```

---

## Quick start

```ts
import { BaseClient } from "aside";
import { ArkaCDN } from "arka-cdn";

const cdn = new ArkaCDN({
  /* your chain config */
});

const client = new BaseClient({
  uuid: "user-uuid",
  wallet: "0xABCD...",
  photo: "https://example.com/avatar.png",
  cdn, // cdn is optional — you can pass it later via setCdn()
});

// Fetch or create the profile
const profile = await client.getOrCreate();
console.log(profile);

// Update fields
await client.update({ displayName: "Alice" });
```

### Deferred CDN

```ts
const client = new BaseClient({ uuid, wallet, photo });

// ...resolve your CDN somewhere else...
client.setCdn(cdn);

const profile = await client.get();
```

---

## Subclassing

`BaseClient` is designed to be extended, Discord.js-style:

```ts
import { BaseClient, type BaseClientOptions } from "aside";

interface MyOptions extends BaseClientOptions {
  appId: string;
}

class MyAppClient extends BaseClient {
  readonly appId: string;

  constructor(options: MyOptions) {
    super(options);
    this.appId = options.appId;
  }

  async getAppProfile() {
    return this.extend<{ score: number }>(this.appId).getOrCreate();
  }
}
```

---

## Cross-chain replication

Replicate the base profile to additional chains (e.g. kaolin, mendoza) in one call:

```ts
import { ArkaCDN } from "arka-cdn";

const kaolinCdn = new ArkaCDN({
  /* kaolin chain */
});
const mendozaCdn = new ArkaCDN({
  /* mendoza chain */
});

await client.sync([kaolinCdn, mendozaCdn]);
```

`sync` calls `getOrCreate` on every chain and merges the data. The primary chain CDN set at construction remains the default.

---

## ProfileWatcher

Watch multiple chains and react when a profile appears or disappears:

```ts
import { ProfileWatcher } from "aside";

const watcher = client.watch({
  chains: [
    { name: "kaolin", cdn: kaolinCdn },
    { name: "mendoza", cdn: mendozaCdn },
  ],
  intervalMs: 10_000, // poll every 10 s (default: 30 s)
  onFound(chain, profile) {
    console.log(`Profile found on ${chain.name}:`, profile);
  },
  onLost(chain) {
    console.warn(`Profile disappeared from ${chain.name}`);
  },
});

watcher.start();

// Stop later
watcher.stop();

// Or poll manually (returns results for all chains)
const results = await watcher.poll();
```

---

## Per-app extension data

Store app-specific data using a namespace string (e.g. your app ID):

```ts
interface GameData {
  score: number;
  level: number;
}

const ext = client.extend<GameData>("my-game-2025");

// Fetch or create
const existing = await ext.getOrCreate();

// Update
await ext.update({ score: 42, level: 3 });
```

---

## SnowflakeGenerator

128-bit snowflake IDs with embedded 52-bit permission bitmasks. Snowflakes encode a millisecond timestamp, worker ID, sequence counter, and permissions — encoded as a 32-character lowercase hex string.

```ts
import { SnowflakeGenerator } from "aside";

const gen = new SnowflakeGenerator({ workerId: 1 });

// Register custom permissions on bits 0-51
gen
  .definePermission({ name: "read", bit: 0 })
  .definePermission({ name: "write", bit: 1 })
  .definePermission({
    name: "admin",
    bit: 2,
    description: "Full admin access",
  });

// Generate a snowflake with specific permissions
const snowflake = gen.generate({ permissions: ["read", "write"] });
// e.g. "0193a7b4e2a0000100000000000003..."

// Decode it back
const decoded = gen.decode(snowflake);
console.log(decoded.timestamp); // Date timestamp (ms)
console.log(decoded.permissions); // ['read', 'write']
console.log(decoded.permissionBits); // 3n (bit 0 + bit 1)

// Static helpers — no class instance needed
import { SnowflakeGenerator } from "aside";

const bits = SnowflakeGenerator.extractPermissions(snowflake); // bigint
const isAdmin = SnowflakeGenerator.hasPermission(snowflake, 2); // boolean
```

---

## Parity key exchange + access tokens

The parity-key scheme lets an app owner securely issue short-lived sealed tokens to users.

### 1. App owner generates a parity key

The parity key is an AES-256-GCM key held by the app owner. Share the `publicHex` representation with the user via a secure channel (HTTPS, QR, etc.).

```ts
import { generateParityKey } from "aside";

const parityKey = await generateParityKey();
// { key: CryptoKey, publicHex: string, createdAt: number, expiresAt: number }

// Store parityKey.publicHex on your server against the appId
```

### 2. User creates an access token

The user provides their `phrase` (private credential) along with the app's public parity key hex:

```ts
const token = await client.createAccessToken({
  phrase: "user-secret-phrase",
  appId: "my-app-2025",
  parityKeyHex: parityKey.publicHex,
  permissions: snowflakeId, // a SnowflakeGenerator-produced ID
  ttlMs: 60 * 60 * 1000, // 1 hour (default)
});
// SealedAccessToken: { ciphertext, iv, claims: { sub, appId, ... } }
```

### 3. App validates the token

```ts
import { AccessTokenManager } from "aside";

const manager = new AccessTokenManager();

const result = await manager.validate({
  token,
  parityKey: parityKey.key,
});

if (result.valid) {
  console.log(result.claims.phrase); // decrypted user phrase
  console.log(result.claims.permissions); // snowflake with permission bits
} else {
  console.error(result.reason); // 'expired' | 'invalid' | 'decryption-failed'
}
```

---

## Session requests (replay-attack protection)

After token validation, the client can make HMAC-signed session requests that include a nonce + timestamp, preventing replay attacks.

```ts
// Client side
const sessionRequest = await manager.createSessionRequest(token, parityKey.key);
// Send sessionRequest to server

// Server side
const session = await manager.validateSession(sessionRequest, parityKey.key, {
  maxAgeMs: 5 * 60 * 1000, // default: 5 min
});

if (session.valid) {
  console.log(session.claims); // full decrypted AccessTokenClaims
}
```

---

## Crypto utilities (low-level)

```ts
import {
  generateAesKey,
  aesEncrypt,
  aesDecrypt,
  hmacSign,
  hmacVerify,
} from "aside";

const key = await generateAesKey(); // CryptoKey (AES-256-GCM)
const { ciphertext, iv } = await aesEncrypt(
  key,
  new TextEncoder().encode("hello"),
);
const plain = await aesDecrypt(key, ciphertext, iv); // Uint8Array

const sig = await hmacSign(key, new TextEncoder().encode("message"));
const ok = await hmacVerify(key, sig, new TextEncoder().encode("message"));
```

All functions use `globalThis.crypto.subtle` — no polyfills needed in Node.js ≥ 16 or modern browsers.

---

## API reference

### `BaseClient`

| Method                     | Returns                              | Description                                    |
| -------------------------- | ------------------------------------ | ---------------------------------------------- |
| `new BaseClient(opts)`     | `BaseClient`                         | Construct with `{ uuid, wallet, photo, cdn? }` |
| `.setCdn(cdn)`             | `this`                               | Set the CDN instance (fluent)                  |
| `.get()`                   | `Promise<BaseProfileResult \| null>` | Fetch the profile, or `null` if absent         |
| `.getOrCreate()`           | `Promise<BaseProfileResult>`         | Fetch or create the profile                    |
| `.update(data)`            | `Promise<BaseProfileResult>`         | Update profile fields                          |
| `.sync(cdns)`              | `Promise<BaseProfileResult>`         | Replicate to other chains                      |
| `.extend<T>(ns)`           | `ExtensionClient<T>`                 | App-specific extension data                    |
| `.watch(opts)`             | `ProfileWatcher`                     | Create a multi-chain watcher                   |
| `.createAccessToken(opts)` | `Promise<SealedAccessToken>`         | Issue a sealed access token                    |

### `SnowflakeGenerator`

| Method                                           | Returns               | Description                    |
| ------------------------------------------------ | --------------------- | ------------------------------ |
| `new SnowflakeGenerator({ workerId? })`          |                       | Default workerId = 0           |
| `.definePermission({ name, bit, description? })` | `this`                | Register a named permission    |
| `.generate({ permissions? })`                    | `PermissionSnowflake` | Generate a 32-char hex ID      |
| `.decode(snowflake)`                             | `DecodedSnowflake`    | Decode timestamp + permissions |
| `SnowflakeGenerator.extractPermissions(s)`       | `bigint`              | Get raw permission bits        |
| `SnowflakeGenerator.hasPermission(s, bit)`       | `boolean`             | Test single permission bit     |

### `AccessTokenManager`

| Method                              | Returns                                              | Description                    |
| ----------------------------------- | ---------------------------------------------------- | ------------------------------ |
| `new AccessTokenManager()`          |                                                      |                                |
| `.create(opts)`                     | `Promise<SealedAccessToken>`                         | Encrypt claims with parity key |
| `.validate(opts)`                   | `Promise<ValidateTokenResult \| InvalidTokenResult>` | Decrypt + verify expiry        |
| `.createSessionRequest(token, key)` | `Promise<SessionRequest>`                            | HMAC-signed request with nonce |
| `.validateSession(req, key, opts?)` | `Promise<...>`                                       | Verify age + HMAC + decrypt    |

---

## Release workflow

```bash
# bump version, generate changelog, tag, push → CI publishes to npm
pnpm release
```

Releases are fully automated via GitHub Actions (`.github/workflows/release.yml`). Add an `NPM_TOKEN` secret to your repository before the first publish.

---

## License

ISC
