import type { Product } from '../models';

export interface ProductMatch {
  product: Product;
  /** 1 for an exact name or alias match, otherwise token overlap between 0 and 1. */
  score: number;
}

// ---------- Normalisation ----------

/** Letters that do not decompose into a base letter plus an accent under NFKD. */
const LETTER_FOLDS: Record<string, string> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' };

/** Plurals the suffix rules below get wrong ("leaves" would become "leave", "olives" must stay "olive"). */
const IRREGULAR_PLURALS: Record<string, string> = {
  loaves: 'loaf',
  halves: 'half',
  leaves: 'leaf',
  knives: 'knife',
  // "-ies" words whose singular ends in "ie", not "y"
  cookies: 'cookie',
  brownies: 'brownie',
  veggies: 'veggie',
  smoothies: 'smoothie',
  hoagies: 'hoagie',
  calories: 'calorie',
};

/**
 * Singular of a simple English plural; a word that is not a plural is returned unchanged.
 * Rules, first match wins:
 *   words of 3 letters or fewer, words with a digit, and words ending in "ss", "us" or "is":
 *   unchanged (gas, 12s, swiss, hummus)
 *   irregular list above (loaves -> loaf, cookies -> cookie)
 *   -ies -> -y  (berries -> berry)        -oes -> -o  (tomatoes -> tomato)
 *   -sses, -ches, -shes, -xes, -zzes -> drop "es" (glasses, peaches, radishes, boxes)
 *   -s -> drop "s"  (eggs -> egg, olives -> olive, bananas -> banana)
 */
function singular(word: string): string {
  if (word.length <= 3 || /(?:ss|us|is)$/.test(word) || /\d/.test(word)) return word;
  const irregular = IRREGULAR_PLURALS[word];
  if (irregular) return irregular;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (/(?:ss|ch|sh|x|zz)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** Lower-cases, strips accents and punctuation, collapses whitespace and singularises simple plurals ("Eggs" -> "egg"). */
export function normalizeName(name: string): string {
  const folded = name
    .normalize('NFKD') // "é" -> "e" + combining accent, "ﬁ" -> "fi"
    .replace(/\p{M}+/gu, '') // drop the accents
    .toLowerCase()
    .replace(/[ßæœøłđðþı]/g, (letter) => LETTER_FOLDS[letter] ?? letter)
    .replace(/['’‘`´]/g, '') // apostrophes join: "Jack's" -> "jacks"
    // A decimal separator between digits is kept as "." ("1.5 qt", "1,5 kg" stay one token); any
    // other run of punctuation or symbols separates words.
    .replace(/(\d)[.,](?=\d)|[^\p{L}\p{N}]+/gu, (_match, digit: string | undefined) =>
      digit === undefined ? ' ' : `${digit}.`
    );
  return folded
    .split(' ')
    .filter((word) => word !== '')
    .map(singular)
    .join(' ');
}

// ---------- Matching ----------

/** The normalised forms of a product's name and aliases, and their token sets. */
interface ProductKeys {
  /** The raw name and aliases the keys were computed from. */
  signature: string;
  forms: string[];
  tokenSets: Set<string>[];
}

/**
 * Normalising the catalog on every call is about 8x slower, so the keys are cached per product
 * object. The entry is recomputed when the product's name or aliases have changed since, so an
 * edited product is never matched on stale keys.
 */
const keyCache = new WeakMap<Product, ProductKeys>();

function productKeys(product: Product): ProductKeys {
  const signature = [product.name, ...product.aliases].join('\u0000');
  let keys = keyCache.get(product);
  if (!keys || keys.signature !== signature) {
    const forms = [product.name, ...product.aliases].map(normalizeName).filter((form) => form !== '');
    keys = { signature, forms, tokenSets: forms.map(tokens) };
    keyCache.set(product, keys);
  }
  return keys;
}

function tokens(normalized: string): Set<string> {
  return new Set(normalized.split(' '));
}

/** |A ∩ B| / |A ∪ B| of two non-empty token sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Score of one product for a normalised typed name: 1 on an exact form, else the best Jaccard. */
function scoreProduct(typed: string, typedTokens: Set<string>, product: Product): number {
  const { forms, tokenSets } = productKeys(product);
  if (forms.includes(typed)) return 1;
  let best = 0;
  for (const set of tokenSets) best = Math.max(best, jaccard(typedTokens, set));
  return best;
}

/** Ranking: higher score, then shorter product name, then lower sku (plain code-unit order). */
function compareMatches(a: ProductMatch, b: ProductMatch): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.product.name.length !== b.product.name.length) return a.product.name.length - b.product.name.length;
  if (a.product.sku === b.product.sku) return 0;
  return a.product.sku < b.product.sku ? -1 : 1;
}

/**
 * Every product scoring at least `threshold` (and above 0) for a typed name, best first, in the
 * order matchProduct uses to pick one. Useful to show the alternatives of an ambiguous name.
 */
export function rankProducts(name: string, products: Product[], threshold = 0.5): ProductMatch[] {
  const typed = normalizeName(name);
  if (typed === '') return [];
  const typedTokens = tokens(typed);
  const matches: ProductMatch[] = [];
  for (const product of products) {
    const score = scoreProduct(typed, typedTokens, product);
    if (score > 0 && score >= threshold) matches.push({ product, score });
  }
  return matches.sort(compareMatches);
}

/**
 * Finds the catalog product a typed item name refers to.
 * Exact match on the normalised name or any alias scores 1. Otherwise the best token-overlap
 * (Jaccard) score against the name and aliases is used; below `threshold` returns null.
 * Ties go to the product with the shorter name, then the lower sku.
 *
 * A score equal to the threshold matches (0.5 is "half of the words in common"). A name sharing no
 * word with any product never matches, whatever the threshold. A blank name matches nothing.
 */
export function matchProduct(
  name: string,
  products: Product[],
  threshold = 0.5
): ProductMatch | null {
  return rankProducts(name, products, threshold)[0] ?? null;
}
