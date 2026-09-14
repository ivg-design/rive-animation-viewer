export const responsiveImages = {
  hero: {
    src: "/media/screenshots/hero-rav-window.webp",
    width: 2200,
    height: 1639,
    variants: [384, 768, 1100, 1600].map((width) => ({
      width,
      src: `/media/responsive/hero-rav-window-w${width}.webp`,
    })),
  },
  viewModelControls: {
    src: "/docs/vm-controls-panel.webp",
    width: 1064,
    height: 2084,
    variants: [400, 800].map((width) => ({
      width,
      src: `/media/responsive/vm-controls-panel-w${width}.webp`,
    })),
  },
  exportControls: {
    src: "/docs/export-controls.webp",
    width: 2358,
    height: 1637,
    variants: [400, 800, 1200].map((width) => ({
      width,
      src: `/media/responsive/export-controls-w${width}.webp`,
    })),
  },
  mcpSetup: {
    src: "/docs/mcp-setup.webp",
    width: 1320,
    height: 2812,
    variants: [400, 800, 1200].map((width) => ({
      width,
      src: `/media/responsive/mcp-setup-w${width}.webp`,
    })),
  },
  appIcon: {
    src: "/images/app-icon.png",
    width: 128,
    height: 128,
    variants: [32, 64].map((width) => ({
      width,
      src: `/media/responsive/app-icon-w${width}.webp`,
    })),
  },
} as const;

export type ResponsiveImageKey = keyof typeof responsiveImages;
