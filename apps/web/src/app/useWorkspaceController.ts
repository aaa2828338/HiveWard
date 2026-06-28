import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NavigateFunction } from "react-router";
import type {
  ApprovalRequest,
  ApprovalThread,
  ArchitectureBlueprintView,
  BlueprintDefinition,
  BlueprintKanbanBoard,
  BlueprintKanbanCard,
  BlueprintRunSummary,
  BlueprintRunView,
  CanvasPosition,
  CatalogSnapshot,
  ChatPermissionMode,
  ClaudeCodeModelConfig,
  ClaudeCodeModelPreset,
  ClaudeCodeSavedModelProfile,
  CompanyOverview,
  CompanyRoleDirectory,
  ConfigureOpenClawChannelRequest,
  ConfigureOpenClawModelAuthRequest,
  CreateCompanyRequest,
  CreateHermesChannelRequest,
  CreateHermesProfileRequest,
  HarnessId,
  HarnessSkillStatusResponse,
  HarnessStatus,
  HermesConfigResponse,
  HivewardUpdateStatus,
  HumanActionResponse,
  HumanActionQueueItem,
  OpenClawConfigState,
  OpenClawConfigWizardMetadata,
  OpenClawModelUsageSummary,
  OpenClawVersionInfo,
  PendingApprovalItem,
  PortableBlueprintPackage,
  RuntimeOverview,
  UpdateClaudeCodeModelConfigRequest,
  UpdateCompanyRequest,
  WorkspaceDashboard
} from "@hiveward/shared";
import hivewardPackage from "../../../../package.json";
import { emptyBlueprintKanbanBoard } from "../lib/blueprint-kanban-state";
import {
  applyBlueprintUpdaterToCollection,
  blueprintCollectionSignature,
  clearBlueprintDirty,
  isSameBlueprintSnapshot,
  listDirtyBlueprintsForAutosave,
  markBlueprintDirty,
  mergeBlueprintsPreservingLocalEdits,
  removeBlueprintFromDirtySet,
  replaceBlueprint
} from "../lib/blueprint-edit-state";
import { api, isClosedApprovalConflictError } from "../lib/api";
import { applyHarnessPermissionModesToBlueprint } from "../lib/harness-permissions";
import type { Language, Messages } from "../lib/i18n";
import { applyRunRoomOutputStreamEventToRunView, type RunRoomOutputStreamState } from "../lib/run-room-output-state";
import { getRoutePath, type RouteId } from "../routes/route-registry";
import { isActiveRunView, selectRunPollingTarget, syncApprovalsForRun, syncRunDetails, upsertRunSummary } from "../lib/run-state";

const RUN_STATE_POLL_INTERVAL_MS = 2500;
const WORKSPACE_BLUEPRINT_REFRESH_INTERVAL_MS = 20000;
const WORKSPACE_BLUEPRINT_AUTOSAVE_INTERVAL_MS = 60 * 1000;
const INBOX_POLL_INTERVAL_MS = 5000;
const HIVEWARD_UPDATE_POLL_INTERVAL_MS = 60 * 60 * 1000;
const HIVEWARD_REPOSITORY_URL = "https://github.com/Chaunyzhang/HiveWard";
const harnessSkillHarnessIds: HarnessId[] = ["codex", "claudeCode", "openclaw", "hermes", "google", "cursor", "opencode"];

type WorkspaceChatHarnessId = Extract<HarnessId, "claudeCode" | "codex" | "google" | "cursor" | "opencode" | "hermes">;

type UseWorkspaceControllerOptions = {
  activeRouteId: RouteId | undefined;
  chatPermissionModes: Record<WorkspaceChatHarnessId, ChatPermissionMode>;
  language: Language;
  navigate: NavigateFunction;
  t: Messages;
};

function syncApprovalThreadsForRun(current: ApprovalThread[], runView: BlueprintRunView): ApprovalThread[] {
  const runThreads = runView.approvalThreads;
  if (!runThreads) return current;
  return sortApprovalThreads([
    ...runThreads,
    ...current.filter((thread) => thread.runId !== runView.run.id)
  ]);
}

function syncApprovalRequestsForRun(current: ApprovalRequest[], runView: BlueprintRunView): ApprovalRequest[] {
  const runRequests = runView.approvalRequests;
  if (!runRequests) return current;
  return sortApprovalRequests([
    ...runRequests,
    ...current.filter((request) => request.runId !== runView.run.id)
  ]);
}

function upsertApprovalThread(current: ApprovalThread[], thread: ApprovalThread): ApprovalThread[] {
  return sortApprovalThreads([thread, ...current.filter((candidate) => candidate.id !== thread.id)]);
}

function upsertApprovalRequests(current: ApprovalRequest[], requests: ApprovalRequest[]): ApprovalRequest[] {
  const nextById = new Map(current.map((request) => [request.id, request]));
  for (const request of requests) {
    nextById.set(request.id, request);
  }
  return sortApprovalRequests([...nextById.values()]);
}

