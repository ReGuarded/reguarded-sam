export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
 
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
 
  try {
    const { type, system, messages, max_tokens, query, location, radius } = req.body;
 
    // ── PLACES SEARCH ──
    if (type === 'places') {
      const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;
      if (!GOOGLE_KEY) return res.status(500).json({ error: 'Google Maps API key not configured' });
 
      // First geocode the location (ZIP or city)
      const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_KEY}`;
      const geoRes = await fetch(geoUrl);
      const geoData = await geoRes.json();
 
      if (!geoData.results || geoData.results.length === 0) {
        return res.status(200).json({ results: [], error: 'Location not found' });
      }
 
      const { lat, lng } = geoData.results[0].geometry.location;
      const searchRadius = radius || 8000; // ~5 miles default
 
      // Search for nearby places
      const placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${searchRadius}&keyword=${encodeURIComponent(query)}&key=${GOOGLE_KEY}`;
      const placesRes = await fetch(placesUrl);
      const placesData = await placesRes.json();
 
      if (!placesData.results) {
        return res.status(200).json({ results: [], lat, lng });
      }
 
      // Get details for top 5 results
      const top5 = placesData.results.slice(0, 5);
      const detailed = await Promise.all(top5.map(async (place) => {
        const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_address,formatted_phone_number,rating,user_ratings_total,opening_hours,website,geometry&key=${GOOGLE_KEY}`;
        const detailRes = await fetch(detailUrl);
        const detailData = await detailRes.json();
        const d = detailData.result || {};
        return {
          name: d.name || place.name,
          address: d.formatted_address || place.vicinity,
          phone: d.formatted_phone_number || null,
          rating: d.rating || place.rating || null,
          reviewCount: d.user_ratings_total || place.user_ratings_total || 0,
          isOpen: d.opening_hours?.open_now ?? null,
          website: d.website || null,
          lat: d.geometry?.location?.lat || place.geometry?.location?.lat,
          lng: d.geometry?.location?.lng || place.geometry?.location?.lng,
          placeId: place.place_id
        };
      }));
 
      // Sort by rating
      detailed.sort((a, b) => (b.rating || 0) - (a.rating || 0));
 
      return res.status(200).json({ results: detailed, centerLat: lat, centerLng: lng });
    }
 
    // ── AI CHAT ──
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: max_tokens || 1000,
        system,
        messages
      })
    });
 
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error || 'API error' });
    return res.status(200).json(data);
 
  } catch (err) {
    return res.status(500).json({ error: { message: err.message } });
  }
}
