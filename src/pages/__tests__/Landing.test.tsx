import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LanguageProvider } from "../../i18n/LanguageContext";
import Landing from "../Landing";

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    className,
  }: {
    to: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

describe("Landing", () => {
  it("shows the brand title and a button that goes to the product home", () => {
    render(
      <LanguageProvider>
        <Landing />
      </LanguageProvider>,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("让 AI");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("成为你的创意伙伴");
    const cta = screen.getByRole("link", { name: "开启创作" });
    expect(cta).toHaveAttribute("href", "/home");
  });

  it("renders a full-bleed canvas backdrop", () => {
    render(
      <LanguageProvider>
        <Landing />
      </LanguageProvider>,
    );
    expect(document.querySelector("canvas")).not.toBeNull();
  });
});
