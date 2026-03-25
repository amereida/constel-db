#!/usr/bin/env node
/**
 * auto-annotate.mjs
 *
 * Two-step interactive annotation using Claude CLI:
 *   STEP 1 — Claude proposes concepts for the document
 *            → you review, remove, add concepts
 *   STEP 2 — Claude marks excerpt boundaries using anchors (first/last words)
 *            → the script extracts exact text from the source file (zero offset errors)
 *            → saves via server API (safe with browser open)
 *
 * Usage:
 *   node scripts/auto-annotate.mjs "1983 - América, Américas Mías.txt"
 *   node scripts/auto-annotate.mjs "1983 - América, Américas Mías.txt" --dry-run
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CORPUS_DIR = join(ROOT, 'corpus');

const SERVER = process.env.CONSTEL_URL || 'http://127.0.0.1:8787';

// ── Helpers ──────────────────────────────────────────────────────────

function makeId(prefix) {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${ts}${rand}`;
}

function now() {
  return new Date().toISOString();
}

function askQuestion(rl, prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

// ── Server API ───────────────────────────────────────────────────────

async function apiGet(path) {
  const res = await fetch(`${SERVER}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function apiPut(path, body) {
  const res = await fetch(`${SERVER}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ── Text processing ──────────────────────────────────────────────────

/**
 * Split text into numbered paragraphs for Claude to reference.
 */
function numberParagraphs(text) {
  const lines = text.split('\n');
  const paragraphs = [];
  let current = [];
  let startOffset = 0;
  let currentStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = startOffset;
    startOffset += line.length + 1;

    if (line.trim() === '') {
      if (current.length > 0) {
        paragraphs.push({
          num: paragraphs.length + 1,
          text: current.join('\n'),
          start: currentStart,
          end: lineStart,
        });
        current = [];
      }
    } else {
      if (current.length === 0) currentStart = lineStart;
      current.push(line);
    }
  }
  if (current.length > 0) {
    paragraphs.push({
      num: paragraphs.length + 1,
      text: current.join('\n'),
      start: currentStart,
      end: startOffset,
    });
  }

  return paragraphs;
}

/**
 * Resolve an anchor string to a position in the text.
 */
function normalize(s) {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[""''«»]/g, '"').trim();
}

function findAnchor(text, anchor, searchFrom = 0) {
  if (!anchor || anchor.length < 3) return -1;

  const region = text.slice(searchFrom);

  // 1. Exact match
  let idx = region.indexOf(anchor);
  if (idx !== -1) return searchFrom + idx;

  // 2. Case-insensitive match
  idx = region.toLowerCase().indexOf(anchor.toLowerCase());
  if (idx !== -1) return searchFrom + idx;

  // 3. Normalized whitespace + case-insensitive
  const normRegion = normalize(region);
  const normAnchor = normalize(anchor);
  const normIdx = normRegion.indexOf(normAnchor);
  if (normIdx !== -1) {
    // Map normalized position back to original position
    let origPos = 0, normPos = 0;
    const lowerRegion = region.toLowerCase();
    while (normPos < normIdx && origPos < region.length) {
      if (/\s/.test(region[origPos])) {
        while (origPos < region.length - 1 && /\s/.test(region[origPos + 1])) origPos++;
      }
      origPos++;
      normPos++;
    }
    return searchFrom + origPos;
  }

  // 4. Fuzzy: try progressively shorter prefixes of the anchor (min 60%)
  const minLen = Math.max(3, Math.floor(normAnchor.length * 0.6));
  for (let len = normAnchor.length - 1; len >= minLen; len--) {
    const partial = normAnchor.slice(0, len);
    const partialIdx = normRegion.indexOf(partial);
    if (partialIdx !== -1) {
      let origPos = 0, normPos = 0;
      while (normPos < partialIdx && origPos < region.length) {
        if (/\s/.test(region[origPos])) {
          while (origPos < region.length - 1 && /\s/.test(region[origPos + 1])) origPos++;
        }
        origPos++;
        normPos++;
      }
      return searchFrom + origPos;
    }
  }

  // 5. Last resort: search entire text (not just from searchFrom)
  if (searchFrom > 0) {
    return findAnchor(text, anchor, 0);
  }

  return -1;
}

/**
 * Given start_anchor and end_anchor, find the exact excerpt in the source text.
 */
