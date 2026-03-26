#!/usr/bin/env node
/**
 * auto-annotate.mjs — Anotación asistida por IA para con§tel-db
 *
 * Dos pasos interactivos usando Claude CLI:
 *   PASO 1 — Claude propone conceptos para el documento
 *            → revisión interactiva (agregar/quitar)
 *   PASO 2 — Claude marca secciones usando anclas (primeras/últimas palabras)
 *            → el script resuelve anclas en el texto, inserta milestones,
 *              crea excerpts y conceptos via API REST
 *
 * Uso:
 *   node scripts/auto-annotate.mjs "Amereida"
 *   node scripts/auto-annotate.mjs "Amereida" --dry-run
 *
 * El argumento es el TÍTULO de la fuente (o substring del título).
 * Requiere netlify dev corriendo en localhost:8888.
 */

import { execSync } from 'child_process';
import { createInterface } from 'readline';

const SERVER = process.env.CONSTEL_URL || 'http://localhost:8888';

// ── Helpers ──────────────────────────────────────────────────────

function makeId(prefix) {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${ts}${rand}`;
}

function askQuestion(rl, prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

// ── API REST ─────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${SERVER}/api${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`${method} ${path}: ${res.status} ${err.error || res.statusText}`);
  }
  return res.json();
}

// ── Text processing ──────────────────────────────────────────────

/**
 * Divide el texto en párrafos numerados para que Claude los referencie.
 * Ignora líneas que son markers de markdown (```, #, etc.)
 */
function numberParagraphs(text) {
  const lines = text.split('\n');
  const paragraphs = [];
  let current = [];
  let inFence = false;

  for (const line of lines) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      if (current.length > 0) {
        paragraphs.push({ num: paragraphs.length + 1, text: current.join('\n') });
        current = [];
      }
      continue;
    }
    if (inFence) {
      current.push(line);
      continue;
    }
    if (line.trim() === '') {
      if (current.length > 0) {
        paragraphs.push({ num: paragraphs.length + 1, text: current.join('\n') });
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    paragraphs.push({ num: paragraphs.length + 1, text: current.join('\n') });
  }
  return paragraphs;
}

/**
 * Busca una cadena ancla en el texto, con normalización de espacios.
 */
function findAnchor(text, anchor, searchFrom = 0) {
  if (!anchor || anchor.length < 3) return -1;
  const region = text.slice(searchFrom);

  // Búsqueda exacta
  let idx = region.indexOf(anchor);
  if (idx !== -1) return searchFrom + idx;

  // Espacios normalizados
  const normRegion = region.replace(/\s+/g, ' ');
  const normAnchor = anchor.replace(/\s+/g, ' ');
  const normIdx = normRegion.indexOf(normAnchor);
  if (normIdx !== -1) {
    let origPos = 0, normPos = 0;
    while (normPos < normIdx && origPos < region.length) {
      if (/\s/.test(region[origPos])) {
        while (origPos < region.length - 1 && /\s/.test(region[origPos + 1])) origPos++;
      }
      origPos++;
      normPos++;
    }
    return searchFrom + origPos;
  }

  return -1;
}

/**
 * Resuelve anclas inicio/fin en el texto, retorna { start, end, text }.
 */
function resolveAnchors(fullText, startAnchor, endAnchor, searchFrom = 0) {
  const startIdx = findAnchor(fullText, startAnchor, searchFrom);
  if (startIdx === -1) return null;

  const endIdx = findAnchor(fullText, endAnchor, startIdx);
  if (endIdx === -1) return null;

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
  if (text.length > 3000) return null; // sanity check

  return { start: startIdx, end: endPos, text };
}

/**
 * Inserta milestones <!-- §b ID --> y <!-- §e ID --> en el source markdown.
 */
function insertMilestones(source, excId, excerptText) {
  // Limpiar el texto de milestones existentes para buscar
  const cleanSource = source.replace(/<!-- §[be] \S+ -->/g, '');
  const cleanExcerpt = excerptText.replace(/<!-- §[be] \S+ -->/g, '');

  const idx = cleanSource.indexOf(cleanExcerpt);
  if (idx === -1) return null;

  // Mapear posición en cleanSource a posición en source original
  let cleanPos = 0, realPos = 0;
  while (cleanPos < idx && realPos < source.length) {
    const milestoneMatch = source.slice(realPos).match(/^<!-- §[be] \S+ -->/);
    if (milestoneMatch) {
      realPos += milestoneMatch[0].length;
      continue;
    }
    cleanPos++;
    realPos++;
  }
  const realStart = realPos;

  // Encontrar el final
  cleanPos = 0;
  while (cleanPos < idx + cleanExcerpt.length && realPos < source.length) {
    const milestoneMatch = source.slice(realPos).match(/^<!-- §[be] \S+ -->/);
    if (milestoneMatch) {
      realPos += milestoneMatch[0].length;
      continue;
    }
    cleanPos++;
    realPos++;
  }
  const realEnd = realPos;

  const before = source.slice(0, realStart);
  const marked = source.slice(realStart, realEnd);
  const after = source.slice(realEnd);

  return `${before}<!-- §b ${excId} -->${marked}<!-- §e ${excId} -->${after}`;
}

// ── Claude CLI ───────────────────────────────────────────────────

function callClaude(prompt) {
  return execSync(
    'claude -p --output-format json --model sonnet --max-turns 1',
    {
      input: prompt,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      maxBuffer: 10 * 1024 * 1024,
      timeout: 600_000,
    }
  );
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
    // Reparar JSON truncado
    const lastGood = jsonStr.lastIndexOf('}');
    if (lastGood === -1) throw new Error(`JSON invalido: ${e.message}`);

    let salvaged = jsonStr.slice(0, lastGood + 1).replace(/,\s*$/, '');
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

    const result = JSON.parse(salvaged);
    const n = result.ex?.length || '?';
    console.warn(`  (!) JSON truncado — se rescataron ${n} excerpts`);
    return result;
  }
}

