import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import "./OmniHero.css";

export function OmniHero({ icon: Icon, eyebrow, title, description, summary }: { icon: LucideIcon; eyebrow: string; title: string; description: string; summary?: ReactNode }) {
  return <section className="ov-hero" aria-label={eyebrow}>
    <span className="ov-hero-icon"><Icon size={23} aria-hidden="true" /></span>
    <div className="ov-hero-copy"><span className="ov-hero-eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>
    {summary && <div className="ov-hero-summary">{summary}</div>}
  </section>;
}
