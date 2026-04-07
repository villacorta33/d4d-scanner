const express    = require('express');
const multer     = require('multer');
const axios      = require('axios');
const { parse }  = require('csv-parse/sync');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const fs         = require('fs');
const path       = require('path');

const app    = express();
const upload = multer({ dest: 'uploads/', limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB limit

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads', { recursive: true });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname)); // fallback to root

// ── IN-MEMORY JOB STORE ────────────────────────────────────────────────────
const jobs = {};

// ── ENV VARS ───────────────────────────────────────────────────────────────
const CLAUDE_MODEL = 'claude-haiku-4-5';

// ── PROMPTS ────────────────────────────────────────────────────────────────
const PROMPT_STREETVIEW = `You are a real estate wholesaler AI analyzing a Google Street View image of a residential property. Your job is to assess vacancy signals first, inspect the property zone by zone, then score it.

STEP 1 — ASSESS VACANCY FIRST (before scoring anything):
Carefully scan the entire image for the following vacancy signals. Count how many are present:
- No curtains, blinds, or window coverings visible on ANY window
- Boarded windows or doors
- Vegetation growing onto, against, or consuming the structure
- Entry path, walkway, or steps overgrown or inaccessible
- No vehicles, furniture, or personal items visible anywhere on the property
- Mail or packages visibly accumulating or overflowing
- Interior appears completely dark with no signs of habitation
- Official notices posted on structure
- Abandoned, unregistered, or deteriorating vehicles (RVs, old cars, trucks) sitting on property suggesting long-term neglect
- Large debris piles or dumped items suggesting no active occupant

If 2 or more of these signals are present = vacant: true
When in doubt, mark vacant = true
Do this assessment thoroughly — do not rush it

STEP 2 — ZONE-BY-ZONE INSPECTION (do this before scoring):
Do NOT form a general impression of the property. Inspect each zone independently and record what you find:

ROOF ZONES — examine each separately:
- Left slope: any dark patches, discoloration, uneven texture, moss, or algae?
- Right slope: any dark patches, discoloration, uneven texture, moss, or algae?
- Ridge and peak: any sagging, separation, or damage?
- Area around chimney and vents: any dark patches, cracking, or damage?
IF YOU SEE ANY discoloration, dark patches, or uneven texture on ANY roof zone — you must flag it. Do not describe the roof as intact if any zone shows irregularity.

EXTERIOR ZONES — examine each separately:
- Lower siding: paint peeling, flaking, bare wood, or weathering?
- Upper siding: paint peeling, flaking, or weathering?
- Window frames and trim: peeling, rotting, or deteriorating?
- Fascia and soffit: damaged, rotting, or missing?
- Chimney: staining, crumbling mortar, missing bricks, weathering, or discoloration?
- Garage door: dented, misaligned, damaged, or failing?
- Windows: any window-mounted AC units visible? Count them.

YARD ZONES — examine each separately:
- Front yard: grass height, debris, fallen limbs, dead trees?
- Side yards (if visible): overgrowth, vegetation against walls?
- Driveway and entry: cracking, overgrowth, accessibility?
NOTE: Dead standing trunks, snapped tree trunks, or large fallen limbs are major debris — not small clutter.

THOROUGH SCANNING RULE — apply before and during zone inspection:
Scan the ENTIRE image thoroughly before concluding anything. Do not let any single element — a tree, a shrub, a vehicle, or any other object — anchor your overall assessment. Inspect everything visible around, beside, and through any obstruction. The driveway, entry path, sides of the house, windows, and all visible wall sections must be assessed independently regardless of what else is in the frame.

PARTIAL VISIBILITY RULE:
If ANY distress signal is visible anywhere in the image — even partially, at the edge of the frame, or through an obstruction — flag it at full weight. Partial visibility never reduces a flag.

ANTI-HEDGING RULE — apply before scoring:
If your zone inspection found ANY of the following, you MUST flag it. Do not use words like "minor," "slight," "some," "a little," or "not severe" to dismiss something you observed:
- Any roof discoloration, dark patches, uneven texture, or moss/algae on any zone → flag as missing shingles (major indicator) or heavy moss (significant minor) depending on appearance
- Any chimney weathering, staining, or deterioration → flag as chimney deterioration (significant minor)
- Any paint peeling, flaking, or absent from multiple sections → flag as paint deterioration (significant minor)
- Any fallen limb, dead trunk, or large branch → flag as major debris (significant minor)
- Any window AC units observed → flag as window AC units (mild minor) and state the count
- Any porch deterioration, sagging, or worn railings → flag as porch deteriorating (significant minor)
Only flag signals you actually observed in your zone inspection. Do not manufacture signals not visible in the image.

STEP 3 — SCORE THE PROPERTY:
You are NOT scoring overall property condition. You are answering one question:
HOW URGENTLY SHOULD A WHOLESALER CALL THIS PROPERTY?

SCORING SCALE:
9-10 = Call today — three or more major indicators, or major indicators + strong vacancy signals
7-8  = Strong lead — one or two major indicators clearly visible
5-6  = Warm lead — significant minor signals present, or minor signals stacking
3    = Weak lead — only one mild minor signal visible
1-2  = Skip — well maintained, no meaningful distress visible

MAJOR INDICATORS — any single one present = minimum score of 7, no exceptions:
- Roof tarp or patching material visible anywhere on roof
- Missing shingles — significant bare patches, exposed decking, OR dark irregular patches on ANY zone of the roof. A single dark patch on any zone is enough. When in doubt, treat as missing shingles.
- Roof visibly broken, collapsed, or severely damaged
- Sagging roofline on main structure or any attached structure
- Fire damage — charring, scorching, smoke staining, burned sections anywhere on structure
- Boarded windows — any window covered with plywood or boards
- Boarded doors — any door covered with plywood or barricaded shut
- Collapsing or severely deteriorated porch
- Collapsing or severely deteriorated carport — check SIDES and REAR of the property too
- Structural instability — leaning walls, severe foundation failure, tilting structure
- Extensive exterior wall damage — large cracks, holes, or exposed framing
- Code violation notice — any official notice or condemnation sign posted on structure

MAJOR INDICATOR SCORING RULES:
- 1 major indicator = score 7 minimum
- 2 major indicators = score 8 minimum
- 3 or more major indicators = score 9 minimum
- 3 or more major indicators + 2 or more vacancy signals = score 10
- Score CANNOT exceed 7 unless at least one major indicator is present
- When in doubt whether something qualifies as a major indicator, treat it as one

MINOR SIGNALS — two tiers, apply only when NO major indicators are present:

SIGNIFICANT MINOR SIGNALS — any single one = minimum score of 5:
- Heavy moss or algae covering a significant portion of any roof slope
- Vegetation severely consuming or pressing against exterior walls on any side
- Large trees or shrubs severely obscuring the entire property from the street
- Paint visibly peeling, flaking, or absent across multiple visible sections
- Chimney showing visible deterioration — staining, weathering, crumbling, or discoloration
- Porch visibly deteriorating — sagging floor, rotting wood, or failing railings
- Major debris — fallen trees, dead or snapped trunks, large broken limbs, large dumped items
- Extensive mold, mildew, or biological staining across most of exterior
- Heavily damaged or completely missing gutters across most of roofline
- Fence completely collapsed or missing across most of the property

MILD MINOR SIGNALS:
- Window AC units (any) — state the count
- Slightly overgrown grass or landscaping
- Minor peeling paint or fading on limited sections
- Small debris items or clutter in yard
- Slightly damaged gutters
- Bars on windows
- Mismatched repairs or patchwork exterior
- Mail overflow or packages piled up
- No curtains + dark interior
- Broken or missing windows (not boarded)
- Overgrown grass 8+ inches
- Abandoned or deteriorating vehicle on property
- Damaged, dented, misaligned, or failing garage door

MINOR SIGNAL SCORING TABLE — no ranges, use exact values:
- 0 signals = 2
- 1 mild minor signal = 3
- 2 mild minor signals = 5
- 3 mild minor signals = 6
- 4 or more mild minor signals = 7 (hard cap without major indicator)
- 1 significant minor signal = 5
- 2 significant minor signals = 6
- 1 significant minor + 1 mild minor = 6
- 1 significant minor + 2 or more mild minors = 7
- 2 significant minor + any mild = 7
- 3 or more significant minor signals = 7 (hard cap without major indicator)
- Always choose the higher value when signals fall across multiple rules
- You are scoring Class C and D neighborhood properties — score accordingly

STEP 4 — NOTES:
Write 2-3 sentences referencing your zone inspection findings. Always describe roof condition by zone. Always mention chimney if deterioration found. Always mention window AC units if present and state the count. Always mention vacancy signals if present. Do not use vague language.

OUTPUT — raw JSON only, no markdown, no backticks, no explanation:
{"score":1,"priority":"skip","vacant":false,"notes":""}`;

const PROMPT_SATELLITE = `You are a real estate wholesaler AI analyzing a satellite (aerial/overhead) image of a residential property. Your job is to assess the property from above — focusing on roof condition, lot condition, and overall property state.

STEP 1 — ASSESS VACANCY SIGNALS FROM ABOVE:
Carefully scan the entire image for the following vacancy signals visible from satellite. Count how many are present:
- Severely overgrown lot — grass, weeds, or vegetation covering most of the property
- Vegetation consuming or overtaking the structure from above
- No vehicles visible anywhere on the property
- Pool visibly green, debris-filled, or collapsed
- Large debris piles or dumped items visible on the lot
- Abandoned or deteriorating vehicles on the property
- Entry path, driveway, or walkways completely overgrown or inaccessible
- Collapsed or severely deteriorated outbuildings, sheds, or structures

If 2 or more of these signals are present = vacant: true
When in doubt, mark vacant = true

STEP 2 — AERIAL ZONE INSPECTION (do this before scoring):
Do NOT form a general impression. Inspect each zone independently from above:

ROOF ZONES — examine the entire roof surface carefully:
- Left slope: any tarps, dark patches, missing shingles, uneven texture, moss, or algae?
- Right slope: any tarps, dark patches, missing shingles, uneven texture, moss, or algae?
- Ridge and peak: any sagging, separation, collapse, or damage?
- Around chimney and vents: any damage, dark patches, or deterioration?
- Overall roof surface: any patching material, discoloration, or irregular sections?
A tarp or missing shingles is unmistakable from above. Flag any irregularity on any section.

LOT AND STRUCTURE ZONES — examine each separately:
- Full lot: grass height across entire property, debris anywhere on lot?
- Rear yard: condition, debris, abandoned items, overgrowth?
- Pool (if visible): clean and maintained, or green/debris-filled/collapsed?
- Detached structures: garage, shed, carport — intact or collapsed/deteriorated?
- Driveway and entry: accessible, overgrown, or deteriorated?
- Vegetation: any consuming or overtaking the structure from above?
- Neighboring properties: how does this property compare to neighbors?

THOROUGH SCANNING RULE:
Scan the ENTIRE image. Do not let the main structure dominate your assessment — inspect the full lot including rear yard, sides, and all outbuildings. Partial visibility of a signal still counts at full weight.

ANTI-HEDGING RULE — apply before scoring:
If your aerial inspection found ANY of the following, you MUST flag it:
- Any roof tarp, dark patches, missing shingles, or damage on any roof zone → flag as major indicator
- Any sagging roofline or collapsed roof section → flag as major indicator
- Green, debris-filled, or collapsed pool → flag as major indicator
- Any collapsed or severely deteriorated outbuilding or carport → flag as major indicator
- Severely overgrown lot consuming most of the property → flag as significant minor
- Major debris piles anywhere on lot → flag as significant minor
- Heavy moss or algae on roof → flag as significant minor
- Abandoned vehicles on property → flag as mild minor
Do not use words like "minor," "slight," or "some" to dismiss signals you observed.

STEP 3 — SCORE THE PROPERTY:
You are answering one question: HOW URGENTLY SHOULD A WHOLESALER CALL THIS PROPERTY based on what is visible from above?

SCORING SCALE:
9-10 = Call today — multiple major indicators visible from above
7-8  = Strong lead — at least one major indicator clearly visible
5-6  = Warm lead — significant distress signals present
3    = Weak lead — minor signals only
1-2  = Skip — well maintained, no meaningful distress visible

MAJOR INDICATORS — any single one = minimum score of 7, no exceptions:
- Roof tarp or patching material visible anywhere on roof
- Missing shingles — bare patches, exposed decking, OR dark irregular patches on ANY roof zone
- Roof visibly collapsed, broken, or severely damaged
- Sagging roofline visible from above
- Fire damage — charring or burned sections visible from above
- Green, debris-filled, or collapsed swimming pool
- Collapsing or severely deteriorated carport or outbuilding visible from above
- Structural collapse or severe instability visible from above

MAJOR INDICATOR SCORING RULES:
- 1 major indicator = score 7 minimum
- 2 major indicators = score 8 minimum
- 3 or more major indicators = score 9 minimum
- 3 or more major indicators + 2 or more vacancy signals = score 10
- Score CANNOT exceed 7 unless at least one major indicator is present
- When in doubt whether something qualifies as a major indicator, treat it as one

SIGNIFICANT MINOR SIGNALS — any single one = minimum score of 5:
- Heavy moss or algae covering a significant portion of any roof slope
- Severely overgrown lot — grass and weeds consuming most of the property
- Vegetation overtaking or consuming the structure from above
- Major debris piles anywhere on the lot — fallen trees, large dumped items, significant accumulation
- Collapsed or severely deteriorated fence across most of the property
- Severely neglected lot compared to all neighboring properties
- Pool visibly dirty, poorly maintained, or partially green (not fully green)

MILD MINOR SIGNALS:
- Slightly overgrown grass or landscaping
- Minor debris or clutter visible on lot
- Abandoned or deteriorating vehicle on property
- Cracked or deteriorated driveway
- Small detached structure in poor condition
- Slightly neglected lot vs neighbors

MINOR SIGNAL SCORING TABLE — no ranges, use exact values:
- 0 signals = 2
- 1 mild minor signal = 3
- 2 mild minor signals = 5
- 3 mild minor signals = 6
- 4 or more mild minor signals = 7 (hard cap without major indicator)
- 1 significant minor signal = 5
- 2 significant minor signals = 6
- 1 significant minor + 1 mild minor = 6
- 1 significant minor + 2 or more mild minors = 7
- 2 significant minor + any mild = 7
- 3 or more significant minor signals = 7 (hard cap without major indicator)
- Always choose the higher value when signals fall across multiple rules

STEP 4 — NOTES:
Write 2-3 sentences describing what you see from above. Always describe roof condition specifically. Always mention pool condition if a pool is visible. Always mention lot condition. Do not use vague language.

OUTPUT — raw JSON only, no markdown, no backticks, no explanation:
{"score":1,"priority":"skip","vacant":false,"notes":""}`;

// ── HELPERS ────────────────────────────────────────────────────────────────

function parseCSVContent(content) {
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true
  });
  return records;
}

