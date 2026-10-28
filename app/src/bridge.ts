// The slice of the Even bridge the HUD uses, plus a browser preview that
// implements the same slice on a <canvas>, so `npm run dev` shows the lens
// without a phone. Real bridge when the page runs inside the Even app.

import {
  waitForEvenAppBridge, OsEventTypeList, StartUpPageCreateResult, ImageRawDataUpdateResult,
  CreateStartUpPageContainer, TextContainerUpgrade, ImageRawDataUpdate,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';

export interface GlassesBridge {
  createStartUpPageContainer(spec: any): Promise<StartUpPageCreateResult>;
  textContainerUpgrade(u: { containerID: number; containerName: string; content: string; textColor?: number }): Promise<boolean>;
  updateImageRawData(u: { containerID: number; containerName: string; imageData: Uint8Array }): Promise<ImageRawDataUpdateResult>;
  shutDownPageContainer(mode?: number): Promise<boolean>;
  onEvenHubEvent(cb: (e: EvenHubEvent) => void): () => void;
  /** Glasses battery percent, when the host reports it. */
  onBattery(cb: (pct: number) => void): void;
  /** Raw host call, for diagnostics: returns whatever the Even app replied, unparsed. */
  raw(method: string, params: any): Promise<any>;
  readonly kind: 'even' | 'preview';
}

export function hasEvenBridge(): boolean {
  const w = window as any;
  return !!(w.flutter_inappwebview && typeof w.flutter_inappwebview.callHandler === 'function');
}

export async function getBridge(): Promise<GlassesBridge> {
  if (hasEvenBridge()) {
    const b = await waitForEvenAppBridge();
    return {
      kind: 'even',
      createStartUpPageContainer: (spec) => b.createStartUpPageContainer(new CreateStartUpPageContainer(spec)),
      textContainerUpgrade: (u) => b.textContainerUpgrade(new TextContainerUpgrade(u)),
      updateImageRawData: (u) => b.updateImageRawData(new ImageRawDataUpdate(u)),
      shutDownPageContainer: (m = 0) => b.shutDownPageContainer(m),
      onEvenHubEvent: (cb) => b.onEvenHubEvent(cb),
      onBattery: (cb) => {
        b.getDeviceInfo().then(d => { const p = d?.status?.batteryLevel; if (typeof p === 'number') cb(p); }).catch(() => {});
        b.onDeviceStatusChanged(st => { if (typeof st.batteryLevel === 'number') cb(st.batteryLevel); });
      },
      raw: (method, params) => b.callEvenApp(method, params),
    };
  }
  return createPreviewBridge();
}

// ---------- Browser preview ----------

const GREEN = [0x46, 0xff, 0x78];

function createPreviewBridge(): GlassesBridge {
  document.body.classList.add('preview');
  const canvas = document.getElementById('preview') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const images = new Map<number, { x: number; y: number; w: number; h: number; bmp?: ImageBitmap }>();
  const texts = new Map<number, { x: number; y: number; w: number; h: number; content: string; op: number }>();
  const listeners = new Set<(e: EvenHubEvent) => void>();
  let menuOpen = false;
  let menuItems: { itemID: number; itemName: string }[] = [];
  let menuSel = 0;

  function repaint() {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 576, 288);
    for (const im of images.values()) if (im.bmp) ctx.drawImage(im.bmp, im.x, im.y, im.w, im.h);
    ctx.font = '500 20px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    for (const t of texts.values()) {
      ctx.fillStyle = `rgba(${GREEN.join(',')},${t.op})`;
      // The firmware font is narrower than any browser font, so a line that
      // was space-padded into left/right halves is drawn as two anchored runs.
      const m = t.content.match(/^(.*?)\s{3,}(\S.*)$/);
      if (m) {
        ctx.textAlign = 'left'; ctx.fillText(m[1], t.x, t.y + 20);
        ctx.textAlign = 'right'; ctx.fillText(m[2], t.x + t.w, t.y + 20);
        ctx.textAlign = 'left';
      } else {
        ctx.textAlign = 'left'; ctx.fillText(t.content, t.x, t.y + 20);
      }
    }
    if (menuOpen) {
      ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(376, 40, 190, 20 + menuItems.length * 27);
      ctx.strokeStyle = `rgb(${GREEN.join(',')})`; ctx.strokeRect(376.5, 40.5, 190, 20 + menuItems.length * 27);
      menuItems.forEach((it, i) => {
        ctx.fillStyle = `rgba(${GREEN.join(',')},${i === menuSel ? 1 : 0.5})`;
        ctx.fillText((i === menuSel ? '› ' : '  ') + it.itemName, 388, 70 + i * 27);
      });
    }
  }

  function emit(e: EvenHubEvent) { for (const l of listeners) l(e); }
  function sysEvent(eventType: OsEventTypeList): EvenHubEvent {
    return { sysEvent: { eventType, eventSource: 1 } as any };
  }

  canvas.addEventListener('click', () => {
    if (menuOpen) {
      menuOpen = false;
      const it = menuItems[menuSel];
      repaint();
      if (it) emit({ menuItemClickEvent: { itemID: it.itemID } as any });
      return;
    }
    emit(sysEvent(OsEventTypeList.CLICK_EVENT));
  });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'm' || ev.key === 'M') { menuOpen = !menuOpen; menuSel = 0; repaint(); }
    else if (menuOpen && (ev.key === 'ArrowDown' || ev.key === 'j')) { menuSel = (menuSel + 1) % menuItems.length; repaint(); }
    else if (menuOpen && (ev.key === 'ArrowUp' || ev.key === 'k')) { menuSel = (menuSel + menuItems.length - 1) % menuItems.length; repaint(); }
    else if (ev.key === 'Enter' && menuOpen) { canvas.click(); }
    else if (ev.key === 'ArrowUp') emit(sysEvent(OsEventTypeList.SCROLL_TOP_EVENT));
    else if (ev.key === 'ArrowDown') emit(sysEvent(OsEventTypeList.SCROLL_BOTTOM_EVENT));
    else if (ev.key === ' ') { ev.preventDefault(); emit(sysEvent(OsEventTypeList.CLICK_EVENT)); }
  });

  async function tint(png: Uint8Array): Promise<ImageBitmap> {
    const bmp = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }));
    const off = document.createElement('canvas'); off.width = bmp.width; off.height = bmp.height;
    const octx = off.getContext('2d')!;
    octx.drawImage(bmp, 0, 0);
    const id = octx.getImageData(0, 0, off.width, off.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
      const q = Math.round(lum * 15) / 15;                 // 16 grey levels, like the glasses
      d[i] = GREEN[0]; d[i + 1] = GREEN[1]; d[i + 2] = GREEN[2]; d[i + 3] = Math.round(q * 255);
    }
    octx.putImageData(id, 0, 0);
    return createImageBitmap(off);
  }

  return {
    kind: 'preview',
    async createStartUpPageContainer(spec) {
      images.clear(); texts.clear();
      for (const im of spec.imageObject ?? []) images.set(im.containerID, { x: im.xPosition, y: im.yPosition, w: im.width, h: im.height });
      for (const t of spec.textObject ?? []) texts.set(t.containerID, { x: t.xPosition, y: t.yPosition, w: t.width, h: t.height, content: t.content ?? '', op: 1 });
      menuItems = spec.menuObject?.menuItems ?? [];
      repaint();
      return StartUpPageCreateResult.success;
    },
    async textContainerUpgrade(u) {
      const t = texts.get(u.containerID);
      if (!t) return false;
      t.content = u.content;
      if (typeof u.textColor === 'number') t.op = [0.12, 0.3, 0.5, 0.75, 1][u.textColor] ?? 1;
      repaint();
      return true;
    },
    async updateImageRawData(u) {
      const im = images.get(u.containerID);
      if (!im) return ImageRawDataUpdateResult.imageException;
      im.bmp = await tint(u.imageData);
      repaint();
      return ImageRawDataUpdateResult.success;
    },
    async shutDownPageContainer() {
      images.clear(); texts.clear(); repaint();
      const st = document.getElementById('status'); if (st) st.textContent = 'HUD closed. Reload to restart.';
      return true;
    },
    onEvenHubEvent(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    onBattery() { /* no glasses in the preview */ },
    async raw() { return 'preview'; },
  };
}
