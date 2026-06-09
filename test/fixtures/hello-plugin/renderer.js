const { React, registerModule } = window.dcs98Plugin;
registerModule({ key: 'hello:panel', title: 'Hello', glyph: '👋', builtin: false,
  component: () => React.createElement('div', { 'data-testid': 'hello' }, 'Hello plugin') });
