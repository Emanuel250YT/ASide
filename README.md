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
3. [Social graph — follow, friend, block](#social-graph--follow-friend-block)
4. [Content feed — posts, reactions, comments](#content-feed--posts-reactions-comments)
5. [Events](#events)
   - [Creating & publishing events](#creating--publishing-events)
   - [Agenda management](#agenda-management)
   - [Organizers & role-based permissions](#organizers--role-based-permissions)
   - [Registration / RSVP](#registration--rsvp)
   - [Guest list](#guest-list)
   - [Custom registration questions](#custom-registration-questions)
   - [Ticket types & tickets](#ticket-types--tickets)
   - [Discount codes](#discount-codes)
   - [Waitlist](#waitlist)
   - [Invitations](#invitations)
   - [Check-in](#check-in)
   - [Announcements & reminders](#announcements--reminders)
   - [Analytics](#analytics)
   - [Calendars & calendar following](#calendars--calendar-following)
   - [Notifications](#notifications)
   - [Moderation](#moderation)
6. [QR codes and deep links](#qr-codes-and-deep-links)
7. [Access tokens and session security](#access-tokens-and-session-security)
8. [Cross-app integration](#cross-app-integration)
9. [Per-app extension data](#per-app-extension-data)
10. [Multi-chain replication](#multi-chain-replication)
11. [ProfileWatcher](#profilewatcher)
12. [SnowflakeGenerator](#snowflakegenerator)
13. [Crypto utilities](#crypto-utilities)
14. [API reference](#api-reference)

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

## Events

`client.events()` returns an `EventClient` — a full Luma-style event platform backed by the same on-chain identity. Events are linked to your profile, publicly discoverable, and composable with the rest of the ASide social graph.

### Creating & publishing events

```ts
const events = client.events();
const now = Date.now();

// Create a new event in DRAFT status
const event = await events.createEvent({
  title: "Arkiv Hackathon 2025",
  description: "A 48-hour hackathon on the Arkiv network.",
  startsAt: now + 7 * 24 * 60 * 60 * 1000, // 1 week from now
  endsAt: now + 9 * 24 * 60 * 60 * 1000, // 9 days from now
  timezone: "UTC",
  modality: "hybrid", // 'in-person' | 'online' | 'hybrid'
  visibility: "public", // 'public' | 'unlisted' | 'private'
  capacity: 200,
  location: {
    name: "Techspace",
    city: "Berlin",
    country: "DE",
    url: "https://meet.example.com",
  },
  tags: ["hackathon", "web3"],
  categories: ["technology"],
  requiresApproval: false,
});
// event.status === 'draft'

// Publish — makes the event publicly visible
const published = await events.publishEvent(event.entityKey);
// published.status === 'published'

// Update fields
const updated = await events.updateEvent(event.entityKey, {
  description: "A 48-hour hackathon — prizes worth $10,000.",
  capacity: 250,
});

// Duplicate as a new draft
const copy = await events.duplicateEvent(event.entityKey, {
  title: "Arkiv Hackathon — Spring Edition",
});

// Cancel a draft or published event
const cancelled = await events.cancelEvent(copy.entityKey);
// cancelled.status === 'cancelled'

// Fetch a single event by entity key
const fetched = await events.getEvent(event.entityKey);

// Discovery
const myEvents = await events.listEvents();
const upcoming = await events.listUpcomingEvents();
const past = await events.listPastEvents();
const inBerlin = await events.listByCity("Berlin");
const techEvents = await events.listByCategory("technology");
const trending = await events.listTrending();
const results = await events.searchEvents("hackathon");
```

### Agenda management

```ts
// Add an agenda item
const withAgenda = await events.addAgendaItem(event.entityKey, {
  title: "Opening Keynote",
  description: "Welcome to Arkiv Hackathon 2025!",
  startsAt: now + 7 * 24 * 60 * 60 * 1000,
  endsAt: now + 7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000,
  speakerUuid: "speaker-uuid",
});

const item = withAgenda.agenda![0];

// Update an item
await events.updateAgendaItem(event.entityKey, item.id, {
  title: "Opening Keynote (updated)",
});

// Remove an item
await events.removeAgendaItem(event.entityKey, item.id);
```

### Organizers & role-based permissions

```ts
// Add a co-organizer
const coOrg = await events.addOrganizer(
  event.entityKey,
  "co-organizer-uuid",
  "co-organizer-wallet",
  "co-organizer",
);

// Change their role: 'owner' | 'co-organizer' | 'moderator' | 'volunteer'
await events.changeOrganizerRole(event.entityKey, coOrg.entityKey, "moderator");

// Assign a custom role to an attendee
await events.assignRole(event.entityKey, "attendee-uuid", "speaker");

// Check a permission
const canManage = await events.checkPermission(
  event.entityKey,
  "attendee-uuid",
  "manage_event",
);

// List organizers
const organizers = await events.listOrganizers(event.entityKey);

// Remove an organizer
await events.removeOrganizer(event.entityKey, coOrg.entityKey);
```

### Registration / RSVP

```ts
// Register for an event (creates an RSVP)
const rsvp = await events.register(event.entityKey);
// rsvp.status === 'approved' (if requiresApproval is false) or 'pending'

// View all registrations (organizer view)
const registrations = await events.listRegistrations(event.entityKey);

// View your own registrations
const myRSVPs = await events.listMyRegistrations();

// Organizer: approve / reject pending RSVPs
await events.approveRegistration(event.entityKey, rsvp.entityKey);
await events.rejectRegistration(event.entityKey, rsvp.entityKey);

// Mark attendance
await events.markAttendance(event.entityKey, rsvp.entityKey);

// Close / reopen registration
await events.closeRegistration(event.entityKey);
await events.reopenRegistration(event.entityKey);

// Toggle manual approval gate
await events.enableManualApproval(event.entityKey);
await events.disableManualApproval(event.entityKey);

// Cancel your own RSVP
await events.cancelRegistration(event.entityKey);
```

### Guest list

```ts
// Toggle attendee list visibility
await events.showAttendeesList(event.entityKey);
await events.hideAttendeesList(event.entityKey);

// List / search attendees (organizer)
const attendees = await events.listAttendees(event.entityKey);
const found = await events.searchAttendees(event.entityKey, "alice");

// Remove an attendee
await events.removeAttendee(event.entityKey, "attendee-uuid");
```

### Custom registration questions

```ts
// Create a question
const q1 = await events.createQuestion(event.entityKey, {
  label: "What's your Arkiv experience level?",
  type: "select", // 'text' | 'select' | 'multiselect' | 'checkbox' | 'number'
  options: ["Beginner", "Intermediate", "Advanced"],
  required: true,
});

const q2 = await events.createQuestion(event.entityKey, {
  label: "Dietary restrictions?",
  type: "text",
  required: false,
});

// Update a question
await events.updateQuestion(q1.entityKey, { label: "Arkiv experience level?" });

// Reorder questions
await events.reorderQuestions(event.entityKey, [q2.entityKey, q1.entityKey]);

// List all questions
const questions = await events.listQuestions(event.entityKey);

// Delete a question
await events.deleteQuestion(q1.entityKey);
```

### Ticket types & tickets

```ts
// Create a free tier
const freeTier = await events.createTicketType(event.entityKey, {
  name: "Free Admission",
  price: 0,
  capacity: 100,
  currency: "USD",
});

// Create a paid tier
const paidTier = await events.createTicketType(event.entityKey, {
  name: "VIP Pass",
  price: 49.99,
  capacity: 50,
  currency: "USD",
});

// Update a ticket type
await events.updateTicketType(paidTier.entityKey, { capacity: 75 });

// Purchase a ticket
const ticket = await events.purchaseTicket(event.entityKey, freeTier.entityKey);

// Generate a QR code for the ticket
const qr = await events.generateTicketQR(ticket.entityKey);
// qr.qrData is an aside://v1/ticket URI

// Validate the QR (returns the ticket entity if valid)
const validated = await events.validateTicketQR(qr.qrData);

// Transfer a ticket to another user
await events.transferTicket(ticket.entityKey, "recipient-uuid");

// Cancel a ticket
await events.cancelTicket(ticket.entityKey);

// List tickets
const myTickets = await events.listMyTickets();
const eventTickets = await events.listEventTickets(event.entityKey);

// Manage ticket types
const ticketTypes = await events.listTicketTypes(event.entityKey);
await events.deleteTicketType(freeTier.entityKey);
```

### Discount codes

```ts
// Create a discount code
const code = await events.createDiscountCode(event.entityKey, {
  code: "HACK20",
  discountPercent: 20,
  maxUses: 50,
  expiresAt: now + 30 * 24 * 60 * 60 * 1000,
});

// Validate a code before purchase
const validation = await events.validateDiscountCode(event.entityKey, "HACK20");
// { valid: true, discountPercent: 20, code: 'HACK20' }

// List all codes (organizer)
const codes = await events.listDiscountCodes(event.entityKey);

// Delete a code
await events.deleteDiscountCode(code.entityKey);
```

### Waitlist

```ts
// Join the waitlist (when event is full)
const entry = await events.joinWaitlist(event.entityKey);

// Check the waitlist
const waitlist = await events.listWaitlist(event.entityKey);

// Promote the first person on the waitlist to registered
await events.promoteFromWaitlist(event.entityKey);

// Leave the waitlist
await events.leaveWaitlist(event.entityKey);
```

### Invitations

```ts
// Invite a single attendee by email
const invite = await events.inviteByEmail(
  event.entityKey,
  "alice@example.com",
  { message: "You're invited!" },
);

// Bulk invite
const invites = await events.inviteList(event.entityKey, [
  { email: "bob@example.com" },
  { email: "carol@example.com" },
]);

// Resend or cancel an invite
await events.resendInvite(invite.entityKey);
await events.cancelInvite(invite.entityKey);

// View all invites
const allInvites = await events.listInvites(event.entityKey);

// Accept / reject an invite (invitee side)
await events.acceptInvite(invite.entityKey);
await events.rejectInvite(invite.entityKey);
```

### Check-in

```ts
// Check in by scanning the attendee's ticket QR
const checkin = await events.checkinByQR(event.entityKey, qr.qrData);

// Check in by email (fallback)
await events.checkinByEmail(event.entityKey, "alice@example.com");

// Manual check-in by UUID
await events.checkinManual(event.entityKey, "attendee-uuid");

// Undo accidental check-in
await events.undoCheckin(event.entityKey, checkin.entityKey);

// View all check-ins
const checkins = await events.listCheckins(event.entityKey);

// Check if a specific attendee has checked in
const status = await events.getCheckinStatus(event.entityKey, "attendee-uuid");
// { checkedIn: true, checkedInAt: 1699... }
```

### Announcements & reminders

```ts
// Send a message to all registered attendees
await events.sendAnnouncement(event.entityKey, {
  subject: "Event update",
  body: "Don't forget — the event starts at 9 AM sharp!",
});

// Send a reminder to attendees who haven't checked in yet
await events.sendReminder(event.entityKey, {
  body: "Event starts in 1 hour. See you there!",
});
```

### Analytics

```ts
const analytics = await events.getAnalytics(event.entityKey);
// {
//   totalRegistrations: 180,
//   approved: 150,
//   pending: 20,
//   rejected: 10,
//   attended: 120,
//   waitlist: 5,
//   pageViews: 0,
//   revenue: 0,
// }
```

### Calendars & calendar following

```ts
// Create a calendar
const calendar = await events.createCalendar({
  name: "Web3 Events",
  description: "Curated web3 and crypto events",
  isPublic: true,
});

// Update it
await events.updateCalendar(calendar.entityKey, {
  name: "Web3 & Arkiv Events",
});

// Add an event to the calendar
await events.addToCalendar(calendar.entityKey, event.entityKey);

// Follow another user's calendar
await events.followCalendar(calendar.entityKey);

// Unfollow
await events.unfollowCalendar(calendar.entityKey);

// List events in a calendar
const calEvents = await events.listCalendarEvents(calendar.entityKey);

// Remove an event from the calendar
await events.removeFromCalendar(calendar.entityKey, event.entityKey);

// Delete a calendar
await events.deleteCalendar(calendar.entityKey);
```

### Notifications

```ts
// Create a notification for an attendee
const notif = await events.createNotification({
  targetUuid: "attendee-uuid",
  eventKey: event.entityKey,
  type: "event_reminder",
  message: "Your event starts in 30 minutes.",
});

// List unread notifications (recipient side)
const notifications = await events.listNotifications();

// Mark as read
await events.markNotificationRead(notif.entityKey);

// Delete a notification
await events.deleteNotification(notif.entityKey);
```

### Moderation

```ts
// Report a user for inappropriate behavior at an event
await events.reportUser(event.entityKey, {
  targetUuid: "bad-actor-uuid",
  reason: "spam",
  details: "Sent unsolicited messages to other attendees.",
});
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

### `EventClient`

#### Events CRUD & discovery

| Method                                    | Returns                | Description                                  |
| ----------------------------------------- | ---------------------- | -------------------------------------------- |
| `.createEvent(opts)`                      | `Promise<EventData>`   | Create a new event in `draft` status         |
| `.getEvent(entityKey)`                    | `Promise<EventData>`   | Fetch a single event                         |
| `.updateEvent(entityKey, opts)`           | `Promise<EventData>`   | Update event fields                          |
| `.deleteEvent(entityKey)`                 | `Promise<void>`        | Soft-delete an event                         |
| `.cancelEvent(entityKey)`                 | `Promise<EventData>`   | Cancel an event                              |
| `.publishEvent(entityKey)`                | `Promise<EventData>`   | Publish a draft event                        |
| `.unpublishEvent(entityKey)`              | `Promise<EventData>`   | Revert a published event to draft            |
| `.duplicateEvent(entityKey, overrides?)`  | `Promise<EventData>`   | Clone an event as a new draft                |
| `.listEvents(opts?)`                      | `Promise<EventData[]>` | List all events owned by the current user    |
| `.listPublicEvents(opts?)`                | `Promise<EventData[]>` | List all public events on the network        |
| `.listUpcomingEvents(opts?)`              | `Promise<EventData[]>` | List upcoming events for the current user    |
| `.listPastEvents(opts?)`                  | `Promise<EventData[]>` | List past events for the current user        |
| `.searchEvents(query, opts?)`             | `Promise<EventData[]>` | Full-text search over event titles / tags    |
| `.listByCity(city, opts?)`                | `Promise<EventData[]>` | Filter public events by city                 |
| `.listByCategory(category, opts?)`        | `Promise<EventData[]>` | Filter public events by category             |
| `.listTrending(opts?)`                    | `Promise<EventData[]>` | List trending public events                  |
| `.listRecommended(opts?)`                 | `Promise<EventData[]>` | List recommended events for the current user |
| `.uploadEventCover(entityKey, photoPath)` | `Promise<EventData>`   | Upload a cover image                         |
| `.removeEventCover(entityKey)`            | `Promise<EventData>`   | Remove the cover image                       |

#### Agenda

| Method                                      | Returns              | Description           |
| ------------------------------------------- | -------------------- | --------------------- |
| `.addAgendaItem(entityKey, item)`           | `Promise<EventData>` | Add an agenda item    |
| `.updateAgendaItem(entityKey, id, updates)` | `Promise<EventData>` | Update an agenda item |
| `.removeAgendaItem(entityKey, id)`          | `Promise<EventData>` | Remove an agenda item |

#### Organizers & roles

| Method                                            | Returns                     | Description                      |
| ------------------------------------------------- | --------------------------- | -------------------------------- |
| `.addOrganizer(eventKey, uuid, wallet, role?)`    | `Promise<EventOrganizer>`   | Add a co-organizer               |
| `.removeOrganizer(eventKey, organizerKey)`        | `Promise<void>`             | Remove a co-organizer            |
| `.listOrganizers(eventKey)`                       | `Promise<EventOrganizer[]>` | List event organizers            |
| `.changeOrganizerRole(eventKey, organizerKey, r)` | `Promise<EventOrganizer>`   | Change an organizer's role       |
| `.assignRole(eventKey, targetUuid, role)`         | `Promise<EventRole>`        | Assign an arbitrary role         |
| `.removeRole(eventKey, roleKey)`                  | `Promise<void>`             | Remove a role assignment         |
| `.listRoles(eventKey)`                            | `Promise<EventRole[]>`      | List all role assignments        |
| `.checkPermission(eventKey, uuid, permission)`    | `Promise<boolean>`          | Check if a user has a permission |

#### Registration / RSVP

| Method                                            | Returns                 | Description                        |
| ------------------------------------------------- | ----------------------- | ---------------------------------- |
| `.register(eventKey, answers?)`                   | `Promise<RSVPRecord>`   | Register for an event              |
| `.cancelRegistration(eventKey)`                   | `Promise<void>`         | Cancel your own registration       |
| `.approveRegistration(eventKey, rsvpKey)`         | `Promise<RSVPRecord>`   | Approve a pending RSVP (organizer) |
| `.rejectRegistration(eventKey, rsvpKey)`          | `Promise<RSVPRecord>`   | Reject a pending RSVP (organizer)  |
| `.changeRegistrationStatus(eventKey, rsvpKey, s)` | `Promise<RSVPRecord>`   | Set an arbitrary RSVP status       |
| `.markAttendance(eventKey, rsvpKey)`              | `Promise<RSVPRecord>`   | Mark attendance for an RSVP        |
| `.listRegistrations(eventKey, opts?)`             | `Promise<RSVPRecord[]>` | List registrations (organizer)     |
| `.listMyRegistrations(opts?)`                     | `Promise<RSVPRecord[]>` | List current user's RSVPs          |
| `.closeRegistration(eventKey)`                    | `Promise<EventData>`    | Close registration                 |
| `.reopenRegistration(eventKey)`                   | `Promise<EventData>`    | Reopen registration                |
| `.enableManualApproval(eventKey)`                 | `Promise<EventData>`    | Enable manual approval gate        |
| `.disableManualApproval(eventKey)`                | `Promise<EventData>`    | Disable manual approval gate       |

#### Guest list

| Method                                  | Returns                 | Description                    |
| --------------------------------------- | ----------------------- | ------------------------------ |
| `.showAttendeesList(eventKey)`          | `Promise<EventData>`    | Make the attendees list public |
| `.hideAttendeesList(eventKey)`          | `Promise<EventData>`    | Hide the attendees list        |
| `.listAttendees(eventKey, opts?)`       | `Promise<RSVPRecord[]>` | List all attendees             |
| `.searchAttendees(eventKey, query)`     | `Promise<RSVPRecord[]>` | Search attendees by name/UUID  |
| `.removeAttendee(eventKey, targetUuid)` | `Promise<void>`         | Remove an attendee             |

#### Registration questions

| Method                                     | Returns                    | Description              |
| ------------------------------------------ | -------------------------- | ------------------------ |
| `.createQuestion(eventKey, opts)`          | `Promise<EventQuestion>`   | Create a custom question |
| `.updateQuestion(questionKey, updates)`    | `Promise<EventQuestion>`   | Update a question        |
| `.deleteQuestion(questionKey)`             | `Promise<void>`            | Delete a question        |
| `.listQuestions(eventKey)`                 | `Promise<EventQuestion[]>` | List all questions       |
| `.reorderQuestions(eventKey, orderedKeys)` | `Promise<EventQuestion[]>` | Reorder questions        |

#### Ticket types & tickets

| Method                                      | Returns                          | Description                         |
| ------------------------------------------- | -------------------------------- | ----------------------------------- |
| `.createTicketType(eventKey, opts)`         | `Promise<TicketType>`            | Create a ticket type (free or paid) |
| `.updateTicketType(ticketTypeKey, updates)` | `Promise<TicketType>`            | Update a ticket type                |
| `.deleteTicketType(ticketTypeKey)`          | `Promise<void>`                  | Delete a ticket type                |
| `.listTicketTypes(eventKey)`                | `Promise<TicketType[]>`          | List all ticket types               |
| `.purchaseTicket(eventKey, ticketTypeKey)`  | `Promise<TicketRecord>`          | Purchase / claim a ticket           |
| `.cancelTicket(ticketKey)`                  | `Promise<TicketRecord>`          | Cancel a ticket                     |
| `.transferTicket(ticketKey, recipientUuid)` | `Promise<TicketRecord>`          | Transfer a ticket to another user   |
| `.generateTicketQR(ticketKey)`              | `Promise<{ entityKey, qrData }>` | Generate `aside://v1/ticket` QR     |
| `.validateTicketQR(qrData)`                 | `Promise<TicketRecord \| null>`  | Validate and return ticket entity   |
| `.listMyTickets(opts?)`                     | `Promise<TicketRecord[]>`        | List current user's tickets         |
| `.listEventTickets(eventKey, opts?)`        | `Promise<TicketRecord[]>`        | List all tickets for an event       |

#### Discount codes

| Method                                  | Returns                                     | Description             |
| --------------------------------------- | ------------------------------------------- | ----------------------- |
| `.createDiscountCode(eventKey, opts)`   | `Promise<DiscountCode>`                     | Create a discount code  |
| `.validateDiscountCode(eventKey, code)` | `Promise<{ valid, discountPercent, code }>` | Check a discount code   |
| `.deleteDiscountCode(discountKey)`      | `Promise<void>`                             | Delete a discount code  |
| `.listDiscountCodes(eventKey)`          | `Promise<DiscountCode[]>`                   | List all discount codes |

#### Waitlist

| Method                           | Returns                    | Description                      |
| -------------------------------- | -------------------------- | -------------------------------- |
| `.joinWaitlist(eventKey)`        | `Promise<WaitlistEntry>`   | Join the waitlist                |
| `.leaveWaitlist(eventKey)`       | `Promise<void>`            | Leave the waitlist               |
| `.listWaitlist(eventKey)`        | `Promise<WaitlistEntry[]>` | List all waitlist entries        |
| `.promoteFromWaitlist(eventKey)` | `Promise<RSVPRecord>`      | Promote the first waitlist entry |

#### Invitations

| Method                                   | Returns                  | Description                    |
| ---------------------------------------- | ------------------------ | ------------------------------ |
| `.inviteByEmail(eventKey, email, opts?)` | `Promise<EventInvite>`   | Invite one person by e-mail    |
| `.inviteList(eventKey, invitees)`        | `Promise<EventInvite[]>` | Bulk invite                    |
| `.resendInvite(inviteKey)`               | `Promise<EventInvite>`   | Resend an invitation           |
| `.cancelInvite(inviteKey)`               | `Promise<void>`          | Cancel an invitation           |
| `.listInvites(eventKey)`                 | `Promise<EventInvite[]>` | List all invitations           |
| `.acceptInvite(inviteKey)`               | `Promise<EventInvite>`   | Accept an invitation (invitee) |
| `.rejectInvite(inviteKey)`               | `Promise<EventInvite>`   | Reject an invitation (invitee) |

#### Check-in

| Method                                    | Returns                                | Description                    |
| ----------------------------------------- | -------------------------------------- | ------------------------------ |
| `.checkinByQR(eventKey, qrData)`          | `Promise<CheckinRecord>`               | Check in by scanning ticket QR |
| `.checkinByEmail(eventKey, email)`        | `Promise<CheckinRecord>`               | Check in by email lookup       |
| `.checkinManual(eventKey, targetUuid)`    | `Promise<CheckinRecord>`               | Manual check-in by UUID        |
| `.undoCheckin(eventKey, checkinKey)`      | `Promise<void>`                        | Undo a check-in                |
| `.listCheckins(eventKey, opts?)`          | `Promise<CheckinRecord[]>`             | List all check-ins             |
| `.getCheckinStatus(eventKey, targetUuid)` | `Promise<{ checkedIn, checkedInAt? }>` | Get check-in status            |

#### Communication & analytics

| Method                              | Returns                   | Description                                 |
| ----------------------------------- | ------------------------- | ------------------------------------------- |
| `.sendAnnouncement(eventKey, opts)` | `Promise<void>`           | Send a message to all registered attendees  |
| `.sendReminder(eventKey, opts)`     | `Promise<void>`           | Send a reminder to non-checked-in attendees |
| `.getAnalytics(eventKey)`           | `Promise<EventAnalytics>` | Get registration & attendance analytics     |

#### Calendars

| Method                                       | Returns                       | Description                     |
| -------------------------------------------- | ----------------------------- | ------------------------------- |
| `.createCalendar(opts)`                      | `Promise<EventCalendar>`      | Create a new calendar           |
| `.updateCalendar(calendarKey, updates)`      | `Promise<EventCalendar>`      | Update a calendar               |
| `.deleteCalendar(calendarKey)`               | `Promise<void>`               | Delete a calendar               |
| `.addToCalendar(calendarKey, eventKey)`      | `Promise<EventCalendarEntry>` | Add an event to a calendar      |
| `.removeFromCalendar(calendarKey, eventKey)` | `Promise<void>`               | Remove an event from a calendar |
| `.followCalendar(calendarKey)`               | `Promise<void>`               | Follow another user's calendar  |
| `.unfollowCalendar(calendarKey)`             | `Promise<void>`               | Unfollow a calendar             |
| `.listCalendarEvents(calendarKey)`           | `Promise<EventData[]>`        | List events in a calendar       |

#### Notifications & moderation

| Method                            | Returns                        | Description                       |
| --------------------------------- | ------------------------------ | --------------------------------- |
| `.createNotification(opts)`       | `Promise<EventNotification>`   | Create an in-app notification     |
| `.listNotifications(opts?)`       | `Promise<EventNotification[]>` | List current user's notifications |
| `.markNotificationRead(notifKey)` | `Promise<EventNotification>`   | Mark a notification as read       |
| `.deleteNotification(notifKey)`   | `Promise<void>`                | Delete a notification             |
| `.reportUser(eventKey, opts)`     | `Promise<void>`                | Report a user for moderation      |

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
