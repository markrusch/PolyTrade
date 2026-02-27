import { MarketPricingService } from '../src/services/polymarket/MarketPricingService.js';

async function main() {
    const service = new MarketPricingService();
    console.log('Fetching top markets...');
    try {
        const markets = await service.getTopMarkets(5);

        // Gamma API might return array or object with data property
        let cleanMarkets = markets;
        // @ts-ignore
        if (markets.data) cleanMarkets = markets.data; // Handle { data: [...] } structure if applies

        console.log(`Got ${Array.isArray(cleanMarkets) ? cleanMarkets.length : 'unknown'} markets.`);

        if (Array.isArray(cleanMarkets) && cleanMarkets.length > 0) {
            console.log('First market:', JSON.stringify(cleanMarkets[0], null, 2));
        } else {
            console.log('Raw response:', markets);
        }
    } catch (e) {
        console.error('Test failed:', e);
    }
}
main();
