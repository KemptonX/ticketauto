"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { SidebarLogo, NavIcon, SidebarFooter } from "@/app/components/nav-icons";
import { ARTICLES, CATEGORIES, type Article, type NoteType } from "./guide-data";

const navItems = [
  { label: "Dashboard", href: "/", active: false },
  { label: "Tickets", href: "/orders", active: false },
  { label: "Sales", href: "/sales", active: false },
  { label: "Analytics", href: "/analytics", active: false },
  { label: "Cash Flow", href: "/cash-flow", active: false },
  { label: "Costs", href: "/costs", active: false },
  { label: "Tax & Accounts", href: "/tax-accounts", active: false },
  { label: "Accounts", href: "/account-manager", active: false },
  { label: "Calculator", href: "/viagogo-calculator", active: false },
  { label: "Scans", href: "/scans", active: false },
  { label: "Presale & Codes", href: "/presale", active: false },
  { label: "Forward Mail", href: "/forward-mail", active: false },
  { label: "Guides", href: "/guides", active: true },
];

async function handleLogout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login";
}

const NOTE_LABEL: Record<NoteType, string> = { tip: "Tip", warning: "Important", beta: "Beta" };

function NoteBox({ type, text }: { type: NoteType; text: string }) {
  return (
    <div className={`guide-note guide-note-${type}`}>
      <span className="guide-note-label">{NOTE_LABEL[type]}</span>
      <p>{text}</p>
    </div>
  );
}

