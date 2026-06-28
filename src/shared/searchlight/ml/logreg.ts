/**
 * Deterministic logistic regression for the ML corpus pipeline.
 *
 * Pure module — NO Date.now / Math.random.
 * Full-batch gradient descent, zero-initialized, fixed iteration count, L2-regularized.
 * Identical dataset → bit-identical model (determinism invariant).
 */

export interface LogRegModel {
  w: number[];
  b: number;
  mean: number[];
  scale: number[];
}

interface FitOpts {
  lr?: number;
  iters?: number;
  l2?: number;
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/**
 * Compute per-column mean and population standard deviation.
 * If std = 0 for a column, scale defaults to 1 (no-op standardization).
 */
export function standardize(rows: number[][]): { mean: number[]; scale: number[] } {
  if (rows.length === 0) return { mean: [], scale: [] };
  const nCols = rows[0].length;
  const n = rows.length;
  const mean = new Array<number>(nCols).fill(0);
  const scale = new Array<number>(nCols).fill(1);

  // Compute mean
  for (const row of rows) {
    for (let j = 0; j < nCols; j++) {
      mean[j] += row[j];
    }
  }
  for (let j = 0; j < nCols; j++) {
    mean[j] /= n;
  }

  // Compute population variance then std
  const variance = new Array<number>(nCols).fill(0);
  for (const row of rows) {
    for (let j = 0; j < nCols; j++) {
      const diff = row[j] - mean[j];
      variance[j] += diff * diff;
    }
  }
  for (let j = 0; j < nCols; j++) {
    const std = Math.sqrt(variance[j] / n);
    scale[j] = std === 0 ? 1 : std;
  }

  return { mean, scale };
}

/**
 * Fit a logistic regression model using full-batch gradient descent.
 * Standardizes X internally (population std; scale=0 → 1).
 * Zero-initializes w and b. No RNG used — deterministic.
 *
 * @param X - n×d feature matrix (raw, unstandardized)
 * @param y - n binary labels (0 or 1)
 * @param opts - { lr=0.1, iters=3000, l2=0.01 }
 */
export function fit(X: number[][], y: number[], opts: FitOpts = {}): LogRegModel {
  const lr = opts.lr ?? 0.1;
  const iters = opts.iters ?? 3000;
  const l2 = opts.l2 ?? 0.01;

  const { mean, scale } = standardize(X);
  const n = X.length;
  const d = mean.length;

  // Zero-initialize weights
  const w = new Array<number>(d).fill(0);
  let b = 0;

  // Pre-standardize X
  const Xnorm: number[][] = X.map((row) =>
    row.map((v, j) => (v - mean[j]) / scale[j])
  );

  // Full-batch gradient descent
  for (let iter = 0; iter < iters; iter++) {
    // Compute residuals: (p_i - y_i) for each sample
    const residuals = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < d; j++) {
        z += Xnorm[i][j] * w[j];
      }
      residuals[i] = sigmoid(z) - y[i];
    }

    // Gradient for w_j: (1/n) * Σ_i residuals[i] * Xnorm[i][j]  +  l2 * w_j
    // Gradient for b:   (1/n) * Σ_i residuals[i]
    const gradW = new Array<number>(d).fill(0);
    let gradB = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < d; j++) {
        gradW[j] += residuals[i] * Xnorm[i][j];
      }
      gradB += residuals[i];
    }

    // Update parameters
    for (let j = 0; j < d; j++) {
      w[j] -= lr * (gradW[j] / n + l2 * w[j]);
    }
    b -= lr * (gradB / n);
  }

  return { w, b, mean, scale };
}

/**
 * Predict the probability that raw `row` belongs to class 1.
 * Applies the model's internal standardization before computing the linear score.
 *
 * @param model - Output of `fit()`
 * @param row   - Raw (unstandardized) feature vector
 */
export function predictProba(model: LogRegModel, row: number[]): number {
  const { w, b, mean, scale } = model;
  let z = b;
  for (let j = 0; j < w.length; j++) {
    z += ((row[j] - mean[j]) / scale[j]) * w[j];
  }
  return sigmoid(z);
}
