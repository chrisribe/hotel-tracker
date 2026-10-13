const { transaction, normalizeReferenceUrl } = require('../scripts/init-db');
const { httpError, randomToken, tokenHash } = require('../middleware/planner-auth');
const TripsDAO = require('../dao/TripsDAO');
const HotelsDAO = require('../dao/HotelsDAO');
const ParticipantsDAO = require('../dao/ParticipantsDAO');
const InvitesDAO = require('../dao/InvitesDAO');
const IdeasDAO = require('../dao/IdeasDAO');
const SourcesDAO = require('../dao/SourcesDAO');
const ImagesDAO = require('../dao/ImagesDAO');
const CommentsDAO = require('../dao/CommentsDAO');
const VotesDAO = require('../dao/VotesDAO');
const { DEMO_TRIP, seedDemoIdeas } = require('./plannerDemo');

const KINDS = ['destination', 'stay', 'transport', 'activity', 'link'];
const STATUSES = ['considering', 'shortlisted', 'selected', 'booked', 'eliminated'];
const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP'];
const COST_BASES = ['total', 'per_person', 'per_day', 'per_person_per_day'];
const PRICE_KINDS = ['quoted', 'estimate'];
const MAX_ORIGIN_COSTS = 10;

function money(value, label) {
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value !== 'string' || !/^\d{1,12}(\.\d{1,2})?$/.test(value.trim())) throw httpError(400, `${label} must be a non-negative amount with at most two decimal places.`);
  return value.trim();
}

// Accepts an API array of {origin,cost,currency} or form text, one "Origin: 854 CAD" per line.
function originCosts(value) {
  if (value == null || value === '') return [];
  let rows = value;
  if (typeof value === 'string') {
    rows = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
      const match = line.match(/^(.+?)\s*[:=]\s*([\d.,]+)\s*([A-Za-z]{3})?$/);
      if (!match) throw httpError(400, 'Write each departure cost as "Origin: amount CUR", for example "Montréal: 854 CAD".');
      return { origin: match[1], cost: match[2].replace(',', '.'), currency: match[3] ? match[3].toUpperCase() : undefined };
    });
  }
  if (!Array.isArray(rows) || rows.length > MAX_ORIGIN_COSTS) throw httpError(400, `Add at most ${MAX_ORIGIN_COSTS} departure costs.`);
  const seen = new Set();
  return rows.map(row => {
    if (!row || typeof row !== 'object') throw httpError(400, 'Invalid departure cost.');
    const origin = text(row.origin, 'Departure origin', 80, true);
    if (seen.has(origin.toLowerCase())) throw httpError(400, `Departure origin "${origin}" is listed twice.`);
    seen.add(origin.toLowerCase());
    return { origin, cost: money(row.cost, `Cost from ${origin}`), currency: choice(row.currency, CURRENCIES, 'currency', 'CAD') };
  });
}

function text(value, label, max, required = false) {
  if (value == null) value = '';
  if (typeof value !== 'string') throw httpError(400, `${label} must be text.`);
  value = value.trim();
  if ((required && !value) || value.length > max || /\u0000/.test(value)) {
    throw httpError(400, `${label} ${required ? 'is required and ' : ''}must be at most ${max} characters.`);
  }
  return value;
}

function id(value, label = 'ID') {
  if (!['string', 'number'].includes(typeof value) || !/^[1-9]\d{0,9}$/.test(String(value)) || Number(value) > 2147483647) throw httpError(400, `Invalid ${label}.`);
  return Number(value);
}

function choice(value, values, label, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string' || !values.includes(value)) throw httpError(400, `Invalid ${label}.`);
  return value;
}

function date(value, label) {
  const normalized = text(value, label, 10);
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || normalized.slice(0, 4) === '0000') throw httpError(400, `Invalid ${label}.`);
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) throw httpError(400, `Invalid ${label}.`);
  return normalized;
}

function tripValues(body) {
  const values = {
    name: text(body.name, 'Trip name', 120, true),
    description: text(body.description, 'Description', 5000),
    destination: text(body.destination, 'Destination', 200),
    travel_start: date(body.travel_start, 'start date'),
    travel_end: date(body.travel_end, 'end date'),
  };
  if (values.travel_start && values.travel_end && values.travel_start > values.travel_end) throw httpError(400, 'End date must be on or after the start date.');
  return values;
}

