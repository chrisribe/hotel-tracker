const { transaction, normalizeReferenceUrl } = require('../scripts/init-db');
const { httpError, randomToken, tokenHash } = require('../middleware/planner-auth');
const TripsDAO = require('../dao/TripsDAO');
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
const TRIP_FIELDS = ['name', 'description', 'destination', 'travel_start', 'travel_end', 'currency', 'travelers'];
const IDEA_FIELDS = ['kind', 'title', 'location', 'notes', 'url', 'destination_id', 'cost', 'currency', 'capacity', 'details', 'last_refresh_note'];
// What the group sees the API assistant called (member name, board copy). Hermes is only the backend.
const ASSISTANT_NAME = 'Trip Butler';
const RUN_FIELDS = ['created', 'updated', 'flagged', 'note', 'requested_at', 'question_at'];
const DETAIL_LIMIT = 12;
const SOURCE_LIMIT = 20;
// Decided ideas: only the organizer may change their research fields.
const DECIDED = ['selected', 'booked'];
// New research runs members' questions may start per trip per day (the organizer is not limited).
const MEMBER_RUN_LIMIT = 20;
// Shared detail labels per kind, so facts line up on the compare page. The form suggests them and the API returns them.
const DETAIL_LABELS = {
  destination: ['Best season', 'Flight time', 'Weather', 'Language'],
  stay: ['Bedrooms', 'Beds', 'Bathrooms', 'Pool', 'Parking', 'Check-in', 'Quote for dates'],
  transport: ['From', 'To', 'Departs', 'Arrives', 'Duration', 'Baggage'],
  activity: ['Duration', 'Booking needed', 'Opening hours', 'Age limit'],
  link: [],
};

const pick = (body, fields) => Object.fromEntries(fields.filter(field => Object.hasOwn(body, field)).map(field => [field, body[field]]));
// Stored vs validated idea values: blank equals null, and quotes compare as amounts ("10.00" = "10").
function sameValue(field, stored, next) {
  if (field === 'cost') return (stored == null ? null : Number(stored)) === (next == null ? null : Number(next));
  return JSON.stringify(stored ?? '') === JSON.stringify(next ?? '');
}

// pg parses DATE as local midnight; format back without a timezone shift.
const pad = n => String(n).padStart(2, '0');
const dateText = value => value instanceof Date ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : value;

const PRICED_KINDS = ['stay', 'transport', 'activity'];
const KIND_ORDER = ['stay', 'transport', 'activity', 'link', 'destination'];
const STATUS_ORDER = ['booked', 'selected', 'shortlisted', 'considering', 'eliminated'];
const byStatus = (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
const sortOptions = items => [...items].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || byStatus(a, b));
// Rows in the display currency come first.
const tripCurrencyFirst = (rows, currency) => [...rows].sort((a, b) => (b.currency === currency) - (a.currency === currency));
// money = { currency, convert(amount, from) }: the viewer's display currency. Without a known rate
// an amount stays in its quoted currency, so totals are never mixed silently.
const moneyFor = context => context.money || { currency: context.trip.currency, convert: () => null };
function inDisplay(amount, currency, money) {
  const converted = currency === money.currency ? null : money.convert(Number(amount), currency);
  return converted == null ? { amount: Number(amount), currency, converted: false } : { amount: converted, currency: money.currency, converted: true };
}

