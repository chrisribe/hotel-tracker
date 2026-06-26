const express = require('express');
const router = express.Router();
const TripsDAO = require('../dao/TripsDAO');

// GET /trips — trip list
router.get('/', async (req, res) => {
  const pool = req.app.get('pool');
  const trips = await new TripsDAO(pool).getAll();
  res.respondWithTemplateOrJson({ trips }, 'trips-page');
});

// GET /trips/partials/new-trip-form — HTMX inline form
router.get('/partials/new-trip-form', (req, res) => {
  res.render('partials/new-trip-form', { pageData: {} });
});

// POST /trips — create trip
router.post('/', async (req, res) => {
  const pool = req.app.get('pool');
  const trip = await new TripsDAO(pool).create(req.body);
  if (req.headers['hx-request']) {
    // Return just the new trip card to append into #trip-list
    return res.render('partials/trip-card', { pageData: { trip } });
  }
  res.redirect(`/trips/${trip.id}`);
});

// GET /trips/:id/compare — compare table view
router.get('/:id/compare', async (req, res) => {
  const pool = req.app.get('pool');
  const TripsDAO_ = new TripsDAO(pool);
  const HotelsDAO = require('../dao/HotelsDAO');
  const [trip, hotels] = await Promise.all([
    TripsDAO_.getById(req.params.id),
    new HotelsDAO(pool).getByTrip(req.params.id),
  ]);
  if (!trip) return res.status(404).send('Trip not found');
  res.respondWithTemplateOrJson({ trip, hotels }, 'compare-page');
});

// GET /trips/:id — trip dashboard
router.get('/:id', async (req, res) => {
  const pool = req.app.get('pool');
  const TripsDAO_ = new TripsDAO(pool);
  const HotelsDAO = require('../dao/HotelsDAO');
  const [trip, hotels] = await Promise.all([
    TripsDAO_.getById(req.params.id),
    new HotelsDAO(pool).getByTrip(req.params.id),
  ]);
  if (!trip) return res.status(404).send('Trip not found');
  res.respondWithTemplateOrJson({ trip, hotels }, 'dashboard-page');
});

// DELETE /trips/:id
router.delete('/:id', async (req, res) => {
  const pool = req.app.get('pool');
  await new TripsDAO(pool).delete(req.params.id);
  if (req.headers['hx-request']) {
    res.header('HX-Redirect', '/trips');
    return res.send('');
  }
  res.redirect('/trips');
});

module.exports = router;