function referenceUrl(value, label, { image = false, required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw httpError(400, `${label} is required.`);
    return '';
  }
  try { return normalizeReferenceUrl(value, image); }
  catch { throw httpError(400, `${label} must be a valid ${image ? 'public HTTPS' : 'HTTP or HTTPS'} URL, at most 2048 characters, without credentials, whitespace or backslashes.`); }
}

function referenceField(field, validate) {
  try { return validate(); }
  catch (error) {
    if (error.status === 400) error.field = field;
    throw error;
  }
}

function sourceValues(body) {
  return { label: referenceField('label', () => text(body.label, 'Source label', 120, true)),
    url: referenceField('url', () => referenceUrl(body.url, 'Source URL', { required: true })),
    takeaway: referenceField('takeaway', () => text(body.takeaway, 'Takeaway', 2000)) };
}

function imageValues(body) {
  return { url: referenceField('url', () => referenceUrl(body.url, 'Image URL', { image: true, required: true })),
    caption: referenceField('caption', () => text(body.caption, 'Caption', 300)),
    source_url: referenceField('credit', () => referenceUrl(body.source_url, 'Image source URL')) || null };
}

function ideaValues(body) {
  const values = {
    kind: choice(body.kind, KINDS, 'idea kind', 'link'),
    title: text(body.title, 'Title', 160, true),
    location: text(body.location, 'Location', 200),
    notes: text(body.notes, 'Notes', 10000),
    url: referenceUrl(body.url, 'URL'),
    currency: choice(body.currency, CURRENCIES, 'currency', 'CAD'),
    destination_id: body.destination_id == null || body.destination_id === '' ? null : id(body.destination_id, 'destination'),
    cost: null,
    capacity: null,
    cost_basis: choice(body.cost_basis, COST_BASES, 'cost basis', 'total'),
    price_kind: choice(body.price_kind, PRICE_KINDS, 'price kind', 'estimate'),
    quoted_at: date(body.quoted_at, 'quote date'),
    origin_costs: originCosts(body.origin_costs),
  };
  if (typeof body.cost === 'number') body = { ...body, cost: String(body.cost) };
  if (typeof body.capacity === 'number') body = { ...body, capacity: String(body.capacity) };
  if (body.cost != null && body.cost !== '') {
    if (typeof body.cost !== 'string' || !/^\d{1,12}(\.\d{1,2})?$/.test(body.cost)) throw httpError(400, 'Cost must be a non-negative total quote with at most two decimal places.');
    values.cost = body.cost;
  }
  if (body.capacity != null && body.capacity !== '') {
    values.capacity = id(body.capacity, 'capacity');
    if (values.capacity > 100000) throw httpError(400, 'Capacity must be at most 100000.');
  }
  if (values.kind === 'destination' && values.destination_id) throw httpError(400, 'A destination cannot belong to another destination.');
  if (values.quoted_at && values.price_kind !== 'quoted') throw httpError(400, 'A quote date only applies to quoted prices.');
  return values;
}

// Every DAO in one transaction shares the same client.
function daos(db) {
  return {
    trips: new TripsDAO(db), hotels: new HotelsDAO(db), participants: new ParticipantsDAO(db), invites: new InvitesDAO(db),
    ideas: new IdeasDAO(db), sources: new SourcesDAO(db), images: new ImagesDAO(db), comments: new CommentsDAO(db), votes: new VotesDAO(db),
  };
}

class PlannerService {
  constructor(pool) {
    this.pool = pool;
  }

  async list(viewer) {
    return new TripsDAO(this.pool).listForViewer(viewer.isOrganizer, viewer.tripId);
  }

  async create(body, viewer) {
    const v = tripValues(body);
    return transaction(this.pool, async db => {
      const dao = daos(db);
      const trip = await dao.trips.create(v);
      await dao.participants.upsertOrganizer(trip.id, viewer.name);
      return trip;
    });
  }

