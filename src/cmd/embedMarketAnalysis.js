import OpenAI from "openai";
import { chunkTextWink } from "../util/chunker.js"
import Model from "../model.js"
import { generatePrompt } from "../util/openai.js";
import { Resource } from "sst";

const oc = new OpenAI({
  apiKey: Resource.OpenAIApiKey.value,
});


const swotLensPrompt = {
  input: `
  Company: <%= master.legalName%> (<%= master.domain%>)
Context: industries=<%assessment.industries.value.join(", ") %> markets=<%assessment.markets.value.join(", ") %> horizon=2-3 years
Task: Extract evidence relevant to market context, customer demand patterns, industry trends, and customer implications.


Task:
Extract evidence from the passage below that is relevant to a market and customer-demand analysis for the company.
This is not a competitive analysis and must not include solution proposals or initiatives.

Focus on identifying concrete, factual signals (or clearly reasoned inferences) related to:

A) Market context
- The company’s business model and position in the value chain (e.g. manufacturer, formulator, distributor, service provider).
- Primary products, services, applications, and end markets.
- Customer types and routes-to-market (e.g. OEMs, industrial customers, distributors, direct sales).
- Indicators of scale and maturity (e.g. sites, production capacity, footprint, employee or revenue band).

B) Customer demand patterns
- Price and cost pressure; total cost of ownership expectations.
- Reliability and quality requirements; supply assurance; lead times.
- Need for customization, technical service, and speed of iteration.
- Sustainability expectations (e.g. low-VOC, recycled content, CO₂ footprint, certifications).
- Compliance and regulatory demands (e.g. safety, reporting, traceability).
- Digital expectations (e.g. customer portals, order tracking, self-service, EDI/API integration).
- Data transparency needs (e.g. product data, SDS, certificates, provenance).

C) Market and industry trends (current to 2–3 years)
- Economic and structural trends affecting the industry.
- Regulatory developments and compliance burdens.
- Supply-chain dynamics, raw-material availability, and volatility.
- Energy costs, labor availability, and cost-structure pressures.
- Sustainability and decarbonization pressures.
- Technology and digital trends that materially impact the industry.
- Where possible, distinguish between well-established trends and emerging or early-stage signals.

D) Implications for customers
- How the identified demand patterns and trends change expectations placed on companies like <LEGAL_NAME>.
- Operational implications (e.g. planning, sourcing, quality, compliance processes).
- Commercial implications (e.g. service levels, transparency, contracting expectations).
- Organizational implications (e.g. skills, governance, ways of working).

Guidelines:
- Prefer hard facts and verifiable statements; if inferring, make the inference explicit.
- Avoid marketing language and speculation.
- Do not reference competitors or competitive positioning.
- Do not propose initiatives, solutions, or roadmaps.

  Evidence passage:
  <%+ evidence%>
`
}

export default async function(
  master,
  assessment,
  analysis
) {

  Model.companyMasterData.validate(master)
  Model.companyAssessment.validate(assessment)
  Model.marketAnalysis.validate(analysis)

  const chunks = chunkTextWink(analysis.analysis, {
    maxWords: 120,
    overlapWords: 25,
  });

  for (const chunk of chunks) {

    const prompt = generatePrompt(swotLensPrompt, {
      master,
      assessment,
      analysis,
      evidence: chunk
    })

    const response = await oc.embeddings.create({
      model: "text-embedding-3-small",
      ...prompt
    })

    const swotVector = response.data[0].embedding
    return swotVector
  }
}