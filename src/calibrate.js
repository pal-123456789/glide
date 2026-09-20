// calibrate.js — multi-point calibration, the way real eye-trackers do it.
// Pure math, no DOM. Testable in node.
//
// Single-point centering (just record the "neutral" head pose) is crude: it
// assumes head motion maps to the screen uniformly, which it doesn't — the
// edges and corners need different gain, and everyone's range differs.
//
// Instead we show 5 or 9 targets across the screen, record where the head sits
// when looking at each, and fit an AFFINE map by least squares:
//
//     screen_x = ax*nx + bx*ny + cx
//     screen_y = ay*nx + by*ny + cy
//
// This corrects skew, scale, and offset in one shot. If the fit is degenerate
// (too few / collinear points) we return null and the app falls back to the
// simple mapper — never a broken pointer.

/** Solve a 3x3 system M·x = v by Cramer's rule. Returns null if near-singular. */
export function solve3x3(M, v) {
  const det =
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  if (Math.abs(det) < 1e-9) return null;

  const col = (c) => [v[0], v[1], v[2]].map((_, r) => (c === r ? v[r] : v[r]));
  // Build matrices with column i replaced by v, compute their determinants.
  const detOf = (m) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const replace = (idx) => M.map((row, r) => row.map((val, c) => (c === idx ? v[r] : val)));

  const x0 = detOf(replace(0)) / det;
  const x1 = detOf(replace(1)) / det;
  const x2 = detOf(replace(2)) / det;
  return [x0, x1, x2];
}

/**
 * Fit an affine head->screen map from calibration samples.
 * @param {Array<{nx:number,ny:number,sx:number,sy:number}>} samples
 * @returns {null | {ax,bx,cx,ay,by,cy}}
 */
export function fitAffine(samples) {
  if (!samples || samples.length < 3) return null;

  // Normal-equation matrix M (shared by both x and y fits) and RHS vectors.
  let Sxx = 0, Sxy = 0, Sx = 0, Syy = 0, Sy = 0, n = 0;
  let vx = [0, 0, 0], vy = [0, 0, 0];
  for (const s of samples) {
    const { nx, ny, sx, sy } = s;
    Sxx += nx * nx; Sxy += nx * ny; Sx += nx;
    Syy += ny * ny; Sy += ny; n += 1;
    vx[0] += nx * sx; vx[1] += ny * sx; vx[2] += sx;
    vy[0] += nx * sy; vy[1] += ny * sy; vy[2] += sy;
  }
  const M = [
    [Sxx, Sxy, Sx],
    [Sxy, Syy, Sy],
    [Sx,  Sy,  n ],
  ];
  const bx = solve3x3(M, vx);
  const by = solve3x3(M, vy);
  if (!bx || !by) return null;
  return { ax: bx[0], bx: bx[1], cx: bx[2], ay: by[0], by: by[1], cy: by[2] };
}

/** Apply a fitted model to a head position, clamped to the viewport. */
export function applyAffine(model, nx, ny, w, h) {
  let x = model.ax * nx + model.bx * ny + model.cx;
  let y = model.ay * nx + model.by * ny + model.cy;
  x = x < 0 ? 0 : x > w ? w : x;
  y = y < 0 ? 0 : y > h ? h : y;
  return { x, y };
}

/** Standard 9-point target grid (fractions of the viewport). */
export function targets9() {
  const g = [0.1, 0.5, 0.9];
  const pts = [];
  for (const fy of g) for (const fx of g) pts.push({ fx, fy });
  return pts;
}
/** Lighter 5-point (center + corners) grid. */
export function targets5() {
  return [
    { fx: 0.5, fy: 0.5 },
    { fx: 0.1, fy: 0.1 }, { fx: 0.9, fy: 0.1 },
    { fx: 0.1, fy: 0.9 }, { fx: 0.9, fy: 0.9 },
  ];
}

/**
 * Root-mean-square residual (px) of a fit against its samples — a quality
 * score we can show the user ("calibration good / try again").
 */
export function rmsError(model, samples, w, h) {
  if (!model || !samples.length) return Infinity;
  let se = 0;
  for (const s of samples) {
    const p = applyAffine(model, s.nx, s.ny, w, h);
    se += (p.x - s.sx) ** 2 + (p.y - s.sy) ** 2;
  }
  return Math.sqrt(se / samples.length);
}
