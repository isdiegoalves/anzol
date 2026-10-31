import { PulseLayer, hopKeyframes, joinPath, pathLength, readMotion, reverseLine } from './pulse';

/** Uma animação de mentira: guarda o que pediram e deixa terminar ou cancelar à mão. */
class FakeAnimation extends EventTarget {
  playbackRate = 1;
  cancelled = false;
  constructor(
    readonly target: Element,
    readonly keyframes: Keyframe[],
    readonly options: KeyframeAnimationOptions,
  ) {
    super();
  }
  updatePlaybackRate(rate: number): void {
    this.playbackRate = rate;
  }
  cancel(): void {
    this.cancelled = true;
    this.dispatchEvent(new Event('cancel'));
  }
  finish(): void {
    this.dispatchEvent(new Event('finish'));
  }
}

describe('Dado o pulso do circuito', () => {
  describe('Quando mede e junta os trechos do caminho', () => {
    it('deve medir retas e os cantos curvos da escada', () => {
      expect(pathLength('M80,60 H280')).toBe(200);
      expect(pathLength('M860,24 V96')).toBe(72);
      // O canto de raio 4 (quadrática com o controle no vértice) mede uns 6,5 px.
      const canto = pathLength('M686,60 Q690,60 690,56');
      expect(canto).toBeCloseTo(6.49, 1);
      expect(pathLength('M640,60 H686 Q690,60 690,56 V16')).toBeCloseTo(46 + canto + 40, 5);
    });

    it('deve juntar trechos contíguos num caminho só e percorrer uma reta ao contrário', () => {
      expect(joinPath(['M80,60 H280', 'M280,60 H460'])).toBe('M80,60 H280 H460');
      expect(reverseLine('M1060,96 V72')).toBe('M1060,72 V96');
      expect(reverseLine('M80,60 H280')).toBe('M280,60 H80');
    });

    it('deve dar um quadro por fim de salto, com o mesmo tempo para cada salto e a curva da mola', () => {
      const frames = hopKeyframes(['M80,60 H280', 'M280,60 H460', 'M460,60 H1140'], 'spring');

      expect(frames).toEqual([
        { offset: 0, offsetDistance: '0px', easing: 'spring' },
        { offset: 1 / 3, offsetDistance: '200px', easing: 'spring' },
        { offset: 2 / 3, offsetDistance: '380px', easing: 'spring' },
        { offset: 1, offsetDistance: '1060px', easing: 'spring' },
      ]);
    });
  });

  it('deve ler os tempos e as curvas dos tokens do tema', () => {
    const element = document.createElement('div');
    const tokens: Record<string, string> = {
      '--app-pulse-hop': '180ms',
      '--app-pulse-hop-short': ' 90ms',
      '--app-pulse-trail': '1.5s',
      '--app-spring-standard': 'linear(0, 0.5, 1)',
      '--app-spring-effects': '231ms linear(0, 0.6, 1)',
    };
    const spy = vi
      .spyOn(window, 'getComputedStyle')
      .mockReturnValue({ getPropertyValue: (name: string) => tokens[name] ?? '' } as never);

    expect(readMotion(element)).toEqual({
      hop: 180,
      hopShort: 90,
      settle: 1500,
      standard: 'linear(0, 0.5, 1)',
      effects: { duration: 231, easing: 'linear(0, 0.6, 1)' },
    });
    spy.mockRestore();
  });

  it('deve trocar as molas em linear() pelas curvas da demo Quando o navegador não conhece linear()', () => {
    const element = document.createElement('div');
    const tokens: Record<string, string> = {
      '--app-spring-standard': 'linear(0, 0.5, 1)',
      '--app-spring-effects': '231ms linear(0, 0.6, 1)',
    };
    const estilo = vi
      .spyOn(window, 'getComputedStyle')
      .mockReturnValue({ getPropertyValue: (name: string) => tokens[name] ?? '' } as never);
    const suporte = vi.spyOn(CSS, 'supports').mockReturnValue(false);

    expect(readMotion(element)).toMatchObject({
      standard: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      effects: { duration: 231, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)' },
    });
    estilo.mockRestore();
    suporte.mockRestore();
  });

  describe('Quando a camada lança um pulso', () => {
    let host: HTMLElement;
    let animations: FakeAnimation[];
    const motion = {
      hop: 180,
      hopShort: 90,
      settle: 1500,
      standard: 'spring',
      effects: { duration: 231, easing: 'effects' },
    };

    beforeEach(() => {
      host = document.createElement('div');
      host.setAttribute('_ngcontent-ng-c1', '');
      document.body.append(host);
      animations = [];
      Object.defineProperty(Element.prototype, 'animate', {
        configurable: true,
        value(this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
          const animation = new FakeAnimation(this, keyframes, options);
          animations.push(animation);
          return animation;
        },
      });
    });

    afterEach(() => {
      delete (Element.prototype as { animate?: unknown }).animate;
      host.remove();
    });

    it('deve pôr o ponto e o rastro no caminho, um salto de 180 ms por aresta, e o ponto se desfazer no fim (inteiro)', () => {
      const layer = new PulseLayer(host, () => motion);
      const hops = ['M80,60 H280', 'M280,60 H460', 'M460,60 H1140'];

      const pulse = layer.launch({ hops, hopMs: 180, trail: true, discharge: true });

      const [dot, trail] = [host.querySelector('.dot'), host.querySelector('.trail')];
      expect(dot?.getAttribute('style')).toContain('offset-path: path("M80,60 H280 H460 H1140")');
      expect(dot?.hasAttribute('_ngcontent-ng-c1')).toBe(true);
      expect(trail).not.toBeNull();
      const [travel, trailing, discharge] = animations;
      expect(travel.options).toEqual({ duration: 540, fill: 'forwards' });
      expect(travel.keyframes.at(-1)).toMatchObject({ offsetDistance: '1060px', easing: 'spring' });
      expect(trailing.target).toBe(trail);
      expect(trailing.keyframes.map((frame) => frame['opacity'])).toEqual([0, 0.4, 0.4, 0.4]);
      expect(discharge.options).toMatchObject({ duration: 180, delay: 540, easing: 'effects' });
      expect(discharge.keyframes.at(-1)).toEqual({ opacity: 0, transform: 'scale(2.2)' });
      expect(layer.size).toBe(1);

      discharge.finish();
      expect(host.children).toHaveLength(0);
      expect(layer.size).toBe(0);
      expect(pulse).not.toBeNull();
    });

    it('deve terminar na metade do tempo e sem rastro Quando a segunda da rajada o rebaixa', () => {
      const layer = new PulseLayer(host, () => motion);
      const pulse = layer.launch({
        hops: ['M80,60 H280', 'M280,60 H460'],
        hopMs: 180,
        trail: true,
        discharge: true,
      });

      pulse?.downgrade();

      expect(host.querySelector('.trail')).toBeNull();
      expect(animations[1].cancelled).toBe(true);
      expect([animations[0].playbackRate, animations[2].playbackRate]).toEqual([2, 2]);
      expect(pulse?.downgraded).toBe(true);
    });

    it('deve andar 90 ms por aresta, sem rastro e sem se desfazer (curto), e sumir ao limpar', () => {
      const layer = new PulseLayer(host, () => motion);

      layer.launch({
        hops: ['M80,60 H280', 'M280,60 H460'],
        hopMs: 90,
        trail: false,
        discharge: false,
      });

      expect(host.querySelector('.trail')).toBeNull();
      expect(animations).toHaveLength(1);
      expect(animations[0].options).toEqual({ duration: 180, fill: 'forwards' });
      layer.clear();
      expect(host.children).toHaveLength(0);
    });
  });
});
