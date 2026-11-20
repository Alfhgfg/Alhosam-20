import { FIELD_LIMITS, type Product } from '../types';
import { formatMoney } from './format';

/**
 * Converts Arabic-Indic (٠-٩) & Eastern Arabic-Indic (۰-۹) digits to ASCII,
 * strips control characters, trims whitespace, and uppercases ASCII letters.
 */
export function normalizeBarcode(raw: string | undefined | null): string {
  if (!raw) return '';
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    // Arabic-Indic ٠..٩ (0x0660..0x0669)
    if (code >= 0x0660 && code <= 0x0669) {
      out += String.fromCharCode(48 + (code - 0x0660));
      continue;
    }
    // Extended Arabic-Indic ۰..۹ (0x06f0..0x06f9)
    if (code >= 0x06f0 && code <= 0x06f9) {
      out += String.fromCharCode(48 + (code - 0x06f0));
      continue;
    }
    // Skip zero-width/directional marks and control chars
    if (
      code < 0x20 ||
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x202a && code <= 0x202e)
    ) {
      continue;
    }
    out += raw[i];
  }
  return out.trim().toUpperCase().slice(0, FIELD_LIMITS.barcodeMax);
}

/**
 * Computes GS1 EAN-13 check digit from the first 12 digits.
 */
export function computeEan13CheckDigit(first12: string): string {
  if (!/^\d{12}$/.test(first12)) {
    throw new Error('EAN-13 base must contain exactly 12 digits.');
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = first12.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? d : d * 3;
  }
  return String((10 - (sum % 10)) % 10);
}

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return computeEan13CheckDigit(code.slice(0, 12)) === code[12];
}

/**
 * Checks whether a barcode is valid for storage (printable ASCII or safe alphanumeric/dash/dot/plus/slash).
 */
export function isValidBarcodeFormat(raw: string): boolean {
  const clean = normalizeBarcode(raw);
  if (!clean) return true;
  if (clean.length > FIELD_LIMITS.barcodeMax) return false;
  return /^[\x21-\x7E]+$/.test(clean);
}

/**
 * Finds if `candidate` conflicts with any existing product's `barcode` OR `code`
 * (excluding `excludeProductId` when editing an existing product).
 */
export function findBarcodeConflict(
  candidate: string | undefined | null,
  products: Pick<Product, 'id' | 'code' | 'barcode' | 'name'>[],
  excludeProductId?: string
): Product | null {
  const clean = normalizeBarcode(candidate);
  if (!clean) return null;
  for (const p of products) {
    if (excludeProductId && p.id === excludeProductId) continue;
    if (normalizeBarcode(p.barcode) === clean) {
      return p as Product;
    }
    if (normalizeBarcode(p.code) === clean) {
      return p as Product;
    }
  }
  return null;
}

/**
 * Generates a unique, valid GS1 EAN-13 internal-store barcode (prefix 200)
 * guaranteed not to collide with any existing product barcode or code.
 */
export function generateUniqueProductBarcode(
  existingProducts: Pick<Product, 'id' | 'code' | 'barcode' | 'name'>[],
  seqHint?: number,
  excludeProductId?: string
): string {
  const used = new Set<string>();
  for (const p of existingProducts) {
    if (excludeProductId && p.id === excludeProductId) continue;
    const b = normalizeBarcode(p.barcode);
    const c = normalizeBarcode(p.code);
    if (b) used.add(b);
    if (c) used.add(c);
  }

  // Try deterministic sequence-based 13-digit EAN-13 first (`200` + 9-digit seq)
  if (typeof seqHint === 'number' && Number.isFinite(seqHint) && seqHint > 0) {
    for (let offset = 0; offset < 50; offset++) {
      const seqNum = Math.floor(seqHint) + offset;
      const body12 = `200${String(seqNum).padStart(9, '0').slice(-9)}`;
      const full = `${body12}${computeEan13CheckDigit(body12)}`;
      if (!used.has(full)) return full;
    }
  }

  // Fallback using random 9-digit suffix under internal prefix 200..299
  for (let attempt = 0; attempt < 200; attempt++) {
    const rand9 = String(Math.floor(100000000 + Math.random() * 899999999));
    const body12 = `200${rand9}`;
    const full = `${body12}${computeEan13CheckDigit(body12)}`;
    if (!used.has(full)) return full;
  }

  // Final deterministic timestamp fallback
  const tail9 = String(Date.now()).slice(-9).padStart(9, '0');
  const body12 = `201${tail9}`;
  return `${body12}${computeEan13CheckDigit(body12)}`;
}

