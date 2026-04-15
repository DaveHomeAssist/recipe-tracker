// Shared recipe-page parser.
//
// Given raw HTML from a recipe URL, return a normalized Recipe object:
//
//   {
//     name, description, image, author, sourceSite,
//     cuisine, category,
//     ingredients: string (newline-separated),
//     instructions: string (newline-separated),
//     prepTime, cookTime, totalTime, servings,
//     keywords: string (comma-separated)
//   }
//
// Strategy:
//   1. Try JSON-LD schema.org/Recipe. Most major recipe sites ship it.
//   2. Fall back to Open Graph / <title> / <meta description> for at least
//      a minimum viable record (name, description, image, sourceSite).
//
// No network here — pure (html, url) -> object. Used by the Vercel /api/extract
// function AND by the one-time bulk extraction script.

'use strict';

const he = {
  // Minimal HTML-entity decoder. We avoid a dep.
  decode(s) {
    if (!s) return '';
    return String(s)
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&rsquo;/g, '\u2019')
      .replace(/&lsquo;/g, '\u2018')
      .replace(/&rdquo;/g, '\u201d')
      .replace(/&ldquo;/g, '\u201c')
      .replace(/&hellip;/g, '\u2026')
      .replace(/&mdash;/g, '\u2014')
      .replace(/&ndash;/g, '\u2013')
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  },
};

function stripTags(s) {
  if (!s) return '';
  return he.decode(
    String(s)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

function firstMetaContent(html, nameAttr, nameValue) {
  // <meta (property|name)="X" content="Y">
  const re = new RegExp(
    `<meta[^>]+${nameAttr}=["']${nameValue}["'][^>]*content=["']([^"']+)["']`,
    'i'
  );
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]*${nameAttr}=["']${nameValue}["']`,
    'i'
  );
  return (html.match(re) || html.match(alt) || [])[1] || '';
}

// ISO-8601 duration -> human string. PT1H30M -> "1 h 30 min".
function formatDuration(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return '';
  const h = Number(m[1] || 0);
  const mins = Number(m[2] || 0);
  if (!h && !mins) return '';
  if (h && mins) return `${h} h ${mins} min`;
  if (h) return `${h} h`;
  return `${mins} min`;
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function pickImage(img) {
  if (!img) return '';
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) {
    for (const x of img) {
      const p = pickImage(x);
      if (p) return p;
    }
    return '';
  }
  if (typeof img === 'object') {
    return img.url || img['@id'] || '';
  }
  return '';
}

function flattenInstructions(instr) {
  if (!instr) return '';
  const lines = [];
  const walk = (node) => {
    if (!node) return;
    if (typeof node === 'string') {
      const t = stripTags(node);
      if (t) lines.push(t);
      return;
    }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === 'object') {
      if (node['@type'] === 'HowToSection') {
        if (node.name) lines.push(`— ${stripTags(node.name)} —`);
        walk(node.itemListElement || node.steps);
        return;
      }
      if (node.text) { walk(node.text); return; }
      if (node.name) { walk(node.name); return; }
      if (node.itemListElement) { walk(node.itemListElement); return; }
    }
  };
  walk(instr);
  return lines.join('\n');
}

function flattenIngredients(ing) {
  return asArray(ing).map((x) => stripTags(typeof x === 'string' ? x : (x && x.name) || '')).filter(Boolean).join('\n');
}

function extractJsonLdBlocks(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // Some sites emit invalid JSON-LD with trailing commas / control chars. Try to repair.
      try {
        const cleaned = raw
          .replace(/[\u0000-\u001f]+/g, ' ')
          .replace(/,\s*([}\]])/g, '$1');
        out.push(JSON.parse(cleaned));
      } catch { /* give up on this block */ }
    }
  }
  return out;
}

function findRecipeNode(node) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const x of node) {
      const r = findRecipeNode(x);
      if (r) return r;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  const type = node['@type'];
  if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) return node;
  if (node['@graph']) return findRecipeNode(node['@graph']);
  // Some sites wrap Recipe inside other types; scan one level deep.
  for (const k of Object.keys(node)) {
    if (typeof node[k] === 'object') {
      const r = findRecipeNode(node[k]);
      if (r) return r;
    }
  }
  return null;
}

