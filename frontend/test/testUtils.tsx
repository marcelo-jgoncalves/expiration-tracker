import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, type InitialEntry } from "react-router-dom";
import type { ReactElement } from "react";

/** Renders a routed component at a given path with its own isolated QueryClient (retry
 * disabled - tests assert on the first attempt's outcome, never a flaky retry timing race).
 * `initialEntry` accepts a plain path string, or `{ pathname, state }` to simulate a
 * `navigate(path, { state })` landing (e.g. CreateItem's post-success redirect). */
export function renderAtRoute(routePath: string, element: ReactElement, initialEntry: InitialEntry) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path={routePath} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}
