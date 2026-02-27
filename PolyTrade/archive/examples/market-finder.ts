#!/usr/bin/env node
/**
 * Multi-Crypto Market Finder
 * Fetches multi-strike markets for BTC, ETH, SOL, and XRP
 * 
 * API Structure:
 * - Endpoint: GET /events/slug/{slug}
 * - Slug format: "{crypto}-above-on-{month}-{day}"
 * - Response contains event with nested markets array
 */

type CryptoTicker = 'BTC' | 'ETH' | 'SOL' | 'XRP';

interface Market {
  id: string;
  question: string;
  slug: string;
  conditionId: string;
  endDate: string;
  startDate: string;
  clobTokenIds: string;
  outcomes: string;
  outcomePrices: string;
  groupItemTitle: string;
  groupItemThreshold: string;
  volume: string;
  liquidity: string;
  active: boolean;
  closed: boolean;
  archived?: boolean;
  restricted: boolean;
  questionID: string;
  enableOrderBook: boolean;
  orderPriceMinTickSize: number;
  orderMinSize: number;
  volumeNum: number;
  liquidityNum: number;
  endDateIso: string;
  startDateIso: string;
  volume24hr?: number | string;
  volume1wk?: number | string;
  volume1mo?: number | string;
  volume1yr?: number | string;
  liquidityClob?: number | string;
  spread?: number | string;
  competitive?: number | string;
  rewardsMinSize?: number;
  rewardsMaxSpread?: number;
  oneDayPriceChange?: number | string;
  oneHourPriceChange?: number | string;
  lastTradePrice?: number | string;
  bestBid?: number | string;
  bestAsk?: number | string;
  umaBond: string;
  umaReward: string;
  negRisk: boolean;
  acceptingOrders: boolean;
}

interface Event {
  id: string;
  ticker: string;
  slug: string;
  title: string;
  endDate: string;
  active: boolean;
  closed: boolean;
  markets: Market[];
}

interface ParsedMarket {
  market: string;
  crypto: CryptoTicker;
  eventSlug: string;
  eventDate: string;
  eventTitle: string;
  eventEndDate: string;
  id: string;
  slug: string;
  conditionId: string;
  questionID: string;
  question: string;
  strike: number;
  groupItemTitle: string;
  groupItemThreshold: string;
  startDate: string;
  endDate: string;
  startDateIso: string;
  endDateIso: string;
  yesTokenId: string;
  noTokenId: string;
  yesPrice: number;
  noPrice: number;
  lastTradePrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  volume: number;
  volumeNum: number;
  volume24hr: number;
  volume1wk: number;
  volume1mo: number;
  volume1yr: number;
  liquidity: number;
  liquidityNum: number;
  liquidityClob: number;
  enableOrderBook: boolean;
  orderPriceMinTickSize: number;
  orderMinSize: number;
  active: boolean;
  closed: boolean;
  archived: boolean;
  restricted: boolean;
  spread: number;
  competitive: number;
  rewardsMinSize: number;
  rewardsMaxSpread: number;
  oneDayPriceChange: number | null;
  oneHourPriceChange: number | null;
  umaBond: string;
  umaReward: string;
  negRisk: boolean;
  acceptingOrders: boolean;
}

class CryptoMultiStrikeFinder {
  private readonly BASE_URL = 'https://gamma-api.polymarket.com';
  private readonly CRYPTO_SLUGS: Record<CryptoTicker, string> = {
    'BTC': 'bitcoin',
    'ETH': 'ethereum',
    'SOL': 'solana',
    'XRP': 'xrp'
  };
  
  private formatDateSlug(date: Date): string {
    const months = [
      'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'
    ];
    return `${months[date.getMonth()]}-${date.getDate()}`;
  }

  private getEventSlug(crypto: CryptoTicker, date: Date): string {
    const cryptoSlug = this.CRYPTO_SLUGS[crypto];
    return `${cryptoSlug}-above-on-${this.formatDateSlug(date)}`;
  }