// ---------------- 1D BARCODE ENCODERS (EAN-13 & CODE 128B) ----------------

const EAN13_PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

const EAN13_L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];

const EAN13_G = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
];

const EAN13_R = [
  '1110010',
  '1100110',
  '1101100',
  '1000010',
  '1011100',
  '1001110',
  '1010000',
  '1000100',
  '1001000',
  '1110100',
];

// Code 128 bar/space width patterns for symbol values 0..106
export const CODE128_PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

function patternToBits(pattern: string): string {
  let bits = '';
  for (let i = 0; i < pattern.length; i++) {
    const count = pattern.charCodeAt(i) - 48;
    const bit = i % 2 === 0 ? '1' : '0';
    bits += bit.repeat(count);
  }
  return bits;
}

export interface EncodedBarcode {
  format: 'EAN-13' | 'CODE-128';
  value: string;
  bits: string;
}

export function encodeEan13Bits(code: string): string {
  const firstDigit = Number(code[0]);
  const parity = EAN13_PARITY[firstDigit];
  let bits = '101';
  for (let i = 1; i <= 6; i++) {
    const d = Number(code[i]);
    bits += parity[i - 1] === 'L' ? EAN13_L[d] : EAN13_G[d];
  }
  bits += '01010';
  for (let i = 7; i <= 12; i++) {
    const d = Number(code[i]);
    bits += EAN13_R[d];
  }
  bits += '101';
  return bits;
}

export function encodeCode128Bits(value: string): string {
  // Use Code Set B for ASCII 32..126; replace any unsupported chars with '?'
  const symbols: number[] = [104]; // Start Code B
  let checksum = 104;
  for (let i = 0; i < value.length; i++) {
    let charCode = value.charCodeAt(i);
    if (charCode < 32 || charCode > 126) {
      charCode = 63; // '?'
    }
    const val = charCode - 32;
    symbols.push(val);
    checksum += val * (i + 1);
  }
  symbols.push(checksum % 103);
  symbols.push(106); // Stop

  return symbols.map((s) => patternToBits(CODE128_PATTERNS[s])).join('');
}

export function encodeBarcode(rawValue: string): EncodedBarcode {
  const clean = normalizeBarcode(rawValue) || '0000';
  if (isValidEan13(clean)) {
    return {
      format: 'EAN-13',
      value: clean,
      bits: encodeEan13Bits(clean),
    };
  }
  return {
    format: 'CODE-128',
    value: clean,
    bits: encodeCode128Bits(clean),
  };
}

/**
 * Converts a bitstring ('1'/'0') into contiguous SVG bar runs for crisp, zero-aliasing vector rendering.
 */
export function bitsToBarRuns(bits: string): Array<{ x: number; width: number }> {
  const runs: Array<{ x: number; width: number }> = [];
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === '1') {
      const start = i;
      while (i < bits.length && bits[i] === '1') {
        i++;
      }
      runs.push({ x: start, width: i - start });
    } else {
      i++;
    }
  }
  return runs;
}

/**
 * Builds standalone SVG markup for the barcode bars + human-readable value.
 */
