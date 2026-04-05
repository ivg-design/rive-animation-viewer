"use client";

import { useReportWebVitals } from "next/web-vitals";

export default function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    if (typeof window === "undefined") {
      return;
    }

    const payload = {
      id: metric.id,
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      navigationType: metric.navigationType,
      url: window.location.href,
      ts: Date.now(),
    };

    (window as Window & { __ravWebVitals?: unknown[] }).__ravWebVitals = [
      ...((window as Window & { __ravWebVitals?: unknown[] }).__ravWebVitals || []),
      payload,
    ];
  });

  return null;
}
