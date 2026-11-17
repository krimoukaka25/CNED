import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const apiKey = process.env.MAPTILER_API_KEY?.trim();
const style = process.env.MAPTILER_STYLE?.trim() || 'streets-v2';
const customTileUrl = process.env.MAP_TILE_URL?.trim();
const customAttribution = process.env.MAP_TILE_ATTRIBUTION?.trim();
const customAttributionUrl = process.env.MAP_TILE_ATTRIBUTION_URL?.trim();

if (apiKey && customTileUrl) {
  throw new Error('Configure either MAPTILER_API_KEY or MAP_TILE_URL, not both.');
}

if (apiKey && !/^[a-zA-Z0-9-]+$/.test(style)) {
  throw new Error('MAPTILER_STYLE may contain only letters, numbers, and hyphens.');
}

let config = { provider: null, url: '', attribution: '', attributionUrl: '', logoUrl: '' };

if (apiKey) {
  config = {
    provider: 'MapTiler',
    url: `https://api.maptiler.com/maps/${style}/256/{z}/{x}/{y}.png?key=${encodeURIComponent(apiKey)}`,
    attribution: '© MapTiler',
    attributionUrl: 'https://www.maptiler.com/copyright/',
    dataAttribution: '© OpenStreetMap contributors',
    dataAttributionUrl: 'https://www.openstreetmap.org/copyright',
    logoUrl: 'https://api.maptiler.com/resources/logo.svg',
    maxZoom: 20
  };
} else if (customTileUrl) {
  const parsedUrl = new URL(customTileUrl);
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('MAP_TILE_URL must use HTTPS.');
  }
  if (!['{z}', '{x}', '{y}'].every((placeholder) => customTileUrl.includes(placeholder))) {
    throw new Error('MAP_TILE_URL must include {z}, {x}, and {y} tile placeholders.');
  }
  if (!customAttribution || !customAttributionUrl) {
    throw new Error('Custom tile providers require MAP_TILE_ATTRIBUTION and MAP_TILE_ATTRIBUTION_URL.');
  }
  const parsedAttributionUrl = new URL(customAttributionUrl);
  if (parsedAttributionUrl.protocol !== 'https:') {
    throw new Error('MAP_TILE_ATTRIBUTION_URL must use HTTPS.');
  }
  config = {
    provider: 'Custom tile provider',
    url: customTileUrl,
    attribution: customAttribution,
    attributionUrl: customAttributionUrl,
    maxZoom: 19
  };
} else if (customAttribution || customAttributionUrl) {
  throw new Error('Custom provider attribution can be set only together with MAP_TILE_URL.');
}

await writeFile(resolve('map-config.json'), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o644 });
