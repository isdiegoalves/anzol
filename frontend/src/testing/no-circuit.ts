import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Circuit } from '../app/circuit/circuit';
import { Inbox } from '../app/inbox/inbox';

/** O lugar do circuito, vazio: sem a leitura das regras que ele faz. */
@Component({ selector: 'app-circuit', template: '' })
class NoCircuit {
  readonly line = input(false);
}

/**
 * A Entrada sem o circuito da URL, para os specs da página contarem só os pedidos dela (lista, mensagem, busca). O
 * circuito, com a leitura das regras, tem o spec dele (`circuit/circuit.spec.ts`) e o E2E `circuito.spec.ts`.
 */
export function withoutCircuit(): void {
  TestBed.overrideComponent(Inbox, {
    remove: { imports: [Circuit] },
    add: { imports: [NoCircuit] },
  });
}