// ── Main ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const query = args.find(a => !a.startsWith('--'));

if (!query) {
  console.error('Uso: node scripts/auto-annotate.mjs <titulo> [--dry-run]');
  console.error('Ejemplo: node scripts/auto-annotate.mjs "Amereida"');
  process.exit(1);
}

// 1. Conectar al servidor y buscar la fuente
console.log(`\nConectando a ${SERVER}...`);
let sources;
try {
  sources = await api('GET', '/sources');
} catch (e) {
  console.error(`No se pudo conectar: ${e.message}`);
  console.error('Asegurate de que netlify dev este corriendo.');
  process.exit(1);
}

const source = sources.find(s =>
  s.title.toLowerCase().includes(query.toLowerCase()) ||
  s.filename?.toLowerCase().includes(query.toLowerCase())
);
if (!source) {
  console.error(`Fuente no encontrada: "${query}"`);
  console.error('Disponibles:', sources.map(s => s.title).join(', '));
  process.exit(1);
}

// 2. Cargar contenido y datos relacionados
const sourceDetail = await api('GET', `/sources?id=${source.id}`);
const text = sourceDetail.content;
if (!text) {
  console.error('La fuente no tiene contenido.');
  process.exit(1);
}

const allConcepts = await api('GET', '/concepts');
const existingLabels = allConcepts.map(c => c.label).sort();

// Contar milestones existentes
const existingMilestones = (text.match(/<!-- §b \S+ -->/g) || []).length;

const paragraphs = numberParagraphs(text);

console.log(`Fuente: ${source.title}`);
console.log(`  ${text.length} caracteres, ${source.word_count} palabras, ${paragraphs.length} parrafos`);
console.log(`  ${existingMilestones} secciones existentes`);
console.log(`  ${existingLabels.length} conceptos en DB`);
console.log(`  Modo: ${dryRun ? 'DRY RUN' : 'EN VIVO (guardara via API)'}\n`);

// ══════════════════════════════════════════════════════════════════
// PASO 1 — Proponer conceptos
// ══════════════════════════════════════════════════════════════════

console.log('=== PASO 1: Analisis de conceptos ===\n');
console.log('Enviando texto a Claude...\n');

const numberedText = paragraphs.map(p => `[p${p.num}] ${p.text}`).join('\n\n');

const isLong = text.length > 30000;
const textForStep1 = isLong
  ? paragraphs.map(p => `[p${p.num}] ${p.text.slice(0, 500)}`).join('\n')
  : numberedText;

const step1Prompt = `Analisis tematico. Identifica conceptos en este texto.

Conceptos existentes en el corpus: ${existingLabels.join(', ') || '(ninguno)'}

TEXTO:
${textForStep1}

Responde SOLO con JSON compacto:
{"existing":[{"l":"label","r":"nota breve"}],"new":[{"l":"label","r":"nota"}],"summary":"resumen"}

REGLAS:
- "existing": solo conceptos de la lista que REALMENTE aparezcan. Maximo 15.
- "new": conceptos nuevos (sustantivos cortos, espanol, minusculas). Entre 3-10.
- Notas ("r") de maximo 10 palabras.
- Responde SOLO el JSON.`;

let step1Result;
try {
  const resp = callClaude(step1Prompt);
  const raw = parseJsonResponse(resp);
  step1Result = {
    summary: raw.summary || '',
    existing: (raw.existing || []).map(c => ({ label: c.l || c.label, note: c.r || c.relevance || '' })),
    newConcepts: (raw.new || []).map(c => ({ label: c.l || c.label, note: c.r || c.relevance || '' })),
  };
} catch (e) {
  console.error('Error en paso 1:', e.message);
  process.exit(1);
}