function resolveAnchors(fullText, startAnchor, endAnchor, searchFrom = 0) {
  const startIdx = findAnchor(fullText, startAnchor, searchFrom);
  if (startIdx === -1) return null;

  const endIdx = findAnchor(fullText, endAnchor, startIdx);
  if (endIdx === -1) return null;

  // Find end position (end of end_anchor in original text)
  const endRegion = fullText.slice(endIdx);
  let endPos = endIdx;

  if (endRegion.startsWith(endAnchor)) {
    endPos = endIdx + endAnchor.length;
  } else {
    const normAnchor = endAnchor.replace(/\s+/g, ' ');
    let nc = 0, pos = 0;
    while (nc < normAnchor.length && pos < endRegion.length) {
      if (/\s/.test(endRegion[pos])) {
        while (pos < endRegion.length - 1 && /\s/.test(endRegion[pos + 1])) pos++;
      }
      pos++;
      nc++;
    }
    endPos = endIdx + pos;
  }

  const text = fullText.slice(startIdx, endPos);

  // Sanity: excerpt shouldn't be absurdly long
  if (text.length > 3000) return null;

  return { start: startIdx, end: endPos, text };
}

function callClaude(prompt) {
  const raw = execSync(
    'claude -p --output-format json --model sonnet --max-turns 1',
    {
      input: prompt,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],  // suppress stderr
      maxBuffer: 10 * 1024 * 1024,
      timeout: 600_000,  // 10 min
    }
  );
  return raw;
}

