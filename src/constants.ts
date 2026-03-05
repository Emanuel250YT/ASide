/** Shared attribute keys used for all ASide entities. */
export const ATTR_TYPE = 'aside.type'
export const ATTR_UUID = 'aside.uuid'
export const ATTR_WALLET = 'aside.wallet'
export const ATTR_NAMESPACE = 'aside.namespace'

/** Entity type discriminators stored in `aside.type`. */
export const PROFILE_TYPE = 'profile'
export const EXTENSION_TYPE = 'extension'

/**
 * Default entity TTL: 365 days in seconds.
 * Profiles and extensions expire after one year unless renewed.
 */
export const DEFAULT_EXPIRY_SECONDS = 365 * 24 * 60 * 60
