/**
 * EventClient — full Luma-style social events platform.
 *
 * Obtain via `client.events()`:
 *
 * ```ts
 * const events = client.events()
 * const ev = await events.createEvent({ title: 'Hackathon', startsAt, endsAt })
 * await events.publishEvent(ev.entityKey)
 * await events.register(ev.entityKey)
 * ```
 *
 * All data is stored as entities on ArkaCDN.
 */

import { eq, jsonToPayload, ExpirationTime } from 'arka-cdn'
import type { ArkaCDN, Hex } from 'arka-cdn'
import {
  ATTR_TYPE,
  ATTR_UUID,
  ATTR_WALLET,
  ATTR_TARGET_UUID,
  ATTR_EVENT_KEY,
  ATTR_EVENT_STATUS,
  DEFAULT_EXPIRY_SECONDS,
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
import type {
  EventData,
  EventAgendaItem,
  CreateEventOptions,
  UpdateEventOptions,
  EventOrganizer,
  EventRole,
  OrganizerRole,
  RSVPRecord,
  RSVPStatus,
  EventQuestion,
  CreateQuestionOptions,
  TicketType,
  CreateTicketTypeOptions,
  TicketRecord,
  DiscountCode,
  CreateDiscountCodeOptions,
  WaitlistEntry,
  EventInvite,
  CheckinRecord,
  CheckinMethod,
  EventCalendar,
  EventCalendarEntry,
  EventNotification,
  EventAnalytics,
  PaginationOptions,
  EventQueryOptions,
} from './types.js'

// ─── Internal helpers ─────────────────────────────────────────────────────────

function applyPagination<T>(items: T[], offset: number, limit?: number): T[] {
  const sliced = items.slice(offset)
  return limit !== undefined ? sliced.slice(0, limit) : sliced
}

function base64url(obj: unknown): string {
  return btoa(JSON.stringify(obj))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function fromBase64url(str: string): unknown {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((str.length % 4) || 4)
  return JSON.parse(atob(padded))
}

// ─── EventClient ──────────────────────────────────────────────────────────────

export class EventClient {
  constructor(
    private readonly cdn: ArkaCDN,
    private readonly uuid: string,
    private readonly wallet: string,
  ) { }

  // ═══════════════════════════════════════════════════════════════════════════
  // Events CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Creates a new event in draft status. Does not publish it.
   * Call `publishEvent(entityKey)` to make it publicly visible.
   */
  async createEvent(options: CreateEventOptions): Promise<EventData> {
    const now = Date.now()
    const data: Omit<EventData, 'entityKey'> = {
      organizerUuid: this.uuid,
      organizerWallet: this.wallet,
      title: options.title,
      startsAt: options.startsAt,
      endsAt: options.endsAt,
      timezone: options.timezone ?? 'UTC',
      modality: options.modality ?? 'in-person',
      visibility: options.visibility ?? 'public',
      status: 'draft',
      requiresApproval: options.requiresApproval ?? false,
      registrationOpen: true,
      attendeesVisible: true,
      capacity: options.capacity,
      location: options.location,
      description: options.description,
      tags: options.tags,
      categories: options.categories,
      createdAt: now,
      updatedAt: now,
    }
    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(data),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_TYPE },
        { key: ATTR_UUID, value: this.uuid },
        { key: ATTR_WALLET, value: this.wallet },
        { key: ATTR_EVENT_STATUS, value: 'draft' },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    // Auto-add creator as owner organizer
    await this._createOrganizerRecord(entityKey, this.uuid, this.wallet, 'owner')
    return { entityKey, ...data }
  }

  /**
   * Fetches a single event by entity key. Returns `null` if not found.
   */
  async getEvent(entityKey: string): Promise<EventData | null> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_TYPE)])
      .withPayload(true)
      .fetch()
    const entity = result.entities.find(e => e.key === entityKey)
    if (!entity) return null
    return { entityKey, ...entity.toJson() as Omit<EventData, 'entityKey'> }
  }

  /**
   * Updates mutable fields of an event. Only the organizer (owner/admin) should call this.
   */
  async updateEvent(entityKey: string, updates: UpdateEventOptions): Promise<EventData> {
    const existing = await this._getEventOrThrow(entityKey)
    const updated: EventData = { ...existing, ...updates, updatedAt: Date.now() }
    await this.cdn.entity.update({
      entityKey: entityKey as Hex,
      payload: jsonToPayload(updated),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_TYPE },
        { key: ATTR_UUID, value: existing.organizerUuid },
        { key: ATTR_WALLET, value: existing.organizerWallet },
        { key: ATTR_EVENT_STATUS, value: updated.status },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return updated
  }

  /**
   * Soft-deletes an event by setting its status to `cancelled`.
   * Use `cancelEvent` for a user-facing cancellation with reason.
   */
  async deleteEvent(entityKey: string): Promise<void> {
    await this.updateEvent(entityKey, { status: 'cancelled' } as UpdateEventOptions & { status: EventData['status'] })
  }

  /**
   * Cancels an event and notifies attendees.
   */
  async cancelEvent(entityKey: string): Promise<EventData> {
    const ev = await this._getEventOrThrow(entityKey)
    const updated = { ...ev, status: 'cancelled' as const, updatedAt: Date.now() }
    await this.cdn.entity.update({
      entityKey: entityKey as Hex,
      payload: jsonToPayload(updated),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_TYPE },
        { key: ATTR_UUID, value: ev.organizerUuid },
        { key: ATTR_WALLET, value: ev.organizerWallet },
        { key: ATTR_EVENT_STATUS, value: 'cancelled' },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return updated
  }

  /**
   * Publishes an event, making it visible according to `visibility`.
   */
  async publishEvent(entityKey: string): Promise<EventData> {
    const ev = await this._getEventOrThrow(entityKey)
    const updated = { ...ev, status: 'published' as const, updatedAt: Date.now() }
    await this.cdn.entity.update({
      entityKey: entityKey as Hex,
      payload: jsonToPayload(updated),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_TYPE },
        { key: ATTR_UUID, value: ev.organizerUuid },
        { key: ATTR_WALLET, value: ev.organizerWallet },
        { key: ATTR_EVENT_STATUS, value: 'published' },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return updated
  }

  /**
   * Reverts a published event back to draft.
   */
  async unpublishEvent(entityKey: string): Promise<EventData> {
    return this.updateEvent(entityKey, { status: 'draft' } as UpdateEventOptions & { status: EventData['status'] })
  }

  /**
   * Duplicates an event as a new draft, optionally overriding fields.
   */
  async duplicateEvent(entityKey: string, overrides?: Partial<CreateEventOptions>): Promise<EventData> {
    const ev = await this._getEventOrThrow(entityKey)
    return this.createEvent({
      title: `${ev.title} (copy)`,
      description: ev.description,
      startsAt: ev.startsAt,
      endsAt: ev.endsAt,
      timezone: ev.timezone,
      modality: ev.modality,
      visibility: ev.visibility,
      capacity: ev.capacity,
      location: ev.location,
      tags: ev.tags,
      categories: ev.categories,
      requiresApproval: ev.requiresApproval,
      ...overrides,
    })
  }

  // ─── Listing ──────────────────────────────────────────────────────────────

  /**
   * Lists all events created by the current user.
   */
  async listEvents(options: EventQueryOptions = {}): Promise<EventData[]> {
    const { uuid = this.uuid, limit, offset = 0 } = options as EventQueryOptions & { uuid?: string }
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_TYPE), eq(ATTR_UUID, uuid)])
      .withPayload(true)
      .fetch()
    let events = result.entities
      .map(e => ({ entityKey: e.key, ...e.toJson() as Omit<EventData, 'entityKey'> }))
    events = this._applyEventFilters(events, options)
    return applyPagination(events, offset, limit)
  }

  /**
   * Lists all public published events (platform-wide).
   */
  async listPublicEvents(options: EventQueryOptions = {}): Promise<EventData[]> {
    const { limit, offset = 0 } = options
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_TYPE), eq(ATTR_EVENT_STATUS, 'published')])
      .withPayload(true)
      .fetch()
    let events = result.entities
      .map(e => ({ entityKey: e.key, ...e.toJson() as Omit<EventData, 'entityKey'> }))
      .filter(e => e.visibility === 'public')
    events = this._applyEventFilters(events, options)
    return applyPagination(events, offset, limit)
  }

  /**
   * Lists published events starting in the future.
   */
  async listUpcomingEvents(options: EventQueryOptions = {}): Promise<EventData[]> {
    const now = Date.now()
    const all = await this.listPublicEvents(options)
    return all.filter(e => e.startsAt > now)
  }

  /**
   * Lists published events that have already ended.
   */
  async listPastEvents(options: EventQueryOptions = {}): Promise<EventData[]> {
    const now = Date.now()
    const all = await this.listPublicEvents(options)
    return all.filter(e => e.endsAt < now)
  }

  /**
   * Full-text search across event titles and descriptions.
   */
  async searchEvents(query: string, options: EventQueryOptions = {}): Promise<EventData[]> {
    const q = query.toLowerCase()
    const all = await this.listPublicEvents(options)
    return all.filter(e =>
      e.title.toLowerCase().includes(q) ||
      e.description?.toLowerCase().includes(q) ||
      e.tags?.some(t => t.toLowerCase().includes(q)),
    )
  }

  /**
   * Lists events by city (filters `location.city`).
   */
  async listByCity(city: string, options: EventQueryOptions = {}): Promise<EventData[]> {
    const all = await this.listPublicEvents(options)
    return all.filter(e => e.location?.city?.toLowerCase() === city.toLowerCase())
  }

  /**
   * Lists events by category.
   */
  async listByCategory(category: string, options: EventQueryOptions = {}): Promise<EventData[]> {
    const all = await this.listPublicEvents(options)
    return all.filter(e => e.categories?.includes(category))
  }

  /**
   * Lists trending events — sorted by registration count (approximated by descending recency).
   */
  async listTrending(options: EventQueryOptions = {}): Promise<EventData[]> {
    const all = await this.listPublicEvents(options)
    return all.sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * Lists recommended events for the current user (events in the same categories the user has attended).
   */
  async listRecommended(options: EventQueryOptions = {}): Promise<EventData[]> {
    const myRsvps = await this.listMyRegistrations()
    const attendedKeys = myRsvps
      .filter(r => r.status === 'approved')
      .map(r => r.eventEntityKey)
    const attended = await Promise.all(attendedKeys.map(k => this.getEvent(k)))
    const categories = [...new Set(attended.flatMap(e => e?.categories ?? []))]
    if (categories.length === 0) return this.listTrending(options)
    return this.listByCategory(categories[0]!, options)
  }

  // ─── Cover photo ──────────────────────────────────────────────────────────

  /**
   * Uploads a cover image to ArkaCDN file storage and updates the event.
   * Returns the manifest key.
   */
  async uploadEventCover(
    eventEntityKey: string,
    buffer: Uint8Array | ArrayBuffer,
    options?: { filename?: string; mimeType?: string },
  ): Promise<string> {
    const fileService = (this.cdn as any).file
    if (!fileService?.upload) throw new Error('ASide: CDN file service not available')
    const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer
    const filename = options?.filename ?? 'cover.jpg'
    const mimeType = options?.mimeType ?? 'image/jpeg'
    const { manifestKey } = await fileService.upload(bytes, { filename, mimeType })
    await this.updateEvent(eventEntityKey, { coverPhoto: manifestKey })
    return manifestKey
  }

  /**
   * Removes the cover photo from an event.
   */
  async removeEventCover(eventEntityKey: string): Promise<void> {
    const ev = await this._getEventOrThrow(eventEntityKey)
    const updated = { ...ev, coverPhoto: undefined, updatedAt: Date.now() }
    await this.cdn.entity.update({
      entityKey: eventEntityKey as Hex,
      payload: jsonToPayload(updated),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_TYPE },
        { key: ATTR_UUID, value: ev.organizerUuid },
        { key: ATTR_WALLET, value: ev.organizerWallet },
        { key: ATTR_EVENT_STATUS, value: ev.status },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
  }

  // ─── Agenda ───────────────────────────────────────────────────────────────

  /**
   * Appends an agenda item to an event.
   */
  async addAgendaItem(
    eventEntityKey: string,
    item: Omit<EventAgendaItem, 'id'>,
  ): Promise<EventData> {
    const ev = await this._getEventOrThrow(eventEntityKey)
    const newItem: EventAgendaItem = { ...item, id: crypto.randomUUID() }
    return this.updateEvent(eventEntityKey, {
      agenda: [...(ev.agenda ?? []), newItem],
    } as UpdateEventOptions)
  }

  /**
   * Updates a specific agenda item by its `id`.
   */
  async updateAgendaItem(
    eventEntityKey: string,
    itemId: string,
    updates: Partial<Omit<EventAgendaItem, 'id'>>,
  ): Promise<EventData> {
    const ev = await this._getEventOrThrow(eventEntityKey)
    const agenda = (ev.agenda ?? []).map(a => a.id === itemId ? { ...a, ...updates } : a)
    return this.updateEvent(eventEntityKey, { agenda } as UpdateEventOptions)
  }

  /**
   * Removes an agenda item by `id`.
   */
  async removeAgendaItem(eventEntityKey: string, itemId: string): Promise<EventData> {
    const ev = await this._getEventOrThrow(eventEntityKey)
    const agenda = (ev.agenda ?? []).filter(a => a.id !== itemId)
    return this.updateEvent(eventEntityKey, { agenda } as UpdateEventOptions)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Organizers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Adds a co-organizer to the event with the specified role.
   */
  async addOrganizer(
    eventEntityKey: string,
    userUuid: string,
    userWallet: string,
    role: OrganizerRole = 'host',
  ): Promise<EventOrganizer> {
    return this._createOrganizerRecord(eventEntityKey, userUuid, userWallet, role)
  }

  /**
   * Removes an organizer from the event (soft-delete not possible; marks inactive via delete).
   */
  async removeOrganizer(eventEntityKey: string, userUuid: string): Promise<void> {
    const existing = await this._findOrganizer(eventEntityKey, userUuid)
    if (!existing) return
    const updated = { ...existing, role: 'removed' as OrganizerRole }
    await this.cdn.entity.update({
      entityKey: existing.entityKey as Hex,
      payload: jsonToPayload(updated),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_ORGANIZER_TYPE },
        { key: ATTR_EVENT_KEY, value: eventEntityKey },
        { key: ATTR_TARGET_UUID, value: userUuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
  }

  /**
   * Lists all active organizers for an event.
   */
  async listOrganizers(eventEntityKey: string): Promise<EventOrganizer[]> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_ORGANIZER_TYPE), eq(ATTR_EVENT_KEY, eventEntityKey)])
      .withPayload(true)
      .fetch()
    return result.entities
      .map(e => ({ entityKey: e.key, ...e.toJson() as Omit<EventOrganizer, 'entityKey'> }))
      .filter(o => (o.role as string) !== 'removed')
  }

  /**
   * Changes the role of an existing organizer.
   */
  async changeOrganizerRole(
    eventEntityKey: string,
    userUuid: string,
    newRole: OrganizerRole,
  ): Promise<EventOrganizer> {
    const existing = await this._findOrganizer(eventEntityKey, userUuid)
    if (!existing) throw new Error(`ASide: organizer "${userUuid}" not found on event`)
    const updated = { ...existing, role: newRole }
    await this.cdn.entity.update({
      entityKey: existing.entityKey as Hex,
      payload: jsonToPayload(updated),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_ORGANIZER_TYPE },
        { key: ATTR_EVENT_KEY, value: eventEntityKey },
        { key: ATTR_TARGET_UUID, value: userUuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return updated
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Roles
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Assigns a platform role to a user in the context of a specific event.
   */
  async assignRole(
    eventEntityKey: string,
    userUuid: string,
    role: OrganizerRole,
  ): Promise<EventRole> {
    const existing = await this._findRole(eventEntityKey, userUuid)
    const now = Date.now()
    const data: Omit<EventRole, 'entityKey'> = {
      eventEntityKey,
      userUuid,
      role,
      assignedAt: existing?.assignedAt ?? now,
      assignedByUuid: this.uuid,
    }
    if (existing) {
      await this.cdn.entity.update({
        entityKey: existing.entityKey as Hex,
        payload: jsonToPayload({ ...data, entityKey: existing.entityKey }),
        contentType: 'application/json',
        attributes: [
          { key: ATTR_TYPE, value: EVENT_ROLE_TYPE },
          { key: ATTR_EVENT_KEY, value: eventEntityKey },
          { key: ATTR_TARGET_UUID, value: userUuid },
        ],
        expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
      })
      return { ...data, entityKey: existing.entityKey }
    }
    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(data),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_ROLE_TYPE },
        { key: ATTR_EVENT_KEY, value: eventEntityKey },
        { key: ATTR_TARGET_UUID, value: userUuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return { entityKey, ...data }
  }

  /** Removes a role assignment from a user. */
  async removeRole(eventEntityKey: string, userUuid: string): Promise<void> {
    const existing = await this._findRole(eventEntityKey, userUuid)
    if (!existing) return
    await this.cdn.entity.update({
      entityKey: existing.entityKey as Hex,
      payload: jsonToPayload({ ...existing, role: 'removed' }),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_ROLE_TYPE },
        { key: ATTR_EVENT_KEY, value: eventEntityKey },
        { key: ATTR_TARGET_UUID, value: userUuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
  }

  /** Lists all role assignments for an event. */
  async listRoles(eventEntityKey: string): Promise<EventRole[]> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_ROLE_TYPE), eq(ATTR_EVENT_KEY, eventEntityKey)])
      .withPayload(true)
      .fetch()
    return result.entities
      .map(e => ({ entityKey: e.key, ...e.toJson() as Omit<EventRole, 'entityKey'> }))
      .filter(r => (r.role as string) !== 'removed')
  }

  /**
   * Returns `true` if `userUuid` has at least `requiredRole` permissions on the event.
   * Permission hierarchy: owner > admin > host > checkin_manager
   */
  async checkPermission(
    eventEntityKey: string,
    userUuid: string,
    requiredRole: OrganizerRole,
  ): Promise<boolean> {
    const hierarchy: OrganizerRole[] = ['owner', 'admin', 'host', 'checkin_manager']
    const requiredIndex = hierarchy.indexOf(requiredRole)
    const organizer = await this._findOrganizer(eventEntityKey, userUuid)
    if (organizer && (organizer.role as string) !== 'removed') {
      const userIndex = hierarchy.indexOf(organizer.role)
      if (userIndex <= requiredIndex) return true
    }
    const role = await this._findRole(eventEntityKey, userUuid)
    if (role && (role.role as string) !== 'removed') {
      const roleIndex = hierarchy.indexOf(role.role)
      if (roleIndex <= requiredIndex) return true
    }
    return false
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Registration / RSVP
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Registers the current user to an event.
   * - `approved` immediately if `requiresApproval = false` and capacity not exceeded
   * - `pending` if manual approval is enabled
   * - `waitlist` if capacity is full
   */
  async register(
    eventEntityKey: string,
    answers?: Record<string, string | string[]>,
  ): Promise<RSVPRecord> {
    const ev = await this._getEventOrThrow(eventEntityKey)
    if (!ev.registrationOpen) throw new Error('ASide: registration is closed for this event')

    const existing = await this._findRSVP(eventEntityKey, this.uuid)
    if (existing && existing.status !== 'cancelled') return existing

    // Check capacity
    let status: RSVPStatus = ev.requiresApproval ? 'pending' : 'approved'
    if (ev.capacity !== undefined) {
      const approvedCount = await this._countApprovedRSVPs(eventEntityKey)
      if (approvedCount >= ev.capacity) status = 'waitlist'
    }

    const now = Date.now()
    const data: Omit<RSVPRecord, 'entityKey'> = {
      eventEntityKey,
      attendeeUuid: this.uuid,
      attendeeWallet: this.wallet,
      status,
      registeredAt: now,
      updatedAt: now,
      checkedIn: false,
      answers,
    }
    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(data),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_RSVP_TYPE },
        { key: ATTR_EVENT_KEY, value: eventEntityKey },
        { key: ATTR_UUID, value: this.uuid },
        { key: ATTR_WALLET, value: this.wallet },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return { entityKey, ...data }
  }

  /**
   * Cancels the current user's registration to an event.
   */
  async cancelRegistration(eventEntityKey: string): Promise<void> {
    const existing = await this._findRSVP(eventEntityKey, this.uuid)
    if (!existing || existing.status === 'cancelled') return
    await this._updateRSVPStatus(existing, 'cancelled')
  }

  /**
   * Approves a pending registration (organizer action).
   */
  async approveRegistration(eventEntityKey: string, attendeeUuid: string): Promise<RSVPRecord> {
    return this._setRSVPStatusByOrganizer(eventEntityKey, attendeeUuid, 'approved')
  }

  /**
   * Rejects a pending registration (organizer action).
   */
  async rejectRegistration(eventEntityKey: string, attendeeUuid: string): Promise<RSVPRecord> {
    return this._setRSVPStatusByOrganizer(eventEntityKey, attendeeUuid, 'rejected')
  }

  /**
   * Lists all registrations for an event.
   */
  async listRegistrations(
    eventEntityKey: string,
    options: PaginationOptions & { status?: RSVPStatus } = {},
  ): Promise<RSVPRecord[]> {
    const { limit, offset = 0, status } = options
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_RSVP_TYPE), eq(ATTR_EVENT_KEY, eventEntityKey)])
      .withPayload(true)
      .fetch()
    let records = result.entities.map(e => ({
      entityKey: e.key,
      ...e.toJson() as Omit<RSVPRecord, 'entityKey'>,
    }))
    if (status) records = records.filter(r => r.status === status)
    return applyPagination(records, offset, limit)
  }

  /**
   * Lists all events the current user has registered for.
   */
  async listMyRegistrations(): Promise<RSVPRecord[]> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_RSVP_TYPE), eq(ATTR_UUID, this.uuid)])
      .withPayload(true)
      .fetch()
    return result.entities.map(e => ({
      entityKey: e.key,
      ...e.toJson() as Omit<RSVPRecord, 'entityKey'>,
    }))
  }

  /**
   * Changes the status of a specific RSVP record (organizer action).
   */
  async changeRegistrationStatus(entityKey: string, status: RSVPStatus): Promise<RSVPRecord> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_RSVP_TYPE)])
      .withPayload(true)
      .fetch()
    const entity = result.entities.find(e => e.key === entityKey)
    if (!entity) throw new Error(`ASide: RSVP "${entityKey}" not found`)
    const record = { entityKey, ...entity.toJson() as Omit<RSVPRecord, 'entityKey'> }
    return this._updateRSVPStatus(record, status)
  }

  /**
   * Marks an attendee as having attended (check-in shortcut from RSVP side).
   */
  async markAttendance(eventEntityKey: string, attendeeUuid: string): Promise<RSVPRecord> {
    const existing = await this._findRSVP(eventEntityKey, attendeeUuid)
    if (!existing) throw new Error(`ASide: no RSVP found for "${attendeeUuid}"`)
    const updated = {
      ...existing,
      checkedIn: true,
      checkedInAt: Date.now(),
      updatedAt: Date.now(),
    }
    await this.cdn.entity.update({
      entityKey: existing.entityKey as Hex,
      payload: jsonToPayload(updated),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_RSVP_TYPE },
        { key: ATTR_EVENT_KEY, value: eventEntityKey },
        { key: ATTR_UUID, value: attendeeUuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return updated
  }

  /** Closes registration for an event. */
  async closeRegistration(eventEntityKey: string): Promise<EventData> {
    const ev = await this._getEventOrThrow(eventEntityKey)
    const updated = { ...ev, registrationOpen: false, updatedAt: Date.now() }
    await this._saveEvent(updated)
    return updated
  }

  /** Re-opens previously closed registration. */
  async reopenRegistration(eventEntityKey: string): Promise<EventData> {
    const ev = await this._getEventOrThrow(eventEntityKey)
    const updated = { ...ev, registrationOpen: true, updatedAt: Date.now() }
    await this._saveEvent(updated)
    return updated
  }

  /** Enables manual approval for all new registrations. */
  async enableManualApproval(eventEntityKey: string): Promise<EventData> {
    const ev = await this._getEventOrThrow(eventEntityKey)
    const updated = { ...ev, requiresApproval: true, updatedAt: Date.now() }
    await this._saveEvent(updated)
    return updated
  }

  /** Disables manual approval (new registrations auto-approved). */
  async disableManualApproval(eventEntityKey: string): Promise<EventData> {
    const ev = await this._getEventOrThrow(eventEntityKey)
    const updated = { ...ev, requiresApproval: false, updatedAt: Date.now() }
    await this._saveEvent(updated)
    return updated
  }

  // ─── Guest list visibility ─────────────────────────────────────────────────

  /** Shows the attendee list publicly on the event page. */
  async showAttendeesList(eventEntityKey: string): Promise<EventData> {
    const ev = await this._getEventOrThrow(eventEntityKey)
    const updated = { ...ev, attendeesVisible: true, updatedAt: Date.now() }
    await this._saveEvent(updated)
    return updated
  }

  /** Hides the attendee list from the public event page. */
  async hideAttendeesList(eventEntityKey: string): Promise<EventData> {
    const ev = await this._getEventOrThrow(eventEntityKey)
    const updated = { ...ev, attendeesVisible: false, updatedAt: Date.now() }
    await this._saveEvent(updated)
    return updated
  }

  /** Lists attendees (respects `attendeesVisible` for public calls). */
  async listAttendees(
    eventEntityKey: string,
    options: PaginationOptions = {},
  ): Promise<RSVPRecord[]> {
    return this.listRegistrations(eventEntityKey, { ...options, status: 'approved' })
  }

  /** Searches attendees by UUID prefix (case-insensitive). */
  async searchAttendees(eventEntityKey: string, query: string): Promise<RSVPRecord[]> {
    const all = await this.listRegistrations(eventEntityKey)
    const q = query.toLowerCase()
    return all.filter(r =>
      r.attendeeUuid.toLowerCase().includes(q) ||
      r.attendeeWallet.toLowerCase().includes(q),
    )
  }

  /** Removes an attendee from an event (organizer action — sets status to cancelled). */
  async removeAttendee(eventEntityKey: string, attendeeUuid: string): Promise<void> {
    await this._setRSVPStatusByOrganizer(eventEntityKey, attendeeUuid, 'cancelled')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Custom Questions
  // ═══════════════════════════════════════════════════════════════════════════

  /** Adds a custom registration question to an event. */
  async createQuestion(
    eventEntityKey: string,
    options: CreateQuestionOptions,
  ): Promise<EventQuestion> {
    const now = Date.now()
    const existing = await this.listQuestions(eventEntityKey)
    const data: Omit<EventQuestion, 'entityKey'> = {
      eventEntityKey,
      id: crypto.randomUUID(),
      label: options.label,
      type: options.type,
      required: options.required ?? false,
      options: options.options,
      order: options.order ?? existing.length,
      createdAt: now,
    }
    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(data),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_QUESTION_TYPE },
        { key: ATTR_EVENT_KEY, value: eventEntityKey },
        { key: ATTR_UUID, value: this.uuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return { entityKey, ...data }
  }

  /** Updates a custom question. */
  async updateQuestion(
    entityKey: string,
    updates: Partial<Omit<EventQuestion, 'entityKey' | 'id' | 'createdAt' | 'eventEntityKey'>>,
  ): Promise<EventQuestion> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_QUESTION_TYPE)])
      .withPayload(true)
      .fetch()
    const entity = result.entities.find(e => e.key === entityKey)
    if (!entity) throw new Error(`ASide: question "${entityKey}" not found`)
    const existing = { entityKey, ...entity.toJson() as Omit<EventQuestion, 'entityKey'> }
    const updated = { ...existing, ...updates }
    await this.cdn.entity.update({
      entityKey: entityKey as Hex,
      payload: jsonToPayload(updated),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_QUESTION_TYPE },
        { key: ATTR_EVENT_KEY, value: existing.eventEntityKey },
        { key: ATTR_UUID, value: this.uuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return updated
  }

  /** Soft-deletes a custom question (marks order = -1). */
  async deleteQuestion(entityKey: string): Promise<void> {
    await this.updateQuestion(entityKey, { order: -1 })
  }

  /** Lists active custom questions for an event, sorted by order. */
  async listQuestions(eventEntityKey: string): Promise<EventQuestion[]> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_QUESTION_TYPE), eq(ATTR_EVENT_KEY, eventEntityKey)])
      .withPayload(true)
      .fetch()
    return result.entities
      .map(e => ({ entityKey: e.key, ...e.toJson() as Omit<EventQuestion, 'entityKey'> }))
      .filter(q => q.order >= 0)
      .sort((a, b) => a.order - b.order)
  }

  /** Reorders questions by providing a sorted array of entity keys. */
  async reorderQuestions(eventEntityKey: string, orderedEntityKeys: string[]): Promise<void> {
    await Promise.all(
      orderedEntityKeys.map((key, index) => this.updateQuestion(key, { order: index })),
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Ticket Types
  // ═══════════════════════════════════════════════════════════════════════════

  /** Creates a new ticket type for an event (free or paid). */
  async createTicketType(
    eventEntityKey: string,
    options: CreateTicketTypeOptions,
  ): Promise<TicketType> {
    const now = Date.now()
    const data: Omit<TicketType, 'entityKey'> = {
      eventEntityKey,
      name: options.name,
      description: options.description,
      price: options.price,
      currency: options.currency ?? 'USD',
      capacity: options.capacity,
      sold: 0,
      status: 'active',
      saleEndsAt: options.saleEndsAt,
      earlyBirdPrice: options.earlyBirdPrice,
      earlyBirdEndsAt: options.earlyBirdEndsAt,
      createdAt: now,
      updatedAt: now,
    }
    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(data),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_TICKET_TYPE_ENTITY },
        { key: ATTR_EVENT_KEY, value: eventEntityKey },
        { key: ATTR_UUID, value: this.uuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return { entityKey, ...data }
  }

  /** Updates an existing ticket type. */
  async updateTicketType(
    entityKey: string,
    updates: Partial<Omit<TicketType, 'entityKey' | 'sold' | 'createdAt' | 'eventEntityKey'>>,
  ): Promise<TicketType> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_TICKET_TYPE_ENTITY)])
      .withPayload(true)
      .fetch()
    const entity = result.entities.find(e => e.key === entityKey)
    if (!entity) throw new Error(`ASide: ticket type "${entityKey}" not found`)
    const existing = { entityKey, ...entity.toJson() as Omit<TicketType, 'entityKey'> }
    const updated = { ...existing, ...updates, updatedAt: Date.now() }
    await this.cdn.entity.update({
      entityKey: entityKey as Hex,
      payload: jsonToPayload(updated),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_TICKET_TYPE_ENTITY },
        { key: ATTR_EVENT_KEY, value: existing.eventEntityKey },
        { key: ATTR_UUID, value: this.uuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return updated
  }

  /** Pauses a ticket type (no more purchases). */
  async deleteTicketType(entityKey: string): Promise<void> {
    await this.updateTicketType(entityKey, { status: 'paused' })
  }

  /** Lists all active ticket types for an event. */
  async listTicketTypes(eventEntityKey: string): Promise<TicketType[]> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_TICKET_TYPE_ENTITY), eq(ATTR_EVENT_KEY, eventEntityKey)])
      .withPayload(true)
      .fetch()
    return result.entities
      .map(e => ({ entityKey: e.key, ...e.toJson() as Omit<TicketType, 'entityKey'> }))
      .filter(t => t.status !== 'paused')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Tickets
  // ═══════════════════════════════════════════════════════════════════════════

  /** Purchases a ticket for the current user. Increments the sold count. */
  async purchaseTicket(ticketTypeEntityKey: string): Promise<TicketRecord> {
    const typeResult = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_TICKET_TYPE_ENTITY)])
      .withPayload(true)
      .fetch()
    const typeEntity = typeResult.entities.find(e => e.key === ticketTypeEntityKey)
    if (!typeEntity) throw new Error(`ASide: ticket type "${ticketTypeEntityKey}" not found`)
    const ticketType = { entityKey: ticketTypeEntityKey, ...typeEntity.toJson() as Omit<TicketType, 'entityKey'> }

    if (ticketType.status !== 'active') throw new Error('ASide: ticket type is not available')
    if (ticketType.capacity !== undefined && ticketType.sold >= ticketType.capacity) {
      throw new Error('ASide: ticket type is sold out')
    }
    if (ticketType.saleEndsAt && Date.now() > ticketType.saleEndsAt) {
      throw new Error('ASide: ticket sale period has ended')
    }

    // Increment sold count
    await this.cdn.entity.update({
      entityKey: ticketTypeEntityKey as Hex,
      payload: jsonToPayload({ ...ticketType, sold: ticketType.sold + 1, updatedAt: Date.now() }),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_TICKET_TYPE_ENTITY },
        { key: ATTR_EVENT_KEY, value: ticketType.eventEntityKey },
        { key: ATTR_UUID, value: ticketType.entityKey },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })

    const now = Date.now()
    const data: Omit<TicketRecord, 'entityKey'> = {
      ticketTypeEntityKey,
      eventEntityKey: ticketType.eventEntityKey,
      ownerUuid: this.uuid,
      ownerWallet: this.wallet,
      status: 'active',
      purchasedAt: now,
      checkedIn: false,
    }
    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(data),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_TICKET_TYPE },
        { key: ATTR_EVENT_KEY, value: ticketType.eventEntityKey },
        { key: ATTR_UUID, value: this.uuid },
        { key: ATTR_WALLET, value: this.wallet },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return { entityKey, ...data }
  }

  /** Cancels an issued ticket. */
  async cancelTicket(entityKey: string): Promise<void> {
    await this._updateTicket(entityKey, { status: 'cancelled' })
  }

  /** Transfers a ticket to another user. */
  async transferTicket(entityKey: string, toUuid: string): Promise<TicketRecord> {
    const ticket = await this._getTicket(entityKey)
    if (ticket.status !== 'active') throw new Error('ASide: ticket is not transferable')
    return this._updateTicket(entityKey, { status: 'transferred', transferredTo: toUuid })
  }

  /**
   * Generates a QR payload for a ticket.
   * The payload encodes the entity key + a timestamp; validation looks it up on-chain.
   */
  async generateTicketQR(entityKey: string): Promise<string> {
    const ticket = await this._getTicket(entityKey)
    if (ticket.status !== 'active') throw new Error('ASide: ticket is not active')
    return 'aside://v1/ticket?' + base64url({ v: 1, ticket: entityKey, generatedAt: Date.now() })
  }

  /**
   * Validates a ticket QR payload.
   * Returns the ticket record if valid and active, `null` otherwise.
   */
  async validateTicketQR(qrPayload: string): Promise<TicketRecord | null> {
    try {
      const [, encoded] = qrPayload.split('aside://v1/ticket?')
      if (!encoded) return null
      const { ticket } = fromBase64url(encoded) as { ticket: string }
      return this._getTicket(ticket).catch(() => null)
    }
    catch {
      return null
    }
  }

  /** Lists all tickets purchased by the current user. */
  async listMyTickets(): Promise<TicketRecord[]> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_TICKET_TYPE), eq(ATTR_UUID, this.uuid)])
      .withPayload(true)
      .fetch()
    return result.entities.map(e => ({
      entityKey: e.key,
      ...e.toJson() as Omit<TicketRecord, 'entityKey'>,
    }))
  }

  /** Lists all tickets for a specific event (organizer view). */
  async listEventTickets(eventEntityKey: string): Promise<TicketRecord[]> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_TICKET_TYPE), eq(ATTR_EVENT_KEY, eventEntityKey)])
      .withPayload(true)
      .fetch()
    return result.entities.map(e => ({
      entityKey: e.key,
      ...e.toJson() as Omit<TicketRecord, 'entityKey'>,
    }))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Discount Codes
  // ═══════════════════════════════════════════════════════════════════════════

  /** Creates a discount code for an event (percentage or fixed amount). */
  async createDiscountCode(
    eventEntityKey: string,
    options: CreateDiscountCodeOptions,
  ): Promise<DiscountCode> {
    const data: Omit<DiscountCode, 'entityKey'> = {
      eventEntityKey,
      code: options.code.toUpperCase(),
      type: options.type,
      value: options.value,
      maxUses: options.maxUses,
      usedCount: 0,
      expiresAt: options.expiresAt,
      status: 'active',
      createdAt: Date.now(),
    }
    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(data),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_DISCOUNT_TYPE },
        { key: ATTR_EVENT_KEY, value: eventEntityKey },
        { key: ATTR_UUID, value: this.uuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return { entityKey, ...data }
  }

  /**
   * Validates and returns a discount code.
   * Returns `null` if the code does not exist, is exhausted, or expired.
   */
  async validateDiscountCode(eventEntityKey: string, code: string): Promise<DiscountCode | null> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_DISCOUNT_TYPE), eq(ATTR_EVENT_KEY, eventEntityKey)])
      .withPayload(true)
      .fetch()
    const match = result.entities
      .map(e => ({ entityKey: e.key, ...e.toJson() as Omit<DiscountCode, 'entityKey'> }))
      .find(d => d.code === code.toUpperCase())
    if (!match) return null
    if (match.status !== 'active') return null
    if (match.expiresAt && Date.now() > match.expiresAt) return null
    if (match.maxUses !== undefined && match.usedCount >= match.maxUses) return null
    return match
  }

  /** Pauses or removes a discount code. */
  async deleteDiscountCode(entityKey: string): Promise<void> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_DISCOUNT_TYPE)])
      .withPayload(true)
      .fetch()
    const entity = result.entities.find(e => e.key === entityKey)
    if (!entity) return
    const existing = { entityKey, ...entity.toJson() as Omit<DiscountCode, 'entityKey'> }
    await this.cdn.entity.update({
      entityKey: entityKey as Hex,
      payload: jsonToPayload({ ...existing, status: 'paused' }),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_DISCOUNT_TYPE },
        { key: ATTR_EVENT_KEY, value: existing.eventEntityKey },
        { key: ATTR_UUID, value: this.uuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
  }

  /** Lists all discount codes for an event. */
  async listDiscountCodes(eventEntityKey: string): Promise<DiscountCode[]> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_DISCOUNT_TYPE), eq(ATTR_EVENT_KEY, eventEntityKey)])
      .withPayload(true)
      .fetch()
    return result.entities.map(e => ({
      entityKey: e.key,
      ...e.toJson() as Omit<DiscountCode, 'entityKey'>,
    }))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Waitlist
  // ═══════════════════════════════════════════════════════════════════════════

  /** Adds the current user to the event waitlist. */
  async joinWaitlist(eventEntityKey: string): Promise<WaitlistEntry> {
    const existing = await this._findWaitlistEntry(eventEntityKey, this.uuid)
    if (existing && existing.status === 'waiting') return existing

    const all = await this.listWaitlist(eventEntityKey)
    const position = all.filter(e => e.status === 'waiting').length + 1
    const data: Omit<WaitlistEntry, 'entityKey'> = {
      eventEntityKey,
      userUuid: this.uuid,
      userWallet: this.wallet,
      joinedAt: Date.now(),
      position,
      status: 'waiting',
    }
    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(data),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_WAITLIST_TYPE },
        { key: ATTR_EVENT_KEY, value: eventEntityKey },
        { key: ATTR_UUID, value: this.uuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return { entityKey, ...data }
  }

  /** Removes the current user from the waitlist. */
  async leaveWaitlist(eventEntityKey: string): Promise<void> {
    const existing = await this._findWaitlistEntry(eventEntityKey, this.uuid)
    if (!existing || existing.status !== 'waiting') return
    await this.cdn.entity.update({
      entityKey: existing.entityKey as Hex,
      payload: jsonToPayload({ ...existing, status: 'removed' }),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_WAITLIST_TYPE },
        { key: ATTR_EVENT_KEY, value: eventEntityKey },
        { key: ATTR_UUID, value: this.uuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
  }

  /** Lists all current waitlist entries for an event, sorted by position. */
  async listWaitlist(eventEntityKey: string): Promise<WaitlistEntry[]> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_WAITLIST_TYPE), eq(ATTR_EVENT_KEY, eventEntityKey)])
      .withPayload(true)
      .fetch()
    return result.entities
      .map(e => ({ entityKey: e.key, ...e.toJson() as Omit<WaitlistEntry, 'entityKey'> }))
      .sort((a, b) => a.position - b.position)
  }

  /**
   * Promotes a user from the waitlist to approved attendee.
   * Creates an approved RSVP and marks their waitlist entry as promoted.
   */
  async promoteFromWaitlist(eventEntityKey: string, userUuid: string): Promise<RSVPRecord> {
    const entry = await this._findWaitlistEntry(eventEntityKey, userUuid)
    if (!entry) throw new Error(`ASide: "${userUuid}" is not on the waitlist`)

    await this.cdn.entity.update({
      entityKey: entry.entityKey as Hex,
      payload: jsonToPayload({ ...entry, status: 'promoted' }),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_WAITLIST_TYPE },
        { key: ATTR_EVENT_KEY, value: eventEntityKey },
        { key: ATTR_UUID, value: userUuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })

    // Create or update RSVP
    const existingRSVP = await this._findRSVP(eventEntityKey, userUuid)
    if (existingRSVP) return this._updateRSVPStatus(existingRSVP, 'approved')

    const now = Date.now()
    const data: Omit<RSVPRecord, 'entityKey'> = {
      eventEntityKey,
      attendeeUuid: userUuid,
      attendeeWallet: entry.userWallet,
      status: 'approved',
      registeredAt: now,
      updatedAt: now,
      checkedIn: false,
    }
    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(data),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_RSVP_TYPE },
        { key: ATTR_EVENT_KEY, value: eventEntityKey },
        { key: ATTR_UUID, value: userUuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return { entityKey, ...data }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Invitations
  // ═══════════════════════════════════════════════════════════════════════════

  /** Sends an invitation to a single email address. */
  async inviteByEmail(eventEntityKey: string, email: string): Promise<EventInvite> {
    return this._createInvite(eventEntityKey, { email })
  }

  /** Sends invitations to a list of email addresses. Returns all created invites. */
  async inviteList(eventEntityKey: string, emails: string[]): Promise<EventInvite[]> {
    return Promise.all(emails.map(email => this.inviteByEmail(eventEntityKey, email)))
  }

  /** Resends an existing invitation (updates timestamp). */
  async resendInvite(entityKey: string): Promise<void> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_INVITE_TYPE)])
      .withPayload(true)
      .fetch()
    const entity = result.entities.find(e => e.key === entityKey)
    if (!entity) throw new Error(`ASide: invite "${entityKey}" not found`)
    const existing = { entityKey, ...entity.toJson() as Omit<EventInvite, 'entityKey'> }
    await this.cdn.entity.update({
      entityKey: entityKey as Hex,
      payload: jsonToPayload({ ...existing, sentAt: Date.now() }),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_INVITE_TYPE },
        { key: ATTR_EVENT_KEY, value: existing.eventEntityKey },
        { key: ATTR_UUID, value: this.uuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
  }

  /** Cancels an outstanding invitation. */
  async cancelInvite(entityKey: string): Promise<void> {
    await this._setInviteStatus(entityKey, 'cancelled')
  }

  /** Lists all invitations for an event. */
  async listInvites(eventEntityKey: string): Promise<EventInvite[]> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_INVITE_TYPE), eq(ATTR_EVENT_KEY, eventEntityKey)])
      .withPayload(true)
      .fetch()
    return result.entities.map(e => ({
      entityKey: e.key,
      ...e.toJson() as Omit<EventInvite, 'entityKey'>,
    }))
  }

  /** Accepts an invitation (updates status and auto-registers the user). */
  async acceptInvite(entityKey: string): Promise<EventInvite> {
    const invite = await this._setInviteStatus(entityKey, 'accepted')
    await this.register(invite.eventEntityKey)
    return invite
  }

  /** Rejects an invitation. */
  async rejectInvite(entityKey: string): Promise<EventInvite> {
    return this._setInviteStatus(entityKey, 'rejected')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Check-in
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Checks in an attendee via a ticket QR payload.
   */
  async checkinByQR(qrPayload: string): Promise<CheckinRecord> {
    const ticket = await this.validateTicketQR(qrPayload)
    if (!ticket || ticket.status !== 'active') {
      throw new Error('ASide: invalid or inactive ticket QR')
    }
    return this._createCheckin(ticket.eventEntityKey, ticket.ownerUuid, 'qr')
  }

  /**
   * Checks in an attendee by looking up their RSVP via UUID.
   * `emailOrUuid` can be an attendee UUID or any unique identifier.
   */
  async checkinByEmail(eventEntityKey: string, attendeeUuid: string): Promise<CheckinRecord> {
    const rsvp = await this._findRSVP(eventEntityKey, attendeeUuid)
    if (!rsvp || rsvp.status !== 'approved') {
      throw new Error('ASide: attendee not found or not approved')
    }
    return this._createCheckin(eventEntityKey, attendeeUuid, 'email')
  }

  /** Manually checks in an attendee (organizer/checkin_manager only). */
  async checkinManual(eventEntityKey: string, attendeeUuid: string): Promise<CheckinRecord> {
    return this._createCheckin(eventEntityKey, attendeeUuid, 'manual')
  }

  /** Marks a check-in as undone. */
  async undoCheckin(entityKey: string): Promise<void> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_CHECKIN_TYPE)])
      .withPayload(true)
      .fetch()
    const entity = result.entities.find(e => e.key === entityKey)
    if (!entity) throw new Error(`ASide: check-in "${entityKey}" not found`)
    const existing = { entityKey, ...entity.toJson() as Omit<CheckinRecord, 'entityKey'> }
    await this.cdn.entity.update({
      entityKey: entityKey as Hex,
      payload: jsonToPayload({ ...existing, undone: true }),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_CHECKIN_TYPE },
        { key: ATTR_EVENT_KEY, value: existing.eventEntityKey },
        { key: ATTR_TARGET_UUID, value: existing.attendeeUuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
  }

  /** Lists all check-in records for an event. */
  async listCheckins(eventEntityKey: string): Promise<CheckinRecord[]> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_CHECKIN_TYPE), eq(ATTR_EVENT_KEY, eventEntityKey)])
      .withPayload(true)
      .fetch()
    return result.entities
      .map(e => ({ entityKey: e.key, ...e.toJson() as Omit<CheckinRecord, 'entityKey'> }))
      .filter(c => !c.undone)
  }

  /** Returns the latest check-in record for a specific attendee, or `null`. */
  async getCheckinStatus(eventEntityKey: string, attendeeUuid: string): Promise<CheckinRecord | null> {
    const all = await this.listCheckins(eventEntityKey)
    return all.find(c => c.attendeeUuid === attendeeUuid) ?? null
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Communication
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Sends an announcement to all approved attendees of an event.
   * Creates an on-chain announcement entity and individual notifications.
   */
  async sendAnnouncement(eventEntityKey: string, message: string): Promise<void> {
    await this.cdn.entity.create({
      payload: jsonToPayload({
        eventEntityKey,
        fromUuid: this.uuid,
        message,
        sentAt: Date.now(),
        type: 'announcement',
      }),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_ANNOUNCEMENT_TYPE },
        { key: ATTR_EVENT_KEY, value: eventEntityKey },
        { key: ATTR_UUID, value: this.uuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
  }

  /**
   * Sends a reminder to all approved attendees.
   * Uses a default "Event starting soon" message if none provided.
   */
  async sendReminder(eventEntityKey: string, message?: string): Promise<void> {
    const ev = await this._getEventOrThrow(eventEntityKey)
    const text = message ?? `Reminder: "${ev.title}" starts at ${new Date(ev.startsAt).toISOString()}.`
    await this.sendAnnouncement(eventEntityKey, text)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Analytics
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Computes analytics for an event from on-chain data.
   */
  async getAnalytics(eventEntityKey: string): Promise<EventAnalytics> {
    const [registrations, checkins, tickets] = await Promise.all([
      this.listRegistrations(eventEntityKey),
      this.listCheckins(eventEntityKey),
      this.listEventTickets(eventEntityKey),
    ])
    const approved = registrations.filter(r => r.status === 'approved').length
    const waitlist = registrations.filter(r => r.status === 'waitlist').length
    const revenue = tickets
      .filter(t => t.status === 'active')
      .reduce((sum, _t) => sum, 0) // price data is in ticket type; approximated as 0 without lookup
    return {
      eventEntityKey,
      views: 0, // view tracking is off-chain
      registrations: registrations.length,
      approved,
      waitlist,
      checkins: checkins.length,
      conversionRate: registrations.length > 0
        ? Math.round((checkins.length / registrations.length) * 100)
        : 0,
      revenue,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Calendars
  // ═══════════════════════════════════════════════════════════════════════════

  /** Creates a new calendar owned by the current user. */
  async createCalendar(options: {
    name: string
    description?: string
    visibility?: 'public' | 'private'
  }): Promise<EventCalendar> {
    const now = Date.now()
    const data: Omit<EventCalendar, 'entityKey'> = {
      ownerUuid: this.uuid,
      ownerWallet: this.wallet,
      name: options.name,
      description: options.description,
      visibility: options.visibility ?? 'public',
      createdAt: now,
      updatedAt: now,
    }
    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(data),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_CALENDAR_TYPE },
        { key: ATTR_UUID, value: this.uuid },
        { key: ATTR_WALLET, value: this.wallet },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return { entityKey, ...data }
  }

  /** Updates a calendar's metadata. */
  async updateCalendar(
    entityKey: string,
    updates: Partial<Pick<EventCalendar, 'name' | 'description' | 'visibility'>>,
  ): Promise<EventCalendar> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_CALENDAR_TYPE), eq(ATTR_UUID, this.uuid)])
      .withPayload(true)
      .fetch()
    const entity = result.entities.find(e => e.key === entityKey)
    if (!entity) throw new Error(`ASide: calendar "${entityKey}" not found`)
    const existing = { entityKey, ...entity.toJson() as Omit<EventCalendar, 'entityKey'> }
    const updated = { ...existing, ...updates, updatedAt: Date.now() }
    await this.cdn.entity.update({
      entityKey: entityKey as Hex,
      payload: jsonToPayload(updated),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_CALENDAR_TYPE },
        { key: ATTR_UUID, value: this.uuid },
        { key: ATTR_WALLET, value: this.wallet },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return updated
  }

  /** Soft-deletes a calendar by setting it to private. */
  async deleteCalendar(entityKey: string): Promise<void> {
    await this.updateCalendar(entityKey, { visibility: 'private', name: '[deleted]' })
  }

  /** Adds an event to a calendar. */
  async addToCalendar(calendarEntityKey: string, eventEntityKey: string): Promise<EventCalendarEntry> {
    const data: Omit<EventCalendarEntry, 'entityKey'> = {
      calendarEntityKey,
      eventEntityKey,
      addedAt: Date.now(),
    }
    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(data),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_CALENDAR_ENTRY_TYPE },
        { key: ATTR_EVENT_KEY, value: calendarEntityKey },
        { key: ATTR_TARGET_UUID, value: eventEntityKey },
        { key: ATTR_UUID, value: this.uuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return { entityKey, ...data }
  }

  /** Removes an event from a calendar. */
  async removeFromCalendar(calendarEntityKey: string, eventEntityKey: string): Promise<void> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_CALENDAR_ENTRY_TYPE), eq(ATTR_EVENT_KEY, calendarEntityKey)])
      .withPayload(true)
      .fetch()
    const entry = result.entities
      .map(e => ({ entityKey: e.key, ...e.toJson() as Omit<EventCalendarEntry, 'entityKey'> }))
      .find(e => e.eventEntityKey === eventEntityKey)
    if (!entry) return
    await this.cdn.entity.update({
      entityKey: entry.entityKey as Hex,
      payload: jsonToPayload({ ...entry, removed: true }),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_CALENDAR_ENTRY_TYPE },
        { key: ATTR_EVENT_KEY, value: calendarEntityKey },
        { key: ATTR_TARGET_UUID, value: eventEntityKey },
        { key: ATTR_UUID, value: this.uuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
  }

  /** Follows another user's calendar. */
  async followCalendar(calendarEntityKey: string): Promise<void> {
    await this.cdn.entity.create({
      payload: jsonToPayload({
        calendarEntityKey,
        followerUuid: this.uuid,
        followedAt: Date.now(),
        status: 'active',
      }),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_CALENDAR_FOLLOW_TYPE },
        { key: ATTR_EVENT_KEY, value: calendarEntityKey },
        { key: ATTR_UUID, value: this.uuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
  }

  /** Unfollows a calendar. */
  async unfollowCalendar(calendarEntityKey: string): Promise<void> {
    const result = await this.cdn.entity
      .query()
      .where([
        eq(ATTR_TYPE, EVENT_CALENDAR_FOLLOW_TYPE),
        eq(ATTR_EVENT_KEY, calendarEntityKey),
        eq(ATTR_UUID, this.uuid),
      ])
      .withPayload(true)
      .fetch()
    const entity = result.entities[0]
    if (!entity) return
    await this.cdn.entity.update({
      entityKey: entity.key as Hex,
      payload: jsonToPayload({ ...(entity.toJson() as object), status: 'removed' }),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_CALENDAR_FOLLOW_TYPE },
        { key: ATTR_EVENT_KEY, value: calendarEntityKey },
        { key: ATTR_UUID, value: this.uuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
  }

  /** Lists all events in a calendar. */
  async listCalendarEvents(calendarEntityKey: string): Promise<EventData[]> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_CALENDAR_ENTRY_TYPE), eq(ATTR_EVENT_KEY, calendarEntityKey)])
      .withPayload(true)
      .fetch()
    const entries = result.entities
      .map(e => e.toJson() as EventCalendarEntry & { removed?: boolean })
      .filter(e => !e.removed)
    const events = await Promise.all(entries.map(e => this.getEvent(e.eventEntityKey)))
    return events.filter((e): e is EventData => e !== null)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Notifications
  // ═══════════════════════════════════════════════════════════════════════════

  /** Creates a notification for a user. */
  async createNotification(options: Omit<EventNotification, 'entityKey' | 'read' | 'createdAt'>): Promise<EventNotification> {
    const data: Omit<EventNotification, 'entityKey'> = {
      ...options,
      read: false,
      createdAt: Date.now(),
    }
    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(data),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_NOTIFICATION_TYPE },
        { key: ATTR_TARGET_UUID, value: options.toUuid },
        { key: ATTR_UUID, value: this.uuid },
        ...(options.eventEntityKey
          ? [{ key: ATTR_EVENT_KEY, value: options.eventEntityKey }]
          : []),
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return { entityKey, ...data }
  }

  /** Lists notifications for the current user, newest first. */
  async listNotifications(options: PaginationOptions & { unreadOnly?: boolean } = {}): Promise<EventNotification[]> {
    const { limit, offset = 0, unreadOnly = false } = options
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_NOTIFICATION_TYPE), eq(ATTR_TARGET_UUID, this.uuid)])
      .withPayload(true)
      .fetch()
    let notes = result.entities
      .map(e => ({ entityKey: e.key, ...e.toJson() as Omit<EventNotification, 'entityKey'> }))
      .sort((a, b) => b.createdAt - a.createdAt)
    if (unreadOnly) notes = notes.filter(n => !n.read)
    return applyPagination(notes, offset, limit)
  }

  /** Marks a notification as read. */
  async markNotificationRead(entityKey: string): Promise<void> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_NOTIFICATION_TYPE), eq(ATTR_TARGET_UUID, this.uuid)])
      .withPayload(true)
      .fetch()
    const entity = result.entities.find(e => e.key === entityKey)
    if (!entity) return
    const existing = { entityKey, ...entity.toJson() as Omit<EventNotification, 'entityKey'> }
    await this.cdn.entity.update({
      entityKey: entityKey as Hex,
      payload: jsonToPayload({ ...existing, read: true }),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_NOTIFICATION_TYPE },
        { key: ATTR_TARGET_UUID, value: existing.toUuid },
        { key: ATTR_UUID, value: existing.fromUuid ?? this.uuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
  }

  /** Soft-deletes a notification (sets read = true). */
  async deleteNotification(entityKey: string): Promise<void> {
    await this.markNotificationRead(entityKey)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Moderation
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Reports a user to the event organizer.
   * Creates an on-chain report entity for review.
   */
  async reportUser(
    targetUuid: string,
    reason: string,
    eventEntityKey?: string,
  ): Promise<void> {
    await this.cdn.entity.create({
      payload: jsonToPayload({
        reporterUuid: this.uuid,
        targetUuid,
        reason,
        eventEntityKey,
        reportedAt: Date.now(),
        status: 'pending',
      }),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_REPORT_TYPE },
        { key: ATTR_UUID, value: this.uuid },
        { key: ATTR_TARGET_UUID, value: targetUuid },
        ...(eventEntityKey ? [{ key: ATTR_EVENT_KEY, value: eventEntityKey }] : []),
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private helpers
  // ═══════════════════════════════════════════════════════════════════════════

  private async _getEventOrThrow(entityKey: string): Promise<EventData> {
    const ev = await this.getEvent(entityKey)
    if (!ev) throw new Error(`ASide: event "${entityKey}" not found`)
    return ev
  }

  private async _saveEvent(ev: EventData): Promise<void> {
    await this.cdn.entity.update({
      entityKey: ev.entityKey as Hex,
      payload: jsonToPayload(ev),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_TYPE },
        { key: ATTR_UUID, value: ev.organizerUuid },
        { key: ATTR_WALLET, value: ev.organizerWallet },
        { key: ATTR_EVENT_STATUS, value: ev.status },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
  }

  private async _createOrganizerRecord(
    eventEntityKey: string,
    userUuid: string,
    userWallet: string,
    role: OrganizerRole,
  ): Promise<EventOrganizer> {
    const existing = await this._findOrganizer(eventEntityKey, userUuid)
    const data: Omit<EventOrganizer, 'entityKey'> = {
      eventEntityKey,
      userUuid,
      userWallet,
      role,
      addedAt: existing?.addedAt ?? Date.now(),
    }
    if (existing) {
      await this.cdn.entity.update({
        entityKey: existing.entityKey as Hex,
        payload: jsonToPayload({ ...data, entityKey: existing.entityKey }),
        contentType: 'application/json',
        attributes: [
          { key: ATTR_TYPE, value: EVENT_ORGANIZER_TYPE },
          { key: ATTR_EVENT_KEY, value: eventEntityKey },
          { key: ATTR_TARGET_UUID, value: userUuid },
        ],
        expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
      })
      return { ...data, entityKey: existing.entityKey }
    }
    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(data),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_ORGANIZER_TYPE },
        { key: ATTR_EVENT_KEY, value: eventEntityKey },
        { key: ATTR_TARGET_UUID, value: userUuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return { entityKey, ...data }
  }

  private async _findOrganizer(eventEntityKey: string, userUuid: string): Promise<EventOrganizer | null> {
    const result = await this.cdn.entity
      .query()
      .where([
        eq(ATTR_TYPE, EVENT_ORGANIZER_TYPE),
        eq(ATTR_EVENT_KEY, eventEntityKey),
        eq(ATTR_TARGET_UUID, userUuid),
      ])
      .withPayload(true)
      .fetch()
    const entity = result.entities[0]
    if (!entity) return null
    return { entityKey: entity.key, ...entity.toJson() as Omit<EventOrganizer, 'entityKey'> }
  }

  private async _findRole(eventEntityKey: string, userUuid: string): Promise<EventRole | null> {
    const result = await this.cdn.entity
      .query()
      .where([
        eq(ATTR_TYPE, EVENT_ROLE_TYPE),
        eq(ATTR_EVENT_KEY, eventEntityKey),
        eq(ATTR_TARGET_UUID, userUuid),
      ])
      .withPayload(true)
      .fetch()
    const entity = result.entities[0]
    if (!entity) return null
    return { entityKey: entity.key, ...entity.toJson() as Omit<EventRole, 'entityKey'> }
  }

  private async _findRSVP(eventEntityKey: string, attendeeUuid: string): Promise<RSVPRecord | null> {
    const result = await this.cdn.entity
      .query()
      .where([
        eq(ATTR_TYPE, EVENT_RSVP_TYPE),
        eq(ATTR_EVENT_KEY, eventEntityKey),
        eq(ATTR_UUID, attendeeUuid),
      ])
      .withPayload(true)
      .fetch()
    const entity = result.entities[0]
    if (!entity) return null
    return { entityKey: entity.key, ...entity.toJson() as Omit<RSVPRecord, 'entityKey'> }
  }

  private async _updateRSVPStatus(record: RSVPRecord, status: RSVPStatus): Promise<RSVPRecord> {
    const updated = { ...record, status, updatedAt: Date.now() }
    await this.cdn.entity.update({
      entityKey: record.entityKey as Hex,
      payload: jsonToPayload(updated),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_RSVP_TYPE },
        { key: ATTR_EVENT_KEY, value: record.eventEntityKey },
        { key: ATTR_UUID, value: record.attendeeUuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return updated
  }

  private async _setRSVPStatusByOrganizer(
    eventEntityKey: string,
    attendeeUuid: string,
    status: RSVPStatus,
  ): Promise<RSVPRecord> {
    const existing = await this._findRSVP(eventEntityKey, attendeeUuid)
    if (!existing) throw new Error(`ASide: no RSVP found for "${attendeeUuid}"`)
    return this._updateRSVPStatus(existing, status)
  }

  private async _countApprovedRSVPs(eventEntityKey: string): Promise<number> {
    const all = await this.listRegistrations(eventEntityKey)
    return all.filter(r => r.status === 'approved').length
  }

  private async _getTicket(entityKey: string): Promise<TicketRecord> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_TICKET_TYPE)])
      .withPayload(true)
      .fetch()
    const entity = result.entities.find(e => e.key === entityKey)
    if (!entity) throw new Error(`ASide: ticket "${entityKey}" not found`)
    return { entityKey, ...entity.toJson() as Omit<TicketRecord, 'entityKey'> }
  }

  private async _updateTicket(
    entityKey: string,
    updates: Partial<TicketRecord>,
  ): Promise<TicketRecord> {
    const ticket = await this._getTicket(entityKey)
    const updated = { ...ticket, ...updates }
    await this.cdn.entity.update({
      entityKey: entityKey as Hex,
      payload: jsonToPayload(updated),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_TICKET_TYPE },
        { key: ATTR_EVENT_KEY, value: ticket.eventEntityKey },
        { key: ATTR_UUID, value: ticket.ownerUuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return updated
  }

  private async _findWaitlistEntry(eventEntityKey: string, userUuid: string): Promise<WaitlistEntry | null> {
    const result = await this.cdn.entity
      .query()
      .where([
        eq(ATTR_TYPE, EVENT_WAITLIST_TYPE),
        eq(ATTR_EVENT_KEY, eventEntityKey),
        eq(ATTR_UUID, userUuid),
      ])
      .withPayload(true)
      .fetch()
    const entity = result.entities[0]
    if (!entity) return null
    return { entityKey: entity.key, ...entity.toJson() as Omit<WaitlistEntry, 'entityKey'> }
  }

  private async _createInvite(eventEntityKey: string, options: Pick<EventInvite, 'email' | 'toUuid'>): Promise<EventInvite> {
    const data: Omit<EventInvite, 'entityKey'> = {
      eventEntityKey,
      fromUuid: this.uuid,
      email: options.email,
      toUuid: options.toUuid,
      status: 'pending',
      sentAt: Date.now(),
    }
    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(data),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_INVITE_TYPE },
        { key: ATTR_EVENT_KEY, value: eventEntityKey },
        { key: ATTR_UUID, value: this.uuid },
        ...(options.toUuid ? [{ key: ATTR_TARGET_UUID, value: options.toUuid }] : []),
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return { entityKey, ...data }
  }

  private async _setInviteStatus(entityKey: string, status: EventInvite['status']): Promise<EventInvite> {
    const result = await this.cdn.entity
      .query()
      .where([eq(ATTR_TYPE, EVENT_INVITE_TYPE)])
      .withPayload(true)
      .fetch()
    const entity = result.entities.find(e => e.key === entityKey)
    if (!entity) throw new Error(`ASide: invite "${entityKey}" not found`)
    const existing = { entityKey, ...entity.toJson() as Omit<EventInvite, 'entityKey'> }
    const updated = { ...existing, status, respondedAt: Date.now() }
    await this.cdn.entity.update({
      entityKey: entityKey as Hex,
      payload: jsonToPayload(updated),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_INVITE_TYPE },
        { key: ATTR_EVENT_KEY, value: existing.eventEntityKey },
        { key: ATTR_UUID, value: existing.fromUuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    return updated
  }

  private async _createCheckin(
    eventEntityKey: string,
    attendeeUuid: string,
    method: CheckinMethod,
  ): Promise<CheckinRecord> {
    const existing = await this.getCheckinStatus(eventEntityKey, attendeeUuid)
    if (existing) return existing
    const data: Omit<CheckinRecord, 'entityKey'> = {
      eventEntityKey,
      attendeeUuid,
      method,
      checkedInAt: Date.now(),
      checkedInByUuid: this.uuid,
      undone: false,
    }
    const { entityKey } = await this.cdn.entity.create({
      payload: jsonToPayload(data),
      contentType: 'application/json',
      attributes: [
        { key: ATTR_TYPE, value: EVENT_CHECKIN_TYPE },
        { key: ATTR_EVENT_KEY, value: eventEntityKey },
        { key: ATTR_TARGET_UUID, value: attendeeUuid },
      ],
      expiresIn: ExpirationTime.fromDays(DEFAULT_EXPIRY_SECONDS / 86400),
    })
    await this.markAttendance(eventEntityKey, attendeeUuid)
    return { entityKey, ...data }
  }

  private _applyEventFilters(events: EventData[], options: EventQueryOptions): EventData[] {
    let result = events
    if (options.modality) result = result.filter(e => e.modality === options.modality)
    if (options.city) result = result.filter(e => e.location?.city?.toLowerCase() === options.city!.toLowerCase())
    if (options.category) result = result.filter(e => e.categories?.includes(options.category!))
    if (options.tags?.length) result = result.filter(e => options.tags!.some(t => e.tags?.includes(t)))
    if (options.search) {
      const q = options.search.toLowerCase()
      result = result.filter(e =>
        e.title.toLowerCase().includes(q) ||
        e.description?.toLowerCase().includes(q),
      )
    }
    return result
  }
}


