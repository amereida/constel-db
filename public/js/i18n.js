// i18n.js — internacionalización simple
// Detecta idioma del navegador, fallback a español.

const translations = {
  es: {
    // Tabs
    "tab.sources": "Fuentes",
    "tab.reader": "Lector",
    "tab.map": "Mapa",

    // Sources (Tab 1)
    "sources.title": "Biblioteca",
    "sources.search": "Buscar en todos los textos...",
    "sources.import": "Por importar",
    "sources.words": "palabras",
    "sources.export": "Exportar",
    "sources.import_zip": "Importar",
    "sources.edit_meta": "Editar metadatos",
    "sources.delete_source": "Eliminar fuente",
    "sources.save": "Guardar",
    "sources.cancel": "Cancelar",
    "sources.search_results": "resultados en",
    "sources.search_texts": "textos",
    "sources.no_results": "Sin resultados",

    // Reader (Tab 2)
    "reader.concepts": "Conceptos",
    "reader.back": "Fuentes",
    "reader.loading": "Cargando...",
    "reader.select_text": "Selecciona un texto desde Fuentes para comenzar a leer",
    "reader.delete_concept": "Eliminar concepto",
    "reader.add_section": "+ Agregar sección",
    "reader.in_this_text": "§ en este texto",
    "reader.in_other_texts": "En otros textos",
    "reader.no_excerpts": "Sin excerpts",
    "reader.unlink": "Desvincular",
    "reader.select_for_concept": "Selecciona texto para agregar otra § a",
    "reader.marked_as": "§ marcado como",
    "reader.section_added": "§ agregada a",
    "reader.renamed": "Concepto renombrado →",
    "reader.confirm_delete_concept": "¿Eliminar concepto",
    "reader.confirm_delete_suffix": "? Se desvinculará de todos sus excerpts.",

    // Map (Tab 3)
    "map.title": "Mapa de conceptos",
    "map.themes": "Temas",
    "map.edges": "Aristas",
    "map.spring": "Resorte",
    "map.new_theme": "Nuevo tema...",
    "map.create": "Crear",
    "map.ungrouped": "Sin tema definido",
    "map.concepts": "Conceptos",
    "map.delete_theme": "Eliminar tema",
    "map.confirm_delete_theme": "¿Eliminar tema",
    "map.confirm_delete_theme_suffix": "? Los conceptos quedarán sin agrupar.",
    "map.development_of": "Desarrollo de",
    "map.note_placeholder": "Escribe aquí tu síntesis, implicancias, argumentos...",
    "map.sections_of_theme": "secciones de este tema:",
    "map.add_concepts": "Agregar:",
    "map.all_themes": "← Todos los temas",
    "map.no_concepts": "Marca pasajes con conceptos para ver el mapa",

    // Popup
    "popup.concept_label": "Concepto:",
    "popup.create_excerpt": "Crear",

    // General
    "general.confirm": "Confirmar",
    "general.close": "Cerrar",
  },

  en: {
    // Tabs
    "tab.sources": "Sources",
    "tab.reader": "Reader",
    "tab.map": "Map",

    // Sources (Tab 1)
    "sources.title": "Library",
    "sources.search": "Search all texts...",
    "sources.import": "Not imported",
    "sources.words": "words",
    "sources.export": "Export",
    "sources.import_zip": "Import",
    "sources.edit_meta": "Edit metadata",
    "sources.delete_source": "Delete source",
    "sources.save": "Save",
    "sources.cancel": "Cancel",
    "sources.search_results": "results in",
    "sources.search_texts": "texts",
    "sources.no_results": "No results",

    // Reader (Tab 2)
    "reader.concepts": "Concepts",
    "reader.back": "Sources",
    "reader.loading": "Loading...",
    "reader.select_text": "Select a text from Sources to start reading",
    "reader.delete_concept": "Delete concept",
    "reader.add_section": "+ Add section",
    "reader.in_this_text": "§ in this text",
    "reader.in_other_texts": "In other texts",
    "reader.no_excerpts": "No excerpts",
    "reader.unlink": "Unlink",
    "reader.select_for_concept": "Select text to add another § to",
    "reader.marked_as": "§ marked as",
    "reader.section_added": "§ added to",
    "reader.renamed": "Concept renamed →",
    "reader.confirm_delete_concept": "Delete concept",
    "reader.confirm_delete_suffix": "? It will be unlinked from all its excerpts.",

    // Map (Tab 3)
    "map.title": "Concept map",
    "map.themes": "Themes",
    "map.edges": "Edges",
    "map.spring": "Spring",
    "map.new_theme": "New theme...",
    "map.create": "Create",
    "map.ungrouped": "Ungrouped",
    "map.concepts": "Concepts",
    "map.delete_theme": "Delete theme",
    "map.confirm_delete_theme": "Delete theme",
    "map.confirm_delete_theme_suffix": "? Concepts will become ungrouped.",
    "map.development_of": "Development of",
    "map.note_placeholder": "Write your synthesis, implications, arguments here...",
    "map.sections_of_theme": "sections in this theme:",
    "map.add_concepts": "Add:",
    "map.all_themes": "← All themes",
    "map.no_concepts": "Mark passages with concepts to see the map",

    // Popup
    "popup.concept_label": "Concept:",
    "popup.create_excerpt": "Create",

    // General
    "general.confirm": "Confirm",
    "general.close": "Close",
  },
};

// Detect language: check URL param ?lang=en, then navigator
function detectLang() {
  const params = new URLSearchParams(window.location.search);
  const paramLang = params.get("lang");
  if (paramLang && translations[paramLang]) return paramLang;

  const navLang = (navigator.language || "es").slice(0, 2).toLowerCase();
  return translations[navLang] ? navLang : "es";
}

let currentLang = detectLang();

/**
 * Translate a key. Falls back to Spanish, then to the key itself.
 * @param {string} key - dot-separated key like "tab.sources"
 * @returns {string}
 */
export function t(key) {
  return translations[currentLang]?.[key]
    || translations["es"]?.[key]
    || key;
}

/**
 * Get current language code.
 */
export function getLang() {
  return currentLang;
}

/**
 * Set language and re-translate all [data-i18n] elements.
 */
export function setLang(lang) {
  if (!translations[lang]) return;
  currentLang = lang;
  applyTranslations();
}

/**
 * Apply translations to all elements with data-i18n attribute.
 * Called on init and on language change.
 */
export function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    const translated = t(key);
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      el.placeholder = translated;
    } else {
      el.textContent = translated;
    }
  });
  // title attributes
  document.querySelectorAll("[data-i18n-title]").forEach(el => {
    el.title = t(el.getAttribute("data-i18n-title"));
  });
}