  async withTrip(tripId, viewer, work) {
    tripId = id(tripId, 'trip');
    return transaction(this.pool, async db => {
      const dao = daos(db);
      // Serialize a small group's operations, including revocation and invite rotation.
      const trip = await dao.trips.lock(tripId);
      if (!trip || (!viewer.isOrganizer && viewer.tripId !== tripId)) throw httpError(404, 'Trip not found.');
      const participant = viewer.isOrganizer
        ? await dao.participants.findOrganizer(tripId)
        : await dao.participants.findActive(tripId, viewer.participantId);
      if (!participant || (!viewer.isOrganizer && participant.is_organizer)) throw httpError(403, 'Your trip access has been removed.');
      return work({ db, dao, trip, participant });
    });
  }

  async destinations({ dao, trip }) {
    return dao.ideas.listDestinations(trip.id);
  }

  async members({ dao, trip }) {
    return dao.participants.listActive(trip.id);
  }

  async item({ dao, trip, participant }, itemId) {
    const item = await dao.ideas.find(trip.id, participant.id, id(itemId, 'idea'));
    if (!item) throw httpError(404, 'Idea not found.');
    return item;
  }

  async attachReferences({ dao }, items) {
    const ids = items.map(item => item.id);
    const sources = await dao.sources.listForIdeas(ids);
    const images = await dao.images.listForIdeas(ids);
    for (const item of items) {
      item.sources = sources.filter(source => source.item_id === item.id);
      item.images = images.filter(image => image.item_id === item.id);
    }
    return items;
  }

  canEdit(viewer, context, item) {
    return viewer.isOrganizer || item.created_by === context.participant.id;
  }

  ensureCanEdit(viewer, context, item) {
    if (!this.canEdit(viewer, context, item)) throw httpError(403, 'Only the author or organizer can edit or delete this idea.');
  }

  async ideaDetail(context, viewer, itemId) {
    const item = await this.item(context, itemId);
    await this.attachReferences(context, [item]);
    return {
      trip: context.trip,
      item,
      comments: await context.dao.comments.listForIdea(item.id),
      sourceValues: {},
      imageValues: {},
      canEdit: this.canEdit(viewer, context, item),
      destinations: await this.destinations(context),
    };
  }

  async vote(context, itemId) {
    const item = await this.item(context, itemId);
    await context.dao.votes.toggle(item.id, context.participant.id);
    return item;
  }

  async addComment(context, itemId, body) {
    const item = await this.item(context, itemId);
    await context.dao.comments.create(item.id, context.participant.id, text(body, 'Comment', 2000, true));
    return item;
  }

  async updateStatus(context, itemId, status) {
    const item = await this.item(context, itemId);
    const value = choice(status, STATUSES, 'status', null);
    if (!value) throw httpError(400, 'Choose a status.');
    await context.dao.ideas.setStatus(context.trip.id, item.id, value);
    return item;
  }

  async removeIdea(context, viewer, itemId) {
    const item = await this.item(context, itemId);
    this.ensureCanEdit(viewer, context, item);
    await context.dao.ideas.delete(context.trip.id, item.id);
  }

  async removeMember(context, memberId) {
    const member = await context.dao.participants.find(context.trip.id, id(memberId, 'member'));
    if (!member) throw httpError(404, 'Member not found.');
    if (member.is_organizer) throw httpError(403, 'The organizer cannot be removed.');
    await context.dao.participants.deactivate(context.trip.id, member.id);
  }

  async setMemberOrigin(context, memberId, origin) {
    const value = text(origin, 'Departure origin', 80) || null;
    const member = await context.dao.participants.setOrigin(context.trip.id, id(memberId, 'member'), value);
    if (!member) throw httpError(404, 'Member not found.');
    return member;
  }

  async board(context, query) {
    const { dao, trip, participant } = context;
    const filters = {
      kind: choice(query.kind, ['all', ...KINDS], 'kind filter', 'all'),
      destination: query.destination == null || query.destination === '' || query.destination === 'all' ? '' : String(id(query.destination, 'destination')),
      q: text(query.q, 'Search', 200),
      view: choice(query.view, ['all', 'shortlisted', 'selected'], 'view filter', 'all'),
    };
    const destinations = await this.destinations(context);
    if (filters.destination && !destinations.some(d => d.id === Number(filters.destination))) throw httpError(400, 'Destination must belong to this trip.');
    const items = await dao.ideas.list(trip.id, participant.id, filters);
    const counts = { all: 0, destination: 0, stay: 0, transport: 0, activity: 0, link: 0, shortlisted: 0, selected: 0 };
    const groups = await dao.ideas.countByKindAndStatus(trip.id);
    for (const group of groups) {
      counts.all += group.count;
      counts[group.kind] += group.count;
      if (group.status === 'shortlisted') counts.shortlisted += group.count;
      if (['selected', 'booked'].includes(group.status)) counts.selected += group.count;
    }
    const { budget, missingCosts } = await this.selectedBudget(context);
    const legacyHotelCount = await dao.hotels.countByTrip(trip.id);
    return { trip, items, destinations, members: await this.members(context), counts, filters, budget, missingCosts, legacyHotelCount };
  }