function detectColumns(headers) {
  const lower = {};
  headers.forEach(h => { lower[h.toLowerCase()] = h; });
  function find(...terms) {
    for (const term of terms) {
      for (const lh in lower) {
        if (lh.includes(term)) return lower[lh];
      }
    }
    return '';
  }
  return {
    address: find('property address', 'address', 'street'),
    city:    find('property city', 'city'),
    state:   find('property state', 'state'),
    zip:     find('property zip', 'zip', 'postal'),
    owner:   find('owner', 'first name', 'contact')
  };
}

async function fetchStreetView(address, gmapsKey, pitch = '5') {
  const url = `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${encodeURIComponent(address)}&key=${gmapsKey}&fov=90&pitch=${pitch}`;
  try {
    const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
    const ct = r.headers['content-type'] || 'image/jpeg';
    if (!ct.includes('image')) return { ok: false };
    return { ok: true, b64: Buffer.from(r.data).toString('base64'), mime: ct.split(';')[0] };
  } catch(e) {
    return { ok: false };
  }
}

async function fetchSatellite(address, gmapsKey) {
  try {
    // Geocode first
    const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${gmapsKey}`;
    const geoR = await axios.get(geoUrl, { timeout: 10000 });
    let center = encodeURIComponent(address);
    if (geoR.data.results && geoR.data.results[0]) {
      const loc = geoR.data.results[0].geometry.location;
      center = `${loc.lat},${loc.lng}`;
    }
    const url = `https://maps.googleapis.com/maps/api/staticmap?center=${center}&zoom=20&size=640x640&maptype=satellite&markers=color:red|${center}&key=${gmapsKey}`;
    const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
    const ct = r.headers['content-type'] || 'image/jpeg';
    if (!ct.includes('image')) return { ok: false };
    return { ok: true, b64: Buffer.from(r.data).toString('base64'), mime: ct.split(';')[0] };
  } catch(e) {
    return { ok: false };
  }
}

