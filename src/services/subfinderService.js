import axios from 'axios';
import dns from 'dns';

// Configuration definitions for the retry mechanism
const BASE_TIMEOUT = 1500000; // 90 seconds base
const MAX_ATTEMPTS = 3;
const FALLBACK_TIMEOUT = 1500000; // 30 seconds for external backups

/**
 * 1. Fetches raw data from crt.sh implementing an incremental retry mechanism
 * @param {string} domain - Target domain
 * @param {number} attempt - Current execution cycle layer
 * @returns {Promise<Array>} - Raw data array from API registry
 */
async function fetchCrtDataWithRetry(domain, attempt = 1) {
    // Calculates the timeout dynamic target (e.g., 90s -> 180s -> 270s)
    const currentTimeout = BASE_TIMEOUT * attempt;
    
    console.log(`   [Attempt ${attempt}/${MAX_ATTEMPTS}] Querying API with a ${currentTimeout / 1000}s timeout boundary...`);

    try {
        const response = await axios.get(`https://crt.sh/?q=${domain}&output=json`, {
            timeout: currentTimeout,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OSINT-Dashboard/1.0'
            }
        });
        return response.data;
    } catch (error) {
        const isTimeout = error.code === 'ECONNABORTED';
        const isNetworkError = !error.response; // Handles infrastructure drops or 502/503 states

        if ((isTimeout || isNetworkError) && attempt < MAX_ATTEMPTS) {
            console.warn(`   [!] Attempt ${attempt} failed due to infrastructure pressure. Escalating network parameters...`);
            // Recursive recall to pass execution workflow to the next block layer
            return await fetchCrtDataWithRetry(domain, attempt + 1);
        }

        // Return an empty array on failure instead of throwing, so the code can slide into fallback sources smoothly
        console.warn(`   [-] crt.sh pipeline exhausted completely. Triggering fallback providers...`);
        return [];
    }
}

/**
 * Fallback Source 1: Querying CertSpotter's public Certificate Transparency logs
 */
async function fetchCertSpotterData(domain) {
    console.log('📡 [Backup 1/2] Querying CertSpotter Certificate Transparency logs...');
    try {
        const response = await axios.get(`https://api.certspotter.com/v1/issuances?domain=${domain}&include_subdomains=true&expand=dns_names`, {
            timeout: FALLBACK_TIMEOUT
        });

        if (!response.data || !Array.isArray(response.data)) return [];

        const extracted = [];
        response.data.forEach(issuance => {
            if (issuance.dns_names && Array.isArray(issuance.dns_names)) {
                issuance.dns_names.forEach(name => {
                    extracted.push({ name_value: name });
                });
            }
        });
        return extracted;
    } catch (e) {
        console.warn(`   [-] CertSpotter feed unavailable: ${e.message}`);
        return [];
    }
}

/**
 * Fallback Source 2: Querying HackerTarget's passive hostsearch engine
 */
async function fetchHackerTargetData(domain) {
    console.log('📡 [Backup 2/2] Querying HackerTarget passive hostsearch API...');
    try {
        const response = await axios.get(`https://api.hackertarget.com/hostsearch/?q=${domain}`, {
            timeout: FALLBACK_TIMEOUT
        });

        if (!response.data || typeof response.data !== 'string' || response.data.includes('error')) {
            return [];
        }

        const lines = response.data.split('\n');
        return lines.map(line => {
            const parts = line.split(',');
            return { name_value: parts[0] };
        });
    } catch (e) {
        console.warn(`   [-] HackerTarget feed unavailable: ${e.message}`);
        return [];
    }
}

function cleanSubdomains(rawData, targetDomain) {
    const uniqueSubs = new Set();

    rawData.forEach(item => {
        if (!item.name_value) return;

        const names = item.name_value.split('\n');

        names.forEach(name => {
            let cleanName = name.trim().toLowerCase();

            if (cleanName.startsWith('*.')) {
                cleanName = cleanName.substring(2);
            } else if (cleanName.startsWith('*')) {
                cleanName = cleanName.substring(1);
            }

            if (cleanName.endsWith(targetDomain) && cleanName !== targetDomain) {
                uniqueSubs.add(cleanName);
            }
        });
    });

    return Array.from(uniqueSubs);
}

// KEPT EXACTLY INTENTIONAL AS REQUESTED
async function checkLiveHost(subdomain) {
    try {
        await dns.promises.resolve4(subdomain);
        return { subdomain, status: 'ONLINE' };
    } catch (err) {
        return { subdomain, status: 'OFFLINE' };
    }
}

export async function scanDomain(domain) {
    const target = domain.trim().toLowerCase();
    console.log(`\n🔍 Starting OSINT reconnaissance loop for: ${target}`);

    console.log('📡 Querying Certificate Transparency logs via crt.sh engine...');
    // Calls your original orchestrated retry flow
    let rawData = await fetchCrtDataWithRetry(target);
    
    // If crt.sh is completely dead, empty, or timed out, pull records from other providers
    if (!rawData || rawData.length === 0) {
        const certSpotterData = await fetchCertSpotterData(target);
        const hackerTargetData = await fetchHackerTargetData(target);
        rawData = [...certSpotterData, ...hackerTargetData];
    }
    
    if (rawData.length === 0) {
        console.log('⚠️ No tracking records recovered across any integrated platforms.');
        return [];
    }

    console.log('🧹 Sanitizing payload (Removing wildcards, line breaks, and duplicates)...');
    const cleanedSubs = cleanSubdomains(rawData, target);

    console.log('⚡ Verifying active hosts via concurrent DNS lookups...');
    const validationPromises = cleanedSubs.map(sub => checkLiveHost(sub));
    const results = await Promise.all(validationPromises);

    return results;
}