/**
 * Starting points a visitor can read in one screen.
 *
 * Each is a complete, compiling workflow rather than a snippet, because the
 * Playground's whole claim is that what you see compiles — an example that needs
 * surrounding context to work would undermine the thing being demonstrated.
 */
export interface Example {
  id: string;
  title: string;
  summary: string;
  source: string;
}

export const EXAMPLES: readonly Example[] = [
  {
    id: 'linear',
    title: 'Write, verify, accept',
    summary: 'The smallest workflow that still proves something.',
    source: `workflow Linear {
  version "1.0.0"
  description "Write, verify, accept"
}

role implementer {
  write
  requires "coding.write"
}

agent Builder {
  role implementer
  objective "Make the requested change"
  retry 2
}

check Tests {
  run "npm test"
  required
}

human Accept {
  title "Accept the change"
  decisions approve, reject
}

flow {
  Builder -> Tests
  Tests.pass -> Accept
}
`,
  },
  {
    id: 'bugfix',
    title: 'Verified bug fix',
    summary: 'A bounded repair loop behind a deterministic check.',
    source: `workflow BugFix {
  version "1.0.0"
  description "Repair a defect and prove it"
  max_cost 5
}

role implementer {
  write
  requires "coding.write"
}

role critic {
  readonly
  requires "coding.review"
}

agent Builder {
  role implementer
  objective "Find the root cause and make the smallest safe fix"
  retry 2
}

check Tests {
  run "npm test"
  required
}

agent Reviewer {
  role critic
  objective "Review the change for correctness and scope"
  reviews
}

human Accept {
  title "Accept the verified fix"
  decisions approve, reject
}

flow {
  Builder -> Tests
  Tests.pass -> Reviewer
  Reviewer -> Accept
  Tests.fail -> Builder { max 3 }
}
`,
  },
  {
    id: 'parallel',
    title: 'Two independent reviewers',
    summary: 'Read-only work runs side by side; the writer never does.',
    source: `workflow Parallel {
  version "1.0.0"
  max_cost 5
}

role implementer {
  write
}

role critic {
  readonly
}

agent Builder {
  role implementer
  objective "Make the change"
  retry 2
}

check Tests {
  run "npm test"
  required
}

agent ReviewCorrectness {
  role critic
  objective "Review for correctness"
}

agent ReviewScope {
  role critic
  objective "Review for scope creep"
}

human Accept {
  title "Accept"
  decisions approve, reject
}

flow {
  Builder -> Tests
  Tests.pass -> ReviewCorrectness
  Tests.pass -> ReviewScope
  ReviewCorrectness -> Accept
  ReviewScope -> Accept
  Tests.fail -> Builder { max 3 }
}
`,
  },
];

export const DEFAULT_EXAMPLE = EXAMPLES[1]!;
