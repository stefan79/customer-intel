import winkTokenizer from "wink-tokenizer";

const tokenizer = winkTokenizer();
tokenizer.defineConfig({
  useTag: true,
  useEntity: false,
  usePOS: false,
});

/**
 * Chunk text by sentences, grouped to ~maxWords with overlap
 */
export function chunkTextWink(
  text,
  { maxWords = 120, overlapWords = 25 } = {}
) {
  const tokens = tokenizer.tokenize(text);

  const sentences = [];
  let currentSentence = [];
  let currentWords = 0;

  for (const t of tokens) {
    if (t.tag === "word") {
      currentSentence.push(t.value);
      currentWords++;
    }

    if (t.tag === "punctuation" && /[.!?]/.test(t.value)) {
      if (currentSentence.length) {
        sentences.push({
          text: currentSentence.join(" "),
          wordCount: currentWords,
        });
      }
      currentSentence = [];
      currentWords = 0;
    }
  }

  if (currentSentence.length) {
    sentences.push({
      text: currentSentence.join(" "),
      wordCount: currentWords,
    });
  }

  // Pack sentences into chunks
  const chunks = [];
  let buffer = [];
  let bufferWords = 0;

  for (const s of sentences) {
    if (bufferWords + s.wordCount > maxWords && buffer.length) {
      chunks.push(buffer.join(" "));
      // overlap
      buffer = buffer.slice(-overlapWords);
      bufferWords = buffer.length;
    }
    buffer.push(s.text);
    bufferWords += s.wordCount;
  }

  if (buffer.length) {
    chunks.push(buffer.join(" "));
  }

  return chunks;
}