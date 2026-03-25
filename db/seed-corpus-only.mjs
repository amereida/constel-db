#!/usr/bin/env node
/**
 * Seeds the database with admin user + corpus texts only.
 * No concepts, themes, or excerpts — clean slate for collaborative annotation.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node db/seed-corpus-only.mjs path/to/constel-db.json path/to/corpus/ admin@email.com
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import postgres from 'postgres';

const jsonPath = process.argv[2];
const corpusDir = process.argv[3];
const adminEmail = process.argv[4];

if (!jsonPath || !corpusDir || !adminEmail) {
  console.error('Usage: DATABASE_URL=postgresql://... node db/seed-corpus-only.mjs <json-path> <corpus-dir> <admin-email>');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL);
const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
const sources = Object.values(data.sources);

async function run() {
  try {
    // Clean all tables (order matters for foreign keys)
    console.log('Cleaning existing data...');
    await sql`DELETE FROM activity_log`;
    await sql`DELETE FROM notes`;
    await sql`DELETE FROM concept_excerpts`;
    await sql`DELETE FROM excerpts`;
    await sql`DELETE FROM theme_concepts`;
    await sql`DELETE FROM concepts`;
    await sql`DELETE FROM themes`;
    await sql`DELETE FROM sources`;
    await sql`DELETE FROM users`;
    console.log('  Done.\n');

    // 1. Create admin user
    const adminId = `user_${Date.now().toString(36)}`;
    console.log(`Creating admin: ${adminEmail}`);
    await sql`
      INSERT INTO users (id, email, name, role)
      VALUES (${adminId}, ${adminEmail}, 'Herbert Spencer', 'admin')
    `;
    console.log(`  ID: ${adminId}\n`);

    // 2. Insert sources with content from .txt files
    console.log(`Inserting ${sources.length} sources with content...\n`);
    let totalWords = 0;

    for (const src of sources) {
      // Match filename to corpus file (filenames may differ slightly)
      const txtPath = join(corpusDir, src.filename);
      let content = '';

      if (existsSync(txtPath)) {
        content = readFileSync(txtPath, 'utf8');
      } else {
        // Try fuzzy match by removing special chars
        console.warn(`  ⚠ File not found: ${src.filename}`);
      }

      await sql`
        INSERT INTO sources (id, filename, title, author, date, content, word_count, uploaded_by, created_at)
        VALUES (
          ${src.id},
          ${src.filename},
          ${src.title || ''},
          ${src.author || ''},
          ${src.date || ''},
          ${content},
          ${src.wordCount || 0},
          ${adminId},
          ${src.addedAt || new Date().toISOString()}
        )
      `;

      totalWords += src.wordCount || 0;
      const hasContent = content.length > 0;
      console.log(`  + ${src.title} (${src.wordCount} words) ${hasContent ? '✓' : '✗ no content'}`);
    }

    console.log(`\n✓ Seed complete!`);
    console.log(`  Admin: ${adminEmail} (${adminId})`);
    console.log(`  Sources: ${sources.length} (${totalWords.toLocaleString()} words total)`);
    console.log(`  Concepts: 0 (clean slate)`);
    console.log(`  Themes: 0 (clean slate)`);
    console.log(`  Excerpts: 0 (clean slate)`);

  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

run();
