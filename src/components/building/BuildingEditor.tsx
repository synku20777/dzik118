// The Dwellings page's building view (a React island). Entrances stand side
// by side, each a grid of floors (top floor first) with a door carrying its
// name. Arrange mode moves dwellings by drag and drop, or by selecting a tile
// (click, Enter, Space) and then a place or the arrow keys; a taken place
// swaps. Every change saves on its own; Undo (button or Ctrl+Z) steps back.
//
// The layout is plain state (src/lib/ui/building-layout.ts edits it); what is
// on screen is rendered from it, and what is saved is it. Strings arrive
// translated from the server: the client never loads the dictionaries.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { actions } from "astro:actions";
import type { EntranceInput } from "../../domain/organizations/building";
import { ICONS, type IconName } from "../../lib/ui/icons";
import {
  addColumn,
  addEntrance,
  addFloor,
  moveDwelling,
  neighbour,
  placeOf,
  removeColumn,
  removeEntrance,
  removeFloor,
  renameEntrance,
  type Layout,
  type Target,
} from "../../lib/ui/building-layout";

export interface BuildingUnit {
  id: string;
  number: string;
  type: string;
  stage: string | null;
}

export interface BuildingLabels {
  arrange: string;
  done: string;
  undo: string;
  addEntrance: string;
  reset: string;
  resetConfirm: string;
  hint: string;
  help: string;
  saving: string;
  saved: string;
  failed: string;
  retry: string;
  discard: string;
  selected: string;
  moved: string;
  floor: string;
  empty: string;
  topBusy: string;
  columnBusy: string;
  entranceBusy: string;
  entrance: string;
  entranceName: string;
  floors: string;
  perFloor: string;
  removeTop: string;
  addFloor: string;
  removeColumn: string;
  addColumn: string;
  removeEntrance: string;
  notPlaced: string;
  legend: string;
  dwelling: string;
  building: string;
}

interface Props {
  organizationId: string;
  initial: EntranceInput[];
  saved: boolean;
  units: BuildingUnit[];
  limits: {
    entrances: number;
    floors: number;
    columns: number;
    nameLength: number;
  };
  hrefBase: string;
  resetAction?: string;
  previewReset?: EntranceInput[];
  labels: BuildingLabels;
  // Translated stage names and their icons, "NONE" for no billing case.
  stages: Record<string, { label: string; icon: IconName }>;
  // Translated names of the non-apartment types, in strip order.
  stripTypes: { type: string; label: string }[];
  legend: { stage: string; icon: IconName; label: string }[];
  canArrange?: boolean;
}

