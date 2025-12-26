import 'dotenv/config';
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import path from 'path';

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const CURRENT_SEASON = 21;
const OUTPUT_FILE = path.resolve('./src/data/rocket-pass.json');

async function getWikiUrl() {
    if (!SERPAPI_KEY) {
        throw new Error('SERPAPI_KEY is not defined in .env');
    }

    if (SERPAPI_KEY === 'YOUR_SERPAPI_KEY_HERE') {
        throw new Error('SERPAPI_KEY is still set to the placeholder value. Please verify your .env file.');
    }

    console.log(`Searching for Rocket League Season ${CURRENT_SEASON} Rocket Pass Wiki...`);
    const query = `rocket league season ${CURRENT_SEASON} rocket pass wiki fandom`;

    const response = await axios.get('https://serpapi.com/search', {
        params: {
            engine: 'google',
            api_key: SERPAPI_KEY,
            q: query,
            num: 5
        }
    });

    const results = response.data.organic_results;
    const wikiResult = results.find(r => r.link.includes('rocketleague.fandom.com'));

    if (!wikiResult) {
        throw new Error('Could not find a Fandom Wiki link in search results.');
    }

    console.log(`Found Wiki URL: ${wikiResult.link}`);
    return wikiResult.link;
}

async function scrapeRewards(url) {
    console.log(`Fetching page content...`);
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const rewards = [];

    // Logic to find the rewards table based on specific horizontal structure.
    // Structure: div.table-wide-inner -> table.wikitable
    // Row 0: Tiers (TH)
    // Row 1: Premium Rewards (TD)
    // Row 2: Free Rewards (TD)

    const tables = $('table.wikitable');

    tables.each((_, table) => {
        const rows = $(table).find('tr');
        if (rows.length < 2) return;

        // Validate it's the right table by checking if first row has "TIER"
        const firstRowHeader = $(rows[0]).find('th').first().text().toUpperCase();
        if (!firstRowHeader.includes('TIER')) {
            return;
        }

        const tierCells = $(rows[0]).find('th');
        const premiumCells = $(rows[1]).find('td');
        const freeCells = $(rows[2]).find('td');

        // Iterate through tiers
        tierCells.each((index, tierCell) => {
            const tierText = $(tierCell).text().replace(/TIER/i, '').trim();
            const tier = parseInt(tierText);

            if (isNaN(tier)) return;

            // Helper to extract item info from a cell
            const extractItem = (cellCells, idx, isFree) => {
                if (!cellCells || !cellCells[idx]) return null;

                const $cell = $(cellCells[idx]);
                // Ignore completely empty cells
                if ($cell.text().trim() === '' && $cell.find('img').length === 0) return null;

                let name = $cell.text().trim();

                // Fix for bug where Cheerio/Wiki returns HTML string as text or similar issue
                if (name.startsWith('<')) {
                    name = '';
                }

                let imageUrl = '';
                const type = 'Unknown';
                const rarity = 'Limited';

                // Try to get image info and name from image
                const img = $cell.find('img').first();
                if (img.length > 0) {
                    imageUrl = img.attr('src') || img.attr('data-src') || '';

                    // Use data-image-key or alt if text is empty/weird
                    if (!name) {
                        const rawName = img.attr('data-image-key') || img.attr('alt') || '';

                        // Clean up name: remove extension, 'IconRL', 'RL', camelCase to Space
                        name = rawName.replace(/\.(png|jpg|jpeg|gif)$/i, '')
                            .replace(/IconRL$/i, '')
                            .replace(/RL$/i, '')
                            .replace(/_icon$/i, '')
                            .replace(/ icon$/i, '')
                            .replace(/([a-z])([A-Z])/g, '$1 $2').trim();
                    }
                }

                // Cleanup "File:..." if it appears as text
                if (name && name.startsWith('File:')) {
                    name = name.replace('File:', '').replace(/\.(png|jpg|jpeg|gif)$/i, '');
                }

                if (!name) return null;

                return {
                    tier,
                    name,
                    type,
                    rarity,
                    isFree,
                    imageUrl
                };
            };

            // Premium Item
            const premiumItem = extractItem(premiumCells, index, false);
            if (premiumItem) rewards.push(premiumItem);

            // Free Item
            const freeItem = extractItem(freeCells, index, true);
            if (freeItem) rewards.push(freeItem);
        });
    });

    return rewards;
}

async function main() {
    try {
        const wikiUrl = await getWikiUrl();
        let rewards = await scrapeRewards(wikiUrl);

        if (rewards.length === 0) {
            console.warn("Scraping didn't yield items. The Wiki structure might have changed.");
            console.log("Keeping existing data.");
            return;
        }

        // Sort by tier
        rewards.sort((a, b) => a.tier - b.tier);

        await fs.writeFile(OUTPUT_FILE, JSON.stringify(rewards, null, 2));
        console.log(`Successfully updated ${OUTPUT_FILE} with ${rewards.length} items.`);

    } catch (error) {
        console.error('Error updating rewards:', error.message);
        process.exit(1);
    }
}

main();
