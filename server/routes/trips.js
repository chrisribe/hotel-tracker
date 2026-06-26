const express = require('express');
const router = express.Router();
const TripsDAO = require('../dao/TripsDAO');

// GET /trips — trip list
router.get('/', async (req, res) => {
  const pool = req.app.get('pool');
  const trips = await new TripsDAO(pool).getAll();
  res.respondWithTemplateOrJson({ trips }, 'trips-page');
});

// POST /trips — create trip
router.post('/', async (req, res) => {
  const pool = req.app.get('pool');
  const trip = await new TripsDAO(pool).create(req.body);
  if (req.headers['hx-request']) {
    // Re-render trip list partial
    const trips = await new TripsDAO(pool).getAll();
    return res.render('partials/trip-list', { pageData: { trips } });
  }
  res.redirect(`/trips/${trip.id}`);
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
