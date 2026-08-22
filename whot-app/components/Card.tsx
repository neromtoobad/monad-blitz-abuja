"use client";

import Image from "next/image";
import { WHOT, numberOf, shapeOf } from "@/lib/whot";

/**
 * Card faces follow the classic Waddingtons Nigerian deck: cream stock,
 * oxblood ink, ornamental gold-and-maroon symbols, number mirrored in opposite
 * corners. Symbols are generated PNGs sliced from a single reference sheet, so
 * all five share one style.
 */

const SHAPE_FILE: Record<number, string> = {
  0: "/whot/circle.png",
  1: "/whot/triangle.png",
  2: "/whot/cross.png",
  3: "/whot/square.png",
  4: "/whot/star.png",
};

export function Shape({ shape, size = 48 }: { shape: number; size?: number }) {
  if (shape === WHOT) {
    return (
      <span
        className="font-serif font-black leading-none text-[var(--ink)]"
        style={{ fontSize: size * 0.62 }}
      >
        20
      </span>
    );
  }
  const src = SHAPE_FILE[shape];
  if (!src) return null;
  return (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      className="select-none"
      draggable={false}
      priority={size > 60}
    />
  );
}

export function Card({
  card,
  onClick,
  disabled,
  selected,
  small,
}: {
  card: number;
  onClick?: () => void;
  disabled?: boolean;
  selected?: boolean;
  small?: boolean;
}) {
  const shape = shapeOf(card);
  const num = numberOf(card);
  const whot = shape === WHOT;
  const interactive = !!onClick;

  const w = small ? "w-[4.25rem] h-[6rem]" : "w-[6.5rem] h-[9.25rem]";
  const corner = small ? "text-sm" : "text-xl";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !interactive}
      aria-label={whot ? "Whot 20" : `${num}`}
      className={[
        w,
        "whot-card relative shrink-0 rounded-[0.6rem] transition-transform duration-150",
        "flex items-center justify-center",
        selected ? "-translate-y-4 ring-2 ring-[var(--gold)]" : "",
        interactive && !disabled
          ? "hover:-translate-y-2 cursor-pointer"
          : "cursor-default",
        disabled && interactive ? "opacity-40 saturate-50" : "",
      ].join(" ")}
    >
      {/* top-left index */}
      <span
        className={`absolute top-1.5 left-2 font-serif font-bold leading-none text-[var(--ink)] ${corner}`}
      >
        {whot ? "20" : num}
      </span>

      {/* centre symbol */}
      {whot ? (
        <span
          className="font-serif italic text-[var(--ink)] leading-none"
          style={{ fontSize: small ? 20 : 30 }}
        >
          Whot
        </span>
      ) : (
        <Shape shape={shape} size={small ? 34 : 54} />
      )}

      {/* bottom-right index, mirrored like a real card */}
      <span
        className={`absolute bottom-1.5 right-2 font-serif font-bold leading-none text-[var(--ink)] rotate-180 ${corner}`}
      >
        {whot ? "20" : num}
      </span>
    </button>
  );
}

export function CardBack({ small }: { small?: boolean }) {
  const w = small ? "w-[4.25rem] h-[6rem]" : "w-[6.5rem] h-[9.25rem]";
  return (
    <div
      className={`${w} shrink-0 rounded-[0.6rem] overflow-hidden shadow-[0_2px_6px_rgba(0,0,0,0.35)]`}
    >
      <Image
        src="/whot/back.png"
        alt="Whot card back"
        width={140}
        height={210}
        className="w-full h-full object-cover select-none"
        draggable={false}
      />
    </div>
  );
}
