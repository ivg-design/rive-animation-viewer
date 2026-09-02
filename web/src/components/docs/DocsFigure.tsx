import Image from "next/image";

type DocsFigureProps = {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption: string;
  className?: string;
};

export default function DocsFigure({
  src,
  alt,
  width,
  height,
  caption,
  className = "",
}: DocsFigureProps) {
  return (
    <figure className={`my-6 ${className}`}>
      <a href={src} target="_blank" rel="noopener noreferrer" aria-label={`${alt} — open full-size image in a new tab`} className="block cursor-zoom-in">
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          sizes="(max-width: 860px) 100vw, 840px"
          className="w-full h-auto rounded-xl border border-[var(--border-dark)]"
        />
      </a>
      <figcaption className="mt-3 text-sm leading-relaxed text-[var(--text-dim)]">
        {caption}
        <a href={src} target="_blank" rel="noopener noreferrer" className="ml-2 whitespace-nowrap">View full size ↗</a>
      </figcaption>
    </figure>
  );
}
