import qrcode from 'qrcode-generator';

export interface ValueForValueConfig {
  configured: boolean;
  qrValue: string;
  href: string;
  display: string;
  onchainAddress: string;
  silentPayment: string;
  links: ValueForValueLink[];
}

export interface ValueForValueLink {
  id: 'lightning' | 'onchain' | 'silent' | 'geyser' | 'kofi';
  label: string;
  href: string;
  display: string;
}

declare global {
  interface Window {
    neonSentinelValueUri?: string;
    neonSentinelOnchainAddress?: string;
    neonSentinelSilentPayment?: string;
    neonSentinelGeyserUrl?: string;
    neonSentinelKofiUrl?: string;
  }
}

const META_NAME = 'neon-sentinel:value-uri';
const ENV_KEY = 'VITE_NEON_SENTINEL_VALUE_URI';
const QUERY_KEY = 'valueUri';
const ONCHAIN_META_NAME = 'neon-sentinel:onchain-address';
const ONCHAIN_ENV_KEY = 'VITE_NEON_SENTINEL_ONCHAIN_ADDRESS';
const ONCHAIN_QUERY_KEY = 'onchainAddress';
const SILENT_META_NAME = 'neon-sentinel:silent-payment';
const SILENT_ENV_KEY = 'VITE_NEON_SENTINEL_SILENT_PAYMENT';
const SILENT_QUERY_KEY = 'silentPayment';
const GEYSER_META_NAME = 'neon-sentinel:geyser-url';
const GEYSER_ENV_KEY = 'VITE_NEON_SENTINEL_GEYSER_URL';
const GEYSER_QUERY_KEY = 'geyserUrl';
const KOFI_META_NAME = 'neon-sentinel:kofi-url';
const KOFI_ENV_KEY = 'VITE_NEON_SENTINEL_KOFI_URL';
const KOFI_QUERY_KEY = 'kofiUrl';
const DEFAULT_LIGHTNING_ADDRESS = 'profusemeat89@walletofsatoshi.com';
const DEFAULT_ONCHAIN_ADDRESS = 'bc1qc75tj6gs06r0hjwy8z6tdkg92tm39wnzwj4lah';
const DEFAULT_SILENT_PAYMENT = 'sp1qq0s22v57t06499r29yfnwsf408uqzneufpzvy4ennd8dedfwdm08qqes6lwp8uzapmf2x2dhpsfcrhh6j70grs5dfyx7235ae6yl0jr3tcqfym4g';
const DEFAULT_GEYSER_URL = 'https://geyser.fund/project/forgesworn?hero=geyserannually1';
const DEFAULT_KOFI_URL = 'https://ko-fi.com/brays';
const QR_PIXELS = 228;
const QR_MARGIN = 4;

let cachedConfig: ValueForValueConfig | null = null;
const cachedQrs = new Map<string, HTMLCanvasElement>();

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
  const onchain = normaliseOnchainAddress(firstNonEmpty([
    query.get(ONCHAIN_QUERY_KEY),
    window.neonSentinelOnchainAddress,
    document.querySelector<HTMLMetaElement>(`meta[name="${ONCHAIN_META_NAME}"]`)?.content,
    env?.[ONCHAIN_ENV_KEY],
    DEFAULT_ONCHAIN_ADDRESS,
  ]));
  const silent = normaliseSilentPayment(firstNonEmpty([
    query.get(SILENT_QUERY_KEY),
    window.neonSentinelSilentPayment,
    document.querySelector<HTMLMetaElement>(`meta[name="${SILENT_META_NAME}"]`)?.content,
    env?.[SILENT_ENV_KEY],
    DEFAULT_SILENT_PAYMENT,
  ]));
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
  const links = buildSupportLinks(qrValue, onchain, silent, geyser, kofi);
  cachedConfig = {
    configured: qrValue.length > 0,
    qrValue,
    href: qrValue,
    display: qrValue ? displayPaymentTarget(qrValue) : '',
    onchainAddress: onchain,
    silentPayment: silent,
    links,
  };
  return cachedConfig;
}

export function getValueForValueQrCanvas(qrValue: string): HTMLCanvasElement | null {
  if (!qrValue) return null;
  const cached = cachedQrs.get(qrValue);
  if (cached) return cached;

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

  cachedQrs.set(qrValue, canvas);
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

// Loose shape checks only — these gate what we RENDER, not what we pay. A
// wrong-but-plausible address still renders; the checksum lives with the
// sender's wallet.
function normaliseOnchainAddress(value: string): string {
  const clean = value.trim().replace(/^bitcoin:/i, '');
  return /^(bc1[a-z0-9]{11,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(clean) ? clean : '';
}

function normaliseSilentPayment(value: string): string {
  const clean = value.trim();
  return /^sp1[a-z0-9]{50,}$/.test(clean) ? clean : '';
}

function buildSupportLinks(qrValue: string, onchain: string, silent: string, geyser: string, kofi: string): ValueForValueLink[] {
  const links: ValueForValueLink[] = [];
  if (qrValue) {
    links.push({
      id: 'lightning',
      label: 'PAY SATS',
      href: qrValue,
      display: displayPaymentTarget(qrValue),
    });
  }
  if (onchain) {
    links.push({
      id: 'onchain',
      label: 'BTC',
      href: `bitcoin:${onchain}`,
      display: displayPaymentTarget(onchain),
    });
  }
  if (silent) {
    // No URI scheme — silent payment codes are copied or scanned raw.
    links.push({
      id: 'silent',
      label: 'SILENT',
      href: silent,
      display: displayPaymentTarget(silent),
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
