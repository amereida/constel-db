#!/usr/bin/env node
/**
 * Migrates data from constel's JSON format to Postgres.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node db/seed-from-json.mjs path/to/constel-db.json admin@email.com
 *
 * This creates the admin user and imports all sources, excerpts, concepts, themes, and notes.
 * All entities are attributed to the admin user.
 */

import { readFileSync } from 'fs';
import postgres from 'postgres';

const jsonPath = process.argv[2];
const adminEmail = process.argv[3];

if (!jsonPath || !adminEmail) {
  console.error('Usage: DATABASE_URL=postgresql://... node db/seed-from-json.mjs <json-path> <admin-email>');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL);
const data = JSON.parse(readFileSync(jsonPath, 'utf8'));

const sources = Object.values(data.sources);
const excerpts = Object.values(data.excerpts);
const concepts = Object.values(data.concepts);
const themes = Object.values(data.themes);
const notes = Object.values(data.notes);

console.log(`Data to migrate:`);
console.log(`  ${sources.length} sources`);
console.log(`  ${excerpts.length} excerpts`);
console.log(`  ${concepts.length} concepts`);
console.log(`  ${themes.length} themes`);
console.log(`  ${notes.length} notes`);

// We also need the source content (stored in separate .txt files)
// The JSON only has metadata — content is loaded at runtime from public/textos/
// We'll need to read those files too
import { readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const constelRoot = dirname(dirname(jsonPath.startsWith('/') ? jsonPath : join(process.cwd(), jsonPath)));

async function run() {
  try {
    // 1. Create admin user
    const adminId = `user_admin_${Date.now().toString(36)}`;
    console.log(`\nCreating admin user: ${adminEmail} (${adminId})`);

    await sql`
      INSERT INTO users (id, email, name, role)
      VALUES (${adminId}, ${adminEmail}, 'Herbert Spencer', 'admin')
      ON CONFLICT (email) DO UPDATE SET role = 'admin'
      RETURNING id
    `;

    // Get actual admin id (in case it already existed)
    const [admin] = await sql`SELECT id FROM users WHERE email = ${adminEmail}`;
    const userId = admin.id;
    console.log(`  Admin ID: ${userId}`);

    // 2. Insert sources (without content for now — content comes from .txt files)
    console.log(`\nInserting ${sources.length} sources...`);
    for (const src of sources) {
      // Try to read content from the textos directory
      let content = '';
      const textosDir = join(constelRoot, 'public', 'textos');
      if (existsSync(textosDir)) {
        const txtFile = join(textosDir, src.filename);
        if (existsSync(txtFile)) {
          content = readFileSync(txtFile, 'utf8');
        }
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
          ${userId},
          ${src.addedAt || new Date().toISOString()}
        )
        ON CONFLICT (id) DO NOTHING
      `;
      console.log(`  + ${src.title || src.filename} (${src.wordCount} words, content: ${content.length > 0 ? 'yes' : 'no'})`);
    }

    // 3. Insert themes
    console.log(`\nInserting ${themes.length} themes...`);
    for (const thm of themes) {
      await sql`
        INSERT INTO themes (id, label, color, created_by, created_at)
        VALUES (
          ${thm.id},
          ${thm.label},
          ${thm.color || '#888'},
          ${userId},
          ${thm.createdAt || new Date().toISOString()}
        )
        ON CONFLICT (id) DO NOTHING
      `;
      console.log(`  + ${thm.label} (${thm.color})`);
    }

    // 4. Insert concepts + theme_concepts
    console.log(`\nInserting ${concepts.length} concepts...`);
    for (const con of concepts) {
      await sql`
        INSERT INTO concepts (id, label, created_by, created_at)
        VALUES (
          ${con.id},
          ${con.label},
          ${userId},
          ${con.createdAt || new Date().toISOString()}
        )
        ON CONFLICT (id) DO NOTHING
      `;

      // Link to theme if present
      if (con.themeId) {
        await sql`
          INSERT INTO theme_concepts (theme_id, concept_id, added_by)
          VALUES (${con.themeId}, ${con.id}, ${userId})
          ON CONFLICT DO NOTHING
        `;
      }

      const themeLabel = con.themeId ? themes.find(t => t.id === con.themeId)?.label || '?' : 'sin tema';
      console.log(`  + ${con.label} → ${themeLabel}`);
    }

    // 5. Insert excerpts + concept_excerpts
    console.log(`\nInserting ${excerpts.length} excerpts...`);
    let excCount = 0;
    for (const exc of excerpts) {
      await sql`
        INSERT INTO excerpts (id, source_id, text, start_pos, end_pos, created_by, created_at)
        VALUES (
          ${exc.id},
          ${exc.sourceId},
          ${exc.text || ''},
          ${exc.start},
          ${exc.end},
          ${userId},
          ${exc.createdAt || new Date().toISOString()}
        )
        ON CONFLICT (id) DO NOTHING
      `;

      // Link to concepts
      for (const conceptId of (exc.conceptIds || [])) {
        await sql`
          INSERT INTO concept_excerpts (concept_id, excerpt_id, linked_by)
          VALUES (${conceptId}, ${exc.id}, ${userId})
          ON CONFLICT DO NOTHING
        `;
      }
      excCount++;
      if (excCount % 50 === 0) console.log(`  ... ${excCount}/${excerpts.length}`);
    }
    console.log(`  Done: ${excCount} excerpts`);

    // 6. Insert notes
    console.log(`\nInserting ${notes.length} notes...`);
    for (const note of notes) {
      await sql`
        INSERT INTO notes (id, theme_id, text, created_by, created_at)
        VALUES (
          ${note.id},
          ${note.themeId},
          ${note.text || ''},
          ${userId},
          ${note.createdAt || new Date().toISOString()}
        )
        ON CONFLICT (id) DO NOTHING
      `;
      console.log(`  + note for theme ${note.themeId}`);
    }

    // Summary
    console.log(`\n✓ Migration complete!`);
    console.log(`  Admin: ${adminEmail} (${userId})`);
    console.log(`  Sources: ${sources.length}`);
    console.log(`  Concepts: ${concepts.length}`);
    console.log(`  Excerpts: ${excerpts.length}`);
    console.log(`  Themes: ${themes.length}`);
    console.log(`  Notes: ${notes.length}`);

  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

run();
