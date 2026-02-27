import axios from 'axios';

const BASE_URL = 'http://localhost:3003/api';

const PAYLOADS = [
    "'", 
    "' OR 1=1 --", 
    "' UNION SELECT 1,2,3,4,5,6,7,8 --",
    "admin' --",
    "' AND 1=2 --"
];

const ENDPOINTS = [
    { url: '/markets/replace_me', method: 'GET', param: 'replace_me' },
    { url: '/orderbook?market=replace_me', method: 'GET', param: 'replace_me' },
    { url: '/orderbook/slug/replace_me?outcome=yes', method: 'GET', param: 'replace_me' }
    // Add more if needed
];

async function runTests() {
    console.log('Starting SQL Injection Tests...');
    
    for (const endpoint of ENDPOINTS) {
        for (const payload of PAYLOADS) {
            const testUrl = endpoint.url.replace('replace_me', encodeURIComponent(payload));
            const fullUrl = `${BASE_URL}${testUrl}`;
            
            console.log(`Testing: ${fullUrl}`);
            
            try {
                const res = await axios.get(fullUrl, { validateStatus: () => true });
                console.log(`Status: ${res.status}`);
                if (res.status === 500) {
                     console.log('Potential Vulnerability (500 Error)');
                     console.log('Response:', res.data);
                } else if (JSON.stringify(res.data).includes('SQLITE_ERROR')) {
                     console.log('CRITICAL: Database Error Exposed!');
                } else {
                    console.log('Clean response.');
                }
            } catch (err) {
                console.error('Request failed:', err.message);
            }
            console.log('---');
        }
    }
}

runTests();
