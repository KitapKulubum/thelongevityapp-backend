import { VectorItem } from '../types';

const store: VectorItem[] = [];

export function addToStore(item: VectorItem): void {
  store.push(item);
}

export function getStore(): VectorItem[] {
  return store;
}

function cosineSimilarity(vec1: number[], vec2: number[]): number {
  if (vec1.length !== vec2.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    magnitude1 += vec1[i] * vec1[i];
    magnitude2 += vec2[i] * vec2[i];
  }

  magnitude1 = Math.sqrt(magnitude1);
  magnitude2 = Math.sqrt(magnitude2);

  if (magnitude1 === 0 || magnitude2 === 0) {
    return 0;
  }

  return dotProduct / (magnitude1 * magnitude2);
}

export function searchSimilar(
  queryEmbedding: number[],
  options?: { topK?: number; userId?: string | null }
): VectorItem[] {
  const topK = options?.topK ?? 5;
  const userId = options?.userId;

  // Filter items based on userId if provided
  const filteredItems = userId !== undefined && userId !== null
    ? store.filter(item => 
        item.metadata.source === 'knowledge' ||
        (item.metadata.source === 'user_log' && item.metadata.userId === userId)
      )
    : store;

  // Compute similarity scores
  const itemsWithScores = filteredItems.map(item => ({
    item,
    similarity: cosineSimilarity(queryEmbedding, item.embedding),
  }));

  // Sort by similarity descending
  itemsWithScores.sort((a, b) => b.similarity - a.similarity);

  // Return top K items
  return itemsWithScores.slice(0, topK).map(result => result.item);
}