function ArticleCard({
  article,
  open,
  onToggle,
  articleById,
  onOpenRelated,
}: {
  article: Article;
  open: boolean;
  onToggle: () => void;
  articleById: Map<string, Article>;
  onOpenRelated: (id: string) => void;
}) {
  return (
    <div id={`guide-${article.id}`} className={`guide-item${open ? " guide-item-open" : ""}`}>
      <button
        className="guide-item-btn"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`guide-body-${article.id}`}
      >
        <span className="guide-item-title-wrap">
          <span className="guide-item-title">{article.title}</span>
          <span className="guide-item-summary">{article.summary}</span>
        </span>
        <span className="guide-item-right">
          {article.isBeta && <span className="guide-badge-beta">Beta</span>}
          <svg
            className={`guide-chevron${open ? " guide-chevron-open" : ""}`}
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      <div
        id={`guide-body-${article.id}`}
        className={`guide-item-body${open ? " guide-item-body-open" : ""}`}
        role="region"
      >
        <div className="guide-item-body-inner">
          <div className="guide-item-content">
            {article.appLink && (
              <Link href={article.appLink.href} className="guide-app-link">
                {article.appLink.label} â†’
              </Link>
            )}

            <nav className="guide-toc" aria-label="Sections in this article">
              <a href={`#${article.id}-what`}>What is it</a>
              <a href={`#${article.id}-why`}>Why use it</a>
              <a href={`#${article.id}-how`}>How to use it</a>
              <a href={`#${article.id}-next`}>What happens next</a>
              {article.importantNotes.length > 0 && <a href={`#${article.id}-notes`}>Important things to know</a>}
            </nav>

            <section id={`${article.id}-what`} className="guide-subsection">
              <h4>What is it?</h4>
              {article.whatIsIt.map((p, i) => <p key={i}>{p}</p>)}
            </section>

            <section id={`${article.id}-why`} className="guide-subsection">
              <h4>Why would I use it?</h4>
              {article.whyUseIt.map((p, i) => <p key={i}>{p}</p>)}
            </section>

            <section id={`${article.id}-how`} className="guide-subsection">
              <h4>How do I use it?</h4>
              <ul className="guide-steps">
                {article.howToUseIt.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </section>

            {article.whatHappensNext.length > 0 && (
              <section id={`${article.id}-next`} className="guide-subsection">
                <h4>What happens next?</h4>
                {article.whatHappensNext.map((p, i) => <p key={i}>{p}</p>)}
              </section>
            )}

            {article.importantNotes.length > 0 && (
              <section id={`${article.id}-notes`} className="guide-subsection">
                <h4>Important things to know</h4>
                {article.importantNotes.map((n, i) => <NoteBox key={i} type={n.type} text={n.text} />)}
              </section>
            )}

            {(article.relatedIds ?? []).length > 0 && (
              <div className="guide-related">
                <span className="guide-related-label">Related</span>
                {(article.relatedIds ?? []).map((id) => {
                  const rel = articleById.get(id);
                  if (!rel) return null;
                  return (
                    <button key={id} className="guide-related-chip" onClick={() => onOpenRelated(id)}>
                      {rel.title}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GuidesClient() {
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState("all");
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  const articleById = useMemo(() => new Map(ARTICLES.map((a) => [a.id, a])), []);

  const searchIndex = useMemo(
    () =>
      ARTICLES.map((article) => ({
        article,
        text: [
          article.title,
          article.summary,
          ...article.whatIsIt,
          ...article.whyUseIt,
          ...article.howToUseIt,
          ...article.whatHappensNext,
          ...article.importantNotes.map((n) => n.text),
        ]
          .join(" ")
          .toLowerCase(),
      })),
    [],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return searchIndex
      .filter(({ article, text }) => {
        if (activeCat !== "all" && article.categoryId !== activeCat) return false;
        if (!q) return true;
        return text.includes(q);
      })
      .map((x) => x.article);
  }, [search, activeCat, searchIndex]);

  const grouped = useMemo(() => {
    const map = new Map<string, Article[]>();
    for (const a of filtered) {
      const list = map.get(a.categoryId) ?? [];
      list.push(a);
      map.set(a.categoryId, list);
    }
    return CATEGORIES.map((c) => ({ category: c, articles: map.get(c.id) ?? [] })).filter((g) => g.articles.length > 0);
  }, [filtered]);

  const totalResults = filtered.length;
  const isFiltered = !!search || activeCat !== "all";

  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openArticle(id: string) {
    setOpenIds((prev) => new Set(prev).add(id));
    setActiveCat("all");
    setSearch("");
    setTimeout(() => {
      document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }

  return (
    <div className="orders-shell">
      <aside className="orders-sidebar">
        <div>
          <SidebarLogo />
          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`nav-item${item.active ? " nav-item-active" : ""}`}
              >
                <NavIcon href={item.href} />
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>
        <SidebarFooter onLogout={handleLogout} />
      </aside>

      <main className="orders-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Resources</p>
            <h2>Guides</h2>
          </div>
          <div className="topbar-actions">
            <div className="guide-search-wrap">
              <svg className="guide-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={searchRef}
                className="guide-search-input"
                type="search"
                placeholder="Search the guide..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search the user guide"
              />
            </div>
          </div>
        </header>

        <div className="guide-tabs" role="tablist" aria-label="Filter by category">
          <button role="tab" aria-selected={activeCat === "all"} className={`guide-tab${activeCat === "all" ? " guide-tab-active" : ""}`} onClick={() => setActiveCat("all")}>
            All
          </button>
          {CATEGORIES.map((c) => (
            <button key={c.id} role="tab" aria-selected={activeCat === c.id} className={`guide-tab${activeCat === c.id ? " guide-tab-active" : ""}`} onClick={() => setActiveCat(c.id)}>
              {c.emoji} {c.label}
            </button>
          ))}
        </div>

        <div className="guide-body">
          <aside className="guide-sidebar" aria-label="Guide categories">
            <p className="guide-sidebar-heading">Categories</p>
            <nav>
              <button className={`guide-sidebar-cat${activeCat === "all" ? " guide-sidebar-cat-active" : ""}`} onClick={() => setActiveCat("all")}>
                All articles
              </button>
              {CATEGORIES.map((c) => (
                <button key={c.id} className={`guide-sidebar-cat${activeCat === c.id ? " guide-sidebar-cat-active" : ""}`} onClick={() => setActiveCat(c.id)}>
                  {c.emoji} {c.label}
                </button>
              ))}
            </nav>
          </aside>

          <div className="guide-main">
            {search && (
              <p className="guide-results-count" role="status" aria-live="polite">
                {totalResults === 0 ? "No results" : `${totalResults} result${totalResults !== 1 ? "s" : ""}`} for <strong>&ldquo;{search}&rdquo;</strong>
              </p>
            )}

            {totalResults === 0 && (
              <div className="guide-empty" role="status">
                <h4>No results found</h4>
                <p>
                  Try a different search term or{" "}
                  <button className="guide-empty-reset" onClick={() => { setSearch(""); setActiveCat("all"); }}>
                    browse all articles
                  </button>
                  .
                </p>
              </div>
            )}

            {grouped.map(({ category, articles }) => (
              <section key={category.id} className="guide-section" aria-label={category.label}>
                <h2 className="guide-section-title">{category.emoji} {category.label}</h2>
                <div className="guide-items">
                  {articles.map((a) => (
                    <ArticleCard
                      key={a.id}
                      article={a}
                      open={openIds.has(a.id)}
                      onToggle={() => toggle(a.id)}
                      articleById={articleById}
                      onOpenRelated={openArticle}
                    />
                  ))}
                </div>
              </section>
            ))}

            {!isFiltered && (
              <section className="guide-help" aria-label="Still need help">
                <h3>Still need help?</h3>
                <p>Join our Discord community or reach out directly and we&apos;ll get back to you.</p>
                <div className="guide-help-btns">
                  <a href="https://discord.gg/X3AY2KDg9v" target="_blank" rel="noopener noreferrer" className="guide-discord-btn">
                    Join Discord
                  </a>
                  <a href="mailto:support@tixtracker.app" className="guide-contact-btn">Contact Support</a>
                </div>
              </section>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
