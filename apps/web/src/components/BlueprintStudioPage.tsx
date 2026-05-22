import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  applyNodeChanges,
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  type Connection,
  type CoordinateExtent,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type OnNodesChange,
  useReactFlow,
  useStore
} from "@xyflow/react";
import {
  ArrowUpDown,
  Bot,
  Check,
  Download,
  GitBranch,
  LayoutTemplate,
  Loader2,
  MessagesSquare,
  Network,
  Play,
  Plus,
  Repeat2,
  Search,
  Send,
  ShieldCheck,
  Square,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { isAgentBlueprintNode, type AgentRuntimeId } from "@hiveward/shared";
import type {
  AgentNodeConfig,
  ApprovalNodeConfig,
  CanvasPosition,
  CanvasSize,
  CatalogSnapshot,
  ConditionNodeConfig,
  LoopNodeConfig,
  ManagerNodeConfig,
  ManagerSlotNodeConfig,
  NoteNodeConfig,
  OpenClawConfiguredAgent,
  ParallelAgentsNodeConfig,
  SendNodeConfig,
  SummaryNodeConfig,
  BlueprintDefinition,
  BlueprintEdge,
  BlueprintNode,
  BlueprintNodeRun,
  BlueprintNodeType,
  BlueprintRunSummary,
  BlueprintRunView
} from "@hiveward/shared";
import {
  MANAGER_SLOT_DEFAULT_SIZE,
  MANAGER_SLOT_FRAME,
  MANAGER_SLOT_MIN_SIZE,
  BlueprintNodeCard,
  type BlueprintNodeCardData
} from "./BlueprintNodeCard";
import { type Messages } from "../lib/i18n";
import {
  isTerminalBlueprintRunStatus,
  readAcknowledgedTerminalRunIds,
  resolveBlueprintActivityState,
  shouldShowBlueprintWorkspaceRunState,
  writeAcknowledgedTerminalRunIds
} from "../lib/run-state";

const nodeTypes = {
  blueprintNode: BlueprintNodeCard
};

type BlueprintCanvasWorld = {
  extent: CoordinateExtent;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
};

const fallbackCanvasViewportSize: CanvasSize = { width: 1200, height: 900 };
const canvasWorldScreenScale = 9;
const nodeMenuPopoverWidth = 146;
const nodeMenuViewportMargin = 12;

const palette: Array<{ type: BlueprintNodeType; icon: typeof Plus }> = [
  { type: "agent", icon: Bot },
  { type: "manager", icon: Network },
  { type: "manager_slot", icon: Network },
  { type: "loop", icon: Repeat2 },
  { type: "condition", icon: GitBranch },
  { type: "summary", icon: MessagesSquare },
  { type: "approval", icon: ShieldCheck },
  { type: "send", icon: Send }
];

const managerInHandlePrefix = "manager-in-";
const managerOutHandlePrefix = "manager-out-";
const managerSlotInHandle = "manager-slot-in";
const managerSlotOutHandle = "manager-slot-out";
const managerSlotInnerOutHandle = "manager-slot-inner-out";
const managerSlotInnerInHandle = "manager-slot-inner-in";
const maxManagerPortCount = 8;
const blueprintStepTypes = new Set<BlueprintNodeType>([
  "agent",
  "parallel_agents",
  "manager",
  "manager_slot",
  "loop",
  "condition",
  "summary",
  "approval",
  "send"
]);
const rightButtonDragThreshold = 4;
const defaultChildNodeSize: CanvasSize = { width: 232, height: 108 };
type BlueprintSortMode = "recent" | "usage" | "created" | "nodes" | "name";

export function BlueprintStudioPage({
  blueprint,
  blueprints,
  catalog,
  configuredAgents,
  runSummaries,
  runView,
  selectedNodeId,
  selectedCompanyId,
  busy,
  busyAction,
  onSelectBlueprint,
  onCreateBlueprint,
  onRefreshWorkspace,
  onOpenBlueprintImport,
  onExportBlueprint,
  onDeleteBlueprint,
  onRunBlueprint,
  onCancelBlueprintRun,
  onSelectNode,
  onUpdateBlueprint,
  onApproveRun,
  t
}: {
  blueprint?: BlueprintDefinition;
  blueprints: BlueprintDefinition[];
  catalog?: CatalogSnapshot;
  configuredAgents?: OpenClawConfiguredAgent[];
  runSummaries: BlueprintRunSummary[];
  runView?: BlueprintRunView;
  selectedNodeId?: string;
  selectedCompanyId?: string;
  busy: boolean;
  busyAction?: string;
  onSelectBlueprint: (blueprintId: string) => void;
  onCreateBlueprint: () => void;
  onRefreshWorkspace: () => void;
  onOpenBlueprintImport: () => void;
  onExportBlueprint: (blueprintId?: string) => void;
  onDeleteBlueprint: (blueprintId: string) => void;
  onSaveBlueprint: () => void;
  onRunBlueprint: () => void;
  onCancelBlueprintRun: () => void;
  onSelectNode: (nodeId?: string) => void;
  onUpdateBlueprint: (updater: (current: BlueprintDefinition) => BlueprintDefinition) => void;
  onApproveRun: () => void;
  t: Messages;
}) {
  const [inspectedNodeId, setInspectedNodeId] = useState<string | undefined>();
  const inspectedNode = blueprint?.nodes.find((node) => node.id === inspectedNodeId);
  const [selectedCanvasNodeIds, setSelectedCanvasNodeIds] = useState<string[]>([]);
  const [localNodes, setLocalNodes] = useState<Node<BlueprintNodeCardData>[]>([]);
  const [localEdges, setLocalEdges] = useState<Edge[]>([]);
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false);
  const [nodeMenuAnchor, setNodeMenuAnchor] = useState<{ x: number; y: number; placement?: "above" }>({ x: 88, y: 252 });
  const [blueprintDrawerOpen, setBlueprintDrawerOpen] = useState(false);
  const [drawerSelectedBlueprintId, setDrawerSelectedBlueprintId] = useState<string | undefined>(blueprint?.id);
  const [blueprintSearch, setBlueprintSearch] = useState("");
  const [blueprintSortMode, setBlueprintSortMode] = useState<BlueprintSortMode>("recent");
  const [blueprintCardContextMenu, setBlueprintCardContextMenu] = useState<{ x: number; y: number; blueprintId: string }>();
  const [deleteCandidateBlueprintId, setDeleteCandidateBlueprintId] = useState<string | undefined>();
  const acknowledgedTerminalRunIdsRef = useRef<Set<string>>(new Set());
  const [acknowledgedTerminalRunIds, setAcknowledgedTerminalRunIds] = useState<Set<string>>(() => {
    const initial = readAcknowledgedTerminalRunIds(getBrowserStorage());
    acknowledgedTerminalRunIdsRef.current = initial;
    return initial;
  });
  const currentTerminalRunIdRef = useRef<string | undefined>(undefined);
  const [nodeContextMenu, setNodeContextMenu] = useState<{ open: boolean; x: number; y: number; nodeId?: string }>({
    open: false,
    x: 0,
    y: 0,
    nodeId: undefined
  });
  const [canvasViewportSize, setCanvasViewportSize] = useState(fallbackCanvasViewportSize);
  const canvasPanelRef = useRef<HTMLElement | null>(null);
  const nodeMenuRef = useRef<HTMLDivElement | null>(null);
  const nodeMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const nodeContextMenuRef = useRef<HTMLDivElement | null>(null);
  const blueprintSelectorButtonRef = useRef<HTMLButtonElement | null>(null);
  const blueprintDrawerRef = useRef<HTMLElement | null>(null);
  const blueprintCardContextMenuRef = useRef<HTMLDivElement | null>(null);
  const deleteDialogRef = useRef<HTMLDivElement | null>(null);
  const rightDragStateRef = useRef<{ x: number; y: number; moved: boolean; openedMenu: boolean } | undefined>(undefined);

  const setSelectedCanvasNodeIdsIfChanged = useCallback((nextIds: string[]) => {
    setSelectedCanvasNodeIds((current) => {
      if (current.length === nextIds.length && current.every((item, index) => item === nextIds[index])) {
        return current;
      }
      return nextIds;
    });
  }, []);

  const workspaceTerminalRunSeen = Boolean(
    runView?.run.id &&
      isTerminalBlueprintRunStatus(runView.run.status) &&
      acknowledgedTerminalRunIds.has(runView.run.id)
  );
  const workspaceRunView = shouldShowBlueprintWorkspaceRunState(runView?.run.status, workspaceTerminalRunSeen) ? runView : undefined;
  const statusByNode = useMemo(() => {
    const map = new Map<string, BlueprintNodeRun>();
    for (const nodeRun of workspaceRunView?.nodeRuns ?? []) {
      map.set(nodeRun.nodeId, nodeRun);
    }
    return map;
  }, [workspaceRunView]);

  useEffect(() => {
    setLocalNodes(buildFlowNodes(blueprint, statusByNode, t));
  }, [statusByNode, t, blueprint]);

  useEffect(() => {
    setLocalEdges(buildFlowEdges(blueprint, workspaceRunView?.run.status));
  }, [workspaceRunView?.run.status, blueprint]);

  useEffect(() => {
    setDrawerSelectedBlueprintId(blueprint?.id);
  }, [blueprint?.id]);

  const selectedDrawerBlueprint = useMemo(
    () => blueprints.find((item) => item.id === drawerSelectedBlueprintId),
    [blueprints, drawerSelectedBlueprintId]
  );
  const deleteCandidateBlueprint = useMemo(
    () => blueprints.find((item) => item.id === deleteCandidateBlueprintId),
    [blueprints, deleteCandidateBlueprintId]
  );
  const blueprintDrawerCopy = useMemo(() => {
    const english = t.navigation.blueprint === "Blueprint";
    return english
      ? {
          createAction: "New",
          importAction: "Import",
          exportAction: "Export",
          search: "Search blueprints",
          sort: "Sort",
          recent: "Recently used",
          usage: "Use count",
          created: "Newest created",
          nodes: "Node count",
          name: "A-Z",
          delete: "Delete blueprint",
          deleteTitle: "Delete blueprint?",
          deleteBody: (name: string) => `Delete "${name}"? This cannot be undone.`,
          cancel: "Cancel",
          confirmDelete: "Delete"
        }
      : {
          createAction: "新建",
          importAction: "导入",
          exportAction: "导出",
          search: "搜索蓝图",
          sort: "排序",
          recent: "最近使用",
          usage: "使用次数",
          created: "最新创建",
          nodes: "节点数量",
          name: "首字母",
          delete: "删除蓝图",
          deleteTitle: "删除蓝图？",
          deleteBody: (name: string) => `确定删除「${name}」吗？此操作无法撤销。`,
          cancel: "取消",
          confirmDelete: "删除"
        };
  }, [t.navigation.blueprint]);
  const blueprintRunStats = useMemo(() => {
    const stats = new Map<string, { lastUsedAt: number; latestRunId?: string; latestStatus?: BlueprintRunSummary["status"]; usageCount: number }>();
    for (const run of runSummaries) {
      const current = stats.get(run.blueprintId) ?? { lastUsedAt: 0, usageCount: 0 };
      const startedAt = toTimestamp(run.startedAt);
      const isLatestRun = startedAt >= current.lastUsedAt;
      stats.set(run.blueprintId, {
        lastUsedAt: Math.max(current.lastUsedAt, startedAt),
        latestRunId: isLatestRun ? run.id : current.latestRunId,
        latestStatus: isLatestRun ? run.status : current.latestStatus,
        usageCount: current.usageCount + 1
      });
    }
    return stats;
  }, [runSummaries]);
  const visibleBlueprints = useMemo(() => {
    const query = blueprintSearch.trim().toLocaleLowerCase();
    const filtered = query
      ? blueprints.filter((item) => item.name.toLocaleLowerCase().includes(query))
      : blueprints;

    return filtered.slice().sort((left, right) => {
      const leftStats = blueprintRunStats.get(left.id);
      const rightStats = blueprintRunStats.get(right.id);
      if (blueprintSortMode === "recent") {
        return compareDescending(leftStats?.lastUsedAt ?? 0, rightStats?.lastUsedAt ?? 0) || compareBlueprintNames(left, right);
      }
      if (blueprintSortMode === "usage") {
        return compareDescending(leftStats?.usageCount ?? 0, rightStats?.usageCount ?? 0) || compareBlueprintNames(left, right);
      }
      if (blueprintSortMode === "created") {
        return compareDescending(toTimestamp(left.createdAt), toTimestamp(right.createdAt)) || compareBlueprintNames(left, right);
      }
      if (blueprintSortMode === "nodes") {
        return compareDescending(left.nodes.length, right.nodes.length) || compareBlueprintNames(left, right);
      }
      return compareBlueprintNames(left, right);
    });
  }, [blueprintRunStats, blueprintSearch, blueprintSortMode, blueprints]);
  const selectedSortLabel = useMemo(() => {
    if (blueprintSortMode === "recent") return blueprintDrawerCopy.recent;
    if (blueprintSortMode === "usage") return blueprintDrawerCopy.usage;
    if (blueprintSortMode === "created") return blueprintDrawerCopy.created;
    if (blueprintSortMode === "nodes") return blueprintDrawerCopy.nodes;
    return blueprintDrawerCopy.name;
  }, [blueprintDrawerCopy, blueprintSortMode]);
  const currentBlueprintRunStats = blueprint ? blueprintRunStats.get(blueprint.id) : undefined;
  const currentTerminalRunId =
    currentBlueprintRunStats?.latestRunId && isTerminalBlueprintRunStatus(currentBlueprintRunStats.latestStatus)
      ? currentBlueprintRunStats.latestRunId
      : undefined;
  const currentTerminalRunSeen = Boolean(currentTerminalRunId && acknowledgedTerminalRunIds.has(currentTerminalRunId));
  const currentBlueprintActivity = currentBlueprintRunStats
    ? resolveBlueprintActivityState(currentBlueprintRunStats.latestStatus, currentTerminalRunSeen)
    : "idle";
  const isBlueprintInteractionLocked = currentBlueprintActivity === "running";
  const isRunButtonBusy = busyAction === "runBlueprint" || busyAction === "cancelBlueprintRun";
  const isRunButtonStopMode = isBlueprintInteractionLocked || busyAction === "cancelBlueprintRun";
  const runButtonTitle = isRunButtonStopMode ? t.actions.stopRun : t.actions.runBlueprint;
  const runButtonLabel = isRunButtonStopMode ? t.actions.stopRun : t.actions.run;
  const blueprintCanvasWorld = useMemo(() => createBlueprintCanvasWorld(canvasViewportSize), [canvasViewportSize.height, canvasViewportSize.width]);

  const rememberAcknowledgedTerminalRunId = useCallback((runId: string) => {
    if (acknowledgedTerminalRunIdsRef.current.has(runId)) return;
    const next = new Set(acknowledgedTerminalRunIdsRef.current);
    next.add(runId);
    acknowledgedTerminalRunIdsRef.current = next;
    writeAcknowledgedTerminalRunIds(getBrowserStorage(), next);
    setAcknowledgedTerminalRunIds(next);
  }, []);

  useEffect(() => {
    if (!blueprint) return;
    if (hasDuplicateNodeIds(blueprint)) {
      onUpdateBlueprint((current) => (current.id === blueprint.id ? ensureUniqueBlueprintNodeIds(current) : current));
      return;
    }
  }, [onUpdateBlueprint, blueprint]);

  useEffect(() => {
    currentTerminalRunIdRef.current = currentTerminalRunId;
  }, [currentTerminalRunId]);

  useEffect(() => {
    return () => {
      if (currentTerminalRunId) {
        rememberAcknowledgedTerminalRunId(currentTerminalRunId);
      }
    };
  }, [currentTerminalRunId, rememberAcknowledgedTerminalRunId]);

  useEffect(() => {
    const handlePageHide = () => {
      if (currentTerminalRunIdRef.current) {
        rememberAcknowledgedTerminalRunId(currentTerminalRunIdRef.current);
      }
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [rememberAcknowledgedTerminalRunId]);

  useEffect(() => {
    acknowledgedTerminalRunIdsRef.current = acknowledgedTerminalRunIds;
    writeAcknowledgedTerminalRunIds(getBrowserStorage(), acknowledgedTerminalRunIds);
  }, [acknowledgedTerminalRunIds]);

  useEffect(() => {
    if (runSummaries.length === 0) return;
    const runIds = new Set(runSummaries.map((run) => run.id));
    setAcknowledgedTerminalRunIds((current) => {
      const next = new Set([...current].filter((runId) => runIds.has(runId)));
      acknowledgedTerminalRunIdsRef.current = next;
      return next.size === current.size ? current : next;
    });
  }, [runSummaries]);

  useEffect(() => {
    const element = canvasPanelRef.current;
    if (!element) return;

    const updateCanvasViewportSize = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width <= 0 || height <= 0) return;
      setCanvasViewportSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    };

    updateCanvasViewportSize();
    const observer = new ResizeObserver(updateCanvasViewportSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const patchNodeConfig = useCallback(
    (nodeId: string, patch: Partial<BlueprintNode["config"]>) => {
      if (isBlueprintInteractionLocked) return;
      onUpdateBlueprint((current) => {
        const next = {
          ...current,
          nodes: current.nodes.map((node) =>
            node.id === nodeId
              ? {
                  ...node,
                  config: {
                    ...node.config,
                    ...patch
                  } as BlueprintNode["config"]
                }
              : node
          )
        };
        return next;
      });
    },
    [isBlueprintInteractionLocked, onUpdateBlueprint]
  );

  const patchNode = useCallback(
    (nodeId: string, patch: Partial<BlueprintNode>) => {
      if (isBlueprintInteractionLocked) return;
      onUpdateBlueprint((current) => ({
        ...current,
        nodes: current.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node))
      }));
    },
    [isBlueprintInteractionLocked, onUpdateBlueprint]
  );

  const onNodesChange: OnNodesChange<Node<BlueprintNodeCardData>> = useCallback(
    (changes) => {
      const allowedChanges = isBlueprintInteractionLocked ? changes.filter((change) => change.type === "select") : changes;
      if (allowedChanges.length === 0) return;
      setLocalNodes((current) => applyNodeChanges(allowedChanges, current));
      if (isBlueprintInteractionLocked) return;
      const positionChanges = collectBlueprintNodePositionChanges(changes);
      const sizeChanges = collectManagerSlotSizeChanges(changes);
      if (positionChanges.size === 0 && sizeChanges.size === 0) return;
      onUpdateBlueprint((current) => {
        const blueprintWithPositions = updateBlueprintNodePositions(current, positionChanges);
        return resizeManagerSlotNodes(blueprintWithPositions, sizeChanges);
      });
    },
    [isBlueprintInteractionLocked, onUpdateBlueprint]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (isBlueprintInteractionLocked) return;
      if (!connection.source || !connection.target) return;
      onUpdateBlueprint((current) => {
        return connectBlueprintNodes(current, connection, t);
      });
    },
    [isBlueprintInteractionLocked, onUpdateBlueprint, t]
  );

  const addNode = useCallback(
    (type: BlueprintNodeType) => {
      if (isBlueprintInteractionLocked) return;
      onUpdateBlueprint((current) => {
        const blueprintWithUniqueIds = ensureUniqueBlueprintNodeIds(current);
        const selectedSlot =
          selectedNodeId ? blueprintWithUniqueIds.nodes.find((node) => node.id === selectedNodeId && node.type === "manager_slot") : undefined;
        if (type === "manager_slot") {
          return addManagerSlotFromMenu(blueprintWithUniqueIds, selectedNodeId, t);
        }
        const shouldNest = Boolean(selectedSlot && type !== "manager");
        const id = nextBlueprintNodeId(blueprintWithUniqueIds, type, shouldNest ? selectedSlot?.id : undefined);
        const node: BlueprintNode = {
          id,
          type,
          runtimeId: type === "agent" || type === "manager" ? "openclaw" : undefined,
          parentId: shouldNest ? selectedSlot?.id : undefined,
          position: shouldNest
            ? managerSlotChildInitialPosition(selectedSlot!, blueprintWithUniqueIds.nodes.filter((candidate) => candidate.parentId === selectedSlot!.id).length)
            : { x: 180 + blueprintWithUniqueIds.nodes.length * 42, y: 188 + blueprintWithUniqueIds.nodes.length * 22 },
          config: defaultConfig(type, t)
        };
        const next = {
          ...blueprintWithUniqueIds,
          nodes: [...blueprintWithUniqueIds.nodes, node]
        };
        return next;
      });
      setNodeMenuOpen(false);
    },
    [isBlueprintInteractionLocked, onUpdateBlueprint, selectedNodeId, t]
  );

  const openNodeMenuAt = useCallback(
    (x: number, y: number, placement?: "above") => {
      if (isBlueprintInteractionLocked) return;
      setNodeMenuAnchor({ x, y, placement });
      setNodeContextMenu((current) => (current.open ? { ...current, open: false } : current));
      setNodeMenuOpen(true);
    },
    [isBlueprintInteractionLocked]
  );

  const closeNodeMenu = useCallback(() => {
    setNodeMenuOpen(false);
  }, []);

  const closeNodeContextMenu = useCallback(() => {
    setNodeContextMenu({ open: false, x: 0, y: 0, nodeId: undefined });
  }, []);

  const clearCanvasSelection = useCallback(() => {
    setSelectedCanvasNodeIdsIfChanged([]);
    onSelectNode(undefined);
  }, [onSelectNode, setSelectedCanvasNodeIdsIfChanged]);

  useEffect(() => {
    const hasFloatingUi =
      nodeMenuOpen ||
      nodeContextMenu.open ||
      blueprintDrawerOpen ||
      Boolean(blueprintCardContextMenu) ||
      Boolean(deleteCandidateBlueprintId) ||
      Boolean(selectedNodeId) ||
      selectedCanvasNodeIds.length > 0;
    if (!hasFloatingUi) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const isInsideNodeMenu = Boolean(nodeMenuRef.current?.contains(target));
      const isInsideNodeMenuButton = Boolean(nodeMenuButtonRef.current?.contains(target));
      if (nodeMenuOpen && !isInsideNodeMenu && !isInsideNodeMenuButton) {
        closeNodeMenu();
      }

      const isInsideNodeContextMenu = Boolean(nodeContextMenuRef.current?.contains(target));
      if (nodeContextMenu.open && !isInsideNodeContextMenu) {
        closeNodeContextMenu();
      }

      const isInsideBlueprintDrawer = Boolean(blueprintDrawerRef.current?.contains(target));
      const isInsideBlueprintSelectorButton = Boolean(blueprintSelectorButtonRef.current?.contains(target));
      const isInsideBlueprintCardContextMenu = Boolean(blueprintCardContextMenuRef.current?.contains(target));
      const isInsideDeleteDialog = Boolean(deleteDialogRef.current?.contains(target));
      if (
        blueprintDrawerOpen &&
        !isInsideBlueprintDrawer &&
        !isInsideBlueprintSelectorButton &&
        !isInsideBlueprintCardContextMenu &&
        !isInsideDeleteDialog
      ) {
        setBlueprintDrawerOpen(false);
        setBlueprintCardContextMenu(undefined);
      }
      if (blueprintCardContextMenu && !isInsideBlueprintCardContextMenu) {
        setBlueprintCardContextMenu(undefined);
      }
      if (deleteCandidateBlueprintId && !isInsideDeleteDialog) {
        setDeleteCandidateBlueprintId(undefined);
      }

      if (
        (selectedNodeId || selectedCanvasNodeIds.length > 0) &&
        !target.closest(".react-flow__node") &&
        !target.closest(".node-modal") &&
        !target.closest(".node-menu-popover") &&
        !target.closest(".node-context-menu")
      ) {
        clearCanvasSelection();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [
    blueprintCardContextMenu,
    blueprintDrawerOpen,
    clearCanvasSelection,
    closeNodeContextMenu,
    closeNodeMenu,
    deleteCandidateBlueprintId,
    nodeContextMenu.open,
    nodeMenuOpen,
    selectedCanvasNodeIds.length,
    selectedNodeId
  ]);

  useEffect(() => {
    if (!isBlueprintInteractionLocked) return;
    setInspectedNodeId(undefined);
    closeNodeMenu();
    closeNodeContextMenu();
    rightDragStateRef.current = undefined;
  }, [closeNodeContextMenu, closeNodeMenu, isBlueprintInteractionLocked]);

  const openDockNodeMenu = useCallback(
    (button: HTMLButtonElement) => {
      if (nodeMenuOpen) {
        closeNodeMenu();
        return;
      }
      const rect = button.getBoundingClientRect();
      const dockRect = button.closest(".blueprint-action-dock")?.getBoundingClientRect();
      const x = Math.max(nodeMenuViewportMargin, Math.min(rect.left, window.innerWidth - nodeMenuPopoverWidth - nodeMenuViewportMargin));
      openNodeMenuAt(x, (dockRect?.top ?? rect.top) - 8, "above");
    },
    [closeNodeMenu, nodeMenuOpen, openNodeMenuAt]
  );

  const toggleBlueprintDrawer = useCallback(() => {
    if (blueprintDrawerOpen) {
      setBlueprintDrawerOpen(false);
      setBlueprintCardContextMenu(undefined);
      return;
    }
    setDrawerSelectedBlueprintId(blueprint?.id ?? blueprints[0]?.id);
    setBlueprintDrawerOpen(true);
    setBlueprintCardContextMenu(undefined);
    closeNodeMenu();
    closeNodeContextMenu();
    void onRefreshWorkspace();
  }, [blueprint?.id, blueprintDrawerOpen, blueprints, closeNodeContextMenu, closeNodeMenu, onRefreshWorkspace]);

  const selectBlueprintCard = useCallback(
    (blueprintId: string) => {
      setDrawerSelectedBlueprintId(blueprintId);
      setBlueprintCardContextMenu(undefined);
      onSelectBlueprint(blueprintId);
      closeNodeMenu();
      closeNodeContextMenu();
    },
    [closeNodeContextMenu, closeNodeMenu, onSelectBlueprint]
  );

  const openBlueprintCardContextMenu = useCallback(
    (event: MouseEvent<HTMLButtonElement>, blueprintId: string) => {
      event.preventDefault();
      event.stopPropagation();
      setDrawerSelectedBlueprintId(blueprintId);
      setBlueprintCardContextMenu({ x: event.clientX + 4, y: event.clientY + 4, blueprintId });
      closeNodeMenu();
      closeNodeContextMenu();
    },
    [closeNodeContextMenu, closeNodeMenu]
  );

  const exportSelectedBlueprint = useCallback(() => {
    if (!selectedDrawerBlueprint) return;
    setBlueprintCardContextMenu(undefined);
    onExportBlueprint(selectedDrawerBlueprint.id);
  }, [onExportBlueprint, selectedDrawerBlueprint]);

  const confirmDeleteBlueprint = useCallback(() => {
    if (!deleteCandidateBlueprint) return;
    onDeleteBlueprint(deleteCandidateBlueprint.id);
    setDeleteCandidateBlueprintId(undefined);
    setBlueprintCardContextMenu(undefined);
    if (drawerSelectedBlueprintId === deleteCandidateBlueprint.id) {
      setDrawerSelectedBlueprintId(undefined);
    }
  }, [deleteCandidateBlueprint, drawerSelectedBlueprintId, onDeleteBlueprint]);

  const deleteNodeById = useCallback(
    (nodeId: string) => {
      if (isBlueprintInteractionLocked) return;
      onUpdateBlueprint((current) => {
        const deleteIds = collectDeletedNodeIds(current, new Set([nodeId]));
        return {
          ...current,
          nodes: current.nodes.filter((node) => !deleteIds.has(node.id)),
          edges: current.edges.filter((edge) => !deleteIds.has(edge.source) && !deleteIds.has(edge.target))
        };
      });
      setLocalNodes((current) => {
        const deleteIds = new Set([nodeId]);
        return current.filter((node) => !deleteIds.has(node.id) && node.parentId !== nodeId);
      });
      setLocalEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
      if (selectedNodeId === nodeId) onSelectNode(undefined);
      if (inspectedNodeId === nodeId) setInspectedNodeId(undefined);
      setSelectedCanvasNodeIdsIfChanged([]);
      closeNodeContextMenu();
    },
    [closeNodeContextMenu, inspectedNodeId, isBlueprintInteractionLocked, onSelectNode, onUpdateBlueprint, selectedNodeId, setSelectedCanvasNodeIdsIfChanged]
  );

  const toggleNodeDisabled = useCallback(
    (nodeId: string) => {
      if (isBlueprintInteractionLocked) return;
      onUpdateBlueprint((current) => ({
        ...current,
        nodes: current.nodes.map((node) => (node.id === nodeId ? { ...node, disabled: !node.disabled } : node))
      }));
      closeNodeContextMenu();
    },
    [closeNodeContextMenu, isBlueprintInteractionLocked, onUpdateBlueprint]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (isBlueprintInteractionLocked) return;
      if (selectedCanvasNodeIds.length === 0) return;

      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      const selectedSet = new Set(selectedCanvasNodeIds);

      onUpdateBlueprint((current) => {
        const deleteIds = collectDeletedNodeIds(current, selectedSet);
        return {
          ...current,
          nodes: current.nodes.filter((node) => !deleteIds.has(node.id)),
          edges: current.edges.filter((edge) => !deleteIds.has(edge.source) && !deleteIds.has(edge.target))
        };
      });

      if (selectedNodeId && selectedSet.has(selectedNodeId)) {
        onSelectNode(undefined);
      }
      if (inspectedNodeId && selectedSet.has(inspectedNodeId)) {
        setInspectedNodeId(undefined);
      }

      setSelectedCanvasNodeIdsIfChanged([]);
      closeNodeContextMenu();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    closeNodeContextMenu,
    inspectedNodeId,
    isBlueprintInteractionLocked,
    onSelectNode,
    onUpdateBlueprint,
    selectedCanvasNodeIds,
    selectedNodeId,
    setSelectedCanvasNodeIdsIfChanged
  ]);

  const onNodeClick: NodeMouseHandler<Node<BlueprintNodeCardData>> = useCallback(
    (event, node) => {
      closeNodeMenu();
      closeNodeContextMenu();
      if (node.data.type === "manager_slot" && isManagerSlotInnerFrameContext(event)) {
        if (selectedNodeId !== node.id) {
          setSelectedCanvasNodeIdsIfChanged([node.id]);
          onSelectNode(node.id);
        }
        setInspectedNodeId(undefined);
        return;
      }
      if (selectedNodeId === node.id) {
        if (isBlueprintInteractionLocked) return;
        setInspectedNodeId(node.id);
        return;
      }
      setSelectedCanvasNodeIdsIfChanged([node.id]);
      onSelectNode(node.id);
      setInspectedNodeId(undefined);
    },
    [closeNodeContextMenu, closeNodeMenu, isBlueprintInteractionLocked, onSelectNode, selectedNodeId, setSelectedCanvasNodeIdsIfChanged]
  );

  const onNodeContextMenu: NodeMouseHandler<Node<BlueprintNodeCardData>> = useCallback(
    (event, node) => {
      event.preventDefault();
      event.stopPropagation();
      rightDragStateRef.current = undefined;
      const { x, y } = getMenuPoint(event);
      setSelectedCanvasNodeIdsIfChanged([node.id]);
      onSelectNode(node.id);
      setInspectedNodeId(undefined);
      if (isBlueprintInteractionLocked) {
        closeNodeContextMenu();
        closeNodeMenu();
        return;
      }
      if (node.data.type === "manager_slot" && isManagerSlotInnerFrameContext(event)) {
        closeNodeContextMenu();
        openNodeMenuAt(x, y);
        return;
      }
      closeNodeMenu();
      setNodeContextMenu({
        open: true,
        x,
        y,
        nodeId: node.id
      });
    },
    [closeNodeContextMenu, closeNodeMenu, isBlueprintInteractionLocked, onSelectNode, openNodeMenuAt, setSelectedCanvasNodeIdsIfChanged]
  );

  const onEdgeClick: EdgeMouseHandler<Edge> = useCallback(
    (event, edge) => {
      if (isBlueprintInteractionLocked) return;
      if (!event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      setLocalEdges((current) => current.filter((item) => item.id !== edge.id));
      onUpdateBlueprint((current) => ({
        ...current,
        edges: current.edges.filter((item) => item.id !== edge.id)
      }));
    },
    [isBlueprintInteractionLocked, onUpdateBlueprint]
  );

  return (
    <ReactFlowProvider>
      <section className="blueprint-shell compact-blueprint-shell">
        <section
          ref={canvasPanelRef}
          className={`blueprint-canvas-panel expanded-blueprint-panel blueprint-canvas-state-${currentBlueprintActivity}`}
          onPointerDownCapture={(event) => {
            if (isBlueprintInteractionLocked) return;
            if (event.button !== 2) return;
            rightDragStateRef.current = {
              x: event.clientX,
              y: event.clientY,
              moved: false,
              openedMenu: false
            };
          }}
          onPointerMoveCapture={(event) => {
            if (isBlueprintInteractionLocked) return;
            const state = rightDragStateRef.current;
            if (!state || (event.buttons & 2) !== 2) return;
            if (Math.hypot(event.clientX - state.x, event.clientY - state.y) > rightButtonDragThreshold) {
              state.moved = true;
            }
          }}
          onPointerUpCapture={(event) => {
            if (isBlueprintInteractionLocked) return;
            if (event.button !== 2) return;
            const state = rightDragStateRef.current;
            if (!state || state.moved || state.openedMenu || !isPaneAddMenuTarget(event.target)) return;
            state.openedMenu = true;
            const { x, y } = getMenuPoint(event);
            closeNodeContextMenu();
            setInspectedNodeId(undefined);
            openNodeMenuAt(x, y);
          }}
          onContextMenuCapture={(event) => {
            event.preventDefault();
            if (isBlueprintInteractionLocked) {
              event.stopPropagation();
              rightDragStateRef.current = undefined;
              closeNodeContextMenu();
              closeNodeMenu();
              setInspectedNodeId(undefined);
              return;
            }
            if (rightDragStateRef.current?.moved) {
              event.stopPropagation();
              rightDragStateRef.current = undefined;
              closeNodeContextMenu();
              closeNodeMenu();
              setInspectedNodeId(undefined);
            }
          }}
        >
          <ReactFlow
            key={blueprint?.id ?? "empty-blueprint"}
            nodes={localNodes}
            edges={localEdges}
            nodeTypes={nodeTypes}
            defaultViewport={blueprint?.display.viewport ?? { x: 0, y: 0, zoom: 1 }}
            translateExtent={blueprintCanvasWorld.extent}
            nodeExtent={blueprintCanvasWorld.extent}
            onNodeClick={onNodeClick}
            onNodeContextMenu={onNodeContextMenu}
            onEdgeClick={onEdgeClick}
            onPaneClick={() => {
              setSelectedCanvasNodeIdsIfChanged([]);
              onSelectNode(undefined);
              closeNodeMenu();
              closeNodeContextMenu();
              setInspectedNodeId(undefined);
            }}
            onPaneContextMenu={(event) => {
              event.preventDefault();
              const rightDragState = rightDragStateRef.current;
              rightDragStateRef.current = undefined;
              if (isBlueprintInteractionLocked) {
                closeNodeContextMenu();
                closeNodeMenu();
                setInspectedNodeId(undefined);
                return;
              }
              if (rightDragState?.moved) {
                closeNodeContextMenu();
                closeNodeMenu();
                setInspectedNodeId(undefined);
                return;
              }
              const { x, y } = getMenuPoint(event);
              closeNodeContextMenu();
              setInspectedNodeId(undefined);
              openNodeMenuAt(x, y);
            }}
            onSelectionChange={({ nodes }) => setSelectedCanvasNodeIdsIfChanged(nodes.map((node) => node.id))}
            onNodesChange={onNodesChange}
            onConnect={onConnect}
            nodesDraggable={!isBlueprintInteractionLocked}
            nodesConnectable={!isBlueprintInteractionLocked}
            selectionOnDrag
            selectionMode={SelectionMode.Partial}
            panOnDrag={[1, 2]}
            deleteKeyCode={null}
            minZoom={0.35}
            maxZoom={1.5}
          >
            <Background gap={24} size={2} />
            <BlueprintCanvasMiniMap canvasWorld={blueprintCanvasWorld} nodes={localNodes} />
            <Controls position="top-right" />
          </ReactFlow>

          <div className="blueprint-action-dock" aria-label={t.navigation.blueprint}>
            <button
              className="primary-action blueprint-run-button"
              type="button"
              title={runButtonTitle}
              onClick={isRunButtonStopMode ? onCancelBlueprintRun : onRunBlueprint}
              disabled={!blueprint || busy}
            >
              {isRunButtonBusy ? <Loader2 className="spin" size={16} /> : isRunButtonStopMode ? <Square size={16} /> : <Play size={16} />}
              {runButtonLabel}
            </button>
            <button
              ref={nodeMenuButtonRef}
              type="button"
              className="blueprint-dock-add"
              title={t.actions.add}
              onClick={(event) => openDockNodeMenu(event.currentTarget)}
              disabled={!blueprint || busy || isBlueprintInteractionLocked}
            >
              <Plus size={18} />
            </button>
            <button
              ref={blueprintSelectorButtonRef}
              type="button"
              className="blueprint-selector-button"
              title={t.fields.blueprint}
              onClick={toggleBlueprintDrawer}
              disabled={busy || blueprints.length === 0}
            >
              <LayoutTemplate size={16} />
              <span>{blueprint?.name ?? t.empty.selectBlueprint}</span>
            </button>
          </div>

          {blueprintDrawerOpen && (
            <aside ref={blueprintDrawerRef} className="blueprint-side-panel" aria-label={t.navigation.blueprint}>
              <div className="blueprint-side-panel-header">
                <div className="blueprint-side-panel-title">
                  <strong>{t.navigation.blueprint}</strong>
                </div>
                <div className="blueprint-side-panel-actions">
                  <button type="button" title={t.actions.createBlueprint} onClick={onCreateBlueprint} disabled={!selectedCompanyId || busy}>
                    {busyAction === "createBlueprint" ? <Loader2 className="spin" size={14} /> : <Plus size={14} />}
                    <span>{blueprintDrawerCopy.createAction}</span>
                  </button>
                  <button type="button" title={t.actions.importBlueprint} onClick={onOpenBlueprintImport} disabled={!selectedCompanyId || busy}>
                    {busyAction === "importBlueprint" ? <Loader2 className="spin" size={14} /> : <Upload size={14} />}
                    <span>{blueprintDrawerCopy.importAction}</span>
                  </button>
                  <button
                    type="button"
                    title={t.actions.exportBlueprint}
                    onClick={exportSelectedBlueprint}
                    disabled={!selectedDrawerBlueprint || busy}
                  >
                    {busyAction === "exportBlueprint" ? <Loader2 className="spin" size={14} /> : <Download size={14} />}
                    <span>{blueprintDrawerCopy.exportAction}</span>
                  </button>
                </div>
              </div>
              <div className="blueprint-side-panel-tools">
                <label className="blueprint-search-field">
                  <Search size={14} />
                  <input
                    type="search"
                    value={blueprintSearch}
                    onChange={(event) => setBlueprintSearch(event.target.value)}
                    placeholder={blueprintDrawerCopy.search}
                  />
                </label>
                <label className="blueprint-sort-button" title={`${blueprintDrawerCopy.sort}: ${selectedSortLabel}`}>
                  <ArrowUpDown size={15} />
                  <select
                    aria-label={blueprintDrawerCopy.sort}
                    value={blueprintSortMode}
                    onChange={(event) => setBlueprintSortMode(event.target.value as BlueprintSortMode)}
                  >
                    <option value="recent">{blueprintDrawerCopy.recent}</option>
                    <option value="usage">{blueprintDrawerCopy.usage}</option>
                    <option value="created">{blueprintDrawerCopy.created}</option>
                    <option value="nodes">{blueprintDrawerCopy.nodes}</option>
                    <option value="name">{blueprintDrawerCopy.name}</option>
                  </select>
                </label>
              </div>
              <div className="blueprint-card-list">
                {visibleBlueprints.length === 0 ? (
                  <div className="empty-state compact-empty-state">{t.empty.selectBlueprint}</div>
                ) : (
                  visibleBlueprints.map((item) => {
                    const selected = item.id === drawerSelectedBlueprintId;
                    const stats = blueprintRunStats.get(item.id);
                    const terminalStatusSeen = stats?.latestRunId ? acknowledgedTerminalRunIds.has(stats.latestRunId) : false;
                    const activity = resolveBlueprintActivityState(stats?.latestStatus, terminalStatusSeen);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`blueprint-card-button blueprint-run-state-${activity}${selected ? " selected" : ""}`}
                        onClick={() => selectBlueprintCard(item.id)}
                        onContextMenu={(event) => openBlueprintCardContextMenu(event, item.id)}
                      >
                        <span className="blueprint-card-icon">
                          <LayoutTemplate size={17} />
                        </span>
                        <strong>{item.name}</strong>
                        {selected && <Check className="blueprint-card-check" size={14} />}
                      </button>
                    );
                  })
                )}
              </div>
            </aside>
          )}

          {blueprintCardContextMenu && (
            <div
              ref={blueprintCardContextMenuRef}
              className="blueprint-card-context-menu"
              style={{
                left: blueprintCardContextMenu.x,
                top: blueprintCardContextMenu.y
              }}
            >
              <button
                type="button"
                className="node-context-item danger"
                onClick={() => {
                  setDeleteCandidateBlueprintId(blueprintCardContextMenu.blueprintId);
                  setBlueprintCardContextMenu(undefined);
                }}
              >
                <Trash2 size={14} />
                {blueprintDrawerCopy.delete}
              </button>
            </div>
          )}

          {deleteCandidateBlueprint && (
            <div
              className="blueprint-delete-backdrop"
              role="dialog"
              aria-modal="true"
              aria-labelledby="blueprint-delete-title"
              onClick={() => setDeleteCandidateBlueprintId(undefined)}
            >
              <div ref={deleteDialogRef} className="blueprint-delete-dialog" onClick={(event) => event.stopPropagation()}>
                <div className="blueprint-delete-icon">
                  <Trash2 size={18} />
                </div>
                <div className="blueprint-delete-copy">
                  <strong id="blueprint-delete-title">{blueprintDrawerCopy.deleteTitle}</strong>
                  <p>{blueprintDrawerCopy.deleteBody(deleteCandidateBlueprint.name)}</p>
                </div>
                <div className="blueprint-delete-actions">
                  <button type="button" onClick={() => setDeleteCandidateBlueprintId(undefined)} disabled={busy}>
                    {blueprintDrawerCopy.cancel}
                  </button>
                  <button type="button" className="danger-action" onClick={confirmDeleteBlueprint} disabled={busy}>
                    {busyAction === "deleteBlueprint" ? <Loader2 className="spin" size={14} /> : <Trash2 size={14} />}
                    {blueprintDrawerCopy.confirmDelete}
                  </button>
                </div>
              </div>
            </div>
          )}

          {nodeMenuOpen && blueprint && (
            <div
              ref={nodeMenuRef}
              className="node-menu-popover"
              style={{
                left: nodeMenuAnchor.x,
                top: nodeMenuAnchor.y,
                transform: nodeMenuAnchor.placement === "above" ? "translateY(-100%)" : undefined
              }}
            >
              <div className="node-menu-title">{t.panels.nodes}</div>
              <div className="node-menu-list">
                {palette.map((item) => {
                  const Icon = item.icon;
                  const label = t.nodeTypes[item.type];
                  return (
                    <button
                      key={item.type}
                      type="button"
                      className="node-menu-item"
                      title={`${t.actions.add} ${label}`}
                      onClick={() => addNode(item.type)}
                      disabled={busy}
                    >
                      <Icon size={15} />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {nodeContextMenu.open && nodeContextMenu.nodeId && (
            <div
              ref={nodeContextMenuRef}
              className="node-context-menu"
              style={{
                left: nodeContextMenu.x,
                top: nodeContextMenu.y
              }}
            >
              <button type="button" className="node-context-item" onClick={() => toggleNodeDisabled(nodeContextMenu.nodeId!)}>
                {blueprint?.nodes.find((node) => node.id === nodeContextMenu.nodeId)?.disabled ? t.actions.enableNode : t.actions.disableNode}
              </button>
              <button type="button" className="node-context-item danger" onClick={() => deleteNodeById(nodeContextMenu.nodeId!)}>
                {t.actions.deleteNode}
              </button>
            </div>
          )}
        </section>

        {inspectedNode && blueprint && !isBlueprintInteractionLocked && (
          <NodeDetailModal
            catalog={catalog}
            configuredAgents={configuredAgents}
            node={inspectedNode}
            t={t}
            onClose={() => setInspectedNodeId(undefined)}
            onPatchNode={(patch) => patchNode(inspectedNode.id, patch)}
            onPatchConfig={(patch) => patchNodeConfig(inspectedNode.id, patch)}
          />
        )}
      </section>
    </ReactFlowProvider>
  );
}

function NodeDetailModal({
  catalog,
  configuredAgents,
  node,
  t,
  onClose,
  onPatchNode,
  onPatchConfig
}: {
  catalog?: CatalogSnapshot;
  configuredAgents?: OpenClawConfiguredAgent[];
  node: BlueprintNode;
  t: Messages;
  onClose: () => void;
  onPatchNode: (patch: Partial<BlueprintNode>) => void;
  onPatchConfig: (patch: Partial<BlueprintNode["config"]>) => void;
}) {
  const models = catalog?.models ?? [];
  const channels = catalog?.channels ?? [];

  return (
    <div className="node-modal-backdrop" onClick={onClose}>
      <section className="node-modal" onClick={(event) => event.stopPropagation()}>
        <header className="node-modal-header">
          <div>
            <span className="hero-eyebrow modal-eyebrow">{t.nodeTypes[node.type]}</span>
            <h3>{node.config.label}</h3>
          </div>
          <button type="button" className="icon-button node-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="node-modal-grid">
          <div className="node-modal-main">
            <div className="node-modal-section">
              <h4>{t.fields.settings}</h4>
              <NodeConfigForm
                catalog={catalog}
                node={node}
                configuredAgents={configuredAgents}
                models={models}
                channels={channels}
                onPatchNode={onPatchNode}
                onPatchConfig={onPatchConfig}
                t={t}
              />
            </div>
            {isAgentBlueprintNode(node) && node.runtimeId === "openclaw" && (
              <AgentSkillPanel
                node={node}
                skills={catalog?.tools ?? []}
                t={t}
                onPatchConfig={onPatchConfig}
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function NodeConfigForm({
  node,
  configuredAgents,
  models,
  channels,
  onPatchNode,
  onPatchConfig,
  t
}: {
  catalog?: CatalogSnapshot;
  node: BlueprintNode;
  configuredAgents?: OpenClawConfiguredAgent[];
  models: NonNullable<CatalogSnapshot["models"]>;
  channels: NonNullable<CatalogSnapshot["channels"]>;
  onPatchNode: (patch: Partial<BlueprintNode>) => void;
  onPatchConfig: (patch: Partial<BlueprintNode["config"]>) => void;
  t: Messages;
}) {
  const agentOutputSchema = isAgentBlueprintNode(node) ? node.config.outputSchema : undefined;
  const [schemaText, setSchemaText] = useState("");

  useEffect(() => {
    setSchemaText(formatOutputSchema(agentOutputSchema));
  }, [agentOutputSchema, node.id, node.type]);

  if (isAgentBlueprintNode(node)) {
    const config = node.config;
    const runtimeId = node.runtimeId;
    const isSdkProvider = runtimeId === "claude" || runtimeId === "codex";
    const selectedModel = config.modelId ?? "";
    const hasSelectedModel = selectedModel ? models.some((model) => model.id === selectedModel) : true;
    const agentOptions = configuredAgents ?? [];
    const selectedAgentId = config.openclawAgentId ?? agentOptions[0]?.id ?? "main";
    const hasSelectedAgent = agentOptions.some((agent) => agent.id === selectedAgentId);

    return (
      <div className="node-agent-config">
        <div className="config-form node-modal-form node-agent-primary-form">
          <label>
            <span>Runtime</span>
            <select value={runtimeId} onChange={(event) => onPatchNode({ runtimeId: event.target.value as AgentRuntimeId })}>
              <option value="openclaw">OpenClaw</option>
              <option value="codex">Codex</option>
              <option value="claude">Claude Code</option>
            </select>
          </label>
          <label>
            <span>{t.fields.title}</span>
            <input value={config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
          </label>
          <label className="field-span-full">
            <span>{t.fields.prompt}</span>
            <textarea rows={10} value={config.prompt} onChange={(event) => onPatchConfig({ prompt: event.target.value })} />
          </label>
        </div>
        <details className="node-advanced-settings">
          <summary>
            <span>{t.fields.advancedSettings}</span>
            <small>{t.fields.advancedSettingsHint}</small>
          </summary>
          <div className="config-form node-modal-form node-agent-advanced-form">
            {!isSdkProvider && (
              <label>
                <span>{t.fields.openclawAgent}</span>
                <select
                  value={selectedAgentId}
                  onChange={(event) => onPatchConfig({ openclawAgentId: event.target.value })}
                >
                  {!hasSelectedAgent && <option value={selectedAgentId}>{selectedAgentId}</option>}
                  {agentOptions.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name ? `${agent.name} (${agent.id})` : agent.id}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <span>{t.fields.model}</span>
              {isSdkProvider ? (
                <input value={selectedModel} onChange={(event) => onPatchConfig({ modelId: event.target.value || undefined })} />
              ) : (
                <select value={selectedModel} onChange={(event) => onPatchConfig({ modelId: event.target.value || undefined })}>
                  <option value="">{t.common.defaultModel}</option>
                  {!hasSelectedModel && <option value={selectedModel}>{selectedModel}</option>}
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label>
              <span>{t.fields.runLabel}</span>
              <input value={config.agentName} onChange={(event) => onPatchConfig({ agentName: event.target.value })} />
            </label>
            {isSdkProvider && (
              <>
                <label>
                  <span>Permission</span>
                  <select
                    value={config.permissionProfile ?? "read_only"}
                    onChange={(event) => onPatchConfig({ permissionProfile: event.target.value as AgentNodeConfig["permissionProfile"] })}
                  >
                    <option value="read_only">Read only</option>
                    <option value="workspace_write">Workspace write</option>
                  </select>
                </label>
                <label>
                  <span>Working directory</span>
                  <input value={config.workingDirectory ?? ""} onChange={(event) => onPatchConfig({ workingDirectory: event.target.value })} />
                </label>
                <label>
                  <span>Timeout ms</span>
                  <input
                    min={1}
                    type="number"
                    value={config.timeoutMs ?? 600000}
                    onChange={(event) => onPatchConfig({ timeoutMs: clampNumberInput(event.target.value, 1, 3600000, 600000) })}
                  />
                </label>
                <label className="field-span-full">
                  <span>Output schema</span>
                  <textarea
                    rows={6}
                    value={schemaText}
                    onChange={(event) => setSchemaText(event.target.value)}
                    onBlur={() => onPatchConfig({ outputSchema: readOutputSchema(schemaText) })}
                  />
                </label>
              </>
            )}
          </div>
        </details>
      </div>
    );
  }

  if (node.type === "manager") {
    const config = node.config as ManagerNodeConfig;
    const runtimeId = node.runtimeId ?? "openclaw";
    const isSdkProvider = runtimeId === "claude" || runtimeId === "codex";
    const selectedModel = config.modelId ?? "";
    const hasSelectedModel = selectedModel ? models.some((model) => model.id === selectedModel) : true;
    const agentOptions = configuredAgents ?? [];
    const selectedAgentId = config.openclawAgentId ?? agentOptions[0]?.id ?? "main";
    const hasSelectedAgent = agentOptions.some((agent) => agent.id === selectedAgentId);
    return (
      <div className="config-form node-modal-form">
        <label>
          <span>Runtime</span>
          <select value={runtimeId} onChange={(event) => onPatchNode({ runtimeId: event.target.value as AgentRuntimeId })}>
            <option value="openclaw">OpenClaw</option>
            <option value="codex">Codex</option>
            <option value="claude">Claude Code</option>
          </select>
        </label>
        {!isSdkProvider && (
          <label>
            <span>{t.fields.openclawAgent}</span>
            <select
              value={selectedAgentId}
              onChange={(event) => onPatchConfig({ openclawAgentId: event.target.value })}
            >
              {!hasSelectedAgent && <option value={selectedAgentId}>{selectedAgentId}</option>}
              {agentOptions.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name ? `${agent.name} (${agent.id})` : agent.id}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span>{t.fields.model}</span>
          {isSdkProvider ? (
            <input value={selectedModel} onChange={(event) => onPatchConfig({ modelId: event.target.value || undefined })} />
          ) : (
            <select value={selectedModel} onChange={(event) => onPatchConfig({ modelId: event.target.value || undefined })}>
              <option value="">{t.common.defaultModel}</option>
              {!hasSelectedModel && <option value={selectedModel}>{selectedModel}</option>}
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          )}
        </label>
        <label>
          <span>{t.fields.runLabel}</span>
          <input value={config.agentName ?? "manager"} onChange={(event) => onPatchConfig({ agentName: event.target.value })} />
        </label>
        <label>
          <span>{t.fields.label}</span>
          <input value={config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
        </label>
        <label>
          <span>{t.fields.ports}</span>
          <input
            min={1}
            max={8}
            type="number"
            value={config.portCount}
            onChange={(event) => onPatchConfig({ portCount: clampNumberInput(event.target.value, 1, 8, 3) })}
          />
        </label>
        <label>
          <span>{t.fields.maxHandoffs}</span>
          <input
            min={1}
            max={50}
            type="number"
            value={config.maxHandoffs}
            onChange={(event) => onPatchConfig({ maxHandoffs: clampNumberInput(event.target.value, 1, 50, 12) })}
          />
        </label>
        {isSdkProvider && (
          <>
            <label>
              <span>Permission</span>
              <select
                value={config.permissionProfile ?? "read_only"}
                onChange={(event) => onPatchConfig({ permissionProfile: event.target.value as ManagerNodeConfig["permissionProfile"] })}
              >
                <option value="read_only">Read only</option>
                <option value="workspace_write">Workspace write</option>
              </select>
            </label>
            <label>
              <span>Working directory</span>
              <input value={config.workingDirectory ?? ""} onChange={(event) => onPatchConfig({ workingDirectory: event.target.value })} />
            </label>
            <label>
              <span>Timeout ms</span>
              <input
                min={1}
                type="number"
                value={config.timeoutMs ?? 600000}
                onChange={(event) => onPatchConfig({ timeoutMs: clampNumberInput(event.target.value, 1, 3600000, 600000) })}
              />
            </label>
          </>
        )}
        <label className="field-span-full">
          <span>{t.fields.instructions}</span>
          <textarea
            rows={8}
            value={config.instructions ?? ""}
            onChange={(event) => onPatchConfig({ instructions: event.target.value })}
          />
        </label>
      </div>
    );
  }

  if (node.type === "manager_slot") {
    const config = node.config as ManagerSlotNodeConfig;
    return (
      <div className="config-form node-modal-form">
        <label>
          <span>{t.fields.label}</span>
          <input value={config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
        </label>
        <label>
          <span>{t.fields.slot}</span>
          <input value={config.slot} readOnly />
        </label>
        <label>
          <span>{t.fields.manager}</span>
          <input value={config.managerNodeId} readOnly />
        </label>
      </div>
    );
  }

  if (node.type === "loop") {
    const config = node.config as LoopNodeConfig;
    return (
      <div className="config-form node-modal-form">
        <label>
          <span>{t.fields.label}</span>
          <input value={config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
        </label>
        <label>
          <span>{t.fields.maxIterations}</span>
          <input
            min={1}
            max={25}
            type="number"
            value={config.maxIterations}
            onChange={(event) => onPatchConfig({ maxIterations: clampNumberInput(event.target.value, 1, 25, 3) })}
          />
        </label>
      </div>
    );
  }

  if (node.type === "condition") {
    const config = node.config as ConditionNodeConfig;
    return (
      <div className="config-form node-modal-form">
        <label>
          <span>{t.fields.label}</span>
          <input value={config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
        </label>
        <label className="field-span-full">
          <span>{t.fields.expression}</span>
          <input value={config.expression} onChange={(event) => onPatchConfig({ expression: event.target.value })} />
        </label>
      </div>
    );
  }

  if (node.type === "approval") {
    const config = node.config as ApprovalNodeConfig;
    return (
      <div className="config-form node-modal-form">
        <label>
          <span>{t.fields.label}</span>
          <input value={config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
        </label>
        <label>
          <span>{t.fields.approver}</span>
          <input value={config.approverHint ?? ""} onChange={(event) => onPatchConfig({ approverHint: event.target.value })} />
        </label>
        <label className="field-span-full">
          <span>{t.fields.instructions}</span>
          <textarea rows={8} value={config.instructions ?? ""} onChange={(event) => onPatchConfig({ instructions: event.target.value })} />
        </label>
      </div>
    );
  }

  if (node.type === "send") {
    const config = node.config as SendNodeConfig;
    return (
      <div className="config-form node-modal-form">
        <label>
          <span>{t.fields.label}</span>
          <input value={config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
        </label>
        <label>
          <span>{t.fields.channels}</span>
          <select value={config.channelId} onChange={(event) => onPatchConfig({ channelId: event.target.value })}>
            {channels.length === 0 && <option value={config.channelId}>{config.channelId}</option>}
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t.fields.target}</span>
          <input value={config.target} onChange={(event) => onPatchConfig({ target: event.target.value })} />
        </label>
        <label className="field-span-full">
          <span>{t.fields.body}</span>
          <textarea rows={8} value={config.bodyTemplate} onChange={(event) => onPatchConfig({ bodyTemplate: event.target.value })} />
        </label>
      </div>
    );
  }

  if (node.type === "summary") {
    const config = node.config as SummaryNodeConfig;
    return (
      <div className="config-form node-modal-form">
        <label>
          <span>{t.fields.label}</span>
          <input value={config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
        </label>
        <label>
          <span>{t.fields.model}</span>
          <select value={config.modelId ?? ""} onChange={(event) => onPatchConfig({ modelId: event.target.value || undefined })}>
            <option value="">{t.common.defaultModel}</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t.fields.mode}</span>
          <select value={config.mode} onChange={(event) => onPatchConfig({ mode: event.target.value as SummaryNodeConfig["mode"] })}>
            <option value="structured_merge">{t.options.structuredMerge}</option>
            <option value="openclaw_summary_agent">{t.options.openClawAgent}</option>
          </select>
        </label>
        <label className="field-span-full">
          <span>{t.fields.prompt}</span>
          <textarea rows={8} value={config.prompt ?? ""} onChange={(event) => onPatchConfig({ prompt: event.target.value })} />
        </label>
      </div>
    );
  }

  if (node.type === "parallel_agents") {
    const config = node.config as ParallelAgentsNodeConfig;
    const agentOptions = configuredAgents ?? [];
    const updateAgent = (index: number, patch: Partial<AgentNodeConfig>) => {
      onPatchConfig({
        agents: config.agents.map((agent, agentIndex) => (agentIndex === index ? { ...agent, ...patch } : agent))
      });
    };
    const addAgent = () => {
      onPatchConfig({
        agents: [...config.agents, createDefaultParallelAgent(t, agentOptions[0]?.id ?? "main")]
      });
    };
    const removeAgent = (index: number) => {
      onPatchConfig({
        agents: config.agents.filter((_, agentIndex) => agentIndex !== index)
      });
    };

    return (
      <div className="config-form node-modal-form">
        <label>
          <span>{t.fields.label}</span>
          <input value={config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
        </label>
        <label>
          <span>{t.fields.waitFor}</span>
          <select value={config.waitFor} onChange={(event) => onPatchConfig({ waitFor: event.target.value as ParallelAgentsNodeConfig["waitFor"] })}>
            <option value="all">{t.options.waitForAll}</option>
            <option value="first_success">{t.options.firstSuccess}</option>
          </select>
        </label>
        <label>
          <span>{t.metrics.agents(config.agents.length)}</span>
          <input value={config.agents.map((agent) => agent.agentName).join(", ")} readOnly />
        </label>
        <div className="field-span-full parallel-agent-list">
          {config.agents.length === 0 ? (
            <div className="empty-state compact-empty-state">{t.empty.noParallelAgents}</div>
          ) : (
            config.agents.map((agent, index) => {
              const selectedModel = agent.modelId ?? "";
              const hasSelectedModel = selectedModel ? models.some((model) => model.id === selectedModel) : true;
              const selectedAgentId = agent.openclawAgentId ?? agentOptions[0]?.id ?? "main";
              const hasSelectedAgent = agentOptions.some((candidate) => candidate.id === selectedAgentId);

              return (
                <div key={`${agent.openclawAgentId ?? "main"}-${index}`} className="node-modal-section parallel-agent-card">
                  <div className="parallel-agent-card-header">
                    <h4>{`OpenClaw Agent ${index + 1}`}</h4>
                    <button type="button" className="icon-button" onClick={() => removeAgent(index)}>
                      <X size={14} />
                    </button>
                  </div>
                  <div className="config-form parallel-agent-form">
                    <label>
                      <span>{t.fields.openclawAgent}</span>
                      <select value={selectedAgentId} onChange={(event) => updateAgent(index, { openclawAgentId: event.target.value })}>
                        {!hasSelectedAgent && <option value={selectedAgentId}>{selectedAgentId}</option>}
                        {agentOptions.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name ? `${candidate.name} (${candidate.id})` : candidate.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{t.fields.model}</span>
                      <select value={selectedModel} onChange={(event) => updateAgent(index, { modelId: event.target.value || undefined })}>
                        <option value="">{t.common.defaultModel}</option>
                        {!hasSelectedModel && <option value={selectedModel}>{selectedModel}</option>}
                        {models.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{t.fields.runLabel}</span>
                      <input value={agent.agentName} onChange={(event) => updateAgent(index, { agentName: event.target.value })} />
                    </label>
                    <label className="field-span-full">
                      <span>{t.fields.prompt}</span>
                      <textarea rows={6} value={agent.prompt} onChange={(event) => updateAgent(index, { prompt: event.target.value })} />
                    </label>
                  </div>
                </div>
              );
            })
          )}
          <button type="button" onClick={addAgent}>
            {t.actions.addParallelAgent}
          </button>
        </div>
      </div>
    );
  }

  if (node.type === "note") {
    const config = node.config as NoteNodeConfig;
    return (
      <div className="config-form node-modal-form">
        <label>
          <span>{t.fields.label}</span>
          <input value={config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
        </label>
        <label className="field-span-full">
          <span>{t.fields.body}</span>
          <textarea rows={10} value={config.body} onChange={(event) => onPatchConfig({ body: event.target.value })} />
        </label>
      </div>
    );
  }

  return (
    <div className="config-form node-modal-form">
      <label>
        <span>{t.fields.label}</span>
        <input value={node.config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
      </label>
    </div>
  );
}

function AgentSkillPanel({
  node,
  skills,
  t,
  onPatchConfig
}: {
  node: BlueprintNode;
  skills: NonNullable<CatalogSnapshot["tools"]>;
  t: Messages;
  onPatchConfig: (patch: Partial<BlueprintNode["config"]>) => void;
}) {
  const config = node.config as AgentNodeConfig;
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const selectedSkills = config.tools ?? [];
  const availableSkills = skills.filter((skill) => !selectedSkills.includes(skill.id));

  const addSkill = () => {
    if (!selectedSkillId) return;
    onPatchConfig({
      tools: [...selectedSkills, selectedSkillId]
    });
    setSelectedSkillId("");
  };

  const removeSkill = (skillId: string) => {
    onPatchConfig({
      tools: selectedSkills.filter((item) => item !== skillId)
    });
  };

  return (
    <div className="node-modal-section">
      <h4>{t.fields.skills}</h4>
      <div className="skill-picker">
        <select value={selectedSkillId} onChange={(event) => setSelectedSkillId(event.target.value)}>
          <option value="">{t.empty.selectSkill}</option>
          {availableSkills.map((skill) => (
            <option key={skill.id} value={skill.id}>
              {skill.label} ({skill.category})
            </option>
          ))}
        </select>
        <button type="button" onClick={addSkill} disabled={!selectedSkillId}>
          {t.actions.addSkill}
        </button>
      </div>
      <div className="skill-list">
        {selectedSkills.length === 0 ? (
          <div className="empty-state compact-empty-state">{t.empty.noSkills}</div>
        ) : (
          selectedSkills.map((skillId) => {
            const match = skills.find((skill) => skill.id === skillId);
            return (
              <div key={skillId} className="skill-item">
                <div className="skill-item-main">
                  <strong>{match?.label ?? skillId}</strong>
                  <span>{match ? `${match.category} | ${match.id}` : skillId}</span>
                </div>
                <button type="button" className="icon-button" onClick={() => removeSkill(skillId)}>
                  <X size={14} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function clampNumberInput(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function compareDescending(left: number, right: number): number {
  return right - left;
}

function compareBlueprintNames(left: BlueprintDefinition, right: BlueprintDefinition): number {
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true });
}

function toTimestamp(value: string): number {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getBrowserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function nextBlueprintNodeId(blueprint: BlueprintDefinition, type: BlueprintNodeType, parentId?: string): string {
  return nextAvailableBlueprintNodeId(new Set(blueprint.nodes.map((node) => node.id)), type, parentId);
}

function nextAvailableBlueprintNodeId(existingIds: Set<string>, type: BlueprintNodeType, parentId?: string): string {
  const baseId = parentId ? `${parentId}-${type}` : type;
  let index = 1;
  let id = `${baseId}-${index}`;
  while (existingIds.has(id)) {
    index += 1;
    id = `${baseId}-${index}`;
  }
  return id;
}

function hasDuplicateNodeIds(blueprint: BlueprintDefinition): boolean {
  const seen = new Set<string>();
  for (const node of blueprint.nodes) {
    if (seen.has(node.id)) return true;
    seen.add(node.id);
  }
  return false;
}

function ensureUniqueBlueprintNodeIds(blueprint: BlueprintDefinition): BlueprintDefinition {
  const usedIds = new Set<string>();
  let changed = false;
  const nodes = blueprint.nodes.map((node) => {
    if (!usedIds.has(node.id)) {
      usedIds.add(node.id);
      return node;
    }
    const nextId = nextAvailableBlueprintNodeId(usedIds, node.type, node.parentId);
    usedIds.add(nextId);
    changed = true;
    return {
      ...node,
      id: nextId
    };
  });

  return changed ? { ...blueprint, nodes } : blueprint;
}

function isPaneAddMenuTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (
    target.closest(
      ".react-flow__node, .react-flow__handle, .react-flow__controls, .react-flow__minimap, .node-menu-popover, .node-context-menu, .blueprint-action-dock, .blueprint-side-panel"
    )
  ) {
    return false;
  }
  return Boolean(target.closest(".react-flow__pane"));
}

function isManagerSlotInnerFrameContext(event: { currentTarget: EventTarget | null; clientX: number; clientY: number }): boolean {
  if (!(event.currentTarget instanceof Element)) return false;
  const innerFrame = event.currentTarget.querySelector(".manager-slot-box-body");
  if (!innerFrame) return false;
  const rect = innerFrame.getBoundingClientRect();
  return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
}

function getMenuPoint(event: { clientX: number; clientY: number }): { x: number; y: number } {
  return {
    x: event.clientX + 8,
    y: event.clientY + 8
  };
}

function collectBlueprintNodePositionChanges(changes: NodeChange<Node<BlueprintNodeCardData>>[]): Map<string, CanvasPosition> {
  const positions = new Map<string, CanvasPosition>();
  for (const change of changes) {
    if (change.type !== "position" || !change.position) continue;
    if (change.dragging === true) continue;
    positions.set(change.id, change.position);
  }
  return positions;
}

function collectManagerSlotSizeChanges(changes: NodeChange<Node<BlueprintNodeCardData>>[]): Map<string, CanvasSize> {
  const sizes = new Map<string, CanvasSize>();
  for (const change of changes) {
    if (change.type !== "dimensions" || !change.dimensions) continue;
    if (change.resizing === true) continue;
    sizes.set(change.id, normalizeManagerSlotSize(change.dimensions));
  }
  return sizes;
}

function updateBlueprintNodePositions(blueprint: BlueprintDefinition, positionsById: Map<string, CanvasPosition>): BlueprintDefinition {
  if (positionsById.size === 0) return blueprint;

  let changed = false;
  const nodesById = new Map(blueprint.nodes.map((node) => [node.id, node]));
  const nodes = blueprint.nodes.map((node) => {
    const nextPosition = positionsById.get(node.id);
    if (!nextPosition) return node;
    const parentNode = node.parentId ? nodesById.get(node.parentId) : undefined;
    const position =
      parentNode?.type === "manager_slot" ? clampPositionToManagerSlotFrame(nextPosition, parentNode, defaultChildNodeSize) : nextPosition;
    if (position.x === node.position.x && position.y === node.position.y) return node;
    changed = true;
    return { ...node, position };
  });

  return changed ? { ...blueprint, nodes } : blueprint;
}

function resizeManagerSlotNodes(blueprint: BlueprintDefinition, sizesById: Map<string, CanvasSize>): BlueprintDefinition {
  if (sizesById.size === 0) return blueprint;

  let changed = false;
  const resizedNodes = blueprint.nodes.map((node) => {
    const nextSize = sizesById.get(node.id);
    if (!nextSize || node.type !== "manager_slot") return node;
    const currentSize = normalizeManagerSlotSize(node.size);
    if (currentSize.width === nextSize.width && currentSize.height === nextSize.height) return node;
    changed = true;
    return { ...node, size: nextSize };
  });

  if (!changed) return blueprint;

  const resizedNodesById = new Map(resizedNodes.map((node) => [node.id, node]));
  const nodes = resizedNodes.map((node) => {
    if (!node.parentId) return node;
    const parentNode = resizedNodesById.get(node.parentId);
    if (parentNode?.type !== "manager_slot") return node;
    const position = clampPositionToManagerSlotFrame(node.position, parentNode, defaultChildNodeSize);
    if (position.x === node.position.x && position.y === node.position.y) return node;
    return { ...node, position };
  });

  return {
    ...blueprint,
    nodes
  };
}

function normalizeManagerSlotSize(size?: Partial<CanvasSize>): CanvasSize {
  return {
    width: normalizeDimension(size?.width, MANAGER_SLOT_DEFAULT_SIZE.width, MANAGER_SLOT_MIN_SIZE.width),
    height: normalizeDimension(size?.height, MANAGER_SLOT_DEFAULT_SIZE.height, MANAGER_SLOT_MIN_SIZE.height)
  };
}

function normalizeDimension(value: unknown, fallback: number, min: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.round(value));
}

function managerSlotChildExtent(slotNode: BlueprintNode): CoordinateExtent {
  const size = normalizeManagerSlotSize(slotNode.size);
  return [
    [MANAGER_SLOT_FRAME.side, MANAGER_SLOT_FRAME.top],
    [size.width - MANAGER_SLOT_FRAME.side, size.height - MANAGER_SLOT_FRAME.bottom]
  ];
}

function managerSlotChildInitialPosition(slotNode: BlueprintNode, childIndex: number): CanvasPosition {
  const extent = managerSlotChildExtent(slotNode);
  const position = {
    x: MANAGER_SLOT_FRAME.side + 48 + childIndex * 28,
    y: MANAGER_SLOT_FRAME.top + 52
  };
  return clampPositionToExtent(position, extent, defaultChildNodeSize);
}

function clampPositionToManagerSlotFrame(position: CanvasPosition, slotNode: BlueprintNode, childSize: CanvasSize): CanvasPosition {
  return clampPositionToExtent(position, managerSlotChildExtent(slotNode), childSize);
}

function clampPositionToExtent(position: CanvasPosition, extent: CoordinateExtent, childSize: CanvasSize): CanvasPosition {
  return {
    x: Math.min(Math.max(position.x, extent[0][0]), Math.max(extent[0][0], extent[1][0] - childSize.width)),
    y: Math.min(Math.max(position.y, extent[0][1]), Math.max(extent[0][1], extent[1][1] - childSize.height))
  };
}

function addManagerSlotFromMenu(blueprint: BlueprintDefinition, selectedNodeId: string | undefined, t: Messages): BlueprintDefinition {
  const selectedNode = selectedNodeId ? blueprint.nodes.find((node) => node.id === selectedNodeId) : undefined;
  const selectedSlot = selectedNode?.type === "manager_slot" ? selectedNode : undefined;
  const selectedManager =
    selectedNode?.type === "manager"
      ? selectedNode
      : selectedSlot
        ? blueprint.nodes.find((node) => node.id === (selectedSlot.config as ManagerSlotNodeConfig).managerNodeId && node.type === "manager")
        : undefined;
  const assignableSlot = selectedManager ? nextAvailableManagerSlot(blueprint, selectedManager) : undefined;
  const slot = assignableSlot ?? nextManagerSlotNumber(blueprint);
  const position = selectedSlot
    ? { x: selectedSlot.position.x + 44, y: selectedSlot.position.y + 44 }
    : selectedManager
      ? { x: selectedManager.position.x + 360, y: selectedManager.position.y + (slot - 1) * 340 }
      : { x: 180 + blueprint.nodes.length * 42, y: 188 + blueprint.nodes.length * 22 };
  const node: BlueprintNode = {
    id: nextBlueprintNodeId(blueprint, "manager_slot"),
    type: "manager_slot",
    position,
    size: MANAGER_SLOT_DEFAULT_SIZE,
    config: {
      ...defaultConfig("manager_slot", t),
      label: `${t.defaults.managerSlotLabel} ${slot}`,
      managerNodeId: selectedManager?.id ?? "",
      slot
    } as BlueprintNode["config"]
  };
  const blueprintWithSlot = {
    ...blueprint,
    nodes: [...blueprint.nodes, node]
  };
  if (!selectedManager || assignableSlot === undefined) return blueprintWithSlot;
  return applyManagerSlotAssignment(blueprintWithSlot, {
    managerNode: selectedManager,
    slotNode: node,
    slot: assignableSlot
  }, t);
}

function nextManagerSlotNumber(blueprint: BlueprintDefinition): number {
  return blueprint.nodes
    .filter((node) => node.type === "manager_slot")
    .reduce((highest, node) => Math.max(highest, (node.config as ManagerSlotNodeConfig).slot), 0) + 1;
}

function nextAvailableManagerSlot(blueprint: BlueprintDefinition, managerNode: BlueprintNode): number | undefined {
  const occupied = new Set<number>();
  const managerId = managerNode.id;

  for (const edge of blueprint.edges) {
    if (edge.source === managerId) {
      const slot = parseManagerPortHandle(edge.sourceHandle, managerOutHandlePrefix);
      if (slot !== undefined) occupied.add(slot);
    }
    if (edge.target === managerId) {
      const slot = parseManagerPortHandle(edge.targetHandle, managerInHandlePrefix);
      if (slot !== undefined) occupied.add(slot);
    }
  }

  for (const node of blueprint.nodes) {
    if (node.type !== "manager_slot") continue;
    const config = node.config as ManagerSlotNodeConfig;
    if (config.managerNodeId === managerId && config.slot >= 1 && config.slot <= maxManagerPortCount) {
      occupied.add(config.slot);
    }
  }

  for (let slot = 1; slot <= maxManagerPortCount; slot += 1) {
    if (!occupied.has(slot)) return slot;
  }
  return undefined;
}

function connectBlueprintNodes(blueprint: BlueprintDefinition, connection: Connection, t: Messages): BlueprintDefinition {
  const assignment = readManagerSlotConnection(blueprint, connection);
  if (assignment) {
    return applyManagerSlotAssignment(blueprint, assignment, t);
  }
  if (
    blueprint.edges.some(
      (edge) =>
        edge.source === connection.source &&
        edge.target === connection.target &&
        edge.sourceHandle === connection.sourceHandle &&
        edge.targetHandle === connection.targetHandle
    )
  ) {
    return blueprint;
  }

  return {
    ...blueprint,
    edges: [...blueprint.edges, createBlueprintEdge(blueprint, connection)]
  };
}

function readManagerSlotConnection(
  blueprint: BlueprintDefinition,
  connection: Connection
): { managerNode: BlueprintNode; slotNode: BlueprintNode; slot: number } | undefined {
  if (!connection.source || !connection.target) return undefined;
  const source = blueprint.nodes.find((node) => node.id === connection.source);
  const target = blueprint.nodes.find((node) => node.id === connection.target);

  if (source?.type === "manager" && target?.type === "manager_slot" && connection.targetHandle === managerSlotInHandle) {
    const slot = parseManagerPortHandle(connection.sourceHandle, managerOutHandlePrefix);
    return slot === undefined ? undefined : { managerNode: source, slotNode: target, slot };
  }

  if (source?.type === "manager_slot" && target?.type === "manager" && connection.sourceHandle === managerSlotOutHandle) {
    const slot = parseManagerPortHandle(connection.targetHandle, managerInHandlePrefix);
    return slot === undefined ? undefined : { managerNode: target, slotNode: source, slot };
  }

  return undefined;
}

function applyManagerSlotAssignment(
  blueprint: BlueprintDefinition,
  assignment: { managerNode: BlueprintNode; slotNode: BlueprintNode; slot: number },
  t?: Messages
): BlueprintDefinition {
  const { managerNode, slotNode, slot } = assignment;
  const boundedSlot = Math.min(maxManagerPortCount, Math.max(1, Math.round(slot)));
  const outHandle = `${managerOutHandlePrefix}${boundedSlot}`;
  const inHandle = `${managerInHandlePrefix}${boundedSlot}`;
  const edges = blueprint.edges.filter(
    (edge) =>
      !isManagerSlotAssignmentEdge(edge, slotNode.id) &&
      !(edge.source === managerNode.id && edge.sourceHandle === outHandle) &&
      !(edge.target === managerNode.id && edge.targetHandle === inHandle)
  );
  const nextEdges = appendBlueprintEdge(
    appendBlueprintEdge(edges, {
      id: nextBlueprintEdgeId(edges, `edge-${managerNode.id}-${slotNode.id}-slot-${boundedSlot}-out`),
      source: managerNode.id,
      sourceHandle: outHandle,
      target: slotNode.id,
      targetHandle: managerSlotInHandle,
      condition: "success"
    }),
    {
      id: nextBlueprintEdgeId(edges, `edge-${slotNode.id}-${managerNode.id}-slot-${boundedSlot}-return`),
      source: slotNode.id,
      sourceHandle: managerSlotOutHandle,
      target: managerNode.id,
      targetHandle: inHandle,
      condition: "success"
    }
  );

  return {
    ...blueprint,
    nodes: blueprint.nodes.map((node) => {
      if (node.id === managerNode.id && node.type === "manager") {
        const config = node.config as ManagerNodeConfig;
        const portCount = typeof config.portCount === "number" && Number.isFinite(config.portCount) ? config.portCount : 3;
        return {
          ...node,
          config: {
            ...config,
            portCount: Math.min(maxManagerPortCount, Math.max(portCount, boundedSlot))
          }
        };
      }
      if (node.id !== slotNode.id || node.type !== "manager_slot") return node;
      const config = node.config as ManagerSlotNodeConfig;
      return {
        ...node,
        config: {
          ...config,
          label: shouldRenameManagerSlot(config.label) ? `${t?.defaults.managerSlotLabel ?? "Slot"} ${boundedSlot}` : config.label,
          managerNodeId: managerNode.id,
          slot: boundedSlot
        }
      };
    }),
    edges: nextEdges
  };
}

function appendBlueprintEdge(edges: BlueprintEdge[], edge: BlueprintEdge): BlueprintEdge[] {
  if (
    edges.some(
      (item) =>
        item.source === edge.source &&
        item.target === edge.target &&
        item.sourceHandle === edge.sourceHandle &&
        item.targetHandle === edge.targetHandle
    )
  ) {
    return edges;
  }
  return [...edges, edge];
}

function isManagerSlotAssignmentEdge(edge: BlueprintEdge, slotNodeId: string): boolean {
  if (edge.target === slotNodeId && edge.targetHandle === managerSlotInHandle && edge.sourceHandle?.startsWith(managerOutHandlePrefix)) {
    return true;
  }
  return Boolean(edge.source === slotNodeId && edge.sourceHandle === managerSlotOutHandle && edge.targetHandle?.startsWith(managerInHandlePrefix));
}

function parseManagerPortHandle(handle: string | null | undefined, prefix: string): number | undefined {
  if (!handle?.startsWith(prefix)) return undefined;
  const parsed = Number.parseInt(handle.slice(prefix.length), 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > maxManagerPortCount) return undefined;
  return parsed;
}

function shouldRenameManagerSlot(label: string | undefined): boolean {
  return !label || label === "Slot" || label === "槽位" || /^Slot \d+$/i.test(label) || /^槽位 \d+$/i.test(label);
}

function nextBlueprintEdgeId(edges: BlueprintEdge[], baseId: string): string {
  const used = new Set(edges.map((edge) => edge.id));
  if (!used.has(baseId)) return baseId;
  let index = 2;
  let id = `${baseId}-${index}`;
  while (used.has(id)) {
    index += 1;
    id = `${baseId}-${index}`;
  }
  return id;
}

function collectDeletedNodeIds(blueprint: BlueprintDefinition, seedIds: Set<string>): Set<string> {
  const deleteIds = new Set(seedIds);
  for (const node of blueprint.nodes) {
    if (!deleteIds.has(node.id)) continue;
    if (node.type !== "manager") continue;
    for (const candidate of blueprint.nodes) {
      if (candidate.type === "manager_slot" && (candidate.config as ManagerSlotNodeConfig).managerNodeId === node.id) {
        deleteIds.add(candidate.id);
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of blueprint.nodes) {
      if (node.parentId && deleteIds.has(node.parentId) && !deleteIds.has(node.id)) {
        deleteIds.add(node.id);
        changed = true;
      }
    }
  }
  return deleteIds;
}

function buildFlowNodes(
  blueprint: BlueprintDefinition | undefined,
  statusByNode: Map<string, BlueprintNodeRun>,
  t: Messages
): Node<BlueprintNodeCardData>[] {
  const nodesById = new Map((blueprint?.nodes ?? []).map((node) => [node.id, node]));
  return (blueprint?.nodes ?? []).map((node) => {
    const status = statusByNode.get(node.id)?.status;
    const managerSlotSize = node.type === "manager_slot" ? normalizeManagerSlotSize(node.size) : undefined;
    const parentNode = node.parentId ? nodesById.get(node.parentId) : undefined;
    const extent = parentNode?.type === "manager_slot" ? managerSlotChildExtent(parentNode) : node.parentId ? "parent" : undefined;
    return {
      id: node.id,
      type: "blueprintNode",
      position: node.position,
      style: managerSlotSize ? { width: managerSlotSize.width, height: managerSlotSize.height } : undefined,
      initialWidth: managerSlotSize?.width,
      initialHeight: managerSlotSize?.height,
      parentId: node.parentId,
      extent,
      data: {
        label: node.config.label,
        type: node.type,
        kindLabel: t.nodeTypes[node.type],
        status,
        statusLabel: t.status[status ?? "idle"],
        disabled: node.disabled,
        isStartNode: isBlueprintStartNode(blueprint, node, nodesById),
        managerPortCount:
          node.type === "manager" ? (node.config as ManagerNodeConfig).portCount : undefined,
        managerSlot: node.type === "manager_slot" ? (node.config as ManagerSlotNodeConfig).slot : undefined,
        managerSlotSize
      }
    };
  });
}

function BlueprintCanvasMiniMap({
  canvasWorld,
  nodes
}: {
  canvasWorld: BlueprintCanvasWorld;
  nodes: Node<BlueprintNodeCardData>[];
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const { setCenter } = useReactFlow();
  const viewport = useStore((store) => {
    const zoom = store.transform[2] || 1;
    return {
      x: -store.transform[0] / zoom,
      y: -store.transform[1] / zoom,
      width: store.width / zoom,
      height: store.height / zoom,
      zoom
    };
  });
  const miniMapNodes = useMemo(() => buildMiniMapNodeBoxes(nodes), [nodes]);
  const viewportRect = useMemo(() => clampViewportToCanvasWorld(viewport, canvasWorld), [canvasWorld, viewport]);
  const maskPath = `M${canvasWorld.minX},${canvasWorld.minY}h${canvasWorld.width}v${canvasWorld.height}h${-canvasWorld.width}z M${viewportRect.x},${viewportRect.y}h${viewportRect.width}v${viewportRect.height}h${-viewportRect.width}z`;

  const centerViewportAtPointer = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const position = getMiniMapPointerPosition(event.currentTarget, event);
      if (!position) return;
      const halfWidth = viewportRect.width / 2;
      const halfHeight = viewportRect.height / 2;
      const x = clampNumber(position.x, canvasWorld.minX + halfWidth, canvasWorld.maxX - halfWidth);
      const y = clampNumber(position.y, canvasWorld.minY + halfHeight, canvasWorld.maxY - halfHeight);
      void setCenter(x, y, { zoom: viewport.zoom, duration: event.type === "pointerdown" ? 120 : 0 });
    },
    [canvasWorld.maxX, canvasWorld.maxY, canvasWorld.minX, canvasWorld.minY, setCenter, viewport.zoom, viewportRect.height, viewportRect.width]
  );

  return (
    <div className="react-flow__panel top left blueprint-world-minimap">
      <svg
        ref={svgRef}
        className="blueprint-world-minimap-svg"
        viewBox={`${canvasWorld.minX} ${canvasWorld.minY} ${canvasWorld.width} ${canvasWorld.height}`}
        role="img"
        aria-label="Blueprint map"
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          centerViewportAtPointer(event);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          centerViewportAtPointer(event);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
      >
        <rect className="blueprint-world-minimap-surface" x={canvasWorld.minX} y={canvasWorld.minY} width={canvasWorld.width} height={canvasWorld.height} />
        {miniMapNodes.map((node) => (
          <rect
            key={node.id}
            className={`blueprint-world-minimap-node${node.selected ? " selected" : ""}`}
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            rx={16}
            ry={16}
          />
        ))}
        <path className="blueprint-world-minimap-mask" d={maskPath} fillRule="evenodd" pointerEvents="none" />
        <rect
          className="blueprint-world-minimap-viewport"
          x={viewportRect.x}
          y={viewportRect.y}
          width={viewportRect.width}
          height={viewportRect.height}
          pointerEvents="none"
        />
      </svg>
    </div>
  );
}

function createBlueprintCanvasWorld(viewportSize: CanvasSize): BlueprintCanvasWorld {
  const viewportWidth = Math.max(960, Math.round(viewportSize.width));
  const viewportHeight = Math.max(720, Math.round(viewportSize.height));
  const minX = -viewportWidth;
  const minY = -viewportHeight;
  const width = viewportWidth * canvasWorldScreenScale;
  const height = viewportHeight * canvasWorldScreenScale;
  const maxX = minX + width;
  const maxY = minY + height;
  return {
    extent: [
      [minX, minY],
      [maxX, maxY]
    ],
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    viewportWidth,
    viewportHeight
  };
}

type MiniMapNodeBox = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
};

function buildMiniMapNodeBoxes(nodes: Node<BlueprintNodeCardData>[]): MiniMapNodeBox[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const absolutePositions = new Map<string, CanvasPosition>();
  return nodes
    .filter((node) => !node.hidden)
    .map((node) => {
      const position = resolveFlowNodeAbsolutePosition(node, nodesById, absolutePositions);
      const size = resolveFlowNodeSize(node);
      return {
        id: node.id,
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        selected: Boolean(node.selected)
      };
    });
}

function resolveFlowNodeAbsolutePosition(
  node: Node<BlueprintNodeCardData>,
  nodesById: Map<string, Node<BlueprintNodeCardData>>,
  cache: Map<string, CanvasPosition>
): CanvasPosition {
  const cached = cache.get(node.id);
  if (cached) return cached;
  const parent = node.parentId ? nodesById.get(node.parentId) : undefined;
  const parentPosition = parent ? resolveFlowNodeAbsolutePosition(parent, nodesById, cache) : { x: 0, y: 0 };
  const position = {
    x: parentPosition.x + node.position.x,
    y: parentPosition.y + node.position.y
  };
  cache.set(node.id, position);
  return position;
}

function resolveFlowNodeSize(node: Node<BlueprintNodeCardData>): CanvasSize {
  return {
    width: node.width ?? node.measured?.width ?? node.initialWidth ?? readCssPixelValue(node.style?.width) ?? defaultChildNodeSize.width,
    height: node.height ?? node.measured?.height ?? node.initialHeight ?? readCssPixelValue(node.style?.height) ?? defaultChildNodeSize.height
  };
}

function readCssPixelValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clampViewportToCanvasWorld(
  viewport: { x: number; y: number; width: number; height: number },
  canvasWorld: BlueprintCanvasWorld
): { x: number; y: number; width: number; height: number } {
  const width = Math.min(Math.max(viewport.width, 1), canvasWorld.width);
  const height = Math.min(Math.max(viewport.height, 1), canvasWorld.height);
  return {
    x: clampNumber(viewport.x, canvasWorld.minX, canvasWorld.maxX - width),
    y: clampNumber(viewport.y, canvasWorld.minY, canvasWorld.maxY - height),
    width,
    height
  };
}

function getMiniMapPointerPosition(svg: SVGSVGElement, event: ReactPointerEvent<SVGSVGElement>): CanvasPosition | undefined {
  const matrix = svg.getScreenCTM();
  if (!matrix) return undefined;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const mapped = point.matrixTransform(matrix.inverse());
  return { x: mapped.x, y: mapped.y };
}

function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return (min + max) / 2;
  return Math.min(Math.max(value, min), max);
}

function isBlueprintStartNode(
  blueprint: BlueprintDefinition | undefined,
  node: BlueprintNode,
  nodesById: Map<string, BlueprintNode>
): boolean {
  if (!blueprint || !isGlobalSchedulingNode(blueprint, node, nodesById)) return false;
  return getSchedulingIncomingEdges(blueprint, node, nodesById).length === 0;
}

function isGlobalSchedulingNode(
  blueprint: BlueprintDefinition,
  node: BlueprintNode,
  nodesById: Map<string, BlueprintNode>
): boolean {
  return blueprintStepTypes.has(node.type) && node.type !== "manager_slot" && !node.parentId && !isManagedParticipantNode(blueprint, node, nodesById);
}

function isManagedParticipantNode(
  blueprint: BlueprintDefinition,
  node: BlueprintNode,
  nodesById: Map<string, BlueprintNode>
): boolean {
  return blueprint.edges.some((edge) => {
    if (edge.target !== node.id || !edge.sourceHandle?.startsWith(managerOutHandlePrefix)) return false;
    return nodesById.get(edge.source)?.type === "manager";
  });
}

function getSchedulingIncomingEdges(
  blueprint: BlueprintDefinition,
  node: BlueprintNode,
  nodesById: Map<string, BlueprintNode>
): BlueprintEdge[] {
  return blueprint.edges.filter((edge) => {
    if (edge.target !== node.id) return false;
    if (node.type === "manager" && edge.targetHandle?.startsWith(managerInHandlePrefix)) return false;
    return nodesById.get(edge.source)?.type !== "loop";
  });
}

function buildFlowEdges(blueprint: BlueprintDefinition | undefined, runStatus?: BlueprintRunView["run"]["status"]): Edge[] {
  return (blueprint?.edges ?? []).map((edge) => ({
    id: edge.id,
    type: blueprintEdgeType(edge),
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    label: edge.label ?? defaultVisibleEdgeLabel(edge.condition),
    animated: runStatus === "running",
    className: "blueprint-edge",
    style: { strokeWidth: 3.5 }
  }));
}

function blueprintEdgeType(edge: BlueprintEdge): Edge["type"] | undefined {
  if (edge.sourceHandle === managerSlotInnerOutHandle || edge.targetHandle === managerSlotInnerInHandle) return "straight";
  return undefined;
}

export function defaultConfig(type: BlueprintNodeType, t: Messages): BlueprintNode["config"] {
  if (type === "agent") {
    return {
      label: t.defaults.agentLabel,
      openclawAgentId: "main",
      agentName: t.defaults.agentName,
      prompt: t.defaults.agentPrompt,
      permissionProfile: "read_only",
      timeoutMs: 600000,
      tools: []
    };
  }
  if (type === "condition") {
    return {
      label: t.defaults.conditionLabel,
      expression: "true"
    };
  }
  if (type === "approval") {
    return {
      label: t.defaults.approvalLabel,
      approverHint: t.defaults.approvalOwner,
      instructions: t.defaults.approvalInstructions
    };
  }
  if (type === "send") {
    return {
      label: t.defaults.sendLabel,
      channelId: "slack",
      target: "#engineering",
      bodyTemplate: t.defaults.sendBody
    };
  }
  if (type === "summary") {
    return {
      label: t.defaults.summaryLabel,
      mode: "structured_merge"
    };
  }
  if (type === "parallel_agents") {
    return {
      label: t.defaults.parallelAgentsLabel,
      agents: [createDefaultParallelAgent(t)],
      waitFor: "all"
    };
  }
  if (type === "manager") {
    return {
      label: t.defaults.managerLabel,
      portCount: 3,
      maxHandoffs: 12,
      instructions: t.defaults.managerInstructions,
      openclawAgentId: "main",
      agentName: "manager",
      permissionProfile: "read_only",
      timeoutMs: 600000,
      tools: []
    };
  }
  if (type === "manager_slot") {
    return {
      label: t.defaults.managerSlotLabel,
      managerNodeId: "",
      slot: 1
    };
  }
  if (type === "loop") {
    return {
      label: t.defaults.loopLabel,
      maxIterations: 3
    };
  }
  if (type === "note") {
    return {
      label: t.defaults.noteLabel,
      body: t.defaults.noteBody
    };
  }
  return {
    label: t.defaults.groupLabel,
    color: "#64748b"
  };
}

function createBlueprintEdge(blueprint: BlueprintDefinition, connection: Connection): BlueprintEdge {
  const condition = pickDefaultEdgeCondition(blueprint, connection.source!);
  return {
    id: `edge-${connection.source}-${connection.target}-${Math.random().toString(36).slice(2, 8)}`,
    source: connection.source!,
    target: connection.target!,
    sourceHandle: connection.sourceHandle ?? undefined,
    targetHandle: connection.targetHandle ?? undefined,
    condition,
    label: defaultVisibleEdgeLabel(condition)
  };
}

function pickDefaultEdgeCondition(
  blueprint: BlueprintDefinition,
  sourceId: string
): BlueprintEdge["condition"] {
  const source = blueprint.nodes.find((node) => node.id === sourceId);
  if (source?.type !== "condition") {
    return "success";
  }

  const outgoing = blueprint.edges.filter((edge) => edge.source === sourceId);
  const hasTrue = outgoing.some((edge) => edge.condition === "true");
  const hasFalse = outgoing.some((edge) => edge.condition === "false");
  if (!hasTrue) return "true";
  if (!hasFalse) return "false";
  return "true";
}

function defaultVisibleEdgeLabel(condition?: BlueprintEdge["condition"]): string | undefined {
  if (condition === "true" || condition === "false" || condition === "failure") {
    return condition;
  }
  return undefined;
}

function formatOutputSchema(schema: Record<string, unknown> | undefined): string {
  return schema ? JSON.stringify(schema, null, 2) : "";
}

function readOutputSchema(value: string): Record<string, unknown> | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function createDefaultParallelAgent(t: Messages, agentId = "main"): AgentNodeConfig {
  return {
    label: t.defaults.agentLabel,
    openclawAgentId: agentId,
    agentName: t.defaults.agentName,
    prompt: t.defaults.agentPrompt,
    tools: []
  };
}
