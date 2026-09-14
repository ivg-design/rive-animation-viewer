import type { ImgHTMLAttributes } from "react";
import { asset } from "@/lib/config";
import { responsiveImages, type ResponsiveImageKey } from "@/lib/responsive-images";

type ResponsiveImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "width" | "height"> & {
  image: ResponsiveImageKey;
  sizes: string;
  width?: number;
  height?: number;
  priority?: boolean;
};

export default function ResponsiveImage({
  image,
  sizes,
  width,
  height,
  priority = false,
  loading,
  decoding = "async",
  ...props
}: ResponsiveImageProps) {
  const source = responsiveImages[image];
  const srcSet = [...source.variants, { src: source.src, width: source.width }]
    .map((variant) => `${asset(variant.src)} ${variant.width}w`)
    .join(", ");

  return (
    // These files are generated locally because this deployment intentionally disables Next image optimization.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      src={asset(source.src)}
      srcSet={srcSet}
      sizes={sizes}
      width={width ?? source.width}
      height={height ?? source.height}
      loading={priority ? "eager" : loading ?? "lazy"}
      fetchPriority={priority ? "high" : props.fetchPriority}
      decoding={decoding}
    />
  );
}
