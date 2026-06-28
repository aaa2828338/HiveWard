import type { ReactNode } from "react";
import type {
  ChatPermissionMode,
  HarnessId,
  HarnessStatus,
  OpenClawConfigState
} from "@hiveward/shared";
import type { useWorkspaceController } from "../app/useWorkspaceController";
import { BlueprintStudioPage } from "../components/BlueprintStudioPage";
import { ChatPage } from "../components/ChatPage";
import { harnessDisplayLabel } from "../lib/harness-labels";
import type { Language, Messages } from "../lib/i18n";
import type { RouteId } from "../routes/route-registry";
import {
  AgentsPage,
  ApprovalsPage,
  ChannelsPage,
  CompanyDirectoryPage,
  CompanyPage,
  BlueprintKanbanPage,
  ModelsPage,
  RunsPage,
  SkillsPage
} from "./workspace/WorkspacePages";
import {
  ClaudeCodeModelsPage,
  HarnessConfigPage,
  HarnessSkillsPage,
  HermesAgentsPage,
  HermesChannelsPage,
  HermesModelsPage,
  OpenClawControlPanelPage,
  type OpenClawPanelCopy
} from "./system/SystemPages";

type WorkspaceController = ReturnType<typeof useWorkspaceController>;
type SdkChatHarnessId = Extract<HarnessId, "claudeCode" | "codex" | "google" | "cursor" | "opencode" | "hermes">;

export type PageProps = {
  routeId: RouteId;
  workspace: WorkspaceController;
  language: Language;
  t: Messages;
  chatPermissionModes: Record<SdkChatHarnessId, ChatPermissionMode>;
  openClawPanelUi: OpenClawPanelCopy;
  openClawVersionLabel: string;
  openClawVersionHealthy: boolean;
  gatewaySettings?: OpenClawConfigState["gateway"];
  gatewayStatusLabel: string;
  gatewaySourceLabel: string;
  gatewayAuthLabel: string;
  openClawPanelBusy: boolean;
  gatewaySaving: boolean;
  onSwitchGateway: (url: string, token?: string) => void;
  openClawHarnessStatus?: HarnessStatus;
  claudeCodeHarnessStatus?: HarnessStatus;
  codexHarnessStatus?: HarnessStatus;
  googleHarnessStatus?: HarnessStatus;
  cursorHarnessStatus?: HarnessStatus;
  opencodeHarnessStatus?: HarnessStatus;
  hermesHarnessStatus?: HarnessStatus;
  installingOpenClawSkills: boolean;
  installingClaudeCodeSkills: boolean;
  installingCodexSkills: boolean;
  installingGoogleSkills: boolean;
  installingCursorSkills: boolean;
  installingOpenCodeSkills: boolean;
  installingHermesSkills: boolean;
  openBlueprintImport: () => void;
  setSdkChatPermissionMode: (harnessId: SdkChatHarnessId, permissionMode: ChatPermissionMode) => void;
};

