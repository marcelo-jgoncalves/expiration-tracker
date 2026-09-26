import "@testing-library/jest-dom/vitest";

// jsdom has no viewport media engine; browser tests exercise responsive changes.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (media: string): MediaQueryList => ({
    media, matches: false, onchange: null,
    addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => true,
  }),
});
