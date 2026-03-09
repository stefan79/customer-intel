import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DataStore } from "./store.js";
import { generateMasterData } from "./agents/master-data.js";
import { generateAssessment } from "./agents/assessment.js";
import { generateCompetition } from "./agents/competition.js";
import { generateNews } from "./agents/news.js";
import { generateMarketAnalysis } from "./agents/market-analysis.js";
import { generateCompetitionAnalysis } from "./agents/competition-analysis.js";
import { generateITStrategy } from "./agents/it-strategy.js";
import { generateServiceMatching } from "./agents/service-matching.js";
import { generateSalesMeetingPrep } from "./agents/sales-meeting-prep.js";
import { generateReport } from "./report.js";
import { runReview, applyReview } from "./review.js";

export interface PipelineConfig {
  domain: string;
  name: string;
  vendorCatalogPath?: string;
  outputDir: string;
}

function log(stage: string, message: string) {
  const timestamp = new Date().toISOString().substring(11, 19);
  console.log(`[${timestamp}] [${stage}] ${message}`);
}

export async function runPipeline(config: PipelineConfig): Promise<void> {
  const { domain, name, vendorCatalogPath, outputDir } = config;
  const store = new DataStore(outputDir);
  const startTime = Date.now();

  console.log(`\n========================================`);
  console.log(`  Customer Intelligence Pipeline`);
  console.log(`  Target: ${name} (${domain})`);
  console.log(`========================================\n`);

  // ── Stage 1: Customer Master Data ──
  log("master-data", "Starting...");
  let masterData = await store.readMasterData(domain);
  if (masterData) {
    log("master-data", "Found cached data, skipping.");
  } else {
    masterData = await generateMasterData({ domain, name });
    await store.writeMasterData(domain, masterData);
    log("master-data", `Done: ${masterData.legalName} (${masterData.countryCode})`);
  }

  // ── Stage 2: Customer Assessment ──
  log("assessment", "Starting...");
  let assessment = await store.readAssessment(domain);
  if (assessment) {
    log("assessment", "Found cached data, skipping.");
  } else {
    assessment = await generateAssessment({
      domain,
      customerDomain: domain,
      legalName: masterData.legalName,
      subjectType: "customer",
    });
    await store.writeAssessment(domain, assessment);
    log(
      "assessment",
      `Done: ~${assessment.revenueInMio.value}M EUR revenue, ${assessment.numberOfEmployees.value} employees`,
    );
  }

  // ── Stage 3: Competition Discovery ──
  log("competition", "Starting...");
  let competition = await store.readCompetition(domain);
  if (competition) {
    log("competition", "Found cached data, skipping.");
  } else {
    competition = await generateCompetition({
      customerDomain: domain,
      legalName: masterData.legalName,
      domain,
      markets: assessment.markets.value,
      industries: assessment.industries.value,
      revenueInMio: assessment.revenueInMio.value,
    });
    await store.writeCompetition(domain, competition);
    log(
      "competition",
      `Done: Found ${competition.competition.length} competitors`,
    );
  }

  // ── Stage 4: Process each competitor (master-data + assessment + news + market-analysis) ──
  log("competitors", `Processing ${competition.competition.length} competitors...`);

  for (const comp of competition.competition) {
    const compDomain = comp.competitionDomain;
    const compName = comp.competitionLegalName;

    // 4a: Competitor Master Data
    let compMasterData = await store.readMasterData(compDomain);
    if (!compMasterData) {
      log("competitors", `[${compDomain}] Generating master data...`);
      compMasterData = await generateMasterData({
        domain: compDomain,
        name: compName,
      });
      await store.writeMasterData(compDomain, compMasterData);
    }

    // 4b: Competitor Assessment
    let compAssessment = await store.readAssessment(compDomain);
    if (!compAssessment) {
      log("competitors", `[${compDomain}] Generating assessment...`);
      compAssessment = await generateAssessment({
        domain: compDomain,
        customerDomain: domain,
        legalName: compMasterData.legalName,
        subjectType: "competitor",
      });
      await store.writeAssessment(compDomain, compAssessment);
    }

    // 4c: Competitor News
    let compNews = await store.readNews(compDomain);
    if (compNews.length === 0) {
      log("competitors", `[${compDomain}] Gathering news...`);
      compNews = await generateNews({
        domain: compDomain,
        customerDomain: domain,
        legalName: compMasterData.legalName,
        subjectType: "competitor",
      });
      await store.writeNews(compDomain, compNews);
    }

    // 4d: Competitor Market Analysis
    let compMarketAnalysis = await store.readMarketAnalysis(compDomain);
    if (!compMarketAnalysis) {
      log("competitors", `[${compDomain}] Generating market analysis...`);
      compMarketAnalysis = await generateMarketAnalysis({
        domain: compDomain,
        customerDomain: domain,
        legalName: compMasterData.legalName,
        subjectType: "competitor",
        industries: compAssessment.industries.value,
        markets: compAssessment.markets.value,
        newsItems: compNews,
      });
      await store.writeMarketAnalysis(compDomain, compMarketAnalysis);
    }

    log("competitors", `[${compDomain}] Complete.`);
  }

  // ── Stage 5: Customer News ──
  log("news", "Starting...");
  let customerNews = await store.readNews(domain);
  if (customerNews.length > 0) {
    log("news", "Found cached data, skipping.");
  } else {
    customerNews = await generateNews({
      domain,
      customerDomain: domain,
      legalName: masterData.legalName,
      subjectType: "customer",
    });
    await store.writeNews(domain, customerNews);
    log("news", `Done: ${customerNews.length} news items`);
  }

  // ── Stage 6: Customer Market Analysis ──
  log("market-analysis", "Starting...");
  let customerMarketAnalysis = await store.readMarketAnalysis(domain);
  if (customerMarketAnalysis) {
    log("market-analysis", "Found cached data, skipping.");
  } else {
    customerMarketAnalysis = await generateMarketAnalysis({
      domain,
      customerDomain: domain,
      legalName: masterData.legalName,
      subjectType: "customer",
      industries: assessment.industries.value,
      markets: assessment.markets.value,
      newsItems: customerNews,
    });
    await store.writeMarketAnalysis(domain, customerMarketAnalysis);
    log("market-analysis", "Done.");
  }

  // ── Stage 7: Competition Analysis (per competitor) ──
  log("competition-analysis", "Starting...");
  for (const comp of competition.competition) {
    const compDomain = comp.competitionDomain;

    const existing = await store.readCompetitionAnalysis(domain, compDomain);
    if (existing) {
      log("competition-analysis", `[${compDomain}] Found cached, skipping.`);
      continue;
    }

    const compMarketAnalysis = await store.readMarketAnalysis(compDomain);
    if (!compMarketAnalysis) {
      log(
        "competition-analysis",
        `[${compDomain}] No market analysis found, skipping.`,
      );
      continue;
    }

    log("competition-analysis", `[${compDomain}] Analyzing...`);
    const analysis = await generateCompetitionAnalysis({
      customerDomain: domain,
      competitorDomain: compDomain,
      customerLegalName: masterData.legalName,
      competitorLegalName: comp.competitionLegalName,
      customerMarketAnalysis: customerMarketAnalysis.analysis,
      competitorMarketAnalysis: compMarketAnalysis.analysis,
    });
    await store.writeCompetitionAnalysis(domain, analysis);
    log("competition-analysis", `[${compDomain}] Done.`);
  }

  // Load competition analyses (needed by both IT strategy and sales-meeting-prep)
  const competitionAnalyses = await store.readAllCompetitionAnalyses(domain);

  // ── Stage 8: IT Strategy (runs ONCE after all competition analyses) ──
  log("it-strategy", "Starting...");
  let itStrategy = await store.readITStrategy(domain);
  if (itStrategy) {
    log("it-strategy", "Found cached data, skipping.");
  } else {
    // Build evidence from market analyses and competition analyses
    const evidence: { id: string; source: string; text: string }[] = [];

    // Add customer market analysis as evidence
    evidence.push({
      id: `market-${domain}`,
      source: domain,
      text: customerMarketAnalysis.analysis.substring(0, 800),
    });

    // Add competitor market analyses as evidence
    for (const comp of competition.competition) {
      const compMA = await store.readMarketAnalysis(comp.competitionDomain);
      if (compMA) {
        evidence.push({
          id: `market-${comp.competitionDomain}`,
          source: comp.competitionDomain,
          text: compMA.analysis.substring(0, 800),
        });
      }
    }

    // Add competition analysis summaries as evidence
    for (const ca of competitionAnalyses) {
      evidence.push({
        id: `comp-${ca.competitionId}`,
        source: ca.competitorDomain,
        text: ca.summary.substring(0, 800),
      });
    }

    itStrategy = await generateITStrategy({
      customerDomain: domain,
      customerLegalName: masterData.legalName,
      subjectType: "customer",
      companyProfile: masterData,
      companyMarketAnalysis: customerMarketAnalysis,
      competitionAnalyses,
      evidence,
    });
    await store.writeITStrategy(domain, itStrategy);
    log(
      "it-strategy",
      `Done: ${itStrategy.strategies.length} strategies generated`,
    );
  }

  // ── Stage 9: Service Matching (optional) ──
  let serviceMatchingResult = await store.readServiceMatching(domain);
  if (vendorCatalogPath && !serviceMatchingResult) {
    log("service-matching", "Starting...");
    if (!existsSync(vendorCatalogPath)) {
      log(
        "service-matching",
        `Vendor catalog not found at ${vendorCatalogPath}, skipping.`,
      );
    } else {
      const vendorCatalog = await readFile(vendorCatalogPath, "utf-8");
      serviceMatchingResult = await generateServiceMatching({
        customerDomain: domain,
        customerLegalName: masterData.legalName,
        subjectType: "customer",
        itStrategy,
        companyProfile: masterData,
        vendorCatalog,
      });
      await store.writeServiceMatching(domain, serviceMatchingResult);
      log(
        "service-matching",
        `Done: ${serviceMatchingResult.matches.length} matches`,
      );
    }
  } else if (serviceMatchingResult) {
    log("service-matching", "Found cached data, skipping.");
  } else {
    log("service-matching", "No vendor catalog provided, skipping.");
  }

  // ── Stage 10: Sales Meeting Prep (optional, requires service matching) ──
  if (serviceMatchingResult) {
    let salesPrep = await store.readSalesMeetingPrep(domain);
    if (salesPrep) {
      log("sales-meeting-prep", "Found cached data, skipping.");
    } else {
      log("sales-meeting-prep", "Starting...");
      salesPrep = await generateSalesMeetingPrep({
        customerDomain: domain,
        customerLegalName: masterData.legalName,
        subjectType: "customer",
        companyProfile: masterData,
        assessment,
        itStrategy,
        serviceMatching: serviceMatchingResult,
        competitionAnalyses,
        customerMarketAnalysis: customerMarketAnalysis.analysis,
      });
      await store.writeSalesMeetingPrep(domain, salesPrep);
      log("sales-meeting-prep", "Done.");
    }
  } else {
    log("sales-meeting-prep", "Skipped (no service matching available).");
  }

  // ── Stage 11: Summary Report ──
  log("report", "Generating summary report...");
  const reportPath = await generateReport(store, domain, outputDir);
  log("report", `Done: ${reportPath}`);

  // ── Stage 12: Red-Team Review (strategic sections only) ──
  log("review", "Starting 3-agent review of strategic sections...");
  const reportText = await readFile(reportPath, "utf-8");

  const reviewPack = await runReview({
    reportText,
    customerName: masterData.legalName,
    customerDomain: domain,
    masterData,
    assessment,
  });

  // Save review pack
  const reviewPackPath = join(outputDir, domain, "review-pack.json");
  await writeFile(
    reviewPackPath,
    JSON.stringify(reviewPack, null, 2),
    "utf-8",
  );
  log(
    "review",
    `Review complete: ${reviewPack.prioritized_issues.length} issues found`,
  );

  // ── Stage 13: Inline review feedback into strategic sections ──
  const hasActionableIssues = reviewPack.prioritized_issues.some(
    (i) => i.final_action !== "KEEP",
  );

  if (hasActionableIssues) {
    log("review", "Inlining review feedback into strategic sections...");

    const customerContext = `Customer: ${masterData.legalName} (${domain})
Country: ${masterData.countryCode}
Industries: ${assessment.industries.value.join(", ")}
Markets: ${assessment.markets.value.join(", ")}
Revenue: ~${assessment.revenueInMio.value}M EUR`;

    const annotatedReport = await applyReview(
      reportText,
      reviewPack,
      customerContext,
    );

    // Overwrite the original report with the reviewed version (single output file)
    await writeFile(reportPath, annotatedReport, "utf-8");
    log("review", `Report updated with review feedback: ${reportPath}`);
  } else {
    log("review", "No actionable issues found, original report stands.");
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n========================================`);
  console.log(`  Pipeline complete in ${elapsed}s`);
  console.log(`  Output: ${outputDir}/${domain}/`);
  console.log(`  Report: ${reportPath}`);
  console.log(`  Review:  ${reviewPackPath}`);
  console.log(`========================================\n`);
}
