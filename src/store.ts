import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import type {
  CompanyMasterData,
  CompanyAssessment,
  CompetingCompanies,
  CompanyNews,
  MarketAnalysis,
  CompetitionAnalysis,
  ITStrategy,
  ServiceMatching,
  SalesMeetingPrep,
} from "./schemas.js";

export class DataStore {
  constructor(private baseDir: string) {}

  private domainDir(domain: string): string {
    return join(this.baseDir, domain);
  }

  private async ensureDir(dir: string): Promise<void> {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  private async readJson<T>(
    filePath: string,
    schema?: z.ZodType<T>,
  ): Promise<T | null> {
    if (!existsSync(filePath)) return null;
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return schema ? schema.parse(parsed) : (parsed as T);
  }

  private async writeJson(filePath: string, data: unknown): Promise<void> {
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));
    await this.ensureDir(dir);
    await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  // Master Data
  async readMasterData(domain: string): Promise<CompanyMasterData | null> {
    return this.readJson(join(this.domainDir(domain), "master-data.json"));
  }
  async writeMasterData(
    domain: string,
    data: CompanyMasterData,
  ): Promise<void> {
    await this.writeJson(join(this.domainDir(domain), "master-data.json"), data);
  }

  // Assessment
  async readAssessment(domain: string): Promise<CompanyAssessment | null> {
    return this.readJson(join(this.domainDir(domain), "assessment.json"));
  }
  async writeAssessment(
    domain: string,
    data: CompanyAssessment,
  ): Promise<void> {
    await this.writeJson(join(this.domainDir(domain), "assessment.json"), data);
  }

  // Competition
  async readCompetition(domain: string): Promise<CompetingCompanies | null> {
    return this.readJson(join(this.domainDir(domain), "competition.json"));
  }
  async writeCompetition(
    domain: string,
    data: CompetingCompanies,
  ): Promise<void> {
    await this.writeJson(join(this.domainDir(domain), "competition.json"), data);
  }

  // News - individual files per item
  async readNews(domain: string): Promise<CompanyNews[]> {
    const newsDir = join(this.domainDir(domain), "news");
    if (!existsSync(newsDir)) return [];
    const files = await readdir(newsDir);
    const items: CompanyNews[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const item = await this.readJson<CompanyNews>(join(newsDir, file));
      if (item) items.push(item);
    }
    return items;
  }

  async writeNews(domain: string, items: CompanyNews[]): Promise<void> {
    const newsDir = join(this.domainDir(domain), "news");
    await this.ensureDir(newsDir);
    for (let i = 0; i < items.length; i++) {
      const sanitized = items[i].source
        .replace(/[^a-zA-Z0-9.-]/g, "_")
        .substring(0, 100);
      await this.writeJson(join(newsDir, `${i}-${sanitized}.json`), items[i]);
    }
  }

  // Market Analysis - text as markdown, metadata as json
  async readMarketAnalysis(domain: string): Promise<MarketAnalysis | null> {
    const metaPath = join(this.domainDir(domain), "market-analysis.json");
    return this.readJson(metaPath);
  }

  async writeMarketAnalysis(
    domain: string,
    data: MarketAnalysis,
  ): Promise<void> {
    const dir = this.domainDir(domain);
    await this.ensureDir(dir);
    // Write the full analysis as markdown for readability
    await writeFile(
      join(dir, "market-analysis.md"),
      `# Market Analysis: ${domain}\n\n${data.analysis}`,
      "utf-8",
    );
    // Write structured data as JSON
    await this.writeJson(join(dir, "market-analysis.json"), data);
  }

  // Competition Analysis - one file per competitor
  async readCompetitionAnalysis(
    customerDomain: string,
    competitorDomain: string,
  ): Promise<CompetitionAnalysis | null> {
    return this.readJson(
      join(
        this.domainDir(customerDomain),
        "competition-analysis",
        `${competitorDomain}.json`,
      ),
    );
  }

  async readAllCompetitionAnalyses(
    customerDomain: string,
  ): Promise<CompetitionAnalysis[]> {
    const dir = join(this.domainDir(customerDomain), "competition-analysis");
    if (!existsSync(dir)) return [];
    const files = await readdir(dir);
    const analyses: CompetitionAnalysis[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const item = await this.readJson<CompetitionAnalysis>(join(dir, file));
      if (item) analyses.push(item);
    }
    return analyses;
  }

  async writeCompetitionAnalysis(
    customerDomain: string,
    data: CompetitionAnalysis,
  ): Promise<void> {
    await this.writeJson(
      join(
        this.domainDir(customerDomain),
        "competition-analysis",
        `${data.competitorDomain}.json`,
      ),
      data,
    );
  }

  // IT Strategy
  async readITStrategy(domain: string): Promise<ITStrategy | null> {
    return this.readJson(join(this.domainDir(domain), "it-strategy.json"));
  }
  async writeITStrategy(domain: string, data: ITStrategy): Promise<void> {
    await this.writeJson(join(this.domainDir(domain), "it-strategy.json"), data);
  }

  // Service Matching
  async readServiceMatching(domain: string): Promise<ServiceMatching | null> {
    return this.readJson(
      join(this.domainDir(domain), "service-matching.json"),
    );
  }
  async writeServiceMatching(
    domain: string,
    data: ServiceMatching,
  ): Promise<void> {
    await this.writeJson(
      join(this.domainDir(domain), "service-matching.json"),
      data,
    );
  }

  // Sales Meeting Prep
  async readSalesMeetingPrep(
    domain: string,
  ): Promise<SalesMeetingPrep | null> {
    return this.readJson(
      join(this.domainDir(domain), "sales-meeting-prep.json"),
    );
  }
  async writeSalesMeetingPrep(
    domain: string,
    data: SalesMeetingPrep,
  ): Promise<void> {
    await this.writeJson(
      join(this.domainDir(domain), "sales-meeting-prep.json"),
      data,
    );
  }
}