// Best-effort cuisine normalization into the frontend's canonical list.
const CUISINE_CANON = [
  'Italian', 'French', 'Japanese', 'Mexican', 'Indian',
  'American', 'Mediterranean', 'Thai', 'Chinese', 'Greek',
  'Spanish', 'Middle Eastern', 'Korean', 'Vietnamese', 'Other',
];
function normalizeCuisine(raw) {
  if (!raw) return '';
  const s = Array.isArray(raw) ? raw[0] : raw;
  const norm = String(s).trim().toLowerCase();
  for (const c of CUISINE_CANON) {
    if (norm === c.toLowerCase()) return c;
  }
  // Handle common variants.
  if (/ameri/.test(norm)) return 'American';
  if (/medit/.test(norm)) return 'Mediterranean';
  if (/mex/.test(norm)) return 'Mexican';
  if (/ital/.test(norm)) return 'Italian';
  if (/fren/.test(norm)) return 'French';
  if (/japan/.test(norm)) return 'Japanese';
  if (/indi/.test(norm)) return 'Indian';
  if (/thai/.test(norm)) return 'Thai';
  if (/chin/.test(norm)) return 'Chinese';
  if (/greek|greec/.test(norm)) return 'Greek';
  if (/spani|spain|iber/.test(norm)) return 'Spanish';
  if (/middle|levant|arab|leban|turk|persi/.test(norm)) return 'Middle Eastern';
  if (/korea/.test(norm)) return 'Korean';
  if (/viet/.test(norm)) return 'Vietnamese';
  return 'Other';
}

// Category is independent of cuisine: Dessert / Main / Side / Breakfast / Drink / Baking / Soup / Salad / Sauce / Snack / Other.
function normalizeCategory(raw, name) {
  const s = [raw, name].flatMap(asArray).filter(Boolean).join(' ').toLowerCase();
  if (!s) return '';
  if (/dessert|cake|cookie|pie|brownie|ice cream|tart|pudding|crisp|cobbler/.test(s)) return 'Dessert';
  if (/breakfast|pancake|waffle|oatmeal|granola|omelet|frittata|bagel|scone/.test(s)) return 'Breakfast';
  if (/drink|cocktail|smoothie|sangria|mocktail|lemonade|punch/.test(s)) return 'Drink';
  if (/bread|bagel|roll|bun|biscuit|dough|baked good|bakery/.test(s)) return 'Baking';
  if (/soup|stew|chowder|bisque|broth/.test(s)) return 'Soup';
  if (/salad|slaw/.test(s)) return 'Salad';
  if (/sauce|dressing|marinade|vinaigrette|dip|salsa|chutney|pesto/.test(s)) return 'Sauce';
  if (/appetizer|snack|tapas|hors|starter/.test(s)) return 'Snack';
  if (/side|vegetable/.test(s)) return 'Side';
  if (/main|entr(e|é)e|dinner|supper|lunch/.test(s)) return 'Main';
  return '';
}

function siteFromUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch { return ''; }
}

function parseFromJsonLd(recipe, url) {
  const name = stripTags(recipe.name || '');
  const description = stripTags(recipe.description || '');
  const image = pickImage(recipe.image);
  const author = (() => {
    const a = recipe.author;
    if (!a) return '';
    if (typeof a === 'string') return stripTags(a);
    if (Array.isArray(a)) return a.map(x => (typeof x === 'string' ? x : x && x.name) || '').filter(Boolean).join(', ');
    return stripTags(a.name || '');
  })();
  const ingredients = flattenIngredients(recipe.recipeIngredient || recipe.ingredients);
  const instructions = flattenInstructions(recipe.recipeInstructions);
  const prepTime = formatDuration(recipe.prepTime);
  const cookTime = formatDuration(recipe.cookTime);
  const totalTime = formatDuration(recipe.totalTime);
  const servings = (() => {
    const y = recipe.recipeYield;
    if (!y) return '';
    if (Array.isArray(y)) return stripTags(String(y[0]));
    return stripTags(String(y));
  })();
  const keywords = (() => {
    const k = recipe.keywords;
    if (!k) return '';
    if (Array.isArray(k)) return k.map(stripTags).join(', ');
    return stripTags(String(k));
  })();
  const cuisine = normalizeCuisine(recipe.recipeCuisine);
  const category = normalizeCategory(recipe.recipeCategory, name);

  return {
    name,
    description,
    image,
    author,
    sourceSite: siteFromUrl(url),
    url,
    cuisine,
    category,
    ingredients,
    instructions,
    prepTime,
    cookTime,
    totalTime,
    servings,
    keywords,
    extractedFrom: 'json-ld',
  };
}

