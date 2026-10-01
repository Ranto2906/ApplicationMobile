import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputRoot = join(root, 'public', 'assets', 'map-tiles');
const tileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// Pack national : Madagascar est embarquee jusqu'au zoom 10 afin de couvrir
// toutes les provinces pour les deplacements. Les niveaux plus detailles
// restent telechargeables localement avec le bouton de l'application.
const ranges = [
  { minZoom: 5, maxZoom: 10, west: 43, south: -26, east: 51, north: -11 },
];

function tileX(longitude, zoom) {
  return Math.floor(((longitude + 180) / 360) * 2 ** zoom);
}

function tileY(latitude, zoom) {
  const latRad = latitude * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * 2 ** zoom);
}

async function downloadTile(z, x, y) {
  const path = join(outputRoot, String(z), String(x), `${y}.png`);
  try {
    await readFile(path);
    return 'present';
  } catch {
    // Le pack peut etre complete progressivement sans tout retelecharger.
  }
  const response = await fetch(tileUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y), {
    headers: { 'user-agent': 'SEIMAD-mobile-map-pack/1.0 (OpenStreetMap attribution included)' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} pour ${z}/${x}/${y}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
  return 'telecharge';
}

const tasks = [];
for (const range of ranges) {
  for (let z = range.minZoom; z <= range.maxZoom; z += 1) {
    const xMin = tileX(range.west, z);
    const xMax = tileX(range.east, z);
    const yMin = tileY(range.north, z);
    const yMax = tileY(range.south, z);
    for (let x = xMin; x <= xMax; x += 1) {
      for (let y = yMin; y <= yMax; y += 1) {
        tasks.push({ z, x, y });
      }
    }
  }
}

let downloaded = 0;
let present = 0;
let failed = 0;
let cursor = 0;
const worker = async () => {
  while (cursor < tasks.length) {
    const task = tasks[cursor];
    cursor += 1;
    try {
      const result = await downloadTile(task.z, task.x, task.y);
      if (result === 'present') present += 1;
      else downloaded += 1;
      console.log(`${result}: ${task.z}/${task.x}/${task.y}`);
    } catch (error) {
      failed += 1;
      console.warn(`echec: ${task.z}/${task.x}/${task.y} - ${error.message}`);
    }
  }
};

// Quatre requetes simultanees : generation plus rapide, sans ouvrir un flot
// trop important vers le serveur de tuiles.
await Promise.all(Array.from({ length: 4 }, worker));

await mkdir(outputRoot, { recursive: true });
await writeFile(join(outputRoot, 'README.txt'),
  'Tuiles OpenStreetMap embarquees pour SEIMAD. Attribution visible dans Leaflet.\n');
console.log(`Pack carte: ${downloaded} telechargees, ${present} deja presentes, ${failed} echecs.`);
if (downloaded === 0 && present === 0 && failed > 0) process.exitCode = 1;