// Fictional sample plan shown to first-time organizers.
const DEMO_TRIP = {
  name: 'A week away, together',
  description: 'Coast or countryside? A shared house, slow mornings, and a little exploring. Let’s find our kind of getaway.',
};

const DISCLAIMER = '\n\nFictional sample: not a real listing, provider, or current offer. Quotes are illustrative totals.';

async function seedDemoIdeas(addIdea) {
  const bay = await addIdea({ kind: 'destination', title: 'Dune Bay & the coast', location: 'Coastal getaway', notes: 'Beach walks, a small town to explore, and somewhere everyone can switch off. Worth comparing flight costs and how far we would need to drive.' + DISCLAIMER });
  const lake = await addIdea({ kind: 'destination', title: 'A quieter week at Cedar Lake', location: 'Lakeside escape', notes: 'A different direction: forest trails, swimming, and evenings around a big table. Could be easier to reach by car. How does everyone feel about a quieter trip?' + DISCLAIMER });
  await addIdea({ kind: 'stay', title: 'A shared house by the bay', location: 'Dune Bay', destination_id: String(bay.id), cost: '1800', currency: 'CAD', capacity: '6', notes: 'Three bedrooms, a kitchen for shared meals, and a terrace for long breakfasts. Example quote for the whole week. Check bed arrangements, cleaning fees, and cancellation terms.' + DISCLAIMER });
  await addIdea({ kind: 'stay', title: 'Two cabins, one lakeside spot', location: 'Cedar Lake', destination_id: String(lake.id), cost: '1400', currency: 'USD', capacity: '6', notes: 'More privacy for the group, with a shared outdoor space. Compare the full cost against one large house. The example quote is in USD, so keep it separate from CAD.' + DISCLAIMER });
  await addIdea({ kind: 'transport', title: 'One roomy rental for the week', location: 'Airport pickup', destination_id: String(bay.id), cost: '450', currency: 'CAD', capacity: '7', notes: 'A seven-seat rental could keep us together. Need to confirm luggage space with all seats in use, insurance, fuel policy, and additional-driver fees.' + DISCLAIMER });
  await addIdea({ kind: 'activity', title: 'An afternoon out on the water', location: 'Dune Bay', destination_id: String(bay.id), notes: 'Something to do together without filling every day. Check group availability and whether everyone is comfortable on a boat. No price yet—leave it out of the estimate.' + DISCLAIMER });
  await addIdea({ kind: 'link', title: 'What to check before we book', url: 'https://example.com/', notes: 'A place to collect the useful questions: total fees, sleeping arrangements, distance from the airport, cancellation dates, and whether a car is actually needed. The example.com link is a placeholder source for this sample only.' + DISCLAIMER });
}

module.exports = { DEMO_TRIP, seedDemoIdeas };
