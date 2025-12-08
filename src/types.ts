export interface VectorItem {
  id: string;
  text: string;
  embedding: number[];
  metadata: {
    source: "knowledge" | "user_log";
    userId?: string;
    title?: string;
    tags?: string[];
  };
}

