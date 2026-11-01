/**
 * Print & PDF Export Utility Helpers for DialisisLog
 * Standardized for KARS & PERNEFRI accreditation documentation.
 * Supports:
 * 1. "Cetak": Langsung membuka dialog cetak browser (window.print)
 * 2. "Simpan PDF": Langsung mendownload file dokumen PDF ke perangkat pengguna (html-to-image + jsPDF)
 *    Mendukung penuh warna modern Tailwind CSS v4 (oklab, oklch) tanpa crash.
 */

import { toJpeg } from 'html-to-image';
import { jsPDF } from 'jspdf';

export interface PrintOptions {
  isLandscape?: boolean;
  documentTitle?: string;
  isModal?: boolean;
}

export interface DownloadPdfOptions {
  filename?: string;
  isLandscape?: boolean;
  scale?: number;
  marginMm?: number;
}

export function isRunningInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * FUNGSI CETAK: Langsung membuka dialog cetak browser (window.print)
 * dengan orientasi Portrait atau Landscape standar kertas A4 KARS & PERNEFRI.
 */
export function printDocumentWithOrientation(
  isLandscape: boolean = false,
  documentTitle?: string,
  isModal: boolean = false
): void {
  if (typeof window === 'undefined') return;

  const styleId = 'dialysis-print-orientation-style';
  let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }

  // Dynamic @page size and margins
  styleEl.innerHTML = `
    @page {
      size: A4 ${isLandscape ? 'landscape' : 'portrait'} !important;
      margin: ${isLandscape ? '5mm 4mm' : '7mm 6mm'} !important;
    }
  `;

  // Apply printing helper classes to body
  const bodyClasses = document.body.classList;
  bodyClasses.add('dialysis-printing');
  if (isLandscape) {
    bodyClasses.add('dialysis-landscape');
    bodyClasses.remove('dialysis-portrait');
  } else {
    bodyClasses.add('dialysis-portrait');
    bodyClasses.remove('dialysis-landscape');
  }

  if (isModal) {
    bodyClasses.add('dialysis-modal-printing');
  }

  // Save current title and temporarily set custom title for suggested PDF file name in browser
  const originalTitle = document.title;
  if (documentTitle) {
    const sanitizedTitle = documentTitle
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .trim();
    document.title = sanitizedTitle;
  }

  const cleanup = () => {
    bodyClasses.remove('dialysis-printing', 'dialysis-landscape', 'dialysis-portrait', 'dialysis-modal-printing');
    if (documentTitle) {
      document.title = originalTitle;
    }
    const el = document.getElementById(styleId);
    if (el) el.remove();
    window.removeEventListener('afterprint', cleanup);
  };

  window.addEventListener('afterprint', cleanup, { once: true });

  // Use requestAnimationFrame to ensure all DOM updates and layout reflows complete before print dialog
  requestAnimationFrame(() => {
    setTimeout(() => {
      let isBlocked = false;
      try {
        window.focus();
        window.print();
        if (isRunningInIframe()) {
          window.dispatchEvent(
            new CustomEvent('dialysis_print_in_iframe_attempted', {
              detail: { documentTitle }
            })
          );
        }
      } catch (err) {
        isBlocked = true;
        console.warn('Print trigger blocked or failed:', err);
        cleanup();
        window.dispatchEvent(
          new CustomEvent('dialysis_print_blocked', {
            detail: {
              error: err instanceof Error ? err.message : String(err),
              documentTitle
            }
          })
        );
      }
      if (!isBlocked) {
        setTimeout(cleanup, 4000);
      }
    }, 80);
  });
}

/**
 * FUNGSI SIMPAN PDF: Langsung mendownload file .pdf ke perangkat pengguna
 * Memanfaatkan native browser rasterization html-to-image yang kompatibel penuh
 * dengan warna modern Tailwind CSS v4 (oklab, oklch) dan jsPDF.
 */
export async function downloadElementAsPdf(
  elementIdOrElement: string | HTMLElement,
  options: DownloadPdfOptions = {}
): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  const {
    filename = 'Dokumen_Hemodialisis',
    isLandscape = false,
    scale = 2,
    marginMm = 4
  } = options;

  const targetEl =
    typeof elementIdOrElement === 'string'
      ? document.getElementById(elementIdOrElement)
      : elementIdOrElement;

  if (!targetEl) {
    console.warn(`[downloadElementAsPdf] Target element not found:`, elementIdOrElement);
    return false;
  }

  // Preserve scroll & layout states
  const prevOverflow = targetEl.style.overflow;
  const prevMaxHeight = targetEl.style.maxHeight;
  targetEl.style.overflow = 'visible';
  targetEl.style.maxHeight = 'none';

  try {
    // Generate high-resolution JPEG data URL via native SVG foreignObject
    // skipFonts: true and fontEmbedCSS: '' prevent SecurityError when inspecting cross-origin stylesheets (e.g. Google Fonts)
    const dataUrl = await toJpeg(targetEl, {
      quality: 0.95,
      pixelRatio: Math.max(1.5, Math.min(scale, 2.5)),
      backgroundColor: '#ffffff',
      cacheBust: false,
      skipFonts: true,
      fontEmbedCSS: '',
      filter: (node) => {
        if (node instanceof HTMLElement) {
          if (
            node.classList.contains('print:hidden') ||
            node.classList.contains('modal-toolbar') ||
            node.getAttribute('data-pdf-ignore') === 'true'
          ) {
            return false;
          }
        }
        return true;
      }
    });

    targetEl.style.overflow = prevOverflow;
    targetEl.style.maxHeight = prevMaxHeight;

    // Load into Image to extract natural dimensions
    const img = new Image();
    img.src = dataUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load generated image into memory'));
    });

    const orientation = isLandscape ? 'landscape' : 'portrait';
    const pdf = new jsPDF({
      orientation,
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pageWidth = isLandscape ? 297 : 210;
    const pageHeight = isLandscape ? 210 : 297;
    const usableWidth = pageWidth - marginMm * 2;
    const usableHeight = pageHeight - marginMm * 2;

    const imgWidth = usableWidth;
    const imgHeight = (img.naturalHeight * imgWidth) / img.naturalWidth;

    if (imgHeight <= usableHeight) {
      // Single page document
      pdf.addImage(dataUrl, 'JPEG', marginMm, marginMm, imgWidth, imgHeight, undefined, 'FAST');
    } else {
      // Multipage document with slice pagination
      let heightLeft = imgHeight;
      let position = marginMm;
      let pageNum = 1;

      while (heightLeft > 0) {
        if (pageNum > 1) {
          pdf.addPage('a4', orientation);
        }
        pdf.addImage(dataUrl, 'JPEG', marginMm, position, imgWidth, imgHeight, undefined, 'FAST');
        heightLeft -= usableHeight;
        position -= usableHeight;
        pageNum++;
      }
    }

    const cleanName = filename
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/\.pdf$/i, '') + '.pdf';

    pdf.save(cleanName);
    return true;
  } catch (err) {
    targetEl.style.overflow = prevOverflow;
    targetEl.style.maxHeight = prevMaxHeight;
    console.error('[downloadElementAsPdf] PDF generation failed:', err);
    throw err;
  }
}
