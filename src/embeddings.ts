// cc-memory v3 - Local embedding pipeline (singleton, lazy-loaded)
// @huggingface/transformers is an optionalDependency — types are inline

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
export const DIMENSIONS = 384;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Extractor = (text: string, opts: Record<string, unknown>) => Promise<any>;

let extractorInstance: Extractor | null = null;
let loadingPromise: Promise<Extractor | null> | null = null;
let available: boolean | null = null;

export function isAvailable(): boolean | null {
  return available;
}

export async function getEmbedder(): Promise<Extractor | null> {
  if (available === false) return null;
  if (extractorInstance) return extractorInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      // @ts-ignore - optionalDependency, may not be installed
      const mod = await import("@huggingface/transformers");
      const extractor = await mod.pipeline("feature-extraction", MODEL_ID, {
        dtype: "fp32",
      });
      extractorInstance = extractor as Extractor;
      available = true;
      return extractorInstance;
    } catch {
      available = false;
      return null;
    }
  })();
  return loadingPromise;
}

export async function embed(text: string): Promise<Float32Array | null> {
  const extractor = await getEmbedder();
  if (!extractor) return null;
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return new Float32Array(output.tolist()[0]);
}
