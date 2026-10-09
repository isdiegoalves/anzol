import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Clipboard } from '@angular/cdk/clipboard';
import { DOCUMENT } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { routeOf } from '../pipeline/pipeline';
import { RequestStream } from '../realtime/request-stream';
import { parseUtc } from '../request-detail/dates';
import { RequestStore } from '../requests/request-store';
import { WebhookRequest } from '../requests/webhook-request';
import { Rule } from '../rules/rule';
import { RuleStore, RulesChangedError, validationMessages } from '../rules/rule-store';
import { ScenarioStore } from '../rules/scenario-store';
import {
  RETRY_AFTER_MAX,
  RULES_MAX,
  SequenceSpec,
  TIMES_MAX,
  insertSequence,
  sequenceStates,
  suggestScenarioName,
} from '../rules/sequence';
import { ANNOUNCEMENT_MS } from '../ui/live-region';
import { GuideStep } from './guide-step';
import { StepState } from './guide-steps';
import { Arrival, RetryCheck, retryCheck } from './retry-check';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
/**
 * A região fala uma vez por leva: espera este tempo depois da última chegada e, com a sequência
 * ainda aberta, também a espera pedida, em que a próxima tentativa ainda cabe na mesma leva.
 */
export const CHECK_SETTLE_MS = 1500;
/** Sem `Retry-After`, as requisições de teste saem com este intervalo, em segundos. */
const DEFAULT_GAP = 1;
const EMPTY: RetryCheck = { summary: '', early: '', rows: [], caveat: '' };

/** O valor do cabeçalho `Retry-After` da regra, como está configurado agora. */
function retryAfterOf(rule: Rule | undefined): unknown {
  const headers = rule?.response?.headers ?? {};
  const name = Object.keys(headers).find((key) => key.toLowerCase() === 'retry-after');
  return name === undefined ? null : headers[name];
}

/**
 * Roteiro "Test a retry" (R1): as três perguntas do assistente "Sequence", criar as regras, mandar
 * e **conferir na mesma folha**. A conferência relata a trilha das respostas e o intervalo de cada
 * tentativa contra o `Retry-After`, e nunca diz "as programmed" quando a espera não foi respeitada.
 */
@Component({
  selector: 'app-retry-guide',
  imports: [GuideStep, MatButton, MatFormField, MatHint, MatInput, MatLabel],
  templateUrl: './retry-guide.html',
  styleUrl: './retry-guide.scss',
})
export class RetryGuide {
  private readonly store = inject(RuleStore);
  private readonly scenarios = inject(ScenarioStore);
  private readonly requests = inject(RequestStore);
  private readonly stream = inject(RequestStream);
  private readonly clipboard = inject(Clipboard);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly tokenId = input.required<string>();

  protected readonly allMethods = METHODS;
  /** O método mais comum entre as requisições carregadas da URL; sem nenhuma, POST. */
  protected readonly common = computed(() => {
    const counts = new Map<string, number>();
    for (const { method } of this.requests.requests()) {
      counts.set(method, (counts.get(method) ?? 0) + 1);
    }
    const [top] = [...counts].sort(([, a], [, b]) => b - a);
    return top ? { method: top[0], count: top[1], total: this.requests.requests().length } : null;
  });
  private readonly chosenMethod = signal<string | null>(null);
  /** Um método só: é com ele que as requisições de teste saem. */
  protected readonly method = computed(
    () => this.chosenMethod() ?? this.common()?.method ?? 'POST',
  );
  protected readonly commonText = computed(() => {
    const common = this.common();
    return common && this.chosenMethod() === null
      ? $localize`Starts at the most common: ${common.method}:method:, ${common.count}:count: of ${common.total}:total:.`
      : '';
  });
  protected readonly path = signal('');
  protected readonly firstStatus = signal('503');
  protected readonly times = signal('2');
  protected readonly retryAfter = signal('');
  protected readonly finalStatus = signal('200');

  protected readonly scenario = computed(() => suggestScenarioName(this.path()));
  /** As regras da URL que são deste cenário: o passo "Create" está feito quando a URL as tem. */
  protected readonly sequence = computed(() =>
    this.store.rules().filter((rule) => rule.scenario?.name === this.scenario()),
  );
  protected readonly created = computed(() => this.sequence().length > 0);
  protected readonly createdText = computed(
    () =>
      $localize`${this.sequence().length}:count: rules created · scenario "${this.scenario()}:name:"`,
  );
  /** N válido (senão 2, para a prévia não sumir enquanto se digita). */
  private readonly count = computed(() => {
    const times = Number(this.times());
    return (Number.isInteger(times) && times >= 1 && times <= TIMES_MAX ? times : 2) + 1;
  });
  protected readonly createLabel = computed(() => $localize`Create ${this.count()}:count: rules`);
  protected readonly exceeds = computed(() => this.store.rules().length + this.count() > RULES_MAX);
  protected readonly preview = computed(() => {
    const count = this.count();
    const states = sequenceStates(this.scenario(), count);
    return states.map((state, i) => {
      const last = i === count - 1;
      const status = last ? this.finalStatus() : this.firstStatus();
      const step = last ? $localize`${state}:state: (stays)` : `${state} → ${states[i + 1]}`;
      return `${this.scenario()} ${i + 1}/${count} · ${step} · ${status}`;
    });
  });
  protected readonly errors = signal<readonly string[]>([]);
  protected readonly saving = signal(false);

