"use client";

import { useEffect, useRef, useState } from "react";
import { asset } from "@/lib/config";

const REFRESH_MS = 60_000;

function FlipDigit({ digit }: { digit: number }) {
  const [currentDigit, setCurrentDigit] = useState(digit);
  const [nextDigit, setNextDigit] = useState(digit);
  const [flipping, setFlipping] = useState(false);

  useEffect(() => {
    if (digit === currentDigit) return;
    setNextDigit(digit);
    setFlipping(true);
    const timeout = window.setTimeout(() => {
      setCurrentDigit(digit);
      setFlipping(false);
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [currentDigit, digit]);

  return (
    <span className="usage-digit" aria-hidden="true">
      <span className="usage-digit-half usage-digit-upper"><span>{nextDigit}</span></span>
      <span className="usage-digit-half usage-digit-lower"><span>{currentDigit}</span></span>
      <span className={`usage-digit-half usage-digit-flip-up ${flipping ? "is-flipping" : ""}`}><span>{currentDigit}</span></span>
      <span className={`usage-digit-half usage-digit-flip-down ${flipping ? "is-flipping" : ""}`}><span>{nextDigit}</span></span>
    </span>
  );
}

export default function UsageCounter() {
  const [target, setTarget] = useState<number | null>(null);
  const [display, setDisplay] = useState(0);
  const [availability, setAvailability] = useState<"loading" | "ready" | "stale" | "unavailable">("loading");
  const hasAnimated = useRef(false);

  useEffect(() => {
    let disposed = false;
    let hasValue = false;
    let requestSequence = 0;

    async function refresh() {
      const request = ++requestSequence;
      try {
        const response = await fetch(asset("/api/stats"), { cache: "no-store" });
        if (!response.ok) throw new Error(`stats endpoint returned ${response.status}`);
        const value = await response.json();
        if (request !== requestSequence || disposed) return;
        if (Number.isSafeInteger(value?.installations) && value.installations >= 0) {
          hasValue = true;
          setTarget(value.installations);
          setAvailability("ready");
          return;
        }
        throw new Error("stats endpoint returned an invalid total");
      } catch {
        if (!disposed && request === requestSequence) {
          setAvailability(hasValue ? "stale" : "unavailable");
        }
      }
    }

    void refresh();
    const interval = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, REFRESH_MS);
    const refreshWhenActive = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener("focus", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
    };
  }, []);

  useEffect(() => {
    if (target === null) return;
    if (hasAnimated.current) {
      setDisplay(target);
      return;
    }
    hasAnimated.current = true;
    if (target === 0 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(target);
      return;
    }

    const duration = 2_500;
    const steps = 50;
    let step = 0;
    const interval = window.setInterval(() => {
      step += 1;
      if (step >= steps) {
        setDisplay(target);
        window.clearInterval(interval);
      } else {
        setDisplay(Math.floor((target * step) / steps));
      }
    }, duration / steps);
    return () => window.clearInterval(interval);
  }, [target]);

  const text = String(display).padStart(4, "0");
  const hasDisplay = target !== null && (availability === "ready" || availability === "stale");
  const stale = availability === "stale";

  return (
    <section className="usage-counter-section" aria-labelledby="usage-counter-label">
      {hasDisplay ? (
        <div className={`usage-counter ${stale ? "is-stale" : ""}`} role="img" aria-label={stale ? `${display.toLocaleString()} last reported anonymous RAV installations; refresh temporarily unavailable` : `${display.toLocaleString()} anonymous RAV installations reported`}>
          {[...text].map((digit, index) => (
            <FlipDigit key={`${text.length}-${index}`} digit={Number(digit)} />
          ))}
        </div>
      ) : (
        <div className="usage-counter usage-counter-skeleton" role="status" aria-live="polite" aria-label={availability === "loading" ? "Loading RAV installation count" : "RAV installation count temporarily unavailable"}>
          {[0, 1, 2, 3].map((position) => <span key={position} aria-hidden="true" />)}
        </div>
      )}
      <p id="usage-counter-label" className="usage-counter-label">RAV installations</p>
      <p className="usage-counter-note">
        {hasDisplay ? (stale ? "Last reported total · refresh temporarily unavailable" : "Anonymous reports · checks about every minute") : (availability === "loading" ? "Retrieving anonymous total…" : "Installation count temporarily unavailable")}
      </p>
    </section>
  );
}