  async fetchEventByDate(crypto: CryptoTicker, date: Date): Promise<Event | null> {
    const slug = this.getEventSlug(crypto, date);
    const url = `${this.BASE_URL}/events/slug/${slug}`;
    
    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`HTTP ${response.status} for ${slug}`);
      }
      
      const event: Event = await response.json();
      
      if (!event.markets || !Array.isArray(event.markets)) {
        return null;
      }
      
      return event;
      
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        return null;
      }
      console.error(`Failed to fetch ${slug}:`, error);
      return null;
    }
  }

  private safeParseJSON<T>(value: string | T | undefined | null): T | null {
    if (value === undefined || value === null) return null;
    if (typeof value === 'object') return value as T;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as T;
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  private parseMarket(market: Market, event: Event, crypto: CryptoTicker): ParsedMarket {
    const tokenIds = this.safeParseJSON<string[]>(market.clobTokenIds);
    const prices = this.safeParseJSON<string[]>(market.outcomePrices);
    const strike = parseInt(market.groupItemTitle.replace(/,/g, ''));
    
    return {
      market: "polymarket",
      crypto,
      eventSlug: event.slug,
      eventDate: this.formatDateSlug(new Date(event.endDate)),
      eventTitle: event.title,
      eventEndDate: event.endDate,
      id: market.id,
      slug: market.slug,
      conditionId: market.conditionId,
      questionID: market.questionID,
      question: market.question,
      strike,
      groupItemTitle: market.groupItemTitle,
      groupItemThreshold: market.groupItemThreshold,
      startDate: market.startDate,
      endDate: market.endDate,
      startDateIso: market.endDateIso,
      endDateIso: market.endDateIso,
      yesTokenId: tokenIds?.[0] || '',
      noTokenId: tokenIds?.[1] || '',
      yesPrice: prices?.[0] ? parseFloat(prices[0]) : 0,
      noPrice: prices?.[1] ? parseFloat(prices[1]) : 0,
      lastTradePrice: market.lastTradePrice ? parseFloat(String(market.lastTradePrice)) : null,
      bestBid: market.bestBid ? parseFloat(String(market.bestBid)) : null,
      bestAsk: market.bestAsk ? parseFloat(String(market.bestAsk)) : null,
      volume: parseFloat(market.volume),
      volumeNum: market.volumeNum,
      volume24hr: market.volume24hr ? parseFloat(String(market.volume24hr)) : 0,
      volume1wk: market.volume1wk ? parseFloat(String(market.volume1wk)) : 0,
      volume1mo: market.volume1mo ? parseFloat(String(market.volume1mo)) : 0,
      volume1yr: market.volume1yr ? parseFloat(String(market.volume1yr)) : 0,
      liquidity: parseFloat(market.liquidity),
      liquidityNum: market.liquidityNum,
      liquidityClob: market.liquidityClob ? parseFloat(String(market.liquidityClob)) : 0,
      enableOrderBook: market.enableOrderBook,
      orderPriceMinTickSize: market.orderPriceMinTickSize,
      orderMinSize: market.orderMinSize,
      active: market.active,
      closed: market.closed,
      archived: market.archived || false,
      restricted: market.restricted,
      spread: market.spread ? parseFloat(String(market.spread)) : 0,
      competitive: market.competitive ? parseFloat(String(market.competitive)) : 0,
      rewardsMinSize: market.rewardsMinSize || 0,
      rewardsMaxSpread: market.rewardsMaxSpread || 0,
      oneDayPriceChange: market.oneDayPriceChange ? parseFloat(String(market.oneDayPriceChange)) : null,
      oneHourPriceChange: market.oneHourPriceChange ? parseFloat(String(market.oneHourPriceChange)) : null,
      umaBond: market.umaBond,
      umaReward: market.umaReward,
      negRisk: market.negRisk,
      acceptingOrders: market.acceptingOrders,
    };
  }

  async fetchAllMarkets(
    cryptos: CryptoTicker[] = ['BTC', 'ETH', 'SOL', 'XRP'],
    daysAhead: number = 100
  ): Promise<ParsedMarket[]> {
    console.error(`🔍 Fetching Multi-Strike Markets for: ${cryptos.join(', ')}`);
    console.error(`   Scanning next ${daysAhead} days`);
    console.error(`   (Will stop after 5 consecutive days with no markets per crypto)\n`);
    
    const allMarkets: ParsedMarket[] = [];
    
    for (const crypto of cryptos) {
      console.error(`\n💰 ${crypto} Markets:`);
      console.error('─'.repeat(50));
      
      const today = new Date();
      let consecutiveNoMarkets = 0;
      const MAX_CONSECUTIVE_NO_MARKETS = 5;
      
      for (let i = 0; i < daysAhead; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        
        const dateStr = this.formatDateSlug(date);
        process.stderr.write(`📅 ${dateStr.padEnd(15, ' ')} ... `);
        
        const event = await this.fetchEventByDate(crypto, date);
        
        if (!event) {
          console.error('❌ No market');
          consecutiveNoMarkets++;
          if (consecutiveNoMarkets >= MAX_CONSECUTIVE_NO_MARKETS) {
            console.error(`   🛑 Stopped: ${MAX_CONSECUTIVE_NO_MARKETS} consecutive days with no markets`);
            break;
          }
          continue;
        }
        
        if (!event.markets || event.markets.length === 0) {
          console.error('⚠️  Event found but no markets');
          consecutiveNoMarkets++;
          if (consecutiveNoMarkets >= MAX_CONSECUTIVE_NO_MARKETS) {
            console.error(`   🛑 Stopped: ${MAX_CONSECUTIVE_NO_MARKETS} consecutive days with no markets`);
            break;
          }
          continue;
        }
        
        consecutiveNoMarkets = 0;
        console.error(`✅ ${event.markets.length} strikes`);
        
        for (const market of event.markets) {
          const parsed = this.parseMarket(market, event, crypto);
          allMarkets.push(parsed);
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const cryptoCount = allMarkets.filter(m => m.crypto === crypto).length;
      console.error(`   ✅ Total ${crypto} markets: ${cryptoCount}`);
    }
    
    console.error(`\n${'═'.repeat(50)}`);
    console.error(`✅ TOTAL MARKETS FOUND: ${allMarkets.length}\n`);
    return allMarkets;
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  // Parse command line arguments
  let cryptos: CryptoTicker[] = ['BTC', 'ETH', 'SOL', 'XRP'];
  let daysAhead = 100;
  
  if (args.includes('--help') || args.includes('-h')) {
    console.error(`
Usage: node script.ts [OPTIONS]

Options:
  --crypto <BTC,ETH,SOL,XRP>   Comma-separated list of cryptos (default: all)
  --days <number>              Number of days to scan ahead (default: 100)
  -h, --help                   Show this help message

Examples:
  node script.ts --crypto BTC,ETH --days 30
  node script.ts --crypto SOL
  node script.ts --days 60
`);
    process.exit(0);
  }
  
  const cryptoIndex = args.indexOf('--crypto');
  if (cryptoIndex !== -1 && args[cryptoIndex + 1]) {
    const cryptoArg = args[cryptoIndex + 1].toUpperCase();
    cryptos = cryptoArg.split(',').filter(c => 
      ['BTC', 'ETH', 'SOL', 'XRP'].includes(c)
    ) as CryptoTicker[];
    
    if (cryptos.length === 0) {
      console.error('❌ Invalid crypto symbols. Use: BTC, ETH, SOL, XRP');
      process.exit(1);
    }
  }
  
  const daysIndex = args.indexOf('--days');
  if (daysIndex !== -1 && args[daysIndex + 1]) {
    daysAhead = parseInt(args[daysIndex + 1]);
    if (isNaN(daysAhead) || daysAhead < 1) {
      console.error('❌ Invalid days value');
      process.exit(1);
    }
  }
  
  const finder = new CryptoMultiStrikeFinder();
  
  try {
    const markets = await finder.fetchAllMarkets(cryptos, daysAhead);
    
    // Output ONLY JSON to stdout
    console.log(JSON.stringify(markets, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main().catch(console.error);

export { CryptoMultiStrikeFinder, type ParsedMarket, type Market, type Event, type CryptoTicker };