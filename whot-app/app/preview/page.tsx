"use client";

import Image from "next/image";
import { Card, CardBack, Shape } from "@/components/Card";
import { SHAPES, SHAPE_NAME, WHOT, encode } from "@/lib/whot";

/** Style reference for the deck. Not part of the game, but it lets anyone
 *  eyeball every card face without dealing a real hand. */
export default function Preview() {
  const rows: { shape: number; nums: number[] }[] = [
    { shape: 0, nums: [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14] },
    { shape: 1, nums: [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14] },
    { shape: 2, nums: [1, 2, 3, 5, 7, 10, 11, 13, 14] },
    { shape: 3, nums: [1, 2, 3, 5, 7, 10, 11, 13, 14] },
    { shape: 4, nums: [1, 2, 3, 4, 5, 7, 8] },
  ];

  return (
    <main className="min-h-screen p-10">
      <div className="mx-auto max-w-6xl space-y-10">
        <header className="text-center">
          <Image
            src="/whot/wordmark.png"
            alt="Whot"
            width={720}
            height={345}
            priority
            className="mx-auto w-52 h-auto"
          />
          <div className="gold-rule h-px w-40 mx-auto my-3" />
          <p className="text-[var(--ink)]/60 text-sm">Deck reference · 54 cards</p>
        </header>

        <section className="felt rounded-2xl p-8 border border-black/20">
          <h2 className="text-[0.65rem] uppercase tracking-[0.18em] text-white/55 mb-4">
            On the table
          </h2>
          <div className="flex items-end gap-6">
            <CardBack />
            <Card card={encode(0, 12)} />
            <Card card={encode(4, 8)} />
            <Card card={encode(WHOT, 20)} />
            <div className="ml-6 flex gap-4">
              {SHAPES.map((s) => (
                <div key={s} className="text-center">
                  <Shape shape={s} size={44} />
                  <div className="text-[0.6rem] uppercase tracking-widest text-white/50 mt-1">
                    {SHAPE_NAME[s]}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section>
          <h2 className="font-serif text-2xl font-bold text-[var(--ink)] mb-3">
            Seat states
          </h2>
          <div className="flex flex-wrap gap-3">
            {[5, 2, 1].map((n) => (
              <div
                key={n}
                className={[
                  "rounded-xl px-4 py-3 bg-[var(--cream)] shadow-sm border-2 min-w-[9.5rem]",
                  n === 1 ? "border-[var(--gold)]" : "border-transparent",
                ].join(" ")}
              >
                <div className="text-xs text-neutral-500 font-mono">Seat 1</div>
                <div className="font-mono text-sm">0xeF45…bFAb</div>
                <div className="text-3xl font-black font-serif text-[var(--ink)]">
                  {n}
                  <span className="text-xs font-normal text-neutral-500 ml-1">
                    cards
                  </span>
                </div>
                {(n === 1 || n === 2) && (
                  <div
                    className={[
                      "mt-1.5 inline-block rounded px-2 py-0.5",
                      "text-[0.6rem] font-black uppercase tracking-[0.14em]",
                      n === 1
                        ? "bg-[var(--ink)] text-[var(--cream)] animate-pulse"
                        : "bg-[var(--gold)]/25 text-[var(--ink)] border border-[var(--gold)]",
                    ].join(" ")}
                  >
                    {n === 1 ? "Last card!" : "Semi last card"}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {rows.map((r) => (
          <section key={r.shape}>
            <h2 className="font-serif text-2xl font-bold text-[var(--ink)] mb-3">
              {SHAPE_NAME[r.shape]}
              <span className="ml-2 text-sm font-sans font-normal text-[var(--ink)]/50">
                {r.nums.length} cards
              </span>
            </h2>
            <div className="flex flex-wrap gap-2">
              {r.nums.map((n) => (
                <Card key={n} card={encode(r.shape, n)} small />
              ))}
            </div>
          </section>
        ))}

        <section>
          <h2 className="font-serif text-2xl font-bold text-[var(--ink)] mb-3">
            Whot
            <span className="ml-2 text-sm font-sans font-normal text-[var(--ink)]/50">
              5 cards
            </span>
          </h2>
          <div className="flex gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Card key={i} card={encode(WHOT, 20)} small />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