export function buildBarcodeSvgMarkup(
  value: string,
  options?: { width?: number; height?: number; showText?: boolean }
): string {
  const encoded = encodeBarcode(value);
  const runs = bitsToBarRuns(encoded.bits);
  const quiet = 10;
  const totalModules = encoded.bits.length + quiet * 2;
  const height = options?.height ?? 64;
  const showText = options?.showText ?? true;
  const svgHeight = showText ? height + 18 : height;
  const rects = runs
    .map(
      (r) =>
        `<rect x="${r.x + quiet}" y="4" width="${r.width}" height="${height - 6}" fill="#0f172a"/>`
    )
    .join('');
  const textEl = showText
    ? `<text x="${totalModules / 2}" y="${svgHeight - 3}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="11" font-weight="700" fill="#0f172a">${escapeXml(
        encoded.value
      )}</text>`
    : '';

  const widthAttr = options?.width ? `width="${options.width}"` : 'width="100%"';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalModules} ${svgHeight}" ${widthAttr} preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges"><rect x="0" y="0" width="${totalModules}" height="${svgHeight}" fill="#ffffff"/>${rects}${textEl}</svg>`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface BarcodeLabelRenderOptions {
  barcodeValue: string;
  productName: string;
  productCode: string;
  sellPrice: number;
  currency: string;
  storeName: string;
}

/**
 * Renders a high-DPI PNG label (store name, product name, price, crisp barcode bars & code)
 * ready for saving/sharing or thermal sticker printing.
 */
export function renderBarcodeLabelPngDataUrl(opts: BarcodeLabelRenderOptions): string {
  const encoded = encodeBarcode(opts.barcodeValue);
  const runs = bitsToBarRuns(encoded.bits);
  const quietModules = 10;
  const totalModules = encoded.bits.length + quietModules * 2;

  const canvas = document.createElement('canvas');
  const width = 640;
  const height = 380;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('تعذر تهيئة أداة رسم صورة الباركود.');
  }

  // White crisp label background + border
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 10, width - 20, height - 20);

  // Store name & Price header
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 22px "IBM Plex Sans Arabic", "Cairo", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(opts.storeName || 'بقالة الحسام', width - 32, 48, width * 0.55);

  ctx.fillStyle = '#047857';
  ctx.font = 'bold 24px "IBM Plex Mono", "IBM Plex Sans Arabic", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(formatMoney(opts.sellPrice, opts.currency), 32, 48, width * 0.4);

  // Hairline divider
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(28, 66);
  ctx.lineTo(width - 28, 66);
  ctx.stroke();

  // Product Name
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 26px "IBM Plex Sans Arabic", "Cairo", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(opts.productName, width / 2, 108, width - 64);

  // Barcode Bars
  const barAreaWidth = width - 80;
  const moduleWidth = Math.max(2, Math.floor(barAreaWidth / totalModules));
  const drawnWidth = totalModules * moduleWidth;
  const startX = Math.floor((width - drawnWidth) / 2);
  const barTop = 134;
  const barHeight = 162;

  ctx.fillStyle = '#0f172a';
  for (const run of runs) {
    ctx.fillRect(
      startX + (run.x + quietModules) * moduleWidth,
      barTop,
      run.width * moduleWidth,
      barHeight
    );
  }

  // Human-readable barcode digits
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 26px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(encoded.value, width / 2, barTop + barHeight + 36, width - 60);

  // Footer product code & format
  ctx.fillStyle = '#64748b';
  ctx.font = '600 16px "IBM Plex Mono", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    `${opts.productCode} · ${encoded.format}`,
    width / 2,
    height - 22,
    width - 60
  );

  return canvas.toDataURL('image/png');
}

export function saveImageDataUrlCrossPlatform(
  dataUrl: string,
  fileNameWithExt: string
): boolean {
  const w = window as unknown as {
    AndroidFileBridge?: {
      saveFile: (base64Data: string, fileName: string, mimeType: string) => boolean;
    };
  };
  if (w.AndroidFileBridge) {
    const commaIdx = dataUrl.indexOf(',');
    const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    return w.AndroidFileBridge.saveFile(base64, fileNameWithExt, 'image/png');
  }

  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileNameWithExt;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return true;
}

export type BarcodeLabelPaperSize = '50x30mm' | '58mm' | '80mm' | 'a4';

export function buildBarcodePrintHtml(
  opts: BarcodeLabelRenderOptions & {
    copies: number;
    paperSize: BarcodeLabelPaperSize;
  }
): string {
  const copies = Math.min(Math.max(1, Math.round(opts.copies)), 120);
  const svgMarkup = buildBarcodeSvgMarkup(opts.barcodeValue, {
    height: opts.paperSize === '50x30mm' ? 46 : opts.paperSize === '58mm' ? 52 : 60,
    showText: true,
  });
  const priceText = escapeXml(formatMoney(opts.sellPrice, opts.currency));
  const storeText = escapeXml(opts.storeName || 'بقالة الحسام');
  const nameText = escapeXml(opts.productName);
  const codeText = escapeXml(opts.productCode);

  const pageCss =
    opts.paperSize === '50x30mm'
      ? '@page { size: 50mm 30mm; margin: 1.5mm; }'
      : opts.paperSize === '58mm'
      ? '@page { size: 58mm auto; margin: 2mm; }'
      : opts.paperSize === '80mm'
      ? '@page { size: 80mm auto; margin: 3mm; }'
      : '@page { size: A4 portrait; margin: 8mm; }';

  const cardWidth =
    opts.paperSize === '50x30mm'
      ? '47mm'
      : opts.paperSize === '58mm'
      ? '52mm'
      : opts.paperSize === '80mm'
      ? '72mm'
      : '60mm';

  const gridStyle =
    opts.paperSize === 'a4'
      ? 'display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:4mm;'
      : 'display:flex; flex-direction:column; align-items:center; gap:3mm;';

  const labelCard = `
    <div class="label-card" style="width:${opts.paperSize === 'a4' ? '100%' : cardWidth}; border:1px solid #cbd5e1; border-radius:4px; padding:${
      opts.paperSize === '50x30mm' ? '1.5mm 2mm' : '3mm'
    }; box-sizing:border-box; background:#ffffff; page-break-inside:avoid; break-inside:avoid; text-align:center;">
      <div style="display:flex; justify-content:space-between; align-items:baseline; gap:4px; border-bottom:1px dashed #e2e8f0; padding-bottom:1mm; margin-bottom:1mm;">
        <span style="font-size:${opts.paperSize === '50x30mm' ? '8px' : '10px'}; font-weight:700; color:#334155; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${storeText}</span>
        <span style="font-size:${opts.paperSize === '50x30mm' ? '9px' : '12px'}; font-weight:800; color:#047857; font-family:monospace; white-space:nowrap;">${priceText}</span>
      </div>
      <div style="font-size:${opts.paperSize === '50x30mm' ? '9px' : '11px'}; font-weight:700; color:#0f172a; line-height:1.25; margin-bottom:1mm; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${nameText}</div>
      <div style="width:100%; max-width:100%;">${svgMarkup}</div>
      <div style="font-size:8px; color:#64748b; font-family:monospace; margin-top:0.5mm;">${codeText}</div>
    </div>
  `;

  const cardsHtml = Array.from({ length: copies }, () => labelCard).join('');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>طباعة باركود - ${nameText}</title>
  <style>
    ${pageCss}
    html, body {
      margin: 0;
      padding: ${opts.paperSize === '50x30mm' ? '0' : '2mm'};
      background: #ffffff;
      color: #0f172a;
      font-family: "IBM Plex Sans Arabic", "Cairo", Tahoma, Arial, sans-serif;
      direction: rtl;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .labels-grid {
      ${gridStyle}
    }
    ${
      opts.paperSize === '50x30mm'
        ? '.label-card { page-break-after: always; break-after: page; } .label-card:last-child { page-break-after: auto; break-after: auto; }'
        : ''
    }
  </style>
</head>
<body>
  <div class="labels-grid">${cardsHtml}</div>
</body>
</html>`;
}
