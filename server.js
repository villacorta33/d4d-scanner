const express  = require('express');
const multer   = require('multer');
const axios    = require('axios');
const { parse } = require('csv-parse');
const { v4: uuidv4 } = require('uuid');
const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

const app    = express();
const upload = multer({ dest: 'uploads/', limits: { fileSize: 500 * 1024 * 1024 } });

// Ensure directories exist
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads', { recursive: true });
if (!fs.existsSync('results')) fs.mkdirSync('results', { recursive: true });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

const jobs = {};
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
IF YOU SEE ANY discoloration, dark patches, or uneven texture on ANY roof zone — you must flag it.

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

THOROUGH SCANNING RULE:
Scan the ENTIRE image thoroughly. Do not let any single element anchor your overall assessment. Inspect everything visible around, beside, and through any obstruction.

PARTIAL VISIBILITY RULE:
If ANY distress signal is visible anywhere in the image — even partially — flag it at full weight.

ANTI-HEDGING RULE:
If your zone inspection found ANY of the following, you MUST flag it. Do not use words like "minor," "slight," "some," or "not severe" to dismiss something you observed:
- Any roof discoloration, dark patches, or moss/algae → flag as missing shingles (major) or heavy moss (significant minor)
- Any chimney weathering or deterioration → flag as chimney deterioration (significant minor)
- Any paint peeling across multiple sections → flag as paint deterioration (significant minor)
- Any fallen limb, dead trunk, or large branch → flag as major debris (significant minor)
- Any window AC units → flag and state the count
- Any porch deterioration → flag as porch deteriorating (significant minor)

STEP 3 — SCORE THE PROPERTY:
HOW URGENTLY SHOULD A WHOLESALER CALL THIS PROPERTY?

9-10 = Call today — three or more major indicators, or major indicators + strong vacancy signals
7-8  = Strong lead — one or two major indicators clearly visible
5-6  = Warm lead — significant minor signals present, or minor signals stacking
3    = Weak lead — only one mild minor signal visible
1-2  = Skip — well maintained, no meaningful distress visible

MAJOR INDICATORS — any single one present = minimum score of 7, no exceptions:
- Roof tarp or patching material visible anywhere on roof
- Missing shingles — bare patches, exposed decking, OR dark irregular patches on ANY roof zone
- Roof visibly broken, collapsed, or severely damaged
- Sagging roofline on main structure or any attached structure
- Fire damage — charring, scorching, smoke staining, burned sections anywhere
- Boarded windows — any window covered with plywood or boards
- Boarded doors — any door covered with plywood or barricaded shut
- Collapsing or severely deteriorated porch
- Collapsing or severely deteriorated carport
- Structural instability — leaning walls, severe foundation failure, tilting structure
- Extensive exterior wall damage — large cracks, holes, or exposed framing
- Code violation notice — any official notice or condemnation sign posted

MAJOR INDICATOR SCORING RULES:
- 1 major = score 7 minimum
- 2 major = score 8 minimum
- 3+ major = score 9 minimum
- 3+ major + 2+ vacancy signals = score 10
- Score CANNOT exceed 7 unless at least one major indicator is present

SIGNIFICANT MINOR SIGNALS — any single one = minimum score of 5:
- Heavy moss or algae covering a significant portion of any roof slope
- Vegetation severely consuming or pressing against exterior walls
- Large trees or shrubs severely obscuring the entire property
- Paint visibly peeling, flaking, or absent across multiple visible sections
- Chimney showing visible deterioration
- Porch visibly deteriorating — sagging floor, rotting wood, or failing railings
- Major debris — fallen trees, dead or snapped trunks, large broken limbs
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

MINOR SIGNAL SCORING TABLE:
- 0 signals = 2
- 1 mild = 3
- 2 mild = 5
- 3 mild = 6
- 4+ mild = 7 (hard cap without major)
- 1 significant = 5
- 2 significant = 6
- 1 significant + 1 mild = 6
- 1 significant + 2+ mild = 7
- 2 significant + any mild = 7
- 3+ significant = 7 (hard cap without major)

STEP 4 — NOTES:
Write 2-3 sentences referencing your zone inspection findings. Always describe roof condition by zone. Always mention chimney if deterioration found. Always mention window AC units if present. Always mention vacancy signals if present. Do not use vague language.

