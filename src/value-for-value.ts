import qrcode from 'qrcode-generator';

export interface ValueForValueConfig {
  configured: boolean;
  qrValue: string;
  href: string;
  display: string;
  links: ValueForValueLink[];
}

export interface ValueForValueLink {
  id: 'lightning' | 'geyser' | 'kofi';
  label: string;
  href: string;
  display: string;
}

declare global {
  interface Window {
    neonSentinelValueUri?: string;
    neonSentinelGeyserUrl?: string;
    neonSentinelKofiUrl?: string;
  }
}

const META_NAME = 'neon-sentinel:value-uri';
const ENV_KEY = 'VITE_NEON_SENTINEL_VALUE_URI';
const QUERY_KEY = 'valueUri';
const GEYSER_META_NAME = 'neon-sentinel:geyser-url';
const GEYSER_ENV_KEY = 'VITE_NEON_SENTINEL_GEYSER_URL';
const GEYSER_QUERY_KEY = 'geyserUrl';
const KOFI_META_NAME = 'neon-sentinel:kofi-url';
const KOFI_ENV_KEY = 'VITE_NEON_SENTINEL_KOFI_URL';
const KOFI_QUERY_KEY = 'kofiUrl';
const DEFAULT_LIGHTNING_ADDRESS = 'profusemeat89@walletofsatoshi.com';
const DEFAULT_GEYSER_URL = 'https://geyser.fund/project/forgesworn?hero=geyserannually1';
const DEFAULT_KOFI_URL = 'https://ko-fi.com/brays';
const QR_PIXELS = 228;
const QR_MARGIN = 4;

let cachedConfig: ValueForValueConfig | null = null;
let cachedQr: { value: string; canvas: HTMLCanvasElement } | null = null;

export function getValueForValueConfig(): ValueForValueConfig {
  if (cachedConfig) return cachedConfig;
  const query = new URLSearchParams(location.search);
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const target = firstNonEmpty([
    query.get(QUERY_KEY),
    window.neonSentinelValueUri,
    document.querySelector<HTMLMetaElement>(`meta[name="${META_NAME}"]`)?.content,
    env?.[ENV_KEY],
    DEFAULT_LIGHTNING_ADDRESS,
  ]);
  const geyser = firstNonEmpty([
    query.get(GEYSER_QUERY_KEY),
    window.neonSentinelGeyserUrl,
    document.querySelector<HTMLMetaElement>(`meta[name="${GEYSER_META_NAME}"]`)?.content,
    env?.[GEYSER_ENV_KEY],
    DEFAULT_GEYSER_URL,
  ]);
  const kofi = firstNonEmpty([
    query.get(KOFI_QUERY_KEY),
    window.neonSentinelKofiUrl,
    document.querySelector<HTMLMetaElement>(`meta[name="${KOFI_META_NAME}"]`)?.content,
    env?.[KOFI_ENV_KEY],
    DEFAULT_KOFI_URL,
  ]);
  const qrValue = target ? normalisePaymentTarget(target) : '';
  const links = buildSupportLinks(qrValue, geyser, kofi);
  cachedConfig = {
    configured: qrValue.length > 0,
    qrValue,
    href: qrValue,
    display: qrValue ? displayPaymentTarget(qrValue) : '',
    links,
  };
  return cachedConfig;
}

export function getValueForValueQrCanvas(qrValue: string): HTMLCanvasElement | null {
  if (!qrValue) return null;
  if (cachedQr?.value === qrValue) return cachedQr.canvas;

  const qr = qrcode(0, 'M');
  qr.addData(qrValue, 'Byte');
  qr.make();

  const count = qr.getModuleCount();
  const cell = Math.max(3, Math.floor(QR_PIXELS / (count + QR_MARGIN * 2)));
  const size = (count + QR_MARGIN * 2) * cell;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const qrCtx = canvas.getContext('2d');
  if (!qrCtx) return null;

  qrCtx.fillStyle = '#fffdf4';
  qrCtx.fillRect(0, 0, size, size);
  qrCtx.fillStyle = '#02040b';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (!qr.isDark(row, col)) continue;
      qrCtx.fillRect((col + QR_MARGIN) * cell, (row + QR_MARGIN) * cell, cell, cell);
    }
  }

  cachedQr = { value: qrValue, canvas };
  return canvas;
}

function firstNonEmpty(values: Array<string | null | undefined>): string {
  for (const value of values) {
    const clean = value?.trim();
    if (clean) return clean;
  }
  return '';
}

function normalisePaymentTarget(target: string): string {
  const clean = target.trim();
  if (!clean) return '';
  if (/^lightning:/i.test(clean)) return `lightning:${clean.slice('lightning:'.length).trim()}`;
  if (/^(lnurl1|lnbc|lntb|lntbs|lnbcrt)/i.test(clean)) return `lightning:${clean.toUpperCase()}`;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return `lightning:${clean}`;
  return clean;
}

function displayPaymentTarget(qrValue: string): string {
  const clean = qrValue.replace(/^lightning:/i, '');
  if (clean.length <= 42) return clean;
  return `${clean.slice(0, 18)}...${clean.slice(-12)}`;
}

function buildSupportLinks(qrValue: string, geyser: string, kofi: string): ValueForValueLink[] {
  const links: ValueForValueLink[] = [];
  if (qrValue) {
    links.push({
      id: 'lightning',
      label: 'PAY SATS',
      href: qrValue,
      display: displayPaymentTarget(qrValue),
    });
  }
  if (isHttpUrl(geyser)) {
    links.push({
      id: 'geyser',
      label: 'GEYSER',
      href: geyser,
      display: displaySupportUrl(geyser),
    });
  }
  if (isHttpUrl(kofi)) {
    links.push({
      id: 'kofi',
      label: 'KO-FI',
      href: kofi,
      display: displaySupportUrl(kofi),
    });
  }
  return links;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function displaySupportUrl(value: string): string {
  return value.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}
