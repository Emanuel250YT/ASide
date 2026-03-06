/** Shared attribute keys used for all ASide entities. */
export const ATTR_TYPE = 'aside.type'
export const ATTR_UUID = 'aside.uuid'
export const ATTR_WALLET = 'aside.wallet'
export const ATTR_NAMESPACE = 'aside.namespace'

/** Attribute keys for social graph entities. */
export const ATTR_TARGET_UUID = 'aside.social.target'      // followee / blocked / friend
export const ATTR_TARGET_KEY = 'aside.social.target_key'  // post/comment entity key

/** Entity type discriminators stored in `aside.type`. */
export const PROFILE_TYPE = 'profile'
export const EXTENSION_TYPE = 'extension'

/** Social entity type discriminators. */
export const SOCIAL_FOLLOW_TYPE = 'aside.social.follow'
export const SOCIAL_FRIEND_REQUEST_TYPE = 'aside.social.friend_request'
export const SOCIAL_POST_TYPE = 'aside.social.post'
export const SOCIAL_REACTION_TYPE = 'aside.social.reaction'
export const SOCIAL_COMMENT_TYPE = 'aside.social.comment'
export const SOCIAL_BLOCK_TYPE = 'aside.social.block'

/**
 * Default entity TTL: 365 days in seconds.
 * Profiles and extensions expire after one year unless renewed.
 */
export const DEFAULT_EXPIRY_SECONDS = 365 * 24 * 60 * 60

// ─── Snowflake constants ───────────────────────────────────────────────────────

/** Custom epoch for ASide snowflakes: 2025-01-01T00:00:00.000Z */
export const SNOWFLAKE_EPOCH = 1735689600000n

/** Bit widths inside the 128-bit ASide snowflake (as bigint). */
export const SNOWFLAKE_TIMESTAMP_BITS = 48n
export const SNOWFLAKE_WORKER_BITS = 14n
export const SNOWFLAKE_SEQUENCE_BITS = 14n
export const SNOWFLAKE_PERMISSION_BITS = 52n

/** Max values derived from bit widths. */
export const MAX_WORKER_ID = (1n << SNOWFLAKE_WORKER_BITS) - 1n
export const MAX_SEQUENCE = (1n << SNOWFLAKE_SEQUENCE_BITS) - 1n
export const MAX_PERMISSIONS = (1n << SNOWFLAKE_PERMISSION_BITS) - 1n

// ─── Crypto constants ─────────────────────────────────────────────────────────

/** AES-256-GCM IV length in bytes. */
export const AES_IV_BYTES = 12

/** AES-256-GCM key length in bytes. */
export const AES_KEY_BYTES = 32

/** PBKDF2 hash output length in bytes. */
export const PBKDF2_KEY_BYTES = 32

/** PBKDF2 iteration count (OWASP minimum for SHA-256 is 600 000; 100 000 is a practical default). */
export const PBKDF2_ITERATIONS = 100_000

/** Default app ECDH key pair TTL: 30 days. */
export const DEFAULT_APP_KEY_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Default access token TTL: 1 hour. */
export const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000

/** Request signature max age in ms (5 minutes clock skew). */
export const MAX_REQUEST_AGE_MS = 5 * 60 * 1000
