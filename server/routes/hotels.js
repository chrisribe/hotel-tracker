const express = require('express');
const router = express.Router();
const HotelsDAO = require('../dao/HotelsDAO');
const HotelLinksDAO = require('../dao/HotelLinksDAO');

// POST /trips/:tripId/hotels — add hotel
router.post('/trip/:tripId', async (req, res) => {
  const pool = req.app.get('pool');
  const hotel = await new HotelsDAO(pool).create({
    trip_id: req.params.tripId,
    ...req.body,
  });
  if (req.headers['hx-request']) {
    return res.render('partials/hotel-card', { pageData: { hotel } });
  }
  res.redirect(`/trips/${req.params.tripId}`);
});

// GET /hotels/:id — hotel detail page
router.get('/:id', async (req, res) => {
  const pool = req.app.get('pool');
  const hotel = await new HotelsDAO(pool).getById(req.params.id);
  if (!hotel) return res.status(404).send('Hotel not found');
  res.respondWithTemplateOrJson({ hotel }, 'hotel-detail');
});

// PATCH /hotels/:id — inline update (HTMX)
router.patch('/:id', async (req, res) => {
  const pool = req.app.get('pool');
  const hotel = await new HotelsDAO(pool).patch(req.params.id, req.body);
  res.json(hotel);
});

// PATCH /hotels/:id/status — status toggle
router.patch('/:id/status', async (req, res) => {
  const pool = req.app.get('pool');
  const hotel = await new HotelsDAO(pool).patch(req.params.id, { status: req.body.status });
  if (req.headers['hx-request']) {
    return res.render('partials/status-badge', { pageData: { hotel } });
  }
  res.json(hotel);
});

// PATCH /hotels/:id/ratings — save 6-dim ratings (HTMX bottom sheet)
router.patch('/:id/ratings', async (req, res) => {
  const pool = req.app.get('pool');
  const fields = {};
  ['beach','property','food','pools','location','value'].forEach(d => {
    if (req.body[`rating_${d}`]) fields[`rating_${d}`] = parseInt(req.body[`rating_${d}`]);
  });
  const hotel = await new HotelsDAO(pool).patch(req.params.id, fields);
  if (req.headers['hx-request']) {
    return res.render('partials/hotel-card', { pageData: { hotel } });
  }
  res.json(hotel);
});

// DELETE /hotels/:id
router.delete('/:id', async (req, res) => {
  const pool = req.app.get('pool');
  const HotelsDAO_ = new HotelsDAO(pool);
  const hotel = await HotelsDAO_.getById(req.params.id);
  const tripId = hotel?.trip_id;
  await HotelsDAO_.delete(req.params.id);
  if (req.headers['hx-request']) {
    res.header('HX-Redirect', `/trips/${tripId}`);
    return res.send('');
  }
  res.redirect(`/trips/${tripId}`);
});

// POST /hotels/:id/links — add a link
router.post('/:id/links', async (req, res) => {
  const pool = req.app.get('pool');
  const link = await new HotelLinksDAO(pool).addLink({
    hotel_id: req.params.id,
    ...req.body,
  });
  if (req.headers['hx-request']) {
    return res.render('partials/link-row', { pageData: { link } });
  }
  res.json(link);
});

// DELETE /hotels/:id/links/:linkId
router.delete('/:id/links/:linkId', async (req, res) => {
  const pool = req.app.get('pool');
  await new HotelLinksDAO(pool).deleteLink(req.params.linkId);
  res.send('');
});

module.exports = router;
