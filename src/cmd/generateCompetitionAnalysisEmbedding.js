import { z } from "zod";
import OpenAI from "openai";
import { Resource } from "sst";
import ValidationCreator from "../util/request.js";

const oc = new OpenAI({
  apiKey: Resource.OpenAIApiKey.value,
});

const requestSchema = z.object({
  analysis: z.string().min(1),
  newsSnippets: z.array(z.string().min(1)).optional(),
});

const requestValidator = ValidationCreator(requestSchema);

function splitIntoChunks(text, maxLength = 1200) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);

  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (!paragraph) continue;
    if ((current + "\n\n" + paragraph).trim().length <= maxLength) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      continue;
    }
    if (current) {
      chunks.push(current);
    }
    if (paragraph.length > maxLength) {
      chunks.push(paragraph.slice(0, maxLength));
      current = paragraph.slice(maxLength);
    } else {
      current = paragraph;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function averageVectors(vectors) {
  if (!vectors.length) return [];
  const length = vectors[0].length;
  const sums = new Array(length).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < length; i += 1) {
      sums[i] += vec[i];
    }
  }
  return sums.map((value) => value / vectors.length);
}

export default async function generateCompetitionAnalysisEmbedding(request) {
  const req = requestValidator(request);
  const evidenceChunks = splitIntoChunks(req.analysis);

  const embeddings = [];
  for (const chunk of evidenceChunks) {
    const evidence = [
      ...(req.newsSnippets ?? []),
      chunk,
    ]
      .join(" ")
      .trim();

    const text = `Evidence: ${evidence}. Task: compare strengths, weaknesses, niches, trends, and expectations for customer vs competitor.`;

    const response = await oc.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });

    embeddings.push(response.data[0].embedding);
  }

  return averageVectors(embeddings);
}

export { requestValidator };
