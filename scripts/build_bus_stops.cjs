const fs = require('fs');
const path = require('path');

const insertsDir = path.resolve(__dirname, '../../Telegram Bots/lta-bot');
const outputFile = path.resolve(__dirname, '../src/services/busStopsData.ts');

const stops = [];
const seen = new Set();

for (let i = 1; i <= 6; i++) {
  const filePath = path.join(insertsDir, `inserts_${i}.sql`);
  if (!fs.existsSync(filePath)) {
    console.warn(`File not found: ${filePath}`);
    continue;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  // Match tuples: ('01012', 'Victoria St', 'Hotel Grand Pacific', 1.29684825487647, 103.85253591654006, ...)
  const regex = /\('([^']+)',\s*'([^']*(?:''[^']*)*)',\s*'([^']*(?:''[^']*)*)',\s*([0-9.-]+),\s*([0-9.-]+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const code = match[1];
    const road = match[2].replace(/''/g, "'");
    const desc = match[3].replace(/''/g, "'");
    const lat = parseFloat(match[4]);
    const lon = parseFloat(match[5]);

    if (!seen.has(code)) {
      seen.add(code);
      stops.push({
        bus_stop_code: code,
        road_name: road,
        description: desc,
        latitude: lat,
        longitude: lon,
      });
    }
  }
}

console.log(`Parsed ${stops.length} unique bus stops.`);

// Write as compact TypeScript file
const tsContent = `// Pre-seeded Singapore Bus Stops Catalog (Total: ${stops.length} stops)
// Generated for 0ms offline search in MRT tunnels & offline-first PWA operation
import { BusStop } from '../types/transit';

export const SEED_BUS_STOPS: BusStop[] = ${JSON.stringify(stops)};
`;

fs.writeFileSync(outputFile, tsContent, 'utf8');
console.log(`Successfully wrote ${outputFile} (${(fs.statSync(outputFile).size / 1024).toFixed(1)} KB)`);
