import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

type Theme = "light" | "dark";
interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}
const ThemeContext = createContext<ThemeContextType>({ theme: "light", toggleTheme: () => {} });
export function useTheme() {
  return useContext(ThemeContext);
}

const LIGHT = {
  "--bg-main": "#f0f7f5",
  "--bg-soft": "#f5faf8",
  "--bg-surface": "#ffffff",
  "--bg-elevated": "#e8f4f0",
  "--border-color": "#c8ddd6",
  "--border-soft": "#dceeda",
  "--border-glow": "rgba(89,201,213,0.40)",
  "--text-primary": "#1a3530",
  "--text-secondary": "#4a7068",
  "--text-muted": "#8aab9e",
  "--ambient-1": "rgba(89,201,213,0.10)",
  "--ambient-2": "rgba(131,203,164,0.10)",
  "--ambient-3": "rgba(181,214,132,0.08)",
};
const DARK = {
  "--bg-main": "#0a0e12",
  "--bg-soft": "#0d1218",
  "--bg-surface": "#111927",
  "--bg-elevated": "#162030",
  "--border-color": "#1b2e40",
  "--border-soft": "#142230",
  "--border-glow": "rgba(89,201,213,0.35)",
  "--text-primary": "#e8f0f6",
  "--text-secondary": "#8ca8bc",
  "--text-muted": "#4a6478",
  "--ambient-1": "rgba(89,201,213,0.12)",
  "--ambient-2": "rgba(131,203,164,0.09)",
  "--ambient-3": "rgba(181,214,132,0.08)",
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "dark";
    return (window.localStorage.getItem("doopoo-theme") as Theme) || "dark";
  });

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      if (typeof window !== "undefined") window.localStorage.setItem("doopoo-theme", next);
      return next;
    });
  };

  useEffect(() => {
    const root = document.documentElement;
    const vars = theme === "dark" ? DARK : LIGHT;
    root.setAttribute("data-theme", theme === "dark" ? "dark" : "");
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v as string));
    document.body.style.background = vars["--bg-main"];
    document.body.style.color = vars["--text-primary"];
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}
