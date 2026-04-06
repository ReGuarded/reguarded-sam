// ReGuarded v3.0 — Phase 2: Persistent Profiles
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const { type, system, messages, max_tokens, query, location, radius, school } = body;

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

    // ── SAVE PROFILE ──
    if (type === 'save-profile') {
      const { profile } = body;
      if (!profile || !profile.email) {
        return res.status(400).json({ success: false, error: 'Email required' });
      }

      // Check if profile already exists for this email
      const checkRes = await fetch(
        SUPABASE_URL + '/rest/v1/profiles?email=eq.' + encodeURIComponent(profile.email.toLowerCase()) + '&select=id',
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json'
          }
        }
      );
      const existing = await checkRes.json();

      if (existing && existing.length > 0) {
        // Update existing profile
        const updateRes = await fetch(
          SUPABASE_URL + '/rest/v1/profiles?email=eq.' + encodeURIComponent(profile.email.toLowerCase()),
          {
            method: 'PATCH',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': 'Bearer ' + SUPABASE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=representation'
            },
            body: JSON.stringify({
              user_type: profile.userType,
              student_name: profile.name,
              school: profile.school,
              school_address: profile.schoolAddress,
              year: profile.year,
              housing: profile.housing,
              has_car: profile.hasCar ? profile.hasCar.join(', ') : '',
              emergency_name: profile.emergencyName,
              emergency_phone: profile.emergencyPhone,
              extra_context: profile.extraContext,
              invite_code: profile.inviteCode || ''
            })
          }
        );
        const updated = await updateRes.json();
        return res.status(200).json({ success: true, profile: updated[0], action: 'updated' });
      } else {
        // Insert new profile
        const insertRes = await fetch(
          SUPABASE_URL + '/rest/v1/profiles',
          {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': 'Bearer ' + SUPABASE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=representation'
            },
            body: JSON.stringify({
              email: profile.email.toLowerCase(),
              user_type: profile.userType,
              student_name: profile.name,
              school: profile.school,
              school_address: profile.schoolAddress,
              year: profile.year,
              housing: profile.housing,
              has_car: profile.hasCar ? profile.hasCar.join(', ') : '',
              emergency_name: profile.emergencyName,
              emergency_phone: profile.emergencyPhone,
              extra_context: profile.extraContext,
              invite_code: profile.inviteCode || ''
            })
          }
        );
        const inserted = await insertRes.json();
        return res.status(200).json({ success: true, profile: inserted[0], action: 'created' });
      }
    }

    // ── GET PROFILE ──
    if (type === 'get-profile') {
      const { email } = body;
      if (!email) return res.status(400).json({ success: false, error: 'Email required' });

      const profileRes = await fetch(
        SUPABASE_URL + '/rest/v1/profiles?email=eq.' + encodeURIComponent(email.toLowerCase()) + '&select=*&limit=1',
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json'
          }
        }
      );
      const profiles = await profileRes.json();

      if (profiles && profiles.length > 0) {
        const p = profiles[0];
        return res.status(200).json({
          success: true,
          found: true,
          profile: {
            name: p.student_name,
            userType: p.user_type,
            school: p.school,
            schoolAddress: p.school_address,
            year: p.year,
            housing: p.housing,
            hasCar: p.has_car ? p.has_car.split(', ').filter(Boolean) : [],
            emergencyName: p.emergency_name,
            emergencyPhone: p.emergency_phone,
            extraContext: p.extra_context,
            inviteCode: p.invite_code,
            email: p.email
          }
        });
      } else {
        return res.status(200).json({ success: true, found: false });
      }
    }

    // ── CAMPUS SAFETY LOOKUP ──
    if (type === 'campus-safety') {
      const prompt = 'You are a research assistant. Find current campus safety contacts for: ' + school + '\n\nReturn ONLY a JSON object with these fields (omit any you are not confident about):\n{"campusPolice":{"name":"...","phone":"...","hours":"24/7"},"safeWalk":{"name":"...","phone":"...","description":"..."},"studentHealth":{"name":"...","phone":"...","hours":"..."},"counseling":{"name":"...","phone":"...","hours":"..."},"deanOfStudents":{"name":"...","phone":"..."},"other":[{"name":"...","phone":"...","description":"..."}],"website":"..."}';

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const aiData = await aiRes.json();
      const text = (aiData.content || []).filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('');

      try {
        const clean = text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        return res.status(200).json({ success: true, contacts: parsed });
      } catch(e) {
        return res.status(200).json({ success: false, error: 'Parse error', raw: text });
      }
    }

    // ── PLACES SEARCH ──
    if (type === 'places') {
      const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;
      if (!GOOGLE_KEY) {
        return res.status(200).json({ results: [], error: 'Google Maps API key not configured' });
      }

      const geoUrl = 'https://maps.googleapis.com/maps/api/geocode/json?address=' + encodeURIComponent(location) + '&key=' + GOOGLE_KEY;
      const geoRes = await fetch(geoUrl);
      const geoData = await geoRes.json();

      if (!geoData.results || geoData.results.length === 0) {
        return res.status(200).json({ results: [], error: 'Location not found', debug: geoData.status });
      }

      const lat = geoData.results[0].geometry.location.lat;
      const lng = geoData.results[0].geometry.location.lng;
      const searchRadius = radius || 8000;

      const placesUrl = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=' + lat + ',' + lng + '&radius=' + searchRadius + '&keyword=' + encodeURIComponent(query) + '&key=' + GOOGLE_KEY;
      const placesRes = await fetch(placesUrl);
      const placesData = await placesRes.json();

      if (!placesData.results || placesData.results.length === 0) {
        return res.status(200).json({ results: [], centerLat: lat, centerLng: lng, debug: placesData.status });
      }

      const top5 = placesData.results.slice(0, 5);
      const detailed = await Promise.all(top5.map(async function(place) {
        try {
          const detailUrl = 'https://maps.googleapis.com/maps/api/place/details/json?place_id=' + place.place_id + '&fields=name,formatted_address,formatted_phone_number,rating,user_ratings_total,opening_hours,geometry&key=' + GOOGLE_KEY;
          const detailRes = await fetch(detailUrl);
          const detailData = await detailRes.json();
          const d = detailData.result || {};
          return {
            name: d.name || place.name,
            address: d.formatted_address || place.vicinity,
            phone: d.formatted_phone_number || null,
            rating: d.rating || place.rating || null,
            reviewCount: d.user_ratings_total || place.user_ratings_total || 0,
            isOpen: d.opening_hours ? d.opening_hours.open_now : null,
            placeId: place.place_id
          };
        } catch(e) {
          return {
            name: place.name,
            address: place.vicinity,
            rating: place.rating || null,
            reviewCount: place.user_ratings_total || 0,
            placeId: place.place_id
          };
        }
      }));

      detailed.sort(function(a, b) { return (b.rating || 0) - (a.rating || 0); });
      return res.status(200).json({ results: detailed, centerLat: lat, centerLng: lng });
    }

    // ── AI CHAT ──
    const aiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: max_tokens || 1000,
        system: system,
        messages: messages
      })
    });

    const data = await aiResponse.json();
    if (!aiResponse.ok) {
      return res.status(aiResponse.status).json({ error: data.error || 'API error' });
    }
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: { message: err.message, stack: err.stack } });
  }
};
