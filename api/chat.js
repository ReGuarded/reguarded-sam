// ReGuarded v4.0 — Admin Dashboard + Code Management
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
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

    // ── ADMIN AUTH ──
    if (type === 'admin-auth') {
      const { password } = body;
      if (password === ADMIN_PASSWORD) {
        return res.status(200).json({ success: true });
      }
      return res.status(200).json({ success: false });
    }

    // ── VALIDATE INVITE CODE ──
    if (type === 'validate-code') {
      const { code } = body;
      if (!code) return res.status(200).json({ valid: false });

      const codeRes = await fetch(
        SUPABASE_URL + '/rest/v1/invite_codes?code=eq.' + encodeURIComponent(code.toUpperCase()) + '&active=eq.true&select=id,code,used_count',
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json'
          }
        }
      );
      const codes = await codeRes.json();

      if (codes && codes.length > 0) {
        // Increment used_count
        await fetch(
          SUPABASE_URL + '/rest/v1/invite_codes?id=eq.' + codes[0].id,
          {
            method: 'PATCH',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': 'Bearer ' + SUPABASE_KEY,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ used_count: (codes[0].used_count || 0) + 1 })
          }
        );
        return res.status(200).json({ valid: true, code: codes[0].code });
      }
      return res.status(200).json({ valid: false });
    }

    // ── LIST CODES ──
    if (type === 'list-codes') {
      const codesRes = await fetch(
        SUPABASE_URL + '/rest/v1/invite_codes?select=*&order=created_at.desc',
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json'
          }
        }
      );
      const codes = await codesRes.json();
      return res.status(200).json({ success: true, codes });
    }

    // ── CREATE CODE ──
    if (type === 'create-code') {
      const { code, label } = body;
      if (!code || !label) return res.status(200).json({ success: false, error: 'Code and label required' });

      // Check for duplicate
      const dupRes = await fetch(
        SUPABASE_URL + '/rest/v1/invite_codes?code=eq.' + encodeURIComponent(code.toUpperCase()) + '&select=id',
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY
          }
        }
      );
      const dup = await dupRes.json();
      if (dup && dup.length > 0) {
        return res.status(200).json({ success: false, error: 'That code already exists. Choose a different one.' });
      }

      const insertRes = await fetch(
        SUPABASE_URL + '/rest/v1/invite_codes',
        {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({ code: code.toUpperCase(), label, active: true, used_count: 0 })
        }
      );
      const inserted = await insertRes.json();
      return res.status(200).json({ success: true, code: inserted[0] });
    }

    // ── TOGGLE CODE (activate/deactivate) ──
    if (type === 'toggle-code') {
      const { id, active } = body;
      if (!id) return res.status(200).json({ success: false });

      await fetch(
        SUPABASE_URL + '/rest/v1/invite_codes?id=eq.' + id,
        {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ active })
        }
      );
      return res.status(200).json({ success: true });
    }

    // ── JOIN WAITLIST ──
    if (type === 'join-waitlist') {
      const { email, source } = body;
      if (!email) return res.status(400).json({ success: false, error: 'Email required' });

      const RESEND_KEY = process.env.RESEND_API_KEY;

      // Check for duplicate
      const dupRes = await fetch(
        SUPABASE_URL + '/rest/v1/waitlist?email=eq.' + encodeURIComponent(email.toLowerCase()) + '&select=id',
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY
          }
        }
      );
      const dup = await dupRes.json();
      if (dup && dup.length > 0) {
        return res.status(200).json({ success: true, alreadyExists: true });
      }

      // Save to Supabase
      const insertRes = await fetch(
        SUPABASE_URL + '/rest/v1/waitlist',
        {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({
            email: email.toLowerCase(),
            source: source || 'website'
          })
        }
      );
      const inserted = await insertRes.json();

      // Send email notification via Resend
      if (RESEND_KEY) {
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + RESEND_KEY,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: 'Sam U <notifications@reguarded.io>',
              to: 'joeyterrazas1@gmail.com',
              subject: '🛡️ New Sam U Waitlist Signup',
              html: `
                <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
                  <img src="https://reguarded-sam.vercel.app/sam-u-logo.png" width="60" style="margin-bottom:20px;display:block;"/>
                  <h2 style="color:#1B3A6B;font-size:20px;margin-bottom:8px;">New waitlist signup</h2>
                  <p style="color:#3a5a8a;font-size:15px;margin-bottom:20px;">Someone just joined the Sam U waitlist.</p>
                  <div style="background:#f0f6fc;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
                    <div style="font-size:13px;color:#6a85a8;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Email</div>
                    <div style="font-size:16px;font-weight:500;color:#1B3A6B;">${email.toLowerCase()}</div>
                  </div>
                  <div style="background:#f0f6fc;border-radius:10px;padding:16px 20px;">
                    <div style="font-size:13px;color:#6a85a8;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Source</div>
                    <div style="font-size:16px;font-weight:500;color:#1B3A6B;">${source || 'website'}</div>
                  </div>
                  <p style="color:#6a85a8;font-size:12px;margin-top:24px;">Sam U by ReGuarded · reguarded.io</p>
                </div>
              `
            })
          });
        } catch(e) {
          // Email failure is non-blocking — signup still succeeds
          console.error('Resend error:', e.message);
        }
      }

      return res.status(200).json({ success: true, entry: inserted[0] });
    }
    if (type === 'count-users') {
      const countRes = await fetch(
        SUPABASE_URL + '/rest/v1/profiles?select=id',
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'count=exact',
            'Range': '0-0'
          }
        }
      );
      const countHeader = countRes.headers.get('content-range');
      const count = countHeader ? parseInt(countHeader.split('/')[1]) : 0;
      return res.status(200).json({ success: true, count });
    }

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