  /** O que a conferência espera: o método e o caminho do passo 1. */
  protected readonly target = computed(
    () => `${this.method()} ${this.path().trim() || $localize`(any path)`}`,
  );
  /** As requisições que chegaram desde que as regras existem (ou desde o "Start over"). */
  private readonly arrivals = signal<readonly WebhookRequest[]>([]);
  /** A trilha à vista cresce na hora; a região viva fala uma vez por leva. */
  private readonly spoken = signal<RetryCheck>(EMPTY);
  protected readonly check = this.spoken.asReadonly();
  protected readonly arriving = computed(() => {
    const arrivals = this.arrivals();
    return arrivals.length > this.check().rows.length
      ? $localize`Arriving: ${arrivals.map(answerOf).join(' · ')}:trail:`
      : '';
  });
  protected readonly waitingText = computed(() =>
    this.created() && this.arrivals().length === 0
      ? $localize`Waiting for ${this.target()}:target:. Nothing arrived yet.`
      : '',
  );
  private settle: ReturnType<typeof setTimeout> | undefined;

  /** Quantas requisições de teste fecham a sequência. */
  protected readonly sendCount = computed(() => Math.max(this.sequence().length, 1));
  protected readonly sendLabel = computed(
    () => $localize`Send ${this.sendCount()}:count: test requests`,
  );
  /** O intervalo entre as requisições de teste: o `Retry-After` das regras criadas. */
  private readonly gap = computed(() => {
    const asked = retryAfterOf(this.sequence()[0]);
    return typeof asked === 'string' && /^\d+$/.test(asked) ? Number(asked) : DEFAULT_GAP;
  });
  protected readonly sending = signal(false);
  protected readonly sentNote = signal('');