OUTPUT — raw JSON only, no markdown, no backticks, no explanation:
{"score":1,"priority":"skip","vacant":false,"notes":""}`;

const PROMPT_SATELLITE = `You are a real estate wholesaler AI analyzing a satellite (aerial/overhead) image of a residential property. A red marker pin indicates the exact property to analyze — ignore all surrounding properties.

STEP 1 — ASSESS VACANCY SIGNALS FROM ABOVE:
- Severely overgrown lot
- Vegetation consuming or overtaking the structure
- No vehicles visible anywhere on the property
- Pool visibly green, debris-filled, or collapsed
- Large debris piles or dumped items on the lot
- Abandoned or deteriorating vehicles on the property
- Entry path or driveway completely overgrown
- Collapsed or severely deteriorated outbuildings

If 2 or more signals present = vacant: true. When in doubt, mark vacant = true.

STEP 2 — AERIAL ZONE INSPECTION:

ROOF ZONES:
- Left slope: tarps, dark patches, missing shingles, moss, algae?
- Right slope: tarps, dark patches, missing shingles, moss, algae?
- Ridge and peak: sagging, separation, collapse?
- Around chimney and vents: damage, dark patches?
A tarp or missing shingles is unmistakable from above. Flag any irregularity.

LOT AND STRUCTURE:
- Full lot: grass height, debris anywhere?
- Rear yard: condition, debris, overgrowth?
- Pool (if visible): clean, or green/debris-filled/collapsed?
- Detached structures: intact or collapsed/deteriorated?
- Driveway: accessible or overgrown?
- Vegetation consuming the structure?
- How does this property compare to neighbors?

ANTI-HEDGING RULE:
- Any roof tarp, dark patches, missing shingles → major indicator
- Any sagging or collapsed roof → major indicator
- Green, debris-filled, or collapsed pool → major indicator
- Collapsed outbuilding or carport → major indicator
- Severely overgrown lot → significant minor
- Major debris piles → significant minor
- Heavy moss on roof → significant minor
- Abandoned vehicles → mild minor

STEP 3 — SCORE:
HOW URGENTLY SHOULD A WHOLESALER CALL THIS PROPERTY based on aerial view?

MAJOR INDICATORS — any single one = minimum score of 7:
- Roof tarp or patching material
- Missing shingles — bare patches or dark irregular patches on ANY roof zone
- Roof collapsed, broken, or severely damaged
- Sagging roofline
- Fire damage visible from above
- Green, debris-filled, or collapsed pool
- Collapsing carport or outbuilding
- Structural collapse or severe instability

SCORING RULES:
- 1 major = 7 min, 2 major = 8 min, 3+ major = 9 min, 3+ major + 2+ vacancy = 10
- Score CANNOT exceed 7 without a major indicator

SIGNIFICANT MINORS — any single one = minimum score of 5:
- Heavy moss or algae on roof
- Severely overgrown lot
- Vegetation overtaking structure
- Major debris piles on lot
- Collapsed fence across most of property
- Severely neglected vs all neighbors
- Pool visibly dirty or partially green

MILD MINORS:
- Slightly overgrown grass
- Minor debris on lot
- Abandoned vehicle
- Cracked driveway
- Small structure in poor condition

MINOR SIGNAL SCORING TABLE:
- 0 = 2, 1 mild = 3, 2 mild = 5, 3 mild = 6, 4+ mild = 7
- 1 significant = 5, 2 significant = 6
- 1 significant + 1 mild = 6, 1 significant + 2+ mild = 7
- 2 significant + any mild = 7, 3+ significant = 7

STEP 4 — NOTES:
2-3 sentences. Always describe roof condition. Always mention pool if visible. Always mention lot condition. No vague language.

