/**
 * ASide — Decentralized user profiles with cross-chain replication,
 * social graph, feed, QR utilities, and ECDH-based access token authorization.
 *
 * Built on ArkaCDN / Arkiv Network.  Works in both Node.js ≥ 16 and modern browsers.
 *
 * ## Core classes
 *
 * - **BaseClient** — Discord.js-style extensible class.  Manages an identity
 *   (uuid + wallet + photo) across chains, with `sync()`, `watch()`, `social()`,
 *   `feed()`, `extend()`, and `createAccessToken()`.
 * - **ExtensionClient** — App-specific data per namespace.
 * - **SocialClient** — Follow graph, friend requests, and user blocking.
 * - **FeedClient** — Posts, likes/reactions, and comments.
 * - **AccessTokenManager** — ECDH P-256 sealed tokens + session requests.
 * - **SnowflakeGenerator** — 128-bit IDs with 52-bit permission bitmasks.
 * - **ProfileWatcher** — Polls multiple chains for profile presence.
 *
 * ## Auth scheme
 *
 * `generateAppKeyPair()` → publish the public key → client calls
 * `manager.create({ appPublicKey })` → server calls `manager.validate({ appPrivateKey })`.
 * No shared secret is ever transmitted.
 *
 * @module
 */

// ─── ArkaCDN (re-exported — no separate install needed) ──────────────────────
export * from 'arka-cdn'

// ─── Arkiv Network SDK utilities ─────────────────────────────────────────────
export { chainFromName } from '@arkiv-network/sdk'

// ─── Viem account utilities ───────────────────────────────────────────────────
export { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'

// ─── Core classes ─────────────────────────────────────────────────────────────
export { BaseClient } from './base-client.js'
export { ExtensionClient } from './extension.js'
export { AccessTokenManager } from './access-token.js'
export { SnowflakeGenerator } from './snowflake.js'
export { ProfileWatcher } from './watcher.js'
export { SocialClient } from './social.js'
export { FeedClient } from './feed.js'
export { EventClient } from './event.js'

// ─── Crypto utilities ─────────────────────────────────────────────────────────
export {
  generateAppKeyPair,
  generateAesKey,
  ecdhDeriveKeys,
  phraseToCommitment,
  verifyPhraseCommitment,
  aesEncrypt,
  aesDecrypt,
  hmacSign,
  hmacVerify,
} from './crypto.js'

// ─── QR utilities ─────────────────────────────────────────────────────────────
export {
  encodeProfileLink,
  decodeProfileLink,
  encodeFriendRequest,
  decodeFriendRequest,
  isFriendRequestQRValid,
  friendRequestQRExpiresIn,
  parseAsideUri,
} from './qr.js'

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  // Profile
  BaseProfileData,
  BaseProfileResult,
  BaseClientOptions,
  ExtensionData,
  ExtensionResult,
  // Snowflake
  PermissionDefinition,
  PermissionSnowflake,
  // Access tokens
  AccessTokenClaims,
  SealedAccessToken,
  CreateAccessTokenOptions,
  CreateAccessTokenResult,
  ValidateTokenOptions,
  ValidateTokenResult,
  InvalidTokenResult,
  AppKeyPair,
  ParityKeyPair,       // kept for backward compat, deprecated
  // Watcher
  ChainCDN,
  WatcherOptions,
  WatcherChainResult,
  // Session
  SessionRequest,
  // Social
  SocialFollow,
  FriendRequest,
  FriendRequestStatus,
  SocialPost,
  PostMedia,
  PostMediaType,
  SocialReaction,
  ReactionType,
  SocialComment,
  SocialBlock,
  SocialStatus,
  CreatePostOptions,
  PaginationOptions,
  // QR
  ProfileQRData,
  FriendRequestQRData,
  QREncodeOptions,
  // Events
  EventModality,
  EventVisibility,
  EventStatus,
  RSVPStatus,
  OrganizerRole,
  QuestionType,
  TicketStatus,
  InviteStatus,
  CheckinMethod,
  EventLocation,
  EventAgendaItem,
  EventData,
  EventOrganizer,
  EventRole,
  RSVPRecord,
  EventQuestion,
  TicketType,
  TicketRecord,
  DiscountCode,
  WaitlistEntry,
  EventInvite,
  CheckinRecord,
  EventCalendar,
  EventCalendarEntry,
  EventNotification,
  EventAnalytics,
  CreateEventOptions,
  UpdateEventOptions,
  CreateQuestionOptions,
  CreateTicketTypeOptions,
  CreateDiscountCodeOptions,
  EventQueryOptions,
} from './types.js'

// ─── Constants ────────────────────────────────────────────────────────────────
export {
  ATTR_NAMESPACE,
  ATTR_TYPE,
  ATTR_UUID,
  ATTR_WALLET,
  ATTR_TARGET_UUID,
  ATTR_TARGET_KEY,
  DEFAULT_EXPIRY_SECONDS,
  EXTENSION_TYPE,
  PROFILE_TYPE,
  SOCIAL_FOLLOW_TYPE,
  SOCIAL_FRIEND_REQUEST_TYPE,
  SOCIAL_POST_TYPE,
  SOCIAL_REACTION_TYPE,
  SOCIAL_COMMENT_TYPE,
  SOCIAL_BLOCK_TYPE,
  SNOWFLAKE_EPOCH,
  ATTR_EVENT_KEY,
  ATTR_EVENT_STATUS,
  EVENT_TYPE,
  EVENT_ORGANIZER_TYPE,
  EVENT_ROLE_TYPE,
  EVENT_RSVP_TYPE,
  EVENT_QUESTION_TYPE,
  EVENT_TICKET_TYPE_ENTITY,
  EVENT_TICKET_TYPE,
  EVENT_DISCOUNT_TYPE,
  EVENT_WAITLIST_TYPE,
  EVENT_INVITE_TYPE,
  EVENT_CHECKIN_TYPE,
  EVENT_CALENDAR_TYPE,
  EVENT_CALENDAR_ENTRY_TYPE,
  EVENT_CALENDAR_FOLLOW_TYPE,
  EVENT_NOTIFICATION_TYPE,
  EVENT_ANNOUNCEMENT_TYPE,
  EVENT_REPORT_TYPE,
} from './constants.js'
