#!/usr/bin/env node
/**
 * merge-annotations.mjs
 * Merges new sources and concepts from parallel annotation agents
 * into constel-db.json, skipping duplicates by ID.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '..', 'data', 'constel-db.json');

// Read current DB
const db = JSON.parse(readFileSync(dbPath, 'utf-8'));

// --- NEW SOURCES ---
const newSources = [
  { id: "src_vanc_r7k2m9", filename: "1969 - Viaje a Vancouver.txt", title: "1969 - Viaje a Vancouver", author: "", date: "", wordCount: 1503, addedAt: "2026-03-23T12:00:00.000Z" },
  { id: "src_amer_q3w8p5", filename: "1983 - América, Américas Mías.txt", title: "1983 - América, Américas Mías", author: "", date: "", wordCount: 3808, addedAt: "2026-03-23T12:00:00.000Z" },
  { id: "src_bitc_x4n6j1", filename: "1986 - Amereida Bitácora de la Travesía.txt", title: "1986 - Amereida Bitácora de la Travesía", author: "", date: "", wordCount: 19661, addedAt: "2026-03-23T12:00:00.000Z" },
];

// --- NEW CONCEPTS ---
const newConcepts = [
  { id: "con_epica_nav1mar0", label: "navegación", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_epica_posesion1", label: "posesión", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_epica_profecia1", label: "profecía", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_epica_desnudez1", label: "desnudez", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_intro_mnemosyn", label: "mnemosine", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_intro_mythos01", label: "mythos", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_intro_redundan", label: "redundancia", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_intro_engano01", label: "el engaño", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_intro_saludo01", label: "el saludo", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_intro_proeza01", label: "la proeza", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_intro_vigilia1", label: "vigilia", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_intro_nostalg1", label: "nostalgia", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_intro_saudade1", label: "saudade", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_intro_palabmyt", label: "palabra primera", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_amr2_fundartc", label: "fundar", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_amr2_campamnt", label: "campamento", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_amr2_tecn1ca0", label: "la técnica", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_amr2_ellugar0", label: "el lugar", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_amr2_elsigno0", label: "el signo", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_amr2_prncpnt1", label: "principiante", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_amr2_eltiempo", label: "el tiempo", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_amr2_elcruce0", label: "el cruce", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_new_actopoet1", label: "acto poético", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_new_identam01", label: "identidad americana", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
  { id: "con_new_gratuidad", label: "gratuidad", themeId: null, createdAt: "2026-03-23T12:00:00.000Z" },
];

// Merge sources (skip duplicates)
let srcAdded = 0;
for (const src of newSources) {
  if (!db.sources[src.id]) {
    db.sources[src.id] = src;
    srcAdded++;
  } else {
    console.log(`  [skip] source ${src.id} already exists`);
  }
}

// Merge concepts (skip duplicates)
let conAdded = 0;
for (const con of newConcepts) {
  if (!db.concepts[con.id]) {
    db.concepts[con.id] = con;
    conAdded++;
  } else {
    console.log(`  [skip] concept ${con.id} already exists`);
  }
}

// Update timestamp
db.updatedAt = new Date().toISOString();

// Write back
writeFileSync(dbPath, JSON.stringify(db, null, 2) + '\n', 'utf-8');

// Summary
const totalSources = Object.keys(db.sources).length;
const totalConcepts = Object.keys(db.concepts).length;
const totalExcerpts = Object.keys(db.excerpts).length;

console.log(`\nMerge complete:`);
console.log(`  Sources:  +${srcAdded} added (${totalSources} total)`);
console.log(`  Concepts: +${conAdded} added (${totalConcepts} total)`);
console.log(`  Excerpts: unchanged (${totalExcerpts} total)`);
console.log(`  Updated:  ${db.updatedAt}`);