console.log(`${step1Result.summary || ''}\n`);

console.log('-- Conceptos existentes detectados --');
for (let i = 0; i < step1Result.existing.length; i++) {
  const c = step1Result.existing[i];
  console.log(`  ${i + 1}. ${c.label} -- ${c.note}`);
}

console.log('\n-- Conceptos nuevos sugeridos --');
for (let i = 0; i < step1Result.newConcepts.length; i++) {
  const c = step1Result.newConcepts[i];
  console.log(`  ${String.fromCharCode(97 + i)}. ${c.label} -- ${c.note}`);
}

// ══════════════════════════════════════════════════════════════════
// Revision interactiva
// ══════════════════════════════════════════════════════════════════

const rl = createInterface({ input: process.stdin, output: process.stdout });

console.log('\n=== REVISION INTERACTIVA ===');
console.log('Comandos:');
console.log('  -N        eliminar existente (ej: -3)');
console.log('  -a        eliminar nuevo (ej: -b)');
console.log('  +palabra  agregar concepto (ej: +el juego)');
console.log('  ok        continuar');
console.log('  abort     cancelar\n');

let workingExisting = step1Result.existing.map(c => c.label);
let workingNew = step1Result.newConcepts.map(c => c.label);

function showList() {
  console.log('\n-- Lista actual --');
  console.log('  Existentes:', workingExisting.join(', ') || '(ninguno)');
  console.log('  Nuevos:', workingNew.join(', ') || '(ninguno)');
  console.log('');
}

showList();

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
      console.log(`    x Eliminado: "${removed}"`);
    } else if (token.length === 1 && token >= 'a' && token <= 'z') {
      const idx = token.charCodeAt(0) - 97;
      if (idx >= 0 && idx < workingNew.length) {
        const removed = workingNew.splice(idx, 1)[0];
        console.log(`    x Eliminado nuevo: "${removed}"`);
      }
    } else {
      const label = token.toLowerCase();
      let found = false;
      workingExisting = workingExisting.filter(c => { if (c.toLowerCase() === label) { found = true; return false; } return true; });
      if (!found) workingNew = workingNew.filter(c => { if (c.toLowerCase() === label) { found = true; return false; } return true; });
      console.log(found ? `    x Eliminado: "${label}"` : `    ? No encontrado: "${label}"`);
    }
    showList();
  } else if (input.startsWith('+')) {
    const label = input.slice(1).trim().toLowerCase();
    if (label) {
      if (workingExisting.includes(label) || workingNew.includes(label)) {
        console.log(`    Ya existe: "${label}"`);
      } else if (existingLabels.includes(label)) {
        workingExisting.push(label);
        console.log(`    + Agregado (existente): "${label}"`);
      } else {
        workingNew.push(label);
        console.log(`    + Agregado (nuevo): "${label}"`);
      }
      showList();
    }
  } else {
    console.log('    ? Usa -N, -a, +palabra, ok, abort');
  }
}

rl.close();

const finalConcepts = [...workingExisting, ...workingNew];
if (finalConcepts.length === 0) {
  console.log('\nSin conceptos. Cancelando.');
  process.exit(0);
}

console.log(`\n${finalConcepts.length} conceptos confirmados: ${finalConcepts.join(', ')}\n`);

// ══════════════════════════════════════════════════════════════════
// PASO 2 — Generar excerpts por chunks
// ══════════════════════════════════════════════════════════════════

const CHUNK_PARAS = 50;
const chunks = [];
for (let i = 0; i < paragraphs.length; i += CHUNK_PARAS) {
  chunks.push(paragraphs.slice(i, i + CHUNK_PARAS));
}

console.log(`=== PASO 2: Generacion de secciones (${chunks.length} bloques) ===\n`);

// Mapa de conceptos existentes
const conceptByLabel = {};
for (const c of allConcepts) {
  conceptByLabel[c.label.toLowerCase()] = c.id;
}

let currentSource = text; // el source que iremos modificando con milestones
let addedExcerpts = 0;
let addedConcepts = 0;
let skippedExcerpts = 0;
let failedAnchors = 0;