// What a destination's options add up to. Options are alternatives, so never sum them all:
// show a price range per kind, and a "from" estimate of the cheapest stay + transport.
function rollup(options, money) {
  const active = options.filter(option => option.status !== 'eliminated' && PRICED_KINDS.includes(option.kind));
  const ranges = new Map();
  for (const option of active.filter(o => o.cost != null)) {
    const value = inDisplay(option.cost, option.currency, money);
    const key = `${option.kind}:${value.currency}`;
    const range = ranges.get(key) || { kind: option.kind, currency: value.currency, min: Infinity, max: -Infinity, count: 0, converted: false };
    range.min = Math.min(range.min, value.amount);
    range.max = Math.max(range.max, value.amount);
    range.count += 1;
    range.converted ||= value.converted;
    ranges.set(key, range);
  }
  const estimates = new Map();
  for (const range of ranges.values()) {
    if (range.kind === 'activity') continue;
    const estimate = estimates.get(range.currency) || { currency: range.currency, total: 0, kinds: [], converted: false };
    estimate.total += range.min;
    estimate.kinds.push(range.kind);
    estimate.converted ||= range.converted;
    estimates.set(range.currency, estimate);
  }
  return {
    ranges: [...ranges.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)),
    estimates: tripCurrencyFirst([...estimates.values()], money.currency),
    missing: active.filter(option => option.cost == null).length,
    count: options.length,
    currency: money.currency,
  };
}

