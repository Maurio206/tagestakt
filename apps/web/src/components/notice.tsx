import { CircleCheck, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { type ReactNode } from "react";

export type NoticeTone = "info" | "warning" | "error" | "success" | "draft";

const ICONS = {
  info: Info,
  warning: TriangleAlert,
  error: OctagonAlert,
  success: CircleCheck,
  draft: TriangleAlert,
} as const;

/** Hinweis/Banner: Symbol + Text, Farbe nur unterstützend. */
export function Notice({
  tone = "info",
  title,
  children,
  role,
  id,
}: {
  tone?: NoticeTone;
  title?: string;
  children?: ReactNode;
  role?: "status" | "alert";
  id?: string;
}) {
  const Icon = ICONS[tone];
  return (
    <div className={`notice notice--${tone}`} role={role} id={id}>
      <Icon size={20} strokeWidth={1.9} aria-hidden="true" className="icon" />
      <div className="notice-body">
        {title ? <p className="notice-title">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}