OUTPUT — raw JSON only, no markdown, no backticks, no explanation:
{"score":1,"priority":"skip","vacant":false,"notes":""}`;

// ── CSV STREAMING ──────────────────────────────────────────────────────────

function parseCSVStream(filePath, maxRows) {
  return new Promise((resolve, reject) => {
    const records = [];
    const stream  = fs.createReadStream(filePath);
    const parser  = parse({ columns: true, skip_empty_lines: true, trim: true, relax_quotes: true, relax_column_count: true });
    parser.on('readable', () => {
      let record;
      while ((record = parser.read()) !== null) {
        if (!maxRows || records.length < maxRows) records.push(record);
      }
    });
    parser.on('error', reject);
    parser.on('end', () => resolve(records));
    stream.pipe(parser);
  });
}

function getCSVMeta(filePath) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
    let lineCount = 0, headers = null;
    rl.on('line', (line) => {
      if (lineCount === 0) {
        const cols = [];
        let cur = '', inQ = false;
        for (const c of line) {
          if (c === '"') inQ = !inQ;
          else if (c === ',' && !inQ) { cols.push(cur.replace(/^"|"$/g, '').trim()); cur = ''; }
          else cur += c;
        }
        cols.push(cur.replace(/^"|"$/g, '').trim());
        headers = cols.filter(h => h);
      }
      lineCount++;
    });
    rl.on('close', () => resolve({ headers, rowCount: Math.max(0, lineCount - 1) }));
    rl.on('error', reject);
  });
}

function detectColumns(headers) {
  const lower = {};
  headers.forEach(h => { lower[h.toLowerCase()] = h; });
  function find(...terms) {
    for (const term of terms) for (const lh in lower) if (lh.includes(term)) return lower[lh];
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

// ── CSV OUTPUT ─────────────────────────────────────────────────────────────

function buildCSV(results, imageMode) {
  let headers;
  if (imageMode === 'both') headers = ['Full Address', 'Owner', 'Street View Score', 'Satellite Score', 'Priority', 'Vacant', 'AI Notes'];
  else if (imageMode === 'satellite') headers = ['Full Address', 'Owner', 'Satellite Score', 'Priority', 'Vacant', 'AI Notes'];
  else headers = ['Full Address', 'Owner', 'Score', 'Priority', 'Vacant', 'AI Notes'];
  const esc  = v => `"${String(v || '').replace(/"/g, '""')}"`;
  const rows = [headers.map(esc).join(',')];
  for (const r of results) rows.push(headers.map(h => esc(r[h] !== undefined ? r[h] : '')).join(','));
  return rows.join('\n');
}

// ── IMAGE FETCHING ─────────────────────────────────────────────────────────

async function fetchStreetView(address, gmapsKey, pitch = '5') {
  try {
    const r = await axios.get(
      `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${encodeURIComponent(address)}&key=${gmapsKey}&fov=90&pitch=${pitch}`,
      { responseType: 'arraybuffer', timeout: 15000 }
    );
    const ct = r.headers['content-type'] || 'image/jpeg';
    if (!ct.includes('image')) return { ok: false };
    return { ok: true, b64: Buffer.from(r.data).toString('base64'), mime: ct.split(';')[0] };
  } catch(e) { return { ok: false }; }
}

async function fetchSatellite(address, gmapsKey) {
  try {
    const geoR = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${gmapsKey}`, { timeout: 10000 });
    let center = encodeURIComponent(address);
    if (geoR.data.results && geoR.data.results[0]) {
      const loc = geoR.data.results[0].geometry.location;
      center = `${loc.lat},${loc.lng}`;
    }
    const r = await axios.get(
      `https://maps.googleapis.com/maps/api/staticmap?center=${center}&zoom=20&size=640x640&maptype=satellite&markers=color:red|${center}&key=${gmapsKey}`,
      { responseType: 'arraybuffer', timeout: 15000 }
    );
    const ct = r.headers['content-type'] || 'image/jpeg';
    if (!ct.includes('image')) return { ok: false };
    return { ok: true, b64: Buffer.from(r.data).toString('base64'), mime: ct.split(';')[0] };
  } catch(e) { return { ok: false }; }
}

// ── CLAUDE BATCH API ───────────────────────────────────────────────────────

function buildClaudeRequest(customId, prompt, imgResult) {
  return {
    custom_id: customId,
    params: {
      model: CLAUDE_MODEL, max_tokens: 800, temperature: 0.1,
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image', source: { type: 'base64', media_type: imgResult.mime, data: imgResult.b64 } }
      ]}]
    }
  };
}

async function submitClaudeBatch(requests, claudeKey) {
  const r = await axios.post('https://api.anthropic.com/v1/messages/batches', { requests }, {
    headers: { 'x-api-key': claudeKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'message-batches-2024-09-24', 'content-type': 'application/json' },
    timeout: 60000
  });
  return r.data.id;
}

async function pollClaudeBatch(batchId, claudeKey) {
  const r = await axios.get(`https://api.anthropic.com/v1/messages/batches/${batchId}`, {
    headers: { 'x-api-key': claudeKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'message-batches-2024-09-24' }
  });
  return r.data;
}