function buildClaudeRequest(customId, prompt, imgResult) {
  return {
    custom_id: customId,
    params: {
      model: CLAUDE_MODEL,
      max_tokens: 800,
      temperature: 0.1,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image', source: { type: 'base64', media_type: imgResult.mime, data: imgResult.b64 } }
        ]
      }]
    }
  };
}

async function submitClaudeBatch(requests, claudeKey) {
  const r = await axios.post('https://api.anthropic.com/v1/messages/batches',
    { requests },
    {
      headers: {
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'message-batches-2024-09-24',
        'content-type': 'application/json'
      },
      timeout: 60000
    }
  );
  return r.data.id;
}

async function pollClaudeBatch(batchId, claudeKey) {
  const r = await axios.get(`https://api.anthropic.com/v1/messages/batches/${batchId}`, {
    headers: {
      'x-api-key': claudeKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'message-batches-2024-09-24'
    }
  });
  return r.data;
}

async function fetchClaudeBatchResults(batchId, claudeKey) {
  const r = await axios.get(`https://api.anthropic.com/v1/messages/batches/${batchId}/results`, {
    headers: {
      'x-api-key': claudeKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'message-batches-2024-09-24'
    },
    responseType: 'text'
  });
  const resultMap = {};
  const lines = r.data.split('\n').filter(l => l.trim());
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const key = obj.custom_id || '';
      let text = '';
      if (obj.result && obj.result.type === 'succeeded') {
        text = obj.result.message.content[0].text || '';
      }
      text = text.replace(/```json|```/g, '').trim();
      const m = text.match(/\{[\s\S]*\}/);
      try { resultMap[key] = JSON.parse(m ? m[0] : text); } catch(e) { resultMap[key] = {}; }
    } catch(e) {}
  }
  return resultMap;
}

