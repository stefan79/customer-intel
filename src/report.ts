import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DataStore } from "./store.js";

export async function generateReport(
  store: DataStore,
  customerDomain: string,
  outputDir: string,
): Promise<string> {
  const masterData = await store.readMasterData(customerDomain);
  const assessment = await store.readAssessment(customerDomain);
  const competition = await store.readCompetition(customerDomain);
  const marketAnalysis = await store.readMarketAnalysis(customerDomain);
  const competitionAnalyses =
    await store.readAllCompetitionAnalyses(customerDomain);
  const itStrategy = await store.readITStrategy(customerDomain);
  const serviceMatching = await store.readServiceMatching(customerDomain);
  const salesPrep = await store.readSalesMeetingPrep(customerDomain);

  const lines: string[] = [];
  const add = (text: string) => lines.push(text);

  add(`# Customer Intelligence Report: ${masterData?.legalName ?? customerDomain}`);
  add(`_Generated: ${new Date().toISOString().substring(0, 10)}_\n`);

  // ══════════════════════════════════════════════════════
  // MAIN REPORT - Strategic sections first
  // ══════════════════════════════════════════════════════

  // ── Executive Briefing ──
  if (salesPrep) {
    add(`## Executive Briefing\n`);
    add(salesPrep.executiveBriefing);
    add(``);
  }

  // ── Assumed Capability Baseline ──
  if (salesPrep) {
    add(`## Assumed Capability Baseline\n`);
    add(salesPrep.capabilityBaseline);
    add(``);
  }

  // ── Strategic Hypotheses ──
  if (salesPrep && salesPrep.strategicHypotheses.length > 0) {
    add(`## Strategic Hypotheses\n`);
    salesPrep.strategicHypotheses.forEach((h, i) =>
      add(`${i + 1}. ${h}`),
    );
    add(``);
  }

  // ── Questions to Ask ──
  if (salesPrep && salesPrep.questionsToAsk.length > 0) {
    add(`## Questions to Ask\n`);
    salesPrep.questionsToAsk.forEach((q) => add(`- ${q}`));
    add(``);
  }

  // ── Strategic Impulses ──
  if (salesPrep && salesPrep.strategicImpulses.length > 0) {
    add(`## Strategic Impulses\n`);
    for (const impulse of salesPrep.strategicImpulses) {
      add(`### ${impulse.title}\n`);
      add(`**Why:** ${impulse.why}\n`);
      add(`**How:** ${impulse.how}\n`);
      add(`**What:** ${impulse.what}\n`);
      add(`**Industry Standard (IS):** ${impulse.industryStandard}\n`);
      add(`**Leader Practices (TO BE):** ${impulse.leaderPractices}\n`);
      add(`**Caveats:** ${impulse.caveats}\n`);
      add(`**Analyst View:** ${impulse.analystView}\n`);
      if (impulse.sources.length > 0) {
        add(`*Sources: ${impulse.sources.join(", ")}*\n`);
      }
    }
  }

  // ── POC Ideas ──
  if (salesPrep && salesPrep.pocIdeas.length > 0) {
    add(`## POC Ideas\n`);
    for (const poc of salesPrep.pocIdeas) {
      add(`### ${poc.title}\n`);
      add(`**Why:** ${poc.why}\n`);
      add(`**How:** ${poc.how}\n`);
      add(`**Success Factors:**`);
      for (const sf of poc.successFactors) {
        add(`- **${sf.metric}**`);
        add(`  _How we ensure this:_ ${sf.howToEnsure}`);
      }
      add(``);
      add(`**Bottom Line:** ${poc.bottomLine}\n`);
    }
  }

  // ══════════════════════════════════════════════════════
  // ANNEX - Supporting data and analysis
  // ══════════════════════════════════════════════════════

  add(`---\n`);
  add(`# Annex: Supporting Data & Analysis\n`);

  // ── A: Company Overview ──
  add(`## A. Company Overview\n`);
  if (masterData) {
    add(`| Field | Value |`);
    add(`|-------|-------|`);
    add(`| Legal Name | ${masterData.legalName} |`);
    add(`| Domain | ${masterData.domain} |`);
    add(`| Country | ${masterData.countryCode} |`);
    add(
      `| Address | ${masterData.address.street}, ${masterData.address.postalCode} ${masterData.address.city}, ${masterData.address.country} |`,
    );
    add(``);
  }

  // ── B: Company Assessment ──
  add(`## B. Company Assessment\n`);
  if (assessment) {
    add(`| Metric | Value | Confidence | Source |`);
    add(`|--------|-------|------------|--------|`);
    add(
      `| Revenue | ${assessment.revenueInMio.value}M EUR | ${(assessment.revenueInMio.confidence * 100).toFixed(0)}% | ${assessment.revenueInMio.source} |`,
    );
    add(
      `| Revenue Growth | ${assessment.revenueGrowth.value}% | ${(assessment.revenueGrowth.confidence * 100).toFixed(0)}% | ${assessment.revenueGrowth.source} |`,
    );
    add(
      `| Employees | ${assessment.numberOfEmployees.value} | ${(assessment.numberOfEmployees.confidence * 100).toFixed(0)}% | ${assessment.numberOfEmployees.source} |`,
    );
    add(
      `| IT Employees | ${assessment.numberOfITEmployees.value} | ${(assessment.numberOfITEmployees.confidence * 100).toFixed(0)}% | ${assessment.numberOfITEmployees.source} |`,
    );
    add(
      `| IT Spend | ${assessment.itSpendInMio.value}M EUR | ${(assessment.itSpendInMio.confidence * 100).toFixed(0)}% | ${assessment.itSpendInMio.source} |`,
    );
    add(
      `| Digital Maturity | ${assessment.digitalMaturity.value} | ${(assessment.digitalMaturity.confidence * 100).toFixed(0)}% | ${assessment.digitalMaturity.source} |`,
    );
    add(``);
    add(`**Industries:** ${assessment.industries.value.join(", ")}`);
    add(`**Markets:** ${assessment.markets.value.join(", ")}`);
    if (assessment.industrySpecificConstraints.value.length > 0) {
      add(
        `**Constraints:** ${assessment.industrySpecificConstraints.value.join(", ")}`,
      );
    }
    add(``);
  }

  // ── C: Competitive Landscape ──
  add(`## C. Competitive Landscape\n`);
  if (competition && competition.competition.length > 0) {
    add(`| # | Competitor | Domain |`);
    add(`|---|-----------|--------|`);
    competition.competition.forEach((c, i) => {
      add(
        `| ${i + 1} | ${c.competitionLegalName} | ${c.competitionDomain} |`,
      );
    });
    add(``);

    if (competitionAnalyses.length > 0) {
      add(`### Competition Analysis Details\n`);
      for (const ca of competitionAnalyses) {
        add(`#### vs ${ca.competitorLegalName}\n`);
        add(`${ca.summary}\n`);
        if (ca.strengths.length > 0) {
          add(`**Strengths (competitor):**`);
          ca.strengths.forEach((s) => add(`- ${s}`));
          add(``);
        }
        if (ca.weaknesses.length > 0) {
          add(`**Weaknesses (competitor):**`);
          ca.weaknesses.forEach((w) => add(`- ${w}`));
          add(``);
        }
        if (ca.marketTrends.length > 0) {
          add(`**Market Trends:**`);
          ca.marketTrends.forEach((t) => add(`- ${t}`));
          add(``);
        }
      }
    }
  }

  // ── D: Market Analysis ──
  add(`## D. Market Analysis\n`);
  if (marketAnalysis) {
    add(marketAnalysis.analysis);
    add(``);
  }

  // ── E: IT Strategy Recommendations ──
  add(`## E. IT Strategy Recommendations\n`);
  if (itStrategy) {
    for (const strategy of itStrategy.strategies) {
      add(`### ${strategy.name}\n`);
      add(`- **Intent:** ${strategy.intent}`);
      add(`- **Competitive Rationale:** ${strategy.competitiveRationale}`);
      add(
        `- **Business Capability Impact:** ${strategy.businessCapabilityImpact}`,
      );
      add(
        `- **IT Capability Implications:** ${strategy.itCapabilityImplications}`,
      );
      add(`- **Risk if Not Pursued:** ${strategy.riskIfNotPursued}`);
      add(`- **Time Horizon:** ${strategy.timeHorizon}`);
      add(``);
    }

    if (itStrategy.strengthAmplification.length > 0) {
      add(
        `**Strength Amplification:** ${itStrategy.strengthAmplification.join(", ")}`,
      );
    }
    if (itStrategy.weaknessCompensation.length > 0) {
      add(
        `**Weakness Compensation:** ${itStrategy.weaknessCompensation.join(", ")}`,
      );
    }
    if (itStrategy.newNicheDifferentiation.length > 0) {
      add(
        `**New Niche Differentiation:** ${itStrategy.newNicheDifferentiation.join(", ")}`,
      );
    }
    add(``);
  }

  // ── F: Service Matching ──
  if (serviceMatching) {
    add(`## F. Service Matching\n`);
    for (const match of serviceMatching.matches) {
      add(`### ${match.strategyName}\n`);
      if (match.supportingServices.length > 0) {
        add(`**Supporting Services:**`);
        match.supportingServices.forEach((s) => add(`- ${s}`));
      }
      add(`**Value Contribution:** ${match.valueContribution}`);
      if (match.entryLevelEngagementIdeas.length > 0) {
        add(`**Entry-Level Engagement Ideas:**`);
        match.entryLevelEngagementIdeas.forEach((e) => add(`- ${e}`));
      }
      if (match.gaps.length > 0) {
        add(`**Gaps:**`);
        match.gaps.forEach((g) => add(`- ${g}`));
      }
      add(``);
    }
  }

  // ── Sources ──
  add(`## Sources\n`);
  const allSources = new Set<string>();
  if (itStrategy) {
    itStrategy.sources.forEach((s) => allSources.add(s));
  }
  for (const ca of competitionAnalyses) {
    ca.sources.forEach((s) => allSources.add(s));
  }
  if (salesPrep) {
    for (const impulse of salesPrep.strategicImpulses) {
      impulse.sources.forEach((s) => allSources.add(s));
    }
  }
  for (const source of allSources) {
    add(`- ${source}`);
  }
  add(``);

  const reportContent = lines.join("\n");
  const reportPath = join(outputDir, customerDomain, "report.md");
  await writeFile(reportPath, reportContent, "utf-8");
  return reportPath;
}