  async compare(context, query) {
    const kind = choice(query.kind, KINDS, 'comparison kind', 'destination');
    const candidates = await context.dao.ideas.listByKind(context.trip.id, context.participant.id, kind);
    let items = [];
    if (Object.hasOwn(query, 'ids')) {
      const raw = Array.isArray(query.ids) ? query.ids : [query.ids];
      if (raw.some(value => typeof value !== 'string')) throw httpError(400, 'Choose 2–4 different ideas of the same kind from this trip.');
      const values = raw.flatMap(value => value.split(','));
      if (values.length < 2 || values.length > 4) throw httpError(400, 'Choose 2–4 different ideas to compare.');
      const ids = values.map(value => id(value.trim(), 'comparison idea'));
      const byId = new Map(candidates.map(item => [item.id, item]));
      if (new Set(ids).size !== ids.length || ids.some(value => !byId.has(value))) throw httpError(400, 'Choose 2–4 different ideas of the same kind from this trip.');
      items = ids.map(value => byId.get(value));
    } else if (candidates.length >= 2 && candidates.length <= 4) {
      // Show a small complete set directly, without choosing a winner or changing status.
      items = candidates;
    }
    await this.attachReferences(context, items);
    return { trip: context.trip, kind, candidates, items, destinations: await this.destinations(context) };
  }

  async selected(context) {
    const items = await context.dao.ideas.listSelected(context.trip.id, context.participant.id);
    const destinations = await this.destinations(context);
    const destinationNames = new Map(destinations.map(item => [item.id, item.title]));
    const selectedIds = new Set(items.map(item => item.id));
    const selectionWarnings = [];
    for (const item of items) {
      if (item.destination_id && !selectedIds.has(item.destination_id)) {
        selectionWarnings.push(`${item.title} is linked to an unselected destination: ${destinationNames.get(item.destination_id)}. Check that it belongs in this plan.`);
      }
    }
    // Multiple activities are normal; these kinds more often represent competing alternatives.
    for (const kind of ['destination', 'stay', 'transport']) {
      if (items.filter(item => item.kind === kind).length > 1) selectionWarnings.push(`Multiple ${kind} options are selected. Confirm these are intentional parts of a multi-stop plan, not alternatives.`);
    }
    return { trip: context.trip, items, ...await this.selectedBudget(context), destinations, selectionWarnings };
  }

  async selectedBudget({ dao, trip }) {
    const budget = await dao.ideas.selectedTotals(trip.id);
    const missingCosts = await dao.ideas.countSelectedWithoutCost(trip.id);
    return { budget, missingCosts };
  }

  async writeIdea(context, body, existing = null) {
    const { dao, trip, participant } = context;
    const v = ideaValues(body);
    if (!existing && !v.url && (body.source_label || body.takeaway)) {
      throw httpError(400, 'Add a first source URL to save its label and takeaway, or clear those fields.');
    }
    // Legacy edits affect only the compatibility column, never the independent collection.
    if (existing && !Object.hasOwn(body, 'url')) v.url = existing.url;
    const initialSource = !existing && v.url ? sourceValues({ label: body.source_label == null || body.source_label === '' ? 'Original source' : body.source_label,
      url: v.url, takeaway: body.takeaway }) : null;
    if (v.destination_id) {
      const destination = await dao.ideas.findDestination(trip.id, v.destination_id);
      if (!destination || existing?.id === v.destination_id) throw httpError(400, 'Choose a destination from this trip.');
    }
    if (existing?.kind === 'destination' && v.kind !== 'destination') {
      const referenced = await dao.ideas.hasLinkedIdeas(trip.id, existing.id);
      if (referenced) throw httpError(400, 'Move linked ideas before changing this destination to another kind.');
    }
    if (existing) return dao.ideas.update(trip.id, existing.id, v);
    const item = await dao.ideas.create(trip.id, participant.id, v);
    if (initialSource) await this.mutateReference(context, item, 'sources', 'add', null, initialSource);
    return item;
  }