function parseResult(p) {
  return {
    score: Math.max(1, Math.min(10, parseInt(p.score || 1))),
    vacant: !!p.vacant,
    notes: p.notes || ''
  };
}

// ── GOOGLE SHEETS ──────────────────────────────────────────────────────────

async function createSheet(results, threshold, imageMode) {
  const serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccountKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
  });
  const client   = await auth.getClient();
  const sheets   = google.sheets({ version: 'v4', auth: client });
  const drive    = google.drive({ version: 'v3', auth: client });

  // Create spreadsheet
  const ss = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `D4D Scan Results — ${new Date().toLocaleDateString()}` },
      sheets: [{ properties: { title: 'Results' } }]
    }
  });
  const ssId     = ss.data.spreadsheetId;
  const sheetId  = ss.data.sheets[0].properties.sheetId;

  // Build headers
  let headers;
  if (imageMode === 'both') {
    headers = ['Full Address', 'Owner', 'Street View Score', 'Satellite Score', 'Priority', 'Vacant', 'AI Notes'];
  } else if (imageMode === 'satellite') {
    headers = ['Full Address', 'Owner', 'Satellite Score', 'Priority', 'Vacant', 'AI Notes'];
  } else {
    headers = ['Full Address', 'Owner', 'Score', 'Priority', 'Vacant', 'AI Notes'];
  }

  // Build rows
  const rows = [headers];
  for (const r of results) {
    rows.push(headers.map(h => r[h] !== undefined ? r[h] : ''));
  }

  // Write data
  await sheets.spreadsheets.values.update({
    spreadsheetId: ssId,
    range: 'Results!A1',
    valueInputOption: 'RAW',
    requestBody: { values: rows }
  });

  // Format header row
  const requests = [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.067, green: 0.067, blue: 0.067 },
            textFormat: { foregroundColor: { red: 0.722, green: 0.961, blue: 0.259 }, bold: true }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)'
      }
    },
    { freezePane: { sheetId, startRowIndex: 1 } }
  ];

  // Color score cells
  const scoreColIndex = imageMode === 'both' ? 2 : 2;
  for (let i = 0; i < results.length; i++) {
    const r       = results[i];
    const rowIdx  = i + 1;
    const priCol  = headers.indexOf('Priority');
    const vacCol  = headers.indexOf('Vacant');
    let higher;
    if (imageMode === 'both') {
      higher = Math.max(parseInt(r['Street View Score'] || 0), parseInt(r['Satellite Score'] || 0));
    } else {
      higher = parseInt(r['Score'] || r['Satellite Score'] || 0);
    }
    const priority = r['Priority'];
    const bg = higher >= threshold
      ? { red: 0.992, green: 0.910, blue: 0.910 }
      : higher >= 5
        ? { red: 0.996, green: 0.976, blue: 0.906 }
        : { red: 0.961, green: 0.961, blue: 0.961 };

    // Score col(s)
    if (imageMode === 'both') {
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx+1, startColumnIndex: 2, endColumnIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: bg, textFormat: { bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } });
    } else {
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx+1, startColumnIndex: 2, endColumnIndex: 3 }, cell: { userEnteredFormat: { backgroundColor: bg, textFormat: { bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } });
    }

    // Priority color
    const priColor = priority === 'hot'
      ? { red: 0.753, green: 0.224, blue: 0.169 }
      : priority === 'warm'
        ? { red: 0.831, green: 0.525, blue: 0.039 }
        : { red: 0.533, green: 0.533, blue: 0.533 };
    requests.push({ repeatCell: { range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx+1, startColumnIndex: priCol, endColumnIndex: priCol+1 }, cell: { userEnteredFormat: { textFormat: { foregroundColor: priColor, bold: true } } }, fields: 'userEnteredFormat(textFormat)' } });

    // Vacant highlight
    if (r['Vacant'] === 'YES') {
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: rowIdx, endRowIndex: rowIdx+1, startColumnIndex: vacCol, endColumnIndex: vacCol+1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.992, green: 0.910, blue: 0.910 }, textFormat: { bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } });
    }
  }

  await sheets.spreadsheets.batchUpdate({ spreadsheetId: ssId, requestBody: { requests } });

  // Make sheet accessible via link
  await drive.permissions.create({
    fileId: ssId,
    requestBody: { role: 'reader', type: 'anyone' }
  });

  return `https://docs.google.com/spreadsheets/d/${ssId}`;
}

