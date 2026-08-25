import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFormDraft } from "../../src/hooks/useFormDraft.js";

describe("useFormDraft", () => {
  it("starts from the initial value when nothing is persisted", () => {
    window.sessionStorage.clear();
    const { result } = renderHook(() => useFormDraft("test:draft-a", { name: "" }));
    expect(result.current.draft).toEqual({ name: "" });
  });

  it("persists updates and rehydrates them across an unmount/remount (session-interruption recovery, mission §49)", () => {
    window.sessionStorage.clear();
    const storageKey = "test:draft-b";
    const first = renderHook(() => useFormDraft(storageKey, { name: "" }));
    act(() => {
      first.result.current.update({ name: "Alvará" });
    });
    first.unmount();

    const second = renderHook(() => useFormDraft(storageKey, { name: "" }));
    expect(second.result.current.draft).toEqual({ name: "Alvará" });
  });

  it("clear() resets to the initial value and removes the persisted draft", () => {
    window.sessionStorage.clear();
    const storageKey = "test:draft-c";
    const { result } = renderHook(() => useFormDraft(storageKey, { name: "" }));
    act(() => {
      result.current.update({ name: "Alvará" });
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.draft).toEqual({ name: "" });
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });
});
