/**
 * Text tokenizer for search indexing
 * Supports English and Japanese text
 */

/**
 * Common English stop words to filter out
 */
const ENGLISH_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'were', 'will', 'with', 'the', 'this', 'but', 'they',
  'have', 'had', 'what', 'when', 'where', 'who', 'which', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 'just', 'can', 'should', 'now', 'i', 'you',
  'your', 'we', 'our', 'my', 'me', 'him', 'her', 'them', 'their',
]);

/**
 * Common Japanese particles and auxiliary words to filter out
 */
const JAPANESE_STOP_WORDS = new Set([
  'の', 'に', 'は', 'を', 'た', 'が', 'で', 'て', 'と', 'し', 'れ',
  'さ', 'ある', 'いる', 'も', 'な', 'する', 'から', 'だ', 'こと',
  'として', 'い', 'や', 'など', 'なっ', 'ない', 'この', 'ため',
  'その', 'あっ', 'よう', 'また', 'もの', 'という', 'あり', 'まで',
  'られ', 'なる', 'へ', 'か', 'だっ', 'それ', 'によって', 'により',
  'おり', 'より', 'による', 'ず', 'なり', 'られる', 'において',
  'ば', 'なかっ', 'なく', 'しかし', 'について', 'せ', 'だけ',
  'でき', 'これ', 'ところ', 'として', 'あった', 'ここ', 'です',
  'ます', 'でした', 'ました', 'ません', 'ください',
]);

/**
 * Check if a character is Japanese (Hiragana, Katakana, or Kanji)
 */
function isJapanese(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 0x3040 && code <= 0x309F) || // Hiragana
    (code >= 0x30A0 && code <= 0x30FF) || // Katakana
    (code >= 0x4E00 && code <= 0x9FFF) || // CJK Unified Ideographs (Kanji)
    (code >= 0x3400 && code <= 0x4DBF)    // CJK Extension A
  );
}

/**
 * Check if text contains Japanese characters
 */
function containsJapanese(text: string): boolean {
  for (const char of text) {
    if (isJapanese(char)) return true;
  }
  return false;
}

/**
 * Tokenize English text
 */
function tokenizeEnglish(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 2 && !ENGLISH_STOP_WORDS.has(token));
}

/**
 * Tokenize Japanese text using character-based n-grams
 * This is a simple approach that works without external libraries
 */
function tokenizeJapanese(text: string, ngramSize: number = 2): string[] {
  const tokens: string[] = [];
  const cleanText = text.replace(/[\s\n\r\t]/g, '');

  let japaneseBuffer = '';
  for (const char of cleanText) {
    if (isJapanese(char)) {
      japaneseBuffer += char;
    } else {
      if (japaneseBuffer.length >= ngramSize) {
        for (let i = 0; i <= japaneseBuffer.length - ngramSize; i++) {
          const ngram = japaneseBuffer.slice(i, i + ngramSize);
          if (!JAPANESE_STOP_WORDS.has(ngram)) {
            tokens.push(ngram);
          }
        }
      }
      japaneseBuffer = '';
    }
  }

  if (japaneseBuffer.length >= ngramSize) {
    for (let i = 0; i <= japaneseBuffer.length - ngramSize; i++) {
      const ngram = japaneseBuffer.slice(i, i + ngramSize);
      if (!JAPANESE_STOP_WORDS.has(ngram)) {
        tokens.push(ngram);
      }
    }
  }

  return tokens;
}

/**
 * Tokenize mixed text (English and Japanese)
 */
export function tokenize(text: string): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const tokens: string[] = [];

  if (containsJapanese(text)) {
    tokens.push(...tokenizeJapanese(text));
    const englishParts = text.replace(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/g, ' ');
    tokens.push(...tokenizeEnglish(englishParts));
  } else {
    tokens.push(...tokenizeEnglish(text));
  }

  return [...new Set(tokens)];
}

/**
 * Calculate term frequency for a list of tokens
 */
export function calculateTermFrequency(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) || 0) + 1);
  }
  return freq;
}

/**
 * Normalize a term for consistent indexing
 */
export function normalizeTerm(term: string): string {
  return term.toLowerCase().trim();
}
