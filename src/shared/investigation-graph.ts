import type { EntityType } from './types';

export interface InvNode { id: string; type: EntityType; value: string; cluster: number; score: number; x: number; y: number }
export interface InvEdge { source: string; target: string; relation: string; kind: 'relation' | 'cooccurrence' }
export interface InvestigationScene { nodes: InvNode[]; edges: InvEdge[] }

/** A streamed diff of a scene (Task 3). */
export interface SceneDelta { added: InvNode[]; updated: InvNode[]; removed: string[]; addedEdges: InvEdge[]; removedEdges: string[] }

/** Client-side view filters (Task 7). `edgeKey(e)` = `${source}->${target}:${relation}`. */
export interface GraphFilters { minScore: number; search: string; type: EntityType | 'all'; cluster: number | 'all'; hideUnconnected: boolean; showCooccurrence: boolean }
