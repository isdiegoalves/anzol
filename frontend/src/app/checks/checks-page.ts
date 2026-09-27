import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TokenStore } from '../token/token-store';
import { HealthCard } from './health-card';
import { PrivacyCard } from './privacy-card';
import { ResponseCard } from './response-card';
import { SchemaCard } from './schema-card';
import { SignatureCard } from './signature-card';

/** Seções da página, na ordem do "On this page" (`?section=`). */
const SECTIONS = [
  { id: 'signature', label: 'Signature' },
  { id: 'schema', label: 'Schema' },
  { id: 'response', label: 'Response' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'health', label: 'Health' },
] as const;

/**
 * Checks (`#/{token}/checks`): o que a URL confere em cada mensagem e como responde, no lugar do
 * antigo diálogo Edit URL (S2). Cada cartão salva a sua parte sobre a configuração salva (CA-11).
 * `?section=` rola até o cartão; `?schema-from={requestId}` ("Create schema from this request")
 * abre o Schema com o schema inferido daquela mensagem. Os cartões só montam depois de a URL vir
 * do servidor (a do localStorage pode estar velha).
 */
@Component({
  selector: 'app-checks-page',
  imports: [RouterLink, SignatureCard, SchemaCard, ResponseCard, PrivacyCard, HealthCard],
  templateUrl: './checks-page.html',
  styleUrl: './checks-page.scss',
})
export class ChecksPage {
  protected readonly tokens = inject(TokenStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap);

  /** Parâmetro da rota (`withComponentInputBinding`). */
  readonly tokenId = input.required<string>();

  protected readonly sections = SECTIONS;
  protected readonly section = computed(() => this.query()?.get('section') ?? null);
  protected readonly schemaFrom = computed(() => this.query()?.get('schema-from') ?? null);
  /** URL carregada do servidor para esta rota; `null` enquanto carrega. */
  private readonly loaded = signal<string | null>(null);
  protected readonly ready = computed(
    () => this.loaded() === this.tokenId() && this.tokens.token()?.uuid === this.tokenId(),
  );

  constructor() {
    effect(() => {
      const tokenId = this.tokenId();
      untracked(() => {
        this.loaded.set(null);
        // 401 de URL protegida tranca a tela pelo interceptor; o resto fica sem a URL.
        this.tokens
          .load(tokenId)
          .then(() => this.loaded.set(tokenId))
          .catch(() => undefined);
      });
    });

    afterRenderEffect(() => {
      const target = this.schemaFrom() ? 'schema' : this.section();
      if (this.ready() && target) {
        this.host.nativeElement
          .querySelector(`#checks-${target}`)
          ?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      }
    });
  }
}