const fill = (text: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce(
    (out, [key, value]) => out.replace(`{${key}}`, String(value)),
    text
  );

function Svg({ name, size = "sm" }: { name: IconName; size?: "xs" | "sm" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="var(--icon-stroke)"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={`var(--icon-size-${size})`}
      height={`var(--icon-size-${size})`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

const reducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function BuildingEditor(props: Props) {
  const { labels, limits, units } = props;
  const canArrange = props.canArrange ?? true;
  const preview = props.previewReset !== undefined;
  const previewSaves = useRef(0);
  const [layout, setLayout] = useState<Layout>(props.initial);
  const [saved, setSaved] = useState(props.saved);
  const [arranging, setArranging] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [errorText, setErrorText] = useState("");
  const [announce, setAnnounce] = useState("");
  const [canUndo, setCanUndo] = useState(false);
  // Set once a confirmed Reset is on its way: no edit may save after it.
  const [resetting, setResetting] = useState(false);

  const layoutRef = useRef(layout);
  const history = useRef<Layout[]>([]);
  const tiles = useRef(new Map<string, HTMLElement>());
  const before = useRef(new Map<string, DOMRect>());
  const focusAfter = useRef<string | null>(null);
  const focusModeChange = useRef(false);
  const pending = useRef<Layout | null>(null);
  const inFlight = useRef(false);
  // The dwelling being dragged from this island; any other drop is ignored.
  const dragging = useRef<string | null>(null);
  const root = useRef<HTMLElement | null>(null);
  // Entrance names being typed: saved once, on blur or Enter.
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const recentTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  const unitById = useMemo(
    () => new Map(units.map((unit) => [unit.id, unit])),
    [units]
  );
  const placed = useMemo(
    () =>
      new Set(
        layout.flatMap((entrance) =>
          entrance.placements.map((placement) => placement.dwellingId)
        )
      ),
    [layout]
  );
  // Units arrive sorted by the server in the page's language; keeping that
  // order here means the browser renders exactly what the server did.
  const trayUnits = (type: string) =>
    units
      .filter((unit) => !placed.has(unit.id))
      .filter((unit) =>
        type === "APARTMENT"
          ? !props.stripTypes.some((s) => s.type === unit.type)
          : unit.type === type
      );

  // Saves run one at a time; a change made meanwhile waits and only the
  // latest layout is sent.
  const flush = useCallback(async () => {
    if (inFlight.current || !pending.current) return;
    const body = pending.current;
    pending.current = null;
    inFlight.current = true;
    setStatus("saving");
    let error: { message: string } | undefined;
    if (preview) {
      const fail = previewSaves.current++ === 0;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      if (fail) error = { message: "" };
    } else {
      const response = await actions.dwellings
        .saveLayout({ organizationId: props.organizationId, entrances: body })
        // A lost connection throws instead of returning an error.
        .catch(() => ({ error: { message: "" } }));
      error = response.error;
    }
    inFlight.current = false;
    if (error) {
      pending.current = pending.current ?? body;
      setErrorText(error.message);
      setStatus("error");
      return;
    }
    setSaved(true);
    if (pending.current) void flush();
    else setStatus("saved");
  }, [preview, props.organizationId]);

  // Moves made while a save is on its way merge into the next save: what is
  // saved is always the latest layout.
  const schedule = useCallback(
    (next: Layout) => {
      pending.current = next;
      void flush();
    },
    [flush]
  );
  const busy = status === "saving" || status === "error";

  // Record the tiles' positions before a change, so they can glide from
  // there to their new places (FLIP) once React has rendered it.
  const capture = () => {
    before.current = new Map(
      [...tiles.current].map(([id, el]) => [id, el.getBoundingClientRect()])
    );
  };
  useLayoutEffect(() => {
    const previous = before.current;
    before.current = new Map();
    if (!reducedMotion()) {
      // The design system's motion tokens, read once per change.
      const tokens = getComputedStyle(document.documentElement);
      const duration =
        parseFloat(tokens.getPropertyValue("--duration-normal")) || 180;
      const easing =
        tokens.getPropertyValue("--ease-standard").trim() || "ease";
      for (const [id, el] of tiles.current) {
        const from = previous.get(id);
        if (!from) continue;
        const to = el.getBoundingClientRect();
        const dx = from.left - to.left;
        const dy = from.top - to.top;
        if (Math.abs(dx) + Math.abs(dy) < 1) continue;
        el.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
          { duration, easing }
        );
      }
    }
    if (focusAfter.current) {
      tiles.current.get(focusAfter.current)?.focus();
      focusAfter.current = null;
    }
  }, [layout]);

  function changeMode(next: boolean) {
    focusModeChange.current = true;
    setArranging(next);
  }
  useLayoutEffect(() => {
    if (!focusModeChange.current) return;
    focusModeChange.current = false;
    const control = root.current?.querySelector<HTMLElement>(
      arranging ? ".building-entrance-name-input" : ".building-arrange-start"
    );
    (control?.getClientRects().length ? control : root.current)?.focus({
      preventScroll: true,
    });
  }, [arranging]);

  const commit = (
    next: Layout,
    options: { moved?: string[]; say?: string } = {}
  ) => {
    history.current = [...history.current.slice(-49), layoutRef.current];
    setCanUndo(true);
    capture();
    layoutRef.current = next;
    setLayout(next);
    if (options.moved?.length) {
      setRecent(options.moved);
      clearTimeout(recentTimer.current);
      recentTimer.current = setTimeout(() => setRecent([]), 700);
    }
    if (options.say) setAnnounce(options.say);
    schedule(next);
  };

  // `focus`: a keyboard move keeps focus on the moved tile (it remounts in
  // its new place). Only a move that happened asks for it.
  const move = (
    dwellingId: string,
    target: Target,
    {
      keepSelected = false,
      focus = false,
    }: { keepSelected?: boolean; focus?: boolean | string } = {}
  ) => {
    const result = moveDwelling(layoutRef.current, dwellingId, target);
    setOver(null);
    if (!result.moved.length) return;
    const unit = unitById.get(dwellingId);
    // true: the moved tile; a string: that tile (the focused one of a swap).
    if (focus) focusAfter.current = focus === true ? dwellingId : focus;
    commit(result.layout, {
      moved: result.moved,
      say: fill(labels.moved, { number: unit?.number ?? "" }),
    });
    setSelected(keepSelected ? dwellingId : null);
  };

  const undo = () => {
    const previous = history.current.pop();
    if (!previous) return;
    setCanUndo(history.current.length > 0);
    // A focused tile remounts where undo puts it: keep focus on it.
    focusAfter.current =
      (document.activeElement as HTMLElement | null)?.dataset?.dwellingId ??
      null;
    capture();
    layoutRef.current = previous;
    setLayout(previous);
    schedule(previous);
  };

  // One rename per edit, and only a real name: a blank one goes back to the
  // saved name instead of reaching Undo or the server.
  const renameFromDraft = (index: number) => {
    const draft = drafts[index];
    if (draft === undefined) return;
    const { [index]: _done, ...rest } = drafts;
    setDrafts(rest);
    const name = draft.trim();
    if (name && name !== layoutRef.current[index]?.name) {
      commit(renameEntrance(layoutRef.current, index, name));
    }
  };

  const select = (id: string | null) => {
    setSelected(id);
    const unit = id ? unitById.get(id) : null;
    if (unit) setAnnounce(fill(labels.selected, { number: unit.number }));
  };

  // Ctrl/Cmd+Z undoes, except while typing an entrance name.
  useEffect(() => {
    if (!arranging) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (
        preview &&
        (!root.current?.getClientRects().length ||
          !root.current.contains(event.target as Node))
      )
        return;
      const typing = (event.target as Element).closest?.("input");
      if (resetting) return;
      if (!typing && (event.ctrlKey || event.metaKey) && event.key === "z") {
        event.preventDefault();
        undo();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  // Unsaved work (a save in progress, waiting or failed) asks before leaving.
  // Links and forms are asked on the click or submit, before Astro's client
  // router: it skips a cancelled event, so nothing else happens. Back and
  // Forward reach only astro:before-preparation, where cancelling hands the
  // navigation to the browser (its own prompt may ask again; KNOWN_GAPS).
  // Confirming drops what was not sent, so nothing saves after leaving.
  useEffect(() => {
    if (preview) return;
    const unsaved = () =>
      inFlight.current || pending.current !== null || status === "error";
    const keep = () => {
      if (!unsaved()) return false;
      if (!confirm(labels.discard)) return true;
      pending.current = null;
      return false;
    };
    const leavesPage = (
      event: globalThis.MouseEvent,
      link: HTMLAnchorElement
    ) => {
      if (
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        (link.target && link.target !== "_self") ||
        link.hasAttribute("download")
      )
        return false;
      const url = new URL(link.href, location.href);
      return !(
        url.origin === location.origin &&
        url.pathname === location.pathname &&
        url.search === location.search &&
        url.hash !== ""
      );
    };
    const onClick = (event: globalThis.MouseEvent) => {
      const link = (event.target as Element).closest?.<HTMLAnchorElement>(
        "a[href]"
      );
      // Inside the island only arranging tiles stay on the page; after Done
      // a tile is a real link to its dwelling and is asked about too.
      if (!link || (arranging && root.current?.contains(link))) return;
      if (leavesPage(event, link) && keep()) event.preventDefault();
    };
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target as HTMLFormElement;
      if (root.current?.contains(form) || form.method === "dialog") return;
      if (keep()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const onUnload = (event: BeforeUnloadEvent) => {
      if (unsaved()) event.preventDefault();
    };
    // Only Back and Forward reach this: links and forms were asked above.
    const onNavigate = (event: Event & { navigationType?: string }) => {
      if (event.navigationType !== "traverse") return;
      if (keep()) event.preventDefault();
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    addEventListener("beforeunload", onUnload);
    document.addEventListener("astro:before-preparation", onNavigate);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      removeEventListener("beforeunload", onUnload);
      document.removeEventListener("astro:before-preparation", onNavigate);
    };
  }, [status, labels.discard, arranging, preview]);

  // Leaving the page drops what is still waiting, and stops the tint timer.
  useEffect(
    () => () => {
      pending.current = null;
      clearTimeout(recentTimer.current);
    },
    []
  );

  const targetKey = (target: Target, type?: string) =>
    target === "tray"
      ? `tray:${type}`
      : `${target.entrance}:${target.floor}:${target.slot}`;

  const tileTarget = (id: string): Target =>
    placeOf(layoutRef.current, id) ?? "tray";

  const onTileClick = (event: MouseEvent, id: string) => {
    if (!arranging) return;
    event.preventDefault();
    if (selected && selected !== id) move(selected, tileTarget(id));
    else select(selected === id ? null : id);
  };

  const onTileKey = (event: KeyboardEvent, id: string) => {
    if (!arranging) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      // A swap keeps focus on the tile that was focused (it may remount).
      if (selected && selected !== id) {
        move(selected, tileTarget(id), { focus: id });
      } else select(selected === id ? null : id);
    } else if (event.key === "Escape") {
      select(null);
    } else if (selected === id && event.key.startsWith("Arrow")) {
      const from = placeOf(layoutRef.current, id);
      const to = from && neighbour(layoutRef.current, from, event.key);
      event.preventDefault();
      if (to) move(id, to, { keepSelected: true, focus: true });
    }
  };

  const dropHandlers = (target: Target, key: string) =>
    arranging
      ? {
          onDragOver: (event: DragEvent) => {
            // Only a tile dragged from here; text or files are not drops.
            if (!dragging.current) return;
            event.preventDefault();
            if (over !== key) setOver(key);
          },
          onDragLeave: (event: DragEvent) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node))
              setOver(null);
          },
          onDrop: (event: DragEvent) => {
            const id = dragging.current;
            if (!id) return;
            event.preventDefault();
            dragging.current = null;
            move(id, target);
          },
        }
      : {};

  // An empty place or a tray takes the selected tile on click or Enter.
  const placeHandlers = (target: Target, label: string) =>
    arranging
      ? {
          role: "button",
          tabIndex: 0,
          "aria-label": label,
          onClick: (event: MouseEvent) => {
            if (event.target !== event.currentTarget || !selected) return;
            move(selected, target, { focus: true });
          },
          onKeyDown: (event: KeyboardEvent) => {
            if (event.target !== event.currentTarget || !selected) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              move(selected, target, { focus: true });
            }
          },
        }
      : {};

  // Plain render functions, not components: a component declared inside
  // render would remount every tile on each render (focus, drag and the
  // glide would all reset).
  const renderTile = (unit: BuildingUnit) => {
    const stage = props.stages[unit.stage ?? "NONE"];
    return (
      <a
        key={unit.id}
        ref={(el) => {
          if (el) tiles.current.set(unit.id, el);
          else tiles.current.delete(unit.id);
        }}
        className="building-unit"
        href={props.hrefBase + unit.id}
        draggable={arranging}
        role={arranging ? "button" : undefined}
        aria-pressed={arranging ? selected === unit.id : undefined}
        data-dwelling-id={unit.id}
        data-stage={unit.stage ?? "NONE"}
        data-recent={recent.includes(unit.id) ? "" : undefined}
        aria-label={`${labels.dwelling} ${unit.number}: ${stage.label}`}
        data-tip={`${unit.number} · ${stage.label}`}
        onClick={(event) => onTileClick(event, unit.id)}
        onKeyDown={(event) => onTileKey(event, unit.id)}
        onDragStart={(event) => {
          dragging.current = unit.id;
          event.dataTransfer.setData("text/plain", unit.number);
          event.dataTransfer.effectAllowed = "move";
          select(unit.id);
        }}
        onDragEnd={() => {
          dragging.current = null;
          setOver(null);
        }}
      >
        <span className="building-unit-number">{unit.number}</span>
        <span className="building-unit-state" aria-hidden="true">
          <Svg name={stage.icon} />
        </span>
      </a>
    );
  };

  const renderTray = (type: string, label: string) => {
    const list = trayUnits(type);
    const key = targetKey("tray", type);
    return (
      <div
        className="building-tray-units"
        data-over={over === key ? "" : undefined}
        {...dropHandlers("tray", key)}
        {...placeHandlers("tray", label)}
      >
        {list.map(renderTile)}
      </div>
    );
  };

  const stepButton = (
    label: string,
    icon: IconName,
    onClick: () => void,
    danger = false
  ) => (
    <button
      type="button"
      className={
        danger ? "icon-btn icon-btn-sm icon-btn-danger" : "icon-btn icon-btn-sm"
      }
      aria-label={label}
      onClick={onClick}
    >
      <Svg name={icon} size="xs" />
    </button>
  );

  const stripGroups = props.stripTypes.filter(({ type }) =>
    units.some((unit) => unit.type === type)
  );
  const apartmentsUnplaced = trayUnits("APARTMENT").length > 0;

  return (
    <section
      ref={root}
      inert={resetting || undefined}
      className="building"
      tabIndex={-1}
      data-arranging={arranging ? "" : undefined}
      aria-label={labels.building}
    >
      {(canArrange || busy) && (
        <div className="building-toolbar">
          {canArrange && !arranging && !saved && !busy && (
            <p className="building-hint">{labels.hint}</p>
          )}
          {/* After Done the status stays while a save is on its way or failed. */}
          {(arranging || busy) && (
            <p
              className="building-status"
              data-status={status}
              role="status"
              tabIndex={-1}
            >
              {status === "saving" && labels.saving}
              {status === "saved" && labels.saved}
              {status === "error" && (
                <>
                  {`${labels.failed} ${errorText}`.trim()}{" "}
                  <button
                    type="button"
                    className="inline-undo"
                    onClick={(event) => {
                      if (arranging)
                        event.currentTarget
                          .closest("p")
                          ?.focus({ preventScroll: true });
                      else
                        root.current
                          ?.querySelector<HTMLButtonElement>(
                            ".building-arrange-start"
                          )
                          ?.focus({ preventScroll: true });
                      pending.current = pending.current ?? layoutRef.current;
                      void flush();
                    }}
                  >
                    {labels.retry}
                  </button>
                </>
              )}
            </p>
          )}
          <div className="building-actions">
            {arranging && canArrange ? (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={undo}
                  disabled={!canUndo}
                >
                  <Svg name="arrow-back-up" />
                  {labels.undo}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    const next = addEntrance(
                      layoutRef.current,
                      `${labels.entrance} ${String.fromCharCode(65 + layoutRef.current.length)}`,
                      limits.entrances
                    );
                    if (next) commit(next);
                  }}
                >
                  <Svg name="plus" />
                  {labels.addEntrance}
                </button>
                {saved && (
                  <form
                    method={preview ? "dialog" : "POST"}
                    action={props.resetAction}
                    // A plain browser POST (not Astro's router): nothing on the
                    // page, such as a skip link, can cancel it half-way and
                    // leave the locked editor behind.
                    data-astro-reload
                    onSubmit={(event) => {
                      // Reached only once confirmed (the confirm stops a
                      // declined submit first). Drop what waits; lock edits.
                      pending.current = null;
                      if (props.previewReset) {
                        event.preventDefault();
                        history.current = [];
                        setCanUndo(false);
                        select(null);
                        setDrafts({});
                        setAnnounce("");
                        capture();
                        layoutRef.current = props.previewReset;
                        setLayout(props.previewReset);
                        setSaved(false);
                        setStatus("idle");
                        changeMode(false);
                        return;
                      }
                      setResetting(true);
                    }}
                  >
                    <input
                      type="hidden"
                      name="organizationId"
                      value={props.organizationId}
                    />
                    {/* Not while a save is on its way: it could land after the
                        reset and bring the old layout back. */}
                    <button
                      type="submit"
                      className="btn-secondary"
                      data-confirm={labels.resetConfirm}
                      disabled={busy}
                    >
                      {labels.reset}
                    </button>
                  </form>
                )}
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    select(null);
                    changeMode(false);
                  }}
                >
                  {labels.done}
                </button>
              </>
            ) : canArrange ? (
              <button
                type="button"
                className="btn-secondary building-arrange-start"
                onClick={() => changeMode(true)}
              >
                <Svg name="pencil" />
                {labels.arrange}
              </button>
            ) : null}
          </div>
        </div>
      )}
      {arranging && <p className="building-help">{labels.help}</p>}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <div className="building-scroll">
        <div className="building-facade">
          {layout.map((entrance, index) => {
            const rows = Array.from(
              { length: entrance.floors },
              (_, i) => entrance.floors - 1 - i
            );
            const at = (floor: number, slot: number) =>
              entrance.placements.find(
                (p) => p.floor === floor && p.slot === slot
              )?.dwellingId;
            return (
              <div
                className="building-entrance"
                key={index}
                style={{ ["--columns" as string]: entrance.columns }}
              >
                {arranging && (
                  <div className="building-entrance-controls">
                    <input
                      className="building-entrance-name-input"
                      value={drafts[index] ?? entrance.name}
                      maxLength={limits.nameLength}
                      aria-label={labels.entranceName}
                      onChange={(event) =>
                        setDrafts({ ...drafts, [index]: event.target.value })
                      }
                      onBlur={() => renameFromDraft(index)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") renameFromDraft(index);
                        if (event.key === "Escape") {
                          const { [index]: _dropped, ...rest } = drafts;
                          setDrafts(rest);
                        }
                      }}
                    />
                    <span className="building-stepper">
                      <span>{labels.floors}</span>
                      {stepButton(labels.removeTop, "minus", () => {
                        const next = removeFloor(layoutRef.current, index);
                        if (next) commit(next);
                        else setAnnounce(labels.topBusy);
                      })}
                      {stepButton(labels.addFloor, "plus", () => {
                        const next = addFloor(
                          layoutRef.current,
                          index,
                          limits.floors
                        );
                        if (next) commit(next);
                      })}
                    </span>
                    <span className="building-stepper">
                      <span>{labels.perFloor}</span>
                      {stepButton(labels.removeColumn, "minus", () => {
                        const next = removeColumn(layoutRef.current, index);
                        if (next) commit(next);
                        else setAnnounce(labels.columnBusy);
                      })}
                      {stepButton(labels.addColumn, "plus", () => {
                        const next = addColumn(
                          layoutRef.current,
                          index,
                          limits.columns
                        );
                        if (next) commit(next);
                      })}
                    </span>
                    {stepButton(
                      labels.removeEntrance,
                      "trash",
                      () => {
                        const next = removeEntrance(layoutRef.current, index);
                        if (next) commit(next);
                        else setAnnounce(labels.entranceBusy);
                      },
                      true
                    )}
                  </div>
                )}
                <div className="building-floors">
                  {rows.map((floor) => (
                    <div
                      className="building-floor"
                      key={floor}
                      role="list"
                      aria-label={fill(labels.floor, { floor: floor + 1 })}
                    >
                      {Array.from({ length: entrance.columns }, (_, slot) => {
                        const id = at(floor, slot);
                        const unit = id ? unitById.get(id) : undefined;
                        const target = { entrance: index, floor, slot };
                        const key = targetKey(target);
                        return (
                          <div
                            className="building-slot"
                            key={slot}
                            role={unit || arranging ? "listitem" : "none"}
                            data-over={over === key ? "" : undefined}
                            {...dropHandlers(target, key)}
                          >
                            {unit ? (
                              renderTile(unit)
                            ) : arranging ? (
                              <button
                                type="button"
                                className="building-empty-slot"
                                aria-label={fill(labels.empty, {
                                  entrance: entrance.name,
                                  floor: floor + 1,
                                  place: slot + 1,
                                })}
                                onClick={() => {
                                  if (!selected) return;
                                  move(selected, target, { focus: true });
                                }}
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div className="building-door-row">
                  <span className="building-entrance-name">
                    {entrance.name}
                  </span>
                  <span className="building-door" aria-hidden="true" />
                </div>
              </div>
            );
          })}
        </div>
        <div className="building-ground" aria-hidden="true" />
      </div>

      {props.legend.length > 0 && (
        <ul className="building-legend" aria-label={labels.legend}>
          {props.legend.map((item) => (
            <li key={item.stage}>
              <span
                className="building-legend-mark"
                data-stage={item.stage}
                aria-hidden="true"
              >
                <Svg name={item.icon} size="xs" />
              </span>
              {item.label}
            </li>
          ))}
        </ul>
      )}

      {stripGroups.length > 0 &&
        (arranging ||
          stripGroups.some(({ type }) => trayUnits(type).length > 0)) && (
          <div className="panel building-strip">
            {stripGroups
              .filter(({ type }) => arranging || trayUnits(type).length > 0)
              .map(({ type, label }) => (
                <div className="building-strip-group" key={type}>
                  <h3>{label}</h3>
                  {renderTray(type, label)}
                </div>
              ))}
          </div>
        )}
      {(arranging || apartmentsUnplaced) && (
        <div className="panel building-unplaced">
          <h3>{labels.notPlaced}</h3>
          {renderTray("APARTMENT", labels.notPlaced)}
        </div>
      )}
    </section>
  );
}
