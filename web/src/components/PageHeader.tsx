import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";

export function PageHeader({ title, subtitle, back, actions }: { title: string; subtitle?: string; back?: { to: string; label: string }; actions?: ReactNode }) {
  return (
    <header className="mb-5 space-y-2">
      {back && (
        <Link to={back.to} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> {back.label}
        </Link>
      )}
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {actions}
      </div>
    </header>
  );
}
