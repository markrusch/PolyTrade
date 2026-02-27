/**
 * MarketDiscoveryService - Multi-Strike Market Discovery with Robust Token Resolution
 * 
 * Implements 3-tier fallback strategy for resolving Polymarket binary option markets:
 * 1. Gamma API slug lookup (primary)
 * 2. Gamma API question text search (fallback)
 * 3. CLOB API condition_id lookup (last resort)
 */

import axios from 'axios';
import { createLogger } from '../../lib/logger/index.js';

const logger = createLogger({ service: 'MarketDiscoveryService' });

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ResolvedMarket {
    slug: string;
    title: string;
    strike: number;
    maturity: Date;
    conditionId: string;
    tokens: {
        yes: string;
        no: string;
    };
}

export interface MaturityGroup {
    maturity: Date;
    conditionId: string;
    strikes: Array<{
        strike: number;
        slug: string;
        tokens: { yes: string; no: string };
        title: string;
    }>;
}

export type MultiStrikeMarkets = Record<string, MaturityGroup>;

export interface StrikeLadderValidation {
    valid: boolean;
    gaps: number[];
    spacing: number | null;
    reason: string;
}

interface GammaMarket {
    slug: string;
    question: string;
    title?: string;
    endDateIso?: string;
    endDate?: string;
    end_date_iso?: string;
    conditionId: string;
    condition_id?: string;
    clobTokenIds?: string[];
    clob_token_ids?: string[];
    tokens?: Array<{ token_id: string; outcome: string }>;
    active?: boolean;
    closed?: boolean;
}

interface ClobMarket {
    condition_id: string;
    tokens: Array<{
        token_id: string;
        outcome: string;
    }>;
}

// ═══════════════════════════════════════════════════════════════
// MARKET DISCOVERY SERVICE
// ═══════════════════════════════════════════════════════════════

export class MarketDiscoveryService {
    private gammaApiUrl = 'https://gamma-api.polymarket.com';
    private clobApiUrl = 'https://clob.polymarket.com';
    private cache = new Map<string, { data: any; timestamp: number }>();
    private cacheTTL = 60000; // 1 minute

    /**
     * STRATEGY 1: Gamma API slug lookup (primary)
     * STRATEGY 2: Gamma API question text search (fallback)
     * STRATEGY 3: CLOB API condition_id lookup (last resort)
     */
    async resolveMarketBySlug(slug: string): Promise<ResolvedMarket | null> {
        try {
            logger.debug(`Resolving slug: ${slug}`);

            // STRATEGY 1: Direct slug lookup
            const gammaMarket = await this.getMarketBySlug(slug);

            if (!gammaMarket) {
                logger.warn(`Slug ${slug} not found in Gamma API`);
                return null;
            }

            // Extract token IDs
            const tokenIds = this.extractTokenIds(gammaMarket);

            if (tokenIds.yes && tokenIds.no) {
                logger.debug(`✓ Strategy 1 success for ${slug}`);
                return this.buildResolvedMarket(slug, gammaMarket, tokenIds);
            }

            // STRATEGY 2: Search by question text
            const question = gammaMarket.question || gammaMarket.title || '';
            if (question) {
                logger.warn(`Slug ${slug} missing tokens, trying question search`);
                const searchResults = await this.searchMarkets(question.slice(0, 50));
                const match = searchResults.find(m => m.slug === slug);

                if (match) {
                    const matchTokens = this.extractTokenIds(match);
                    if (matchTokens.yes && matchTokens.no) {
                        logger.debug(`✓ Strategy 2 success for ${slug}`);
                        return this.buildResolvedMarket(slug, match, matchTokens);
                    }
                }
            }

            // STRATEGY 3: CLOB API via condition_id
            const conditionId = gammaMarket.conditionId || gammaMarket.condition_id;
            if (conditionId) {
                logger.warn(`Trying CLOB API for condition ${conditionId}`);
                const clobMarkets = await this.getMarketsByConditionId(conditionId);

                if (clobMarkets.length > 0 && clobMarkets[0].tokens?.length >= 2) {
                    const tokens = clobMarkets[0].tokens;
                    const yesToken = tokens.find(t => t.outcome?.toLowerCase() === 'yes');
                    const noToken = tokens.find(t => t.outcome?.toLowerCase() === 'no');

                    if (yesToken && noToken) {
                        logger.debug(`✓ Strategy 3 success for ${slug}`);
                        return {
                            slug,
                            title: gammaMarket.question || gammaMarket.title || slug,
                            strike: this.parseStrikeFromSlug(slug),
                            maturity: this.parseMaturityFromMarket(gammaMarket),
                            conditionId,
                            tokens: {
                                yes: yesToken.token_id,
                                no: noToken.token_id,
                            },
                        };
                    }
                }
            }

            logger.error(`✗ All strategies failed for ${slug}`);
            return null;
        } catch (error) {
            logger.error(`Error resolving ${slug}:`, error);
            return null;
        }
    }

