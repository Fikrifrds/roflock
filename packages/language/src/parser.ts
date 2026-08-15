import {
  DiagnosticCode,
  type Diagnostic,
  type EffectClass,
  type RiskClass,
  type SourceSpan,
} from '@roleflock/graph-ir';
import type {
  ActionDecl,
  AgentDecl,
  ArtifactDecl,
  CheckDecl,
  Declaration,
  EffectDecl,
  FlowDecl,
  HumanDecl,
  RoleDecl,
  SourceFile,
  Transition,
  WorkflowDecl,
} from './ast.js';
import { TokenizeError, tokenize, type Token } from './tokenizer.js';

export interface ParseResult {
  file?: SourceFile;
  diagnostics: Diagnostic[];
}

const EFFECT_CLASSES = new Set<string>([
  'workspace_write',
  'dependency_change',
  'network_access',
  'database_write',
  'external_side_effect',
  'secret_access',
  'git_push',
  'merge',
  'deploy',
  'production_access',
  'payment_mutation',
  'public_publish',
  'destructive',
]);

const RISK_CLASSES = new Set<string>(['low', 'medium', 'high', 'critical']);

class Recovered extends Error {}

/**
 * Recursive-descent parser for `.roflock` v0.1.
 *
 * Recovers at declaration boundaries rather than stopping at the first error,
 * so a workflow with two typos reports both. A file that produced any error
 * yields no AST: a partially parsed workflow must never reach the compiler,
 * because half a graph is a graph that quietly means something else.
 */
class Parser {
  private index = 0;
  private readonly diagnostics: Diagnostic[] = [];

  constructor(
    private readonly tokens: Token[],
    private readonly uri?: string,
  ) {}

  private get current(): Token {
    return this.tokens[this.index]!;
  }

  private advance(): Token {
    const token = this.current;
    if (token.type !== 'eof') this.index += 1;
    return token;
  }

  private at(type: Token['type'], value?: string): boolean {
    return this.current.type === type && (value === undefined || this.current.value === value);
  }

  private error(message: string, span: SourceSpan = this.current.span): never {
    this.diagnostics.push({ code: DiagnosticCode.SyntaxError, severity: 'error', message, span });
    throw new Recovered();
  }

  private expect(type: Token['type'], what: string): Token {
    if (this.current.type !== type) {
      this.error(`Expected ${what}, found ${describe(this.current)}`);
    }
    return this.advance();
  }

  private identifier(what: string): string {
    return this.expect('identifier', what).value;
  }

  private stringValue(what: string): string {
    return this.expect('string', what).value;
  }

  /** Skips to the next plausible declaration start so one typo does not cascade. */
  private recover(): void {
    let depth = 0;
    while (!this.at('eof')) {
      if (this.current.type === 'lbrace') depth += 1;
      if (this.current.type === 'rbrace') {
        this.advance();
        if (depth <= 1) return;
        depth -= 1;
        continue;
      }
      this.advance();
      if (
        depth === 0 &&
        this.current.type === 'identifier' &&
        isDeclarationKeyword(this.current.value)
      ) {
        return;
      }
    }
  }

  parse(): ParseResult {
    const declarations: Declaration[] = [];
    const flows: FlowDecl[] = [];
    const start = this.current.span.start;

    while (!this.at('eof')) {
      try {
        const keyword = this.current;
        if (keyword.type !== 'identifier') {
          this.error(`Expected a declaration, found ${describe(keyword)}`);
        }
        switch (keyword.value) {
          case 'workflow':
            declarations.push(this.workflow());
            break;
          case 'role':
            declarations.push(this.role());
            break;
          case 'artifact':
            declarations.push(this.artifact());
            break;
          case 'agent':
            declarations.push(this.agent());
            break;
          case 'check':
            declarations.push(this.check());
            break;
          case 'action':
            declarations.push(this.action());
            break;
          case 'human':
            declarations.push(this.human());
            break;
          case 'flow':
            flows.push(this.flow());
            break;
          default:
            this.error(
              `Unknown declaration '${keyword.value}'. Expected one of: workflow, role, artifact, agent, check, action, human, flow`,
            );
        }
      } catch (error) {
        if (!(error instanceof Recovered)) throw error;
        this.recover();
      }
    }

    if (this.diagnostics.some((d) => d.severity === 'error')) {
      return { diagnostics: this.diagnostics };
    }

    const file: SourceFile = {
      span: this.span(start),
      declarations,
      flows,
      ...(this.uri === undefined ? {} : { uri: this.uri }),
    };
    return { file, diagnostics: this.diagnostics };
  }

