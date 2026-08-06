import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { ThemeProvider } from "../context/ThemeContext";
import { LanguageProvider } from "../i18n/LanguageContext";
import MainLayout from "../layouts/MainLayout";
import { useEffect } from "react";
import { runLegacyMigration } from "../lib/legacyMigrate";
import { Toaster } from "../components/ui/sonner";

// 404 / 错误页在 LanguageProvider 之外渲染，无法走 i18n context；
// 按浏览器语言做静态双语判定。
const prefersZh =
  typeof navigator !== "undefined" && (navigator.language ?? "").toLowerCase().startsWith("zh");

const fallbackText = prefersZh
  ? {
      notFoundTitle: "页面不存在",
      notFoundDesc: "你要找的页面不存在或已被移动。",
      goHome: "返回首页",
      errorTitle: "页面加载失败",
      errorDesc: "我们这边出了点问题，可以刷新重试或返回首页。",
      tryAgain: "重试",
    }
  : {
      notFoundTitle: "Page not found",
      notFoundDesc: "The page you're looking for doesn't exist or has been moved.",
      goHome: "Go home",
      errorTitle: "This page didn't load",
      errorDesc: "Something went wrong on our end. You can try refreshing or head back home.",
      tryAgain: "Try again",
    };

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">
          {fallbackText.notFoundTitle}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{fallbackText.notFoundDesc}</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {fallbackText.goHome}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {fallbackText.errorTitle}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{fallbackText.errorDesc}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {fallbackText.tryAgain}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {fallbackText.goHome}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Doopoo — AI creative studio" },
      {
        name: "description",
        content:
          "Doopoo: an AI-powered creative studio for prompts, scripts, characters and showcases.",
      },
      { property: "og:title", content: "Doopoo — AI creative studio" },
      {
        property: "og:description",
        content:
          "Doopoo: an AI-powered creative studio for prompts, scripts, characters and showcases.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Doopoo — AI creative studio" },
      {
        name: "twitter:description",
        content:
          "Doopoo: an AI-powered creative studio for prompts, scripts, characters and showcases.",
      },
      {
        property: "og:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/L58n8pP7EFQDqPdwbZhdkFqRYGs1/social-images/social-1778203983627-doopoo.webp",
      },
      {
        name: "twitter:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/L58n8pP7EFQDqPdwbZhdkFqRYGs1/social-images/social-1778203983627-doopoo.webp",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  // 阻止主题闪烁：默认深色 data-theme="dark" 由服务端直出。
  // 内联脚本仅在用户显式选了浅色时才切掉，避免水合不匹配。
  const themeScript = `!function(){
  try{var t=localStorage.getItem("doopoo-theme");if(t==="light")document.documentElement.setAttribute("data-theme","")}catch(e){}
}()`;
  return (
    <html lang="en" data-theme="dark">
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    // 2026 Seedream 迁移:删除了 OpenRouter 动态模型市场探针(probeImageModels)。
    // 现在模型是写死的(Seedream 主力 + legacy 兜底层),不需要启动时探测。
    runLegacyMigration();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <ThemeProvider>
          <MainLayout>
            <Outlet />
          </MainLayout>
          <Toaster />
        </ThemeProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}