    /**
     * Extract token IDs from various API response formats
     * Handles multiple API response structures for maximum compatibility
     */
    private extractTokenIds(market: GammaMarket): { yes: string | null; no: string | null } {
        // Strategy 1: Try clobTokenIds array (most common format)
        const tokenIds = market.clobTokenIds || market.clob_token_ids || (market as any).clob_token_ids;
        if (Array.isArray(tokenIds) && tokenIds.length >= 2) {
            return { yes: String(tokenIds[0]), no: String(tokenIds[1]) };
        }

        // Strategy 2: Try tokens array with outcome property
        if (Array.isArray(market.tokens) && market.tokens.length >= 2) {
            const yesToken = market.tokens.find(t => 
                t.outcome?.toLowerCase() === 'yes' || 
                t.outcome?.toLowerCase() === 'true' ||
                (t as any).winner === true
            );
            const noToken = market.tokens.find(t => 
                t.outcome?.toLowerCase() === 'no' || 
                t.outcome?.toLowerCase() === 'false' ||
                (t as any).winner === false
            );
            if (yesToken && noToken) {
                return { yes: yesToken.token_id, no: noToken.token_id };
            }
            // Fallback: if no outcome field, use positional (first=YES, second=NO)
            if (market.tokens[0]?.token_id && market.tokens[1]?.token_id) {
                return { yes: market.tokens[0].token_id, no: market.tokens[1].token_id };
            }
        }

        // Strategy 3: Try nested response format (some API versions)
        const anyMarket = market as any;
        if (anyMarket.yes_token_id && anyMarket.no_token_id) {
            return { yes: anyMarket.yes_token_id, no: anyMarket.no_token_id };
        }

        // Strategy 4: Try outcomes array with token_ids
        if (anyMarket.outcomes && Array.isArray(anyMarket.outcomes)) {
            const yesOutcome = anyMarket.outcomes.find((o: any) => o.name?.toLowerCase() === 'yes');
            const noOutcome = anyMarket.outcomes.find((o: any) => o.name?.toLowerCase() === 'no');
            if (yesOutcome?.token_id && noOutcome?.token_id) {
                return { yes: yesOutcome.token_id, no: noOutcome.token_id };
            }
        }

        return { yes: null, no: null };
    }

    /**
     * Build resolved market from Gamma API response
     */
    private buildResolvedMarket(
        slug: string,
        market: GammaMarket,
        tokens: { yes: string | null; no: string | null }
    ): ResolvedMarket {
        return {
            slug,
            title: market.question || market.title || slug,
            strike: this.parseStrikeFromSlug(slug),
            maturity: this.parseMaturityFromMarket(market),
            conditionId: market.conditionId || market.condition_id || '',
            tokens: {
                yes: tokens.yes || '',
                no: tokens.no || '',
            },
        };
    }

