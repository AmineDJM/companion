'use client';

import { useEffect } from 'react';
import type { ViewerVitalMetric } from '@companion/shared';

/**
 * Field performance reporting.
 *
 * Measured with the browser's own PerformanceObserver rather than a library, so
 * the viewer carries no extra bytes to tell us how slow it is. Each metric is
 * reported once, when the page is hidden — which is the only moment CLS and INP
 * are final.
 */
interface Sample {
  metric: ViewerVitalMetric;
  value: number;
}

interface LayoutShift extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

interface EventTiming extends PerformanceEntry {
  interactionId?: number;
  duration: number;
}

function deviceClass(): 'phone' | 'tablet' | 'desktop' {
  const width = window.innerWidth;
  if (width < 640) return 'phone';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

export function VitalsReporter({ slug }: { slug: string }) {
  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return;

    const samples = new Map<ViewerVitalMetric, number>();
    const observers: PerformanceObserver[] = [];

    const observe = (type: string, handler: (entries: PerformanceEntry[]) => void) => {
      try {
        const observer = new PerformanceObserver((list) => handler(list.getEntries()));
        // buffered replays entries that fired before this effect ran, which is
        // always the case for LCP.
        observer.observe({ type, buffered: true });
        observers.push(observer);
      } catch {
        // An unsupported entry type simply yields no sample for that metric.
      }
    };

    observe('largest-contentful-paint', (entries) => {
      const last = entries.at(-1);
      if (last) samples.set('lcp', last.startTime);
    });

    let cumulativeShift = 0;
    observe('layout-shift', (entries) => {
      for (const entry of entries as LayoutShift[]) {
        // Shifts within 500ms of an interaction are the user's doing.
        if (!entry.hadRecentInput) cumulativeShift += entry.value;
      }
      samples.set('cls', cumulativeShift);
    });

    let worstInteraction = 0;
    observe('event', (entries) => {
      for (const entry of entries as EventTiming[]) {
        if (entry.interactionId && entry.duration > worstInteraction) {
          worstInteraction = entry.duration;
        }
      }
      if (worstInteraction > 0) samples.set('inp', worstInteraction);
    });

    const navigation = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (navigation) samples.set('ttfb', navigation.responseStart);

    // How long until the reader can actually see the document: the product's
    // own promise, which no standard metric measures.
    const firstPage = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .filter((entry) => entry.name.includes('/pages/'))
      .map((entry) => entry.responseEnd)
      .sort((a, b) => a - b)[0];
    if (firstPage) samples.set('first_page', firstPage);

    let sent = false;
    const flush = () => {
      if (sent || samples.size === 0) return;
      sent = true;
      const payload: { metrics: Sample[]; deviceClass: string } = {
        metrics: [...samples].map(([metric, value]) => ({
          metric,
          // CLS is a small ratio; rounding it to an integer would erase it.
          value: metric === 'cls' ? Number(value.toFixed(4)) : Math.round(value),
        })),
        deviceClass: deviceClass(),
      };
      const body = JSON.stringify(payload);
      // sendBeacon survives the page going away; fetch does not.
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          `/api/c/${slug}/vitals`,
          new Blob([body], { type: 'application/json' }),
        );
      } else {
        void fetch(`/api/c/${slug}/vitals`, {
          method: 'POST',
          body,
          headers: { 'content-type': 'application/json' },
          keepalive: true,
        }).catch(() => undefined);
      }
    };

    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);

    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      for (const observer of observers) observer.disconnect();
      flush();
    };
  }, [slug]);

  return null;
}
