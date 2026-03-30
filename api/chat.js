export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { type, system, messages, max_tokens, query, location, radius, school, schoolUrl } = req.body;

    // ── CAMPUS SAFETY LOOKUP ──
    if (type === 'campus-safety') {
      const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

      const prompt = `You are a research assistant helping find campus safety and security contact information for college students and their parents.

Search for and extract the current safety and security resources for: ${school}

Look for these specific resources:
1. Campus Police / University Police (main number)
2. Campus Police Emergency number (if different)
3. Safe Walk / Safe Ride / Escort Service (name and number)
4. Student Health Services / Campus Health (main number)
5. Counseling & Mental Health Crisis Line (24/7 if available)
6. Title IX Office
7. Dean of Students emergency contact
8. Any other critical 24/7 safety resources

Return ONLY a JSON object in this exact format, no other text:
{
  "campusPolice": { "name": "...", "phone": "...", "hours": "24/7" },
  "safeWalk": { "name": "...", "phone": "...", "description": "..." },
  "studentHealth": { "name": "...", "phone": "...", "hours": "..." },
  "counseling": { "name": "...", "phone": "...", "hours": "24/7 crisis line" },
  "titleIX": { "name": "...", "phone": "...", "email": "..." },
  "deanOfStudents": { "name": "...", "phone": "..." },
  "other": [
    { "name": "...", "phone": "...", "description": "..." }
  ],
  "website": "official safety page URL",
  "lastVerified": "Please verify these numbers directly with the university"
}

Use your knowledge of ${school} to provide accurate current contact information. If you are not certain of a specific number, omit that field rather than guess.`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const data = await response.json();
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');

      try {
        const clean = text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        return res.status(200).json({ success: true, contacts: parsed });
      } catch(e) {
        return res.status(200).json({ success: false, error: 'Could not parse contacts', raw: text });
      }
    }

    // ── PLACES SEARCH ──
    if (type === 'places') {
      const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;
      if (!GOOGLE_KEY) return res.status(500).json({ error: 'Google Maps API key not configured' });

      const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${GOOGLE_KEY}`;
      const geoRes = await fetch(geoUrl);
      const geoData = await geoRes.json();

      if (!geoData.results || geoData.results.length === 0) {
        return res.status(200).json({ results: [], error: 'Location not found' });
      }

      const { lat, lng } = geoData.results[0].geometry.location;
      const searchRadius = radius || 8000;

      const placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${searchRadius}&keyword=${encodeURIComponent(query)}&key=${GOOGLE_KEY}`;
      const placesRes = await fetch(placesUrl);
      const placesData = await placesRes.json();

      if (!placesData.results) {
        return res.status(200).json({ results: [], lat, lng });
      }

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