  async mutateReference(context, item, collection, action, referenceId, body = {}) {
    const { dao, participant } = context;
    if (!['sources', 'images'].includes(collection)) throw new Error('Unknown collection');
    const image = collection === 'images';
    const references = image ? dao.images : dao.sources;
    let reference;
    if (action !== 'add') {
      reference = await references.find(item.id, id(referenceId, image ? 'image' : 'source'));
      if (!reference) throw httpError(404, `${image ? 'Image' : 'Source'} not found.`);
      const author = action === 'cover' ? item.created_by : reference.created_by;
      if (!participant.is_organizer && author !== participant.id) throw httpError(403,
        action === 'cover' ? 'Only the idea author or organizer can choose the cover.' : 'Only the contributor or organizer can edit or delete this reference.');
    }
    if (action === 'cover' && image) {
      await dao.images.setCover(item.id, reference.id);
      return;
    }
    if (action === 'delete') {
      await references.delete(item.id, reference.id);
      if (image && reference.is_cover) await dao.images.coverOldest(item.id);
      return;
    }
    if (!['add', 'edit'].includes(action)) throw new Error('Unknown reference action');
    const v = image ? imageValues(body) : sourceValues(body);
    if (action === 'edit') {
      await references.update(item.id, reference.id, v);
      return;
    }
    const count = await references.count(item.id);
    if (count >= (image ? 12 : 20)) throw httpError(400, `Each idea can have at most ${image ? 12 : 20} ${collection}.`);
    // The first photo becomes the cover.
    if (image) await dao.images.create(item.id, participant.id, v, count === 0);
    else await dao.sources.create(item.id, participant.id, v);
  }

  async invite(context, rotate = false) {
    const { dao, trip } = context;
    if (rotate) {
      const token = randomToken();
      await dao.invites.replace(trip.id, tokenHash(token), token);
    }
    return `/join/${await dao.invites.findToken(trip.id)}`;
  }

  async inviteTrip(token, db = this.pool) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw httpError(404, 'Invite not found or no longer active.');
    const trip = await new InvitesDAO(db).findTripByHash(tokenHash(token));
    if (!trip) throw httpError(404, 'Invite not found or no longer active.');
    return trip;
  }

  async demo(viewer) {
    return transaction(this.pool, async db => {
      const dao = daos(db);
      await dao.trips.lockDemo();
      const existing = await dao.trips.findDemo();
      if (existing) return existing;
      const trip = await dao.trips.createDemo(DEMO_TRIP.name, DEMO_TRIP.description);
      const participant = await dao.participants.upsertOrganizer(trip.id, viewer.name);
      const context = { db, dao, trip, participant };
      await seedDemoIdeas(body => this.writeIdea(context, body));
      return trip;
    });
  }

  async join(token, name, viewer, revoked) {
    name = text(name, 'Display name', 80, true);
    return transaction(this.pool, async db => {
      const dao = daos(db);
      let trip = await this.inviteTrip(token, db);
      await dao.trips.lock(trip.id);
      // Rotation can have completed while this join was waiting for the trip lock.
      trip = await this.inviteTrip(token, db);
      if (viewer.isOrganizer) return { trip, participant: null };
      if (revoked) throw httpError(403, 'Your trip access has been removed. Ask the organizer for help.');
      if (viewer.participantId) {
        if (viewer.tripId !== trip.id) throw httpError(403, 'Log out before joining a different trip.');
        const participant = await dao.participants.findActive(trip.id, viewer.participantId);
        if (!participant) throw httpError(403, 'Your trip access has been removed.');
        return { trip, participant };
      }
      const participant = await dao.participants.create(trip.id, name);
      return { trip, participant };
    });
  }
}

module.exports = { PlannerService, KINDS, STATUSES, CURRENCIES, COST_BASES, PRICE_KINDS, date, text, id, choice, tripValues, ideaValues };