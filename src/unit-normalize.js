// Dimension-aware unit normalization. Pure functions.
//
// Volume base unit: teaspoon (tsp).
// Weight base unit: gram (g).
//
// Cross-dimension conversion (volume<->weight) is NOT supported; it depends
// on the ingredient's density and is out of scope for this release.
// Unknown/dimensionless units (clove, pinch, can, package) are opaque —
// they may only add with themselves.

const VOLUME_TO_TSP = Object.freeze({
  tsp: 1,
  tbsp: 3,
  floz: 6,
  cup: 48,
  pint: 96,
  quart: 192,
  gallon: 768,
  ml: 1 / 4.9289215938, // 1 tsp ≈ 4.929 ml
  l: 202.8841362,        // 1 l ≈ 202.88 tsp
});

const WEIGHT_TO_G = Object.freeze({
  g: 1,
  kg: 1000,
  oz: 28.3495,
  lb: 453.592,
});

// Opaque units: present as-is, never converted.
const OPAQUE = new Set([
  'clove', 'pinch', 'dash', 'slice', 'can', 'pkg', 'stick', 'bunch',
  'sprig', 'handful', 'piece', 'head', 'stalk',
]);

export function dimensionOf(unit) {
  if (!unit) return 'count';
  if (VOLUME_TO_TSP[unit] != null) return 'volume';
  if (WEIGHT_TO_G[unit] != null) return 'weight';
  if (OPAQUE.has(unit)) return 'opaque';
  return 'count';
}

// Display-friendly rounding. Snap to common fractions for volume under 1 cup,
// otherwise 2 decimal places max.
const COMMON_FRACTIONS = [
  [1 / 8, '1/8'], [1 / 6, '1/6'], [1 / 4, '1/4'], [1 / 3, '1/3'],
  [1 / 2, '1/2'], [2 / 3, '2/3'], [3 / 4, '3/4'], [7 / 8, '7/8'],
];

export function formatQty(qty) {
  if (qty == null || !Number.isFinite(qty)) return '';
  if (qty === 0) return '0';
  const whole = Math.floor(qty);
  const frac = qty - whole;
  if (frac < 0.02) return String(whole);
  for (const [val, label] of COMMON_FRACTIONS) {
    if (Math.abs(frac - val) < 0.03) {
      return whole ? `${whole} ${label}` : label;
    }
  }
  // Fallback: 2 decimal places, strip trailing zeros.
  return qty.toFixed(2).replace(/\.?0+$/, '');
}

// Convert qty+unit to base unit (tsp for volume, g for weight).
// Returns null if unit has no defined base (opaque/count).
export function toBase(qty, unit) {
  if (qty == null || !Number.isFinite(qty)) return null;
  if (VOLUME_TO_TSP[unit] != null) return qty * VOLUME_TO_TSP[unit];
  if (WEIGHT_TO_G[unit] != null) return qty * WEIGHT_TO_G[unit];
  return null;
}

// Convert from base unit back to a human-friendly target unit.
// Volume: prefer cup if result >= 1 cup, else tbsp, else tsp.
// Weight: prefer lb if result >= 453g, else oz if >=28g, else g.
export function fromBase(baseQty, dim) {
  if (baseQty == null || !Number.isFinite(baseQty)) return null;
  if (dim === 'volume') {
    if (baseQty >= 48) return { qty: baseQty / 48, unit: 'cup' };
    if (baseQty >= 3) return { qty: baseQty / 3, unit: 'tbsp' };
    return { qty: baseQty, unit: 'tsp' };
  }
  if (dim === 'weight') {
    if (baseQty >= 453.592) return { qty: baseQty / 453.592, unit: 'lb' };
    if (baseQty >= 28.3495) return { qty: baseQty / 28.3495, unit: 'oz' };
    return { qty: baseQty, unit: 'g' };
  }
  return null;
}

// Sum compatible quantities. Returns a single {qty, unit} or null if
// mixing units that can't be combined.
// Same-dim (all volume or all weight) combine via base unit.
// Opaque/count combines only if units match exactly.
export function sumCompatible(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const dims = new Set(parts.map((p) => dimensionOf(p.unit)));
  if (dims.size > 1) return null;
  const dim = [...dims][0];

  if (dim === 'volume' || dim === 'weight') {
    const total = parts.reduce((acc, p) => {
      const b = toBase(p.qty, p.unit);
      return b == null ? acc : acc + b;
    }, 0);
    return fromBase(total, dim);
  }

  if (dim === 'opaque' || dim === 'count') {
    const units = new Set(parts.map((p) => p.unit || ''));
    if (units.size > 1) return null;
    const unit = [...units][0] || null;
    const qty = parts.reduce((acc, p) => acc + (Number.isFinite(p.qty) ? p.qty : 0), 0);
    return { qty, unit };
  }
  return null;
}

// Scale a parsed ingredient by a factor (e.g. doubling a recipe).
export function scaleQty(qty, factor) {
  if (qty == null || !Number.isFinite(qty) || !Number.isFinite(factor)) return qty;
  return qty * factor;
}
