# Roflock public-alpha commit ledger

**Baseline:** `d5bcacb`

**Candidate:** `ad199a0`

**Count:** 130 commits, ordered oldest to newest

This is the exact commit population reviewed by the
[public-alpha release audit](ROFLOCK_PUBLIC_ALPHA_RELEASE_AUDIT.md). The ledger
records identity and order; the audit records findings and verification.

1. `658d931` — RF-EVO-004: freeze descendant reset on loop re-entry
2. `fb12ec1` — RF-EVO-001/002/003/005: record R0 repository audit and baseline
3. `a10719e` — RF-EVO-006: install Roflock development docs into the repository
4. `26d0164` — RF-EVO-011/RF-DIST-002/RF-DIST-003: ship the roflock executable
5. `a574f75` — RF-EVO-012: read ROFLOCK_* with a ROLEFLOCK_* fallback
6. `1198aa0` — RF-EVO-013: resolve the data directory without moving it
7. `f366f42` — RF-EVO-016: add the open-source governance the repository was missing
8. `4074806` — RF-EVO-014: prefer roflock.config.yaml and document both locations
9. `3f143c2` — RF-EVO-010: rebrand the README to Roflock positioning
10. `41286a4` — RF-EVO-006: record the R1 outcome and install the CLI distribution plan
11. `e4bf4bc` — RF-EVO-020/021: add packages/graph-ir
12. `be3cdc9` — RF-EVO-022/023/024/025/026/027: add the .roflock language and CLI
13. `f13ed83` — RF-EVO-020: match the workspace tsconfig convention in graph-ir
14. `3813c8d` — RF-EVO-028: record the R2 outcome and remaining language gaps
15. `e112504` — RF-EVO-030..040: execute compiled Graph IR through the existing runtime
16. `6c16bde` — RF-EVO-030..040: record the R3 outcome
17. `8012856` — RF-EVO-050: teach v0.1 what the built-in workflows need
18. `13898aa` — RF-EVO-051..062: move the built-in workflows to .roflock source
19. `678acb1` — RF-EVO-051..062: record the R4 outcome
20. `156ae47` — ADR-020: decide the storage kernel boundary before R5
21. `71fe580` — RF-EVO-073/085/086: make the repair budget survive a restart
22. `3ef2287` — RF-EVO-080: give a billable provider turn a stable identity
23. `8b20b27` — RF-EVO-070..086: record R5 progress and what remains
24. `8868510` — RF-EVO-086: stop rather than repeat a billable turn nobody observed
25. `e8d5461` — docs: repair the stale phase pointer and close risk 21
26. `ba29be3` — RF-EVO-070/071/072/074/075/078: type the runtime history and project it
27. `c959896` — RF-EVO-070..078: record the runtime history work in the audit
28. `2ab80b4` — RF-EVO-085: forced-restart end-to-end, and the strand it exposed
29. `5a71fb8` — RF-EVO-085: mark R5 complete and point at R6
30. `c9c7729` — RF-EVO-090..099: make roles generic without weakening coding authority
31. `c8e0536` — RF-EVO-090..099: record the R6 outcome
32. `0aef1c5` — RF-EVO-110..114: AgentDriver contract, fake driver, conformance suite
33. `f7a67b3` — RF-EVO-110..124: record R7 progress and the migration's overall state
34. `d3d67df` — RF-EVO-130..140: explain a run from what was recorded
35. `928cfe2` — RF-EVO-130..140: record the R8 outcome
36. `4315e97` — RF-EVO-150: make graph-ir platform-independent
37. `e67a584` — RF-EVO-150: record R9 progress
38. `b26c596` — RF-EVO-151/155: shared graph rendering model and roflock render
39. `e97c7c8` — RF-EVO-151/155: record the shared rendering model
40. `a0bfd7f` — RF-DIST-001: bundle workflow templates so a packaged daemon ships them
41. `7630f8e` — RF-DIST-001: close risk 18 and record what R10 inherits
42. `6e5d14b` — RF-DIST-001: actually close risk 18 in the audit
43. `54a760b` — RF-EVO-115: present existing provider adapters as AgentDrivers
44. `1c70cce` — RF-EVO-115: record the compatibility wrapper
45. `1cc13d3` — RF-EVO-115: correct an overstated permission claim
46. `aa2b242` — RF-EVO-116/118/121: ship Codex, Claude and compatible drivers
47. `ea2c941` — RF-EVO-116/118/121: record the shipped drivers and the corrected claim
48. `8bdf145` — chore: lockfile for the driver test dependencies
49. `f1684c5` — RF-EVO-117/119: verify drivers against the real CLIs, and fix what that found
50. `4c2957f` — RF-EVO-117/119: record real-CLI verification and the quota bug it found
51. `45be06a` — RF-EVO-120: OpenCode driver, and the safety property it forced
52. `3acb55d` — RF-EVO-120: record OpenCode and the read-only refusal
53. `de3acb4` — RF-EVO-123: carry session identity, and make resume real
54. `f410d61` — RF-EVO-124: declare usage reporting where it was verified
55. `bb146dc` — RF-EVO-123/124: mark R7 complete and record what conformance learned
56. `2ca5936` — RF-EVO-085: stop re-asking a human what they already decided
57. `ce419f9` — RF-EVO-093: close risk 19 — authority cannot be switched on uniformly
58. `7ebcc2b` — docs: make the risk register readable as a record, not a backlog
59. `533c716` — RF-EVO-152..159: the public Playground
60. `f7a2855` — RF-EVO-152..159: mark R9 complete
61. `8d9aa4d` — RF-EVO-170/172: serve one shared diagram model from the daemon
62. `2abc9df` — RF-EVO-170/172: record R10 progress and what Studio still needs
63. `5fb56b2` — docs: repair the phase tables and record why they kept going stale
64. `47cdd25` — RF-EVO-171/172: Studio shows the workflow it is running
65. `2df3a92` — RF-EVO-151: one diagram renderer, not two
66. `d8fe65e` — RF-EVO-171/172: record the Studio panes and the renderer correction
67. `3784061` — Revert: remove an unrelated fix from the Studio panes commit
68. `27d77a4` — fix: stop remounting editors on every background refetch
69. `98bf58b` — RF-EVO-174: show the evidence chain, gaps included, in Studio
70. `9f2be15` — RF-EVO-177: stop claiming a stop the run cannot confirm
71. `f1d7380` — RF-EVO-178: tell the operator when the view has stopped being live
72. `3df224d` — RF-EVO-176: show what a live turn is allowed to do, not just who is doing it
73. `fc9dd93` — RF-EVO-173: show the run that halted on a paid turn nobody observed
74. `d180854` — RF-EVO-179: prove an authored .roflock edit reaches execution
75. `7ecb32e` — docs: record R10 as complete, and the limit that is not
76. `ee2340b` — docs: commit the handoff package this evolution was built from
77. `5d8b69a` — RF-EVO-180: finish the launch UI and isolated Playground
78. `2d7211f` — RF-LAUNCH-001: define the public alpha completion authority
79. `827c6c4` — RF-EVO-181: pin immutable workflow snapshots
80. `e8f4a5a` — RF-EVO-182: execute authored workflow semantics
81. `1ec968e` — RF-EVO-183: execute arbitrary registered workflows
82. `959392e` — RF-EVO-184: route production turns through AgentDriver
83. `e6617ab` — RF-EVO-185: persist driver sessions and stop guarantees
84. `086d01e` — RF-EVO-186: prove semantic pins cannot collapse
85. `bb5a391` — RF-CLI-001: start authored workflows from the CLI
86. `bd52486` — RF-CLI-002: inspect durable runs and events
87. `43a8ec5` — RF-CLI-003: control runs by durable identity
88. `d6d6f2c` — RF-CLI-004: require explicit approval decisions
89. `a977531` — RF-CLI-005: stabilize JSON and exit semantics
90. `1862f1f` — RF-CLI-006: own the local daemon lifecycle
91. `cfdaaf1` — RF-DIST-001: ship a standalone npm artifact
92. `ccbf4d7` — RF-HARNESS-006: register the OpenCode production driver
93. `c43a920` — RF-DIST-007: report truthful driver readiness
94. `da1b1e0` — RF-DIST-006: diagnose local launch readiness
95. `25c038f` — RF-DIST-009: initialize projects without overwriting
96. `feccdde` — RF-DIST-012: gate OIDC npm publishing
97. `4dcafb4` — RF-HARNESS-009: expose governed runtime tools over MCP
98. `3453456` — RF-HARNESS-010: publish control-surface API v1
99. `d80336f` — RF-HARNESS-005: complete the Pi compatibility spike
100. `90871da` — RF-HARNESS-013: document harness authentication ownership
101. `3370a9b` — RF-HARNESS-007: document harness invocation paths
102. `5fd0dd4` — RF-HARNESS-014: isolate public Playground execution
103. `6a68196` — RF-HARNESS-011: prove workflow driver portability
104. `8a9baad` — RF-DIST-010: publish the CLI automation contract
105. `18182b8` — RF-DIST-011: lock the CLI exit-code contract
106. `a919165` — RF-DOCS-001: publish architecture and documentation index
107. `5953cef` — RF-EVO-187: reject unenforceable authority profiles
108. `3891d0e` — RF-EVO-188: reject invalid node retry budgets
109. `03bc779` — RF-DOCS-002: publish the language reference
110. `7cd2a66` — RF-CLI-007: align remaining automation contracts
111. `e302c49` — RF-EVO-189: finish daemon launch rebrand
112. `389bd77` — RF-DOCS-003: publish the CLI reference
113. `b5760ae` — RF-EVO-190: make live backups transactionally consistent
114. `0bb418b` — RF-EVO-191: remove signing secrets on data deletion
115. `c3280fe` — RF-DOCS-004: publish the local operator guide
116. `b93c72a` — RF-DIST-014: ship Studio in the npm artifact
117. `f640bda` — RF-EVO-192: align Studio launch regression test
118. `b8b2de1` — RF-DOCS-005: publish Playground and Studio guide
119. `d4a1f29` — RF-HARNESS-015: require offline OpenCode conformance
120. `e6c74fc` — RF-DOCS-006: publish AgentDriver authoring guide
121. `740bc58` — RF-EVO-193: finish safe runtime rebrand copy
122. `15642b6` — RF-DOCS-007: publish open-source project guides
123. `772cbeb` — RF-MAINT-001: make formatting gate clean
124. `b5e2812` — RF-CLI-008: gate final task decisions
125. `d24cdc4` — RF-CLI-009: expose operator-facing run state
126. `18f20eb` — RF-DOCS-008: validate executable quick starts
127. `5a29b0d` — RF-MAINT-002: remove stale lint suppressions
128. `575085b` — RF-EVO-194: clarify simulation evidence boundary
129. `49f8fe3` — RF-EVO-195: make release tests deterministic
130. `ad199a0` — RF-DIST-013: record the public alpha release checklist
