#!/usr/bin/env node
// fetch-casiopea.mjs — descarga textos de la Biblioteca Con§tel desde Casiopea (MediaWiki)
// Uso: node scripts/fetch-casiopea.mjs [--collection amereida|all]

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.join(__dirname, "..", "corpus");
const WIKI_BASE = "https://wiki.ead.pucv.cl";

// ── Colecciones ─────────────────────────────────────────────────────────────

const COLLECTIONS = {
  amereida: [
    { title: "Amereida", year: 1967 },
    { title: "Viaje_a_Vancouver", year: 1969 },
    { title: "Eneida-Amereida", year: 1982 },
    { title: "Introducción_al_Primer_Poema_de_Amereida", year: 1982 },
    { title: "América,_Américas_Mías", year: 1983 },
    { title: "Epica_Americana", year: 1983 },
    { title: "Amereida_II", year: 1986 },
    { title: "Amereida:_Bitácora_de_la_Travesía", year: 1986 },
    { title: "Amereida_Travesías_1984_a_1988", year: 1991 },
    { title: "Amereida_en_Barcelona", year: 1996 },
  ],
};

// ── Funciones ───────────────────────────────────────────────────────────────

/**
 * Descarga el contenido de una página MediaWiki usando la API.
 * Retorna el texto plano (sin markup wiki).
 */
async function fetchWikiText(pageTitle) {
  // Usar la API de MediaWiki para obtener el texto parseado
  const apiUrl = `${WIKI_BASE}/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=wikitext&format=json`;

  console.log(`  Descargando: ${pageTitle}...`);
  const res = await fetch(apiUrl);

  if (!res.ok) {
    // Intentar con la URL directa si la API no funciona
    return await fetchHtmlFallback(pageTitle);
  }

  const data = await res.json();

  if (data.error) {
    console.warn(`  ⚠ Error API para "${pageTitle}": ${data.error.info}`);
    return await fetchHtmlFallback(pageTitle);
  }

  const wikitext = data.parse?.wikitext?.["*"] || "";
  return cleanWikitext(wikitext);
}

/**
 * Fallback: descarga el HTML de la página y extrae el texto.
 */
async function fetchHtmlFallback(pageTitle) {
  const url = `${WIKI_BASE}/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=text&format=json`;
  console.log(`  Fallback HTML: ${pageTitle}...`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} para ${pageTitle}`);

  const data = await res.json();
  if (data.error) throw new Error(data.error.info);

  const html = data.parse?.text?.["*"] || "";
  return cleanHtml(html);
}

/**
 * Limpia wikitext a texto plano.
 */
function cleanWikitext(wt) {
  let text = wt;

  // eliminar categorías y templates
  text = text.replace(/\{\{[^}]*\}\}/g, "");
  text = text.replace(/\[\[Categoría:[^\]]*\]\]/gi, "");
  text = text.replace(/\[\[Category:[^\]]*\]\]/gi, "");

  // convertir enlaces internos [[Página|texto]] → texto
  text = text.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1");

  // convertir enlaces externos [url texto] → texto
  text = text.replace(/\[https?:\/\/[^\s\]]+ ([^\]]*)\]/g, "$1");
  text = text.replace(/\[https?:\/\/[^\]]*\]/g, "");

  // eliminar markup de formato
  text = text.replace(/'{2,5}/g, ""); // negrita/cursiva
  text = text.replace(/^=+ ?(.+?) ?=+$/gm, "$1"); // encabezados → texto
  text = text.replace(/^-{4,}$/gm, ""); // líneas horizontales
  text = text.replace(/<ref[^>]*>.*?<\/ref>/gs, ""); // referencias
  text = text.replace(/<ref[^>]*\/>/g, "");
  text = text.replace(/<\/?[^>]+>/g, ""); // cualquier HTML restante

  // listas
  text = text.replace(/^\*+ /gm, "");
  text = text.replace(/^#+ /gm, "");

  // tablas wiki
  text = text.replace(/\{\|[\s\S]*?\|\}/g, "");

  // limpiar espacios
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  return text;
}

/**
 * Limpia HTML a texto plano.
 */
function cleanHtml(html) {
  let text = html;

  // eliminar scripts y styles
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  // convertir <br>, <p>, <div> en saltos de línea
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/li>/gi, "\n");
  text = text.replace(/<\/h[1-6]>/gi, "\n\n");

  // eliminar todo HTML
  text = text.replace(/<[^>]+>/g, "");

  // decodificar entidades HTML
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#039;/g, "'");
  text = text.replace(/&nbsp;/g, " ");

  // limpiar espacios
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  return text;
}

/**
 * Genera un nombre de archivo limpio.
 */
function toFilename(title, year) {
  const clean = title
    .replace(/_/g, " ")
    .replace(/[/:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${year} - ${clean}.txt`;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const collectionName = args.includes("--collection")
    ? args[args.indexOf("--collection") + 1]
    : "amereida";

  const collection = COLLECTIONS[collectionName];
  if (!collection) {
    console.error(`Colección no encontrada: "${collectionName}"`);
    console.error(`Disponibles: ${Object.keys(COLLECTIONS).join(", ")}`);
    process.exit(1);
  }

  await fs.mkdir(CORPUS_DIR, { recursive: true });

  console.log(`\nDescargando colección "${collectionName}" (${collection.length} textos)...\n`);

  let ok = 0, fail = 0;

  for (const entry of collection) {
    try {
      const text = await fetchWikiText(entry.title);

      if (!text || text.length < 50) {
        console.warn(`  ⚠ Texto muy corto o vacío: ${entry.title} (${text.length} chars)`);
        fail++;
        continue;
      }

      const filename = toFilename(entry.title, entry.year);
      const filepath = path.join(CORPUS_DIR, filename);
      await fs.writeFile(filepath, text, "utf8");
      console.log(`  ✓ ${filename} (${text.length} caracteres)`);
      ok++;

      // pausa breve para no sobrecargar el servidor
      await new Promise(r => setTimeout(r, 500));

    } catch (err) {
      console.error(`  ✗ Error con "${entry.title}": ${err.message}`);
      fail++;
    }
  }

  console.log(`\nResultado: ${ok} descargados, ${fail} fallidos`);
  console.log(`Carpeta: ${CORPUS_DIR}\n`);
}

main();