  private span(start: SourceSpan['start']): SourceSpan {
    const end = this.tokens[Math.max(0, this.index - 1)]!.span.end;
    return this.uri === undefined ? { start, end } : { uri: this.uri, start, end };
  }

  /** Runs `body` for each entry of an optional `{ ... }` block. */
  private block(body: (keyword: Token) => void): void {
    if (!this.at('lbrace')) return;
    this.advance();
    while (!this.at('rbrace')) {
      if (this.at('eof')) this.error('Unterminated block: expected }');
      const keyword = this.expect('identifier', 'a property name');
      body(keyword);
    }
    this.advance();
  }

  private workflow(): WorkflowDecl {
    const start = this.advance().span.start;
    const name = this.identifier('a workflow name');
    let version: string | undefined;
    let description: string | undefined;
    let maxCost: number | undefined;
    this.block((keyword) => {
      if (keyword.value === 'version') version = this.stringValue('a version string');
      else if (keyword.value === 'description') description = this.stringValue('a description');
      else if (keyword.value === 'max_cost') {
        maxCost = Number(this.expect('number', 'a cost ceiling').value);
      } else this.error(`Unknown workflow property '${keyword.value}'`, keyword.span);
    });
    return {
      kind: 'workflow',
      name,
      span: this.span(start),
      ...(version === undefined ? {} : { version }),
      ...(description === undefined ? {} : { description }),
      ...(maxCost === undefined ? {} : { maxCost }),
    };
  }

  private role(): RoleDecl {
    const start = this.advance().span.start;
    const name = this.identifier('a role name');
    let accessMode: 'readonly' | 'write' | undefined;
    let authority: string | undefined;
    let dispatch: string | undefined;
    const requires: string[] = [];
    this.block((keyword) => {
      if (keyword.value === 'write') accessMode = 'write';
      else if (keyword.value === 'readonly') accessMode = 'readonly';
      else if (keyword.value === 'requires') requires.push(this.stringValue('a capability'));
      else if (keyword.value === 'authority') authority = this.identifier('an authority profile');
      else if (keyword.value === 'dispatch') dispatch = this.identifier('a dispatch slot');
      else this.error(`Unknown role property '${keyword.value}'`, keyword.span);
    });
    return {
      kind: 'role',
      name,
      requires,
      span: this.span(start),
      ...(accessMode === undefined ? {} : { accessMode }),
      ...(authority === undefined ? {} : { authority }),
      ...(dispatch === undefined ? {} : { dispatch }),
    };
  }

  private artifact(): ArtifactDecl {
    const start = this.advance().span.start;
    const name = this.identifier('an artifact name');
    return { kind: 'artifact', name, span: this.span(start) };
  }

  private effect(keyword: Token): EffectDecl {
    const value = this.identifier('an effect class');
    if (!EFFECT_CLASSES.has(value)) {
      this.error(`Unknown effect class '${value}'`, keyword.span);
    }
    let risk: RiskClass = 'medium';
    if (this.at('identifier', 'risk')) {
      this.advance();
      const level = this.identifier('a risk level');
      if (!RISK_CLASSES.has(level)) this.error(`Unknown risk level '${level}'`);
      risk = level as RiskClass;
    }
    return { effect: value as EffectClass, risk, span: this.span(keyword.span.start) };
  }

  private agent(): AgentDecl {
    const start = this.advance().span.start;
    const name = this.identifier('an agent name');
    let role: string | undefined;
    let objective: string | undefined;
    let reviews = false;
    let retry: number | undefined;
    const consumes: string[] = [];
    const produces: string[] = [];
    const effects: EffectDecl[] = [];
    this.block((keyword) => {
      switch (keyword.value) {
        case 'role':
          role = this.identifier('a role name');
          break;
        case 'objective':
          objective = this.stringValue('an objective');
          break;
        case 'reviews':
          reviews = true;
          break;
        case 'retry':
          retry = Number(this.expect('number', 'a retry count').value);
          break;
        case 'consumes':
          consumes.push(this.identifier('an artifact name'));
          break;
        case 'produces':
          produces.push(this.identifier('an artifact name'));
          break;
        case 'effect':
          effects.push(this.effect(keyword));
          break;
        default:
          this.error(`Unknown agent property '${keyword.value}'`, keyword.span);
      }
    });
    return {
      kind: 'agent',
      name,
      consumes,
      produces,
      effects,
      reviews,
      span: this.span(start),
      ...(role === undefined ? {} : { role }),
      ...(objective === undefined ? {} : { objective }),
      ...(retry === undefined ? {} : { retry }),
    };
  }