// ── ROUTES ─────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => res.json({ ok: true }));

// Upload CSV and get headers
app.post('/api/upload', upload.single('csv'), (req, res) => {
  try {
    if (!req.file) return res.json({ error: 'No file uploaded' });
    const content = fs.readFileSync(req.file.path, 'utf8');
    const records = parseCSVContent(content);
    if (!records.length) {
      fs.unlinkSync(req.file.path);
      return res.json({ error: 'CSV appears empty' });
    }
    const headers  = Object.keys(records[0]);
    const detected = detectColumns(headers);
    // Store file path temporarily
    const fileId = uuidv4();
    fs.renameSync(req.file.path, `uploads/${fileId}.csv`);
    res.json({
      fileId,
      headers,
      detected,
      rowCount: records.length,
      filename: req.file.originalname
    });
  } catch(e) {
    res.json({ error: e.message });
  }
});

// Start scan
app.post('/api/scan', async (req, res) => {
  const { fileId, colMap, maxProps, threshold, pitch, email, imageMode } = req.body;
  const gmapsKey  = req.body.gmapsKey  || process.env.GMAPS_KEY;
  const claudeKey = req.body.claudeKey || process.env.CLAUDE_KEY;

  if (!gmapsKey || !claudeKey) return res.json({ error: 'API keys not set' });
  if (!fileId) return res.json({ error: 'No file uploaded' });

  const jobId = uuidv4();
  jobs[jobId] = {
    status: 'starting',
    progress: 0,
    total: 0,
    fetched: 0,
    submitted: 0,
    batchId: null,
    sheetUrl: null,
    error: null,
    startTime: Date.now(),
    imageMode: imageMode || 'streetview'
  };

  res.json({ jobId });

  // Run scan in background
  runScan(jobId, fileId, colMap, parseInt(maxProps) || 999999, parseInt(threshold) || 7, pitch || '5', email || '', imageMode || 'streetview', gmapsKey, claudeKey);
});

