/**
 * Deterministic clustered 2D layout (pure). No `Math.random`, no wall-clock: the same nodes in ⇒
 * the same x/y/cluster out, always. Nodes with a non-empty vector are grouped by a seeded k-means
 * (initial centroids = the k nodes whose id sorts first, fixed iteration count) and placed around
 * their cluster's center on the unit circle; nodes with an empty vector are placed on a dedicated
 * "unclustered" ring instead of being forced into a cluster they have no real signal for.
 */
import type { GraphNode } from './model';

const ITERATIONS = 8;
const UNCLUSTERED = -1;

/** Small deterministic string hash (djb2). Used only to derive stable per-node angle/radius
 * offsets — never for randomness that would need to differ across runs. */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 33 + s.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

function distance(a: number[], b: number[]): number {
  // Euclidean distance over the shared dimensionality; vectors here are all the embedding dim.
  let sum = 0;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function meanVector(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const sum = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i += 1) sum[i] += v[i] ?? 0;
  }
  return sum.map((s) => s / vectors.length);
}

/** Seeded k-means: initial centroids are the k nodes whose id sorts first (stable, no RNG). Fixed
 * iteration count instead of a convergence check keeps the result reproducible across platforms. */
function kmeans(nodes: GraphNode[], k: number): number[] {
  if (nodes.length === 0 || k <= 0) return [];
  const clampedK = Math.min(k, nodes.length);

  const byIdAsc = [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let centroids = byIdAsc.slice(0, clampedK).map((n) => n.vector);

  let assignments = new Array(nodes.length).fill(0);
  for (let iter = 0; iter < ITERATIONS; iter += 1) {
    // Assign each node to its nearest centroid; ties broken by lowest cluster index (deterministic).
    assignments = nodes.map((node) => {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c += 1) {
        const d = distance(node.vector, centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      return best;
    });

    // Recompute centroids as the mean of assigned members; keep the previous centroid if a
    // cluster lost all members (avoids NaN and keeps the run deterministic).
    const next: number[][] = [];
    for (let c = 0; c < centroids.length; c += 1) {
      const members = nodes.filter((_, i) => assignments[i] === c).map((n) => n.vector);
      next.push(members.length > 0 ? meanVector(members) : centroids[c]);
    }
    centroids = next;
  }

  return assignments;
}

export function layout(
  nodes: GraphNode[],
  opts?: { clusters?: number; width?: number; height?: number }
): GraphNode[] {
  const clusters = opts?.clusters ?? 4;
  const width = opts?.width ?? 800;
  const height = opts?.height ?? 600;
  const centerX = width / 2;
  const centerY = height / 2;
  const clusterRingRadius = Math.min(width, height) * 0.32;
  const unclusteredRingRadius = Math.min(width, height) * 0.46;
  const nodeRadius = Math.min(width, height) * 0.14;

  const clusterable = nodes.filter((n) => n.vector && n.vector.length > 0);
  const unclusterable = nodes.filter((n) => !n.vector || n.vector.length === 0);

  const assignments = kmeans(clusterable, clusters);

  // Stable per-cluster member ordering (by id) so within-cluster rank is deterministic.
  const byCluster = new Map<number, GraphNode[]>();
  clusterable.forEach((node, i) => {
    const c = assignments[i];
    const list = byCluster.get(c) ?? [];
    list.push(node);
    byCluster.set(c, list);
  });

  const results = new Map<string, GraphNode>();

  for (const [cluster, members] of byCluster) {
    const sortedMembers = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const clusterAngle = (2 * Math.PI * cluster) / Math.max(clusters, 1);
    const clusterCx = centerX + clusterRingRadius * Math.cos(clusterAngle);
    const clusterCy = centerY + clusterRingRadius * Math.sin(clusterAngle);

    sortedMembers.forEach((node, rank) => {
      const h = hashString(node.id);
      const angle = (h % 3600) / 3600 * 2 * Math.PI;
      const radius = (nodeRadius * 0.25) + (nodeRadius * 0.75 * (rank / Math.max(sortedMembers.length, 1)));
      results.set(node.id, {
        ...node,
        cluster,
        x: clusterCx + radius * Math.cos(angle),
        y: clusterCy + radius * Math.sin(angle)
      });
    });
  }

  const sortedUnclusterable = [...unclusterable].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  sortedUnclusterable.forEach((node) => {
    const h = hashString(node.id);
    const angle = (h % 3600) / 3600 * 2 * Math.PI;
    const jitter = ((h >> 8) % 1000) / 1000; // deterministic radius jitter derived from the id hash
    const radius = unclusteredRingRadius * (0.85 + 0.15 * jitter);
    results.set(node.id, {
      ...node,
      cluster: UNCLUSTERED,
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle)
    });
  });

  return nodes.map((n) => results.get(n.id) ?? { ...n, cluster: UNCLUSTERED, x: centerX, y: centerY });
}