    /**
     * Parse maturity date from market object
     */
    private parseMaturityFromMarket(market: GammaMarket): Date {
        const dateStr = market.endDateIso || market.endDate || market.end_date_iso;
        if (dateStr) {
            return new Date(dateStr);
        }
        // Default to 30 days from now if no date
        return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }

    /**
     * Enhanced strike parsing with multiple pattern support
     * Handles: 100k, 92000, 100,000, 95.5k, below patterns, reach patterns
     */
    parseStrikeFromSlug(slug: string): number {
        // Normalize slug for easier parsing
        const normalizedSlug = slug.toLowerCase().replace(/_/g, '-');

        // Pattern 1: K notation with decimals "bitcoin-above-95.5k" or "bitcoin-above-100k"
        const kMatch = normalizedSlug.match(/(?:above|below|reach|at)[- ](\d+\.?\d*)k/i);
        if (kMatch) {
            return Math.round(parseFloat(kMatch[1]) * 1000);
        }

        // Pattern 2: Comma-formatted "bitcoin-above-100,000" (check before direct number)
        const commaMatch = normalizedSlug.match(/(?:above|below|reach|at)[- ]([\d,]+)(?![k\d])/i);
        if (commaMatch && commaMatch[1].includes(',')) {
            return parseInt(commaMatch[1].replace(/,/g, ''));
        }

        // Pattern 3: Direct number "bitcoin-above-92000"
        const directMatch = normalizedSlug.match(/(?:above|below|reach|at)[- ](\d{4,})(?!k)/i);
        if (directMatch) {
            return parseInt(directMatch[1]);
        }

        // Pattern 4: Dollar notation "$95,000" or "$100k"
        const dollarMatch = normalizedSlug.match(/\$([\d,]+)k?/i);
        if (dollarMatch) {
            const numStr = dollarMatch[1].replace(/,/g, '');
            const multiplier = normalizedSlug.includes('k') ? 1000 : 1;
            return Math.round(parseFloat(numStr) * multiplier);
        }

        // Pattern 5: Price in question format "at $95000"
        const priceMatch = normalizedSlug.match(/(\d{4,})/i);
        if (priceMatch) {
            return parseInt(priceMatch[1]);
        }

        // Return 0 if no pattern matches (don't throw - let caller handle)
        logger.warn(`Cannot parse strike from slug: ${slug}`);
        return 0;
    }

    /**
     * Discover all multi-strike markets for a cryptocurrency
     * Uses multiple search patterns and filters for better coverage
     */
    async discoverMultiStrikeMarkets(crypto: 'BTC' | 'ETH'): Promise<MultiStrikeMarkets> {
        const cryptoPatterns: Record<string, string[]> = {
            BTC: ['bitcoin above', 'btc above', 'bitcoin reach', 'bitcoin price'],
            ETH: ['ethereum above', 'eth above', 'ethereum reach', 'ether price'],
        };

        const patterns = cryptoPatterns[crypto] || [];
        const allMarkets: ResolvedMarket[] = [];
        const seenSlugs = new Set<string>();
        const failedSlugs: string[] = [];

        logger.info(`Discovering ${crypto} multi-strike markets...`);

        for (const pattern of patterns) {
            try {
                logger.debug(`Searching: "${pattern}"`);
                const markets = await this.searchMarkets(pattern, 200); // Increased limit
                logger.debug(`Found ${markets.length} results for "${pattern}"`);

                for (const market of markets) {
                    // Skip if already processed
                    if (seenSlugs.has(market.slug)) continue;
                    seenSlugs.add(market.slug); // Mark as seen immediately to avoid duplicates

                    // Filter for active binary strike markets
                    if (market.active === false || market.closed === true) {
                        logger.debug(`Skipping inactive/closed: ${market.slug}`);
                        continue;
                    }
                    
                    const question = market.question || market.title || '';
                    if (!this.isMultiStrikeMarket(question)) {
                        continue;
                    }

                    try {
                        const resolved = await this.resolveMarketBySlug(market.slug);
                        if (resolved && resolved.tokens.yes && resolved.tokens.no && resolved.strike > 0) {
                            allMarkets.push(resolved);
                            logger.debug(`✓ Resolved: ${market.slug} (strike: ${resolved.strike})`);
                        } else {
                            failedSlugs.push(market.slug);
                            logger.debug(`✗ Failed to resolve: ${market.slug}`);
                        }
                    } catch (err) {
                        failedSlugs.push(market.slug);
                        logger.debug(`✗ Error resolving ${market.slug}: ${err}`);
                    }
                }
            } catch (error) {
                logger.error(`Error searching ${pattern}:`, error);
            }

            // Small delay between search patterns to avoid rate limiting
            await new Promise(r => setTimeout(r, 200));
        }

        logger.info(`Resolved ${allMarkets.length} markets for ${crypto} (${failedSlugs.length} failed)`);
        return this.groupByMaturity(allMarkets);
    }

