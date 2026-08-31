import { FlowOption, FLOW_NODES } from './flow-definition';
import { buildMenu, MENU_LIMITS, renderNumberedOptions, rowTitle } from './menu';

const option = (over: Partial<FlowOption> = {}): FlowOption => ({
  key: '1',
  label: 'GloAro Mart',
  next: 'MART_MENU',
  ...over,
});

describe('rowTitle', () => {
  it('puts the emoji in front of the label', () => {
    expect(rowTitle(option({ emoji: '🛒' }))).toBe('🛒 GloAro Mart');
  });

  it('uses the plain label when no emoji is set', () => {
    expect(rowTitle(option())).toBe('GloAro Mart');
  });

  it('prefers an explicit menuTitle over the label', () => {
    expect(rowTitle(option({ emoji: '🤝', label: 'GloAro Digital Network', menuTitle: 'Digital Network' }))).toBe(
      '🤝 Digital Network',
    );
  });

  it('clips a title that would exceed WhatsApp’s row limit', () => {
    const title = rowTitle(option({ label: 'A'.repeat(60) }));
    expect(title.length).toBeLessThanOrEqual(MENU_LIMITS.rowTitle);
    expect(title.endsWith('…')).toBe(true);
  });

  it('counts the emoji against the limit, as WhatsApp does', () => {
    const title = rowTitle(option({ emoji: '🛒', label: 'B'.repeat(60) }));
    expect([...title].length).toBeLessThanOrEqual(MENU_LIMITS.rowTitle);
  });
});

describe('buildMenu', () => {
  const options = [
    option({ key: '1', label: 'Mart', emoji: '🛒', description: 'Buy • Sell • Grow' }),
    option({ key: '2', label: 'Network', emoji: '🤝' }),
  ];

  it('maps each option to a row whose id is the option key', () => {
    const menu = buildMenu(options)!;
    expect(menu.items).toEqual([
      { id: '1', title: '🛒 Mart', description: 'Buy • Sell • Grow' },
      { id: '2', title: '🤝 Network' },
    ]);
  });

  it('uses the supplied button label, clipped to the limit', () => {
    expect(buildMenu(options, 'GloAro Mart')!.buttonText).toBe('GloAro Mart');
    const long = buildMenu(options, 'X'.repeat(40))!;
    expect(long.buttonText.length).toBeLessThanOrEqual(MENU_LIMITS.button);
  });

  it('falls back to a sensible default button label', () => {
    expect(buildMenu(options)!.buttonText).toBe('Choose an option');
    expect(buildMenu(options, '   ')!.buttonText).toBe('Choose an option');
  });

  it('refuses to build a menu WhatsApp would reject', () => {
    expect(buildMenu([])).toBeNull();
    const tooMany = Array.from({ length: MENU_LIMITS.rows + 1 }, (_, i) =>
      option({ key: String(i + 1) }),
    );
    expect(buildMenu(tooMany)).toBeNull();
  });

  it('accepts exactly the maximum number of rows', () => {
    const exact = Array.from({ length: MENU_LIMITS.rows }, (_, i) => option({ key: String(i + 1) }));
    expect(buildMenu(exact)!.items).toHaveLength(MENU_LIMITS.rows);
  });

  it('clips an over-long description', () => {
    const menu = buildMenu([option({ description: 'D'.repeat(200) })])!;
    expect(menu.items[0].description!.length).toBeLessThanOrEqual(MENU_LIMITS.rowDescription);
  });

  it('omits description entirely when there is none', () => {
    expect(buildMenu([option()])!.items[0]).not.toHaveProperty('description');
  });
});

describe('renderNumberedOptions', () => {
  it('renders keycap bullets with the emoji and description', () => {
    const text = renderNumberedOptions([
      option({ key: '1', label: 'Mart', emoji: '🛒', description: 'Buy • Sell • Grow' }),
      option({ key: '2', label: 'Network', emoji: '🤝' }),
    ]);
    expect(text).toContain('1️⃣ 🛒 Mart – Buy • Sell • Grow');
    expect(text).toContain('2️⃣ 🤝 Network');
    expect(text).toContain('Reply with the option number.');
  });

  it('uses a singular prompt for a one-option menu', () => {
    const text = renderNumberedOptions([option({ key: '1', label: 'Register' })]);
    expect(text).toContain('Reply *1* to continue.');
    expect(text).not.toContain('option number');
  });

  it('falls back to a bold key for a non-digit option', () => {
    expect(renderNumberedOptions([option({ key: 'A', label: 'Alpha' })])).toContain('*A* Alpha');
  });

  it('returns nothing for an empty menu', () => {
    expect(renderNumberedOptions([])).toBe('');
  });
});

/**
 * The two renderings are generated from one `options` array, so they can never
 * disagree. These guard the real flow rather than a fixture.
 */
describe('the shipped flow', () => {
  const menus = FLOW_NODES.filter((n) => n.nodeType === 'MENU');

  it('has menus, and every one fits inside a single WhatsApp list', () => {
    expect(menus.length).toBeGreaterThan(0);
    for (const node of menus) {
      expect(buildMenu(node.options ?? [], node.menuButton)).not.toBeNull();
    }
  });

  it('no longer spells the options out in the body', () => {
    for (const node of menus) {
      expect(node.body).not.toMatch(/Reply with the option number/i);
      expect(node.body).not.toMatch(/^\s*[1-9]️⃣/m);
    }
  });

  it('gives every option a unique key and a real destination', () => {
    for (const node of menus) {
      const keys = (node.options ?? []).map((o) => o.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const o of node.options ?? []) {
        expect(FLOW_NODES.some((n) => n.key === o.next)).toBe(true);
      }
    }
  });

  // Options are checked above; `nextKey` is the other way a node hands over,
  // and a dangling one dead-ends the conversation just as silently.
  it('points every nextKey at a node that exists', () => {
    for (const node of FLOW_NODES) {
      if (!node.nextKey) continue;
      expect(FLOW_NODES.some((n) => n.key === node.nextKey)).toBe(true);
    }
  });

  it('gives every node a unique key', () => {
    const keys = FLOW_NODES.map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps every row title within the 24-character limit', () => {
    for (const node of menus) {
      for (const o of node.options ?? []) {
        // Nothing should be silently truncated in the shipped copy.
        expect(rowTitle(o).endsWith('…')).toBe(false);
        expect([...rowTitle(o)].length).toBeLessThanOrEqual(MENU_LIMITS.rowTitle);
      }
    }
  });

  it('keeps every menu button label within its limit', () => {
    for (const node of menus) {
      expect((node.menuButton ?? '').length).toBeLessThanOrEqual(MENU_LIMITS.button);
    }
  });
});