  private check(): CheckDecl {
    const start = this.advance().span.start;
    const name = this.identifier('a check name');
    let run: string | undefined;
    let required = false;
    let retry: number | undefined;
    const consumes: string[] = [];
    const produces: string[] = [];
    this.block((keyword) => {
      switch (keyword.value) {
        case 'run':
          run = this.stringValue('a command');
          break;
        case 'required':
          required = true;
          break;
        case 'retry':
          retry = Number(this.expect('number', 'a retry count').value);
          break;
        case 'consumes':
          consumes.push(this.identifier('an artifact name'));
          break;
        case 'produces':
          produces.push(this.identifier('an artifact name'));
          break;
        default:
          this.error(`Unknown check property '${keyword.value}'`, keyword.span);
      }
    });
    return {
      kind: 'check',
      name,
      required,
      consumes,
      produces,
      span: this.span(start),
      ...(run === undefined ? {} : { run }),
      ...(retry === undefined ? {} : { retry }),
    };
  }

  private action(): ActionDecl {
    const start = this.advance().span.start;
    const name = this.identifier('an action name');
    let run: string | undefined;
    const effects: EffectDecl[] = [];
    this.block((keyword) => {
      if (keyword.value === 'run') run = this.stringValue('a command');
      else if (keyword.value === 'effect') effects.push(this.effect(keyword));
      else this.error(`Unknown action property '${keyword.value}'`, keyword.span);
    });
    return {
      kind: 'action',
      name,
      effects,
      span: this.span(start),
      ...(run === undefined ? {} : { run }),
    };
  }

  private human(): HumanDecl {
    const start = this.advance().span.start;
    const name = this.identifier('a human node name');
    let title: string | undefined;
    const decisions: string[] = [];
    this.block((keyword) => {
      if (keyword.value === 'title') title = this.stringValue('a title');
      else if (keyword.value === 'decisions') {
        decisions.push(this.identifier('a decision name'));
        while (this.at('comma')) {
          this.advance();
          decisions.push(this.identifier('a decision name'));
        }
      } else this.error(`Unknown human property '${keyword.value}'`, keyword.span);
    });
    return {
      kind: 'human',
      name,
      decisions,
      span: this.span(start),
      ...(title === undefined ? {} : { title }),
    };
  }

  private flow(): FlowDecl {
    const start = this.advance().span.start;
    const name = this.at('identifier') ? this.identifier('a flow name') : undefined;
    const transitions: Transition[] = [];

    this.expect('lbrace', '{ to open the flow body');
    while (!this.at('rbrace')) {
      if (this.at('eof')) this.error('Unterminated flow: expected }');
      transitions.push(this.transition());
    }
    this.advance();

    return {
      kind: 'flow',
      transitions,
      span: this.span(start),
      ...(name === undefined ? {} : { name }),
    };
  }

  private transition(): Transition {
    const startToken = this.current;
    const from = this.identifier('a node name');
    let fromOutcome: string | undefined;
    let fromOutcomeSpan: SourceSpan | undefined;
    if (this.at('dot')) {
      this.advance();
      const outcomeToken = this.expect('identifier', 'an outcome name');
      fromOutcome = outcomeToken.value;
      fromOutcomeSpan = outcomeToken.span;
    }
    this.expect('arrow', '-> between two nodes');
    const to = this.identifier('a node name');

    let max: number | undefined;
    this.block((keyword) => {
      if (keyword.value !== 'max')
        this.error(`Unknown transition property '${keyword.value}'`, keyword.span);
      if (max !== undefined) this.error(`Transition declares 'max' more than once`, keyword.span);
      max = Number(this.expect('number', 'a retry limit').value);
    });

    return {
      from,
      to,
      span: this.span(startToken.span.start),
      ...(fromOutcome === undefined ? {} : { fromOutcome }),
      ...(fromOutcomeSpan === undefined ? {} : { fromOutcomeSpan }),
      ...(max === undefined ? {} : { max }),
    };
  }
}

function isDeclarationKeyword(value: string): boolean {
  return ['workflow', 'role', 'artifact', 'agent', 'check', 'action', 'human', 'flow'].includes(
    value,
  );
}

function describe(token: Token): string {
  if (token.type === 'eof') return 'end of file';
  // Re-escaped so the quoted text is what the source contains, not the decoded
  // value a diagnostic reader would search for and fail to find.
  if (token.type === 'string')
    return `string "${token.value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  return `'${token.value}'`;
}

export function parse(source: string, uri?: string): ParseResult {
  let tokens: Token[];
  try {
    tokens = tokenize(source, uri);
  } catch (caught) {
    if (!(caught instanceof TokenizeError)) throw caught;
    return {
      diagnostics: [
        {
          code: DiagnosticCode.SyntaxError,
          severity: 'error',
          message: caught.message,
          span: caught.span,
        },
      ],
    };
  }
  return new Parser(tokens, uri).parse();
}