async function fetchClaudeBatchResults(batchId, claudeKey) {
  const r = await axios.get(`https://api.anthropic.com/v1/messages/batches/${batchId}/results`, {
    headers: { 'x-api-key': claudeKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'message-batches-2024-09-24' },
    responseType: 'text'
  });
  const resultMap = {};
  for (const line of r.data.split('\n').filter(l => l.trim())) {
    try {
      const obj = JSON.parse(line);
      const key = obj.custom_id || '';
      let text = '';
      if (obj.result && obj.result.type === 'succeeded') text = obj.result.message.content[0].text || '';
      text = text.replace(/```json|```/g, '').trim();
      const m = text.match(/\{[\s\S]*\}/);
      try { resultMap[key] = JSON.parse(m ? m[0] : text); } catch(e) { resultMap[key] = {}; }
    } catch(e) {}
  }
  return resultMap;
}

function parseResult(p) {
  return { score: Math.max(1, Math.min(10, parseInt(p.score || 1))), vacant: !!p.vacant, notes: p.notes || '' };
}

// ── ROUTES ─────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/api/upload', upload.single('csv'), async (req, res) => {
  try {
    if (!req.file) return res.json({ error: 'No file uploaded' });
    const fileId  = uuidv4();
    const newPath = `uploads/${fileId}.csv`;
    fs.renameSync(req.file.path, newPath);
    const { headers, rowCount } = await getCSVMeta(newPath);
    if (!headers || !headers.length) { fs.unlinkSync(newPath); return res.json({ error: 'CSV appears empty or invalid' }); }
    res.json({ fileId, headers, detected: detectColumns(headers), rowCount, filename: req.file.originalname });
  } catch(e) { res.json({ error: e.message }); }
});

app.post('/api/scan', async (req, res) => {
  const { fileId, colMap, maxProps, threshold, pitch, email, imageMode } = req.body;
  const gmapsKey  = req.body.gmapsKey  || process.env.GMAPS_KEY;
  const claudeKey = req.body.claudeKey || process.env.CLAUDE_KEY;
  if (!gmapsKey || !claudeKey) return res.json({ error: 'API keys not set' });
  if (!fileId) return res.json({ error: 'No file uploaded' });
  const jobId = uuidv4();
  jobs[jobId] = { status: 'starting', progress: 0, total: 0, fetched: 0, submitted: 0, batchId: null, downloadId: null, error: null, startTime: Date.now(), imageMode: imageMode || 'streetview' };
  res.json({ jobId });
  runScan(jobId, fileId, colMap, parseInt(maxProps) || 999999, parseInt(threshold) || 7, pitch || '5', email || '', imageMode || 'streetview', gmapsKey, claudeKey);
});

app.get('/api/status/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.json({ error: 'Job not found' });
  res.json(job);
});

app.get('/api/download/:downloadId', (req, res) => {
  const filePath = `results/${req.params.downloadId}.csv`;
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.download(filePath, `d4d-scan-results-${new Date().toISOString().split('T')[0]}.csv`);
});

app.get('/', (req, res) => {
  const p = path.join(__dirname, 'public', 'index.html');
  const r = path.join(__dirname, 'index.html');
  if (fs.existsSync(p)) res.sendFile(p);
  else if (fs.existsSync(r)) res.sendFile(r);
  else res.send('D4D Scanner running.');
});

// ── SCAN RUNNER ────────────────────────────────────────────────────────────

