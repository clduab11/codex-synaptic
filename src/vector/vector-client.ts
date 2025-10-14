import { vectorizeText, cosineSimilarity } from './vector-utils.js';

export interface VectorRecord {
  id: string;
  vector: number[];
  payload?: Record<string, any>;
}

export interface VectorClient {
  ensureCollection(collection: string, dimensions: number): Promise<void>;
  upsert(collection: string, records: VectorRecord[]): Promise<void>;
  search(collection: string, vector: number[], limit?: number): Promise<VectorRecord[]>;
}

export class LocalVectorClient implements VectorClient {
  private readonly store: Map<string, VectorRecord[]> = new Map();

  async ensureCollection(collection: string): Promise<void> {
    if (!this.store.has(collection)) {
      this.store.set(collection, []);
    }
  }

  async upsert(collection: string, records: VectorRecord[]): Promise<void> {
    const bucket = this.store.get(collection) ?? [];
    records.forEach((record) => {
      const index = bucket.findIndex((existing) => existing.id === record.id);
      if (index >= 0) {
        bucket[index] = record;
      } else {
        bucket.push(record);
      }
    });
    this.store.set(collection, bucket);
  }

  async search(collection: string, vector: number[], limit = 5): Promise<VectorRecord[]> {
    const bucket = this.store.get(collection) ?? [];
    return bucket
      .map((record) => ({
        record,
        score: cosineSimilarity(vector, record.vector)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => entry.record);
  }
}

export class QdrantVectorClient implements VectorClient {
  constructor(private readonly url: string, private readonly apiKey?: string) {}

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.apiKey ? { 'api-key': this.apiKey } : {})
    };
  }

  async ensureCollection(collection: string, dimensions: number): Promise<void> {
    const response = await fetch(`${this.url}/collections/${collection}`);
    if (response.ok) {
      return;
    }
    await fetch(`${this.url}/collections/${collection}`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify({ vectors: { size: dimensions, distance: 'Cosine' } })
    });
  }

  async upsert(collection: string, records: VectorRecord[]): Promise<void> {
    await fetch(`${this.url}/collections/${collection}/points`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify({ points: records.map(({ id, vector, payload }) => ({ id, vector, payload })) })
    });
  }

  async search(collection: string, vector: number[], limit = 5): Promise<VectorRecord[]> {
    const response = await fetch(`${this.url}/collections/${collection}/points/search`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ vector, limit })
    });
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    return (data.result ?? []).map((item: any) => ({
      id: item.id,
      vector: vector,
      payload: item.payload
    }));
  }
}

export function buildVectorRecordFromText(id: string, text: string, payload?: Record<string, any>, dimensions = 32): VectorRecord {
  return {
    id,
    vector: vectorizeText(text, dimensions),
    payload
  };
}