function sortApprovalThreads(threads: ApprovalThread[]): ApprovalThread[] {
  return threads.slice().sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

function sortApprovalRequests(requests: ApprovalRequest[]): ApprovalRequest[] {
  return requests.slice().sort((left, right) => new Date(right.requestedAt).getTime() - new Date(left.requestedAt).getTime());
}

export function useWorkspaceController({
  activeRouteId,
  chatPermissionModes,
  language,
  navigate,
  t
}: UseWorkspaceControllerOptions) {
  const [companies, setCompanies] = useState<CompanyOverview[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | undefined>();
  const [blueprints, setBlueprints] = useState<BlueprintDefinition[]>([]);
  const [blueprint, setBlueprint] = useState<BlueprintDefinition | undefined>();
  const [dirtyBlueprintIds, setDirtyBlueprintIds] = useState<Set<string>>(() => new Set());
  const [catalog, setCatalog] = useState<CatalogSnapshot | undefined>();
  const [openClawConfig, setOpenClawConfig] = useState<OpenClawConfigState | undefined>();
  const [openClawWizard, setOpenClawWizard] = useState<OpenClawConfigWizardMetadata | undefined>();
  const [openClawModelUsage, setOpenClawModelUsage] = useState<OpenClawModelUsageSummary[]>([]);
  const [openClawVersion, setOpenClawVersion] = useState<OpenClawVersionInfo | undefined>();
  const [hivewardUpdate, setHivewardUpdate] = useState<HivewardUpdateStatus | undefined>();
  const [hivewardUpdateChecking, setHivewardUpdateChecking] = useState(false);
  const [harnessStatuses, setHarnessStatuses] = useState<HarnessStatus[]>([]);
  const [hermesConfig, setHermesConfig] = useState<HermesConfigResponse | undefined>();
  const [claudeCodeModelConfig, setClaudeCodeModelConfig] = useState<ClaudeCodeModelConfig | undefined>();
  const [claudeCodeModelPresets, setClaudeCodeModelPresets] = useState<ClaudeCodeModelPreset[]>([]);
  const [claudeCodeSavedModelProfiles, setClaudeCodeSavedModelProfiles] = useState<ClaudeCodeSavedModelProfile[]>([]);
  const [harnessSkillStatuses, setHarnessSkillStatuses] = useState<Partial<Record<HarnessId, HarnessSkillStatusResponse>>>({});
  const [runtime, setRuntime] = useState<RuntimeOverview | undefined>();
  const [runSummaries, setRunSummaries] = useState<BlueprintRunSummary[]>([]);
  const [runDetailsById, setRunDetailsById] = useState<Record<string, BlueprintRunView>>({});
  const [runRoomOutputStreamStates, setRunRoomOutputStreamStates] = useState<Record<string, RunRoomOutputStreamState>>({});
  const [approvals, setApprovals] = useState<PendingApprovalItem[]>([]);
  const [approvalRequests, setApprovalRequests] = useState<ApprovalRequest[]>([]);
  const [approvalThreads, setApprovalThreads] = useState<ApprovalThread[]>([]);
  const [roleDirectory, setRoleDirectory] = useState<CompanyRoleDirectory | undefined>();
  const [architecture, setArchitecture] = useState<ArchitectureBlueprintView | undefined>();
  const [humanActionQueue, setHumanActionQueue] = useState<HumanActionQueueItem[]>([]);
  const [humanActionResponsesByRequestId, setHumanActionResponsesByRequestId] = useState<Record<string, HumanActionResponse[]>>({});
  const [blueprintKanbanBoard, setBlueprintKanbanBoard] = useState<BlueprintKanbanBoard>(() => emptyBlueprintKanbanBoard());
  const [dashboard, setDashboard] = useState<WorkspaceDashboard | undefined>();
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const [runPageBlueprintId, setRunPageBlueprintId] = useState<string | undefined>();
  const [focusedHumanActionEntryId, setFocusedHumanActionEntryId] = useState<string | undefined>();
  const [busyAction, setBusyAction] = useState<string | undefined>();
  const [dashboardDirty, setDashboardDirty] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const messageRef = useRef(t);
  const blueprintStateRef = useRef<BlueprintDefinition | undefined>(undefined);
  const blueprintCollectionRef = useRef<BlueprintDefinition[]>([]);
  const unsavedBlueprintIdsRef = useRef<Set<string>>(new Set());
  const chatPermissionModesRef = useRef<Record<WorkspaceChatHarnessId, ChatPermissionMode>>(chatPermissionModes);
  const autosaveInFlightRef = useRef(false);
  const currentBusyActionRef = useRef<string | undefined>(undefined);
  const selectedBlueprintStateIdRef = useRef<string | undefined>(undefined);
  const selectedRunStateIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    messageRef.current = t;
  }, [t]);

  useEffect(() => {
    blueprintStateRef.current = blueprint;
    selectedBlueprintStateIdRef.current = blueprint?.id;
  }, [blueprint]);

  useEffect(() => {
    blueprintCollectionRef.current = blueprints;
  }, [blueprints]);

  useEffect(() => {
    unsavedBlueprintIdsRef.current = dirtyBlueprintIds;
  }, [dirtyBlueprintIds]);

  useEffect(() => {
    currentBusyActionRef.current = busyAction;
  }, [busyAction]);

  useEffect(() => {
    selectedRunStateIdRef.current = selectedRunId;
  }, [selectedRunId]);

  useEffect(() => {
    chatPermissionModesRef.current = chatPermissionModes;
  }, [chatPermissionModes]);

  const runs = useMemo<BlueprintRunView[]>(
    () =>
      runSummaries.map((summary) => {
        const detail = runDetailsById[summary.id];
        return detail ? { ...detail, run: summary } : { run: summary, nodeRuns: [], events: [], finalResult: null };
      }),
    [runSummaries, runDetailsById]
  );

  const loadWorkspace = useCallback(
    async (options?: { blueprintId?: string; runId?: string }) => {
      const [
        companyDirectory,
        nextBlueprints,
        nextCatalog,
        nextOpenClawConfig,
        nextOpenClawWizard,
        nextOpenClawModelUsage,
        nextHarnessSkillStatuses,
        nextRunSummaries,
        nextApprovals,
        loadedApprovalRequests,
        nextApprovalThreads,
        nextRoles,
        nextHumanActionQueue,
        nextBlueprintKanbanBoard,
        nextDashboard,
        nextRuntime
      ] = await Promise.all([
        api.listCompanies(),
        api.listBlueprints(),
        api.getCatalogSnapshot(),
        api.getOpenClawConfig(),
        api.getOpenClawConfigWizard(),
        api.getOpenClawModelUsage().catch(() => []),
        loadHarnessSkillStatuses(),
        api.listBlueprintRuns(),
        api.listPendingApprovals(),
        api.listApprovalRequests(),
        api.listApprovalThreads({ status: "open" }).catch(() => []),
        api.getRoleDirectory().catch(() => undefined),
        api.listHumanActionQueue().catch(() => []),
        api.listBlueprintKanban().catch(() => emptyBlueprintKanbanBoard()),
        api.getDashboardState(),
        api.getRuntimeOverview().catch(() => emptyRuntimeOverview())
      ]);

      const preferredRunId = options?.runId ?? selectedRunStateIdRef.current;
      const nextRunId = preferredRunId && nextRunSummaries.some((item) => item.id === preferredRunId) ? preferredRunId : undefined;
      const nextRunView = nextRunId ? await api.getBlueprintRun(nextRunId).catch(() => undefined) : undefined;

      setCompanies(companyDirectory.companies);
      setSelectedCompanyId(companyDirectory.selectedCompanyId);
      const hydratedBlueprints = mergeBlueprintsPreservingLocalEdits(
        nextBlueprints,
        blueprintCollectionRef.current,
        unsavedBlueprintIdsRef.current
      );
      blueprintCollectionRef.current = hydratedBlueprints;
      setBlueprints(hydratedBlueprints);
      setCatalog(nextCatalog);
      setOpenClawConfig(nextOpenClawConfig);
      setOpenClawWizard(nextOpenClawWizard);
      setOpenClawModelUsage(nextOpenClawModelUsage);
      setHarnessSkillStatuses(nextHarnessSkillStatuses);
      setRunSummaries(nextRunSummaries);
      setRunDetailsById((current) => syncRunDetails(current, nextRunSummaries, nextRunView));
      setApprovals(nextApprovals);
      setApprovalRequests(loadedApprovalRequests);
      setApprovalThreads(nextApprovalThreads);
      setRoleDirectory(nextRoles?.roles);
      setArchitecture(nextRoles?.architecture);
      setHumanActionQueue(nextHumanActionQueue);
      setBlueprintKanbanBoard(nextBlueprintKanbanBoard);
      setDashboard(nextDashboard);
      setRuntime(nextRuntime);
      setDashboardDirty(false);

      // Async load harness-status and hermes-config (slow APIs)
      Promise.all([
        api.getHarnessStatus().catch(() => []),
        api.getHermesConfig().catch(() => undefined),
        api.getClaudeCodeModelConfig().catch(() => undefined)
      ]).then(([nextHarnessStatuses, nextHermesConfig, nextClaudeCodeModelResponse]) => {
        setHarnessStatuses(nextHarnessStatuses);
        setHermesConfig(nextHermesConfig);
        setClaudeCodeModelConfig(nextClaudeCodeModelResponse?.config);
        setClaudeCodeModelPresets(nextClaudeCodeModelResponse?.presets ?? []);
        setClaudeCodeSavedModelProfiles(nextClaudeCodeModelResponse?.savedProfiles ?? []);
      }).catch(() => {
        // Ignore errors for async loaded data
      });

      const preferredBlueprintId = options?.blueprintId ?? selectedBlueprintStateIdRef.current ?? hydratedBlueprints[0]?.id;
      const nextBlueprint = hydratedBlueprints.find((item) => item.id === preferredBlueprintId) ?? hydratedBlueprints[0];
      blueprintStateRef.current = nextBlueprint;
      selectedBlueprintStateIdRef.current = nextBlueprint?.id;
      setBlueprint(nextBlueprint);
      setSelectedNodeId(undefined);
      setSelectedRunId(nextRunId);
    },
    []
  );

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId),
    [companies, selectedCompanyId]
  );
  const isSelectedBlueprintDirty = Boolean(blueprint && dirtyBlueprintIds.has(blueprint.id));
  const latestRunForBlueprint = useMemo(
    () => (blueprint ? runs.find((runView) => runView.run.blueprintId === blueprint.id) : undefined),
    [runs, blueprint]
  );
  const runPageBlueprint = useMemo(
    () => blueprints.find((item) => item.id === runPageBlueprintId),
    [blueprints, runPageBlueprintId]
  );

  useEffect(() => {
    setBusyAction("load");
    setError(undefined);
    void loadWorkspace()
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : messageRef.current.errors.load);
      })
      .finally(() => {
        setBusyAction(undefined);
      });
  }, [loadWorkspace]);

  useEffect(() => {
    if (!runPageBlueprintId || runPageBlueprint) return;
    setRunPageBlueprintId(undefined);
    setSelectedRunId(undefined);
  }, [runPageBlueprint, runPageBlueprintId]);

  useEffect(() => {
    if (activeRouteId !== "runs" || runPageBlueprintId || runs.length === 0) return;
    const preferredRun =
      runs.find(isActiveRunView) ??
      (blueprint ? runs.find((runView) => runView.run.blueprintId === blueprint.id) : undefined) ??
      runs[0];
    if (!preferredRun) return;
    setRunPageBlueprintId(preferredRun.run.blueprintId);
    setSelectedRunId(preferredRun.run.id);
  }, [activeRouteId, blueprint, runPageBlueprintId, runs]);

  const pollingRunId = useMemo(
    () =>
      selectRunPollingTarget({
        runs,
        selectedBlueprintId: activeRouteId === "runs" ? runPageBlueprint?.id : blueprint?.id,
        selectedRunId,
        view: activeRouteId === "runs" ? "runs" : "blueprint"
      }),
    [activeRouteId, blueprint?.id, runPageBlueprint?.id, runs, selectedRunId]
  );
  const selectedRunRoomId = selectedRunId ? runDetailsById[selectedRunId]?.runRoomOutput?.runRoomId : undefined;
  const selectedRunRoomOutputStreamState = selectedRunRoomId ? runRoomOutputStreamStates[selectedRunRoomId] ?? "idle" : "idle";

  const selectBlueprint = useCallback(
    (blueprintId: string) => {
      const next = blueprints.find((item) => item.id === blueprintId);
      if (!next) return;
      blueprintStateRef.current = next;
      selectedBlueprintStateIdRef.current = next.id;
      setBlueprint(next);
      setSelectedNodeId(undefined);
      const latestRunForNextBlueprint = runs.find((runView) => runView.run.blueprintId === next.id);
      setSelectedRunId(latestRunForNextBlueprint?.run.id);
    },
    [runs, blueprints]
  );

  const selectRunPageBlueprint = useCallback(
    (blueprintId: string) => {
      setRunPageBlueprintId(blueprintId);
      selectBlueprint(blueprintId);
    },
    [selectBlueprint]
  );

  const openBlueprintKanbanCard = useCallback((card: BlueprintKanbanCard) => {
    if (card.targetRef.type === "human_action_queue_item") {
      const focusedEntryId = `human:${card.targetRef.humanActionRequestId}`;
      void (async () => {
        try {
          const [nextApprovals, nextApprovalThreads, nextHumanActionQueue, nextBlueprintKanbanBoard] = await Promise.all([
            api.listPendingApprovals(),
            api.listApprovalThreads({ status: "open" }).catch(() => []),
            api.listHumanActionQueue(),
            api.listBlueprintKanban().catch(() => emptyBlueprintKanbanBoard())
          ]);
          setApprovals(nextApprovals);
          setApprovalThreads(nextApprovalThreads);
          setHumanActionQueue(nextHumanActionQueue);
          setBlueprintKanbanBoard(nextBlueprintKanbanBoard);
        } catch (navigationError) {
          setError(navigationError instanceof Error ? navigationError.message : messageRef.current.errors.load);
        } finally {
          setFocusedHumanActionEntryId(focusedEntryId);
          setSelectedNodeId(undefined);
          navigate(getRoutePath("approvals"));
        }
      })();
      return;
    }
    setFocusedHumanActionEntryId(undefined);
    const blueprintId = card.targetRef.type === "blueprint" ? card.targetRef.blueprintId : card.targetRef.blueprintId;
    if (blueprintId) {
      const nextBlueprint = blueprintCollectionRef.current.find((item) => item.id === blueprintId);
      if (nextBlueprint) {
        setBlueprint(nextBlueprint);
      }
      setRunPageBlueprintId(blueprintId);
    }
    if (card.targetRef.type === "run_room" && card.targetRef.runId) {
      setSelectedRunId(card.targetRef.runId);
      setSelectedNodeId(undefined);
      navigate(getRoutePath("runs"));
      return;
    }
    setSelectedNodeId(undefined);
    navigate(getRoutePath("blueprint"));
  }, [navigate]);

  const runWorkspaceTask = useCallback(async <T,>(action: string, work: () => Promise<T>): Promise<T | undefined> => {
    setBusyAction(action);
    setError(undefined);
    try {
      return await work();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : errorMessageForAction(action, messageRef.current));
      return undefined;
    } finally {
      setBusyAction(undefined);
    }
  }, []);

  const runApprovalTask = useCallback(async <T,>(action: string, work: () => Promise<T>): Promise<T | undefined> => {
    setBusyAction(action);
    setError(undefined);
    try {
      return await work();
    } catch (actionError) {
      if (isClosedApprovalConflictError(actionError)) {
        try {
          await loadWorkspace({ blueprintId: blueprintStateRef.current?.id });
        } catch (refreshError) {
          setError(refreshError instanceof Error ? refreshError.message : messageRef.current.errors.load);
        }
        return undefined;
      }
      setError(actionError instanceof Error ? actionError.message : errorMessageForAction(action, messageRef.current));
      return undefined;
    } finally {
      setBusyAction(undefined);
    }
  }, [loadWorkspace]);

  const acceptRunView = useCallback((runView: BlueprintRunView) => {
    setRunDetailsById((current) => ({ ...current, [runView.run.id]: runView }));
    setRunSummaries((current) => upsertRunSummary(current, runView.run));
    setApprovals((current) => syncApprovalsForRun(current, runView));
    setApprovalRequests((current) => syncApprovalRequestsForRun(current, runView));
    setApprovalThreads((current) => syncApprovalThreadsForRun(current, runView));
  }, []);

  const refreshBlueprintKanban = useCallback(async () => {
    setBlueprintKanbanBoard(await api.listBlueprintKanban().catch(() => emptyBlueprintKanbanBoard()));
  }, []);

  const loadOpenClawVersion = useCallback(async () => {
    try {
      setOpenClawVersion(await api.getOpenClawVersion());
    } catch (versionError) {
      setOpenClawVersion({
        resolvedAt: new Date().toISOString(),
        error: versionError instanceof Error ? versionError.message : String(versionError)
      });
    }
  }, []);

  useEffect(() => {
    void loadOpenClawVersion();
  }, [loadOpenClawVersion]);

  const updateBlueprint = useCallback((updater: (current: BlueprintDefinition) => BlueprintDefinition) => {
    const result = applyBlueprintUpdaterToCollection(blueprintStateRef.current, blueprintCollectionRef.current, updater);
    if (!result.changed || !result.blueprint) return;

    blueprintStateRef.current = result.blueprint;
    selectedBlueprintStateIdRef.current = result.blueprint.id;
    blueprintCollectionRef.current = result.blueprints;
    setBlueprint(result.blueprint);
    setBlueprints(result.blueprints);
    setDirtyBlueprintIds((currentDirty) => {
      const nextDirty = markBlueprintDirty(currentDirty, result.blueprint!.id);
      unsavedBlueprintIdsRef.current = nextDirty;
      return nextDirty;
    });
  }, []);

  const acceptSavedBlueprintSnapshot = useCallback((saved: BlueprintDefinition, savedSnapshot: BlueprintDefinition) => {
    const currentSnapshot = blueprintCollectionRef.current.find((candidate) => candidate.id === savedSnapshot.id);
    if (!currentSnapshot || !isSameBlueprintSnapshot(currentSnapshot, savedSnapshot)) return false;

    const nextBlueprints = replaceBlueprint(blueprintCollectionRef.current, saved);
    blueprintCollectionRef.current = nextBlueprints;
    setBlueprints(nextBlueprints);
    if (selectedBlueprintStateIdRef.current === saved.id) {
      blueprintStateRef.current = saved;
      setBlueprint(saved);
    }
    setDirtyBlueprintIds((current) => {
      const next = clearBlueprintDirty(current, saved.id);
      unsavedBlueprintIdsRef.current = next;
      return next;
    });
    return true;
  }, []);

  const updateArchitectureLayout = useCallback((positions: Record<string, CanvasPosition>) => {
    if (Object.keys(positions).length === 0) return;
    void api.saveArchitectureLayout(positions)
      .then((nextRoles) => {
        setRoleDirectory(nextRoles.roles);
        setArchitecture(nextRoles.architecture);
      })
      .catch((layoutError) => {
        setError(layoutError instanceof Error ? layoutError.message : messageRef.current.errors.save);
      });
  }, []);

  const mutateDashboard = useCallback((updater: (current: WorkspaceDashboard) => WorkspaceDashboard) => {
    setDashboard((current) => {
      if (!current) return current;
      return updater(current);
    });
    setDashboardDirty(true);
  }, []);

  const enterCompany = useCallback(
    (companyId: string) => {
      void runWorkspaceTask("enterCompany", async () => {
        await api.selectCompany(companyId);
        navigate(getRoutePath("company"));
        await loadWorkspace();
      });
    },
    [loadWorkspace, navigate, runWorkspaceTask]
  );

  const createCompany = useCallback(
    (input: CreateCompanyRequest) =>
      runWorkspaceTask("createCompany", async () => {
        const directory = await api.createCompany(input);
        setCompanies(directory.companies);
        setSelectedCompanyId(directory.selectedCompanyId);
        await loadWorkspace();
        return directory;
      }),
    [loadWorkspace, runWorkspaceTask]
  );

  const updateCompany = useCallback(
    (companyId: string, input: UpdateCompanyRequest) =>
      runWorkspaceTask("updateCompany", async () => {
        const directory = await api.updateCompany(companyId, input);
        setCompanies(directory.companies);
        setSelectedCompanyId(directory.selectedCompanyId);
        await loadWorkspace();
        return directory;
      }),
    [loadWorkspace, runWorkspaceTask]
  );

  const deleteCompany = useCallback(
    (companyId: string) => {
      void runWorkspaceTask("deleteCompany", async () => {
        await api.deleteCompany(companyId);
        await loadWorkspace();
      });
    },
    [loadWorkspace, runWorkspaceTask]
  );

  const refreshCatalog = useCallback(
    () =>
      runWorkspaceTask("refreshCatalog", async () => {
        const [nextCatalog, nextOpenClawConfig, nextOpenClawModelUsage, nextHarnessStatuses, nextHarnessSkillStatuses, nextRuntime] = await Promise.all([
          api.refreshCatalog(),
          api.getOpenClawConfig(),
          api.getOpenClawModelUsage().catch(() => []),
          api.getHarnessStatus().catch(() => []),
          loadHarnessSkillStatuses(),
          api.getRuntimeOverview().catch(() => emptyRuntimeOverview())
        ]);
        setCatalog(nextCatalog);
        setOpenClawConfig(nextOpenClawConfig);
        setOpenClawModelUsage(nextOpenClawModelUsage);
        setHarnessStatuses(nextHarnessStatuses);
        setHarnessSkillStatuses(nextHarnessSkillStatuses);
        setRuntime(nextRuntime);
      }),
    [runWorkspaceTask]
  );

  const checkOpenClawUpdates = useCallback(
    () =>
      runWorkspaceTask("checkOpenClawUpdates", async () => {
        const [nextOpenClawVersion, nextCatalog, nextOpenClawConfig, nextOpenClawModelUsage, nextHarnessStatuses, nextHarnessSkillStatuses, nextRuntime] = await Promise.all([
          api.getOpenClawVersion(),
          api.refreshCatalog(),
          api.getOpenClawConfig(),
          api.getOpenClawModelUsage().catch(() => []),
          api.getHarnessStatus().catch(() => []),
          loadHarnessSkillStatuses(),
          api.getRuntimeOverview().catch(() => emptyRuntimeOverview())
        ]);
        setOpenClawVersion(nextOpenClawVersion);
        setCatalog(nextCatalog);
        setOpenClawConfig(nextOpenClawConfig);
        setOpenClawModelUsage(nextOpenClawModelUsage);
        setHarnessStatuses(nextHarnessStatuses);
        setHarnessSkillStatuses(nextHarnessSkillStatuses);
        setRuntime(nextRuntime);
      }),
    [runWorkspaceTask]
  );

  const switchOpenClawGateway = useCallback(
    (url: string, token?: string) =>
      runWorkspaceTask("switchOpenClawGateway", async () => {
        const nextConfig = await api.updateOpenClawGateway(url, token);
        setOpenClawConfig(nextConfig);
      }),
    [runWorkspaceTask]
  );

  const checkHivewardUpdate = useCallback(async () => {
    setHivewardUpdateChecking(true);
    try {
      const nextUpdate = await api.getHivewardUpdate();
      setHivewardUpdate(nextUpdate);
    } catch (updateError) {
      setHivewardUpdate({
        source: "git",
        currentVersion: hivewardPackage.version,
        repositoryUrl: HIVEWARD_REPOSITORY_URL,
        checkedAt: new Date().toISOString(),
        updateAvailable: false,
        canApply: false,
        applyCommand: "",
        restartRequired: true,
        error: updateError instanceof Error ? updateError.message : String(updateError)
      });
    } finally {
      setHivewardUpdateChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkHivewardUpdate();
    const timer = window.setInterval(() => {
      void checkHivewardUpdate();
    }, HIVEWARD_UPDATE_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [checkHivewardUpdate]);

  const refreshHarnessStatus = useCallback(
    () =>
      runWorkspaceTask("refreshHarnessStatus", async () => {
        const [nextHarnessStatuses, nextHermesConfig, nextClaudeCodeModelResponse, nextHarnessSkillStatuses] = await Promise.all([
          api.getHarnessStatus(),
          api.getHermesConfig().catch(() => undefined),
          api.getClaudeCodeModelConfig().catch(() => undefined),
          loadHarnessSkillStatuses()
        ]);
        setHarnessStatuses(nextHarnessStatuses);
        setHermesConfig(nextHermesConfig);
        setClaudeCodeModelConfig(nextClaudeCodeModelResponse?.config);
        setClaudeCodeModelPresets(nextClaudeCodeModelResponse?.presets ?? []);
        setClaudeCodeSavedModelProfiles(nextClaudeCodeModelResponse?.savedProfiles ?? []);
        setHarnessSkillStatuses(nextHarnessSkillStatuses);
      }),
    [runWorkspaceTask]
  );

  const addHermesProfile = useCallback(
    (input: CreateHermesProfileRequest) => {
      void runWorkspaceTask("addHermesProfile", async () => {
        const nextHermesConfig = await api.addHermesProfile(input);
        const nextHarnessStatuses = await api.getHarnessStatus().catch(() => harnessStatuses);
        setHermesConfig(nextHermesConfig);
        setHarnessStatuses(nextHarnessStatuses);
      });
    },
    [harnessStatuses, runWorkspaceTask]
  );

  const addHermesChannel = useCallback(
    (input: CreateHermesChannelRequest) => {
      void runWorkspaceTask("addHermesChannel", async () => {
        const nextHermesConfig = await api.addHermesChannel(input);
        setHermesConfig(nextHermesConfig);
      });
    },
    [runWorkspaceTask]
  );

  const installHarnessSkills = useCallback(
    (harnessId: HarnessId) => {
      void runWorkspaceTask(`installHarnessSkills:${harnessId}`, async () => {
        const nextSkillStatus = await api.installHarnessSkills(harnessId);
        setHarnessSkillStatuses((current) => ({
          ...current,
          [harnessId]: nextSkillStatus
        }));
        if (harnessId === "openclaw") {
          const [nextCatalog, nextHarnessStatuses] = await Promise.all([
            api.refreshCatalog().catch(() => catalog),
            api.getHarnessStatus().catch(() => harnessStatuses)
          ]);
          if (nextCatalog) setCatalog(nextCatalog);
          setHarnessStatuses(nextHarnessStatuses);
        }
      });
    },
    [catalog, harnessStatuses, runWorkspaceTask]
  );

  const addOpenClawAgent = useCallback(
    (input: { name: string; workspace?: string; modelId?: string }) => {
      void runWorkspaceTask("addOpenClawAgent", async () => {
        const nextOpenClawConfig = await api.addOpenClawAgent(input);
        setOpenClawConfig(nextOpenClawConfig);
      });
    },
    [runWorkspaceTask]
  );

  const configureOpenClawModelAuth = useCallback(
    (input: ConfigureOpenClawModelAuthRequest) => {
      void runWorkspaceTask("configureOpenClawModelAuth", async () => {
        const nextOpenClawConfig = await api.configureOpenClawModelAuth(input);
        setOpenClawConfig(nextOpenClawConfig);
      });
    },
    [runWorkspaceTask]
  );

  const setOpenClawDefaultModel = useCallback(
    (modelId: string) => {
      void runWorkspaceTask(`setOpenClawDefaultModel:${modelId}`, async () => {
        const nextOpenClawConfig = await api.updateOpenClawDefaultModel(modelId);
        setOpenClawConfig(nextOpenClawConfig);
      });
    },
    [runWorkspaceTask]
  );

  const updateClaudeCodeModelConfig = useCallback(
    (input: UpdateClaudeCodeModelConfigRequest) => {
      void runWorkspaceTask("updateClaudeCodeModelConfig", async () => {
        const nextClaudeCodeModelResponse = await api.updateClaudeCodeModelConfig(input);
        const nextHarnessStatuses = await api.getHarnessStatus().catch(() => harnessStatuses);
        setClaudeCodeModelConfig(nextClaudeCodeModelResponse.config);
        setClaudeCodeModelPresets(nextClaudeCodeModelResponse.presets);
        setClaudeCodeSavedModelProfiles(nextClaudeCodeModelResponse.savedProfiles);
        setHarnessStatuses(nextHarnessStatuses);
      });
    },
    [harnessStatuses, runWorkspaceTask]
  );

  const saveClaudeCodeModelProfile = useCallback(
    () => {
      void runWorkspaceTask("saveClaudeCodeModelProfile", async () => {
        const nextClaudeCodeModelResponse = await api.saveClaudeCodeModelProfile();
        setClaudeCodeModelConfig(nextClaudeCodeModelResponse.config);
        setClaudeCodeModelPresets(nextClaudeCodeModelResponse.presets);
        setClaudeCodeSavedModelProfiles(nextClaudeCodeModelResponse.savedProfiles);
      });
    },
    [runWorkspaceTask]
  );

  const applyClaudeCodeModelProfile = useCallback(
    (profileId: string) => {
      void runWorkspaceTask(`applyClaudeCodeModelProfile:${profileId}`, async () => {
        const nextClaudeCodeModelResponse = await api.applyClaudeCodeModelProfile(profileId);
        const nextHarnessStatuses = await api.getHarnessStatus().catch(() => harnessStatuses);
        setClaudeCodeModelConfig(nextClaudeCodeModelResponse.config);
        setClaudeCodeModelPresets(nextClaudeCodeModelResponse.presets);
        setClaudeCodeSavedModelProfiles(nextClaudeCodeModelResponse.savedProfiles);
        setHarnessStatuses(nextHarnessStatuses);
      });
    },
    [harnessStatuses, runWorkspaceTask]
  );

  const deleteClaudeCodeModelProfile = useCallback(
    (profileId: string) => {
      void runWorkspaceTask(`deleteClaudeCodeModelProfile:${profileId}`, async () => {
        const nextClaudeCodeModelResponse = await api.deleteClaudeCodeModelProfile(profileId);
        setClaudeCodeModelConfig(nextClaudeCodeModelResponse.config);
        setClaudeCodeModelPresets(nextClaudeCodeModelResponse.presets);
        setClaudeCodeSavedModelProfiles(nextClaudeCodeModelResponse.savedProfiles);
      });
    },
    [runWorkspaceTask]
  );

  const configureOpenClawChannel = useCallback(
    (input: ConfigureOpenClawChannelRequest) => {
      void runWorkspaceTask("configureOpenClawChannel", async () => {
        const nextOpenClawConfig = await api.configureOpenClawChannel(input);
        setOpenClawConfig(nextOpenClawConfig);
      });
    },
    [runWorkspaceTask]
  );

  const saveBlueprint = useCallback(() => {
    if (!blueprint) return;
    void runWorkspaceTask("saveBlueprint", async () => {
      const savedSnapshot = blueprint;
      const saved = await api.saveBlueprint(applyHarnessPermissionModesToBlueprint(savedSnapshot, chatPermissionModes));
      acceptSavedBlueprintSnapshot(saved, savedSnapshot);
    });
  }, [acceptSavedBlueprintSnapshot, runWorkspaceTask, blueprint, chatPermissionModes]);

  useEffect(() => {
    if (!selectedCompanyId) return;

    const saveDirtyBlueprints = async () => {
      if (autosaveInFlightRef.current || currentBusyActionRef.current) return;
      const dirtyBlueprints = listDirtyBlueprintsForAutosave(blueprintCollectionRef.current, unsavedBlueprintIdsRef.current);
      if (dirtyBlueprints.length === 0) return;

      autosaveInFlightRef.current = true;
      try {
        for (const dirtyBlueprint of dirtyBlueprints) {
          if (!unsavedBlueprintIdsRef.current.has(dirtyBlueprint.id)) continue;
          const savedSnapshot = blueprintCollectionRef.current.find((candidate) => candidate.id === dirtyBlueprint.id);
          if (!savedSnapshot) continue;
          const saved = await api.saveBlueprint(
            applyHarnessPermissionModesToBlueprint(savedSnapshot, chatPermissionModesRef.current)
          );
          acceptSavedBlueprintSnapshot(saved, savedSnapshot);
        }
      } catch (autosaveError) {
        setError(autosaveError instanceof Error ? autosaveError.message : messageRef.current.errors.save);
      } finally {
        autosaveInFlightRef.current = false;
      }
    };

    const timer = window.setInterval(() => {
      void saveDirtyBlueprints();
    }, WORKSPACE_BLUEPRINT_AUTOSAVE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [acceptSavedBlueprintSnapshot, selectedCompanyId]);

  const exportBlueprint = useCallback((blueprintId?: string) => {
    const targetBlueprint = blueprintId ? blueprints.find((item) => item.id === blueprintId) : blueprint;
    if (!targetBlueprint) return;
    void runWorkspaceTask("exportBlueprint", async () => {
      const blueprintPackage = await api.exportBlueprint(targetBlueprint.id);
      downloadBlueprintPackage(blueprintPackage, targetBlueprint.name);
    });
  }, [blueprint, blueprints, runWorkspaceTask]);

  const deleteBlueprint = useCallback((blueprintId: string) => {
    void runWorkspaceTask("deleteBlueprint", async () => {
      await api.deleteBlueprint(blueprintId);
      setDirtyBlueprintIds((current) => {
        const next = removeBlueprintFromDirtySet(current, blueprintId);
        unsavedBlueprintIdsRef.current = next;
        return next;
      });
      const remainingBlueprints = blueprints.filter((item) => item.id !== blueprintId);
      const nextBlueprintId = blueprint?.id === blueprintId ? remainingBlueprints[0]?.id : blueprint?.id;
      await loadWorkspace({ blueprintId: nextBlueprintId });
    });
  }, [blueprint?.id, blueprints, loadWorkspace, runWorkspaceTask]);

  const importBlueprintFile = useCallback(
    (file?: File) => {
      if (!file) return;
      void runWorkspaceTask("importBlueprint", async () => {
        const blueprintPackage = JSON.parse(await file.text());
        const imported = await api.importBlueprintPackage(blueprintPackage);
        await loadWorkspace({ blueprintId: imported[0]?.id });
        navigate(getRoutePath("blueprint"));
      });
    },
    [loadWorkspace, navigate, runWorkspaceTask]
  );

  const createBlueprint = useCallback(() => {
    void runWorkspaceTask("createBlueprint", async () => {
      const created = await api.createBlueprint({
        name: defaultNewBlueprintName(blueprints.length + 1, language)
      });
      await loadWorkspace({ blueprintId: created.id });
      navigate(getRoutePath("blueprint"));
    });
  }, [blueprints.length, loadWorkspace, language, navigate, runWorkspaceTask]);

  const runBlueprint = useCallback(() => {
    if (!blueprint) return;
    void runWorkspaceTask("runBlueprint", async () => {
      const saved = await api.saveBlueprint(applyHarnessPermissionModesToBlueprint(blueprint, chatPermissionModes));
      blueprintStateRef.current = saved;
      selectedBlueprintStateIdRef.current = saved.id;
      setBlueprint(saved);
      setBlueprints((current) => {
        const next = replaceBlueprint(current, saved);
        blueprintCollectionRef.current = next;
        return next;
      });
      setDirtyBlueprintIds((current) => {
        const next = clearBlueprintDirty(current, saved.id);
        unsavedBlueprintIdsRef.current = next;
        return next;
      });
      const runView = await api.startBlueprintRun(saved.id);
      acceptRunView(runView);
      await refreshBlueprintKanban();
      setRunPageBlueprintId(saved.id);
      setSelectedRunId(runView.run.id);
    });
  }, [acceptRunView, refreshBlueprintKanban, runWorkspaceTask, blueprint, chatPermissionModes]);

  const cancelBlueprintRun = useCallback(() => {
    const targetRunId = latestRunForBlueprint?.run.id;
    if (!targetRunId) return;
    void runWorkspaceTask("cancelBlueprintRun", async () => {
      const updated = await api.cancelBlueprintRun(targetRunId);
      acceptRunView(updated);
      await refreshBlueprintKanban();
      setSelectedRunId(updated.run.id);
    });
  }, [acceptRunView, latestRunForBlueprint?.run.id, refreshBlueprintKanban, runWorkspaceTask]);

  const sendRunInterjection = useCallback((runRoomId: string, messageMarkdown: string) => {
    void runWorkspaceTask("sendRunInterjection", async () => {
      const response = await api.sendRunInterjection(runRoomId, { messageMarkdown });
      if (response.run) {
        acceptRunView(response.run);
        await refreshBlueprintKanban();
        setSelectedRunId(response.run.run.id);
      }
    });
  }, [acceptRunView, refreshBlueprintKanban, runWorkspaceTask]);

  const applyApprovalRequestResponse = useCallback(
    async (response: Awaited<ReturnType<typeof api.approveApprovalRequest>>) => {
      setApprovalRequests((current) => upsertApprovalRequests(
        current,
        [response.approvalRequest]
      ));
      if (response.approvalThread) {
        const thread = response.approvalThread;
        setApprovalThreads((current) => upsertApprovalThread(current, thread));
      }
      if (response.run) {
        acceptRunView(response.run);
        setSelectedRunId(response.run.run.id);
      }
      await loadWorkspace({ blueprintId: blueprint?.id, runId: response.run?.run.id });
    },
    [acceptRunView, blueprint?.id, loadWorkspace]
  );

  const approveApprovalRequest = useCallback(
    (approvalRequestId: string, comment?: string) => {
      void runApprovalTask("approveApprovalRequest", async () => {
        await applyApprovalRequestResponse(await api.approveApprovalRequest(approvalRequestId, comment));
      });
    },
    [applyApprovalRequestResponse, runApprovalTask]
  );

  const rejectApprovalRequest = useCallback(
    (approvalRequestId: string, comment?: string) => {
      void runApprovalTask("rejectApprovalRequest", async () => {
        await applyApprovalRequestResponse(await api.rejectApprovalRequest(approvalRequestId, comment));
      });
    },
    [applyApprovalRequestResponse, runApprovalTask]
  );

  const replyToApprovalRequest = useCallback(
    (approvalRequestId: string, message: string) => {
      void runApprovalTask("replyApprovalRequest", async () => {
        await applyApprovalRequestResponse(await api.replyToApprovalRequest(approvalRequestId, message));
      });
    },
    [applyApprovalRequestResponse, runApprovalTask]
  );

  const sendHumanActionResponse = useCallback(
    (requestId: string, messageMarkdown: string) => {
      void runWorkspaceTask("sendHumanActionResponse", async () => {
        const result = await api.sendHumanActionResponse(requestId, { messageMarkdown });
        const nextBlueprintKanbanBoard = await api.listBlueprintKanban().catch(() => undefined);
        setHumanActionQueue(result.queue);
        if (nextBlueprintKanbanBoard) setBlueprintKanbanBoard(nextBlueprintKanbanBoard);
        setHumanActionResponsesByRequestId((current) => ({
          ...current,
          [requestId]: [...(current[requestId] ?? []), result.response]
        }));
      });
    },
    [runWorkspaceTask]
  );

  const refreshInboxAndApprovals = useCallback(async () => {
    try {
      const [nextApprovals, loadedApprovalRequests, nextApprovalThreads, nextHumanActionQueue, nextBlueprintKanbanBoard] = await Promise.all([
        api.listPendingApprovals(),
        api.listApprovalRequests(),
        api.listApprovalThreads({ status: "open" }).catch(() => []),
        api.listHumanActionQueue(),
        api.listBlueprintKanban().catch(() => emptyBlueprintKanbanBoard())
      ]);
      setApprovals(nextApprovals);
      setApprovalRequests(loadedApprovalRequests);
      setApprovalThreads(nextApprovalThreads);
      setHumanActionQueue(nextHumanActionQueue);
      setBlueprintKanbanBoard(nextBlueprintKanbanBoard);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : messageRef.current.errors.load);
    }
  }, []);

  useEffect(() => {
    if (!selectedCompanyId) return;

    let cancelled = false;
    let timer: number | undefined;

    const pollInbox = async () => {
      try {
        const [nextApprovals, loadedApprovalRequests, nextApprovalThreads, nextHumanActionQueue, nextBlueprintKanbanBoard] = await Promise.all([
          api.listPendingApprovals(),
          api.listApprovalRequests(),
          api.listApprovalThreads({ status: "open" }).catch(() => []),
          api.listHumanActionQueue(),
          api.listBlueprintKanban().catch(() => emptyBlueprintKanbanBoard())
        ]);
        if (cancelled) return;
        setApprovals(nextApprovals);
        setApprovalRequests(loadedApprovalRequests);
        setApprovalThreads(nextApprovalThreads);
        setHumanActionQueue(nextHumanActionQueue);
        setBlueprintKanbanBoard(nextBlueprintKanbanBoard);
      } catch {
        // Background inbox poll is opportunistic; user-triggered actions surface errors.
      }
    };

    const scheduleNextPoll = () => {
      timer = window.setTimeout(() => {
        void pollInbox().finally(() => {
          if (!cancelled) scheduleNextPoll();
        });
      }, INBOX_POLL_INTERVAL_MS);
    };

    scheduleNextPoll();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!selectedRunId || runDetailsById[selectedRunId]) return;

    let cancelled = false;
    void api.getBlueprintRun(selectedRunId)
      .then((runView) => {
        if (!cancelled) acceptRunView(runView);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [acceptRunView, runDetailsById, selectedRunId]);

  useEffect(() => {
    if (!selectedRunId || !selectedRunRoomId) return;

    const controller = new AbortController();
    setRunRoomOutputStreamStates((current) => ({ ...current, [selectedRunRoomId]: "connecting" }));

    void api.streamRunRoomOutputEvents(
      selectedRunRoomId,
      {
        onEvent: (event) => {
          if (event.runRoomId !== selectedRunRoomId) return;
          if (event.type === "output_error") {
            setRunRoomOutputStreamStates((current) => ({ ...current, [selectedRunRoomId]: "error" }));
            return;
          }

          setRunRoomOutputStreamStates((current) => ({ ...current, [selectedRunRoomId]: "live" }));
          if (event.type === "heartbeat") return;

          setRunDetailsById((current) => {
            const currentRunView = current[selectedRunId];
            if (!currentRunView) return current;
            if (currentRunView.runRoomOutput?.runRoomId && currentRunView.runRoomOutput.runRoomId !== selectedRunRoomId) return current;

            const nextRunView = applyRunRoomOutputStreamEventToRunView(currentRunView, event);
            if (nextRunView === currentRunView) return current;
            return { ...current, [selectedRunId]: nextRunView };
          });
        }
      },
      controller.signal
    ).catch((streamError) => {
      if (isAbortError(streamError)) return;
      setRunRoomOutputStreamStates((current) => ({ ...current, [selectedRunRoomId]: "error" }));
    });

    return () => {
      controller.abort();
    };
  }, [selectedRunId, selectedRunRoomId]);

  useEffect(() => {
    if (!pollingRunId) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const scheduleNextPoll = () => {
      timer = window.setTimeout(() => {
        void api.getBlueprintRun(pollingRunId)
          .then((runView) => {
            if (!cancelled) acceptRunView(runView);
          })
          .catch(() => undefined)
          .finally(() => {
            if (!cancelled) scheduleNextPoll();
          });
      }, RUN_STATE_POLL_INTERVAL_MS);
    };

    scheduleNextPoll();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [acceptRunView, pollingRunId]);

  useEffect(() => {
    if (!selectedCompanyId) return;

    let cancelled = false;
    let timer: number | undefined;

    const pollForBlueprintChanges = async () => {
      if (currentBusyActionRef.current) return;

      try {
        const previousBlueprints = blueprintCollectionRef.current;
        const nextBlueprints = await api.listBlueprints();
        const nextMergedBlueprints = mergeBlueprintsPreservingLocalEdits(
          nextBlueprints,
          previousBlueprints,
          unsavedBlueprintIdsRef.current
        );
        if (cancelled || blueprintCollectionSignature(nextMergedBlueprints) === blueprintCollectionSignature(previousBlueprints)) return;

        const selectedBlueprintId = selectedBlueprintStateIdRef.current;
        if (unsavedBlueprintIdsRef.current.size === 0) {
          await loadWorkspace({ blueprintId: selectedBlueprintId });
          return;
        }

        blueprintCollectionRef.current = nextMergedBlueprints;
        setBlueprints(nextMergedBlueprints);
        const nextSelectedBlueprint = selectedBlueprintId
          ? nextMergedBlueprints.find((item) => item.id === selectedBlueprintId)
          : undefined;
        if (nextSelectedBlueprint && !unsavedBlueprintIdsRef.current.has(nextSelectedBlueprint.id)) {
          blueprintStateRef.current = nextSelectedBlueprint;
          setBlueprint(nextSelectedBlueprint);
        }
        const nextRoles = await api.getRoleDirectory().catch(() => undefined);
        if (cancelled || !nextRoles) return;
        setRoleDirectory(nextRoles.roles);
        setArchitecture(nextRoles.architecture);
      } catch {
        // Background refresh is opportunistic; user-triggered actions surface errors.
      }
    };

    const scheduleNextPoll = () => {
      timer = window.setTimeout(() => {
        void pollForBlueprintChanges().finally(() => {
          if (!cancelled) scheduleNextPoll();
        });
      }, WORKSPACE_BLUEPRINT_REFRESH_INTERVAL_MS);
    };

    scheduleNextPoll();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [loadWorkspace, selectedCompanyId]);

  return {
    companies,
    selectedCompanyId,
    selectedCompany,
    blueprints,
    blueprint,
    dirtyBlueprintIds,
    catalog,
    openClawConfig,
    openClawWizard,
    openClawModelUsage,
    openClawVersion,
    hivewardUpdate,
    hivewardUpdateChecking,
    harnessStatuses,
    hermesConfig,
    claudeCodeModelConfig,
    claudeCodeModelPresets,
    claudeCodeSavedModelProfiles,
    harnessSkillStatuses,
    runtime,
    runSummaries,
    runs,
    approvals,
    approvalRequests,
    approvalThreads,
    roleDirectory,
    architecture,
    humanActionQueue,
    humanActionResponsesByRequestId,
    blueprintKanbanBoard,
    dashboard,
    selectedNodeId,
    selectedRunId,
    runPageBlueprint,
    focusedHumanActionEntryId,
    busyAction,
    dashboardDirty,
    error,
    isSelectedBlueprintDirty,
    latestRunForBlueprint,
    selectedRunRoomOutputStreamState,
    setSelectedNodeId,
    setSelectedRunId,
    selectBlueprint,
    selectRunPageBlueprint,
    openBlueprintKanbanCard,
    updateBlueprint,
    updateArchitectureLayout,
    mutateDashboard,
    enterCompany,
    createCompany,
    updateCompany,
    deleteCompany,
    refreshCatalog,
    checkOpenClawUpdates,
    switchOpenClawGateway,
    checkHivewardUpdate,
    refreshHarnessStatus,
    addHermesProfile,
    addHermesChannel,
    installHarnessSkills,
    addOpenClawAgent,
    configureOpenClawModelAuth,
    setOpenClawDefaultModel,
    updateClaudeCodeModelConfig,
    saveClaudeCodeModelProfile,
    applyClaudeCodeModelProfile,
    deleteClaudeCodeModelProfile,
    configureOpenClawChannel,
    saveBlueprint,
    exportBlueprint,
    deleteBlueprint,
    importBlueprintFile,
    createBlueprint,
    runBlueprint,
    cancelBlueprintRun,
    sendRunInterjection,
    approveApprovalRequest,
    rejectApprovalRequest,
    replyToApprovalRequest,
    sendHumanActionResponse,
    refreshInboxAndApprovals,
    clearError: () => setError(undefined)
  };
}

async function loadHarnessSkillStatuses(): Promise<Partial<Record<HarnessId, HarnessSkillStatusResponse>>> {
  const entries = await Promise.all(
    harnessSkillHarnessIds.map(async (harnessId) => {
      try {
        return [harnessId, await api.getHarnessSkillStatus(harnessId)] as const;
      } catch {
        return [harnessId, undefined] as const;
      }
    })
  );
  const statuses: Partial<Record<HarnessId, HarnessSkillStatusResponse>> = {};
  for (const [harnessId, status] of entries) {
    if (status) statuses[harnessId] = status;
  }
  return statuses;
}

function emptyRuntimeOverview(): RuntimeOverview {
  return {
    sessions: [],
    tasks: []
  };
}

function isAbortError(error: unknown): boolean {
  return typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError";
}

function defaultNewBlueprintName(index: number, language: Language): string {
  return language === "zh-CN" ? `\u65b0\u5efa\u84dd\u56fe ${index}` : `New blueprint ${index}`;
}

function downloadBlueprintPackage(blueprintPackage: PortableBlueprintPackage, blueprintName: string): void {
  const blob = new Blob([`${JSON.stringify(blueprintPackage, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeBlueprintFileName(blueprintName)}.blueprint.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function safeBlueprintFileName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "blueprint";
}

function errorMessageForAction(action: string, t: Messages): string {
  if (action === "createBlueprint") return t.errors.save;
  if (action === "saveBlueprint") return t.errors.save;
  if (action === "exportBlueprint") return t.errors.save;
  if (action === "importBlueprint") return t.errors.save;
  if (action === "runBlueprint") return t.errors.run;
  if (action === "cancelBlueprintRun") return t.errors.run;
  if (action === "sendRunInterjection") return t.errors.run;
  if (action === "sendHumanActionResponse") return t.errors.approve;
  if (action === "configureOpenClawModelAuth") return t.errors.catalog;
  if (action.startsWith("setOpenClawDefaultModel:")) return t.errors.catalog;
  if (action === "addOpenClawAgent") return t.errors.catalog;
  if (action === "configureOpenClawChannel") return t.errors.catalog;
  if (action === "refreshCatalog") return t.errors.catalog;
  return t.errors.load;
}
