/**
 * Independent right dock following the focused Markdown document.
 * @module components/Editor/StackMind/StackMindPane
 */
import { useCallback, useDeferredValue, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, GitBranchPlus, Scan, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useDismissOnOutsideOrEscape } from "@/hooks/useDismissOnOutsideOrEscape";
import { useDocumentStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";
import { resolveMediaSrc } from "@/services/media/resolveMediaSrc";
import { getFileName } from "@/utils/pathUtils";
import { ICON_SM } from "@/utils/iconSizes";
import { richCursorLine } from "./editorLink";
import { MAX_ZOOM, MIN_ZOOM, mountCanvas, type Layout, type MapTheme } from "./canvas";
import { buildMap, type Branch } from "./mapEdits";
import "./stackmind.css";

const layouts: Layout[] = ["right", "both", "left"];
const themes: MapTheme[] = ["auto", "light", "dark"];

function ZoomButton({ label, icon: Icon, onClick, disabled = false }: {
  label: string;
  icon: typeof ZoomIn;
  onClick: () => void;
  disabled?: boolean;
}) {
  return <button type="button" className="vm-icon-btn vm-icon-btn--sm" title={label} aria-label={label} disabled={disabled} onClick={onClick}>
    <Icon size={ICON_SM} aria-hidden="true" />
  </button>;
}

export default function StackMindPane({ tabId }: { tabId: string }) {
  const { t } = useTranslation(["editor", "common", "settings"]);
  const source = useDocumentStore((s) => s.documents[tabId]?.content ?? "");
  const readOnly = useDocumentStore((s) => s.documents[tabId]?.readOnly ?? true);
  const path = useDocumentStore((s) => s.documents[tabId]?.filePath);
  const cursor = useDocumentStore((s) => s.documents[tabId]?.cursorInfo);
  const title = path ? getFileName(path) : t("common:untitled");
  const deferred = useDeferredValue(source);
  const model = useMemo(() => {
    try { return buildMap(deferred, title); }
    catch { return null; }
  }, [deferred, title]);
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<ReturnType<typeof mountCanvas> | null>(null);
  const [failed, report] = useState(false);
  const [scale, setScale] = useState(1);
  const [layout, setLayout] = useState<Layout>("right");
  const [theme, setTheme] = useState<MapTheme>("auto");
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const appearanceRef = useRef<HTMLDivElement>(null);
  const appearanceTrigger = useRef<HTMLButtonElement>(null);
  const appearanceId = useId();
  const dismissAppearance = useCallback(() => {
    if (appearanceRef.current?.contains(document.activeElement)) appearanceTrigger.current?.focus({ preventScroll: true });
    setAppearanceOpen(false);
  }, []);
  useDismissOnOutsideOrEscape(appearanceOpen, appearanceRef, dismissAppearance);
  const newTitle = t("stackMind.newNode");
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const adapter = mountCanvas(el, tabId, newTitle, report, setScale);
    canvas.current = adapter;
    const resize = new ResizeObserver(() => adapter.resize());
    resize.observe(el);
    return () => { resize.disconnect(); adapter.destroy(); canvas.current = null; };
  }, [tabId, newTitle]);

  useLayoutEffect(() => {
    if (!model || !canvas.current) return;
    let cancelled = false;
    const urls = new Set<string>();
    function collect(b: Branch) { b.images.forEach(i => urls.add(i.url)); b.children.forEach(collect); }
    collect(model);
    const adapter = canvas.current;
    if (!urls.size) adapter.update(model, readOnly, new Map());
    else void Promise.all(Array.from(urls, async url =>
      [url, await resolveMediaSrc(url, "[StackMind]", tabId).catch(() => "")] as const,
    )).then(entries => { if (!cancelled) adapter.update(model, readOnly, new Map(entries)); });
    return () => { cancelled = true; };
  }, [model, path, readOnly, tabId, newTitle]);
  useLayoutEffect(() => {
    if (model) canvas.current?.follow(richCursorLine(tabId, model, (cursor?.sourceLine ?? 1) - 1));
  }, [cursor, model, tabId, newTitle]);
  useLayoutEffect(() => { canvas.current?.setLayout(layout); }, [layout, newTitle]);
  useLayoutEffect(() => { canvas.current?.setTheme(theme); }, [theme, newTitle]);
  return <section className="stackmind" aria-label={t("stackMind.view")}>
    <div className="stackmind__tools" role="toolbar" aria-label={t("stackMind.view")}>
      <button type="button" className="vm-icon-btn vm-icon-btn--sm" title={t("stackMind.add")}
        aria-label={t("stackMind.add")} onClick={() => canvas.current?.add()} disabled={!model || readOnly}>
        <GitBranchPlus size={ICON_SM} aria-hidden="true" />
      </button>
      <button type="button" className="vm-icon-btn vm-icon-btn--sm" title={t("common:delete")}
        aria-label={t("common:delete")} onClick={() => canvas.current?.remove()} disabled={!model || readOnly}>
        <Trash2 size={ICON_SM} aria-hidden="true" />
      </button>
      <div className="stackmind__appearance-control" ref={appearanceRef} onBlur={e => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setAppearanceOpen(false);
      }}>
        <button type="button" className="vm-btn vm-btn--compact vm-btn--plain" ref={appearanceTrigger}
          aria-expanded={appearanceOpen} aria-controls={appearanceOpen ? appearanceId : undefined}
          onClick={() => setAppearanceOpen(open => !open)}>
          {t("settings:nav.appearance")}<ChevronDown size={ICON_SM} aria-hidden="true" />
        </button>
        {appearanceOpen && <div className="stackmind__appearance" id={appearanceId}>
          <label>{t("settings:markdown.group.layout")}
            <span className="vm-select-field"><select className="vm-select" value={layout}
              onChange={e => setLayout(e.currentTarget.value as Layout)}>
              {layouts.map(v => <option key={v} value={v}>{t(`stackMind.layout.${v}`)}</option>)}
            </select></span>
          </label>
          <label>{t("settings:appearance.group.theme")}
            <span className="vm-select-field"><select className="vm-select" value={theme}
              onChange={e => setTheme(e.currentTarget.value as MapTheme)}>
              {themes.map(v => <option key={v} value={v}>{t(`stackMind.theme.${v}`)}</option>)}
            </select></span>
          </label>
        </div>}
      </div>
      <button type="button" className="vm-icon-btn vm-icon-btn--sm" title={t("common:close")}
        aria-label={t("common:close")} onClick={() => useUIStore.getState().toggleMindMap()}><X size={ICON_SM} /></button>
    </div>
    {(!model || failed) && <p role="status">{t(!model ? "preview.invalidMarkmapSyntax" : "stackMind.unavailable")}</p>}
    <div ref={host} className="stackmind__canvas" hidden={!model} />
    <div className="stackmind__zoom">
      <ZoomButton label={t("plugin.zoomOut")} icon={ZoomOut} onClick={() => canvas.current?.zoom(false)} disabled={!model || scale <= MIN_ZOOM} />
      <output>{Math.round(scale * 100)}%</output>
      <ZoomButton label={t("plugin.zoomIn")} icon={ZoomIn} onClick={() => canvas.current?.zoom(true)} disabled={!model || scale >= MAX_ZOOM} />
      <ZoomButton label={t("stackMind.fit")} icon={Scan} onClick={() => canvas.current?.fit()} disabled={!model} />
    </div>
  </section>;
}