// Get job status
app.get('/api/status/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.json({ error: 'Job not found' });
  res.json(job);
});

// Serve frontend
app.get('/', (req, res) => {
  const publicPath = path.join(__dirname, 'public', 'index.html');
  const rootPath   = path.join(__dirname, 'index.html');
  if (fs.existsSync(publicPath)) {
    res.sendFile(publicPath);
  } else if (fs.existsSync(rootPath)) {
    res.sendFile(rootPath);
  } else {
    res.send('D4D Scanner is running. index.html not found — check your file structure.');
  }
});

// ── SCAN RUNNER ────────────────────────────────────────────────────────────

async function runScan(jobId, fileId, colMap, maxProps, threshold, pitch, email, imageMode, gmapsKey, claudeKey) {
  const job = jobs[jobId];
  try {
    // Read CSV
    job.status = 'reading';
    const csvPath = `uploads/${fileId}.csv`;
    const content = fs.readFileSync(csvPath, 'utf8');
    const records = parseCSVContent(content);
    fs.unlinkSync(csvPath);

    const rows = records.slice(0, maxProps);
    job.total  = rows.length;

    // Build address list
    const addrList = [];
    rows.forEach((row, idx) => {
      const parts = [
        (row[colMap.address] || '').trim(),
        (row[colMap.city]    || '').trim(),
        (row[colMap.state]   || '').trim(),
        (row[colMap.zip]     || '').trim()
      ].filter(p => p);
      if (parts.length) {
        addrList.push({ index: idx, fullAddress: parts.join(', '), owner: (row[colMap.owner] || '').trim() });
      }
    });

    if (!addrList.length) throw new Error('No valid addresses found. Check column mapping.');

    // Phase 1: Fetch images
    job.status = 'fetching';
    const imgData = [];
    let fetched = 0;

    for (const item of addrList) {
      let sv = null, sat = null;
      if (imageMode === 'streetview' || imageMode === 'both') sv  = await fetchStreetView(item.fullAddress, gmapsKey, pitch);
      if (imageMode === 'satellite'  || imageMode === 'both') sat = await fetchSatellite(item.fullAddress, gmapsKey);
      const ok = (sv && sv.ok) || (sat && sat.ok);
      if (ok) fetched++;
      imgData.push({ ...item, sv, sat, ok });
      job.fetched = fetched;
      job.progress = Math.round((fetched / addrList.length) * 30); // 0-30%
      await new Promise(r => setTimeout(r, 100)); // small delay to avoid rate limits
    }

    if (fetched === 0) throw new Error('Could not fetch any images. Check API keys and billing.');

    // Phase 2: Build Claude batch requests
    job.status = 'submitting';
    const requests = [];
    for (const item of imgData) {
      if (!item.ok) continue;
      if (imageMode === 'streetview' && item.sv?.ok) requests.push(buildClaudeRequest(`sv_${item.index}`, PROMPT_STREETVIEW, item.sv));
      else if (imageMode === 'satellite' && item.sat?.ok) requests.push(buildClaudeRequest(`sat_${item.index}`, PROMPT_SATELLITE, item.sat));
      else if (imageMode === 'both') {
        if (item.sv?.ok)  requests.push(buildClaudeRequest(`sv_${item.index}`,  PROMPT_STREETVIEW, item.sv));
        if (item.sat?.ok) requests.push(buildClaudeRequest(`sat_${item.index}`, PROMPT_SATELLITE,  item.sat));
      }
    }

    if (!requests.length) throw new Error('No images available to submit.');
    job.submitted = requests.length;

    // Phase 3: Submit batch
    const batchId = await submitClaudeBatch(requests, claudeKey);
    job.batchId   = batchId;
    job.status    = 'processing';
    job.progress  = 35;

    // Phase 4: Poll for completion
    let complete = false;
    while (!complete) {
      await new Promise(r => setTimeout(r, 30000)); // wait 30 seconds
      const batchStatus = await pollClaudeBatch(batchId, claudeKey);
      const counts      = batchStatus.request_counts || {};
      const done        = (counts.succeeded || 0) + (counts.errored || 0);
      const total       = counts.processing !== undefined ? (counts.processing + done) : requests.length;
      job.progress      = 35 + Math.round((done / Math.max(total, 1)) * 55); // 35-90%

      if (batchStatus.processing_status === 'ended') {
        complete = true;
      } else if (['errored', 'expired', 'cancelled'].includes(batchStatus.processing_status)) {
        throw new Error(`Batch job ${batchStatus.processing_status}`);
      }
    }

    // Phase 5: Fetch results
    job.status   = 'saving';
    job.progress = 90;
    const resultMap = await fetchClaudeBatchResults(batchId, claudeKey);

    // Build results array in original order
    const results = [];
    for (const item of addrList) {
      if (imageMode === 'streetview') {
        const p        = parseResult(resultMap[`sv_${item.index}`] || {});
        const priority = p.score >= threshold ? 'hot' : p.score >= 5 ? 'warm' : 'skip';
        results.push({ 'Full Address': item.fullAddress, 'Owner': item.owner, 'Score': p.score, 'Priority': priority, 'Vacant': p.vacant ? 'YES' : 'NO', 'AI Notes': p.notes });
      } else if (imageMode === 'satellite') {
        const p        = parseResult(resultMap[`sat_${item.index}`] || {});
        const priority = p.score >= threshold ? 'hot' : p.score >= 5 ? 'warm' : 'skip';
        results.push({ 'Full Address': item.fullAddress, 'Owner': item.owner, 'Satellite Score': p.score, 'Priority': priority, 'Vacant': p.vacant ? 'YES' : 'NO', 'AI Notes': p.notes });
      } else {
        const sv       = parseResult(resultMap[`sv_${item.index}`]  || {});
        const sat      = parseResult(resultMap[`sat_${item.index}`] || {});
        const higher   = Math.max(sv.score, sat.score);
        const priority = higher >= threshold ? 'hot' : higher >= 5 ? 'warm' : 'skip';
        const vacant   = (sv.vacant || sat.vacant) ? 'YES' : 'NO';
        const notes    = [sv.notes && `Street View: ${sv.notes}`, sat.notes && `Satellite: ${sat.notes}`].filter(Boolean).join(' | ');
        results.push({ 'Full Address': item.fullAddress, 'Owner': item.owner, 'Street View Score': sv.score, 'Satellite Score': sat.score, 'Priority': priority, 'Vacant': vacant, 'AI Notes': notes });
      }
    }

    // Phase 6: Create sheet
    const sheetUrl = await createSheet(results, threshold, imageMode);
    job.sheetUrl  = sheetUrl;
    job.status    = 'complete';
    job.progress  = 100;

    // Send email
    if (email && process.env.SMTP_USER) {
      const hot  = results.filter(r => r['Priority'] === 'hot').length;
      const warm = results.filter(r => r['Priority'] === 'warm').length;
      const vac  = results.filter(r => r['Vacant']   === 'YES').length;
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
      await transporter.sendMail({
        from: process.env.SMTP_USER,
        to: email,
        subject: `D4D Scan Complete — ${results.length} properties scored`,
        text: `Your D4D Batch Scan is complete!\n\nTotal scanned: ${results.length}\nHot (${threshold}+): ${hot}\nWarm (5-${threshold-1}): ${warm}\nVacant: ${vac}\n\nView results: ${sheetUrl}\n\n— D4D Batch Scanner (Claude Haiku 4.5)`
      });
    }

  } catch(e) {
    job.status = 'error';
    job.error  = e.message;
    console.error(`Job ${jobId} failed:`, e.message);
  }
}

// ── START ──────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`D4D Scanner running on port ${PORT}`));
