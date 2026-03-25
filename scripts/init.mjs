#!/usr/bin/env node
/**
 * init.mjs — Prepara una instancia limpia de con§tel
 *
 * Borra todos los textos del corpus y resetea la base de datos.
 * Usar cuando quieras empezar un proyecto de análisis nuevo.
 *
 * Usage:
 *   node scripts/init.mjs
 *   npm run init
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CORPUS = path.join(ROOT, 'corpus');
const DATA = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA, 'constel-db.json');
const VER_DIR = path.join(DATA, 'versions');
const SES_PATH = path.join(DATA, 'session-id.txt');

function ask(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(prompt, answer => { rl.close(); resolve(answer.trim()); }));
}

// ── Count what exists ────────────────────────────────────────────────

let corpusFiles = [];
try {
  const entries = await fs.readdir(CORPUS);
  corpusFiles = entries.filter(f => f.endsWith('.txt') || f.endsWith('.md'));
} catch {}

let dbExists = false;
let dbStats = { sources: 0, excerpts: 0, concepts: 0 };
try {
  const raw = await fs.readFile(DB_PATH, 'utf-8');
  const db = JSON.parse(raw);
  dbExists = true;
  dbStats = {
    sources: Object.keys(db.sources || {}).length,
    excerpts: Object.keys(db.excerpts || {}).length,
    concepts: Object.keys(db.concepts || {}).length,
  };
} catch {}

let versionFiles = [];
try {
  versionFiles = (await fs.readdir(VER_DIR)).filter(f => f.endsWith('.json'));
} catch {}

// ── Show what will be deleted ────────────────────────────────────────

console.log('\n  con§tel — inicializar proyecto nuevo\n');

if (corpusFiles.length === 0 && !dbExists) {
  console.log('  Ya está limpio. Coloca tus textos en corpus/ e inicia con `npm start`.\n');
  process.exit(0);
}

console.log('  Se eliminará:');
if (corpusFiles.length > 0) {
  console.log(`    ${corpusFiles.length} textos en corpus/`);
}
if (dbExists) {
  console.log(`    Base de datos (${dbStats.sources} fuentes, ${dbStats.excerpts} excerpts, ${dbStats.concepts} conceptos)`);
}
if (versionFiles.length > 0) {
  console.log(`    ${versionFiles.length} snapshots en data/versions/`);
}

console.log('');
const answer = await ask('  ¿Continuar? (s/n) ');

if (answer.toLowerCase() !== 's' && answer.toLowerCase() !== 'si' && answer.toLowerCase() !== 'sí') {
  console.log('  Cancelado.\n');
  process.exit(0);
}

// ── Delete ───────────────────────────────────────────────────────────

// Corpus files
for (const file of corpusFiles) {
  await fs.unlink(path.join(CORPUS, file));
}

// Database
const freshDb = {
  version: 1,
  updatedAt: new Date().toISOString(),
  sessionId: '',
  sources: {},
  excerpts: {},
  concepts: {},
  themes: {},
  notes: {},
};
await fs.mkdir(DATA, { recursive: true });
await fs.writeFile(DB_PATH, JSON.stringify(freshDb, null, 2) + '\n', 'utf-8');

// Versions
for (const file of versionFiles) {
  await fs.unlink(path.join(VER_DIR, file));
}

// Session
try { await fs.unlink(SES_PATH); } catch {}

// LocalStorage hint
console.log('\n  Listo. Proyecto inicializado.\n');
console.log('  Próximos pasos:');
console.log('    1. Coloca tus textos (.txt o .md) en la carpeta corpus/');
console.log('    2. Ejecuta: npm start');
console.log('    3. Abre http://127.0.0.1:8787 en el navegador');
console.log('');
console.log('  Si tenías el navegador abierto, recarga la página (o borra localStorage).\n');