    /**
     * Check if market matches multi-strike format
     * Covers various phrasings used in Polymarket questions
     */
    private isMultiStrikeMarket(question: string): boolean {
        const patterns = [
            // "Will Bitcoin be above $X" patterns
            /will (bitcoin|btc|ethereum|eth|ether) be above \$?[\d,k.]+/i,
            /(bitcoin|btc|ethereum|eth|ether) above \$?[\d,k.]+/i,
            /will (bitcoin|btc|ethereum|eth|ether) reach \$?[\d,k.]+/i,
            /will (bitcoin|btc|ethereum|eth|ether) be (over|greater than|at least) \$?[\d,k.]+/i,
            /will (bitcoin|btc|ethereum|eth|ether) (price|hit|touch) \$?[\d,k.]+/i,
            // "Bitcoin to $X" patterns
            /(bitcoin|btc|ethereum|eth|ether) to \$?[\d,k.]+/i,
            // "$X Bitcoin" patterns (price target format)
            /\$[\d,k.]+ (bitcoin|btc|ethereum|eth|ether)/i,
            // "Bitcoin > $X" or "BTC >= $X" patterns
            /(bitcoin|btc|ethereum|eth|ether)\s*[>>=]+\s*\$?[\d,k.]+/i,
        ];
        return patterns.some(p => p.test(question));
    }