for (let ch = 0; ch < chunks.length; ch++) {
  const chunk = chunks[ch];
  const fromP = chunk[0].num;
  const toP = chunk[chunk.length - 1].num;
  const chunkText = chunk.map(p => `[p${p.num}] ${p.text}`).join('\n\n');

  console.log(`-- Bloque ${ch + 1}/${chunks.length} (p${fromP}-p${toP}, ${chunk.length} parrafos) --`);
  console.log('Enviando a Claude...');

  const chunkPrompt = `Marca pasajes relevantes en este fragmento de texto. Asigna conceptos de la lista.

Conceptos: ${finalConcepts.join(', ')}

TEXTO (fragmento p${fromP}-p${toP}):
${chunkText}

JSON compacto. Anclas "s" y "e" de 4-6 palabras EXACTAS del texto (copiar literal). Max 12 excerpts.
{"ex":[{"s":"primeras palabras","e":"ultimas palabras","c":["concepto1","concepto2"]}]}

REGLAS:
- Las anclas deben ser copias EXACTAS del texto, respetando mayusculas y acentos.
- NO uses comillas dobles dentro de las anclas. Si el texto tiene comillas, reemplazalas por comillas simples.
- Cada excerpt: minimo 1 oracion, maximo 1 parrafo.
- No solapar excerpts entre si.
- Responde SOLO el JSON, bien formado.`;

  let chunkResult;
  try {
    const resp = callClaude(chunkPrompt);
    chunkResult = parseJsonResponse(resp);
  } catch (e) {
    console.warn(`  (!) Error JSON en bloque ${ch + 1}: ${e.message.split('\n')[0]}`);
    // Show raw response for debugging
    try {
      const raw = JSON.parse(resp);
      const text = (raw.result || '').slice(0, 500);
      console.warn(`  Raw (500 chars): ${text}`);
    } catch {}
    continue;
  }

  const items = chunkResult.ex || chunkResult.excerpts || [];
  let chunkAdded = 0;

  for (const item of items) {
    const startAnchor = item.s || item.start;
    const endAnchor = item.e || item.end;
    const concepts = item.c || item.concepts || [];

    if (!startAnchor || !endAnchor) { failedAnchors++; continue; }

    // Resolver anclas en el texto limpio (sin milestones)
    const cleanText = currentSource.replace(/<!-- §[be] \S+ -->/g, '');
    let resolved = resolveAnchors(cleanText, startAnchor, endAnchor);
    if (!resolved) {
      console.warn(`  (!) anclas no encontradas: "${startAnchor}..."`);
      failedAnchors++;
      continue;
    }

    if (resolved.text.split(/\s+/).length < 5) { skippedExcerpts++; continue; }

    // Crear concepto(s) si no existen
    const conceptIds = [];
    for (const label of concepts) {
      const key = label.toLowerCase().trim();
      if (conceptByLabel[key]) {
        conceptIds.push(conceptByLabel[key]);
      } else if (!dryRun) {
        try {
          const newConcept = await api('POST', '/concepts', { label: key });
          conceptByLabel[key] = newConcept.id;
          conceptIds.push(newConcept.id);
          addedConcepts++;
        } catch (e) {
          console.warn(`  (!) Error creando concepto "${key}": ${e.message}`);
        }
      }
    }

    // Crear excerpt
    const excId = makeId('exc');

    if (!dryRun) {
      // Insertar milestones en el source
      const updated = insertMilestones(currentSource, excId, resolved.text);
      if (!updated) {
        console.warn(`  (!) No se pudo insertar milestone para: "${resolved.text.slice(0, 40)}..."`);
        failedAnchors++;
        continue;
      }
      currentSource = updated;

      // Crear excerpt via API
      try {
        await api('POST', '/excerpts', {
          source_id: source.id,
          text: resolved.text,
          start_pos: -1,
          concept_ids: conceptIds,
        });
      } catch (e) {
        console.warn(`  (!) Error creando excerpt: ${e.message}`);
        continue;
      }
    }

    addedExcerpts++;
    chunkAdded++;
    const preview = resolved.text.replace(/\n/g, ' ').slice(0, 60);
    console.log(`  + [${concepts.join(', ')}] "${preview}..."`);
  }

  console.log(`  ${chunkAdded} secciones en este bloque\n`);
}

// Guardar source actualizado con milestones
if (!dryRun && currentSource !== text) {
  try {
    await api('PUT', '/sources', {
      id: source.id,
      content: currentSource,
    });
    console.log('Source actualizado con milestones.\n');
  } catch (e) {
    console.error(`Error guardando source: ${e.message}`);
  }
}

// ── Reporte final ────────────────────────────────────────────────

console.log('=== Resultados ===');
console.log(`  Secciones creadas:     ${addedExcerpts}`);
console.log(`  Conceptos creados:     ${addedConcepts}`);
console.log(`  Omitidos (cortos):     ${skippedExcerpts}`);
console.log(`  Fallidos (anclas):     ${failedAnchors}`);
console.log(`  Total conceptos DB:    ${Object.keys(conceptByLabel).length}`);
if (dryRun) console.log(`\n  DRY RUN -- sin cambios`);
console.log('');
