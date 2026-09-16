# Desktop central navigation subscription

The sidebar tab is shared by the Muzi Creator sidebar and the central `conversation` slot. The central workbench can mount while a feature tab is being selected, so its React subscriber must reconcile a tab update that occurs before passive effects run. `useSidebarTab` uses `useSyncExternalStore` with the tab getter and sidebar-chrome subscription; this keeps the central `data-feature` view aligned with the selected sidebar tab during dynamic Desktop slot mounting.

The regression test covers a tab update from a mount-time layout effect. The source client and the installed Desktop profile use the same runtime fix; the installed profile is backed up and requires a normal Desktop restart before the running renderer can load it.
