import type { Metadata } from "next";
import Link from "next/link";
import { KilnMark } from "@/components/kiln/logo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Not found" };

const COLS = 96;
const ROWS = 30;
const CELL = 12.5;

/** Deterministic pseudo-random squares that thicken toward the bottom edge. */
function pixels() {
  let seed = 0x6b696c6e;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const cells: { x: number; y: number; o: number }[] = [];
  for (let r = 0; r < ROWS; r++) {
    const depth = r / (ROWS - 1);
    for (let c = 0; c < COLS; c++) {
      const wave = 0.12 * Math.sin(c / 9) + 0.08 * Math.sin(c / 3.7);
      if (rand() < Math.max(0, depth * 0.85 + wave - 0.1)) cells.push({ x: c * CELL, y: r * CELL, o: 0.35 + 0.65 * rand() * depth });
    }
  }
  return cells;
}

const CELLS = pixels();

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col items-center overflow-hidden px-4">
      <svg
        aria-hidden
        viewBox={`0 0 ${COLS * CELL} ${ROWS * CELL}`}
        preserveAspectRatio="xMidYMax slice"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[52%] w-full text-violet-400/70 dark:text-violet-500/35"
      >
        {CELLS.map((p) => (
          <rect key={`${p.x}-${p.y}`} x={p.x} y={p.y} width={CELL} height={CELL} fill="currentColor" opacity={p.o} />
        ))}
      </svg>
      <div className="relative mt-[15vh] flex w-full max-w-[400px] flex-col items-center">
        <KilnMark className="size-10 rounded-lg bg-violet-600 text-white" />
        <div className="mt-8 w-full rounded-xl border bg-background px-10 py-10 text-center shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
          <p className="mt-4 text-left text-sm text-muted-foreground">This page doesn&apos;t exist or you don&apos;t have access to it.</p>
          <Button className="mt-6 h-10 px-5" render={<Link href="/" />} nativeButton={false}>
            Back to factories
          </Button>
        </div>
      </div>
    </div>
  );
}