function parseFromMeta(html, url) {
  const ogTitle = firstMetaContent(html, 'property', 'og:title') || firstMetaContent(html, 'name', 'twitter:title');
  const ogDesc = firstMetaContent(html, 'property', 'og:description') || firstMetaContent(html, 'name', 'description');
  const ogImg = firstMetaContent(html, 'property', 'og:image') || firstMetaContent(html, 'name', 'twitter:image');
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const name = stripTags(ogTitle || (titleMatch && titleMatch[1]) || '');
  return {
    name,
    description: stripTags(ogDesc),
    image: ogImg || '',
    author: '',
    sourceSite: siteFromUrl(url),
    url,
    cuisine: '',
    category: normalizeCategory('', name),
    ingredients: '',
    instructions: '',
    prepTime: '',
    cookTime: '',
    totalTime: '',
    servings: '',
    keywords: '',
    extractedFrom: 'meta',
  };
}

function parseRecipeHtml(html, url) {
  if (!html) return parseFromMeta('', url);
  const blocks = extractJsonLdBlocks(html);
  for (const b of blocks) {
    const r = findRecipeNode(b);
    if (r) return parseFromJsonLd(r, url);
  }
  return parseFromMeta(html, url);
}

// Heuristic cuisine inference from title/description/keywords/site when JSON-LD is silent.
// Pure function. Returns '' if nothing confident.
function inferCuisine(recipe) {
  if (recipe.cuisine && recipe.cuisine !== 'Other') return recipe.cuisine;
  const haystack = [
    recipe.name, recipe.description, recipe.keywords,
    recipe.category, recipe.bookmarkTitle, recipe.sourceSite,
  ].filter(Boolean).join(' ').toLowerCase();
  if (!haystack) return recipe.cuisine || '';

  // Order matters: more specific cues first.
  const rules = [
    [/\btapas|paella|jam[oó]n|gazpacho|sangria|chorizo|spanish|espa[nñ]ol|iberia|barcelon|madrid\b/, 'Spanish'],
    [/\bsushi|miso|sake|teriyaki|ramen|udon|japan|tempura|donburi|onigiri|sashimi\b/, 'Japanese'],
    [/\btaco|burrito|enchilada|quesadilla|salsa|guacamole|mexic|empanada|chipotle|mole\b/, 'Mexican'],
    [/\bcurry|masala|tikka|naan|biryani|tandoor|samosa|paneer|dal|india\b/, 'Indian'],
    [/\bpad thai|thai|tom yum|tom kha|satay|green curry|red curry\b/, 'Thai'],
    [/\bpho|banh mi|vietnam|spring roll|rice paper\b/, 'Vietnamese'],
    [/\bkimchi|bibimbap|bulgogi|korean|gochu|galbi\b/, 'Korean'],
    [/\bdim sum|stir[- ]?fry|wok|szechuan|cantonese|chinese|mandarin|hoisin|dumpling|lo mein|chow mein|kung pao|general tso\b/, 'Chinese'],
    [/\bpasta|risotto|gnocchi|tiramisu|italian|italia|carbonara|bolognese|pizza|focaccia|parmes|caprese|prosciutto\b/, 'Italian'],
    [/\bcroissant|baguette|bouillabaisse|ratatouille|french|france|provenc|bearnaise|hollandaise|confit|cassoulet\b/, 'French'],
    [/\bhummus|falafel|tahini|shawarma|kebab|tabbouleh|tzatziki|baklava|lebanese|turkish|persian|israeli|syri|moroc|tagine|harissa|middle east|levant/, 'Middle Eastern'],
    [/\bfeta|gyro|spanakopita|souvlaki|greek|greece|olive oil.*lemon|kalamata\b/, 'Greek'],
    [/\bhalibut|cod|pita|couscous|olive|med[\s-]?diet|mediterran/, 'Mediterranean'],
    [/\bbbq|barbecue|mac[\s-]?and[\s-]?cheese|cornbread|buffalo|meatloaf|biscuit|apple pie|cheesecake|burger|sloppy joe|pot roast|american|southern|cajun|creole|tex-mex/, 'American'],
  ];
  for (const [re, label] of rules) if (re.test(haystack)) return label;
  return recipe.cuisine || '';
}

module.exports = { parseRecipeHtml, siteFromUrl, CUISINE_CANON, inferCuisine };