export function WorkspaceRouteRenderer({
  routeId,
  workspace,
  language,
  t,
  chatPermissionModes,
  openClawPanelUi,
  openClawVersionLabel,
  openClawVersionHealthy,
  gatewaySettings,
  gatewayStatusLabel,
  gatewaySourceLabel,
  gatewayAuthLabel,
  openClawPanelBusy,
  gatewaySaving,
  onSwitchGateway,
  openClawHarnessStatus,
  claudeCodeHarnessStatus,
  codexHarnessStatus,
  googleHarnessStatus,
  cursorHarnessStatus,
  opencodeHarnessStatus,
  hermesHarnessStatus,
  installingOpenClawSkills,
  installingClaudeCodeSkills,
  installingCodexSkills,
  installingGoogleSkills,
  installingCursorSkills,
  installingOpenCodeSkills,
  installingHermesSkills,
  openBlueprintImport,
  setSdkChatPermissionMode
}: PageProps): ReactNode {
  const {
    companies,
    selectedCompanyId,
    selectedCompany,
    blueprints,
    blueprint,
    catalog,
    openClawConfig,
    openClawWizard,
    openClawModelUsage,
    openClawVersion,
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
    selectedNodeId,
    selectedRunId,
    runPageBlueprint,
    focusedHumanActionEntryId,
    busyAction,
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
    enterCompany,
    createCompany,
    updateCompany,
    deleteCompany,
    refreshCatalog,
    checkOpenClawUpdates,
    switchOpenClawGateway,
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
    createBlueprint,
    runBlueprint,
    cancelBlueprintRun,
    sendRunInterjection,
    approveApprovalRequest,
    rejectApprovalRequest,
    replyToApprovalRequest,
    sendHumanActionResponse,
    refreshInboxAndApprovals
  } = workspace;

    if (routeId === "companyDirectory") {
      return (
        <CompanyDirectoryPage
          companies={companies}
          selectedCompanyId={selectedCompanyId}
          language={language}
          busy={Boolean(busyAction)}
          onEnterCompany={enterCompany}
          onCreateCompany={createCompany}
          onUpdateCompany={updateCompany}
          onDeleteCompany={deleteCompany}
        />
      );
    }
    if (routeId === "company") {
      return <CompanyPage companies={companies} selectedCompanyId={selectedCompanyId} language={language} />;
    }
    if (routeId === "chat") {
      return (
        <ChatPage
          catalog={catalog}
          openClawConfig={openClawConfig}
          harnessStatuses={harnessStatuses}
          runtime={runtime}
          company={selectedCompany}
          selectedCompanyId={selectedCompanyId}
          blueprints={blueprints}
          roleDirectory={roleDirectory}
          language={language}
          harnessPermissionModes={chatPermissionModes}
          onHumanActionQueueRefreshNeeded={refreshInboxAndApprovals}
        />
      );
    }
    if (routeId === "openclaw") {
      return (
        <OpenClawControlPanelPage
          ui={openClawPanelUi}
          language={language}
          openClawVersionLabel={openClawVersionLabel}
          openClawVersionHealthy={openClawVersionHealthy}
          openClawVersion={openClawVersion}
          openClawConfig={openClawConfig}
          catalog={catalog}
          runtime={runtime}
          gatewaySettings={gatewaySettings}
          gatewayStatusLabel={gatewayStatusLabel}
          gatewaySourceLabel={gatewaySourceLabel}
          gatewayAuthLabel={gatewayAuthLabel}
          harnessStatus={openClawHarnessStatus}
          busy={openClawPanelBusy}
          skillStatus={harnessSkillStatuses.openclaw}
          skillBusy={installingOpenClawSkills}
          onCheckUpdates={checkOpenClawUpdates}
          onInstallSkills={() => installHarnessSkills("openclaw")}
          onSwitchGateway={onSwitchGateway}
          gatewaySaving={gatewaySaving}
        />
      );
    }
    if (routeId === "blueprint") {
      return (
        <BlueprintStudioPage
          blueprint={blueprint}
          blueprints={blueprints}
          architecture={architecture}
          roleDirectory={roleDirectory}
          catalog={catalog}
          configuredAgents={openClawConfig?.configuredAgents}
          harnessStatuses={harnessStatuses}
          harnessPermissionModes={chatPermissionModes}
          harnessSkillStatuses={harnessSkillStatuses}
          runSummaries={runSummaries}
          runView={latestRunForBlueprint}
          selectedNodeId={selectedNodeId}
          selectedCompanyId={selectedCompanyId}
          busy={Boolean(busyAction)}
          busyAction={busyAction}
          blueprintDirty={isSelectedBlueprintDirty}
          onSelectBlueprint={selectBlueprint}
          onCreateBlueprint={createBlueprint}
          onOpenBlueprintImport={openBlueprintImport}
          onExportBlueprint={exportBlueprint}
          onDeleteBlueprint={deleteBlueprint}
          onSaveBlueprint={saveBlueprint}
          onRunBlueprint={runBlueprint}
          onCancelBlueprintRun={cancelBlueprintRun}
          onSelectNode={setSelectedNodeId}
          onUpdateBlueprint={updateBlueprint}
          onUpdateArchitectureLayout={updateArchitectureLayout}
          t={t}
        />
      );
    }
    if (routeId === "runs") {
      return (
        <RunsPage
          runs={runs}
          blueprints={blueprints}
          blueprint={runPageBlueprint}
          selectedRunId={selectedRunId}
          runRoomOutputStreamState={selectedRunRoomOutputStreamState}
          language={language}
          t={t}
          onSelectBlueprint={selectRunPageBlueprint}
          onSelectRun={setSelectedRunId}
          onSendRunInterjection={sendRunInterjection}
        />
      );
    }
    if (routeId === "approvals") {
      return (
        <ApprovalsPage
          approvals={approvals}
          approvalRequests={approvalRequests}
          approvalThreads={approvalThreads}
          humanActionQueue={humanActionQueue}
          humanActionResponsesByRequestId={humanActionResponsesByRequestId}
          language={language}
          t={t}
          actionPending={isApprovalInboxActionBusy(busyAction)}
          focusedEntryId={focusedHumanActionEntryId}
          onRefresh={refreshInboxAndApprovals}
          onApproveApprovalRequest={approveApprovalRequest}
          onRejectApprovalRequest={rejectApprovalRequest}
          onReplyApprovalRequest={replyToApprovalRequest}
          onSendHumanActionResponse={sendHumanActionResponse}
        />
      );
    }
    if (routeId === "models") {
      return (
        <ModelsPage
          catalog={catalog}
          openClawConfig={openClawConfig}
          wizard={openClawWizard}
          language={language}
          t={t}
          busy={Boolean(busyAction)}
          busyAction={busyAction}
          runs={runs}
          openClawModelUsage={openClawModelUsage}
          onRefreshCatalog={refreshCatalog}
          onConfigureModelAuth={configureOpenClawModelAuth}
          onSetDefaultModel={setOpenClawDefaultModel}
        />
      );
    }
    if (routeId === "agents") {
      return (
        <AgentsPage
          catalog={catalog}
          openClawConfig={openClawConfig}
          language={language}
          t={t}
          busy={Boolean(busyAction)}
          onAddAgent={addOpenClawAgent}
        />
      );
    }
    if (routeId === "skills") {
      return <SkillsPage catalog={catalog} language={language} t={t} />;
    }
    if (routeId === "claudeCodeConfig") {
      return (
        <HarnessConfigPage
          title={t.pages.claudeCodeConfig?.title ?? "Claude code Config"}
          description={t.pages.claudeCodeConfig?.description ?? ""}
          status={claudeCodeHarnessStatus}
          fallbackLabel={harnessDisplayLabel("claudeCode")}
          fallbackHarnessId="claudeCode"
          language={language}
          busy={busyAction === "refreshHarnessStatus"}
          skillStatus={harnessSkillStatuses.claudeCode}
          skillBusy={installingClaudeCodeSkills}
          permissionMode={chatPermissionModes.claudeCode}
          onPermissionModeChange={(permissionMode) => setSdkChatPermissionMode("claudeCode", permissionMode)}
          onRefresh={refreshHarnessStatus}
          onInstallSkills={() => installHarnessSkills("claudeCode")}
        />
      );
    }
    if (routeId === "claudeCodeModels") {
      return (
        <ClaudeCodeModelsPage
          config={claudeCodeModelConfig}
          presets={claudeCodeModelPresets}
          savedProfiles={claudeCodeSavedModelProfiles}
          status={claudeCodeHarnessStatus}
          language={language}
          busy={busyAction === "updateClaudeCodeModelConfig"}
          busyAction={busyAction}
          refreshBusy={busyAction === "refreshHarnessStatus"}
          onRefresh={refreshHarnessStatus}
          onUpdate={updateClaudeCodeModelConfig}
          onSaveProfile={saveClaudeCodeModelProfile}
          onApplyProfile={applyClaudeCodeModelProfile}
          onDeleteProfile={deleteClaudeCodeModelProfile}
        />
      );
    }
    if (routeId === "codexConfig") {
      return (
        <HarnessConfigPage
          title={t.pages.codexConfig?.title ?? "Codex Config"}
          description={t.pages.codexConfig?.description ?? ""}
          status={codexHarnessStatus}
          fallbackLabel={harnessDisplayLabel("codex")}
          fallbackHarnessId="codex"
          language={language}
          busy={busyAction === "refreshHarnessStatus"}
          skillStatus={harnessSkillStatuses.codex}
          skillBusy={installingCodexSkills}
          permissionMode={chatPermissionModes.codex}
          onPermissionModeChange={(permissionMode) => setSdkChatPermissionMode("codex", permissionMode)}
          onRefresh={refreshHarnessStatus}
          onInstallSkills={() => installHarnessSkills("codex")}
        />
      );
    }
    if (routeId === "googleConfig") {
      return (
        <HarnessConfigPage
          title={t.pages.googleConfig?.title ?? "Google CLI Config"}
          description={t.pages.googleConfig?.description ?? ""}
          status={googleHarnessStatus}
          fallbackLabel={harnessDisplayLabel("google")}
          fallbackHarnessId="google"
          language={language}
          busy={busyAction === "refreshHarnessStatus"}
          skillStatus={harnessSkillStatuses.google}
          skillBusy={installingGoogleSkills}
          permissionMode={chatPermissionModes.google}
          onPermissionModeChange={(permissionMode) => setSdkChatPermissionMode("google", permissionMode)}
          onRefresh={refreshHarnessStatus}
          onInstallSkills={() => installHarnessSkills("google")}
        />
      );
    }
    if (routeId === "cursorConfig") {
      return (
        <HarnessConfigPage
          title={t.pages.cursorConfig?.title ?? "Cursor CLI Config"}
          description={t.pages.cursorConfig?.description ?? ""}
          status={cursorHarnessStatus}
          fallbackLabel={harnessDisplayLabel("cursor")}
          fallbackHarnessId="cursor"
          language={language}
          busy={busyAction === "refreshHarnessStatus"}
          skillStatus={harnessSkillStatuses.cursor}
          skillBusy={installingCursorSkills}
          permissionMode={chatPermissionModes.cursor}
          onPermissionModeChange={(permissionMode) => setSdkChatPermissionMode("cursor", permissionMode)}
          onRefresh={refreshHarnessStatus}
          onInstallSkills={() => installHarnessSkills("cursor")}
        />
      );
    }
    if (routeId === "opencodeConfig") {
      return (
        <HarnessConfigPage
          title={t.pages.opencodeConfig?.title ?? "OpenCode Config"}
          description={t.pages.opencodeConfig?.description ?? ""}
          status={opencodeHarnessStatus}
          fallbackLabel={harnessDisplayLabel("opencode")}
          fallbackHarnessId="opencode"
          language={language}
          busy={busyAction === "refreshHarnessStatus"}
          skillStatus={harnessSkillStatuses.opencode}
          skillBusy={installingOpenCodeSkills}
          permissionMode={chatPermissionModes.opencode}
          onPermissionModeChange={(permissionMode) => setSdkChatPermissionMode("opencode", permissionMode)}
          onRefresh={refreshHarnessStatus}
          onInstallSkills={() => installHarnessSkills("opencode")}
        />
      );
    }
    if (routeId === "hermesConfig") {
      return (
        <HarnessConfigPage
          title={t.pages.hermesConfig?.title ?? "Hermes Config"}
          description={t.pages.hermesConfig?.description ?? ""}
          status={hermesHarnessStatus}
          fallbackLabel={harnessDisplayLabel("hermes")}
          fallbackHarnessId="hermes"
          language={language}
          busy={busyAction === "refreshHarnessStatus"}
          skillStatus={harnessSkillStatuses.hermes}
          skillBusy={installingHermesSkills}
          permissionMode={chatPermissionModes.hermes}
          onPermissionModeChange={(permissionMode) => setSdkChatPermissionMode("hermes", permissionMode)}
          onRefresh={refreshHarnessStatus}
          onInstallSkills={() => installHarnessSkills("hermes")}
        />
      );
    }
    if (routeId === "hermesModels") {
      return (
        <HermesModelsPage
          title={t.pages.hermesModels?.title ?? "Hermes Models"}
          description={t.pages.hermesModels?.description ?? ""}
          status={hermesHarnessStatus}
          language={language}
          busy={busyAction === "refreshHarnessStatus"}
          onRefresh={refreshHarnessStatus}
        />
      );
    }
    if (routeId === "hermesAgents") {
      return (
        <HermesAgentsPage
          title={t.pages.hermesAgents?.title ?? "Hermes Agents"}
          description={t.pages.hermesAgents?.description ?? ""}
          config={hermesConfig}
          status={hermesHarnessStatus}
          language={language}
          busy={busyAction === "addHermesProfile"}
          refreshBusy={busyAction === "refreshHarnessStatus"}
          onRefresh={refreshHarnessStatus}
          onAddProfile={addHermesProfile}
        />
      );
    }
    if (routeId === "hermesSkills") {
      return (
        <HarnessSkillsPage
          title={t.pages.hermesSkills?.title ?? "Hermes Skills"}
          description={t.pages.hermesSkills?.description ?? ""}
          language={language}
          skillStatus={harnessSkillStatuses.hermes}
          hermesSkills={hermesConfig?.skills}
          busy={installingHermesSkills}
          onInstallSkills={() => installHarnessSkills("hermes")}
        />
      );
    }
    if (routeId === "hermesChannels") {
      return (
        <HermesChannelsPage
          title={t.pages.hermesChannels?.title ?? "Hermes Channels"}
          description={t.pages.hermesChannels?.description ?? ""}
          config={hermesConfig}
          language={language}
          busy={busyAction === "addHermesChannel"}
          refreshBusy={busyAction === "refreshHarnessStatus"}
          onRefresh={refreshHarnessStatus}
          onAddChannel={addHermesChannel}
        />
      );
    }
    if (routeId === "monitor") {
      return (
        <BlueprintKanbanPage
          board={blueprintKanbanBoard}
          blueprints={blueprints}
          language={language}
          onOpenCard={openBlueprintKanbanCard}
        />
      );
    }
    if (routeId === "channels") {
      return (
      <ChannelsPage
        catalog={catalog}
        openClawConfig={openClawConfig}
        wizard={openClawWizard}
        language={language}
        t={t}
        busy={Boolean(busyAction)}
        onConfigureChannel={configureOpenClawChannel}
      />
      );
    }
    return null;
}

function isApprovalInboxActionBusy(action: string | undefined): boolean {
  return Boolean(action && (
    action === "approveApprovalRequest" ||
    action === "rejectApprovalRequest" ||
    action === "replyApprovalRequest" ||
    action === "sendHumanActionResponse"
  ));
}
