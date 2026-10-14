import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Keyboard, type KeyMark } from './Keyboard';

describe('Keyboard', () => {
  it('一个八度有 7 个白键和 5 个黑键', () => {
    const { container } = render(<Keyboard low={60} high={71} />);
    expect(container.querySelectorAll('.mc-key:not([data-black])')).toHaveLength(7);
    expect(container.querySelectorAll('.mc-key[data-black]')).toHaveLength(5);
  });

  it('音域从黑键开始时向下扩展到白键', () => {
    const { container } = render(<Keyboard low={61} high={64} />);
    expect(container.querySelector('[data-note="60"]')).not.toBeNull();
  });

  it('标记按下的键和判定状态', () => {
    const marks = new Map<number, KeyMark>([
      [60, { kind: 'correct' }],
      [61, { kind: 'extra' }],
      [64, { kind: 'missing', finger: 3 }],
    ]);
    const { container } = render(
      <Keyboard low={60} high={72} pressed={new Set([60, 61])} marks={marks} />,
    );
    expect(container.querySelector('[data-note="60"]')).toHaveAttribute('data-pressed', 'true');
    expect(container.querySelector('[data-note="61"]')).toHaveAttribute('data-mark', 'extra');
    expect(container.querySelector('[data-note="64"]')).toHaveAttribute('data-mark', 'missing');
    expect(container.querySelector('svg.mc-keyboard')).toHaveAttribute(
      'aria-label',
      '键盘，按下：C4 Db4',
    );
  });
});
