export type AppShellMode = "landing" | "workspace" | "restyle" | "app";

export function appShellMode(pathname: string): AppShellMode {
  if (pathname === "/") return "landing";
  if (pathname.startsWith("/workspace/")) return "workspace";
  if (pathname.startsWith("/restyle")) return "restyle";
  return "app";
}
