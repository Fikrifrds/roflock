# RoleFlock manual test checklist

- [ ] Start the daemon and web app, then open the local RoleFlock UI.
- [ ] In **Projects**, use **Choose…** to register a local Git repository.
- [ ] Create a `bug_fix` task, open it, and select **Start**.
- [ ] When the reviewer requests confirmation, select **Approve & continue**.
- [ ] When verification finishes, review the result and select **Accept**.
- [ ] Open **Providers** and confirm each listed provider shows its status, capabilities, configured models, and a working **Check health** action.
- [ ] Open the task **Evidence** view and confirm findings, test runs, artefacts/diff, usage, disclosures, and raw JSON are visible.
- [ ] Optional recovery check: restart the daemon while a confirmation is pending, reopen the UI, and confirm the approval remains in the inbox before approving it.