async function runScan(jobId, fileId, colMap, maxProps, threshold, pitch, email, imageMode, gmapsKey, claudeKey) {
  const job = jobs[jobId];
  try {
    job.status = 'reading';
    const csvPath = `uploads/${fileId}.csv`;
    const records = await parseCSVStream(csvPath, maxProps);
    try { fs.unlinkSync(csvPath); } catch(e) {}
    job.total = records.length;

    const addrList = [];
    records.forEach((row, idx) => {
      const parts = [
        (row[colMap.address] || '').trim(),
        (row[colMap.city]    || '').trim(),
        (row[colMap.state]   || '').trim(),
        (row[colMap.zip]     || '').trim()
      ].filter(p => p);
      if (parts.length) addrList.push({ index: idx, fullAddress: parts.join(', '), owner: (row[colMap.owner] || '').trim() });
    });
    if (!addrList.length) throw new Error('No valid addresses found. Check column mapping.');

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
      job.fetched  = fetched;
      job.progress = Math.round((fetched / addrList.length) * 30);
      await new Promise(r => setTimeout(r, 100));
    }
    if (fetched === 0) throw new Error('Could not fetch any images. Check API keys and billing.');

    job.status = 'submitting';
    const requests = [];
    for (const item of imgData) {
      if (!item.ok) continue;
      if (imageMode === 'streetview' && item.sv?.ok)  requests.push(buildClaudeRequest(`sv_${item.index}`,  PROMPT_STREETVIEW, item.sv));
      else if (imageMode === 'satellite' && item.sat?.ok) requests.push(buildClaudeRequest(`sat_${item.index}`, PROMPT_SATELLITE, item.sat));
      else if (imageMode === 'both') {
        if (item.sv?.ok)  requests.push(buildClaudeRequest(`sv_${item.index}`,  PROMPT_STREETVIEW, item.sv));
        if (item.sat?.ok) requests.push(buildClaudeRequest(`sat_${item.index}`, PROMPT_SATELLITE,  item.sat));
      }
    }
    if (!requests.length) throw new Error('No images available to submit.');
    job.submitted = requests.length;

    const batchId = await submitClaudeBatch(requests, claudeKey);
    job.batchId  = batchId;
    job.status   = 'processing';
    job.progress = 35;

    let complete = false;
    while (!complete) {
      await new Promise(r => setTimeout(r, 30000));
      const bs     = await pollClaudeBatch(batchId, claudeKey);
      const counts = bs.request_counts || {};
      const done   = (counts.succeeded || 0) + (counts.errored || 0);
      const total  = counts.processing !== undefined ? (counts.processing + done) : requests.length;
      job.progress = 35 + Math.round((done / Math.max(total, 1)) * 55);
      if (bs.processing_status === 'ended') complete = true;
      else if (['errored', 'expired', 'cancelled'].includes(bs.processing_status)) throw new Error(`Batch job ${bs.processing_status}`);
    }

    job.status   = 'saving';
    job.progress = 92;
    const resultMap = await fetchClaudeBatchResults(batchId, claudeKey);

    const results = [];
    for (const item of addrList) {
      if (imageMode === 'streetview') {
        const p = parseResult(resultMap[`sv_${item.index}`] || {});
        results.push({ 'Full Address': item.fullAddress, 'Owner': item.owner, 'Score': p.score, 'Priority': p.score >= threshold ? 'hot' : p.score >= 5 ? 'warm' : 'skip', 'Vacant': p.vacant ? 'YES' : 'NO', 'AI Notes': p.notes });
      } else if (imageMode === 'satellite') {
        const p = parseResult(resultMap[`sat_${item.index}`] || {});
        results.push({ 'Full Address': item.fullAddress, 'Owner': item.owner, 'Satellite Score': p.score, 'Priority': p.score >= threshold ? 'hot' : p.score >= 5 ? 'warm' : 'skip', 'Vacant': p.vacant ? 'YES' : 'NO', 'AI Notes': p.notes });
      } else {
        const sv  = parseResult(resultMap[`sv_${item.index}`]  || {});
        const sat = parseResult(resultMap[`sat_${item.index}`] || {});
        const h   = Math.max(sv.score, sat.score);
        results.push({ 'Full Address': item.fullAddress, 'Owner': item.owner, 'Street View Score': sv.score, 'Satellite Score': sat.score, 'Priority': h >= threshold ? 'hot' : h >= 5 ? 'warm' : 'skip', 'Vacant': (sv.vacant || sat.vacant) ? 'YES' : 'NO', 'AI Notes': [sv.notes && `Street View: ${sv.notes}`, sat.notes && `Satellite: ${sat.notes}`].filter(Boolean).join(' | ') });
      }
    }

    const downloadId = uuidv4();
    fs.writeFileSync(`results/${downloadId}.csv`, buildCSV(results, imageMode));
    job.downloadId   = downloadId;
    job.status       = 'complete';
    job.progress     = 100;
    job.total_scored = results.length;
    job.hot  = results.filter(r => r['Priority'] === 'hot').length;
    job.warm = results.filter(r => r['Priority'] === 'warm').length;
    job.skip = results.filter(r => r['Priority'] === 'skip').length;
    job.vac  = results.filter(r => r['Vacant']   === 'YES').length;

  } catch(e) {
    job.status = 'error';
    job.error  = e.message;
    console.error(`Job ${jobId} failed:`, e.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`D4D Scanner running on port ${PORT}`));
