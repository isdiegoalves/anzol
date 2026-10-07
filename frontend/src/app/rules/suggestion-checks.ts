import { SuggestionCheck } from '../ai/ai-client';
import { conditionPhrase } from '../pipeline/server-phrases';
import { WebhookRequest } from '../requests/webhook-request';
import { RULE_DEFAULT_PRIORITY, Rule, evaluationOrder } from './rule';
import { exampleHeader, exampleQuery, valueAtPath } from './rule-example';
import { catchAllPlacement } from './rule-shadow';

// O que a regra sugerida faz de verdade, dito pela tela e não pelo modelo: o servidor confere contra
// o exemplo e o histórico; a tela junta os campos do exemplo, a forma e a posição na lista.

export type Verdict = 'ok' | 'attention' | 'problem';

export interface CheckLine {
  verdict: Verdict;
  text: string;
  action?: 'sequence';
}

export interface SuggestionInput {
  rule: Rule;
  /** `null` num servidor que não confere. */
  check: SuggestionCheck | null | undefined;
  example: WebhookRequest | null;
  rules: readonly Rule[];
}

export function suggestionChecks(input: SuggestionInput): CheckLine[] {
  return [
    ...exampleLine(input),
    historyLine(input.check),
    ...fieldLines(input),
    ...shapeLines(input),
    ...sequenceLine(input.check),
  ];
}

export function suggestionSummary(
  lines: readonly CheckLine[],
  check: SuggestionCheck | null | undefined,
  usedExample: boolean,
): string {
  const problems = lines.filter(({ verdict }) => verdict === 'problem').length;
  if (problems > 0) {
    return problems === 1
      ? $localize`1 problem found. Review before applying.`
      : $localize`${problems}:count: problems found. Review before applying.`;
  }
  if (!check) {
    return $localize`Could not check against the history.`;
  }
  const { matched, evaluated } = check.recent;
  return usedExample
    ? $localize`Checked: matches the example and ${matched}:count: of the last ${evaluated}:window:.`
    : $localize`Checked: matches ${matched}:count: of the last ${evaluated}:window:. No example request was used.`;
}

function exampleLine({ check, example }: SuggestionInput): CheckLine[] {
  if (!example || !check?.example) {
    return [];
  }
  if (check.example.matches) {
    return [{ verdict: 'ok', text: $localize`Matches the example request.` }];
  }
  const reason = check.example.failed.map((phrase) => conditionPhrase(phrase).text).join(' · ');
  return [
    {
      verdict: 'problem',
      text: $localize`Does not match the example request: ${reason}:reason:`,
    },
  ];
}

function historyLine(check: SuggestionCheck | null | undefined): CheckLine {
  if (!check) {
    return { verdict: 'attention', text: $localize`Could not check against the history.` };
  }
  const { matched, evaluated } = check.recent;
  if (evaluated === 0) {
    return { verdict: 'attention', text: $localize`No requests yet to check against.` };
  }
  if (matched === 0) {
    return {
      verdict: 'problem',
      text: $localize`Would match none of the last ${evaluated}:count: requests.`,
    };
  }
  if (matched === 1 && evaluated > 1) {
    return {
      verdict: 'attention',
      text: $localize`Too specific: only this request would match (of the last ${evaluated}:window:).`,
    };
  }
  return {
    verdict: 'ok',
    text: $localize`Would match ${matched}:count: of the last ${evaluated}:window: requests.`,
  };
}

function fieldLines({ rule, check, example }: SuggestionInput): CheckLine[] {
  const match = rule.match ?? {};
  const missing: string[] = [];
  if (example) {
    for (const name of Object.keys(match.headers ?? {})) {
      if (exampleHeader(example, name) === null) {
        missing.push($localize`header ${name}:name:`);
      }
    }
    for (const name of Object.keys(match.query ?? {})) {
      if (exampleQuery(example, name) === null) {
        missing.push($localize`query ${name}:name:`);
      }
    }
    for (const condition of match.body ?? []) {
      if ('jsonPath' in condition) {
        const { path } = condition.jsonPath;
        if (valueAtPath(example.content ?? '', path).kind === 'missing') {
          missing.push(path);
        }
      }
    }
  }
  const lines: CheckLine[] = missing.map((field) => ({
    verdict: 'problem',
    text: $localize`${field}:field: is not in the example request.`,
  }));
  if (check?.warnings.some(({ code }) => code === 'path_never_seen') && match.path) {
    const path = Object.values(match.path)[0] as string;
    lines.push({
      verdict: 'problem',
      text: $localize`Path ${path}:path: was never received.`,
    });
  }
  if (example && lines.length === 0) {
    lines.push({
      verdict: 'ok',
      text: $localize`Every field in the conditions is in the example request.`,
    });
  }
  return lines;
}

function shapeLines({ rule, check, rules }: SuggestionInput): CheckLine[] {
  const lines: CheckLine[] = [];
  const response = rule.response ?? {};
  const templated =
    /\{\{/.test(response.body ?? '') ||
    Object.values(response.headers ?? {}).some((value) => /\{\{/.test(value));
  if (
    check?.warnings.some(({ code }) => code === 'template_disabled') ||
    (templated && !response.template)
  ) {
    lines.push({
      verdict: 'problem',
      text: $localize`The body has {{…}} but Template is off: it would be sent as text.`,
    });
  }
  if (hasNoCondition(rule)) {
    lines.push({
      verdict: 'problem',
      text: $localize`No conditions: it would answer every request.`,
    });
  }
  const priority = rule.priority ?? RULE_DEFAULT_PRIORITY;
  const others = rules.filter((other) => other.enabled !== false);
  const first = others.every((other) => priority < (other.priority ?? RULE_DEFAULT_PRIORITY));
  if (others.length > 0 && first) {
    lines.push({
      verdict: 'problem',
      text: $localize`Priority ${priority}:priority:: it would be checked before all ${others.length}:count: rules.`,
    });
  }
  return lines.length > 0 ? lines : [positionLine(rule, rules)];
}

function positionLine(rule: Rule, rules: readonly Rule[]): CheckLine {
  const total = rules.length + 1;
  const placement = catchAllPlacement(rules);
  if (placement) {
    const position = evaluationOrder(rules).indexOf(placement.index) + 1;
    return {
      verdict: 'ok',
      text: $localize`Enters at position ${position}:position: of ${total}:total:, before "${placement.before}:name:".`,
    };
  }
  const priority = rule.priority ?? RULE_DEFAULT_PRIORITY;
  const before = rules.filter((other) => (other.priority ?? RULE_DEFAULT_PRIORITY) <= priority);
  return {
    verdict: 'ok',
    text: $localize`Enters at position ${before.length + 1}:position: of ${total}:total:.`,
  };
}

function sequenceLine(check: SuggestionCheck | null | undefined): CheckLine[] {
  return check?.warnings.some(({ code }) => code === 'sequence_as_single_rule')
    ? [
        {
          verdict: 'problem',
          text: $localize`You asked for steps in sequence. One rule cannot do that.`,
          action: 'sequence',
        },
      ]
    : [];
}

function hasNoCondition(rule: Rule): boolean {
  const match = rule.match ?? {};
  return (
    !match.method?.length &&
    !match.path &&
    Object.keys(match.query ?? {}).length === 0 &&
    Object.keys(match.headers ?? {}).length === 0 &&
    !match.body?.length &&
    !match.signature &&
    !match.schema &&
    !match.decryption &&
    !rule.scenario?.name
  );
}
