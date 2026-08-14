import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";

export type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

export default function PasswordInput({ className, ...props }: PasswordInputProps) {
  const { t } = useLanguage();
  const [show, setShow] = useState(false);

  return (
    <div className="relative mt-1">
      <input
        type={show ? "text" : "password"}
        className={[
          "w-full px-3 py-2 pr-10 rounded-lg bg-bg-elevated border border-border",
          "focus:outline-none focus:border-accent/60",
          className || "",
        ].join(" ")}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShow((prev) => !prev)}
        disabled={props.disabled}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-text-muted hover:text-text-secondary rounded-md transition-colors disabled:opacity-50"
        aria-label={show ? t.common_hide_password : t.common_show_password}
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}
