import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LanguageProvider } from "../../i18n/LanguageContext";
import type { ListedModelOption } from "../../hooks/useListedModels";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: false, loading: false }),
}));

const catalog: ListedModelOption[] = Array.from({ length: 8 }, (_, i) => ({
  id: `ark:model-${i}`,
  label: `Model ${i}`,
  sub: `desc ${i}`,
  priced: true,
  priceRange: "1积分",
  isDefault: i === 0,
  sortOrder: i,
}));

vi.mock("../../hooks/useListedModels", () => ({
  useListedModels: () => ({ models: catalog, fromCatalog: true }),
}));

vi.mock("../NewProjectDialog", () => ({
  NewProjectDialog: () => null,
}));

import HeroPromptInput from "../HeroPromptInput";

describe("HeroPromptInput model dropdown", () => {
  it("opens a scrollable list that keeps all catalog models in the DOM", () => {
    render(
      <LanguageProvider>
        <HeroPromptInput />
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Model 0/ }));

    const last = screen.getByText("desc 7 · ark:model-7");
    const list = last.closest("div.overflow-y-auto");
    expect(list).not.toBeNull();
    expect(list).toHaveClass("overflow-y-auto");
    expect(list).toHaveClass("max-h-[320px]");
    expect(list).toHaveClass("overscroll-contain");
    expect(screen.getByText("desc 0 · ark:model-0")).toBeInTheDocument();
  });
});