    /**
     * Group markets by maturity date with proper sorting
     */
    private groupByMaturity(markets: ResolvedMarket[]): MultiStrikeMarkets {
        const grouped = new Map<string, MaturityGroup>();

        for (const market of markets) {
            const maturityKey = market.maturity.toISOString().split('T')[0]; // YYYY-MM-DD

            if (!grouped.has(maturityKey)) {
                grouped.set(maturityKey, {
                    maturity: market.maturity,
                    conditionId: market.conditionId,
                    strikes: [],
                });
            }

            grouped.get(maturityKey)!.strikes.push({
                strike: market.strike,
                slug: market.slug,
                tokens: market.tokens,
                title: market.title,
            });
        }

        // Sort strikes within each maturity (ascending)
        for (const group of grouped.values()) {
            group.strikes.sort((a, b) => a.strike - b.strike);
        }

        // Convert to object sorted by maturity date
        const sortedEntries = Array.from(grouped.entries()).sort(
            (a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime()
        );

        return Object.fromEntries(sortedEntries);
    }

    /**
     * Validate strike ladder has reasonable spacing
     */
    validateStrikeLadder(strikes: number[]): StrikeLadderValidation {
        if (strikes.length < 3) {
            return {
                valid: true, // Accept small ladders
                gaps: [],
                spacing: strikes.length === 2 ? strikes[1] - strikes[0] : null,
                reason: 'Insufficient strikes for full validation',
            };
        }

        const sortedStrikes = [...strikes].sort((a, b) => a - b);
        const gaps: number[] = [];

        for (let i = 0; i < sortedStrikes.length - 1; i++) {
            gaps.push(sortedStrikes[i + 1] - sortedStrikes[i]);
        }

        // Find most common spacing
        const spacingCounts = new Map<number, number>();
        for (const gap of gaps) {
            spacingCounts.set(gap, (spacingCounts.get(gap) || 0) + 1);
        }

        const [commonSpacing] = Array.from(spacingCounts.entries()).sort((a, b) => b[1] - a[1])[0] || [
            0,
        ];

        // Check if 70%+ gaps match common spacing (within 20% tolerance)
        const matchingGaps = gaps.filter(
            g => commonSpacing > 0 && Math.abs(g - commonSpacing) / commonSpacing < 0.2
        );

        const valid = matchingGaps.length >= gaps.length * 0.7;
        const irregularGaps = gaps.filter(
            g => commonSpacing > 0 && Math.abs(g - commonSpacing) / commonSpacing >= 0.2
        );

        return {
            valid,
            gaps: irregularGaps,
            spacing: commonSpacing,
            reason: valid ? 'Regular spacing' : `Irregular gaps: ${irregularGaps.join(', ')}`,
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // API METHODS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Search markets by query string with caching
     */
    async searchMarkets(query: string, limit = 100): Promise<GammaMarket[]> {
        const cacheKey = `search:${query}:${limit}`;
        const cached = this.cache.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            logger.debug(`Cache hit for search: ${query}`);
            return cached.data;
        }

        try {
            const url = `${this.gammaApiUrl}/markets`;
            const response = await axios.get(url, {
                params: { query, limit, active: true },
                timeout: 10000,
            });

            const markets = Array.isArray(response.data) ? response.data : [];
            this.cache.set(cacheKey, { data: markets, timestamp: Date.now() });
            logger.debug(`Search returned ${markets.length} markets`);
            return markets;
        } catch (error) {
            logger.error('Search failed:', error);
            return [];
        }
    }

    /**
     * Get market by slug with retry and caching
     */
    async getMarketBySlug(slug: string, retries = 3): Promise<GammaMarket | null> {
        const cacheKey = `slug:${slug}`;
        const cached = this.cache.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            logger.debug(`Cache hit for slug: ${slug}`);
            return cached.data;
        }

        for (let i = 0; i < retries; i++) {
            try {
                const url = `${this.gammaApiUrl}/markets/${slug}`;
                const response = await axios.get(url, { timeout: 10000 });

                this.cache.set(cacheKey, { data: response.data, timestamp: Date.now() });
                return response.data;
            } catch (error: any) {
                if (error.response?.status === 404) {
                    logger.warn(`Market ${slug} not found (404)`);
                    return null;
                }

                if (i === retries - 1) {
                    logger.error(`Failed to get ${slug} after ${retries} retries`);
                    return null;
                }

                const backoff = 1000 * Math.pow(2, i);
                logger.warn(`Retry ${i + 1} failed, waiting ${backoff}ms`);
                await new Promise(r => setTimeout(r, backoff));
            }
        }

        return null;
    }

    /**
     * Get markets by condition ID from CLOB API
     */
    async getMarketsByConditionId(conditionId: string): Promise<ClobMarket[]> {
        try {
            const url = `${this.clobApiUrl}/markets`;
            const response = await axios.get(url, {
                params: { condition_id: conditionId },
                timeout: 10000,
            });

            const markets = Array.isArray(response.data) ? response.data : [response.data];
            logger.debug(`Found ${markets.length} markets for condition ${conditionId}`);
            return markets;
        } catch (error) {
            logger.error(`Condition search failed for ${conditionId}:`, error);
            return [];
        }
    }

    /**
     * Clear cache
     */
    clearCache(): void {
        this.cache.clear();
        logger.debug('Cache cleared');
    }
}

// Export singleton instance
export const marketDiscovery = new MarketDiscoveryService();