// Board default: each destination with the options linked to it, then everything else.
function destinationGroups(items, destinations, money) {
  const groups = destinations.map(meta => {
    const destination = items.find(item => item.id === meta.id);
    const options = sortOptions(items.filter(item => item.destination_id === meta.id));
    return { destination: destination || meta, matched: Boolean(destination), options, rollup: rollup(options, money) };
  }).filter(group => group.matched || group.options.length);
  groups.sort((a, b) => byStatus(a.destination, b.destination));
  return { destinations: groups, unlinked: sortOptions(items.filter(item => item.kind !== 'destination' && !item.destination_id)) };
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

// Group size used to split total quotes per person. Blank = not decided.
function travelers(value) {
  if (value == null || value === '') return null;
  const count = id(value, 'number of travelers');
  if (count > 100) throw httpError(400, 'Number of travelers must be between 1 and 100.');
  return count;
}

// Total quote divided by the trip's travelers, to the cent; null when either is unknown.
function perPerson(cost, count) {
  return cost == null || !count ? null : Math.round(Number(cost) * 100 / count) / 100;
}

function tripValues(body) {
  const values = {
    name: text(body.name, 'Trip name', 120, true),
    description: text(body.description, 'Description', 5000),
    destination: text(body.destination, 'Destination', 200),
    travel_start: date(body.travel_start, 'start date'),
    travel_end: date(body.travel_end, 'end date'),
    currency: choice(body.currency, CURRENCIES, 'currency', 'CAD'),
    travelers: travelers(body.travelers),
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
    url: referenceField('url', () => referenceUrl(body.url, 'Source URL', { required: true })) };
}

function imageValues(body) {
  return { url: referenceField('url', () => referenceUrl(body.url, 'Image URL', { image: true, required: true })),
    caption: referenceField('caption', () => text(body.caption, 'Caption', 300)),
    source_url: referenceField('credit', () => referenceUrl(body.source_url, 'Image source URL')) || null };
}

// Short label/value facts (e.g. Bedrooms: 3). Rows with both parts blank are dropped.
function detailValues(value) {
  if (value == null || value === '') return [];
  if (!Array.isArray(value)) throw httpError(400, 'Details must be a list of { label, value }.');
  const rows = value.map(row => {
    if (row === null || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(key => !['label', 'value'].includes(key))) {
      throw httpError(400, 'Each detail must be { label, value }.');
    }
    return { label: text(row.label, 'Detail label', 40), value: text(row.value, 'Detail value', 120) };
  }).filter(row => row.label || row.value);
  if (rows.some(row => !row.label || !row.value)) throw httpError(400, 'Each detail needs a label and a value.');
  if (rows.length > DETAIL_LIMIT) throw httpError(400, `Each idea can have at most ${DETAIL_LIMIT} details.`);
  return rows;
}

// Repeated form fields arrive as a string (one row) or an array (several).
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const rowsError = () => httpError(400, 'The form rows could not be read. Reload the page and try again.');

// The form prefills suggested labels, so a label left without a value is dropped rather than rejected.
function detailRows(body) {
  const labels = list(body.detail_label), values = list(body.detail_value);
  if (labels.length !== values.length) throw rowsError();
  return labels.map((label, i) => ({ label, value: values[i] })).filter(row => typeof row.value !== 'string' || row.value.trim());
}

// Link rows edit the idea's sources. A cleared row is removed; a missing label defaults to the site name.
function linkRows(body) {
  const ids = list(body.link_id), urls = list(body.link_url), labels = list(body.link_label);
  if (ids.length !== urls.length || labels.length !== urls.length) throw rowsError();
  const links = [];
  urls.forEach((rawUrl, i) => {
    const label = text(labels[i], 'Link label', 120);
    if (!text(rawUrl, 'Link URL', 2048)) {
      if (label) throw httpError(400, `Add a URL for "${label}", or clear the row.`);
      return;
    }
    const url = referenceUrl(rawUrl, 'Link URL', { required: true });
    links.push({ id: ids[i] ? id(ids[i], 'link') : null, url, label: label || new URL(url).hostname.replace(/^www\./, '').slice(0, 120) });
  });
  return links;
}

function ideaValues(body, defaultCurrency = 'CAD') {
  const values = {
    details: detailValues(body.details),
    kind: choice(body.kind, KINDS, 'idea kind', 'link'),
    title: text(body.title, 'Title', 160, true),
    location: text(body.location, 'Location', 200),
    notes: text(body.notes, 'Notes', 10000),
    last_refresh_note: text(body.last_refresh_note, 'Refresh note', 300),
    url: referenceUrl(body.url, 'URL'),
    currency: choice(body.currency, CURRENCIES, 'currency', defaultCurrency),
    destination_id: body.destination_id == null || body.destination_id === '' ? null : id(body.destination_id, 'destination'),
    cost: null,
    capacity: null,
  };
  // JSON clients may send numbers; String() of non-finite or imprecise values fails the pattern.
  const cost = typeof body.cost === 'number' ? String(body.cost) : body.cost;
  if (cost != null && cost !== '') {
    if (typeof cost !== 'string' || !/^\d{1,12}(\.\d{1,2})?$/.test(cost)) throw httpError(400, 'Cost must be a non-negative total quote with at most two decimal places.');
    values.cost = cost;
  }
  if (body.capacity != null && body.capacity !== '') {
    values.capacity = id(body.capacity, 'capacity');
    if (values.capacity > 100000) throw httpError(400, 'Capacity must be at most 100000.');
  }
  if (values.kind === 'destination' && values.destination_id) throw httpError(400, 'A destination cannot belong to another destination.');
  return values;
}

// Every DAO in one transaction shares the same client.
function daos(db) {
  return {
    trips: new TripsDAO(db), participants: new ParticipantsDAO(db), invites: new InvitesDAO(db),
    ideas: new IdeasDAO(db), sources: new SourcesDAO(db), images: new ImagesDAO(db), comments: new CommentsDAO(db), votes: new VotesDAO(db),
  };
}

class PlannerService {
  constructor(pool) {
    this.pool = pool;
  }

  async list(viewer) {
    return new TripsDAO(this.pool).listForViewer(viewer.userId, viewer.tripId);
  }

  // With start_research ticked, the Trip Butler is asked right away (the description is required then).
  async create(body, viewer) {
    const v = tripValues(body);
    return transaction(this.pool, async db => {
      const dao = daos(db);
      const context = { dao, trip: await dao.trips.create({ ...v, owner_id: viewer.userId }) };
      await dao.participants.upsertOrganizer(context.trip.id, viewer.name);
      if (body.start_research) await this.requestGeneration(context);
      return context.trip;
    });
  }

  // The organizer is the account that owns the trip (or the agent API, limited to one active run).
  async withTrip(tripId, viewer, work) {
    tripId = id(tripId, 'trip');
    return transaction(this.pool, async db => {
      const dao = daos(db);
      // Serialize a small group's operations, including revocation and invite rotation.
      const trip = await dao.trips.lock(tripId);
      const isOrganizer = Boolean(viewer.isRestrictedAgent) || (viewer.userId != null && trip?.owner_id === viewer.userId);
      if (!trip || (!isOrganizer && viewer.tripId !== tripId)) throw httpError(404, 'Trip not found.');
      if (viewer.isRestrictedAgent) {
        if (!viewer.runId || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(viewer.runId)) throw httpError(409, 'An exact X-Hotel-Run-Id from the queue is required.');
        if (!await dao.trips.activeGeneration(tripId, viewer.runId)) throw httpError(409, 'Research request is inactive, expired or replaced.');
        const agent = await dao.participants.findAgent(tripId);
        if (agent?.active === false) throw httpError(403, 'Your trip access has been removed.');
      }
      let participant;
      if (viewer.isAgent) {
        participant = await dao.participants.upsertAgent(tripId, viewer.name);
        if (!participant.active) participant = null;
      } else {
        participant = isOrganizer
          ? await dao.participants.findOrganizer(tripId)
          : await dao.participants.findActive(tripId, viewer.participantId);
      }
      if (!participant || (!isOrganizer && participant.is_organizer)) throw httpError(403, 'Your trip access has been removed.');
      return work({ db, dao, trip, participant, isOrganizer, isRestrictedAgent: Boolean(viewer.isRestrictedAgent) });
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

  // Any member may correct an idea's research until it is selected or booked; then only the organizer.
  // The restricted agent edits only its own ideas, and never one a person has corrected.
  canEdit(viewer, context, item) {
    if (viewer.isRestrictedAgent) return this.canDelete(viewer, context, item) && !item.human_corrected;
    return viewer.isOrganizer || !DECIDED.includes(item.status);
  }

  canDelete(viewer, context, item) {
    if (viewer.isRestrictedAgent) return item.created_by === context.participant.id && context.participant.is_agent;
    return viewer.isOrganizer || item.created_by === context.participant.id;
  }

  ensureCanEdit(viewer, context, item) {
    if (viewer.isRestrictedAgent) this.ensureAgentOwned(viewer, context, item);
    else if (!this.canEdit(viewer, context, item)) throw httpError(403, 'Only the organizer can change a selected or booked idea. Add a comment or an alternative instead.');
  }

  ensureCanDelete(viewer, context, item) {
    if (viewer.isRestrictedAgent) this.ensureAgentOwned(viewer, context, item);
    else if (!this.canDelete(viewer, context, item)) throw httpError(403, 'Only the author or organizer can delete this idea.');
  }

  ensureAgentOwned(viewer, context, item) {
    if (!this.canDelete(viewer, context, item)) throw httpError(403, 'Only the author or organizer can edit or delete this idea.');
    if (item.human_corrected) throw httpError(403, `A trip member corrected this idea, so it is read-only for the ${ASSISTANT_NAME}. Add a comment or a separate alternative instead.`);
  }

  async ideaDetail(context, viewer, itemId) {
    const item = await this.item(context, itemId);
    await this.attachReferences(context, [item]);
    let options = null;
    if (item.kind === 'destination') options = await this.destinationOptions(context, item);
    return {
      trip: context.trip,
      item,
      options,
      rollup: options && rollup(options, moneyFor(context)),
      comments: await context.dao.comments.listForIdea(item.id),
      imageValues: {},
      canEdit: this.canEdit(viewer, context, item),
      canDelete: this.canDelete(viewer, context, item),
      destinations: await this.destinations(context),
    };
  }

  async destinationOptions(context, destination) {
    const linked = await context.dao.ideas.list(context.trip.id, context.participant.id, { kind: 'all', destination: destination.id, q: '', view: 'all' });
    return sortOptions(linked.filter(option => option.id !== destination.id));
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

  // Members may only move ideas between considering and shortlisted; decisions stay with the organizer.
  async updateStatus(context, viewer, itemId, status) {
    if (context.isRestrictedAgent) throw httpError(403, 'Agents cannot change status.');
    const item = await this.item(context, itemId);
    const value = choice(status, STATUSES, 'status', null);
    if (!value) throw httpError(400, 'Choose a status.');
    const open = ['considering', 'shortlisted'];
    if (!viewer.isOrganizer && !(open.includes(item.status) && open.includes(value))) throw httpError(403, 'Only the organizer can make this decision.');
    await context.dao.ideas.setStatus(context.trip.id, item.id, value);
    return item;
  }

  // Partial update: sent fields override the stored ones, then the full form validation runs.
  async updateTrip(context, body) {
    const { dao, trip } = context;
    const current = { ...pick(trip, TRIP_FIELDS), travel_start: dateText(trip.travel_start), travel_end: dateText(trip.travel_end) };
    context.trip = await dao.trips.update(trip.id, tripValues({ ...current, ...pick(body, TRIP_FIELDS) }));
    return context.trip;
  }

  // Asks Hermes to research the trip from its description and the open question. Hermes pulls
  // waiting requests from the API; `queued` is false when one was already waiting.
  async requestGeneration(context) {
    const { dao, trip } = context;
    if (!trip.description && !trip.butler_question) {
      throw httpError(400, `Tell the ${ASSISTANT_NAME} what to look for: describe the trip or ask a question.`);
    }
    context.trip = await dao.trips.requestGeneration(trip.id);
    const queued = context.trip.generation_run_id !== trip.generation_run_id;
    return { trip: context.trip, queued };
  }

  // Any member asks the Trip Butler: a question replaces the open one; left empty, the Butler just researches the
  // trip description. It joins a waiting request (usage kept) or queues one. A member starting a new run counts toward
  // the daily cap; over the cap a question is still saved (`capped`) and waits for the next run.
  async askButler(context, viewer, body) {
    const { dao, trip } = context;
    const question = text(body.question, 'Question', 500);
    if (question) context.trip = await dao.trips.setQuestion(trip.id, question);
    const waiting = await dao.trips.activeGeneration(trip.id, trip.generation_run_id);
    if (!waiting && (context.trip.description || context.trip.butler_question) && !viewer.isOrganizer &&
        !await dao.trips.countMemberRun(trip.id, MEMBER_RUN_LIMIT)) {
      return { trip: context.trip, queued: false, capped: true, saved: Boolean(question) };
    }
    return this.requestGeneration(context);
  }

  // Organizer gives up on a waiting request (e.g. the assistant never picked it up); asking again re-queues and re-pings.
  async cancelGeneration(context) {
    context.trip = await context.dao.trips.cancelGeneration(context.trip.id);
    return context.trip;
  }

  // Hermes reports what one run did; this is the board's run log line.
  async reportRun(context, body) {
    const count = (value, label) => {
      if (value == null || value === '') return 0;
      if (!Number.isInteger(value) || value < 0 || value > 100) throw httpError(400, `${label} must be a whole number from 0 to 100.`);
      return value;
    };
    const summary = { created: count(body.created, 'created'), updated: count(body.updated, 'updated'), flagged: count(body.flagged, 'flagged'),
      note: text(body.note, 'Run note', 300) };
    const timestamp = field => {
      if (body[field] == null || body[field] === '') return null;
      const value = typeof body[field] === 'string' ? new Date(body[field]) : null;
      if (!value || !Number.isFinite(value.getTime())) throw httpError(400, `${field} must be the timestamp returned by the queue.`);
      return value;
    };
    const requestedAt = timestamp('requested_at');
    const questionAt = timestamp('question_at');
    if (context.isRestrictedAgent && !await context.dao.trips.activeGeneration(context.trip.id, context.trip.generation_run_id)) {
      throw httpError(409, 'Research request is inactive, expired or replaced.');
    }
    context.trip = await context.dao.trips.finishRun(context.trip.id, summary, requestedAt, questionAt);
    // A member changed the question during the run: queue another run so it gets looked at.
    if (context.trip.butler_question && !context.trip.generation_requested_at) await this.requestGeneration(context);
    return context.trip;
  }

  async generationQueue(limit) {
    limit = limit == null || limit === '' ? 5 : id(limit, 'limit');
    return new TripsDAO(this.pool).listGenerationQueue(Math.min(limit, 20));
  }

  async consumeAgentWrite(context, category) {
    const usage = { ...context.trip.generation_usage };
    const limits = { creations: 8, comments: 10, writes: 80 };
    for (const key of ['writes', ...(category ? [category] : [])]) {
      if (usage[key] >= limits[key]) {
        const error = httpError(429, `Agent run ${key} limit (${limits[key]}) reached. Stop this run.`);
        error.code = 'agent_run_limit';
        throw error;
      }
      usage[key] = (usage[key] || 0) + 1;
    }
    await context.dao.trips.saveGenerationUsage(context.trip.id, usage);
    context.trip.generation_usage = usage;
  }

  async patchIdea(context, viewer, itemId, body) {
    const item = await this.item(context, itemId);
    this.ensureCanEdit(viewer, context, item);
    const changes = pick(body, IDEA_FIELDS);
    if (Object.keys(changes).length) await this.writeIdea(context, { ...pick(item, IDEA_FIELDS), ...changes }, item);
    if (Object.hasOwn(body, 'status')) await this.updateStatus(context, viewer, item.id, body.status);
    return item;
  }

  async removeIdea(context, viewer, itemId) {
    const item = await this.item(context, itemId);
    this.ensureCanDelete(viewer, context, item);
    await context.dao.ideas.delete(context.trip.id, item.id);
  }

  async removeMember(context, memberId) {
    const member = await context.dao.participants.find(context.trip.id, id(memberId, 'member'));
    if (!member) throw httpError(404, 'Member not found.');
    if (member.is_organizer) throw httpError(403, 'The organizer cannot be removed.');
    await context.dao.participants.deactivate(context.trip.id, member.id);
  }

  async removeTrip(context) {
    await context.dao.trips.delete(context.trip.id);
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
    for (const group of await dao.ideas.countByKindAndStatus(trip.id)) {
      counts.all += group.count;
      counts[group.kind] += group.count;
      if (group.status === 'shortlisted') counts.shortlisted += group.count;
      if (['selected', 'booked'].includes(group.status)) counts.selected += group.count;
    }
    const { budget, missingCosts } = await this.selectedBudget(context);
    const groups = filters.kind === 'all' ? destinationGroups(items, destinations, moneyFor(context)) : null;
    return { trip, items, groups, destinations, members: await this.members(context), counts, filters, budget, missingCosts };
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

  async selectedBudget(context) {
    const { dao, trip } = context;
    const money = moneyFor(context);
    const rows = await dao.ideas.selectedTotals(trip.id);
    const values = rows.map(row => inDisplay(row.total, row.currency, money));
    // One converted total when every currency has a rate; otherwise separate lines per currency.
    const budget = values.some(v => v.converted) && values.every(v => v.currency === money.currency)
      ? [{ currency: money.currency, total: values.reduce((sum, v) => sum + v.amount, 0).toFixed(2), converted: true, parts: rows }]
      : tripCurrencyFirst(rows, money.currency);
    const missingCosts = await dao.ideas.countSelectedWithoutCost(trip.id);
    return { budget, missingCosts };
  }

  // An edit that changes something records who made it (last editor); a no-change save keeps the previous editor.
  async writeIdea(context, body, existing = null, linksChanged = false) {
    const { dao, trip, participant } = context;
    const v = ideaValues(body, trip.currency);
    if (!existing && !v.url && body.source_label) {
      throw httpError(400, 'Add a first source URL to save its label, or clear the label.');
    }
    // Legacy edits affect only the compatibility column, never the independent collection.
    if (existing && !Object.hasOwn(body, 'url')) v.url = existing.url;
    if (existing && !Object.hasOwn(body, 'details')) v.details = existing.details;
    if (existing && !Object.hasOwn(body, 'last_refresh_note')) v.last_refresh_note = existing.last_refresh_note;
    const initialSource = !existing && v.url ? sourceValues({ label: body.source_label == null || body.source_label === '' ? 'Original source' : body.source_label,
      url: v.url }) : null;
    if (v.destination_id) {
      const destination = await dao.ideas.findDestination(trip.id, v.destination_id);
      if (!destination || existing?.id === v.destination_id) throw httpError(400, 'Choose a destination from this trip.');
    }
    if (existing?.kind === 'destination' && v.kind !== 'destination') {
      const referenced = await dao.ideas.hasLinkedIdeas(trip.id, existing.id);
      if (referenced) throw httpError(400, 'Move linked ideas before changing this destination to another kind.');
    }
    if (existing) {
      const changed = linksChanged || IDEA_FIELDS.some(field => !sameValue(field, existing[field], v[field]));
      return dao.ideas.update(trip.id, existing.id, v, changed ? participant.id : null);
    }
    const item = await dao.ideas.create(trip.id, participant.id, v);
    if (initialSource) await this.mutateReference(context, item, 'sources', 'add', null, initialSource);
    return item;
  }

  // Sources the viewer may edit in the idea form; the others are listed read-only.
  async formLinks({ dao, participant }, item) {
    const sources = item ? await dao.sources.listForIdeas([item.id]) : [];
    const editable = source => participant.is_organizer || source.created_by === participant.id;
    return { sources, links: sources.filter(editable), otherLinks: sources.filter(source => !editable(source)) };
  }

  // The idea form sends repeatable link and detail rows (marked by rows_form). Everything is
  // validated before the first write, so a rejected form changes nothing.
  async saveIdeaForm(context, body, existing = null) {
    if (body.rows_form !== '1') return this.writeIdea(context, body, existing);
    const { dao, participant } = context;
    const links = linkRows(body);
    const details = detailRows(body);
    const { sources: current, links: mine } = await this.formLinks(context, existing);
    const kept = new Map();
    for (const link of links.filter(l => l.id)) {
      if (!mine.some(source => source.id === link.id) || kept.has(link.id)) throw httpError(400, 'A link no longer belongs to this idea. Reload the page and try again.');
      kept.set(link.id, link);
    }
    const removed = mine.filter(source => !kept.has(source.id));
    const added = links.filter(link => !link.id);
    if (current.length - removed.length + added.length > SOURCE_LIMIT) throw httpError(400, `Each idea can have at most ${SOURCE_LIMIT} links.`);
    // Links replace the legacy first-source fields, so ignore those if they are sent too.
    const { url, source_label, ...fields } = body;
    const linksChanged = removed.length > 0 || added.length > 0 || mine.some(source => {
      const link = kept.get(source.id);
      return link && (link.url !== source.url || link.label !== source.label);
    });
    const item = await this.writeIdea(context, { ...fields, details }, existing, linksChanged);
    for (const source of removed) await dao.sources.delete(item.id, source.id);
    for (const source of mine) {
      const link = kept.get(source.id);
      if (link && (link.url !== source.url || link.label !== source.label)) await dao.sources.update(item.id, source.id, { label: link.label, url: link.url });
    }
    for (const link of added) await dao.sources.create(item.id, participant.id, { label: link.label, url: link.url });
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
    const limit = context.isRestrictedAgent ? (image ? 4 : 5) : (image ? 12 : SOURCE_LIMIT);
    if (count >= limit) throw httpError(400, `Each idea can have at most ${limit} ${collection}.`);
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
      await dao.trips.lockDemo(viewer.userId);
      const existing = await dao.trips.findDemo(viewer.userId);
      if (existing) return existing;
      const trip = await dao.trips.createDemo(DEMO_TRIP.name, DEMO_TRIP.description, viewer.userId);
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
      if (viewer.userId != null && trip.owner_id === viewer.userId) return { trip, participant: null };
      if (revoked) throw httpError(403, 'Your trip access has been removed. Ask the organizer for help.');
      // An account holder may switch to another friend's trip; a plain guest has one trip per session.
      if (viewer.participantId && (viewer.tripId === trip.id || !viewer.userId)) {
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

module.exports = { PlannerService, ASSISTANT_NAME, MEMBER_RUN_LIMIT, KINDS, STATUSES, CURRENCIES, TRIP_FIELDS, IDEA_FIELDS, RUN_FIELDS, DETAIL_LABELS, text, id, choice, tripValues, ideaValues, dateText, perPerson };