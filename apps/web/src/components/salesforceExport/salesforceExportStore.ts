import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";
import { pushQueryHistory, type QueryHistoryEntry } from "./salesforceExport.logic";

// Fork-only Salesforce Export panel; see CUSTOM_DEVELOPMENT.md. Query tabs, history and saved
// queries live in this browser's storage, shared by every thread.

export interface ExportQueryTab {
  readonly id: string;
  readonly soql: string;
}

export interface SavedQuery extends QueryHistoryEntry {
  readonly label: string;
}

const DEFAULT_SOQL = "SELECT Id, Name FROM Account LIMIT 100";

interface SalesforceExportState {
  tabs: ExportQueryTab[];
  activeTabId: string;
  queryAll: boolean;
  tooling: boolean;
  hideEmptyColumns: boolean;
  /** Recent queries per org username, newest first. */
  history: Record<string, QueryHistoryEntry[]>;
  saved: SavedQuery[];
  setSoql: (tabId: string, soql: string) => void;
  addTab: (soql?: string) => void;
  closeTab: (tabId: string) => void;
  selectTab: (tabId: string) => void;
  setQueryAll: (queryAll: boolean) => void;
  setTooling: (tooling: boolean) => void;
  setHideEmptyColumns: (hide: boolean) => void;
  recordHistory: (org: string, entry: QueryHistoryEntry) => void;
  clearHistory: (org: string) => void;
  saveQuery: (query: SavedQuery) => void;
  removeSaved: (label: string) => void;
}

const newTabId = () => `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const firstTab: ExportQueryTab = { id: "tab-1", soql: DEFAULT_SOQL };

export const useSalesforceExportStore = create<SalesforceExportState>()(
  persist(
    (set) => ({
      tabs: [firstTab],
      activeTabId: firstTab.id,
      queryAll: false,
      tooling: false,
      hideEmptyColumns: false,
      history: {},
      saved: [],
      setSoql: (tabId, soql) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, soql } : tab)),
        })),
      addTab: (soql = DEFAULT_SOQL) =>
        set((state) => {
          const tab = { id: newTabId(), soql };
          return { tabs: [...state.tabs, tab], activeTabId: tab.id };
        }),
      closeTab: (tabId) =>
        set((state) => {
          const index = state.tabs.findIndex((tab) => tab.id === tabId);
          if (index < 0) return state;
          const rest = state.tabs.filter((tab) => tab.id !== tabId);
          const tabs = rest.length > 0 ? rest : [{ id: newTabId(), soql: "" }];
          const activeTabId =
            state.activeTabId === tabId
              ? tabs[Math.min(index, tabs.length - 1)]!.id
              : state.activeTabId;
          return { tabs, activeTabId };
        }),
      selectTab: (tabId) => set({ activeTabId: tabId }),
      setQueryAll: (queryAll) => set({ queryAll }),
      setTooling: (tooling) => set({ tooling }),
      setHideEmptyColumns: (hideEmptyColumns) => set({ hideEmptyColumns }),
      recordHistory: (org, entry) =>
        set((state) => ({
          history: { ...state.history, [org]: pushQueryHistory(state.history[org] ?? [], entry) },
        })),
      clearHistory: (org) =>
        set((state) => {
          const { [org]: _cleared, ...history } = state.history;
          return { history };
        }),
      saveQuery: (query) =>
        set((state) => ({
          saved: [query, ...state.saved.filter((item) => item.label !== query.label)],
        })),
      removeSaved: (label) =>
        set((state) => ({ saved: state.saved.filter((item) => item.label !== label) })),
    }),
    {
      name: "t3code:salesforce-export:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        queryAll: state.queryAll,
        tooling: state.tooling,
        hideEmptyColumns: state.hideEmptyColumns,
        history: state.history,
        saved: state.saved,
      }),
    },
  ),
);
