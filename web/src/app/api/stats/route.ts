import { NextResponse } from "next/server";

const CACHE_SECONDS = 60;

function unavailable() {
  return NextResponse.json(
    { installations: null },
    {
      status: 503,
      headers: { "cache-control": "no-store" },
    },
  );
}

export async function GET() {
  const source = process.env.RAV_COUNTER_STATS_URL;
  if (!source) return unavailable();

  try {
    const response = await fetch(source, {
      headers: { accept: "application/json" },
      next: { revalidate: CACHE_SECONDS },
    });
    if (!response.ok) return unavailable();

    const value: unknown = await response.json();
    const installations = (
      value
      && typeof value === "object"
      && "installations" in value
    ) ? Number(value.installations) : Number.NaN;

    if (!Number.isSafeInteger(installations) || installations < 0) {
      return unavailable();
    }

    return NextResponse.json(
      { installations },
      {
        headers: {
          "cache-control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`,
        },
      },
    );
  } catch {
    return unavailable();
  }
}
