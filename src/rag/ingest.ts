import fs from 'fs/promises';
import path from 'path';
import { openai } from '../config/openai';
import { addToStore } from './vectorStore';
import { VectorItem } from '../types';

async function embedText(text: string): Promise<number[]> {
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return resp.data[0].embedding;
}

export async function ingestKnowledgeDir(): Promise<void> {
  const dir = path.join(process.cwd(), 'data', 'knowledge');

  try {
    const fileNames = await fs.readdir(dir);

    for (const fileName of fileNames) {
      const filePath = path.join(dir, fileName);
      
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const embedding = await embedText(content);

        const item: VectorItem = {
          id: `knowledge:${fileName}`,
          text: content,
          embedding,
          metadata: {
            source: 'knowledge',
            title: fileName,
          },
        };

        addToStore(item);
      } catch (error) {
        console.error(`Error processing file ${fileName}:`, error);
      }
    }

    console.log(`Ingested ${fileNames.length} knowledge file(s)`);
  } catch (error) {
    console.error(`Error reading knowledge directory:`, error);
    throw error;
  }
}

export async function ingestUserLog(userId: string, logText: string): Promise<void> {
  const embedding = await embedText(logText);

  const item: VectorItem = {
    id: `userlog:${userId}:${Date.now()}`,
    text: logText,
    embedding,
    metadata: {
      source: 'user_log',
      userId,
    },
  };

  addToStore(item);
}