  protected readonly steps = computed((): StepState[] => {
    const made: StepState = this.created() ? 'done' : 'todo';
    const closed = this.created() && this.check().rows.length >= this.sequence().length;
    return [made, made, made, made, closed ? 'done' : 'todo'];
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    effect((onCleanup) => {
      const tokenId = this.tokenId();
      untracked(() => {
        this.reset();
        // Sem as regras (URL trancada ou fora do ar), a folha fica no passo de criar.
        void this.store.load(tokenId).catch(() => undefined);
      });
      // Conexão à parte, que não mexe no "Live" do cabeçalho: a conferência não depende do filtro
      // nem das páginas carregadas da lista.
      const arrivals = this.stream
        .connect(tokenId, { quiet: true })
        .subscribe(({ request }) => this.arrive(request));
      onCleanup(() => arrivals.unsubscribe());
    });
    destroyRef.onDestroy(() => clearTimeout(this.settle));
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected chooseMethod(method: string): void {
    this.chosenMethod.set(method);
  }

  /** Grava as regras (só se a lista do servidor ainda é a lida) e começa a conferir. */
  protected async create(): Promise<void> {
    const invalid = this.invalidFields();
    if (invalid.length > 0) {
      this.errors.set([
        $localize`To create, fix: ${invalid.map(({ label }) => label).join(', ')}:fields:`,
      ]);
      this.host.querySelector<HTMLElement>(`#${invalid[0].id}`)?.focus();
      return;
    }
    if (this.exceeds()) {
      return;
    }
    const before = this.store.rules().length;
    const { rules } = insertSequence(this.store.rules(), this.spec());
    this.errors.set([]);
    this.saving.set(true);
    try {
      await this.store.saveIfUnchanged(rules);
    } catch (error) {
      this.errors.set(
        error instanceof RulesChangedError
          ? [
              $localize`The rules changed elsewhere since this page read them, so nothing was saved. Reload to see the current rules, then try again.`,
            ]
          : validationMessages(error),
      );
      return;
    } finally {
      this.saving.set(false);
    }
    this.reset();
    void this.announcer.announce(
      $localize`${this.store.rules().length - before}:count: rules created.`,
      ANNOUNCEMENT_MS,
    );
  }

  /** Manda do navegador, esperando o intervalo depois de cada resposta, e diz isso. */
  protected async send(): Promise<void> {
    if (this.sending()) {
      return;
    }
    const [count, gap, method] = [this.sendCount(), this.gap(), this.method()];
    const url = `${this.document.location.origin}/${this.tokenId()}${this.requestPath()}`;
    this.sending.set(true);
    this.sentNote.set(
      $localize`Sent from this browser, ${gap}:seconds: s apart. This checks the rules, not your sender.`,
    );
    try {
      for (let i = 0; i < count; i++) {
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, gap * 1000));
        }
        await fetch(url, { method });
      }
    } catch {
      this.sentNote.set(
        $localize`Could not send the test request. Check that the server is running and try again.`,
      );
    } finally {
      this.sending.set(false);
    }
  }

  protected copyLoop(): void {
    const url = `${this.document.location.origin}/${this.tokenId()}${this.requestPath()}`;
    const turns = Array.from({ length: this.sendCount() }, (_, i) => i + 1).join(' ');
    this.clipboard.copy(
      `for i in ${turns}; do curl -s -o /dev/null -w '%{http_code}\\n' -X ${this.method()} ${url}; sleep ${this.gap()}; done`,
    );
    void this.announcer.announce(
      $localize`Command copied. It has this URL, which is a secret.`,
      ANNOUNCEMENT_MS,
    );
  }

  /** "Start over": o cenário volta a `Started` e a conferência da folha esvazia. */
  protected async startOver(): Promise<void> {
    await this.scenarios.load(this.tokenId());
    await this.scenarios.resetAll();
    this.reset();
  }

  private reset(): void {
    clearTimeout(this.settle);
    this.arrivals.set([]);
    this.spoken.set(EMPTY);
    this.sentNote.set('');
  }

  private requestPath(): string {
    const path = this.path().trim();
    return path === '' || path.startsWith('/') ? path : `/${path}`;
  }

  /** A requisição entra na conferência, e é ela que a anuncia: a Entrada não fala a chegada de novo. */
  claims(request: WebhookRequest): boolean {
    const path = this.requestPath();
    const [route] = routeOf(request.url).split('?');
    return this.created() && request.method === this.method() && (path === '' || route === path);
  }

  private arrive(request: WebhookRequest): void {
    if (!this.claims(request)) {
      return;
    }
    this.arrivals.update((arrivals) => [...arrivals, request]);
    const open = this.arrivals().length < this.sequence().length;
    clearTimeout(this.settle);
    this.settle = setTimeout(
      () => this.spoken.set(this.checkNow()),
      (open ? this.gap() * 1000 : 0) + CHECK_SETTLE_MS,
    );
  }

  private checkNow(): RetryCheck {
    const rules = this.store.rules();
    const arrivals = this.arrivals().map((request): Arrival => ({
      at: request.created_at,
      answer: answerOf(request),
      rule: request.rule?.name ?? null,
      asked: retryAfterOf(rules.find((rule) => rule.id === request.rule?.id)),
    }));
    const programmed = this.sequence().map((rule) => String(rule.response?.status ?? ''));
    return retryCheck(arrivals, programmed);
  }

  protected timeOf(at: string): string {
    return new Intl.DateTimeFormat(this.document.documentElement.lang || 'en', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).format(parseUtc(at));
  }

  private spec(): SequenceSpec {
    const path = this.requestPath();
    return {
      methods: [this.method()],
      path: path === '' ? null : { equals: path },
      times: Number(this.times()),
      first: {
        status: Number(this.firstStatus()),
        body: '',
        retryAfter: this.retryAfter().trim() === '' ? null : Number(this.retryAfter()),
      },
      final: { status: Number(this.finalStatus()), body: '' },
      scenario: this.scenario(),
    };
  }

  /** Os campos inválidos, na ordem da folha, com o id para o foco. */
  private invalidFields(): { id: string; label: string }[] {
    const integer = (text: string, min: number, max: number) => {
      const n = Number(text);
      return text.trim() !== '' && Number.isInteger(n) && n >= min && n <= max;
    };
    return [
      {
        id: 'retry-first-status',
        label: $localize`First status (100–599)`,
        ok: integer(this.firstStatus(), 100, 599),
      },
      {
        id: 'retry-times',
        label: $localize`Times (1–20)`,
        ok: integer(this.times(), 1, TIMES_MAX),
      },
      {
        id: 'retry-after',
        label: $localize`Retry-After (0–${RETRY_AFTER_MAX}:max:)`,
        ok: this.retryAfter().trim() === '' || integer(this.retryAfter(), 0, RETRY_AFTER_MAX),
      },
      {
        id: 'retry-final-status',
        label: $localize`Final status (100–599)`,
        ok: integer(this.finalStatus(), 100, 599),
      },
    ].filter(({ ok }) => !ok);
  }
}

/** O que a URL respondeu: o status, ou a falha de rede. */
function answerOf(request: WebhookRequest): string {
  const { status, fault } = request.response ?? {};
  return status === undefined ? (fault ?? '?') : String(status);
}