function parseJsonResponse(response) {
  const cliOutput = JSON.parse(response);
  const resultText = cliOutput.result || response;

  let jsonStr = resultText;
  const fenceMatch = resultText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) jsonStr = fenceMatch[1];

  if (!jsonStr.trim().startsWith('{') && !jsonStr.trim().startsWith('[')) {
    const objMatch = resultText.match(/\{[\s\S]*\}/);
    if (objMatch) jsonStr = objMatch[0];
  }

  jsonStr = jsonStr.trim();

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    // Truncated JSON — salvage complete objects from the array
    // Find the last complete excerpt object (ending with })
    const lastGood = jsonStr.lastIndexOf('}');
    if (lastGood === -1) {
      throw new Error(`JSON inválido: ${e.message}\nPrimeros 300 chars: ${jsonStr.slice(0, 300)}`);
    }

    // Truncate at the last complete object, close the structures
    let salvaged = jsonStr.slice(0, lastGood + 1);

    // Remove any trailing comma
    salvaged = salvaged.replace(/,\s*$/, '');

    // Close open brackets and braces
    const opens = { '{': 0, '[': 0 };
    const closes = { '}': '{', ']': '[' };
    let inStr = false, esc = false;
    for (const ch of salvaged) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch in opens) opens[ch]++;
      if (ch in closes) opens[closes[ch]]--;
    }
    for (let i = 0; i < opens['[']; i++) salvaged += ']';
    for (let i = 0; i < opens['{']; i++) salvaged += '}';
    salvaged = salvaged.replace(/,\s*(\]|\})/g, '$1');

    try {
      const result = JSON.parse(salvaged);
      const n = result.excerpts?.length || '?';
      console.warn(`  ⚠️  JSON truncado por Claude — se rescataron ${n} excerpts completos`);
      return result;
    } catch (e2) {
      throw new Error(`JSON inválido (incluso tras reparación): ${e.message}\nPrimeros 500 chars: ${jsonStr.slice(0, 500)}`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const filename = args.find(a => !a.startsWith('--'));

if (!filename) {
  console.error('Usage: node scripts/auto-annotate.mjs <filename> [--dry-run]');
  console.error('Example: node scripts/auto-annotate.mjs "1983 - América, Américas Mías.txt"');
  process.exit(1);
}

// Load DB from server API (gets the same state the browser sees)
console.log(`\n🔌 Conectando a ${SERVER}...`);
let db;
try {
  db = await apiGet('/api/db');
} catch (e) {
  console.error(`No se pudo conectar al servidor: ${e.message}`);
  console.error('Asegúrate de que el servidor esté corriendo (node server.mjs)');
  process.exit(1);
}

const source = Object.values(db.sources).find(s => s.filename === filename);
if (!source) {
  console.error(`Source not found in DB: ${filename}`);
  console.error('Available:', Object.values(db.sources).map(s => s.filename).join(', '));
  process.exit(1);
}

// Load text from file (faster than API, same content)
const textPath = join(CORPUS_DIR, filename);
let text;
try {
  text = readFileSync(textPath, 'utf-8').trim();
} catch (e) {
  console.error(`Cannot read: ${textPath}`);
  process.exit(1);
}

const existingConcepts = Object.values(db.concepts).map(c => c.label).sort();
const existingExcerpts = Object.values(db.excerpts)
  .filter(e => e.sourceId === source.id)
  .map(e => ({ text: e.text.slice(0, 50), start: e.start, end: e.end }));

const paragraphs = numberParagraphs(text);

console.log(`📄 Source: ${source.title}`);
console.log(`   ${text.length} chars, ${source.wordCount} words, ${paragraphs.length} paragraphs`);
console.log(`   ${existingExcerpts.length} existing excerpts`);
console.log(`   ${existingConcepts.length} concepts in DB`);
console.log(`   Mode: ${dryRun ? 'DRY RUN' : 'LIVE (will save via API)'}\n`);

// ══════════════════════════════════════════════════════════════════════
// STEP 1 — Propose concepts
// ══════════════════════════════════════════════════════════════════════

console.log('═══ STEP 1: Concept analysis ═══\n');
console.log('🤖 Sending text to Claude...\n');

const numberedText = paragraphs.map(p => `[§${p.num}] ${p.text}`).join('\n\n');

// For very long texts, send a condensed version (first 500 chars per paragraph)
const isLong = text.length > 30000;
const textForStep1 = isLong
  ? paragraphs.map(p => `[§${p.num}] ${p.text.slice(0, 500)}`).join('\n')
  : numberedText;

const step1Prompt = `Thematic analysis. Identify concepts in this text.

EXISTING CONCEPTS (PRIORITY — reuse these whenever possible):
${existingConcepts.join(', ')}

TEXT:
${textForStep1}

Respond ONLY with compact JSON:
{"existing":[{"l":"label","r":"brief note"}],"new":[{"l":"label","r":"note"}],"summary":"summary"}

RULES:
- STRONGLY PREFER existing concepts. A passage that relates to an existing concept should use that concept, even if the exact words differ. The goal is a CONTROLLED VOCABULARY across the entire corpus.
- "existing": concepts from the list that appear or are discussed in the text. No maximum — include ALL that genuinely apply.
- "new": ONLY create new concepts when the text introduces a genuinely novel idea not covered by any existing concept. Short noun phrases, English, lowercase. Maximum 5.
- Notes ("r") max 10 words.
- Respond ONLY with JSON.`;

let step1Result;
try {
  const resp = callClaude(step1Prompt);
  const raw = parseJsonResponse(resp);
  // Normalize compact keys to full keys
  step1Result = {
    summary: raw.summary || '',
    existing_concepts: (raw.existing || raw.existing_concepts || []).map(c => ({
      label: c.l || c.label,
      relevance: c.r || c.relevance || '',
    })),
    new_concepts: (raw.new || raw.new_concepts || []).map(c => ({
      label: c.l || c.label,
      relevance: c.r || c.relevance || '',
    })),
  };
} catch (e) {
  console.error('Error en paso 1:', e.message);
  process.exit(1);
}

console.log(`📋 ${step1Result.summary || ''}\n`);

console.log('── Existing concepts detected ──');
const detectedExisting = step1Result.existing_concepts || [];
for (let i = 0; i < detectedExisting.length; i++) {
  const c = detectedExisting[i];
  console.log(`  ${i + 1}. ${c.label} — ${c.relevance}`);
}

console.log('\n── New concepts suggested ──');
const suggestedNew = step1Result.new_concepts || [];
for (let i = 0; i < suggestedNew.length; i++) {
  const c = suggestedNew[i];
  console.log(`  ${String.fromCharCode(97 + i)}. ${c.label} — ${c.relevance}`);
}

// ══════════════════════════════════════════════════════════════════════
// Interactive review
// ══════════════════════════════════════════════════════════════════════

const rl = createInterface({ input: process.stdin, output: process.stdout });

console.log('\n═══ INTERACTIVE REVIEW ═══');
console.log('Adjust the concept list before generating excerpts.\n');
console.log('Commands:');
console.log('  -N        remove existing concept (e.g. -3)');
console.log('  -a        remove suggested new concept (e.g. -b)');
console.log('  +word     add concept (e.g. +the game)');
console.log('  ok        continue with current list');
console.log('  abort     cancel\n');

let workingExisting = detectedExisting.map(c => c.label);
let workingNew = suggestedNew.map(c => c.label);

function showCurrentList() {
  console.log('\n── Current list ──');
  console.log('  Existing:', workingExisting.join(', ') || '(none)');
  console.log('  New:', workingNew.join(', ') || '(none)');
  console.log('');
}

showCurrentList();

let reviewing = true;
while (reviewing) {
  const input = (await askQuestion(rl, '  > ')).trim();

  if (input === 'ok' || input === '') {
    reviewing = false;
  } else if (input === 'abort') {
    console.log('\nCancelado.');
    rl.close();
    process.exit(0);
  } else if (input.startsWith('-')) {
    const token = input.slice(1).trim();
    const num = parseInt(token);
    if (!isNaN(num) && num >= 1 && num <= workingExisting.length) {
      const removed = workingExisting.splice(num - 1, 1)[0];
      console.log(`    ✕ Removed: "${removed}"`);
    } else if (token.length === 1 && token >= 'a' && token <= 'z') {
      const idx = token.charCodeAt(0) - 97;
      if (idx >= 0 && idx < workingNew.length) {
        const removed = workingNew.splice(idx, 1)[0];
        console.log(`    ✕ Removed new: "${removed}"`);
      } else {
        console.log(`    ? Index "${token}" out of range`);
      }
    } else {
      const label = token.toLowerCase();
      let found = false;
      workingExisting = workingExisting.filter(c => {
        if (c.toLowerCase() === label) { found = true; return false; }
        return true;
      });
      if (!found) {
        workingNew = workingNew.filter(c => {
          if (c.toLowerCase() === label) { found = true; return false; }
          return true;
        });
      }
      if (found) console.log(`    ✕ Removed: "${label}"`);
      else console.log(`    ? Not found: "${label}"`);
    }
    showCurrentList();
  } else if (input.startsWith('+')) {
    const label = input.slice(1).trim().toLowerCase();
    if (label) {
      if (workingExisting.includes(label) || workingNew.includes(label)) {
        console.log(`    Already exists: "${label}"`);
      } else if (existingConcepts.includes(label)) {
        workingExisting.push(label);
        console.log(`    ✓ Added (existing): "${label}"`);
      } else {
        workingNew.push(label);
        console.log(`    ✓ Added (new): "${label}"`);
      }
      showCurrentList();
    }
  } else {
    console.log('    ? Unknown command. Use -N, -a, +word, ok, abort');
  }
}

rl.close();

const finalConcepts = [...workingExisting, ...workingNew];
if (finalConcepts.length === 0) {
  console.log('\nNo hay conceptos seleccionados. Cancelando.');
  process.exit(0);
}

console.log(`\n✅ ${finalConcepts.length} concepts confirmed: ${finalConcepts.join(', ')}\n`);

// ══════════════════════════════════════════════════════════════════════
// STEP 2 — Generate excerpts by TEXT CHUNKS
//   Each chunk: ~50 paragraphs with ALL concepts
//   This keeps both input and output small
// ══════════════════════════════════════════════════════════════════════

const CHUNK_PARAS = 50; // paragraphs per chunk
const chunks = [];
for (let i = 0; i < paragraphs.length; i += CHUNK_PARAS) {
  chunks.push(paragraphs.slice(i, i + CHUNK_PARAS));
}

console.log(`═══ STEP 2: Generating excerpts (${chunks.length} sections) ═══\n`);

// Re-read DB fresh from server
db = await apiGet('/api/db');

let addedExcerpts = 0;
let addedConcepts = 0;
let skippedExcerpts = 0;
let failedAnchors = 0;

const conceptByLabel = {};
for (const c of Object.values(db.concepts)) {
  conceptByLabel[c.label.toLowerCase()] = c.id;
}

const freshExisting = Object.values(db.excerpts)
  .filter(e => e.sourceId === source.id)
  .map(e => ({ start: e.start, end: e.end }));
const occupiedRanges = [...freshExisting];

for (let ch = 0; ch < chunks.length; ch++) {
  const chunk = chunks[ch];
  const fromP = chunk[0].num;
  const toP = chunk[chunk.length - 1].num;
  const chunkText = chunk.map(p => `[§${p.num}] ${p.text}`).join('\n\n');
  const chunkStart = chunk[0].start;
  const chunkEnd = chunk[chunk.length - 1].end;

  // Occupied ranges within this chunk's region
  const chunkOccupied = occupiedRanges
    .filter(r => r.start < chunkEnd && r.end > chunkStart)
    .map(r => `[${r.start}-${r.end}]`).join(', ') || 'ninguno';

  console.log(`── Sección ${ch + 1}/${chunks.length} (§${fromP}-§${toP}, ${chunk.length} párrafos) ──`);
  console.log('🤖 Sending to Claude...');

  const chunkPrompt = `Mark relevant passages in this text fragment. Assign concepts from the list.

CONCEPTS (use EXACTLY these labels — do not invent new ones or paraphrase):
${finalConcepts.join(', ')}

Already marked zones (DO NOT overlap): ${chunkOccupied}

TEXT (fragment §${fromP}-§${toP}):
${chunkText}

RULES:
- Each excerpt MUST use one or more concept labels from the list above, spelled EXACTLY as given.
- A single excerpt can have multiple concepts if the passage addresses several themes.
- Prefer assigning existing concepts over leaving a passage untagged.
- Anchors "s" and "e" must be 4-6 exact words from the text. Max 12 excerpts.

Compact JSON:
{"ex":[{"s":"start anchor","e":"end anchor","c":["concept1","concept2"]}]}`;

  let chunkResult;
  try {
    const resp = callClaude(chunkPrompt);
    chunkResult = parseJsonResponse(resp);
  } catch (e) {
    console.warn(`  ⚠️  Error in section ${ch + 1}: ${e.message.split('\n')[0]}`);
    console.warn('  Continuing...\n');
    continue;
  }

  const items = chunkResult.ex || chunkResult.excerpts || [];
  let chunkAdded = 0;

  for (const item of items) {
    const startAnchor = item.s || item.start;
    const endAnchor = item.e || item.end;
    const concepts = item.c || item.concepts || [];

    if (!startAnchor || !endAnchor) { failedAnchors++; continue; }

    // Search anchors within the chunk's region of the full text
    let resolved = resolveAnchors(text, startAnchor, endAnchor, chunkStart);
    if (!resolved) {
      // Retry in full text as fallback
      resolved = resolveAnchors(text, startAnchor, endAnchor);
    }
    if (!resolved) {
      console.warn(`  ⚠️  anchors not found: "${startAnchor}"`);
      failedAnchors++;
      continue;
    }

    const { start, end, text: excerptText } = resolved;

    if (excerptText.split(/\s+/).length < 5) { skippedExcerpts++; continue; }

    const overlaps = occupiedRanges.some(r => start < r.end && end > r.start);
    if (overlaps) { skippedExcerpts++; continue; }

    // Resolve concept IDs
    const conceptIds = [];
    for (const label of concepts) {
      const key = label.toLowerCase().trim();
      if (conceptByLabel[key]) {
        conceptIds.push(conceptByLabel[key]);
      } else {
        const newId = makeId('con');
        db.concepts[newId] = { id: newId, label: key, themeId: null, createdAt: now() };
        conceptByLabel[key] = newId;
        conceptIds.push(newId);
        addedConcepts++;
      }
    }

    const excId = makeId('exc');
    db.excerpts[excId] = {
      id: excId, sourceId: source.id, text: excerptText,
      start, end, conceptIds, createdAt: now(),
    };
    addedExcerpts++;
    chunkAdded++;
    occupiedRanges.push({ start, end });

    const preview = excerptText.replace(/\n/g, ' ').slice(0, 60);
    console.log(`  ✅ [${start}-${end}] ${concepts.join(', ')} — "${preview}..."`);
  }

  // Save incrementally after each chunk
  if (!dryRun && chunkAdded > 0) {
    try { await apiPut('/api/db', db); } catch (e) { console.error(`  ❌ ${e.message}`); }
  }

  const coveredSoFar = occupiedRanges.reduce((sum, r) => sum + (r.end - r.start), 0);
  console.log(`  📊 +${chunkAdded} excerpts, cobertura: ${((coveredSoFar / text.length) * 100).toFixed(1)}%\n`);
}

// ── Final report ─────────────────────────────────────────────────────

const totalExcerpts = Object.values(db.excerpts).filter(e => e.sourceId === source.id).length;
const coveredChars = occupiedRanges.reduce((sum, r) => sum + (r.end - r.start), 0);
const coverage = ((coveredChars / text.length) * 100).toFixed(1);

if (!dryRun && addedExcerpts > 0) {
  console.log('💾 Guardado via API. Recarga el navegador para ver los cambios.');
}

console.log(`\n═══ Final results ═══`);
console.log(`  Excerpts added:        ${addedExcerpts}`);
console.log(`  Concepts created:      ${addedConcepts}`);
console.log(`  Skipped (overlap):     ${skippedExcerpts}`);
console.log(`  Failed (anchors):      ${failedAnchors}`);
console.log(`  Total excerpts:        ${totalExcerpts} (this document)`);
console.log(`  Text coverage:         ${coverage}%`);
console.log(`  Total concepts in DB:  ${Object.keys(db.concepts).length}`);
if (dryRun) console.log(`\n  ⚡ DRY RUN — no changes saved`);
console.log('');
