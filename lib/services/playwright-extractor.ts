import { Page } from 'playwright';

export interface ExtractionConfig {
  dataType: string;
  selectors: {
    container?: string;
    fields: Record<string, string>;
  };
  maxRecords?: number;
}

export interface ExtractionResult {
  dataType: string;
  records: Array<Record<string, unknown>>;
  totalCount: number;
  extractedAt: Date;
}

export class PlaywrightExtractor {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async extractPageData(config: ExtractionConfig): Promise<ExtractionResult> {
    console.log(`\n📊 Starting data extraction for: ${config.dataType}`);
    console.log(`   Selectors:`, JSON.stringify(config.selectors, null, 2));

    const extractedAt = new Date();
    const records: Array<Record<string, unknown>> = [];

    try {
      const { container, fields } = config.selectors;
      const maxRecords = config.maxRecords || 100;

      if (container) {
        const containers = await this.page.locator(container).all();
        console.log(`   Found ${containers.length} container elements`);

        for (let i = 0; i < Math.min(containers.length, maxRecords); i++) {
          const containerEl = containers[i];
          const record: Record<string, unknown> = {};

          for (const [fieldName, selector] of Object.entries(fields)) {
            try {
              const element = containerEl.locator(selector).first();
              const text = await element.textContent({ timeout: 2000 });
              
              if (text && text.trim()) {
                record[fieldName] = text.trim();
              }

              if (selector.includes('href') || fieldName.toLowerCase().includes('url')) {
                const href = await element.getAttribute('href');
                if (href) {
                  record[fieldName] = href;
                }
              }

              if (fieldName.toLowerCase().includes('email')) {
                const emailMatch = text?.match(/[\w\.-]+@[\w\.-]+\.\w+/);
                if (emailMatch) {
                  record[fieldName] = emailMatch[0];
                }
              }
            } catch (fieldError) {
              console.warn(`     ⚠️ Could not extract field "${fieldName}": ${fieldError}`);
            }
          }

          if (Object.keys(record).length > 0) {
            records.push(record);
          }
        }
      } else {
        const singleRecord: Record<string, unknown> = {};

        for (const [fieldName, selector] of Object.entries(fields)) {
          try {
            const elements = await this.page.locator(selector).all();
            
            if (elements.length === 1) {
              const text = await elements[0].textContent({ timeout: 2000 });
              if (text && text.trim()) {
                singleRecord[fieldName] = text.trim();
              }
            } else if (elements.length > 1) {
              const values: string[] = [];
              for (const el of elements.slice(0, maxRecords)) {
                const text = await el.textContent({ timeout: 2000 });
                if (text && text.trim()) {
                  values.push(text.trim());
                }
              }
              singleRecord[fieldName] = values;
            }
          } catch (fieldError) {
            console.warn(`     ⚠️ Could not extract field "${fieldName}": ${fieldError}`);
          }
        }

        if (Object.keys(singleRecord).length > 0) {
          records.push(singleRecord);
        }
      }

      console.log(`   ✅ Successfully extracted ${records.length} records`);
      console.log(`   Sample:`, JSON.stringify(records[0] || {}, null, 2));

      return {
        dataType: config.dataType,
        records,
        totalCount: records.length,
        extractedAt
      };
    } catch (error) {
      console.error(`   ❌ Extraction error:`, error);
      
      return {
        dataType: config.dataType,
        records: [],
        totalCount: 0,
        extractedAt
      };
    }
  }

  async smartExtract(dataType: string, keywords: string[]): Promise<ExtractionResult> {
    console.log(`\n🧠 Smart extraction for: ${dataType}`);
    console.log(`   Keywords:`, keywords.join(', '));

    const extractedAt = new Date();
    const records: Array<Record<string, unknown>> = [];

    try {
      const commonSelectors = [
        'article', 'div[class*="card"]', 'div[class*="item"]',
        'li[class*="result"]', 'div[class*="product"]', 'div[class*="listing"]',
        'tr', 'div[class*="contact"]', 'div[class*="profile"]'
      ];

      for (const selector of commonSelectors) {
        const elements = await this.page.locator(selector).all();
        
        if (elements.length > 0 && elements.length < 200) {
          console.log(`   Trying selector: ${selector} (${elements.length} elements)`);

          for (let i = 0; i < Math.min(elements.length, 50); i++) {
            const el = elements[i];
            const text = await el.textContent({ timeout: 2000 });
            
            if (text && keywords.some(kw => text.toLowerCase().includes(kw.toLowerCase()))) {
              const record: Record<string, unknown> = {
                text: text.trim().substring(0, 500),
                selector: selector,
                index: i
              };

              const links = await el.locator('a').all();
              if (links.length > 0) {
                const hrefs = await Promise.all(links.map(link => link.getAttribute('href')));
                record.links = hrefs.filter(href => href).slice(0, 5);
              }

              const emailMatch = text.match(/[\w\.-]+@[\w\.-]+\.\w+/);
              if (emailMatch) {
                record.email = emailMatch[0];
              }

              records.push(record);
              
              if (records.length >= 20) break;
            }
          }
          
          if (records.length >= 20) break;
        }
      }

      console.log(`   ✅ Smart extracted ${records.length} records`);

      return {
        dataType,
        records,
        totalCount: records.length,
        extractedAt
      };
    } catch (error) {
      console.error(`   ❌ Smart extraction error:`, error);
      
      return {
        dataType,
        records: [],
        totalCount: 0,
        extractedAt
      };
    }
  }
}
