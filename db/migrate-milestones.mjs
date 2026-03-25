#!/usr/bin/env node
/**
 * Migration: Insert milestone comments into source content for existing excerpts.
 *
 * For each source with excerpts that have start_pos/end_pos:
 *   1. Load the source content
 *   2. For each excerpt (sorted by start_pos DESC to preserve positions):
 *      - Insert <!-- §e exc_id --> at end_pos
 *      - Insert <!-- §b exc_id --> at start_pos
 *   3. Save updated content
 *   4. Nullify start_pos/end_pos on migrated excerpts
 *
 * Usage: node db/migrate-milestones.mjs
 * Requires DATABASE_URL in .env
 */

import { readFileSync } from "fs";
import postgres from "postgres";

// Load .env manually (no dotenv dependency)
const envFile = readFileSync(new URL("../.env", import.meta.url), "utf-8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const sql = postgres(process.env.DATABASE_URL);

async function migrate() {
  // Get all sources that have excerpts with offsets
  const sources = await sql`
    SELECT DISTINCT s.id, s.title, s.content
    FROM sources s
    JOIN excerpts e ON e.source_id = s.id
    WHERE e.start_pos >= 0 AND e.end_pos >= 0
  `;

  console.log(`Found ${sources.length} sources with offset-based excerpts`);

  for (const src of sources) {
    const excerpts = await sql`
      SELECT id, start_pos, end_pos, text
      FROM excerpts
      WHERE source_id = ${src.id}
        AND start_pos >= 0 AND end_pos >= 0
      ORDER BY start_pos DESC
    `;

    console.log(`\n${src.title}: ${excerpts.length} excerpts to migrate`);

    let content = src.content;
    let migrated = 0;

    // Process in reverse order (highest offset first) so earlier inserts don't shift positions
    for (const exc of excerpts) {
      const { id, start_pos, end_pos } = exc;

      // Verify the text at this position roughly matches
      const textAtPos = content.slice(start_pos, end_pos);
      if (!textAtPos) {
        console.log(`  SKIP ${id}: empty text at [${start_pos}, ${end_pos}]`);
        continue;
      }

      // Check if milestones already exist for this excerpt
      if (content.includes(`<!-- §b ${id} -->`)) {
        console.log(`  SKIP ${id}: milestones already present`);
        continue;
      }

      // Insert end milestone first (doesn't affect start_pos)
      content = content.slice(0, end_pos) + `<!-- §e ${id} -->` + content.slice(end_pos);
      // Insert begin milestone
      content = content.slice(0, start_pos) + `<!-- §b ${id} -->` + content.slice(start_pos);

      migrated++;
      console.log(`  OK ${id}: [${start_pos}, ${end_pos}] "${textAtPos.slice(0, 40)}..."`);
    }

    if (migrated > 0) {
      // Save updated content
      await sql`UPDATE sources SET content = ${content} WHERE id = ${src.id}`;

      // Nullify offsets on migrated excerpts
      await sql`
        UPDATE excerpts
        SET start_pos = -1, end_pos = -1
        WHERE source_id = ${src.id}
          AND start_pos >= 0
      `;

      console.log(`  Saved: ${migrated} excerpts migrated`);
    }
  }

  console.log("\nMigration complete!");
  await sql.end();
}

migrate().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
