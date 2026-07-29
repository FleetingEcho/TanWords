import React, { useState } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCenter,
  pointerWithin,
  rectIntersection,
  getFirstCollision,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useT } from "@/hooks/useT";
import { useSettingsStore, type DashboardWidgetId, type DashboardWidgetLayout } from "@/store/settingsStore";
import type { DashboardStats } from "@/hooks/useDB";
import { GripIcon } from "@/components/ui/icons";
import { QuickActionsWidget } from "./QuickActionsWidget";
import { RssWidget } from "./RssWidget";
import { LatestWordsWidget } from "./LatestWordsWidget";
import { RecentlyReadWidget } from "./RecentlyReadWidget";
import { RecentDocumentsWidget } from "./RecentDocumentsWidget";

type ColumnId = "left" | "right";

function findColumn(layout: DashboardWidgetLayout, id: string): ColumnId | undefined {
  if (layout.left.includes(id as DashboardWidgetId)) return "left";
  if (layout.right.includes(id as DashboardWidgetId)) return "right";
  if (id === "left" || id === "right") return id;
  return undefined;
}

function SortableWidget({ id, children }: { id: DashboardWidgetId; children: React.ReactNode }) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    // Translate-only: `CSS.Transform` also carries the scaleX/scaleY dnd-kit
    // computes for grid-style strategies, which distorts a plain vertical list.
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="relative group">
      {children}
      {/* A dedicated handle rather than making the whole card draggable — these
       * cards are full of buttons and links, and a card-wide drag listener
       * would fight every click on "View all" or a word/doc row. */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={t("dash.dragHandle")}
        className="absolute top-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card/90 text-muted-foreground opacity-0 shadow-sm transition-opacity cursor-grab touch-none hover:text-foreground active:cursor-grabbing group-hover:opacity-100 focus-visible:opacity-100"
      >
        <GripIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function WidgetColumn({
  id,
  items,
  renderWidget,
}: {
  id: ColumnId;
  items: DashboardWidgetId[];
  renderWidget: (widgetId: DashboardWidgetId) => React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <SortableContext id={id} items={items} strategy={verticalListSortingStrategy}>
      <div ref={setNodeRef} className="space-y-3 min-h-[40px]">
        {items.map((widgetId) => (
          <SortableWidget key={widgetId} id={widgetId}>
            {renderWidget(widgetId)}
          </SortableWidget>
        ))}
      </div>
    </SortableContext>
  );
}

/** The Dashboard's "Recents" grid, with every card freely draggable — within
 *  its column or across into the other one. Order persists per-user via
 *  settingsStore (`dashboardWidgetLayout`), the same cache-then-DB pattern
 *  used for sidebar/topbar customization elsewhere in Settings. */
export function DashboardWidgetGrid({ stats }: { stats: DashboardStats | null }) {
  const storedLayout = useSettingsStore((s) => s.dashboardWidgetLayout);
  const setDashboardWidgetLayout = useSettingsStore((s) => s.setDashboardWidgetLayout);
  // Live-drag preview only; committed to the store (and DB) once on drop so
  // dragging across containers doesn't fire a save on every pointer move.
  const [dragLayout, setDragLayout] = useState<DashboardWidgetLayout | null>(null);
  const layout = dragLayout ?? storedLayout;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Plain closestCenter can't tell a widget card apart from the (much taller)
  // column div it sits in — the column's own center is often the nearer one,
  // so `over` resolves to "left"/"right" instead of a specific card and the
  // sibling-shift preview never fires. Try pointer/rect intersection first
  // (finds every droppable — card AND column — under the cursor), and if the
  // closest hit is a column rather than a card, re-resolve within just that
  // column's cards. Adapted from dnd-kit's own multi-container recipe.
  const collisionDetection: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args);
    const intersections = pointerCollisions.length > 0 ? pointerCollisions : rectIntersection(args);
    let overId = getFirstCollision(intersections, "id");

    if (overId === "left" || overId === "right") {
      const containerItems = layout[overId];
      if (containerItems.length > 0) {
        overId =
          getFirstCollision(
            closestCenter({
              ...args,
              droppableContainers: args.droppableContainers.filter(
                (container) => containerItems.includes(container.id as DashboardWidgetId)
              ),
            }),
            "id"
          ) ?? overId;
      }
    }

    return overId != null ? [{ id: overId }] : [];
  };

  const renderWidget = (id: DashboardWidgetId): React.ReactNode => {
    switch (id) {
      case "quickActions":
        return <QuickActionsWidget />;
      case "feedUpdates":
        return <RssWidget />;
      case "latestWords":
        return <LatestWordsWidget words={stats?.recent_words} />;
      case "recentlyRead":
        return <RecentlyReadWidget />;
      case "recentDocuments":
        return <RecentDocumentsWidget docs={stats?.recent_docs} />;
    }
  };

  const handleDragStart = () => setDragLayout(storedLayout);

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    setDragLayout((prev) => {
      const base = prev ?? storedLayout;
      const activeCol = findColumn(base, String(active.id));
      const overCol = findColumn(base, String(over.id));
      if (!activeCol || !overCol || activeCol === overCol) return base;
      const activeItems = base[activeCol];
      const overItems = base[overCol];
      if (!activeItems.includes(active.id as DashboardWidgetId)) return base;
      const overIndex = overItems.indexOf(over.id as DashboardWidgetId);
      const insertAt = overIndex >= 0 ? overIndex : overItems.length;
      return {
        ...base,
        [activeCol]: activeItems.filter((wId) => wId !== active.id),
        [overCol]: [...overItems.slice(0, insertAt), active.id as DashboardWidgetId, ...overItems.slice(insertAt)],
      };
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    let finalLayout = dragLayout ?? storedLayout;
    if (over) {
      const col = findColumn(finalLayout, String(active.id));
      if (col) {
        const items = finalLayout[col];
        const oldIndex = items.indexOf(active.id as DashboardWidgetId);
        const newIndex = items.indexOf(over.id as DashboardWidgetId);
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          finalLayout = { ...finalLayout, [col]: arrayMove(items, oldIndex, newIndex) };
        }
      }
    }
    if (JSON.stringify(finalLayout) !== JSON.stringify(storedLayout)) {
      setDashboardWidgetLayout(finalLayout);
    }
    setDragLayout(null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragLayout(null)}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
        <WidgetColumn id="left" items={layout.left} renderWidget={renderWidget} />
        <WidgetColumn id="right" items={layout.right} renderWidget={renderWidget} />
      </div>
    </DndContext>
  );
}
