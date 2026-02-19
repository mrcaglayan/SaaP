import { useEffect, useId, useRef, useState } from "react";

export default function SidebarSection({
  title,
  icon,
  badge,
  children,
  collapsed = false,
  defaultOpen = false,
  forceOpen = false,
}) {
  const [open, setOpen] = useState(defaultOpen || forceOpen);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const closeTimerRef = useRef(null);
  const panelId = useId();

  useEffect(
    () => () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    },
    []
  );

  function clearCloseTimer() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function openFlyout() {
    if (!collapsed) return;
    clearCloseTimer();
    setFlyoutOpen(true);
  }

  function closeFlyoutSoon() {
    if (!collapsed) return;
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setFlyoutOpen(false);
      closeTimerRef.current = null;
    }, 120);
  }

  const sectionOpen = forceOpen || open;
  const showChildren = !collapsed && sectionOpen;
  const showFlyout = collapsed && flyoutOpen;

  return (
    <div
      className="relative space-y-1"
      onMouseEnter={openFlyout}
      onMouseLeave={closeFlyoutSoon}
      onFocusCapture={openFlyout}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          closeFlyoutSoon();
        }
      }}
    >
      <button
        type="button"
        aria-expanded={sectionOpen}
        aria-controls={panelId}
        aria-haspopup={collapsed ? "menu" : undefined}
        title={collapsed ? title : undefined}
        onClick={() => {
          if (!collapsed && !forceOpen) {
            setOpen((value) => !value);
          }
        }}
        className={`group flex w-full items-center gap-3 rounded-lg border-l-2 text-left text-sm font-medium transition-colors ${
          collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5"
        } ${
          sectionOpen
            ? "border-cyan-400 text-white"
            : "border-transparent text-slate-300 hover:text-white"
        }`}
      >
        <span
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
            sectionOpen
              ? "bg-cyan-400/15 text-cyan-200"
              : "bg-white/10 text-slate-200 group-hover:bg-white/20"
          }`}
        >
          {icon}
        </span>
        {!collapsed && <span className="truncate">{title}</span>}
        {!collapsed && badge && (
          <span className="rounded-full bg-amber-300/20 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-100">
            {badge}
          </span>
        )}
        {!collapsed && (
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            className={`ml-auto h-4 w-4 transition-transform ${sectionOpen ? "rotate-180" : ""}`}
          >
            <path
              d="M5 8l5 5 5-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        )}
      </button>

      <div
        id={panelId}
        className={`grid overflow-hidden transition-all duration-200 ${
          showChildren ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0 pl-11">
          <div className="grid gap-1 pt-0.5">{children}</div>
        </div>
      </div>

      {collapsed && (
        <div
          className={`absolute left-full top-0 z-50 w-56 rounded-xl border border-white/15 bg-slate-900 px-2 py-2 shadow-2xl transition duration-150 ${
            showFlyout
              ? "pointer-events-auto translate-x-0 opacity-100"
              : "pointer-events-none -translate-x-1 opacity-0"
          }`}
          role="menu"
          aria-label={title}
        >
          <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            {title}
          </p>
          <div className="grid gap-1">{children}</div>
        </div>
      )}
    </div>
  );
}
